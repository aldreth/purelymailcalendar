"""Smoke tests for /api/contacts (feat/contacts 3a)."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _add_mailbox(client, email="a@example.com"):
    r = client.post(
        "/api/me/mailboxes",
        json={"email": email, "password": "p", "display_name": email.split("@")[0]},
    )
    assert r.status_code == 200, r.text
    return r.json()


# Tiny in-memory CardDAV fake the contacts module talks to via monkeypatch.
class _FakeCardDav:
    def __init__(self):
        # books -> list of dicts: {href, etag, raw}
        self.books = {
            "default": [
                {
                    "href": "/webdav/999999/carddav/default/sarah.vcf",
                    "etag": "etag-sarah-v1",
                    "raw": (
                        "BEGIN:VCARD\r\n"
                        "VERSION:3.0\r\n"
                        "UID:sarah-uid\r\n"
                        "FN:Sarah Connor\r\n"
                        "N:Connor;Sarah;;;\r\n"
                        "EMAIL;TYPE=INTERNET:sarah@skynet.example\r\n"
                        "ORG:Tech Noir\r\n"
                        "END:VCARD\r\n"
                    ),
                },
                {
                    "href": "/webdav/999999/carddav/default/alex.vcf",
                    "etag": "etag-alex-v1",
                    "raw": (
                        "BEGIN:VCARD\r\n"
                        "VERSION:3.0\r\n"
                        "UID:alex-uid\r\n"
                        "FN:Alex Jordan\r\n"
                        "EMAIL;TYPE=INTERNET:alex@example.org\r\n"
                        "END:VCARD\r\n"
                    ),
                },
            ],
            "automaticallyCollected": [],
        }
        self.put_calls = []  # (book, raw) per PUT
        self.delete_calls = []

    # Functions used by calinvite_web.contacts to wire monkeypatch.
    def list_addressbooks(self, creds):
        return list(self.books.keys())

    def list_card_resources(self, creds, book):
        from calinvite.carddav_client import CardResource

        return [
            CardResource(href=r["href"], etag=r["etag"], book=book)
            for r in self.books.get(book, [])
        ]

    def get_card(self, creds, href):
        for book in self.books.values():
            for r in book:
                if r["href"] == href:
                    return r["raw"], r["etag"]
        raise RuntimeError(f"GET {href} -> HTTP 404")

    def put_card(self, creds, book, raw_vcard, *, filename=None, if_match=None):
        self.put_calls.append((book, raw_vcard))
        fname = filename or f"auto-{len(self.put_calls)}.vcf"
        href = f"/webdav/999999/carddav/{book}/{fname}"
        etag = f"etag-auto-{len(self.put_calls)}"
        self.books.setdefault(book, []).append(
            {"href": href, "etag": etag, "raw": raw_vcard}
        )
        return href, etag

    def delete_card(self, creds, href):
        self.delete_calls.append(href)
        for book in self.books.values():
            for r in list(book):
                if r["href"] == href:
                    book.remove(r)


@pytest.fixture
def fake_carddav(monkeypatch):
    fake = _FakeCardDav()
    # Patch every cdav-shaped call the contacts module imports.
    import calinvite.carddav_client as real

    monkeypatch.setattr("calinvite_web.contacts.cdav.list_addressbooks", fake.list_addressbooks)
    monkeypatch.setattr("calinvite_web.contacts.cdav.list_card_resources", fake.list_card_resources)
    monkeypatch.setattr("calinvite_web.contacts.cdav.get_card", fake.get_card)
    monkeypatch.setattr("calinvite_web.contacts.cdav.put_card", fake.put_card)
    monkeypatch.setattr("calinvite_web.contacts.cdav.delete_card", fake.delete_card)
    # Leave parse_vcard / compose_vcard / synth_etag pointing at the real impl.
    return fake


# ---------------------------------------------------------------------------
# Search + sync
# ---------------------------------------------------------------------------


def test_contacts_sync_inserts_then_search_finds(authed_client, fake_carddav):
    _add_mailbox(authed_client)
    r = authed_client.post("/api/contacts/sync")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["upserted"] == 2
    assert out["deleted"] == 0
    assert set(out["books"]) == {"default", "automaticallyCollected"}

    rows = authed_client.get("/api/contacts?q=sarah").json()
    assert len(rows) == 1
    assert rows[0]["full_name"] == "Sarah Connor"
    assert rows[0]["primary_email"] == "sarah@skynet.example"
    assert rows[0]["org"] == "Tech Noir"
    assert rows[0]["source_book"] == "default"


def test_contacts_search_empty_q_returns_all(authed_client, fake_carddav):
    _add_mailbox(authed_client)
    authed_client.post("/api/contacts/sync")
    rows = authed_client.get("/api/contacts").json()
    assert {r["full_name"] for r in rows} == {"Sarah Connor", "Alex Jordan"}


def test_contacts_sync_is_throttled(authed_client, fake_carddav):
    _add_mailbox(authed_client)
    first = authed_client.post("/api/contacts/sync").json()
    assert first["upserted"] == 2 and first["throttled"] is False

    # Second call inside the 5min TTL short-circuits.
    second = authed_client.post("/api/contacts/sync").json()
    assert second["throttled"] is True
    assert second["upserted"] == 0
    assert second["deleted"] == 0


def test_contacts_sync_force_overrides_throttle(authed_client, fake_carddav):
    _add_mailbox(authed_client)
    authed_client.post("/api/contacts/sync")
    forced = authed_client.post("/api/contacts/sync?force=true").json()
    # force=true bypasses the TTL throttle and re-walks every book. With no
    # server-side changes the per-resource etag short-circuit kicks in, so
    # we expect zero upserts AND zero deletes — but throttled must be False
    # to confirm we did the walk.
    assert forced["throttled"] is False
    assert forced["upserted"] == 0
    assert forced["deleted"] == 0
    assert set(forced["books"]) == {"default", "automaticallyCollected"}


def test_contacts_sync_deletes_missing_cards_on_next_run(authed_client, fake_carddav):
    _add_mailbox(authed_client)
    authed_client.post("/api/contacts/sync")
    # Server-side, delete Alex.
    fake_carddav.books["default"] = [r for r in fake_carddav.books["default"] if "alex" not in r["href"]]
    out = authed_client.post("/api/contacts/sync?force=true").json()
    assert out["deleted"] == 1
    rows = authed_client.get("/api/contacts").json()
    assert {r["full_name"] for r in rows} == {"Sarah Connor"}


def test_contacts_search_per_mailbox(authed_client, fake_carddav):
    a = _add_mailbox(authed_client, "a@example.com")
    b = _add_mailbox(authed_client, "b@example.com")
    # Sync mailbox A.
    r = authed_client.post("/api/contacts/sync", headers={"X-Mailbox-Id": str(a["id"])})
    assert r.status_code == 200
    # Mailbox B's search must NOT see A's contacts.
    rows = authed_client.get("/api/contacts", headers={"X-Mailbox-Id": str(b["id"])}).json()
    assert rows == []


# ---------------------------------------------------------------------------
# Auto-add from event
# ---------------------------------------------------------------------------


def test_contacts_from_event_writes_new_addresses(authed_client, fake_carddav):
    _add_mailbox(authed_client)
    r = authed_client.post(
        "/api/contacts/from-event",
        json={"attendees": [
            {"email": "kyle@example.org", "name": "Kyle Reese"},
            {"email": "milo@example.org"},
        ]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["added"] == 2
    assert body["skipped"] == 0
    assert body["errors"] == 0
    # The CardDAV PUT landed in the automaticallyCollected book.
    assert all(book == "automaticallyCollected" for book, _ in fake_carddav.put_calls)
    assert len(fake_carddav.put_calls) == 2
    # The local cache reflects the new rows.
    rows = authed_client.get("/api/contacts?q=kyle").json()
    assert any(r["primary_email"] == "kyle@example.org" for r in rows)


def test_contacts_from_event_skips_organizer_and_dupes(authed_client, fake_carddav):
    mb = _add_mailbox(authed_client, "me@example.com")
    # Pre-populate by syncing the default book.
    authed_client.post("/api/contacts/sync")
    r = authed_client.post(
        "/api/contacts/from-event",
        json={"attendees": [
            {"email": "me@example.com"},               # organizer, skip
            {"email": "sarah@skynet.example"},          # already in default book, skip
            {"email": "kyle@example.org"},              # new, add
            {"email": "kyle@example.org"},              # dup payload, dedup
        ]},
    )
    body = r.json()
    assert body["added"] == 1
    # 3 = organizer + already-known sarah + duplicate-in-payload kyle.
    assert body["skipped"] == 3
    assert body["errors"] == 0


def test_contacts_from_event_continues_on_put_failure(authed_client, fake_carddav, monkeypatch):
    _add_mailbox(authed_client)
    # First PUT raises; subsequent PUTs land normally.
    calls = {"n": 0}
    real_put = fake_carddav.put_card

    def flaky_put(creds, book, raw, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("PUT -> HTTP 500")
        return real_put(creds, book, raw, **kw)

    monkeypatch.setattr("calinvite_web.contacts.cdav.put_card", flaky_put)
    r = authed_client.post(
        "/api/contacts/from-event",
        json={"attendees": [
            {"email": "first@example.org"},
            {"email": "second@example.org"},
        ]},
    )
    body = r.json()
    assert body["added"] == 1
    assert body["errors"] == 1


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def test_contacts_unauth(client):
    assert client.get("/api/contacts").status_code == 401
    assert client.post("/api/contacts/sync").status_code == 401
    assert client.post("/api/contacts/from-event", json={"attendees": []}).status_code == 401


def test_contacts_needs_mailbox(authed_client):
    assert authed_client.get("/api/contacts").status_code == 412
