"use client";

// The one global keyboard dispatcher (Phase 11, AIDA-49, AIDA-50, D-11, D-13, UI-SPEC Surface 5).
// Mounted once inside CommandProvider. It listens for keydown on window in the bubble phase, so
// every local handler (inputs, menus, popovers, dialogs, cmdk lists) runs first and an event a
// local handler handled arrives with defaultPrevented set. Each event is decided by decideKey
// (src/lib/keyboard/dispatch.ts) from the key table (src/lib/keyboard/keymap.ts); this component
// only builds the snapshot and performs the decision.
//
// The pending g chord lives in CommandProvider (the chord hint reads it). This component owns
// the one chord timer (Codex review C9): it starts with a newly pending g and stops when the
// chord completes, is cancelled or dropped, on Esc, on window blur, on navigation and on unmount;
// its expiry clears the chord state, and with it the hint.
//
// A command runs only while it is registered and its when(context) holds. No inline script
// (D-20): this is a client module in the app shell.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCommands } from "@/components/command-provider";
import {
  type ChordState,
  createChordTimer,
  decideKey,
  type KeyAction,
  type KeySnapshot,
} from "@/lib/keyboard/dispatch";

/** Radix wraps popovers, dropdown menus and selects in this element. */
const POPPER_WRAPPER = "[data-radix-popper-content-wrapper]";
const OVERLAY_SELECTOR = `[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], ${POPPER_WRAPPER}`;
const OPEN_MODAL_SELECTOR =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isInOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY_SELECTOR) !== null;
}

/**
 * Whether a modal dialog other than the palette is open. Popovers also carry role="dialog", so
 * anything inside a Radix popper wrapper does not count.
 */
function isOtherModalOpen(): boolean {
  for (const element of document.querySelectorAll(OPEN_MODAL_SELECTOR)) {
    if (element.querySelector("[data-command-palette]")) continue;
    if (element.closest(POPPER_WRAPPER)) continue;
    return true;
  }
  return false;
}

interface KeyboardDispatcherProps {
  /** The provider's chord state setter (the chord hint renders from that state). */
  setChord(chord: ChordState | null): void;
  openHelp(): void;
}

export function KeyboardDispatcher({ setChord, openHelp }: KeyboardDispatcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { open: paletteOpen, togglePalette, registry, context } = useCommands();

  // The latest values, read by the one window listener.
  const latest = useRef({ paletteOpen, togglePalette, registry, context, router, openHelp });
  latest.current = { paletteOpen, togglePalette, registry, context, router, openHelp };

  const chordRef = useRef<ChordState | null>(null);
  const setChordRef = useRef(setChord);
  setChordRef.current = setChord;

  const [timer] = useState(() =>
    createChordTimer(() => {
      chordRef.current = null;
      setChordRef.current(null);
    }),
  );

  // Moves the chord state and keeps the timer in step with it.
  const updateChord = useRef((next: ChordState | null) => {
    const previous = chordRef.current;
    if (next === previous) return;
    if (next === null) timer.stop();
    else timer.start();
    chordRef.current = next;
    setChordRef.current(next);
  }).current;

  useEffect(() => {
    function runCommand(commandId: string): boolean {
      const { registry, context } = latest.current;
      const command = registry.visible(context).find((candidate) => candidate.id === commandId);
      if (!command) return false;
      command.run(context);
      return true;
    }

    function perform(action: KeyAction): boolean {
      switch (action.type) {
        case "togglePalette":
          latest.current.togglePalette();
          return true;
        case "navigate":
          latest.current.router.push(action.href);
          return true;
        case "run":
          return runCommand(action.commandId);
        case "openHelp":
          latest.current.openHelp();
          return true;
        case "escape":
          return runCommand("list.clearSelection");
        default:
          return false;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const snapshot: KeySnapshot = {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
        defaultPrevented: event.defaultPrevented,
        targetEditable: isEditable(event.target),
        targetInOverlay: isInOverlay(event.target),
        modalOpen: isOtherModalOpen(),
        paletteOpen: latest.current.paletteOpen,
      };
      const decision = decideKey(snapshot, chordRef.current, Date.now());
      updateChord(decision.nextChordState);
      const performed = perform(decision.action);
      // A newly pending g also suppresses the browser's default for that key.
      const startedChord = decision.nextChordState !== null && decision.action.type === "none";
      if (decision.preventDefault && (performed || startedChord)) event.preventDefault();
    }

    function onBlur() {
      updateChord(null);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
      timer.stop();
      chordRef.current = null;
    };
  }, [timer, updateChord]);

  // Navigation cancels a pending chord.
  useEffect(() => {
    if (pathname) updateChord(null);
  }, [pathname, updateChord]);

  return null;
}
