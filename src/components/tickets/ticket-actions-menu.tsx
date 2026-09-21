"use client";

// "More ticket actions" in the ticket top bar (UI-SPEC Surface 1): Link a ticket… and Merge into
// another ticket…. The Merge item stays visible but disabled, with its reason, on a merged source
// and on a ticket that has received merges (D-07); the server refuses both anyway.

import { Ellipsis, Link2, Merge } from "lucide-react";
import { useState } from "react";
import { LinkTicketDialog } from "@/components/tickets/link-ticket-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TicketStatus } from "@/generated/prisma/client";

export interface TicketActionsMenuProps {
  ticketId: string;
  ticketNumber: number;
  ticketSubject: string;
  ticketStatus: TicketStatus;
  mergedSource: boolean;
  hasReceivedMerges: boolean;
}

/** The Copywriting "Merge unavailable" reason, or null when Merge is offered. */
export function mergeUnavailableReason(mergedSource: boolean, hasReceivedMerges: boolean) {
  if (mergedSource) return "This ticket was already merged.";
  if (hasReceivedMerges) {
    return "Other tickets were merged into this one, so it can't be merged again.";
  }
  return null;
}

export function TicketActionsMenu({
  ticketId,
  ticketNumber,
  mergedSource,
  hasReceivedMerges,
}: TicketActionsMenuProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const mergeReason = mergeUnavailableReason(mergedSource, hasReceivedMerges);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="More ticket actions">
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          <DropdownMenuItem className="gap-2 text-[13px]" onSelect={() => setLinkOpen(true)}>
            <Link2 className="size-4" />
            Link a ticket…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={mergeReason !== null}
            className="items-start gap-2 text-[13px]"
          >
            <Merge className="size-4" />
            <span className="flex flex-col">
              <span>Merge into another ticket…</span>
              {mergeReason && (
                <span className="text-[12px] text-muted-foreground">{mergeReason}</span>
              )}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LinkTicketDialog
        ticketId={ticketId}
        ticketNumber={ticketNumber}
        open={linkOpen}
        onOpenChange={setLinkOpen}
      />
    </>
  );
}
