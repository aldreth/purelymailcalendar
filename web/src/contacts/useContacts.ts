/**
 * Debounced contact-search hook backed by /api/contacts.
 *
 * Lifecycle:
 *   1. On mount, fire a best-effort POST /api/contacts/sync (5-min throttled
 *      server-side). This is the "sync-on-tab-open" half of the cache policy.
 *   2. While the consumer types, debounce GET /api/contacts?q= calls by
 *      ~150ms so the dropdown stays responsive without spamming the API.
 *   3. Re-trigger a background sync if the cached `last_synced_at` is older
 *      than 5 min — this is the TTL half. The throttle on the backend means
 *      a hot reload of the form doesn't keep walking CardDAV.
 *
 * Active-mailbox switching: the request() wrapper attaches X-Mailbox-Id from
 * localStorage, so when the user flips mailboxes the hook automatically
 * surfaces the new mailbox's contacts on the next query.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Contact } from "../types";

const TTL_MS = 5 * 60 * 1000;

type UseContactsResult = {
  contacts: Contact[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

let _lastSyncAt: number | null = null;

/** Trigger a background sync if we haven't synced in TTL_MS. Idempotent. */
async function maybeSync(force = false): Promise<void> {
  const now = Date.now();
  if (!force && _lastSyncAt != null && now - _lastSyncAt < TTL_MS) return;
  try {
    await api.syncContacts(force ? { force: true } : undefined);
    _lastSyncAt = Date.now();
  } catch {
    // Best-effort: a failed sync doesn't prevent the cache-backed search
    // from working. The next attempt will retry.
  }
}

export function useContacts(query: string, opts?: { enabled?: boolean }): UseContactsResult {
  const enabled = opts?.enabled ?? true;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Sync-on-open: fires once per hook mount (the hook is mounted whenever
  // the autocomplete is rendered; consumers can gate via `enabled`).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      await maybeSync();
      if (!cancelled) setSyncing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Debounced search.
  useEffect(() => {
    if (!enabled) return;
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await api.searchContacts(query, 25);
        setContacts(rows);
      } catch (e: any) {
        setError(e?.message || "search failed");
        setContacts([]);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [query, enabled]);

  return useMemo(
    () => ({
      contacts,
      loading,
      syncing,
      error,
      refresh: async () => {
        await maybeSync(true);
        try {
          const rows = await api.searchContacts(query, 25);
          setContacts(rows);
        } catch {
          /* swallow */
        }
      },
    }),
    [contacts, loading, syncing, error, query],
  );
}

/** Reset the shared sync timestamp. Called when the active mailbox flips so
 *  the next consumer kicks off a fresh sync against the new mailbox. */
export function resetContactsSyncCheckpoint(): void {
  _lastSyncAt = null;
}
