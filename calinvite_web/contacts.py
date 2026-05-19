"""Contacts endpoints, backed by Purelymail's CardDAV tree.

The source of truth is /webdav/{account}/carddav/ on Purelymail; this
module caches each mailbox's books in the local `contacts` table so the
attendee autocomplete can answer fast. PROPFIND-per-keystroke is not
viable. Reads come from the cache; writes (auto-add invitees) go to
CardDAV and then upsert locally so the next read sees the new row.

Endpoints:
  GET    /api/contacts?q=               -> search the cache
  POST   /api/contacts/sync             -> walk CardDAV, diff against the cache
  GET    /api/contacts/{id}             -> full record
  POST   /api/contacts/from-event       -> add invitees to automaticallyCollected
"""
from __future__ import annotations

import json
import uuid as _uuid
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from calinvite import carddav_client as cdav

from .auth import current_user
from .db import get_db
from .mailbox import current_mailbox, mailbox_password
from .models import Contact, Mailbox, User
from .schemas import (
    ContactAttendeeIn,
    ContactFromEventIn,
    ContactFromEventOut,
    ContactOut,
    ContactSyncOut,
)


router = APIRouter(tags=["contacts"])


# Throttle floor for POST /api/contacts/sync (matches the 5min freshness
# the frontend uses on the autocomplete cache).
SYNC_TTL_SECONDS = 5 * 60

# Where auto-collected invitees go. Hard-coded to Purelymail's name; if
# we add other CardDAV providers later we'll need to make this dynamic.
AUTO_COLLECT_BOOK = "automaticallyCollected"


def _utcnow() -> datetime:
    return datetime.utcnow()


def _creds_for(mb: Mailbox) -> cdav.CardDavCreds:
    return cdav.CardDavCreds(
        base_url=cdav.carddav_url_for(mb.account_id),
        username=mb.email,
        password=mailbox_password(mb),
    )


def _emails_to_json(emails: List[str]) -> str:
    return json.dumps([e for e in (emails or []) if e], ensure_ascii=False)


def _emails_from_json(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
    except Exception:
        return []
    return [str(x) for x in v if isinstance(x, (str,)) and x]


def _to_out(c: Contact) -> ContactOut:
    return ContactOut(
        id=c.id,
        mailbox_id=c.mailbox_id,
        vcard_uid=c.vcard_uid,
        full_name=c.full_name,
        primary_email=c.primary_email,
        emails=_emails_from_json(c.emails_json),
        org=c.org,
        source_book=c.source_book,
        last_synced_at=c.last_synced_at,
    )


# ---------------------------------------------------------------------------
# Sync engine
# ---------------------------------------------------------------------------


def _sync_one_mailbox(db: Session, mb: Mailbox, *, force: bool = False) -> ContactSyncOut:
    """Walk CardDAV for this mailbox; diff against the cache; upsert/delete.

    When `force=False` we short-circuit if the cache was refreshed within
    SYNC_TTL_SECONDS (5min). The frontend uses this throttle to make a
    sync-on-open call cheap to repeat across renders.
    """
    now = _utcnow()
    if (
        not force
        and mb.last_contacts_synced_at is not None
        and (now - mb.last_contacts_synced_at).total_seconds() < SYNC_TTL_SECONDS
    ):
        return ContactSyncOut(
            upserted=0,
            deleted=0,
            books=[],
            last_synced_at=mb.last_contacts_synced_at,
            throttled=True,
        )

    creds = _creds_for(mb)
    books = cdav.list_addressbooks(creds)
    if not books:
        # No books to walk — still stamp last_synced_at so we don't hammer
        # PROPFIND on every page load.
        mb.last_contacts_synced_at = now
        db.commit()
        return ContactSyncOut(upserted=0, deleted=0, books=[], last_synced_at=now)

    # Snapshot existing rows once so we can both diff and delete tombstones.
    existing_rows: List[Contact] = (
        db.query(Contact).filter(Contact.mailbox_id == mb.id).all()
    )
    by_uid = {c.vcard_uid: c for c in existing_rows}
    seen_uids: set[str] = set()

    upserted = 0
    for book in books:
        try:
            resources = cdav.list_card_resources(creds, book)
        except Exception as e:  # one bad book shouldn't kill the rest
            print(f"[contacts.sync] {mb.email}:{book} PROPFIND failed: {e}", flush=True)
            continue
        for res in resources:
            etag_target = res.etag
            # Pull the vCard. If we already have this UID with the same etag,
            # skip the GET entirely. The trick: we don't know the UID until
            # we've parsed the vCard, so for first-time rows we always GET.
            # Try to match by href to avoid round-trips on unchanged cards.
            matched_by_href = next(
                (c for c in existing_rows if c.href == res.href),
                None,
            )
            if (
                matched_by_href is not None
                and etag_target is not None
                and matched_by_href.etag == etag_target
            ):
                seen_uids.add(matched_by_href.vcard_uid)
                continue
            try:
                raw, etag_from_get = cdav.get_card(creds, res.href)
            except Exception as e:
                print(f"[contacts.sync] {mb.email}:{res.href} GET failed: {e}", flush=True)
                continue
            parsed = cdav.parse_vcard(raw)
            if parsed is None:
                continue
            etag = etag_target or etag_from_get or cdav.synth_etag(raw)
            uid = parsed.uid
            seen_uids.add(uid)
            row = by_uid.get(uid)
            if row is None:
                row = Contact(
                    user_id=mb.user_id,
                    mailbox_id=mb.id,
                    vcard_uid=uid,
                )
                db.add(row)
                by_uid[uid] = row
            row.etag = etag
            row.href = res.href
            row.full_name = parsed.full_name or (parsed.primary_email or "")
            row.primary_email = parsed.primary_email
            row.emails_json = _emails_to_json(parsed.emails)
            row.org = parsed.org
            row.source_book = book
            row.raw_vcard = parsed.raw_vcard
            row.last_synced_at = now
            upserted += 1

    # Delete cache rows whose server-side vCard disappeared.
    deleted = 0
    for c in existing_rows:
        if c.vcard_uid not in seen_uids:
            db.delete(c)
            deleted += 1

    mb.last_contacts_synced_at = now
    db.commit()
    return ContactSyncOut(
        upserted=upserted,
        deleted=deleted,
        books=books,
        last_synced_at=now,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/api/contacts", response_model=List[ContactOut])
def search_contacts(
    q: Optional[str] = Query(None, description="substring match across name + email"),
    limit: int = Query(50, ge=1, le=200),
    mailbox: Mailbox = Depends(current_mailbox),
    db: Session = Depends(get_db),
):
    """Cache-backed search for the attendee autocomplete.

    Empty `q` returns the most-recently synced contacts (acts as a
    "recent contacts" feed when the input has focus but no query).
    """
    query = db.query(Contact).filter(Contact.mailbox_id == mailbox.id)
    if q:
        needle = f"%{q.strip().lower()}%"
        query = query.filter(
            or_(
                Contact.full_name.ilike(needle),
                Contact.primary_email.ilike(needle),
                Contact.emails_json.ilike(needle),
                Contact.org.ilike(needle),
            )
        )
    rows = (
        query.order_by(Contact.full_name.asc(), Contact.id.desc())
        .limit(limit)
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("/api/contacts/sync", response_model=ContactSyncOut)
def sync_contacts(
    force: bool = Query(False),
    mailbox: Mailbox = Depends(current_mailbox),
    db: Session = Depends(get_db),
):
    """Walk CardDAV for the active mailbox and refresh the cache.

    Throttled to once per `SYNC_TTL_SECONDS` (5min) unless `force=true`.
    The frontend calls this on event-form open and periodically while
    the form is mounted; the throttle keeps repeated calls cheap.
    """
    try:
        return _sync_one_mailbox(db, mailbox, force=force)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"CardDAV error: {e}")


@router.get("/api/contacts/{contact_id}", response_model=ContactOut)
def get_contact(
    contact_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(Contact)
        .filter(Contact.id == contact_id, Contact.user_id == user.id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="contact not found")
    return _to_out(row)


@router.post("/api/contacts/from-event", response_model=ContactFromEventOut)
def contacts_from_event(
    body: ContactFromEventIn,
    mailbox: Mailbox = Depends(current_mailbox),
    db: Session = Depends(get_db),
):
    """Auto-add invitees to the `automaticallyCollected` address book.

    Mirrors Purelymail's webmail behavior: any address typed into an
    event invite that isn't already on file gets dropped into the auto-
    collect book. Best-effort — failures don't fail the parent event-
    create call (the route is invoked after the event is already on
    CalDAV). Returns counts so the client can surface a small toast.
    """
    if not body.attendees:
        return ContactFromEventOut(added=0, skipped=0, errors=0)

    organizer = (mailbox.email or "").lower().strip()
    total_inputs = len(body.attendees)

    # Dedupe within the payload, skip the organizer.
    targets: List[ContactAttendeeIn] = []
    seen = set()
    for a in body.attendees:
        email = (a.email or "").lower().strip()
        if not email or email == organizer or email in seen:
            continue
        seen.add(email)
        targets.append(a)

    # Skip emails we already have anywhere on this mailbox.
    existing_emails: set[str] = set()
    rows = (
        db.query(Contact.primary_email, Contact.emails_json)
        .filter(Contact.mailbox_id == mailbox.id)
        .all()
    )
    for pe, ej in rows:
        if pe:
            existing_emails.add(pe.lower().strip())
        for e in _emails_from_json(ej):
            existing_emails.add(e.lower().strip())

    new_attendees = [a for a in targets if (a.email.lower().strip()) not in existing_emails]
    # `skipped` covers anything we didn't add: the organizer, duplicates
    # within the payload, and addresses already in the cache.
    skipped_pre_put = total_inputs - len(new_attendees)
    if not new_attendees:
        return ContactFromEventOut(added=0, skipped=skipped_pre_put, errors=0)

    creds = _creds_for(mailbox)
    added = 0
    errors = 0
    now = _utcnow()
    for a in new_attendees:
        email = a.email.strip()
        name = (a.name or "").strip() or email.split("@")[0]
        uid = f"calinvite-auto-{_uuid.uuid4().hex}"
        raw = cdav.compose_vcard(uid, name, email)
        try:
            href, etag = cdav.put_card(creds, AUTO_COLLECT_BOOK, raw)
        except Exception as e:
            print(f"[contacts.from_event] PUT failed for {email}: {e}", flush=True)
            errors += 1
            continue
        row = Contact(
            user_id=mailbox.user_id,
            mailbox_id=mailbox.id,
            vcard_uid=uid,
            etag=etag or cdav.synth_etag(raw),
            href=href,
            full_name=name,
            primary_email=email.lower(),
            emails_json=_emails_to_json([email.lower()]),
            org=None,
            source_book=AUTO_COLLECT_BOOK,
            raw_vcard=raw,
            last_synced_at=now,
        )
        db.add(row)
        added += 1
    db.commit()
    return ContactFromEventOut(added=added, skipped=skipped_pre_put, errors=errors)
