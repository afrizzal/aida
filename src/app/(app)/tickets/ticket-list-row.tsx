import Link from "next/link";
import { AssigneeAvatar } from "@/components/tickets/assignee-avatar";
import { PriorityChip } from "@/components/tickets/priority-chip";
import { SlaDueChip } from "@/components/tickets/sla-due-chip";
import { StatusChip } from "@/components/tickets/status-chip";
import { TagChip, TagOverflowChip } from "@/components/tickets/tag-chip";
import { Skeleton } from "@/components/ui/skeleton";
import type { TicketListItem } from "@/lib/tickets/list-query";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_TAGS = 2;
const SKELETON_ROW_COUNT = 6;

/** Coarse relative-past formatter for the list row's Line-1 timestamp — mirrors the
 * coarseness (no seconds) of formatDueDuration, but for elapsed-since-now instead of
 * time-until. */
function formatRelativeTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Which SLA timer is still "live" for this ticket — mirrors the scoping the worker job
 * uses (src/lib/worker/jobs/sla-flag.ts): first-response until responded, then
 * resolution until resolved. Once both are satisfied there's nothing left to show.
 */
function getActiveDue(ticket: TicketListItem): Date | null {
  if (!ticket.firstRespondedAt) return ticket.firstResponseDueAt;
  if (!ticket.resolvedAt) return ticket.resolutionDueAt;
  return null;
}

export function TicketListRow({
  ticket,
  selected = false,
}: {
  ticket: TicketListItem;
  selected?: boolean;
}) {
  const activeDue = getActiveDue(ticket);
  const visibleTags = ticket.tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowCount = ticket.tags.length - visibleTags.length;

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className={cn(
        "block min-h-[80px] border-b border-border/70 px-4 py-3",
        selected ? "border-l-2 border-l-primary bg-accent" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="max-w-[70%] truncate text-[13px] font-medium text-foreground">
          {ticket.contact.name || ticket.contact.email}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {formatRelativeTime(ticket.updatedAt)}
        </span>
      </div>

      <p
        className={cn(
          "mt-0.5 truncate text-[14px]",
          ticket.status === "NEW" ? "font-medium" : "font-normal",
        )}
      >
        {ticket.subject}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <StatusChip status={ticket.status} />
        {(ticket.priority === "HIGH" || ticket.priority === "URGENT") && (
          <PriorityChip priority={ticket.priority} />
        )}
        {activeDue && (
          <SlaDueChip dueAt={activeDue} isAtRisk={ticket.isAtRisk} isBreached={ticket.isBreached} />
        )}
        {visibleTags.map(({ tag }) => (
          <TagChip key={tag.id} label={tag.name} />
        ))}
        {overflowCount > 0 && <TagOverflowChip count={overflowCount} />}
        <div className="ml-auto">
          <AssigneeAvatar name={ticket.assignee?.name} />
        </div>
      </div>
    </Link>
  );
}

export function TicketListSkeleton() {
  return (
    <div>
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder rows, never reordered
          key={index}
          className="min-h-[80px] space-y-2 border-b border-border/70 px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}
