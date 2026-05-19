import type { AiAvailability } from "../aiTasks/chromeAi";
import type { TaskItem } from "../types";
import { TaskRow } from "./TaskRow";

type Props = {
  status: AiAvailability;
  /** Mailboxes currently connected. The Fetch button is disabled when
   * there's nothing to scan. */
  mailboxCount: number;
  tasks: TaskItem[];
  loading: boolean;
  onScan: () => void;
  onBlockTime: (task: TaskItem) => void;
  onCreateEvent: (task: TaskItem) => void;
  onDone: (task: TaskItem) => void;
  onSnooze: (task: TaskItem, days: 1 | 3 | 7) => void;
  onDismiss: (task: TaskItem) => void;
};

export function TasksView({
  status,
  mailboxCount,
  tasks,
  loading,
  onScan,
  onBlockTime,
  onCreateEvent,
  onDone,
  onSnooze,
  onDismiss,
}: Props) {
  const canScan = mailboxCount > 0 && status !== "unavailable";
  const scanLabel =
    status === "downloadable"
      ? "Fetch tasks (downloads model first)"
      : status === "downloading"
      ? "Model downloading..."
      : "Fetch tasks";

  return (
    <section>
      <header className="mb-4">
        <p className="font-serif text-[10px] uppercase tracking-[0.25em] text-accent-700">
          Beta &middot; Chrome desktop only
        </p>
        <h1 className="mt-0.5 font-serif text-2xl text-accent-900">Tasks from your inbox</h1>
        <details className="group mt-1.5">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-accent-700 underline-offset-2 marker:hidden hover:underline [&::-webkit-details-marker]:hidden">
            <svg
              width="9"
              height="9"
              viewBox="0 0 12 12"
              aria-hidden
              className="transition-transform group-open:rotate-90"
            >
              <path
                d="M4 2l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Why should I trust this?
          </summary>
          <div className="mt-2 max-w-prose rounded-md border border-accent-700/15 bg-accent-50/60 px-4 py-3 text-xs leading-relaxed text-ink-700">
            <p>
              This feature runs <strong className="font-semibold text-ink-900">end-to-end on your computer</strong>.
              The email text <strong className="font-semibold text-ink-900">never leaves your browser</strong>,
              and nothing is sent to a remote AI service.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Recent emails are pulled from Purelymail's IMAP server{" "}
                <strong className="font-semibold text-ink-900">straight into your browser</strong>.
                Your inbox stays unread; we don't touch the seen flag.
              </li>
              <li>
                Extraction runs on <strong className="font-semibold text-ink-900">Gemini Nano</strong>,
                the on-device model Chrome ships. The model{" "}
                <strong className="font-semibold text-ink-900">lives on your machine</strong>.
                No email text is sent to Google, OpenAI, Anthropic, or any other LLM provider.
              </li>
              <li>
                Only the <strong className="font-semibold text-ink-900">task title, optional due date, and source subject line</strong> are
                stored on the server. The <strong className="font-semibold text-ink-900">full email body is never persisted</strong>.
              </li>
              <li>
                Action items are tied to your account so they survive a refresh and follow you across devices.
                Mark them done, snooze, or dismiss at any time; <strong className="font-semibold text-ink-900">deletion is permanent</strong>.
              </li>
            </ul>
          </div>
        </details>
      </header>

      <div className="mb-5">
        <button
          type="button"
          onClick={onScan}
          disabled={!canScan}
          className="btn-primary"
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
          <p className="mt-2 text-xs text-ink-500">
            First-time use downloads the on-device model (around 3 GB). Chrome handles the
            download; future scans skip this step.
          </p>
        )}
        {status === "downloading" && (
          <p className="mt-2 text-xs text-ink-500">
            The on-device model is still downloading. Try again in a minute.
          </p>
        )}
      </div>

      {loading && tasks.length === 0 && (
        <p className="text-sm text-ink-500">Loading...</p>
      )}

      {tasks.length > 0 && (
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
    </section>
  );
}
