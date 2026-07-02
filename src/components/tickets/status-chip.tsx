import { Badge } from "@/components/ui/badge";
import type { TicketStatus } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

const STATUS_MAP: Record<TicketStatus, { classes: string; label: string }> = {
  NEW: { classes: "bg-primary text-primary-foreground", label: "New" },
  OPEN: { classes: "bg-primary/10 text-primary border border-primary/20", label: "Open" },
  PENDING: { classes: "bg-warning/10 text-warning border border-warning/20", label: "Pending" },
  RESOLVED: { classes: "bg-success/10 text-success border border-success/20", label: "Resolved" },
  CLOSED: { classes: "bg-muted text-muted-foreground border border-border", label: "Closed" },
};

export function StatusChip({ status }: { status: TicketStatus }) {
  const { classes, label } = STATUS_MAP[status];

  return <Badge className={cn("h-5 px-2 py-0.5 text-[12px]", classes)}>{label}</Badge>;
}
