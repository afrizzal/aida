import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  heading: string;
  body: string;
}

export function EmptyState({ icon: Icon, heading, body }: EmptyStateProps) {
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
        <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
          {heading}
        </h2>
        <p className="mx-auto max-w-md text-[14px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}
