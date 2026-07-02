"use client";

import { cn } from "@/lib/utils";

export type ComposerMode = "public" | "internal";

interface ComposerToggleProps {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
}

/**
 * Bespoke segmented control (not shadcn Tabs) — Internal Note's active state is amber,
 * never primary/indigo, so the two composer modes stay visually unmistakable (D-10).
 */
export function ComposerToggle({ mode, onChange }: ComposerToggleProps) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => onChange("public")}
        className={cn(
          "h-7 px-3 text-[13px] font-medium",
          mode === "public" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
        )}
      >
        Public Reply
      </button>
      <button
        type="button"
        onClick={() => onChange("internal")}
        className={cn(
          "h-7 px-3 text-[13px] font-medium",
          mode === "internal"
            ? "bg-warning/10 text-warning"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        Internal Note
      </button>
    </div>
  );
}
