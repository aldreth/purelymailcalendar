/**
 * Attendee-field replacement: input + dropdown that searches the cached
 * Purelymail contacts for the active mailbox.
 *
 * The visible input is two fields (email + optional name) so the parent
 * EventForm stays compatible with its existing AttRow model. Selecting
 * a contact fills both. The keyboard model:
 *   ArrowDown / ArrowUp — navigate suggestions
 *   Enter              — pick highlighted suggestion
 *   Escape             — close dropdown
 *   Tab                — closes the dropdown (so focus moves naturally)
 *
 * When nothing matches but the input looks like an email, we offer a
 * synthetic "Use <typed-email>" row so the user can press Enter and add
 * an off-list address without leaving the keyboard.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useContacts } from "../contacts/useContacts";
import type { Contact } from "../types";

type Props = {
  email: string;
  name: string;
  onChange: (patch: { email?: string; name?: string }) => void;
  onRemove: () => void;
  // Optional: emails already on the form so we can flag duplicates in the
  // dropdown. Strict equality, lowercase.
  alreadyAdded?: string[];
};

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function ContactAutocomplete({ email, name, onChange, onRemove, alreadyAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const query = email.trim();
  const { contacts, loading } = useContacts(query, { enabled: open });
  const taken = useMemo(
    () => new Set((alreadyAdded || []).map((e) => e.toLowerCase().trim())),
    [alreadyAdded],
  );

  const suggestions = useMemo(() => {
    const rows = contacts.filter((c) => {
      const e = (c.primary_email || "").toLowerCase().trim();
      return !taken.has(e) || e === email.toLowerCase().trim();
    });
    return rows.slice(0, 8);
  }, [contacts, taken, email]);

  const showAddTyped = useMemo(() => {
    if (!query) return false;
    if (suggestions.some((c) => (c.primary_email || "").toLowerCase() === query.toLowerCase())) {
      return false;
    }
    return looksLikeEmail(query);
  }, [query, suggestions]);

  const totalRows = suggestions.length + (showAddTyped ? 1 : 0);

  // Close when clicking outside.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }
  }, [open]);

  // Reset highlight whenever results change.
  useEffect(() => {
    setActiveIdx(0);
  }, [query, totalRows]);

  function pickSuggestion(c: Contact) {
    onChange({
      email: c.primary_email || "",
      name: c.full_name || name || "",
    });
    setOpen(false);
  }

  function pickTyped() {
    // Email already lives in state; just close the dropdown.
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (totalRows > 0 ? (i + 1) % totalRows : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (totalRows > 0 ? (i - 1 + totalRows) % totalRows : 0));
    } else if (e.key === "Enter") {
      if (totalRows === 0) return;
      e.preventDefault();
      if (activeIdx < suggestions.length) {
        pickSuggestion(suggestions[activeIdx]);
      } else if (showAddTyped) {
        pickTyped();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-2" ref={wrapperRef}>
      <div className="col-span-6 relative">
        <input
          ref={inputRef}
          className="field"
          placeholder="email@example.com"
          value={email}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange({ email: e.target.value });
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {open && (suggestions.length > 0 || showAddTyped || loading) && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-72 overflow-y-auto rounded-md border border-ink-200 bg-white shadow-lg"
            role="listbox"
          >
            {suggestions.length === 0 && loading && (
              <div className="px-3 py-2 text-xs text-ink-500">Searching…</div>
            )}
            {suggestions.map((c, idx) => {
              const active = idx === activeIdx;
              return (
                <button
                  type="button"
                  key={c.id}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={(e) => {
                    // mousedown so the input doesn't blur first.
                    e.preventDefault();
                    pickSuggestion(c);
                  }}
                  className={
                    "block w-full px-3 py-2 text-left text-sm " +
                    (active ? "bg-accent-50 text-accent-900" : "text-ink-800 hover:bg-ink-50")
                  }
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{c.full_name || c.primary_email}</span>
                    {c.full_name && c.primary_email && (
                      <span className="text-xs text-ink-500">{c.primary_email}</span>
                    )}
                  </div>
                  {c.org && <div className="text-xs text-ink-500">{c.org}</div>}
                </button>
              );
            })}
            {showAddTyped && (
              <button
                type="button"
                role="option"
                aria-selected={activeIdx === suggestions.length}
                onMouseEnter={() => setActiveIdx(suggestions.length)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickTyped();
                }}
                className={
                  "block w-full border-t border-ink-100 px-3 py-2 text-left text-sm " +
                  (activeIdx === suggestions.length
                    ? "bg-accent-50 text-accent-900"
                    : "text-ink-700 hover:bg-ink-50")
                }
              >
                Add <span className="font-medium">{query}</span>
              </button>
            )}
          </div>
        )}
      </div>
      <input
        className="field col-span-5"
        placeholder="Name (optional)"
        value={name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <button
        type="button"
        className="btn-secondary col-span-1"
        onClick={onRemove}
        aria-label="remove"
      >
        ×
      </button>
    </div>
  );
}
