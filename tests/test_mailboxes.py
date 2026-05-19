"""Smoke tests for the multi-mailbox endpoints.

Covers /api/me/mailboxes CRUD and the X-Mailbox-Id header resolution that
the per-mailbox /api/* routes depend on.
"""
from __future__ import annotations


def test_list_mailboxes_empty_for_new_user(authed_client):
    r = authed_client.get("/api/me/mailboxes")
    assert r.status_code == 200
    assert r.json() == []


def test_add_mailbox_persists_and_lists(authed_client):
    r = authed_client.post(
        "/api/me/mailboxes",
        json={"email": "work@example.com", "password": "hunter2", "display_name": "Work"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "work@example.com"
    assert body["display_name"] == "Work"
    assert body["account_id"] == "999999"  # from stub_externals
    assert body["selected_calendar"] is None
    assert body["color"] is None
    assert isinstance(body["id"], int)

    r2 = authed_client.get("/api/me/mailboxes")
    assert r2.status_code == 200
    assert len(r2.json()) == 1


def test_add_mailbox_rejects_duplicate(authed_client):
    payload = {"email": "dup@example.com", "password": "p", "display_name": "Dup"}
    r1 = authed_client.post("/api/me/mailboxes", json=payload)
    assert r1.status_code == 200
    r2 = authed_client.post("/api/me/mailboxes", json=payload)
    assert r2.status_code == 409


def test_add_multiple_mailboxes(authed_client):
    for i in range(3):
        r = authed_client.post(
            "/api/me/mailboxes",
            json={"email": f"box{i}@example.com", "password": "p", "display_name": f"Box {i}"},
        )
        assert r.status_code == 200
    r = authed_client.get("/api/me/mailboxes")
    assert r.status_code == 200
    assert len(r.json()) == 3


def test_patch_mailbox_updates_color_and_calendar(authed_client):
    add = authed_client.post(
        "/api/me/mailboxes",
        json={"email": "patch@example.com", "password": "p"},
    )
    mid = add.json()["id"]
    r = authed_client.patch(
        f"/api/me/mailboxes/{mid}",
        json={"color": "#0d9488", "selected_calendar": "Work"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["color"] == "#0d9488"
    assert body["selected_calendar"] == "Work"


def test_patch_mailbox_rejects_bad_color(authed_client):
    add = authed_client.post(
        "/api/me/mailboxes",
        json={"email": "color@example.com", "password": "p"},
    )
    mid = add.json()["id"]
    r = authed_client.patch(f"/api/me/mailboxes/{mid}", json={"color": "blue"})
    assert r.status_code == 400


def test_patch_mailbox_clears_color_on_empty_string(authed_client):
    add = authed_client.post("/api/me/mailboxes", json={"email": "c2@example.com", "password": "p"})
    mid = add.json()["id"]
    authed_client.patch(f"/api/me/mailboxes/{mid}", json={"color": "#e11d48"})
    r = authed_client.patch(f"/api/me/mailboxes/{mid}", json={"color": ""})
    assert r.status_code == 200
    assert r.json()["color"] is None


def test_delete_mailbox(authed_client):
    add = authed_client.post("/api/me/mailboxes", json={"email": "del@example.com", "password": "p"})
    mid = add.json()["id"]
    r = authed_client.delete(f"/api/me/mailboxes/{mid}")
    assert r.status_code == 200
    assert authed_client.get("/api/me/mailboxes").json() == []


def test_xmailboxid_resolves_to_named_mailbox(authed_client):
    a = authed_client.post("/api/me/mailboxes", json={"email": "a@example.com", "password": "p"}).json()
    b = authed_client.post("/api/me/mailboxes", json={"email": "b@example.com", "password": "p"}).json()

    # No header: server falls back to first mailbox -> list_calendar_names("Default", "Work")
    r1 = authed_client.get("/api/calendars")
    assert r1.status_code == 200
    assert {c["name"] for c in r1.json()} == {"Default", "Work"}

    # Header pointing to b: still hits the stubbed list_calendar_names, but
    # validates the resolver finds the second mailbox without 404ing.
    r2 = authed_client.get("/api/calendars", headers={"X-Mailbox-Id": str(b["id"])})
    assert r2.status_code == 200

    # Header pointing to a mailbox we don't own should 404.
    r3 = authed_client.get("/api/calendars", headers={"X-Mailbox-Id": "999999"})
    assert r3.status_code == 404


def test_xmailboxid_rejects_non_integer(authed_client):
    authed_client.post("/api/me/mailboxes", json={"email": "a@example.com", "password": "p"})
    r = authed_client.get("/api/calendars", headers={"X-Mailbox-Id": "not-a-number"})
    assert r.status_code == 400


def test_no_mailbox_412_on_data_route(authed_client):
    """A user with zero mailboxes hitting /api/calendars gets 412 (the
    onboarding gate the frontend relies on)."""
    r = authed_client.get("/api/calendars")
    assert r.status_code == 412


def test_mailboxes_unauth(client):
    """No session cookie -> 401."""
    r = client.get("/api/me/mailboxes")
    assert r.status_code == 401
