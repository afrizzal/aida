import { Badge } from "@/components/ui/badge";
import type { TicketPriority } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

const PRIORITY_MAP: Record<TicketPriority, { classes: string; label: string }> = {
  LOW: { classes: "border border-border text-muted-foreground", label: "Low" },
  NORMAL: { classes: "border border-border text-foreground", label: "Normal" },
  HIGH: { classes: "bg-warning/10 text-warning border border-warning/20", label: "High" },
  URGENT: {
    classes: "bg-destructive/10 text-destructive border border-destructive/20",
    label: "Urgent",
  },
};

export function PriorityChip({ priority }: { priority: TicketPriority }) {
  const { classes, label } = PRIORITY_MAP[priority];

  return <Badge className={cn("h-5 px-2 py-0.5 text-[12px]", classes)}>{label}</Badge>;
}
