"""Per-user Purelymail mailboxes: connect, list, switch, fetch, delete.

A user can have multiple mailboxes. The frontend tells the backend which
one is active per request via the `X-Mailbox-Id` header. When absent, we
default to the user's first mailbox.

On connect we PROPFIND `https://purelymail.com/webdav/` with the supplied
credentials and parse the response to discover the account ID, so users
don't have to find it themselves.
"""
from __future__ import annotations

import base64
import re
import ssl
import urllib.error
import urllib.request
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from .auth import current_user
from .crypto import decrypt, encrypt
from .db import get_db
from .models import Mailbox, User


router = APIRouter(prefix="/api/me", tags=["mailbox"])


class MailboxConnectIn(BaseModel):
    email: EmailStr
    password: str
    display_name: Optional[str] = None


class MailboxUpdateIn(BaseModel):
    display_name: Optional[str] = None
    selected_calendar: Optional[str] = None
    color: Optional[str] = None


class MailboxOut(BaseModel):
    id: int
    email: str
    display_name: str
    account_id: str
    caldav_url: str
    selected_calendar: Optional[str] = None
    color: Optional[str] = None
    last_scanned_at: Optional[datetime] = None


def _discover_account_id(email: str, password: str) -> str:
    """PROPFIND /webdav/ to find the account directory the user can access."""
    auth = base64.b64encode(f"{email}:{password}".encode()).decode()
    req = urllib.request.Request("https://purelymail.com/webdav/", method="PROPFIND")
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Depth", "1")
    req.add_header("Content-Type", "application/xml")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            text = r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise HTTPException(status_code=400, detail="Purelymail rejected those credentials")
        raise HTTPException(status_code=502, detail=f"Purelymail error: HTTP {e.code}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"could not reach Purelymail: {e}")

    hrefs = re.findall(r"<href>([^<]+)</href>", text)
    for h in hrefs:
        m = re.search(r"/webdav/(\d+)/", h)
        if m:
            return m.group(1)
    raise HTTPException(status_code=400, detail="Could not discover Purelymail account ID. The credentials may be wrong or the account has no WebDAV space.")


_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _to_out(mb: Mailbox) -> MailboxOut:
    return MailboxOut(
        id=mb.id,
        email=mb.email,
        display_name=mb.display_name,
        account_id=mb.account_id,
        caldav_url=mb.caldav_url,
        selected_calendar=mb.selected_calendar,
        color=mb.color,
        last_scanned_at=mb.last_scanned_at,
    )


def current_mailbox(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    x_mailbox_id: Optional[str] = Header(default=None, alias="X-Mailbox-Id"),
) -> Mailbox:
    """Resolve the active mailbox for this request.

    Picks (in order):
      1. The mailbox whose id matches the X-Mailbox-Id header (if it belongs
         to the user).
      2. The user's first mailbox.

    Raises 412 when the user has no mailboxes connected (matches the prior
    single-mailbox behavior so the frontend can keep its onboarding gate).
    """
    if x_mailbox_id:
        try:
            mid = int(x_mailbox_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="X-Mailbox-Id must be an integer")
        mb = (
            db.query(Mailbox)
            .filter(Mailbox.id == mid, Mailbox.user_id == user.id)
            .one_or_none()
        )
        if mb is None:
            raise HTTPException(status_code=404, detail="mailbox not found")
        return mb
    if not user.mailboxes:
        raise HTTPException(status_code=412, detail="No mailbox connected. POST /api/me/mailboxes first.")
    return user.mailboxes[0]


# ---------------------------------------------------------------------------
# Plural endpoints (canonical going forward)
# ---------------------------------------------------------------------------


@router.get("/mailboxes", response_model=List[MailboxOut])
def list_mailboxes(user: User = Depends(current_user)):
    return [_to_out(mb) for mb in user.mailboxes]


@router.post("/mailboxes", response_model=MailboxOut)
def add_mailbox(
    body: MailboxConnectIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    email = body.email.lower().strip()
    password = body.password
    if not password:
        raise HTTPException(status_code=400, detail="password is required")

    # Reject duplicates by (user, email).
    existing = (
        db.query(Mailbox)
        .filter(Mailbox.user_id == user.id, Mailbox.email == email)
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="this mailbox is already connected")

    account_id = _discover_account_id(email, password)
    display = (body.display_name or "").strip() or email.split("@")[0]
    mb = Mailbox(
        user_id=user.id,
        email=email,
        display_name=display,
        account_id=account_id,
        encrypted_password=encrypt(password),
    )
    db.add(mb)
    if user.display_name is None:
        user.display_name = display
    db.commit()
    db.refresh(mb)
    return _to_out(mb)


@router.patch("/mailboxes/{mailbox_id}", response_model=MailboxOut)
def update_mailbox(
    mailbox_id: int,
    body: MailboxUpdateIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    mb = (
        db.query(Mailbox)
        .filter(Mailbox.id == mailbox_id, Mailbox.user_id == user.id)
        .one_or_none()
    )
    if mb is None:
        raise HTTPException(status_code=404, detail="mailbox not found")
    if body.display_name is not None:
        name = body.display_name.strip()
        if name:
            mb.display_name = name
    if body.selected_calendar is not None:
        mb.selected_calendar = body.selected_calendar.strip() or None
    if body.color is not None:
        candidate = body.color.strip()
        if candidate == "":
            mb.color = None
        elif _HEX_COLOR_RE.match(candidate):
            mb.color = candidate.lower()
        else:
            raise HTTPException(status_code=400, detail="color must be a #rrggbb hex string")
    db.commit()
    db.refresh(mb)
    return _to_out(mb)


@router.delete("/mailboxes/{mailbox_id}")
def delete_mailbox_by_id(
    mailbox_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    mb = (
        db.query(Mailbox)
        .filter(Mailbox.id == mailbox_id, Mailbox.user_id == user.id)
        .one_or_none()
    )
    if mb is None:
        return {"ok": True}
    db.delete(mb)
    db.commit()
    return {"ok": True}


@router.post("/mailboxes/{mailbox_id}/scan-complete", response_model=MailboxOut)
def mark_scan_complete(
    mailbox_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Update last_scanned_at = now for this mailbox. Called by the AI
    tasks scan modal after a successful run so that the next Fetch only
    needs to look at emails received after this point."""
    mb = (
        db.query(Mailbox)
        .filter(Mailbox.id == mailbox_id, Mailbox.user_id == user.id)
        .one_or_none()
    )
    if mb is None:
        raise HTTPException(status_code=404, detail="mailbox not found")
    mb.last_scanned_at = datetime.utcnow()
    db.commit()
    db.refresh(mb)
    return _to_out(mb)


# ---------------------------------------------------------------------------
# Singular endpoints (legacy: shipped clients still call these)
# ---------------------------------------------------------------------------


@router.get("/mailbox", response_model=Optional[MailboxOut])
def get_mailbox(user: User = Depends(current_user)):
    if not user.mailboxes:
        return None
    return _to_out(user.mailboxes[0])


@router.post("/mailbox", response_model=MailboxOut)
def connect_mailbox(
    body: MailboxConnectIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Legacy single-mailbox connect. Updates the first mailbox in place if
    present (preserves the old replace-on-reconnect behavior), otherwise
    adds the first one."""
    email = body.email.lower().strip()
    password = body.password
    if not password:
        raise HTTPException(status_code=400, detail="password is required")

    account_id = _discover_account_id(email, password)
    display = (body.display_name or "").strip() or email.split("@")[0]

    if not user.mailboxes:
        mb = Mailbox(
            user_id=user.id,
            email=email,
            display_name=display,
            account_id=account_id,
            encrypted_password=encrypt(password),
        )
        db.add(mb)
    else:
        mb = user.mailboxes[0]
        mb.email = email
        mb.display_name = display
        mb.account_id = account_id
        mb.encrypted_password = encrypt(password)
    if user.display_name is None:
        user.display_name = display
    db.commit()
    db.refresh(mb)
    return _to_out(mb)


@router.delete("/mailbox")
def delete_mailbox(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Legacy delete: removes the first mailbox."""
    if not user.mailboxes:
        return {"ok": True}
    db.delete(user.mailboxes[0])
    db.commit()
    return {"ok": True}


def mailbox_password(mb: Mailbox) -> str:
    """Decrypt a stored mailbox password (used by services)."""
    return decrypt(mb.encrypted_password)
