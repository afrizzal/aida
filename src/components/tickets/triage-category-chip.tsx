import { Badge } from "@/components/ui/badge";
import type { TriageCategory } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<TriageCategory, string> = {
  BILLING: "Billing",
  TECHNICAL: "Technical",
  ACCOUNT: "Account",
  FEATURE_REQUEST: "Feature Request",
  OTHER: "Other",
};

export function TriageCategoryChip({
  category,
  className,
}: {
  category: TriageCategory;
  className?: string;
}) {
  return (
    <Badge className={cn("h-5 px-2 py-0.5 text-[12px] border border-border text-foreground", className)}>
      {CATEGORY_LABEL[category]}
    </Badge>
  );
}
