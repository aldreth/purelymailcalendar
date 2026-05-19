import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Mailbox } from "../types";

type Props = {
  onClose: () => void;
  onAdded: (mb: Mailbox) => void;
};

export function AddMailboxModal({ onClose, onAdded }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const mb = await api.addMailbox(
        email.trim().toLowerCase(),
        password,
        displayName.trim() || undefined,
      );
      onAdded(mb);
    } catch (e: any) {
      setErr(e?.message || "could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-mailbox-title"
        className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="add-mailbox-title" className="font-serif text-xl text-accent-900">
              Add another mailbox
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              Connect a second Purelymail account. You can flip between them from the header.
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

        <form onSubmit={submit} className="mt-4 grid gap-3">
          <div>
            <label className="label">Purelymail email</label>
            <input
              ref={emailRef}
              type="email"
              required
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="work@yourdomain.com"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              required
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your mailbox password"
            />
            <p className="mt-1 text-xs text-ink-500">
              Encrypted at rest with Fernet, sent over TLS to Purelymail only.
            </p>
          </div>
          <div>
            <label className="label">Display name (shown on invites)</label>
            <input
              className="field"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Work"
            />
          </div>
          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Connecting..." : "Connect mailbox"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
