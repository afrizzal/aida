import { Badge } from "@/components/ui/badge";
import type { TriageSentiment } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

const SENTIMENT_MAP: Record<TriageSentiment, { classes: string; label: string }> = {
  POSITIVE: { classes: "bg-success/10 text-success border border-success/20", label: "Positive" },
  NEUTRAL: { classes: "border border-border text-muted-foreground", label: "Neutral" },
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
  const { classes, label } = SENTIMENT_MAP[sentiment];

  return <Badge className={cn("h-5 px-2 py-0.5 text-[12px]", classes, className)}>{label}</Badge>;
}
