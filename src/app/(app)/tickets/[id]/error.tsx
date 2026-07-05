"use client";

import { Button } from "@/components/ui/button";

export default function TicketDetailError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-r border-border p-4">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-[13px] text-destructive">
        <span>Couldn't load tickets.</span>
        <Button variant="link" onClick={() => reset()} className="h-auto p-0 text-[13px]">
          Retry
        </Button>
      </div>
    </aside>
  );
}
