import { useEffect, useRef, useState } from "react";
import type { AiAvailability } from "../aiTasks/chromeAi";
import type { TaskItem } from "../types";
import { TaskRow } from "./TaskRow";

type Props = {
  open: boolean;
  status: AiAvailability;
  mailboxCount: number;
  tasks: TaskItem[];
  loading: boolean;
  onClose: () => void;
  onScan: () => void;
  onBlockTime: (task: TaskItem) => void;
  onCreateEvent: (task: TaskItem) => void;
  onDone: (task: TaskItem) => void;
  onSnooze: (task: TaskItem, days: 1 | 3 | 7) => void;
  onDismiss: (task: TaskItem) => void;
};

export function TasksSidebar({
  open,
  status,
  mailboxCount,
  tasks,
  loading,
  onClose,
  onScan,
  onBlockTime,
  onCreateEvent,
  onDone,
  onSnooze,
  onDismiss,
}: Props) {
  const [howOpen, setHowOpen] = useState(false);
  const howRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!howRef.current?.contains(e.target as Node)) setHowOpen(false);
    }
    if (howOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [howOpen]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const canScan = mailboxCount > 0 && status !== "unavailable";
  const scanLabel =
    status === "downloadable"
      ? "Fetch tasks (downloads model first)"
      : status === "downloading"
      ? "Model downloading..."
      : "Fetch tasks";

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/20"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        role="dialog"
        aria-modal="false"
        aria-labelledby="tasks-sidebar-title"
        className={`fixed right-0 top-0 z-40 h-full w-full max-w-md transform border-l border-ink-200 bg-white shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <div className="min-w-0">
            <p className="font-serif text-[10px] uppercase tracking-[0.25em] text-accent-700">
              Beta &middot; Chrome only
            </p>
            <h2 id="tasks-sidebar-title" className="mt-0.5 font-serif text-lg text-accent-900">
              Tasks from your inbox
            </h2>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <div ref={howRef} className="relative">
              <button
                type="button"
                onClick={() => setHowOpen((v) => !v)}
                className="text-[11px] font-medium text-accent-700 underline-offset-2 hover:underline"
                aria-expanded={howOpen}
              >
                How this works
              </button>
              {howOpen && (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-md border border-ink-200 bg-white p-3 text-xs leading-relaxed text-ink-700 shadow-lg">
                  <p className="mb-2 font-semibold text-ink-900">Where your data goes</p>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>
                      Recent emails are pulled from Purelymail IMAP into your browser only.
                      Your inbox stays unread.
                    </li>
                    <li>
                      Extraction runs on Gemini Nano via Chrome's Built-in AI. The model is
                      on-device; nothing goes to a remote LLM.
                    </li>
                    <li>
                      Only the extracted task title and source metadata is saved on the
                      server. Email body is never persisted.
                    </li>
                  </ul>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-ink-500 hover:bg-ink-50 hover:text-ink-800"
              aria-label="Close tasks panel"
              title="Close"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path
                  d="M4 4l10 10M14 4L4 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <div className="border-b border-ink-100 px-4 py-3">
          <button
            type="button"
            onClick={onScan}
            disabled={!canScan}
            className="btn-primary w-full"
            title={
              mailboxCount === 0
                ? "Connect a mailbox first"
                : status === "unavailable"
                ? "Chrome Built-in AI is not available on this device"
                : undefined
            }
          >
            {scanLabel}
          </button>
          {status === "downloadable" && (
            <p className="mt-2 text-[11px] text-ink-500">
              First-time use downloads the on-device model (around 3 GB). Future scans skip
              this step.
            </p>
          )}
          {status === "downloading" && (
            <p className="mt-2 text-[11px] text-ink-500">
              On-device model is still downloading. Try again in a minute.
            </p>
          )}
        </div>

        <div className="h-[calc(100%-9.5rem)] overflow-y-auto px-4 py-3">
          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-accent-900/15 bg-ink-50/40 px-4 py-8 text-center">
              <p className="font-serif text-base text-accent-900">
                {loading ? "Loading..." : "No tasks yet."}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-xs text-ink-600">
                Click <span className="font-medium text-ink-800">Fetch tasks</span> to scan
                the last two weeks of mail. Action items show up here. Each one can be
                blocked straight onto your calendar.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onBlockTime={onBlockTime}
                  onCreateEvent={onCreateEvent}
                  onDone={onDone}
                  onSnooze={onSnooze}
                  onDismiss={onDismiss}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
