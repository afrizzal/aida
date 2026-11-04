"use client";

import { Button } from "@/components/ui/button";

export default function TicketsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-r border-border p-4">
      {/* AIDA-36 (D-14, UI-SPEC Surface 5): the error state's one h1, sr-only. */}
      <h1 className="sr-only">Tickets</h1>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-[13px] text-destructive">
        <span>Couldn't load tickets.</span>
        <Button variant="link" onClick={() => reset()} className="h-auto p-0 text-[13px]">
          Retry
        </Button>
      </div>
    </aside>
  );
}
