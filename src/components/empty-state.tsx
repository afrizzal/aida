import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  heading: string;
  body: string;
  /**
   * The heading element (AIDA-36, D-14). Default "h2". A state whose EmptyState is the page's only
   * title (a not-found or access-ended branch) passes "h1" so its visible heading is the page's
   * one h1. Classes are the same either way.
   */
  headingAs?: "h1" | "h2";
}

export function EmptyState({ icon: Icon, heading, body, headingAs = "h2" }: EmptyStateProps) {
  const Heading = headingAs;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 -m-3 rounded-2xl bg-primary/5 blur-[2px]"
          aria-hidden
        />
        <div className="relative flex size-14 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary shadow-sm">
          <Icon className="size-6" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Heading className="text-[18px] font-semibold tracking-tight text-foreground">
          {heading}
        </Heading>
        <p className="mx-auto max-w-md text-[14px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
