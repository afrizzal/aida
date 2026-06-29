import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  heading: string;
  body: string;
}

export function EmptyState({ icon: Icon, heading, body }: EmptyStateProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <Icon className="h-12 w-12 text-muted-foreground" />
      <h2 className="text-[18px] font-semibold">{heading}</h2>
      <p className="max-w-md text-[14px] text-muted-foreground">{body}</p>
    </div>
  );
}
