"use client";

// The top-bar notification bell (Phase 10, AIDA-44, D-19, UI-SPEC Surface 3 with amendment A8).
//
// The unread count is read from GET /api/notifications?view=count with a same-origin fetch (the CSP
// allows connect-src 'self' only, V-01) every NOTIFICATION_POLL_INTERVAL_MS while the tab is
// visible. Polling pauses when the tab is hidden and refetches once when it becomes visible again
// (the setInterval pattern of proposal-list-refresh.tsx). A failed poll keeps the last known
// count and never shows an error on the trigger; the next interval tries again.
//
// Opening the popover fetches the list fresh (view=list, the 20 most recent not-archived rows).
// Mark as read, Mark all read and Archive are server actions (src/app/(app)/notification-actions.ts)
// that change only the caller's own rows; the row changes only after the server confirms, and the
// count refetches after each action. Every runtime value (subject, actor name) renders as escaped
// React text, never as HTML.

import type { LucideIcon } from "lucide-react";
import {
  Archive,
  AtSign,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  MessageSquare,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  archiveNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(app)/notification-actions";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format-relative-time";
import {
  type BellListItem,
  type BellListResponse,
  bellLabel,
  formatBellCount,
  notificationSentence,
  notificationSubject,
} from "@/lib/notifications/format";
import {
  NOTIFICATION_POLL_INTERVAL_MS,
  type NotificationTypeName,
} from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

const COUNT_URL = "/api/notifications?view=count";
const LIST_URL = "/api/notifications?view=list";

/** How long an archived row fades before it leaves the list (instant under reduced motion). */
const ARCHIVE_FADE_MS = 150;

// The Copywriting Contract rows "Bell ...", verbatim.
const COPY = {
  title: "Notifications",
  markAll: "Mark all read",
  markRead: "Mark as read",
  archive: "Archive notification",
  emptyHeading: "You're all caught up",
  emptyBody: "Assignments, customer replies, mentions and SLA alerts for you show up here.",
  listCap: "Showing the 20 most recent.",
  loadError: "Notifications could not be loaded. Try again.",
  retry: "Try again",
  actionError: "That change could not be saved. Try again.",
  loading: "Loading notifications",
  unread: "Unread. ",
} as const;

const TYPE_ICON: Readonly<Record<NotificationTypeName, { icon: LucideIcon; tone: string }>> = {
  ASSIGNED: { icon: UserCheck, tone: "text-muted-foreground" },
  CUSTOMER_REPLY: { icon: MessageSquare, tone: "text-muted-foreground" },
  MENTION: { icon: AtSign, tone: "text-muted-foreground" },
  SLA_AT_RISK: { icon: Clock, tone: "text-warning" },
  SLA_BREACHED: { icon: TriangleAlert, tone: "text-destructive" },
};

/**
 * The unread count, polled while the tab is visible. Only the newest request may set the count,
 * so a slow poll never overwrites a fresher value.
 */
function useUnreadCount(): { count: number; refresh: () => Promise<void> } {
  const [count, setCount] = useState(0);
  const latest = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const res = await fetch(COUNT_URL, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const body: unknown = await res.json();
      const next = (body as { count?: unknown } | null)?.count;
      if (typeof next !== "number" || !Number.isInteger(next) || next < 0) return;
      if (mounted.current && request === latest.current) setCount(next);
    } catch {
      // Keep the last known count; the next interval retries.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void refresh(), NOTIFICATION_POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      void refresh();
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [refresh]);

  return { count, refresh };
}

type ListState = "loading" | "error" | "ready";

function isListResponse(body: unknown): body is BellListResponse {
  const value = body as Partial<BellListResponse> | null;
  return !!value && Array.isArray(value.items) && typeof value.hasMore === "boolean";
}

export function NotificationBell() {
  const { count, refresh } = useUnreadCount();
  const pill = formatBellCount(count);
  const titleId = useId();

  const [open, setOpen] = useState(false);
  const [listState, setListState] = useState<ListState>("loading");
  const [items, setItems] = useState<BellListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [fading, setFading] = useState<ReadonlySet<string>>(new Set());
  const [markAllPending, setMarkAllPending] = useState(false);
  const loaded = useRef(false);
  const latestList = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const request = ++latestList.current;
    // The first load shows skeleton rows; a reopen keeps the last list while it refetches.
    if (!loaded.current) setListState("loading");
    try {
      const res = await fetch(LIST_URL, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error("list failed");
      const body: unknown = await res.json();
      if (!isListResponse(body)) throw new Error("list malformed");
      if (request !== latestList.current) return;
      loaded.current = true;
      setItems(body.items);
      setHasMore(body.hasMore);
      setListState("ready");
    } catch {
      if (request !== latestList.current) return;
      loaded.current = false;
      setItems([]);
      setHasMore(false);
      setListState("error");
    }
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setActionError(false);
      void loadList();
      void refresh();
    }
  }

  function setRowPending(id: string, on: boolean) {
    setPending((prev) => {
      const copy = new Set(prev);
      if (on) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  async function markRead(id: string): Promise<boolean> {
    setRowPending(id, true);
    const result = await markNotificationReadAction(id).catch(() => null);
    setRowPending(id, false);
    if (!result?.ok) {
      setActionError(true);
      return false;
    }
    setActionError(false);
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)));
    void refresh();
    return true;
  }

  async function archiveRow(id: string) {
    setRowPending(id, true);
    const result = await archiveNotificationAction(id).catch(() => null);
    if (!result?.ok) {
      setRowPending(id, false);
      setActionError(true);
      return;
    }
    setActionError(false);
    // The row's buttons go away with it: keep focus inside the popover.
    contentRef.current?.focus();
    setFading((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
      setFading((prev) => {
        const copy = new Set(prev);
        copy.delete(id);
        return copy;
      });
      setRowPending(id, false);
    }, ARCHIVE_FADE_MS);
    void refresh();
  }

  async function markAllRead() {
    setMarkAllPending(true);
    const result = await markAllNotificationsReadAction().catch(() => null);
    setMarkAllPending(false);
    if (!result?.ok) {
      setActionError(true);
      return;
    }
    setActionError(false);
    setItems((prev) => prev.map((item) => (item.read ? item : { ...item, read: true })));
    void refresh();
  }

  function onRowLinkClick(item: BellListItem) {
    setOpen(false);
    if (!item.read) void markRead(item.id);
  }

  const unreadInList = items.some((item) => !item.read);
  const markAllDisabled = markAllPending || (count === 0 && !unreadInList);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={bellLabel(count)}
        >
          <Bell className="size-4" />
          {pill && (
            <Badge
              aria-hidden
              className="absolute -top-1 -right-1 h-5 min-w-5 justify-center rounded-full border-transparent bg-primary px-1 text-[12px] font-semibold text-primary-foreground"
            >
              {pill}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        tabIndex={-1}
        aria-labelledby={titleId}
        className="w-[360px] gap-0 p-0 text-[13px] outline-none"
      >
        <div className="flex items-center justify-between px-4 py-2">
          <p id={titleId} className="text-[15px] font-semibold tracking-tight">
            {COPY.title}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 px-2 text-[13px]"
            disabled={markAllDisabled}
            onClick={() => void markAllRead()}
          >
            <CheckCheck className="size-4" />
            {COPY.markAll}
          </Button>
        </div>
        <Separator />

        {actionError && listState === "ready" && (
          <div
            role="alert"
            className="mx-4 my-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
          >
            {COPY.actionError}
          </div>
        )}

        {listState === "loading" && (
          <div role="status" className="py-2">
            <span className="sr-only">{COPY.loading}</span>
            <Skeleton className="mx-4 my-2 h-12" />
            <Skeleton className="mx-4 my-2 h-12" />
            <Skeleton className="mx-4 my-2 h-12" />
          </div>
        )}

        {listState === "error" && (
          <div
            role="alert"
            className="mx-4 my-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
          >
            <span>{COPY.loadError}</span>
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-[13px]"
              onClick={() => void loadList()}
            >
              {COPY.retry}
            </Button>
          </div>
        )}

        {listState === "ready" && items.length === 0 && (
          <EmptyState
            icon={BellOff}
            heading={COPY.emptyHeading}
            body={COPY.emptyBody}
            className="min-h-0 px-4 py-8"
          />
        )}

        {listState === "ready" && items.length > 0 && (
          <TooltipProvider>
            <ul className="max-h-[420px] overflow-y-auto">
              {items.map((item) => (
                <BellRow
                  key={item.id}
                  item={item}
                  pending={pending.has(item.id)}
                  fading={fading.has(item.id)}
                  onLinkClick={() => onRowLinkClick(item)}
                  onMarkRead={() => void markRead(item.id)}
                  onArchive={() => void archiveRow(item.id)}
                />
              ))}
            </ul>
            {hasMore && (
              <p className="px-4 py-2 text-[12px] text-muted-foreground">{COPY.listCap}</p>
            )}
          </TooltipProvider>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface BellRowProps {
  item: BellListItem;
  pending: boolean;
  fading: boolean;
  onLinkClick: () => void;
  onMarkRead: () => void;
  onArchive: () => void;
}

function BellRow({ item, pending, fading, onLinkClick, onMarkRead, onArchive }: BellRowProps) {
  const unread = !item.read;
  const { icon: Icon, tone } = TYPE_ICON[item.type] ?? TYPE_ICON.ASSIGNED;
  const sentence = notificationSentence({
    type: item.type,
    ticketNumber: item.ticketNumber,
    actorName: item.actorName,
  });

  const text = (
    <>
      <p
        className={cn(
          "break-words text-[13px] text-foreground",
          unread ? "font-semibold" : "font-normal",
        )}
      >
        {unread && <span className="sr-only">{COPY.unread}</span>}
        {sentence}
      </p>
      <p className="truncate text-[12px] text-muted-foreground">
        {notificationSubject(item.ticketSubject)} ·{" "}
        <time dateTime={item.createdAt}>{formatRelativeTime(item.createdAt)}</time>
      </p>
    </>
  );

  return (
    <li
      className={cn(
        "group flex items-start gap-2 px-4 py-2 transition-opacity motion-reduce:transition-none",
        unread && "bg-muted/40",
        fading && "opacity-0",
      )}
    >
      <span
        aria-hidden
        className={cn("mt-2 size-2 shrink-0 rounded-full", unread && "bg-primary")}
      />
      <Icon aria-hidden className={cn("mt-1 size-4 shrink-0", tone)} />
      {item.ticketId ? (
        <Link
          href={`/tickets/${item.ticketId}`}
          onClick={onLinkClick}
          className="block min-w-0 flex-1 space-y-1 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {text}
        </Link>
      ) : (
        <div className="min-w-0 flex-1 space-y-1">{text}</div>
      )}
      <div className="flex shrink-0 gap-1">
        {unread && (
          <RowAction label={COPY.markRead} disabled={pending} onClick={onMarkRead}>
            <Check className="size-4" />
          </RowAction>
        )}
        <RowAction label={COPY.archive} disabled={pending} onClick={onArchive}>
          <Archive className="size-4" />
        </RowAction>
      </div>
    </li>
  );
}

function RowAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="text-[12px]">{label}</TooltipContent>
    </Tooltip>
  );
}
