"use client";

// The top-bar notification bell (Phase 10, AIDA-44, D-19, UI-SPEC Surface 3 with amendment A8).
//
// The unread count is read from GET /api/notifications?view=count with a same-origin fetch (the CSP
// allows connect-src 'self' only, V-01) every NOTIFICATION_POLL_INTERVAL_MS while the tab is
// visible. Polling pauses when the tab is hidden and refetches once when it becomes visible again
// (the setInterval pattern of proposal-list-refresh.tsx). A failed poll keeps the last known
// count and never shows an error on the trigger; the next interval tries again.

import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bellLabel, formatBellCount } from "@/lib/notifications/format";
import { NOTIFICATION_POLL_INTERVAL_MS } from "@/lib/notifications/types";

const COUNT_URL = "/api/notifications?view=count";

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

export function NotificationBell() {
  const { count } = useUnreadCount();
  const pill = formatBellCount(count);

  return (
    <Button variant="ghost" size="icon" className="relative size-8" aria-label={bellLabel(count)}>
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
  );
}
