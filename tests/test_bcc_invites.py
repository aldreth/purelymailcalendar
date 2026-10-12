"""BCC invites: one private message per guest, full list kept on CalDAV."""
from __future__ import annotations

from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo

from icalendar import Calendar
from icalendar import Calendar as ICalendar
from icalendar import Event, vCalAddress, vText

from calinvite.ics import Alarm, Attendee, EventSpec, build_request, ics_for_recipient
from calinvite_web.schemas import AttendeeIn, EventIn, ReminderIn
from calinvite_web.services import MailboxCreds, _send_invite, create_event, serialize_vevent


def _creds() -> MailboxCreds:
    return MailboxCreds(
        email="host@example.com",
        password="secret",
        display_name="Host",
        caldav_url="https://caldav.example/cal",
        smtp_host="smtp.example",
        smtp_port=465,
        imap_host="imap.example",
        imap_port=993,
    )


def _event(*, bcc: bool) -> EventIn:
    return EventIn(
        summary="Town hall",
        start="2026-06-01T10:00",
        duration_minutes=60,
        tz="UTC",
        attendees=[
            AttendeeIn(email="ada@example.com", name="Ada"),
            AttendeeIn(email="grace@example.com", name="Grace"),
        ],
        reminders=[
            ReminderIn(
                action="EMAIL",
                minutes_before=15,
                recipients=["ada@example.com", "grace@example.com"],
            )
        ],
        bcc_invites=bcc,
    )


def _patch_transport(monkeypatch):
    stored: dict = {}
    sent: list = []

    class _Cal:
        name = "Default"

    monkeypatch.setattr("calinvite_web.services.cdav.connect", lambda *a, **k: object())
    monkeypatch.setattr("calinvite_web.services.cdav.get_calendar", lambda client, name: _Cal())
    monkeypatch.setattr(
        "calinvite_web.services.cdav.put_event",
        lambda calendar, ics: stored.__setitem__("ics", ics),
    )
    monkeypatch.setattr(
        "calinvite_web.services.mailer.send",
        lambda **kwargs: sent.append(kwargs),
    )
    return stored, sent


def _calendar_text(msg: EmailMessage) -> str:
    chunks = []
    for part in msg.walk():
        if part.get_content_type() in ("text/calendar", "application/ics"):
            payload = part.get_payload(decode=True)
            if payload:
                chunks.append(payload.decode("utf-8", errors="replace"))
    return "\n".join(chunks)


def _attendee_emails(ics: bytes) -> set[str]:
    cal = ICalendar.from_ical(ics)
    found = set()
    for comp in cal.walk("VEVENT"):
        raw = comp.get("attendee")
        items = [] if raw is None else (raw if isinstance(raw, list) else [raw])
        for item in items:
            email = str(item)
            if email.lower().startswith("mailto:"):
                email = email[7:]
            found.add(email.lower())
    return found


def test_shared_invite_sends_one_message(monkeypatch):
    stored, sent = _patch_transport(monkeypatch)
    result = create_event(_creds(), _event(bcc=False))

    assert result.sent_to == ["ada@example.com", "grace@example.com"]
    assert len(sent) == 1
    msg = sent[0]["msg"]
    assert "ada@example.com" in msg["To"]
    assert "grace@example.com" in msg["To"]
    body = _calendar_text(msg)
    assert "ada@example.com" in body
    assert "grace@example.com" in body

    stored_ics = stored["ics"]
    assert _attendee_emails(stored_ics) >= {"ada@example.com", "grace@example.com", "host@example.com"}
    assert b"X-CALINVITE-BCC" not in stored_ics
    vevent = ICalendar.from_ical(stored_ics).walk("VEVENT")[0]
    assert serialize_vevent(vevent).bcc_invites is False


def test_bcc_invite_sends_one_private_message_per_guest(monkeypatch):
    stored, sent = _patch_transport(monkeypatch)
    result = create_event(_creds(), _event(bcc=True))

    assert result.sent_to == ["ada@example.com", "grace@example.com"]
    assert len(sent) == 2

    by_to = {item["msg"]["To"]: item for item in sent}
    assert set(by_to) == {"ada@example.com", "grace@example.com"}

    ada = _calendar_text(by_to["ada@example.com"]["msg"])
    grace = _calendar_text(by_to["grace@example.com"]["msg"])
    assert "ada@example.com" in ada
    assert "grace@example.com" not in ada
    assert "grace@example.com" in grace
    assert "ada@example.com" not in grace
    assert sent[0]["to_addrs"] == ["ada@example.com"]
    assert sent[1]["to_addrs"] == ["grace@example.com"]

    stored_ics = stored["ics"]
    assert _attendee_emails(stored_ics) >= {"ada@example.com", "grace@example.com", "host@example.com"}
    assert b"X-CALINVITE-BCC" in stored_ics
    vevent = ICalendar.from_ical(stored_ics).walk("VEVENT")[0]
    assert serialize_vevent(vevent).bcc_invites is True


def test_personal_cancel_keeps_recurrence_id(monkeypatch):
    sent: list = []
    monkeypatch.setattr(
        "calinvite_web.services.mailer.send",
        lambda **kwargs: sent.append(kwargs),
    )
    start = datetime(2026, 6, 1, 10, 0, tzinfo=ZoneInfo("UTC"))
    spec = EventSpec(
        summary="Town hall",
        start=start,
        end=datetime(2026, 6, 1, 11, 0, tzinfo=ZoneInfo("UTC")),
        organizer_email="host@example.com",
        organizer_name="Host",
        attendees=[
            Attendee(email="ada@example.com", name="Ada"),
            Attendee(email="grace@example.com", name="Grace"),
        ],
        tz="UTC",
        uid="series@calinvite",
        bcc_invites=True,
    )
    cal = Calendar()
    cal.add("prodid", "-//calinvite//test//EN")
    cal.add("version", "2.0")
    cal.add("method", "CANCEL")
    ev = Event()
    ev.add("uid", spec.uid)
    ev.add("dtstart", start)
    ev.add("dtend", spec.end)
    ev.add("summary", spec.summary)
    ev.add("recurrence-id", start)
    for email in ("ada@example.com", "grace@example.com"):
        addr = vCalAddress(f"mailto:{email}")
        addr.params["CN"] = vText(email)
        ev.add("attendee", addr, encode=0)
    cal.add_component(ev)

    sent_to = _send_invite(
        _creds(),
        spec,
        "cancelled",
        cal.to_ical(),
        method="CANCEL",
        bcc_invites=True,
    )
    assert sent_to == ["ada@example.com", "grace@example.com"]
    assert len(sent) == 2
    for item in sent:
        text = _calendar_text(item["msg"])
        assert "RECURRENCE-ID" in text
        other = "grace@example.com" if item["to_addrs"] == ["ada@example.com"] else "ada@example.com"
        assert other not in text
        assert item["to_addrs"][0] in text


def test_ics_for_recipient_drops_other_email_alarm_recipients():
    start = datetime(2026, 6, 1, 10, 0, tzinfo=ZoneInfo("UTC"))
    spec = EventSpec(
        summary="Town hall",
        start=start,
        end=datetime(2026, 6, 1, 11, 0, tzinfo=ZoneInfo("UTC")),
        organizer_email="host@example.com",
        organizer_name="Host",
        attendees=[
            Attendee(email="host@example.com", name="Host", partstat="ACCEPTED", rsvp=False),
            Attendee(email="ada@example.com", name="Ada"),
            Attendee(email="grace@example.com", name="Grace"),
        ],
        alarms=[
            Alarm(action="DISPLAY", minutes_before=10, description="Popup"),
            Alarm(
                action="EMAIL",
                minutes_before=15,
                description="Email",
                recipients=["ada@example.com", "grace@example.com"],
            ),
        ],
        tz="UTC",
        uid="town-hall@calinvite",
        bcc_invites=True,
    )
    full, _ = build_request(spec)
    personal = ics_for_recipient(full, "ada@example.com", "host@example.com")
    text = personal.decode("utf-8", errors="replace")
    assert "ada@example.com" in text
    assert "host@example.com" in text
    assert "grace@example.com" not in text
    assert "DISPLAY" in text
    assert b"X-CALINVITE-BCC" in full
