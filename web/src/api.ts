import type {
  CalendarSummary,
  CancelEventResponse,
  CreateEventResponse,
  EventIn,
  EventOut,
  InboxMessage,
  Mailbox,
  MailboxCalendarsAll,
  MailboxEventsAll,
  Me,
  RsvpPollIn,
  RsvpPollOut,
  TaskBulkItem,
  TaskBulkUpsertResult,
  TaskItem,
  TaskPatchIn,
} from "./types";

export class AuthRequiredError extends Error {
  constructor() {
    super("not authenticated");
    this.name = "AuthRequiredError";
  }
}

export const ACTIVE_MAILBOX_KEY = "pmc.activeMailboxId";

function mailboxOverrideHeader(opts?: { mailboxId?: number }): Record<string, string> | undefined {
  if (opts?.mailboxId == null) return undefined;
  return { "X-Mailbox-Id": String(opts.mailboxId) };
}

function activeMailboxIdHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(ACTIVE_MAILBOX_KEY);
  if (!raw) return {};
  // Reject obvious junk so an empty/invalid stored id doesn't poison every
  // request with a 400 from the server.
  if (!/^\d+$/.test(raw)) return {};
  return { "X-Mailbox-Id": raw };
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...activeMailboxIdHeader(),
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401) {
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // auth
  requestLink: (email: string) =>
    request<{ ok: boolean }>("/api/auth/request-link", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyLink: (token: string) =>
    request<{ ok: boolean; email: string }>(`/api/auth/verify?token=${encodeURIComponent(token)}`),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<Me>("/api/auth/me"),

  // mailbox (legacy singular: still used during initial onboarding)
  getMailbox: () => request<Mailbox | null>("/api/me/mailbox"),
  connectMailbox: (email: string, password: string, display_name?: string) =>
    request<Mailbox>("/api/me/mailbox", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name }),
    }),
  deleteMailbox: () => request<{ ok: boolean }>("/api/me/mailbox", { method: "DELETE" }),

  // mailbox (plural: multi-account)
  listMailboxes: () => request<Mailbox[]>("/api/me/mailboxes"),
  addMailbox: (email: string, password: string, display_name?: string) =>
    request<Mailbox>("/api/me/mailboxes", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name }),
    }),
  updateMailbox: (
    id: number,
    body: { display_name?: string; selected_calendar?: string | null; color?: string | null },
  ) =>
    request<Mailbox>(`/api/me/mailboxes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMailboxById: (id: number) =>
    request<{ ok: boolean }>(`/api/me/mailboxes/${id}`, { method: "DELETE" }),
  markScanComplete: (id: number) =>
    request<Mailbox>(`/api/me/mailboxes/${id}/scan-complete`, { method: "POST" }),

  // data
  calendars: () => request<CalendarSummary[]>("/api/calendars"),
  calendarsAll: () => request<MailboxCalendarsAll>("/api/calendars/all"),
  eventsAll: (days = 60, range?: { from: Date; to: Date }) => {
    const q = new URLSearchParams();
    q.set("days", String(days));
    if (range) {
      q.set("start", range.from.toISOString());
      q.set("end", range.to.toISOString());
    }
    return request<MailboxEventsAll>(`/api/events/all?${q.toString()}`);
  },
  events: (
    calendar?: string,
    days = 60,
    range?: { from: Date; to: Date }
  ) => {
    const q = new URLSearchParams();
    q.set("days", String(days));
    if (calendar) q.set("calendar", calendar);
    if (range) {
      q.set("start", range.from.toISOString());
      q.set("end", range.to.toISOString());
    }
    return request<EventOut[]>(`/api/events?${q.toString()}`);
  },
  createEvent: (body: EventIn, opts?: { mailboxId?: number }) =>
    request<CreateEventResponse>("/api/events", {
      method: "POST",
      body: JSON.stringify(body),
      headers: mailboxOverrideHeader(opts),
    }),
  updateEvent: (uid: string, body: EventIn, opts?: { mailboxId?: number }) =>
    request<CreateEventResponse>(`/api/events/${encodeURIComponent(uid)}`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: mailboxOverrideHeader(opts),
    }),
  cancelEvent: (uid: string, body: EventIn, opts?: { mailboxId?: number }) =>
    request<CancelEventResponse>(`/api/events/${encodeURIComponent(uid)}/cancel`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: mailboxOverrideHeader(opts),
    }),
  cancelOccurrence: (uid: string, occurrenceStartIso: string, opts?: { mailboxId?: number }) =>
    request<{ ok: boolean }>(`/api/events/${encodeURIComponent(uid)}/cancel-occurrence`, {
      method: "POST",
      body: JSON.stringify({ occurrence_start: occurrenceStartIso }),
      headers: mailboxOverrideHeader(opts),
    }),
  pollRsvps: (body: RsvpPollIn) =>
    request<RsvpPollOut>("/api/rsvps/poll", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  syncInvites: (body?: { calendar?: string; mailbox?: string; only_unseen?: boolean; mark_seen?: boolean; since_days?: number | null }) =>
    request<{
      mailbox: string;
      counts: { created: number; updated: number; cancelled: number; skipped: number; error: number };
      results: { uid: string; summary: string; action: string; success: boolean; detail: string }[];
    }>("/api/invites/sync", {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),

  // AI tasks
  inboxRecent: (opts?: { since_days?: number; since_iso?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.since_iso) q.set("since_iso", opts.since_iso);
    else if (opts?.since_days != null) q.set("since_days", String(opts.since_days));
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return request<InboxMessage[]>(`/api/inbox/recent${qs ? `?${qs}` : ""}`);
  },
  listTasks: (opts?: { include_done?: boolean; include_snoozed?: boolean; mailbox_id?: number }) => {
    const q = new URLSearchParams();
    if (opts?.include_done) q.set("include_done", "true");
    if (opts?.include_snoozed) q.set("include_snoozed", "true");
    if (opts?.mailbox_id != null) q.set("mailbox_id", String(opts.mailbox_id));
    const qs = q.toString();
    return request<TaskItem[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
  },
  bulkUpsertTasks: (items: TaskBulkItem[]) =>
    request<TaskBulkUpsertResult>("/api/tasks/bulk", {
      method: "POST",
      body: JSON.stringify(items),
    }),
  patchTask: (id: number, body: TaskPatchIn) =>
    request<TaskItem>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTask: (id: number) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),
};
