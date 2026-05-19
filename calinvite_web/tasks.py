"""AI-tasks endpoints.

The browser pulls recent emails via /api/inbox/recent, runs a local LLM
(Gemini Nano via Chrome's Built-in AI) to extract action items, and POSTs
the structured results back through /api/tasks/bulk. Email bodies stay on
the user's device; the server only sees the extracted task fields.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from . import services
from .auth import current_user
from .db import get_db
from .mailbox import current_mailbox
from .models import Mailbox, TaskItem, User
from .schemas import (
    InboxMessageOut,
    TaskBulkUpsertOut,
    TaskItemIn,
    TaskItemOut,
    TaskItemPatchIn,
)


router = APIRouter(tags=["tasks"])


def _utcnow() -> datetime:
    return datetime.utcnow()


def _to_out(t: TaskItem) -> TaskItemOut:
    return TaskItemOut(
        id=t.id,
        mailbox_id=t.mailbox_id,
        message_uid=t.message_uid,
        task_index=t.task_index,
        title=t.title,
        due_at=t.due_at,
        owner_email=t.owner_email,
        source_subject=t.source_subject,
        source_from=t.source_from,
        source_date=t.source_date,
        done_at=t.done_at,
        snoozed_until=t.snoozed_until,
        as_event_uid=t.as_event_uid,
        created_at=t.created_at,
        extracted_at=t.extracted_at,
    )


# ---------------------------------------------------------------------------
# Inbox surface (read-only)
# ---------------------------------------------------------------------------


@router.get("/api/inbox/recent", response_model=List[InboxMessageOut])
def get_recent_inbox(
    since_days: int = Query(14, ge=1, le=60),
    limit: int = Query(50, ge=1, le=200),
    mailbox: Mailbox = Depends(current_mailbox),
):
    """Return the most recent emails (read-only — does NOT mark them seen).

    Bodies are trimmed server-side to ~8KB so a downstream LLM prompt
    stays bounded. Each row also carries a `truncated` flag so the client
    can tell the user when it's working with a partial body.
    """
    creds = services.creds_for(mailbox)
    try:
        msgs = services.list_recent_inbox(creds, since_days=since_days, limit=limit)
    except (RuntimeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"IMAP error: {e}")
    return [
        InboxMessageOut(
            message_uid=m.message_uid,
            subject=m.subject,
            **{"from": m.from_},
            date=m.date,
            body_text=m.body_text,
            truncated=m.truncated,
        )
        for m in msgs
    ]


# ---------------------------------------------------------------------------
# Tasks CRUD
# ---------------------------------------------------------------------------


@router.get("/api/tasks", response_model=List[TaskItemOut])
def list_tasks(
    include_done: bool = Query(False),
    include_snoozed: bool = Query(False),
    mailbox_id: Optional[int] = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    q = db.query(TaskItem).filter(TaskItem.user_id == user.id)
    if not include_done:
        q = q.filter(TaskItem.done_at.is_(None))
    if not include_snoozed:
        now = _utcnow()
        q = q.filter(
            (TaskItem.snoozed_until.is_(None)) | (TaskItem.snoozed_until <= now)
        )
    if mailbox_id is not None:
        q = q.filter(TaskItem.mailbox_id == mailbox_id)
    rows = q.order_by(TaskItem.due_at.is_(None), TaskItem.due_at.asc(), TaskItem.created_at.desc()).all()
    return [_to_out(r) for r in rows]


@router.post("/api/tasks/bulk", response_model=TaskBulkUpsertOut)
def upsert_tasks(
    items: List[TaskItemIn],
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Upsert one batch of LLM-extracted tasks.

    Idempotent on (user, mailbox, message, task_index). A second extraction
    of the same email overwrites title/due/owner/source fields in place but
    deliberately preserves user-managed state (done_at, snoozed_until,
    as_event_uid) so re-scanning never undoes a user's actions.
    """
    if not items:
        return TaskBulkUpsertOut(written=0, items=[])

    # Verify every referenced mailbox belongs to this user up front; reject
    # the whole batch rather than partially writing a tampered payload.
    mailbox_ids = {it.mailbox_id for it in items}
    owned = {
        m.id
        for m in db.query(Mailbox).filter(
            Mailbox.user_id == user.id, Mailbox.id.in_(mailbox_ids)
        ).all()
    }
    foreign = mailbox_ids - owned
    if foreign:
        raise HTTPException(status_code=404, detail=f"mailbox(es) not found: {sorted(foreign)}")

    now = _utcnow()
    keys = [(it.mailbox_id, it.message_uid, it.task_index) for it in items]
    existing = {
        (t.mailbox_id, t.message_uid, t.task_index): t
        for t in db.query(TaskItem).filter(
            TaskItem.user_id == user.id,
            TaskItem.mailbox_id.in_(mailbox_ids),
            TaskItem.message_uid.in_({k[1] for k in keys}),
        ).all()
    }

    written: List[TaskItem] = []
    for it in items:
        key = (it.mailbox_id, it.message_uid, it.task_index)
        row = existing.get(key)
        if row is None:
            row = TaskItem(
                user_id=user.id,
                mailbox_id=it.mailbox_id,
                message_uid=it.message_uid,
                task_index=it.task_index,
            )
            db.add(row)
        row.title = it.title
        row.due_at = it.due_at
        row.owner_email = it.owner_email
        row.source_subject = it.source_subject
        row.source_from = it.source_from
        row.source_date = it.source_date
        row.extracted_at = now
        written.append(row)

    db.commit()
    for r in written:
        db.refresh(r)
    return TaskBulkUpsertOut(written=len(written), items=[_to_out(r) for r in written])


@router.patch("/api/tasks/{task_id}", response_model=TaskItemOut)
def patch_task(
    task_id: int,
    body: TaskItemPatchIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(TaskItem)
        .filter(TaskItem.id == task_id, TaskItem.user_id == user.id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="task not found")
    if body.done is not None:
        row.done_at = _utcnow() if body.done else None
    if body.snoozed_until is not None:
        row.snoozed_until = body.snoozed_until
    if body.as_event_uid is not None:
        row.as_event_uid = body.as_event_uid.strip() or None
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/api/tasks/{task_id}")
def delete_task(
    task_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(TaskItem)
        .filter(TaskItem.id == task_id, TaskItem.user_id == user.id)
        .one_or_none()
    )
    if row is None:
        return {"ok": True}
    db.delete(row)
    db.commit()
    return {"ok": True}
