import {
  AlarmClock,
  CircleDot,
  Flag,
  History,
  Link2,
  type LucideIcon,
  Merge,
  Sunrise,
  Tag,
  Unlink2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { LocalDateTime } from "@/components/tickets/local-date-time";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { ActivityIconName, DescribedEvent } from "@/lib/tickets/activity-copy";

const ICONS: Record<ActivityIconName, LucideIcon> = {
  AlarmClock,
  CircleDot,
  Flag,
  History,
  Link2,
  Merge,
  Sunrise,
  Tag,
  Unlink2,
  UserRound,
};

// The server has no viewer time zone, so the title states the full time in UTC, as the first
// render of LocalDateTime does (UI-SPEC 4a).
const TITLE_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

// UI-SPEC Surface 6: one audit row in the activity feed, in the existing system-event style
// plus an icon and a relative time. Server-rendered and agent-only.
export function ActivityEventRow({
  described,
  createdAt,
}: {
  described: DescribedEvent;
  createdAt: Date;
}) {
  const Icon = ICONS[described.icon];
  const iso = createdAt.toISOString();
  return (
    <li className="flex items-center justify-center gap-2 py-1 text-center text-[12px] text-muted-foreground">
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        {described.parts.map((part, index) => {
          const key = `${part.type}-${index}`;
          if (part.type === "ticket") {
            return (
              <Link
                key={key}
                href={`/tickets/${part.id}`}
                className="text-foreground hover:text-primary-emphasis hover:underline"
              >
                #{part.number}
              </Link>
            );
          }
          if (part.type === "time") return <LocalDateTime key={key} value={part.iso} />;
          return <span key={key}>{part.text}</span>;
        })}
        <span aria-hidden="true"> · </span>
        <time dateTime={iso} title={`${TITLE_FORMAT.format(createdAt)} UTC`}>
          {formatRelativeTime(createdAt)}
        </time>
      </span>
    </li>
  );
}
