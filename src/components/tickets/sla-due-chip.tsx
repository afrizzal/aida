import { AlertTriangle, CircleAlert, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDueDuration } from "@/lib/tickets/format-duration";
import { cn } from "@/lib/utils";

export function SlaDueChip({
  dueAt,
  isAtRisk,
  isBreached,
}: {
  dueAt: Date | string;
  isAtRisk: boolean;
  isBreached: boolean;
}) {
  const fullTimestamp = new Date(dueAt).toLocaleString();

  if (isBreached) {
    return (
      <Badge
        title={fullTimestamp}
        className={cn(
          "h-5 px-2 py-0.5 text-[12px]",
          "bg-destructive/10 text-destructive border border-destructive/20",
        )}
      >
        <CircleAlert className="size-3" />
        Overdue
      </Badge>
    );
  }

  if (isAtRisk) {
    return (
      <Badge
        title={fullTimestamp}
        className={cn(
          "h-5 px-2 py-0.5 text-[12px]",
          "bg-warning/10 text-warning border border-warning/20",
        )}
      >
        <AlertTriangle className="size-3" />
        At risk
      </Badge>
    );
  }

  return (
    <Badge
      title={fullTimestamp}
      className={cn(
        "h-5 px-2 py-0.5 text-[12px]",
        "bg-muted text-muted-foreground border border-border",
      )}
    >
      <Clock className="size-3" />
      Due in {formatDueDuration(dueAt)}
    </Badge>
  );
}
