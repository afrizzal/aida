"use client";

// "More ticket actions" in the ticket top bar (UI-SPEC Surface 1): Link a ticket… and Merge into
// another ticket…. The Merge item stays visible but disabled, with its reason, on a merged source
// and on a ticket that has received merges (D-07). The Link item is disabled the same way on a
// merged source (run decision K34). The server refuses all of these anyway.

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
import { MERGED_SOURCE_REASON } from "@/lib/tickets/lifecycle-copy";

export interface TicketActionsMenuProps {
  ticketId: string;
  ticketNumber: number;
  ticketSubject: string;
  /** The ticket's state name and colour key, shown on the merge confirmation pair (D-11). */
  ticketState: { name: string; colorToken: string };
  mergedSource: boolean;
  hasReceivedMerges: boolean;
  /** A ref to the menu trigger, for a parent that also moves focus to it. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

/** The Copywriting "Merge unavailable" reason, or null when Merge is offered. */
export function mergeUnavailableReason(mergedSource: boolean, hasReceivedMerges: boolean) {
  if (mergedSource) return MERGED_SOURCE_REASON;
  if (hasReceivedMerges) {
    return "Other tickets were merged into this one, so it can't be merged again.";
  }
  return null;
}

export function TicketActionsMenu({
  ticketId,
  ticketNumber,
  ticketSubject,
  ticketState,
  mergedSource,
  hasReceivedMerges,
  triggerRef: parentTriggerRef,
}: TicketActionsMenuProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const mergeReason = mergeUnavailableReason(mergedSource, hasReceivedMerges);
  // The Copywriting "Link unavailable: merged source" reason (K34); a merge target keeps Link.
  const linkReason = mergedSource ? MERGED_SOURCE_REASON : null;
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
          <DropdownMenuItem
            disabled={linkReason !== null}
            onSelect={() => setLinkOpen(true)}
            className="items-start gap-2 text-[13px]"
          >
            <Link2 className="size-4" />
            <span className="flex flex-col">
              <span>Link a ticket…</span>
              {linkReason && (
                <span className="text-[12px] text-muted-foreground">{linkReason}</span>
              )}
            </span>
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
          stateName: ticketState.name,
          colorToken: ticketState.colorToken,
        }}
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        onCloseAutoFocus={returnFocusToTrigger}
      />
    </>
  );
}
