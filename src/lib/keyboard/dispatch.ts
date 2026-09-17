// The keyboard decision logic (Phase 11, AIDA-49, AIDA-50, D-11, D-13, UI-SPEC Surface 5a).
// decideKey is pure: the dispatcher (src/components/keyboard/keyboard-dispatcher.tsx) builds a
// snapshot of one keydown event and of the page, passes the pending chord and the time, and
// performs the returned action. Plain TypeScript: no React and no DOM references.
//
// Rule order (D-13, Codex review C4):
// 1. Universal guards, for every key including ⌘K and Ctrl+K: an event a local handler already
//    handled (defaultPrevented), a key repeat, or an IME composition gives nothing.
// 2. The palette key (k or K with Meta or Ctrl, no Alt): with the palette open it closes it; with
//    another modal dialog open, or with focus inside an open popover or menu, it does nothing;
//    otherwise it opens the palette, also from an input. The editable target is the only guard
//    this exception bypasses.
// 3. Any other key with Ctrl, Alt or Meta, a target in an input, textarea, select or
//    contenteditable, a target inside an open dialog, popover or menu, or any open modal gives
//    nothing, so local handlers win.
// 4. A pending g (younger than CHORD_TIMEOUT_MS): a Go to letter navigates, Esc and any other key
//    cancel the chord. An expired chord is dropped and the key is decided fresh.
// 5. Esc gives escape; g starts a chord; ? opens the help modal; a key bound to a command runs it.
// Shift is accepted only as part of the produced character ("?"), because keys are matched on
// the character, never on the physical key.

import { CHORD_PREFIX, chordEntryFor, commandEntryFor } from "./keymap";

/** A g chord expires this long after the g. */
export const CHORD_TIMEOUT_MS = 1000;

export interface KeySnapshot {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  /** The target is an input, textarea, select or contenteditable. */
  targetEditable: boolean;
  /** The target is inside an open dialog, popover, menu or listbox. */
  targetInOverlay: boolean;
  /** A modal dialog other than the palette is open. */
  modalOpen: boolean;
  paletteOpen: boolean;
}

/** A pending g chord: when the g was pressed. */
export interface ChordState {
  startedAt: number;
}

export type KeyAction =
  | { type: "none" }
  | { type: "togglePalette" }
  | { type: "navigate"; href: string }
  | { type: "run"; commandId: string }
  | { type: "openHelp" }
  | { type: "escape" };

export interface KeyDecision {
  action: KeyAction;
  nextChordState: ChordState | null;
  /** Whether the dispatcher calls preventDefault once it has performed the action. */
  preventDefault: boolean;
}

const NONE: KeyAction = { type: "none" };

/** Keys that only modify another key; they never cancel a chord or do anything themselves. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "AltGraph",
  "Fn",
]);

function decision(
  action: KeyAction,
  nextChordState: ChordState | null,
  preventDefault = false,
): KeyDecision {
  return { action, nextChordState, preventDefault };
}

export function decideKey(
  snapshot: KeySnapshot,
  chordState: ChordState | null,
  now: number,
): KeyDecision {
  // An expired chord is dropped before anything else is decided.
  const pending =
    chordState !== null && now - chordState.startedAt < CHORD_TIMEOUT_MS ? chordState : null;

  // 1. Universal guards (every key, ⌘K and Ctrl+K included).
  if (snapshot.defaultPrevented || snapshot.repeat || snapshot.isComposing) {
    return decision(NONE, pending);
  }

  // 2. The palette key.
  const isPaletteKey =
    (snapshot.key === "k" || snapshot.key === "K") &&
    (snapshot.metaKey || snapshot.ctrlKey) &&
    !snapshot.altKey;
  if (isPaletteKey) {
    if (snapshot.paletteOpen) return decision({ type: "togglePalette" }, null, true);
    if (snapshot.modalOpen || snapshot.targetInOverlay) return decision(NONE, null);
    return decision({ type: "togglePalette" }, null, true);
  }

  if (MODIFIER_KEYS.has(snapshot.key)) return decision(NONE, pending);

  // 3. Local handlers win.
  if (
    snapshot.ctrlKey ||
    snapshot.altKey ||
    snapshot.metaKey ||
    snapshot.targetEditable ||
    snapshot.targetInOverlay ||
    snapshot.modalOpen ||
    snapshot.paletteOpen
  ) {
    return decision(NONE, null);
  }

  // 4. A pending chord.
  if (pending !== null) {
    const entry = chordEntryFor(snapshot.key);
    if (entry?.href) return decision({ type: "navigate", href: entry.href }, null, true);
    return decision(NONE, null);
  }

  // 5. Fresh keys.
  if (snapshot.key === "Escape") return decision({ type: "escape" }, null);
  if (snapshot.key === CHORD_PREFIX) return decision(NONE, { startedAt: now }, true);
  if (snapshot.key === "?") return decision({ type: "openHelp" }, null, true);
  const entry = commandEntryFor(snapshot.key);
  if (entry?.commandId) return decision({ type: "run", commandId: entry.commandId }, null, true);
  return decision(NONE, null);
}

export interface ChordTimer {
  /** Clears any running timer, then calls onExpire once after the timeout. */
  start(): void;
  /** Clears the running timer without calling onExpire. */
  stop(): void;
}

/**
 * The timer that clears a pending chord (and with it the chord hint) when no further key comes
 * (Codex review C9). Uses the global setTimeout and clearTimeout only.
 */
export function createChordTimer(
  onExpire: () => void,
  timeoutMs: number = CHORD_TIMEOUT_MS,
): ChordTimer {
  let handle: ReturnType<typeof setTimeout> | null = null;

  function stop() {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
  }

  return {
    start() {
      stop();
      handle = setTimeout(() => {
        handle = null;
        onExpire();
      }, timeoutMs);
    },
    stop,
  };
}
