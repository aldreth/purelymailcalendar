import type { InboxMessage, TaskBulkItem } from "../types";
import { chromeLanguageModel, type ChromeAiSession } from "./chromeAi";
import {
  EXTRACT_SYSTEM_PROMPT,
  TASK_EXTRACT_SCHEMA,
  type ExtractionResult,
} from "./schema";


/** Build the per-email prompt. Headers go first so the model anchors on
 * who's writing to whom before reading the body, which tends to improve
 * extraction quality on short emails. */
function renderEmailPrompt(email: InboxMessage): string {
  const headers = [
    `From: ${email.from || "(unknown)"}`,
    `Subject: ${email.subject || "(no subject)"}`,
    email.date ? `Date: ${email.date}` : null,
    email.truncated ? "(body was truncated; treat absent text as missing, not as 'nothing to do')" : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${headers}\n\n${email.body_text}`.slice(0, 6000); // hard cap on prompt length
}


/** Parse the model's structured JSON output defensively. Returns an empty
 * extraction if anything looks malformed so a single bad email never
 * blocks the rest of the batch. */
function parseExtraction(raw: string): ExtractionResult {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.has_tasks === "boolean" &&
      Array.isArray(parsed.tasks)
    ) {
      return parsed as ExtractionResult;
    }
  } catch {
    // fall through
  }
  return { has_tasks: false, tasks: [] };
}


export type CreateSessionOpts = {
  onDownloadProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
};


/** Create a Prompt-API session preloaded with our system prompt and the
 * response-constraint JSON schema. The session is meant to be reused
 * across emails inside one scan; pass `signal` to cancel mid-scan. */
export async function createExtractionSession(
  opts: CreateSessionOpts = {},
): Promise<ChromeAiSession> {
  const api = chromeLanguageModel();
  if (!api || typeof api.create !== "function") {
    throw new Error("Chrome Built-in AI is not available on this device.");
  }
  return await api.create({
    initialPrompts: [{ role: "system", content: EXTRACT_SYSTEM_PROMPT }],
    responseConstraint: TASK_EXTRACT_SCHEMA,
    signal: opts.signal,
    monitor: (target) => {
      target.addEventListener("downloadprogress", (event: Event) => {
        const e = event as Event & { loaded?: number; total?: number };
        if (typeof e.loaded === "number" && typeof e.total === "number") {
          opts.onDownloadProgress?.(e.loaded, e.total);
        }
      });
    },
  });
}


export type ExtractedRow = TaskBulkItem;


/** Run one email through the session, returning [] when the model says
 * no tasks were found or when the response failed to parse. */
async function extractOne(
  session: ChromeAiSession,
  email: InboxMessage,
  mailboxId: number,
  signal?: AbortSignal,
): Promise<ExtractedRow[]> {
  const prompt = renderEmailPrompt(email);
  let raw: string;
  try {
    raw = await session.prompt(prompt, {
      responseConstraint: TASK_EXTRACT_SCHEMA,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    // The Prompt API throws on rare model hiccups; swallow per-email so
    // the rest of the batch still runs.
    return [];
  }
  const out = parseExtraction(raw);
  if (!out.has_tasks || out.tasks.length === 0) return [];
  return out.tasks
    .filter((t) => t && typeof t.title === "string" && t.title.trim().length > 0)
    .map((t, idx) => ({
      mailbox_id: mailboxId,
      message_uid: email.message_uid,
      task_index: idx,
      title: t.title.trim().slice(0, 500),
      due_at: t.due || null,
      owner_email: t.owner || null,
      source_subject: email.subject || "",
      source_from: email.from || "",
      source_date: email.date || null,
    }));
}


export type ExtractProgress = {
  done: number;
  total: number;
  found: number;
};


/** Run extraction over a batch of emails with bounded concurrency. The
 * caller passes `onProgress` to drive the modal's per-email counter. */
export async function extractBatch(
  session: ChromeAiSession,
  emails: InboxMessage[],
  mailboxId: number,
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (p: ExtractProgress) => void;
  } = {},
): Promise<ExtractedRow[]> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 6));
  const results: ExtractedRow[] = [];
  let cursor = 0;
  let done = 0;
  let found = 0;

  async function worker() {
    while (true) {
      if (opts.signal?.aborted) return;
      const i = cursor++;
      if (i >= emails.length) return;
      const rows = await extractOne(session, emails[i], mailboxId, opts.signal);
      results.push(...rows);
      done += 1;
      found += rows.length;
      opts.onProgress?.({ done, total: emails.length, found });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, emails.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
