"use client";

// Key caps for the help modal and the command palette (Phase 11, UI-SPEC Typography "Key cap").
// A plain <kbd> with token classes, not a new component package. A sequence (a g chord) shows
// its caps with a 12px muted "then" between the steps.
import { Fragment, useSyncExternalStore } from "react";
import { type KeymapEntry, keyCaps } from "@/lib/keyboard/keymap";
import { cn } from "@/lib/utils";

export const KEY_CAP_CLASS =
  "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[12px] text-foreground";

function isApplePlatform(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = data?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function subscribeNever(): () => void {
  return () => {};
}

/**
 * Whether to show ⌘ (Apple) or Ctrl. Decided on the client only (the server snapshot is false),
 * so it is settled by the time a dialog opens.
 */
export function useApplePlatform(): boolean {
  return useSyncExternalStore(subscribeNever, isApplePlatform, () => false);
}

export function KeyCap({ children, className }: { children: string; className?: string }) {
  return <kbd className={cn(KEY_CAP_CLASS, className)}>{children}</kbd>;
}

/** The key caps of one key table entry. */
export function KeyCaps({ entry, apple }: { entry: KeymapEntry; apple: boolean }) {
  const steps = keyCaps(entry, apple);
  return (
    <>
      {steps.map((caps, index) => (
        <Fragment key={caps.join("+")}>
          {index > 0 && <span className="text-[12px] text-muted-foreground">then</span>}
          {caps.map((cap) => (
            <KeyCap key={cap}>{cap}</KeyCap>
          ))}
        </Fragment>
      ))}
    </>
  );
}
