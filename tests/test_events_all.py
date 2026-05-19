"""Smoke tests for the All-accounts overlay fan-out endpoints."""
from __future__ import annotations

from datetime import datetime, timezone

from tests.conftest import make_event_out


def _add_two_mailboxes(client):
    a = client.post("/api/me/mailboxes", json={"email": "a@example.com", "password": "p", "display_name": "A"}).json()
    b = client.post("/api/me/mailboxes", json={"email": "b@example.com", "password": "p", "display_name": "B"}).json()
    return a, b


def test_calendars_all_returns_per_mailbox_rows(authed_client, stub_externals):
    a, b = _add_two_mailboxes(authed_client)
    stub_externals.setattr(
        "calinvite_web.services.list_calendar_names",
        lambda creds: ["Default", "Work"] if creds.email == "a@example.com" else ["Personal"],
    )
    r = authed_client.get("/api/calendars/all")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["partial_failures"] == []
    by_mailbox: dict[int, list[str]] = {}
    for row in body["calendars"]:
        by_mailbox.setdefault(row["mailbox_id"], []).append(row["name"])
    assert sorted(by_mailbox[a["id"]]) == ["Default", "Work"]
    assert by_mailbox[b["id"]] == ["Personal"]


def test_calendars_all_isolates_partial_failures(authed_client, stub_externals):
    a, b = _add_two_mailboxes(authed_client)

    def flaky(creds):
        if creds.email == "b@example.com":
            raise RuntimeError("CalDAV 500")
        return ["Default"]

    stub_externals.setattr("calinvite_web.services.list_calendar_names", flaky)
    r = authed_client.get("/api/calendars/all")
    assert r.status_code == 200
    body = r.json()
    # The healthy mailbox's calendar still shows up.
    assert [c["mailbox_id"] for c in body["calendars"]] == [a["id"]]
    # The broken one surfaces in partial_failures with its email tagged.
    assert len(body["partial_failures"]) == 1
    assert body["partial_failures"][0]["mailbox_email"] == "b@example.com"
    assert "CalDAV 500" in body["partial_failures"][0]["error"]


def test_calendars_all_empty_when_no_mailboxes(authed_client):
    r = authed_client.get("/api/calendars/all")
    assert r.status_code == 200
    assert r.json() == {"calendars": [], "partial_failures": []}


def test_events_all_merges_and_tags(authed_client, stub_externals):
    a, b = _add_two_mailboxes(authed_client)

    def events_per_mailbox(creds, days, start_override=None, end_override=None):
        when = datetime(2026, 6, 1, 9 if creds.email == "a@example.com" else 14, 0, tzinfo=timezone.utc)
        return [("Default", make_event_out(f"u-{creds.email}", "Hi", start=when))]

    stub_externals.setattr("calinvite_web.services.list_events_all_calendars", events_per_mailbox)
    r = authed_client.get("/api/events/all?days=30")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["partial_failures"] == []
    assert len(body["events"]) == 2
    # Events are sorted by start; the 9am one (from `a`) lands first.
    assert body["events"][0]["mailbox_email"] == "a@example.com"
    assert body["events"][1]["mailbox_email"] == "b@example.com"
    # Each event is tagged with its source mailbox.
    for ev in body["events"]:
        assert ev["mailbox_id"] in (a["id"], b["id"])
        assert ev["mailbox_display_name"] in ("A", "B")
        assert ev["calendar_name"] == "Default"


def test_events_all_isolates_partial_failures(authed_client, stub_externals):
    a, b = _add_two_mailboxes(authed_client)

    def flaky(creds, days, start_override=None, end_override=None):
        if creds.email == "a@example.com":
            raise RuntimeError("PROPFIND boom")
        return [("Default", make_event_out("b-1", start=datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)))]

    stub_externals.setattr("calinvite_web.services.list_events_all_calendars", flaky)
    r = authed_client.get("/api/events/all")
    assert r.status_code == 200
    body = r.json()
    assert len(body["events"]) == 1
    assert body["events"][0]["mailbox_id"] == b["id"]
    assert len(body["partial_failures"]) == 1
    assert body["partial_failures"][0]["mailbox_email"] == "a@example.com"


def test_events_all_validates_range(authed_client, stub_externals):
    _add_two_mailboxes(authed_client)
    r = authed_client.get("/api/events/all?start=2026-06-02T00:00:00Z&end=2026-06-01T00:00:00Z")
    assert r.status_code == 400


def test_events_all_unauth(client):
    r = client.get("/api/events/all")
    assert r.status_code == 401
