import { useEffect, useRef, useState } from "react";
import type { TaskItem } from "../types";

type Props = {
  task: TaskItem;
  onCreateEvent: (task: TaskItem) => void;
  onDone: (task: TaskItem) => void;
  onSnooze: (task: TaskItem, days: 1 | 3 | 7) => void;
  onDismiss: (task: TaskItem) => void;
};

export function TaskRow({ task, onCreateEvent, onDone, onSnooze, onDismiss }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const dueLabel = task.due_at
    ? new Date(task.due_at).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const convertedTo = task.as_event_uid;

  return (
    <div className="card flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-medium text-ink-900">{task.title}</span>
          {convertedTo && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              On calendar
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
          {dueLabel && (
            <span>
              Due <span className="font-medium text-ink-700">{dueLabel}</span>
            </span>
          )}
          {task.owner_email && (
            <span>
              Owner <span className="font-medium text-ink-700">{task.owner_email}</span>
            </span>
          )}
          <span className="truncate">
            From <span className="text-ink-700">{task.source_from || "(unknown)"}</span>
            {task.source_subject ? ` / ${task.source_subject}` : ""}
          </span>
        </div>
      </div>
      <div ref={wrapRef} className="flex flex-shrink-0 items-center gap-1">
        {!convertedTo && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onCreateEvent(task)}
            title="Open the event form with this task pre-filled"
          >
            Create event
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onDone(task)}
          title="Mark this task as done"
        >
          Done
        </button>
        <div className="relative">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            Snooze
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg"
            >
              {[
                { label: "1 day", days: 1 as const },
                { label: "3 days", days: 3 as const },
                { label: "1 week", days: 7 as const },
              ].map((opt) => (
                <button
                  key={opt.days}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
                  onClick={() => {
                    setMenuOpen(false);
                    onSnooze(task, opt.days);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="text-ink-400 hover:text-ink-700"
          onClick={() => onDismiss(task)}
          title="Not a task; remove"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
