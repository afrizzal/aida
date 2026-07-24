"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const PERIODS = [7, 30, 90] as const;

interface PeriodTabsProps {
  active: 7 | 30 | 90;
}

/**
 * Period selector pills (7/30/90 days) — writes the `period` URL searchParam via
 * router.replace, mirroring FilterChipRow's updateParams URL-state pattern.
 */
export function PeriodTabs({ active }: PeriodTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectPeriod(period: (typeof PERIODS)[number]) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", String(period));
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1">
      {PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          onClick={() => selectPeriod(period)}
          className={cn(
            "h-8 rounded-full px-3 text-[13px] font-medium transition-colors",
            active === period
              ? "bg-sidebar-accent text-primary"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          {period}d
        </button>
      ))}
    </div>
  );
}
