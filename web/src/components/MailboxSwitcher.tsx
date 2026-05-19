import { useEffect, useRef, useState } from "react";
import type { Mailbox } from "../types";
import { mailboxColor, nextPaletteColor } from "../mailboxColors";

export type ActiveMailboxSelection = number | "all";

type Props = {
  mailboxes: Mailbox[];
  activeId: ActiveMailboxSelection | null;
  onSwitch: (id: ActiveMailboxSelection) => void;
  onAddAccount: () => void;
  onChangeColor?: (mailboxId: number, color: string) => void;
};

export function MailboxSwitcher({ mailboxes, activeId, onSwitch, onAddAccount, onChangeColor }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const allActive = activeId === "all";
  const active = !allActive ? mailboxes.find((m) => m.id === activeId) ?? mailboxes[0] ?? null : null;
  const label = allActive
    ? "All accounts"
    : active
    ? active.display_name || active.email.split("@")[0]
    : "No mailbox";

  // Only show the All-accounts row when the user has more than one mailbox.
  // No point routing through the merged view when there's only one.
  const showAllRow = mailboxes.length > 1;

  return (
    <div ref={wrapRef} className="relative">
      <label className="text-[10px] font-medium uppercase tracking-wide text-ink-500">Account</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-2 inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-sm shadow-sm hover:border-accent-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={allActive ? "All accounts" : active?.email || "Connect a mailbox"}
      >
        <span className="max-w-[140px] truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-ink-500">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {showAllRow && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!allActive) onSwitch("all");
                  }}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-ink-50 ${
                    allActive ? "bg-accent-100" : ""
                  }`}
                >
                  <span
                    className={`mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full ${
                      allActive ? "bg-accent-600" : "bg-transparent"
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-800">All accounts</span>
                    <span className="block truncate text-xs text-ink-500">
                      Events from every mailbox in one view
                    </span>
                  </span>
                </button>
              </li>
            )}
            {showAllRow && mailboxes.length > 0 && (
              <li aria-hidden className="my-1 border-t border-ink-100" />
            )}
            {mailboxes.length === 0 && (
              <li className="px-3 py-2 text-xs text-ink-500">No mailboxes connected yet.</li>
            )}
            {mailboxes.map((mb) => {
              const isActive = !allActive && mb.id === active?.id;
              const color = mailboxColor(mb);
              return (
                <li key={mb.id} className="flex items-stretch">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!onChangeColor) return;
                      onChangeColor(mb.id, nextPaletteColor(color));
                    }}
                    title="Click to change color"
                    aria-label={`Color for ${mb.display_name || mb.email}`}
                    className="flex flex-shrink-0 items-center justify-center px-2 hover:bg-ink-50"
                  >
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!isActive) onSwitch(mb.id);
                    }}
                    className={`flex w-full items-start gap-2 px-1 py-2 pr-3 text-left hover:bg-ink-50 ${
                      isActive ? "bg-accent-100" : ""
                    }`}
                  >
                    <span
                      className={`mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full ${
                        isActive ? "bg-accent-600" : "bg-transparent"
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-800">
                        {mb.display_name || mb.email.split("@")[0]}
                      </span>
                      <span className="block truncate text-xs text-ink-500">{mb.email}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-ink-100">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAddAccount();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-accent-700 hover:bg-ink-50"
            >
              <span className="text-base leading-none">+</span> Add another account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
