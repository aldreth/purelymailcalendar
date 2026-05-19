"""Pytest fixtures for calinvite_web smoke tests.

Sets up a fresh SQLite DB per pytest session, stubs every outbound network
call (Purelymail account discovery, CalDAV, magic-link mailer), and provides
an authenticated TestClient with a pre-baked user + session row.

Env vars are set at module import time on purpose: `calinvite_web.db`
constructs its engine the first time it's imported, so we have to fix
DATABASE_URL / FERNET_KEY BEFORE any test file imports the app.
"""
from __future__ import annotations

import os
import secrets
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

# IMPORTANT: env setup before importing calinvite_web.
_TEST_DIR = Path(tempfile.mkdtemp(prefix="pmc-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DIR / 'test.db'}"
os.environ["FERNET_KEY"] = "73PvPcXrIRhWW1CwZ8vLKVar3INOaoUL2cO31qSc3yw="
os.environ["BASE_URL"] = "http://testserver"
os.environ["SESSION_TTL_DAYS"] = "30"

import pytest
from fastapi.testclient import TestClient

from calinvite_web import app as app_module
from calinvite_web.db import Base, SessionLocal, engine
from calinvite_web.models import User, UserSession
from calinvite_web.schemas import EventOut


# ---------------------------------------------------------------------------
# Helpers exposed to tests
# ---------------------------------------------------------------------------


def make_event_out(
    uid: str,
    summary: str = "Test event",
    start: datetime | None = None,
    end: datetime | None = None,
) -> EventOut:
    s = start or datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)
    e = end or (s + timedelta(hours=1))
    return EventOut(
        uid=uid,
        summary=summary,
        start=s,
        end=e,
        tz="UTC",
        location="",
        description="",
        sequence=0,
        reminders=[],
        organizer=None,
        attendees=[],
        recurrence=None,
        occurrence_id=uid,
        master_uid=uid,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    """Build the test DB schema once per pytest session."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _reset_db():
    """Truncate every table between tests so cases stay isolated. SQLite
    doesn't support TRUNCATE so we issue DELETEs in reverse-FK order."""
    yield
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.exec_driver_sql(f"DELETE FROM {table.name}")


@pytest.fixture
def stub_externals(monkeypatch):
    """Patch every outbound network call the routes might trigger. Tests
    that want different return values can override individual attrs after
    requesting this fixture."""
    monkeypatch.setattr(
        "calinvite_web.mailbox._discover_account_id",
        lambda email, password: "999999",
    )
    monkeypatch.setattr(
        "calinvite_web.services.list_calendar_names",
        lambda creds: ["Default", "Work"],
    )
    # The singular `/api/calendars` route goes through `list_calendars`
    # (the actual CalDAV-touching function) rather than the
    # `list_calendar_names` alias used by the fan-out. Stub both so a test
    # hitting either path stays offline.
    monkeypatch.setattr(
        "calinvite_web.services.list_calendars",
        lambda creds: ["Default", "Work"],
    )
    monkeypatch.setattr(
        "calinvite_web.services.list_events_all_calendars",
        lambda creds, days, start_override=None, end_override=None: [
            ("Default", make_event_out(f"evt-{creds.email}-1", summary="Standup")),
        ],
    )
    # Auth flow: silence the transactional mailer.
    monkeypatch.setattr(
        "calinvite_web.mailer_transactional.send_magic_link",
        lambda *a, **kw: None,
    )
    # AI-tasks: stub IMAP listing so /api/inbox/recent works offline.
    from calinvite.inbound_invites import InboxMessage as _IM

    def _fake_inbox(creds, since_days=14, limit=50):
        return [
            _IM(
                message_uid="msg-1@example.com",
                subject="Project kickoff",
                from_="boss@example.com",
                date=datetime(2026, 5, 17, 9, 0),
                body_text="Hey team, please send your updates by Friday.",
                truncated=False,
            ),
            _IM(
                message_uid="msg-2@example.com",
                subject="Lunch?",
                from_="friend@example.com",
                date=datetime(2026, 5, 18, 12, 0),
                body_text="Free Thursday?",
                truncated=False,
            ),
        ]

    monkeypatch.setattr("calinvite_web.services.list_recent_inbox", _fake_inbox)
    return monkeypatch


@pytest.fixture
def client(stub_externals):
    """Bare TestClient with no session cookie. Use this for unauth checks
    and for the magic-link login path."""
    with TestClient(app_module.app) as c:
        yield c


@pytest.fixture
def user(stub_externals):
    """Create a fresh user row and return its model. Each test gets a new
    user because `_reset_db` wipes between tests."""
    with SessionLocal() as db:
        u = User(email="test@example.com", display_name="Test User")
        db.add(u)
        db.commit()
        db.refresh(u)
        return u


@pytest.fixture
def authed_client(stub_externals, user):
    """TestClient with a valid session cookie for `user`."""
    session_id = secrets.token_urlsafe(32)
    with SessionLocal() as db:
        s = UserSession(
            id=session_id,
            user_id=user.id,
            expires_at=datetime.utcnow() + timedelta(days=30),
        )
        db.add(s)
        db.commit()
    with TestClient(app_module.app) as c:
        c.cookies.set("calinvite_session", session_id)
        yield c
