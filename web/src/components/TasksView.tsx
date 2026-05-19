import { useEffect, useRef, useState } from "react";
import type { AiAvailability } from "../aiTasks/chromeAi";

type Props = {
  status: AiAvailability;
  /** Mailboxes currently connected. The Scan button is disabled when
   * there's nothing to scan. */
  mailboxCount: number;
  /** Triggered by the Scan inbox button. In 2.5b this is a no-op that
   * surfaces a toast; the full extract flow ships in 2.5c. */
  onScan: () => void;
};

export function TasksView({ status, mailboxCount, onScan }: Props) {
  const [howOpen, setHowOpen] = useState(false);
  const howRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!howRef.current?.contains(e.target as Node)) setHowOpen(false);
    }
    if (howOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [howOpen]);

  const canScan = mailboxCount > 0 && status !== "unavailable";
  const scanLabel =
    status === "downloadable"
      ? "Scan inbox (downloads model first)"
      : status === "downloading"
      ? "Model downloading..."
      : "Scan inbox";

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-accent-900/20 pb-4">
        <div>
          <p className="font-serif text-xs uppercase tracking-[0.25em] text-accent-700">
            Beta &middot; Chrome only
          </p>
          <h1 className="mt-1 font-serif text-3xl text-accent-900">Tasks from your inbox</h1>
          <p className="mt-2 max-w-prose text-sm text-ink-600">
            Chrome's built-in AI reads your recent mail and pulls out things that look like
            action items. The mail itself never leaves your device.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div ref={howRef} className="relative">
            <button
              type="button"
              onClick={() => setHowOpen((v) => !v)}
              className="text-xs font-medium text-accent-700 underline-offset-2 hover:underline"
              aria-expanded={howOpen}
            >
              How this works
            </button>
            {howOpen && (
              <div className="absolute right-0 z-40 mt-2 w-80 rounded-md border border-ink-200 bg-white p-3 text-xs leading-relaxed text-ink-700 shadow-lg">
                <p className="mb-2 font-semibold text-ink-900">Where your data goes</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    Recent emails are pulled from Purelymail IMAP into your browser only.
                    Your inbox stays unread; we don't flip the seen flag.
                  </li>
                  <li>
                    Extraction runs on Gemini Nano via Chrome's Built-in AI API. The model
                    is on-device. No email text is sent to a remote LLM.
                  </li>
                  <li>
                    Extracted tasks (title, due date if any, source subject) are saved on
                    the server so they survive a refresh. The email body is not stored.
                  </li>
                </ul>
              </div>
            )}
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
      </header>

      <div className="rounded-lg border border-dashed border-accent-900/20 bg-white px-6 py-10 text-center">
        <p className="font-serif text-lg text-accent-900">No tasks yet.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">
          Click <span className="font-medium text-ink-800">Scan inbox</span> above and we'll
          walk the last two weeks of mail for action items. You can mark each one done,
          snooze it, or turn it into a calendar event.
        </p>
        {status === "downloadable" && (
          <p className="mt-3 text-xs text-ink-500">
            First-time use downloads the on-device model (around 3 GB). Chrome handles the
            download; subsequent scans are fast.
          </p>
        )}
        {status === "downloading" && (
          <p className="mt-3 text-xs text-ink-500">
            The on-device model is still downloading. Try again in a minute.
          </p>
        )}
      </div>
    </section>
  );
}
