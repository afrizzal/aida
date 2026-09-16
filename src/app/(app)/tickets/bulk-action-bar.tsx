"use client";

import { CircleDot, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TicketStatus } from "@/generated/prisma/client";
import { type BulkUpdateInput, bulkUpdateTickets } from "./bulk-actions";
import { useTicketSelection } from "./ticket-selection";

// The bulk action bar (Phase 11, AIDA-48, D-10, UI-SPEC Surface 3b). It applies one choice to
// exactly the selected ids through bulkUpdateTickets (all or nothing, audited per ticket).

type BulkOp = BulkUpdateInput["op"];

const STATUSES: { value: TicketStatus; label: string }[] = [
  { value: "NEW", label: "New" },
  { value: "OPEN", label: "Open" },
  { value: "PENDING", label: "Pending" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

export interface BulkActionBarTicket {
  id: string;
}

function tickets(count: number): string {
  return count === 1 ? "1 ticket" : `${count} tickets`;
}

export function BulkActionBar({ loaded }: { loaded: BulkActionBarTicket[] }) {
  const { selectedIds, clear, reportLoaded } = useTicketSelection();
  const [pending, setPending] = useState(false);
  const [openPicker, setOpenPicker] = useState<"status" | null>(null);

  // Report the rendered list so the selection is pruned to tickets on screen (Surface 3a).
  const loadedKey = loaded.map((ticket) => ticket.id).join(",");
  useEffect(() => {
    reportLoaded(loadedKey === "" ? [] : loadedKey.split(","));
  }, [loadedKey, reportLoaded]);

  if (selectedIds.length === 0) return null;

  async function run(op: BulkOp) {
    setOpenPicker(null);
    const ticketIds = [...selectedIds];
    setPending(true);
    try {
      const result = await bulkUpdateTickets({ ticketIds, op });
      if (result.ok) toast.success(`Applied to ${tickets(result.count)}.`);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-label="Bulk actions"
      className="sticky bottom-0 z-10 mt-auto space-y-2 border-t border-border/70 bg-background/95 px-4 py-2 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="text-[13px] font-semibold text-foreground">
          {pending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Updating {tickets(selectedIds.length)}…
            </span>
          ) : (
            `${tickets(selectedIds.length)} selected`
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="text-[13px]"
          disabled={pending}
          onClick={clear}
        >
          <X />
          Clear selection
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Popover
          open={openPicker === "status"}
          onOpenChange={(open) => setOpenPicker(open ? "status" : null)}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="text-[13px]" disabled={pending}>
              <CircleDot />
              Status
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[240px] p-0">
            <Command>
              <CommandList>
                <CommandGroup>
                  {STATUSES.map((status) => (
                    <CommandItem
                      key={status.value}
                      value={status.value}
                      className="text-[13px]"
                      onSelect={() => void run({ kind: "status", status: status.value })}
                    >
                      {status.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </section>
  );
}
