/**
 * Settings-style modal for managing the active mailbox's contacts.
 *
 * Per the design rule of the cal app: this lives behind the user
 * dropdown rather than as a top-level tab. The autocomplete in the
 * event form is the discoverable surface; this panel is the full
 * picture for users who want one.
 *
 * Three pieces inside:
 *   - Header: live count, last-synced timestamp, manual Sync button
 *   - Search box
 *   - Scrollable list (name + email + org + source book)
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Contact, Mailbox } from "../types";

type Props = {
  onClose: () => void;
  activeMailbox?: Mailbox | null;
};

function formatRelative(iso?: string | null): string {
  if (!iso) return "never synced";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never synced";
  const delta = Date.now() - then;
  if (delta < 60_000) return "just now";
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)} min ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))} hr ago`;
  return new Date(iso).toLocaleDateString();
}

export function ContactsPanel({ onClose, activeMailbox }: Props) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    activeMailbox?.last_contacts_synced_at ?? null,
  );
  const [toast, setToast] = useState<string | null>(null);

  // Initial load: search with no query returns up to 100 rows ordered by name.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .searchContacts(query, 100)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setErr(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e?.message || "failed to load contacts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, activeMailbox?.id]);

  // Esc closes the panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function manualSync(force = true) {
    setSyncing(true);
    setErr(null);
    setToast(null);
    try {
      const res = await api.syncContacts({ force });
      setLastSyncedAt(res.last_synced_at);
      const re = await api.searchContacts(query, 100);
      setRows(re);
      if (res.throttled) {
        setToast("Cache is already fresh.");
      } else {
        setToast(
          `Synced ${res.upserted} updated, ${res.deleted} removed across ${res.books.length} book${res.books.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (e: any) {
      setErr(e?.message || "sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const grouped = useMemo(() => {
    const byBook: Record<string, Contact[]> = {};
    for (const c of rows) {
      const k = c.source_book || "default";
      (byBook[k] = byBook[k] || []).push(c);
    }
    return byBook;
  }, [rows]);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink-900/30" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-accent-50 shadow-xl">
        <div className="flex items-baseline justify-between border-b border-accent-900/30 px-6 py-5">
          <div>
            <h2 className="font-serif text-2xl text-accent-900">Contacts</h2>
            <p className="mt-1 text-xs text-ink-600">
              {activeMailbox ? activeMailbox.email : "no mailbox"} · last synced {formatRelative(lastSyncedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-serif text-2xl leading-none text-accent-900/60 hover:text-accent-900"
            aria-label="close"
          >
            ×
          </button>
        </div>
        <div className="border-b border-accent-900/20 px-6 py-3">
          <div className="flex items-center gap-2">
            <input
              className="field flex-1"
              placeholder="Search by name, email, or organization"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => manualSync(true)}
              disabled={syncing || !activeMailbox}
            >
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Reads from Purelymail's CardDAV server. Contacts auto-collected from
            event invites land in the "automaticallyCollected" book. Edit them
            in Purelymail's webmail and sync again to pull changes here.
          </p>
          {toast && (
            <div className="mt-2 rounded-md border border-accent-200 bg-accent-100/70 px-3 py-2 text-xs text-accent-900">
              {toast}
            </div>
          )}
          {err && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && rows.length === 0 && (
            <p className="text-sm text-ink-500">Loading…</p>
          )}
          {!loading && rows.length === 0 && (
            <div className="rounded-md border border-dashed border-ink-200 bg-white px-4 py-8 text-center">
              <p className="text-sm text-ink-700">No contacts yet.</p>
              <p className="mt-1 text-xs text-ink-500">
                Click "Sync now" to pull your address book from Purelymail.
                Invitees you add to events will auto-collect from now on.
              </p>
            </div>
          )}
          {Object.entries(grouped).map(([book, list]) => (
            <section key={book} className="mb-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                {book === "automaticallyCollected" ? "Automatically collected" : book}
                <span className="ml-2 font-normal lowercase text-ink-400">
                  ({list.length})
                </span>
              </h3>
              <ul className="divide-y divide-ink-100 rounded-md border border-ink-200 bg-white">
                {list.map((c) => (
                  <li key={c.id} className="px-3 py-2 text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-ink-800">
                        {c.full_name || c.primary_email}
                      </span>
                      {c.full_name && c.primary_email && (
                        <span className="text-xs text-ink-500">
                          {c.primary_email}
                        </span>
                      )}
                    </div>
                    {c.org && <div className="text-xs text-ink-500">{c.org}</div>}
                    {c.emails.length > 1 && (
                      <div className="mt-1 text-xs text-ink-500">
                        +{c.emails.length - 1} more email
                        {c.emails.length === 2 ? "" : "s"}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
