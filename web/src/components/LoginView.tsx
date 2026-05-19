import { useState } from "react";
import { api } from "../api";
import { TrustLine } from "./TrustLine";
import { UnofficialNote } from "./UnofficialNote";

const STORED_EMAIL_KEY = "pmc.lastSignInEmail";

function readStoredEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STORED_EMAIL_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredEmail(value: string): void {
  try {
    if (value) localStorage.setItem(STORED_EMAIL_KEY, value);
  } catch {
    // localStorage can throw in private windows; non-fatal.
  }
}

export function LoginView() {
  const [email, setEmail] = useState<string>(() => readStoredEmail());
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const normalized = email.trim().toLowerCase();
    try {
      await api.requestLink(normalized);
      writeStoredEmail(normalized);
      setSent(true);
    } catch (e: any) {
      setErr(e?.message || "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-accent-50 px-4 py-10">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-ink-200/60 bg-ink-900 shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
          {/* Left: the dark sign-in panel. */}
          <section className="flex flex-col justify-between px-8 py-10 text-ink-50 sm:px-12 sm:py-14">
            <a href="/" className="flex items-center gap-3">
              <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" />
              <span className="text-sm font-semibold tracking-tight text-white/95">
                Purelymail Calendar
              </span>
            </a>

            <div className="mt-12">
              {sent ? (
                <SentState email={email} onReset={() => setSent(false)} />
              ) : (
                <SignInForm
                  email={email}
                  setEmail={setEmail}
                  err={err}
                  busy={busy}
                  onSubmit={submit}
                />
              )}
            </div>

            <div className="mt-12 space-y-2 text-[11px] text-white/55">
              <TrustLine />
              <UnofficialNote />
            </div>
          </section>

          {/* Right: brand panel. Hidden on small screens so the form gets
              the full viewport on mobile. */}
          <aside className="relative hidden overflow-hidden lg:block">
            <img
              src="/signin-hero.jpg"
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            <div
              className="absolute inset-0 bg-gradient-to-br from-accent-600 via-accent-500 to-accent-700 mix-blend-multiply"
              aria-hidden
            />
            <div className="relative flex h-full flex-col justify-between p-10 text-white">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/85">
                  Volume i &middot; Sign in
                </p>
                <h2 className="mt-3 max-w-xs text-3xl font-semibold leading-tight">
                  A calendar for the{" "}
                  <span className="italic font-normal">Purelymail</span> mailbox.
                </h2>
                <p className="mt-4 max-w-xs text-sm text-white/85">
                  Send real meeting invites, track RSVPs, and let an on-device AI
                  pull action items from your inbox.
                </p>
              </div>
              <a
                href="/about"
                className="self-start rounded-full border border-white/30 px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/90 transition hover:bg-white/10"
              >
                About this app
              </a>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}


function SignInForm({
  email,
  setEmail,
  err,
  busy,
  onSubmit,
}: {
  email: string;
  setEmail: (v: string) => void;
  err: string | null;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="max-w-sm">
      <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
        Welcome back.
      </h1>
      <p className="mt-2 text-sm text-white/70">
        Enter the email on your Purelymail mailbox. We'll send a one-time sign-in
        link that expires in 15 minutes.
      </p>

      <div className="mt-8">
        <label htmlFor="signin-email" className="sr-only">
          Email
        </label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-white/40"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2.5 4.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7Z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path d="m3 5 5 4 5-4" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </span>
          <input
            id="signin-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="block w-full rounded-xl border border-white/15 bg-white/[0.04] py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/50 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
          />
        </div>

        {err && (
          <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !email}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 focus:ring-offset-ink-900 disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send sign-in link"}
          {!busy && (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M3 8h9m0 0L8.5 4.5M12 8l-3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          )}
        </button>
      </div>

      <p className="mt-6 text-xs text-white/55">
        Not on Purelymail yet?{" "}
        <a
          href="https://purelymail.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-white/85 underline-offset-2 hover:underline"
        >
          Get a mailbox
        </a>
        .
      </p>
    </form>
  );
}


function SentState({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <section className="max-w-sm">
      <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
        Check your email.
      </h1>
      <p className="mt-3 text-sm text-white/70">
        A sign-in link is on its way to{" "}
        <span className="font-medium text-white">{email}</span>. It expires in
        15 minutes.
      </p>
      <div className="mt-8 flex flex-col gap-2">
        <a
          href="https://inbox.purelymail.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center rounded-xl bg-accent-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-500"
        >
          Go to webmail
        </a>
        <button
          onClick={onReset}
          className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/85 transition hover:bg-white/10"
        >
          Use a different email
        </button>
      </div>
    </section>
  );
}
