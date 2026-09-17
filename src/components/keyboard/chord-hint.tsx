"use client";

// The chord hint (Phase 11, AIDA-50, UI-SPEC Surface 5d): while a g chord is pending, a small
// visual hint at the bottom right shows a g key cap and "then a letter". It renders only from
// the provider's chord state and keeps no timer of its own: the dispatcher's chord timer clears
// that state after CHORD_TIMEOUT_MS, so the hint disappears with no further key (Codex review
// C9), as it does when the chord completes or is cancelled. aria-hidden, because it only
// mirrors a keystroke the user just made.
import { KeyCap } from "@/components/keyboard/key-caps";

export function ChordHint({ pending }: { pending: boolean }) {
  if (!pending) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex items-center gap-1 whitespace-nowrap rounded-md border border-border/70 bg-popover px-2 py-1 text-[12px] text-muted-foreground shadow-sm transition-opacity motion-reduce:transition-none"
    >
      <KeyCap>g</KeyCap>
      then a letter
    </div>
  );
}
