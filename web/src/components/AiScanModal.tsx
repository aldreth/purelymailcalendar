import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { createExtractionSession, extractBatch, type ExtractedRow } from "../aiTasks/extractTasks";
import type { ChromeAiSession } from "../aiTasks/chromeAi";

type Phase =
  | { kind: "downloading"; loaded: number; total: number }
  | { kind: "fetching" }
  | { kind: "extracting"; done: number; total: number; found: number }
  | { kind: "saving" }
  | { kind: "done"; written: number; emails: number }
  | { kind: "error"; message: string };


type Props = {
  activeMailboxId: number;
  onClose: () => void;
  /** Called once the scan finishes successfully so the caller can refetch
   * the tasks list. */
  onComplete: (written: number) => void;
};


export function AiScanModal({ activeMailboxId, onClose, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "fetching" });
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<ChromeAiSession | null>(null);

  // Stable refs for the callbacks so the scan effect can depend only on
  // `activeMailboxId`. Without this, every parent re-render (toast push,
  // task list update, etc.) recreates the inline onComplete arrow, the
  // effect deps change, and the whole scan kicks off again — including a
  // fresh /api/inbox/recent call and a new LanguageModel session. That
  // shows up as runaway IMAP traffic and a stuck modal.
  const onCompleteRef = useRef(onComplete);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onCloseRef.current = onClose;
  }, [onComplete, onClose]);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;
    const safeSet = (p: Phase) => {
      if (!cancelled) setPhase(p);
    };

    (async () => {
      let session: ChromeAiSession | null = null;
      try {
        // Create the session first so we can surface model-download
        // progress before we touch IMAP. If the model is already
        // downloaded the create call returns immediately.
        session = await createExtractionSession({
          signal: controller.signal,
          onDownloadProgress: (loaded, total) => {
            safeSet({ kind: "downloading", loaded, total });
          },
        });
        sessionRef.current = session;
        if (controller.signal.aborted) return;

        safeSet({ kind: "fetching" });
        const emails = await api.inboxRecent({ since_days: 14, limit: 50 });
        if (controller.signal.aborted) return;

        if (emails.length === 0) {
          safeSet({ kind: "done", written: 0, emails: 0 });
          onCompleteRef.current(0);
          return;
        }

        safeSet({ kind: "extracting", done: 0, total: emails.length, found: 0 });
        const rows: ExtractedRow[] = await extractBatch(session, emails, activeMailboxId, {
          concurrency: 3,
          signal: controller.signal,
          onProgress: (p) => safeSet({ kind: "extracting", done: p.done, total: p.total, found: p.found }),
        });
        if (controller.signal.aborted) return;

        safeSet({ kind: "saving" });
        let written = 0;
        if (rows.length > 0) {
          const res = await api.bulkUpsertTasks(rows);
          written = res.written;
        }
        safeSet({ kind: "done", written, emails: emails.length });
        onCompleteRef.current(written);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "scan failed";
        safeSet({ kind: "error", message });
      } finally {
        try {
          session?.destroy();
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      try {
        sessionRef.current?.destroy();
      } catch {
        // ignore
      }
    };
  }, [activeMailboxId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-scan-title"
        className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="ai-scan-title" className="font-serif text-xl text-accent-900">
              Scanning inbox
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              Email content stays on your device. Only extracted tasks are saved.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-800"
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="mt-4">
          <PhaseView phase={phase} />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          {phase.kind === "done" || phase.kind === "error" ? (
            <button onClick={onClose} className="btn-primary">
              Close
            </button>
          ) : (
            <button
              onClick={() => {
                abortRef.current?.abort();
                onClose();
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function PhaseView({ phase }: { phase: Phase }) {
  switch (phase.kind) {
    case "downloading": {
      const pct = phase.total > 0 ? Math.round((phase.loaded / phase.total) * 100) : 0;
      return (
        <div>
          <p className="text-sm font-medium text-ink-800">Downloading on-device model</p>
          <p className="mt-1 text-xs text-ink-500">
            One-time download (around 3 GB). Future scans skip this step.
          </p>
          <ProgressBar pct={pct} />
        </div>
      );
    }
    case "fetching":
      return (
        <div>
          <p className="text-sm font-medium text-ink-800">Reading recent emails...</p>
          <p className="mt-1 text-xs text-ink-500">Last 14 days, up to 50 messages.</p>
          <Spinner />
        </div>
      );
    case "extracting": {
      const pct = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : 0;
      return (
        <div>
          <p className="text-sm font-medium text-ink-800">
            Extracting tasks ({phase.done} of {phase.total})
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Found <span className="font-medium text-ink-700">{phase.found}</span> so far.
          </p>
          <ProgressBar pct={pct} />
        </div>
      );
    }
    case "saving":
      return (
        <div>
          <p className="text-sm font-medium text-ink-800">Saving tasks...</p>
          <Spinner />
        </div>
      );
    case "done":
      return (
        <div>
          <p className="text-sm font-medium text-emerald-700">Done.</p>
          <p className="mt-1 text-sm text-ink-700">
            Found {phase.written} task{phase.written === 1 ? "" : "s"} across {phase.emails} email
            {phase.emails === 1 ? "" : "s"}.
          </p>
        </div>
      );
    case "error":
      return (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {phase.message}
        </div>
      );
  }
}


function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-100">
      <div
        className="h-full rounded-full bg-accent-500 transition-all"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}


function Spinner() {
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-100">
      <div className="h-full w-1/3 animate-loader-slide rounded-full bg-accent-500" />
    </div>
  );
}
