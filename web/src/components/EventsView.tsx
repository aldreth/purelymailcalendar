import { useMemo, useState } from "react";
import type { EventOut } from "../types";
import { EventCard } from "./EventCard";

type Props = {
  events: EventOut[];
  loading: boolean;
  error: string | null;
  onEdit: (e: EventOut) => void;
  onCancel: (e: EventOut) => void;
  onRefresh: () => void;
  days: number;
  setDays: (n: number) => void;
};

export function EventsView({ events, loading, error, onEdit, onCancel, onRefresh, days, setDays }: Props) {
  const now = Date.now();

  // Split by end time: anything that has already ended is "past", everything
  // else (in-progress or future) is "upcoming". Both halves stay sorted by
  // start time, but past runs newest-first so the most recently-ended event
  // is at the top.
  const { upcoming, past } = useMemo(() => {
    const up: EventOut[] = [];
    const ps: EventOut[] = [];
    for (const e of events) {
      const endsAt = new Date(e.end).getTime();
      if (Number.isFinite(endsAt) && endsAt < now) {
        ps.push(e);
      } else {
        up.push(e);
      }
    }
    up.sort((a, b) => +new Date(a.start) - +new Date(b.start));
    ps.sort((a, b) => +new Date(b.start) - +new Date(a.start));
    return { upcoming: up, past: ps };
  }, [events, now]);

  const [showPast, setShowPast] = useState(false);

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Upcoming</h2>
        <div className="flex-1" />
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        >
          <option value={7}>next 7 days</option>
          <option value={14}>next 14 days</option>
          <option value={30}>next 30 days</option>
          <option value={90}>next 90 days</option>
        </select>
        <button onClick={onRefresh} disabled={loading} className="btn-secondary">
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && upcoming.length === 0 && !loading && (
        <div className="card px-4 py-10 text-center text-sm text-ink-500">
          No upcoming events in the selected window.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {upcoming.map((e) => (
          <EventCard key={e.occurrence_id || e.uid} event={e} onEdit={onEdit} onCancel={onCancel} />
        ))}
      </div>

      {past.length > 0 && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            className="mb-3 flex w-full items-center gap-3 text-left"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Past events
            </h2>
            <span className="text-xs text-ink-500">({past.length})</span>
            <div className="flex-1" />
            <span className="text-xs font-medium text-accent-700">
              {showPast ? "Hide" : "Show"}
            </span>
          </button>
          {showPast && (
            <div className="flex flex-col gap-2 opacity-80">
              {past.map((e) => (
                <EventCard key={e.occurrence_id || e.uid} event={e} onEdit={onEdit} onCancel={onCancel} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
