"""Smoke tests for /api/inbox/recent and /api/tasks (feat/ai-tasks 2.5a)."""
from __future__ import annotations

from datetime import datetime, timedelta


def _add_mailbox(client, email="a@example.com"):
    r = client.post("/api/me/mailboxes", json={"email": email, "password": "p", "display_name": email.split("@")[0]})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# /api/inbox/recent
# ---------------------------------------------------------------------------


def test_inbox_recent_returns_stubbed_messages(authed_client):
    _add_mailbox(authed_client)
    r = authed_client.get("/api/inbox/recent?days=14&limit=50")
    assert r.status_code == 200, r.text
    msgs = r.json()
    assert len(msgs) == 2
    assert msgs[0]["message_uid"] == "msg-1@example.com"
    # `from` is a Python keyword so the field uses an alias on the wire.
    assert msgs[0]["from"] == "boss@example.com"
    assert msgs[0]["subject"] == "Project kickoff"
    assert "Friday" in msgs[0]["body_text"]
    assert msgs[0]["truncated"] is False


def test_inbox_recent_needs_mailbox(authed_client):
    r = authed_client.get("/api/inbox/recent")
    assert r.status_code == 412  # current_mailbox raises when there are none


def test_inbox_recent_unauth(client):
    r = client.get("/api/inbox/recent")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# /api/tasks
# ---------------------------------------------------------------------------


def _bulk_payload(mailbox_id):
    return [
        {
            "mailbox_id": mailbox_id,
            "message_uid": "msg-1@example.com",
            "task_index": 0,
            "title": "Send updates by Friday",
            "due_at": "2026-05-22T17:00:00",
            "owner_email": "me@example.com",
            "source_subject": "Project kickoff",
            "source_from": "boss@example.com",
            "source_date": "2026-05-17T09:00:00",
        },
        {
            "mailbox_id": mailbox_id,
            "message_uid": "msg-1@example.com",
            "task_index": 1,
            "title": "Reply with availability",
            "source_subject": "Project kickoff",
            "source_from": "boss@example.com",
        },
    ]


def test_tasks_bulk_upsert_inserts(authed_client):
    mb = _add_mailbox(authed_client)
    r = authed_client.post("/api/tasks/bulk", json=_bulk_payload(mb["id"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["written"] == 2
    assert {it["task_index"] for it in body["items"]} == {0, 1}


def test_tasks_list_excludes_done_and_snoozed_by_default(authed_client):
    mb = _add_mailbox(authed_client)
    inserted = authed_client.post("/api/tasks/bulk", json=_bulk_payload(mb["id"])).json()["items"]
    a, b = inserted[0]["id"], inserted[1]["id"]
    # Mark one done.
    authed_client.patch(f"/api/tasks/{a}", json={"done": True})
    # Snooze the other for 3 days.
    future = (datetime.utcnow() + timedelta(days=3)).isoformat()
    authed_client.patch(f"/api/tasks/{b}", json={"snoozed_until": future})

    r = authed_client.get("/api/tasks")
    assert r.status_code == 200
    assert r.json() == []  # both filtered out by default

    r2 = authed_client.get("/api/tasks?include_done=true&include_snoozed=true")
    assert {it["id"] for it in r2.json()} == {a, b}


def test_tasks_bulk_upsert_is_idempotent_and_preserves_user_state(authed_client):
    mb = _add_mailbox(authed_client)
    first = authed_client.post("/api/tasks/bulk", json=_bulk_payload(mb["id"])).json()["items"]
    tid = first[0]["id"]
    # User marks the task done.
    authed_client.patch(f"/api/tasks/{tid}", json={"done": True})

    # Second extraction: same key, slightly different title. The row should
    # be updated in place and the user's done_at must survive.
    payload = _bulk_payload(mb["id"])
    payload[0]["title"] = "Send updates by EOD Friday"
    again = authed_client.post("/api/tasks/bulk", json=payload).json()
    assert again["written"] == 2

    # Read it back with include_done so we can confirm the same id + done_at.
    rows = authed_client.get("/api/tasks?include_done=true").json()
    same = next(r for r in rows if r["id"] == tid)
    assert same["title"] == "Send updates by EOD Friday"
    assert same["done_at"] is not None


def test_tasks_bulk_rejects_foreign_mailbox(authed_client):
    _add_mailbox(authed_client)
    payload = _bulk_payload(999999)  # not owned by this user
    r = authed_client.post("/api/tasks/bulk", json=payload)
    assert r.status_code == 404


def test_tasks_patch_as_event_uid_marks_converted(authed_client):
    mb = _add_mailbox(authed_client)
    tid = authed_client.post("/api/tasks/bulk", json=_bulk_payload(mb["id"])).json()["items"][0]["id"]
    r = authed_client.patch(f"/api/tasks/{tid}", json={"as_event_uid": "abc-123-event"})
    assert r.status_code == 200
    assert r.json()["as_event_uid"] == "abc-123-event"


def test_tasks_delete(authed_client):
    mb = _add_mailbox(authed_client)
    tid = authed_client.post("/api/tasks/bulk", json=_bulk_payload(mb["id"])).json()["items"][0]["id"]
    r = authed_client.delete(f"/api/tasks/{tid}")
    assert r.status_code == 200
    # Even with include_done, the row is gone.
    rows = authed_client.get("/api/tasks?include_done=true").json()
    assert all(r["id"] != tid for r in rows)


def test_tasks_filter_by_mailbox_id(authed_client):
    a = _add_mailbox(authed_client, "a@example.com")
    b = _add_mailbox(authed_client, "b@example.com")
    authed_client.post("/api/tasks/bulk", json=_bulk_payload(a["id"]))
    authed_client.post("/api/tasks/bulk", json=_bulk_payload(b["id"]))
    rows = authed_client.get(f"/api/tasks?mailbox_id={a['id']}").json()
    assert {r["mailbox_id"] for r in rows} == {a["id"]}


def test_tasks_unauth(client):
    assert client.get("/api/tasks").status_code == 401
    assert client.post("/api/tasks/bulk", json=[]).status_code == 401
