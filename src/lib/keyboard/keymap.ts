// The one key table (Phase 11, AIDA-50, D-13, UI-SPEC Surface 5a). The keyboard dispatcher
// (src/lib/keyboard/dispatch.ts), the help modal, the palette's key caps and docs/KEYBOARD.md all
// read this table; a unit test fails when an entry is missing from the doc.
//
// Each entry does exactly one of:
// - href: a g chord that navigates (keys ["g", letter]); commandId names the palette's matching
//   Go to command, used only to show the key caps in the palette;
// - commandId: runs that registry command (only while it is registered and its when() holds);
// - special: handled by the dispatcher itself (togglePalette, openHelp, escape), or "browser" for
//   a key the browser already handles (Enter on a focused row link), where the dispatcher adds
//   nothing.
//
// No browser-reserved key is bound. Plain TypeScript: no React, no DOM.

export type KeymapSection = "general" | "goto" | "list" | "ticket";

export type KeymapSpecial = "togglePalette" | "openHelp" | "escape" | "browser";

/** The palette key: ⌘K on Apple platforms, Ctrl+K elsewhere. */
export const PALETTE_KEY = "Mod+K";

export interface KeymapEntry {
  id: string;
  section: KeymapSection;
  /** One key, or two for a g chord. "Mod+K" is the palette key; "Escape" and "Enter" are named. */
  keys: readonly string[];
  /** The Copywriting "Help actions" row. */
  label: string;
  commandId?: string;
  href?: string;
  special?: KeymapSpecial;
}

export const KEYMAP_SECTIONS: readonly { id: KeymapSection; heading: string }[] = [
  { id: "general", heading: "General" },
  { id: "goto", heading: "Go to" },
  { id: "list", heading: "Ticket list" },
  { id: "ticket", heading: "Ticket page" },
];

export const KEYMAP: readonly KeymapEntry[] = [
  {
    id: "palette",
    section: "general",
    keys: [PALETTE_KEY],
    label: "Open or close the command palette",
    special: "togglePalette",
  },
  {
    id: "help",
    section: "general",
    keys: ["?"],
    label: "Show keyboard shortcuts",
    special: "openHelp",
    commandId: "help.shortcuts",
  },
  {
    id: "escape",
    section: "general",
    keys: ["Escape"],
    label: "Close a dialog, cancel a key sequence, or clear the selection",
    special: "escape",
  },
  {
    id: "goto.tickets",
    section: "goto",
    keys: ["g", "t"],
    label: "Go to Tickets",
    href: "/tickets",
    commandId: "nav.tickets",
  },
  {
    id: "goto.contacts",
    section: "goto",
    keys: ["g", "c"],
    label: "Go to Contacts",
    href: "/contacts",
    commandId: "nav.contacts",
  },
  {
    id: "goto.kb",
    section: "goto",
    keys: ["g", "k"],
    label: "Go to Knowledge Base",
    href: "/kb",
    commandId: "nav.kb",
  },
  {
    id: "goto.insights",
    section: "goto",
    keys: ["g", "i"],
    label: "Go to Insight",
    href: "/insights",
    commandId: "nav.insights",
  },
  {
    id: "goto.settings",
    section: "goto",
    keys: ["g", "s"],
    label: "Go to Settings",
    href: "/settings",
    commandId: "nav.settings",
  },
  {
    id: "list.next",
    section: "list",
    keys: ["j"],
    label: "Move to the next ticket",
    commandId: "list.next",
  },
  {
    id: "list.prev",
    section: "list",
    keys: ["k"],
    label: "Move to the previous ticket",
    commandId: "list.prev",
  },
  {
    id: "list.open",
    section: "list",
    keys: ["Enter"],
    label: "Open the highlighted ticket",
    special: "browser",
  },
  {
    id: "list.toggle",
    section: "list",
    keys: ["x"],
    label: "Select or unselect the highlighted ticket",
    commandId: "list.toggle",
  },
  {
    id: "ticket.assign",
    section: "ticket",
    keys: ["a"],
    label: "Assign the ticket",
    commandId: "ticket.assign",
  },
  {
    id: "ticket.status",
    section: "ticket",
    keys: ["s"],
    label: "Change the status",
    commandId: "ticket.status",
  },
  {
    id: "ticket.tag",
    section: "ticket",
    keys: ["t"],
    label: "Add a tag",
    commandId: "ticket.tag",
  },
  {
    id: "ticket.reply",
    section: "ticket",
    keys: ["r"],
    label: "Reply to the customer",
    commandId: "ticket.reply",
  },
  {
    id: "ticket.note",
    section: "ticket",
    keys: ["n"],
    label: "Write an internal note",
    commandId: "ticket.note",
  },
];

/** The chord prefix. */
export const CHORD_PREFIX = "g";

/** Display text of one key, without the platform modifier (formatKeys shows both platforms). */
function keyText(key: string): string {
  if (key === PALETTE_KEY) return "⌘K / Ctrl+K";
  if (key === "Escape") return "Esc";
  return key;
}

/**
 * The display text used by the help modal's rows and docs/KEYBOARD.md: "g then t",
 * "⌘K / Ctrl+K", "?", "Esc", "Enter", single letters lowercase.
 */
export function formatKeys(entry: KeymapEntry): string {
  return entry.keys.map(keyText).join(" then ");
}

/**
 * The key caps of an entry, one array of caps per step of the sequence (a chord has two steps,
 * shown with "then" between them). The palette key shows ⌘ on Apple platforms, Ctrl elsewhere.
 */
export function keyCaps(entry: KeymapEntry, apple: boolean): string[][] {
  return entry.keys.map((key) => {
    if (key === PALETTE_KEY) return [apple ? "⌘" : "Ctrl", "K"];
    if (key === "Escape") return ["Esc"];
    return [key];
  });
}

/** The entry that names a palette command id, if any (key caps on palette items). */
export function keymapEntryForCommand(commandId: string): KeymapEntry | undefined {
  return KEYMAP.find((entry) => entry.commandId === commandId);
}

/** The g chord entry for a second key, if any. */
export function chordEntryFor(key: string): KeymapEntry | undefined {
  return KEYMAP.find(
    (entry) => entry.keys.length === 2 && entry.keys[0] === CHORD_PREFIX && entry.keys[1] === key,
  );
}

/** The single-key entry that runs a registry command, if any. */
export function commandEntryFor(key: string): KeymapEntry | undefined {
  return KEYMAP.find(
    (entry) =>
      entry.keys.length === 1 &&
      entry.keys[0] === key &&
      entry.special === undefined &&
      entry.commandId !== undefined,
  );
}
