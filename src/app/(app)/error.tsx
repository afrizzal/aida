"use client";

import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getPageTitle } from "@/lib/navigation/page-title";

/**
 * The error state of every app route without an error.tsx of its own (K147, D-14, Phase 9 review
 * c-WR-02): /kb and its pages, /insights and every /settings page. It sits inside the (app)
 * layout, so the sidebar and the top bar stay, and it renders inside <main> with that state's one
 * h1: sr-only, the top-bar text for the current path. The routes that have their own boundary
 * (tickets, tickets/[id], contacts) keep their own copy. No error text is shown.
 */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  return (
    <>
      <h1 className="sr-only">{getPageTitle(pathname)}</h1>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-[13px] text-destructive">
        <span>Couldn't load this page.</span>
        <Button variant="link" onClick={() => reset()} className="h-auto p-0 text-[13px]">
          Retry
        </Button>
      </div>
    </>
  );
}
