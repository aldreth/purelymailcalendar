# On-device AI in Purelymail Calendar

*By Yashesh Bharti · May 19, 2026*

The Tasks feature reads your inbox and turns action items into draftable events. It does that with a language model that runs inside your browser, on your machine. Your email bodies are never sent to OpenAI, Anthropic, Google, or any other model provider. This page is the technical reference for how that works.

## Contents

1. [What "on-device" means here](#what-on-device-means-here)
2. [The data path, step by step](#the-data-path-step-by-step)
3. [What leaves the browser](#what-leaves-the-browser)
4. [What does not](#what-does-not)
5. [The Chrome Prompt API](#the-chrome-prompt-api)
6. [Structured output and guardrails](#structured-output-and-guardrails)
7. [Comparison with cloud-LLM email tools](#comparison-with-cloud-llm-email-tools)
8. [Honest caveats](#honest-caveats)
9. [How to verify it yourself](#how-to-verify-it-yourself)

## What "on-device" means here

Purelymail Calendar uses Chrome's **Built-in AI Prompt API**, which exposes **Gemini Nano**, a small language model that Chrome ships with the browser. The model weights live on your computer. Inference happens on your CPU or GPU. The browser is not opening a network connection to Google or anyone else to answer a prompt.

You can confirm the model is local by opening DevTools, switching to the Network tab, and watching what happens while the Tasks scan runs. The only requests you'll see are to this app's own backend (for the email list) and to nothing else. The browser is not reaching out to `generativelanguage.googleapis.com`, `api.openai.com`, `api.anthropic.com`, or any other model host.

## The data path, step by step

| Step | Where it happens | What's in flight |
|------|------------------|------------------|
| 1. You click *Scan inbox* | Your browser | A single HTTP request to this app's backend. |
| 2. Backend opens IMAP to Purelymail | Our web service, briefly in memory | Recent message headers + bodies, trimmed to about 8KB per email. |
| 3. Backend returns those emails to your browser | TLS pipe to your tab | The trimmed bodies, never persisted on the server. |
| 4. Browser runs Gemini Nano locally | Your device, no network | Prompt + body in RAM; weights in Chrome's cache. |
| 5. Model returns structured JSON | Your device | Title, optional due date, optional owner. Nothing else. |
| 6. Browser POSTs only the extracted fields back | TLS pipe to backend | e.g. `{title: "Send Q3 numbers", due: "2026-06-12T17:00"}`. |

## What leaves the browser

The server only ever sees, and only ever stores:

- The extracted task title (max 500 chars).
- An optional due timestamp, if the email mentioned one explicitly.
- An optional owner name, if the email named one explicitly.
- The originating message UID, subject, sender, and date, needed so a re-scan can update the same row instead of duplicating it.

## What does not

- The email body. It stays out of our database and out of any model's input pipe.
- The model prompt. It's constructed and consumed in the same browser tab.
- The model output before parsing. The browser parses the JSON and discards the raw string.
- Anything from a non-matching email. If Nano returns `has_tasks=false`, the row is dropped on the spot.

## The Chrome Prompt API

The implementation file is [`web/src/aiTasks/chromeAi.ts`](https://github.com/bhartiyashesh/purelymailcalendar/blob/main/web/src/aiTasks/chromeAi.ts). It feature-detects the API at two possible globals, `self.LanguageModel` on current builds and `self.ai.languageModel` on older origin-trial builds, and treats anything else as "AI not available". When the API exists, Chrome reports one of four states:

- `unavailable`: your device or build can't run Nano.
- `downloadable`: Chrome can fetch the weights, but hasn't yet.
- `downloading`: first-run weight download in progress.
- `available`: model loaded, ready to prompt.

The weights are downloaded **by Chrome**, once, on first use of any Prompt API site on your computer. They're shared across sites. We don't host or ship them; we just call into what's already there.

## Structured output and guardrails

Small models drift. To keep Nano on-rails we pass a JSON schema as the `responseConstraint`, so the model is forced to emit something parseable:

```
{
  has_tasks: boolean,
  tasks: [{
    title: string (1..200 chars),
    due:   ISO datetime,  // optional, only when mentioned
    owner: string         // optional, only when explicit
  }] (max 5)
}
```

The system prompt is short and conservative: ignore newsletters, marketing, receipts, FYI-only messages; only fill `due` when the email mentions a specific date or time; never guess. If a single email's response fails to parse, the batch keeps going; that email is dropped, the rest aren't.

## Comparison with cloud-LLM email tools

Most "AI in your inbox" products from the last two years take the opposite approach: forward email content to a cloud language model, then return the result. That has real consequences for what the model provider, the product company, and any subprocessor sees and stores.

|  | Cloud-LLM pattern | This app |
|---|---|---|
| Where the model runs | Provider's GPU cluster | Your CPU / GPU, in-browser |
| Email body is sent over the internet to a model | Yes | No |
| Provider retains prompts (by default policy) | Typically 30 days to indefinite | Not applicable; no provider involved |
| Prompts may be used for model training | Depends on plan and opt-outs | Not applicable |
| Subprocessor exposure | Provider plus their cloud host | None beyond your browser and our backend |
| Works offline after first model download | No | Inference does; fetching the email list still needs the network |

## Honest caveats

We try to be straight about what this approach does and doesn't fix.

- **The email body still passes through our backend in flight.** We open IMAP to Purelymail, fetch recent messages, and relay them to your browser over TLS. They aren't persisted, but they exist in our process memory for the duration of the request.
- **Gemini Nano is small.** It's good at "is this an action item or a newsletter?" and "what's the title?" It's less good at multi-step reasoning, summarisation of long threads, or anything cross-document. A frontier model would do those better. We're trading capability for privacy here, and we think the trade is right for an inbox.
- **Browser support is uneven.** The Prompt API is a Chrome desktop feature today. We hide the Tasks tab on touch devices and on browsers that don't expose the API at all.
- **The structured output isn't perfect.** Nano occasionally extracts something silly. You see every extracted task before anything is done with it, and you can dismiss or snooze each one individually.

## How to verify it yourself

1. Open the app in a recent Chrome desktop build. Sign in and connect a mailbox.
2. Open DevTools (Cmd+Option+I / Ctrl+Shift+I), switch to the Network tab, and check "Disable cache".
3. Go to the Tasks tab and click *Scan inbox*.
4. You'll see exactly two kinds of requests: `/api/inbox/recent` (the email fetch) and `/api/tasks/bulk` (the structured rows we send back). The list will not include any third-party hosts.
5. You can also read the source. The relevant files are [`chromeAi.ts`](https://github.com/bhartiyashesh/purelymailcalendar/blob/main/web/src/aiTasks/chromeAi.ts), [`extractTasks.ts`](https://github.com/bhartiyashesh/purelymailcalendar/blob/main/web/src/aiTasks/extractTasks.ts), and [`schema.ts`](https://github.com/bhartiyashesh/purelymailcalendar/blob/main/web/src/aiTasks/schema.ts). The server side is just [`calinvite_web/tasks.py`](https://github.com/bhartiyashesh/purelymailcalendar/blob/main/calinvite_web/tasks.py).

---

Want the longer argument for why this approach matters and where it's headed? Read the blog post at [Private by design](https://purelymailcalendar.com/blog/private-by-design-ai).
