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
  // Explicit locale + options: a bare toLocaleString() renders en-US on the server and the
  // OS locale on the client, which produced a React hydration mismatch on non-en-US machines.
  const fullTimestamp = new Date(dueAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Elapsed time is authoritative for DISPLAY. `isBreached`/`isAtRisk` are set only by the
  // recurring sla-flag worker job (02-05), so between runs a ticket can be genuinely past its
  // due time with both flags still false. Without this check the on-track branch below renders
  // `formatDueDuration`'s signed output as "Due in -22h". The DB flags still drive filtering
  // and reporting — this only makes the chip agree with the clock.
  const isPastDue = new Date(dueAt).getTime() < Date.now();

  if (isBreached || isPastDue) {
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
