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
      <header className="mb-6 border-b border-accent-900/20 pb-5">
        <p className="font-serif text-xs uppercase tracking-[0.25em] text-accent-700">
          Beta &middot; Chrome desktop only
        </p>
        <h1 className="mt-1 font-serif text-3xl text-accent-900">Tasks from your inbox</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-700">
          Chrome's built-in AI reads your recent mail and pulls out things that look like
          action items. You decide what to do with each one: block time on your calendar,
          mark it done, snooze it, or dismiss it.
        </p>
      </header>

      <div className="mb-6 rounded-lg border border-accent-700/20 bg-accent-50/60 px-5 py-4">
        <h2 className="font-serif text-base font-semibold text-accent-900">
          Where your data lives
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-700">
          This feature runs end-to-end on your computer. The email text never leaves your
          browser, and nothing is sent to a remote AI service.
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700">
          <li>
            Recent emails are pulled from Purelymail's IMAP server straight into your
            browser. Your inbox stays unread; we don't touch the seen flag.
          </li>
          <li>
            Extraction runs on{" "}
            <span className="font-medium text-ink-900">Gemini Nano</span>, the on-device
            model Chrome ships. The model lives on your machine. No email text is sent to
            Google, OpenAI, Anthropic, or any other LLM provider.
          </li>
          <li>
            Only what's needed to render the task list is stored on the server: the
            extracted task title, optional due date, and the source subject line. The full
            email body is never persisted.
          </li>
          <li>
            Action items are tied to your account, so they survive a refresh and follow
            you across devices. You can mark them done, snooze, or dismiss them at any
            time; deletion is permanent.
          </li>
        </ul>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-900">
            {tasks.length === 0
              ? "No tasks pulled yet."
              : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
          </p>
          <p className="text-xs text-ink-500">
            Fetch scans the last 14 days of mail in the active mailbox.
          </p>
        </div>
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
      </div>

      {status === "downloadable" && (
        <p className="mb-4 text-xs text-ink-500">
          First-time use downloads the on-device model (around 3 GB). Chrome handles the
          download; future scans skip this step.
        </p>
      )}
      {status === "downloading" && (
        <p className="mb-4 text-xs text-ink-500">
          The on-device model is still downloading. Try again in a minute.
        </p>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-accent-900/20 bg-white px-6 py-10 text-center">
          <p className="font-serif text-lg text-accent-900">
            {loading ? "Loading..." : "Nothing in your inbox yet."}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">
            Click <span className="font-medium text-ink-800">Fetch tasks</span> above and
            we'll walk the last two weeks of mail for action items. Each one can be
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
    </section>
  );
}
