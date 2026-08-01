import type { VariantProps } from "class-variance-authority";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { TicketPriority } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

// LOW/NORMAL explicitly set variant="outline" (07-09.1 Task 3 fix): neither `classes` string
// overrides the background, so leaving `variant` unset silently inherited the Badge default
// variant's `bg-primary` — a real bug (axe-core color-contrast found the resulting
// bg-primary/text-foreground and bg-primary/text-muted-foreground pairs both well under WCAG
// AA's 4.5:1). `variant="outline"` gives the intended neutral, unfilled look
// (border-border text-foreground) that `classes` was already trying to express.
const PRIORITY_MAP: Record<
  TicketPriority,
  { variant?: BadgeVariant; classes: string; label: string }
> = {
  LOW: { variant: "outline", classes: "text-muted-foreground", label: "Low" },
  NORMAL: { variant: "outline", classes: "", label: "Normal" },
  HIGH: { classes: "bg-warning/10 text-warning border border-warning/20", label: "High" },
  URGENT: {
    classes: "bg-destructive/10 text-destructive border border-destructive/20",
    label: "Urgent",
  },
};

export function PriorityChip({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string;
}) {
  const { variant, classes, label } = PRIORITY_MAP[priority];

  return (
    <Badge variant={variant} className={cn("h-5 px-2 py-0.5 text-[12px]", classes, className)}>
      {label}
    </Badge>
  );
}
