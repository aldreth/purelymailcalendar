import type { CSSProperties } from "react";
import type { EventOut, Mailbox } from "./types";

// An event from the All-accounts overlay carries these extra fields; we only
// read them here so non-merged callers (single-mailbox view) don't need to
// know the wider type.
type EventColorHint = EventOut & {
  mailbox_color?: string | null;
  mailbox_id?: number;
};

// Default palette used to seed a mailbox's color when the user hasn't picked
// one. Order matters: clicking the color chip on a switcher row cycles
// through this list. Stops kept high-contrast against the cream `accent-50`
// header background and white event chips. Tailwind doesn't see these
// because they're injected as inline styles by consumers.
export const MAILBOX_PALETTE: ReadonlyArray<string> = [
  "#7c3aed", // purple
  "#0d9488", // teal
  "#d97706", // amber
  "#e11d48", // rose
  "#0284c7", // sky
  "#65a30d", // lime
];

export function mailboxColor(mb: Pick<Mailbox, "id" | "color"> | null | undefined): string {
  if (!mb) return MAILBOX_PALETTE[0];
  if (mb.color && /^#[0-9a-fA-F]{6}$/.test(mb.color)) return mb.color.toLowerCase();
  return MAILBOX_PALETTE[Math.abs(mb.id) % MAILBOX_PALETTE.length];
}

export function nextPaletteColor(current: string | null | undefined): string {
  if (!current) return MAILBOX_PALETTE[0];
  const idx = MAILBOX_PALETTE.findIndex((c) => c.toLowerCase() === current.toLowerCase());
  if (idx === -1) return MAILBOX_PALETTE[0];
  return MAILBOX_PALETTE[(idx + 1) % MAILBOX_PALETTE.length];
}

/** Inline style for the 3px left-stripe on an event chip. Returns an empty
 * object when the event doesn't carry mailbox metadata (single-mailbox view),
 * so callers can always spread the return value into their existing `style`
 * prop without conditional branches. */
export function eventStripeStyle(ev: EventColorHint): CSSProperties {
  const color = ev.mailbox_color
    ? mailboxColor({ id: ev.mailbox_id ?? 0, color: ev.mailbox_color })
    : ev.mailbox_id != null
    ? mailboxColor({ id: ev.mailbox_id, color: null })
    : null;
  if (!color) return {};
  return {
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: color,
  };
}

/** Returns the mailbox color for an event, or null if not from the overlay. */
export function eventMailboxColor(ev: EventColorHint): string | null {
  if (ev.mailbox_id == null) return null;
  return mailboxColor({ id: ev.mailbox_id, color: ev.mailbox_color ?? null });
}
