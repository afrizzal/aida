import type { VariantProps } from "class-variance-authority";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { TriageSentiment } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

// NEUTRAL explicitly sets variant="outline" (07-09.1 Task 3 fix, same root cause as
// priority-chip.tsx/triage-category-chip.tsx): `classes` never overrode the background, so the
// unset variant silently inherited the Badge default's `bg-primary`, pairing it with
// `text-muted-foreground` — a real, axe-confirmed WCAG AA contrast failure.
const SENTIMENT_MAP: Record<
  TriageSentiment,
  { variant?: BadgeVariant; classes: string; label: string }
> = {
  POSITIVE: { classes: "bg-success/10 text-success border border-success/20", label: "Positive" },
  NEUTRAL: { variant: "outline", classes: "text-muted-foreground", label: "Neutral" },
  NEGATIVE: {
    classes: "bg-destructive/10 text-destructive border border-destructive/20",
    label: "Negative",
  },
};

export function TriageSentimentChip({
  sentiment,
  className,
}: {
  sentiment: TriageSentiment;
  className?: string;
}) {
  const { variant, classes, label } = SENTIMENT_MAP[sentiment];

  return (
    <Badge variant={variant} className={cn("h-5 px-2 py-0.5 text-[12px]", classes, className)}>
      {label}
    </Badge>
  );
}
