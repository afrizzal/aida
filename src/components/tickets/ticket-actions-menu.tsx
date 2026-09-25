"use client";

// "More ticket actions" in the ticket top bar (UI-SPEC Surface 1): Link a ticket… and Merge into
// another ticket…. The Merge item stays visible but disabled, with its reason, on a merged source
// and on a ticket that has received merges (D-07); the server refuses both anyway.

import { Ellipsis, Link2, Merge } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { LinkTicketDialog } from "@/components/tickets/link-ticket-dialog";
import { MergeTicketDialog } from "@/components/tickets/merge-ticket-dialog";
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
  /** A ref to the menu trigger, for a parent that also moves focus to it. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
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
  ticketSubject,
  ticketStatus,
  mergedSource,
  hasReceivedMerges,
  triggerRef: parentTriggerRef,
}: TicketActionsMenuProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const mergeReason = mergeUnavailableReason(mergedSource, hasReceivedMerges);
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = parentTriggerRef ?? ownTriggerRef;

  // UI-SPEC Surface 1: both dialogs return focus to the menu trigger when they close. They are
  // opened from a menu item, not a DialogTrigger, so Radix has no trigger to return to and would
  // leave focus on <body> (review UI-WR-03).
  function returnFocusToTrigger(event: Event) {
    event.preventDefault();
    triggerRef.current?.focus();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="More ticket actions"
          >
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
            onSelect={() => setMergeOpen(true)}
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
        onCloseAutoFocus={returnFocusToTrigger}
      />

      <MergeTicketDialog
        source={{
          id: ticketId,
          number: ticketNumber,
          subject: ticketSubject,
          status: ticketStatus,
        }}
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        onCloseAutoFocus={returnFocusToTrigger}
      />
    </>
  );
}
