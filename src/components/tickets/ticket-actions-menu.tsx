"use client";

// "More ticket actions" in the ticket top bar (UI-SPEC Surface 1): Link a ticket… and Merge into
// another ticket…. The Merge item stays visible but disabled, with its reason, on a merged source
// and on a ticket that has received merges (D-07). The Link item is disabled the same way on a
// merged source (run decision K34). The server refuses all of these anyway.
//
// Phase 12.2 (UI-SPEC 1a, AIDA-18): owners and admins also get the proposal entry after Merge.
// It is disabled with its "Entry unavailable" reason when AI is off, the ticket is a merged source
// or its group is not RESOLVED or CLOSED, and it opens the Start dialog with this one ticket.
// Members never see it; requestProposalAction refuses them anyway (D-01).

import { Ellipsis, Link2, Merge, Sparkles } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import { StartProposalDialog } from "@/components/kb/start-proposal-dialog";
import { LinkTicketDialog } from "@/components/tickets/link-ticket-dialog";
import { MergeTicketDialog } from "@/components/tickets/merge-ticket-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PROPOSE_KB_ARTICLE_ENTRY } from "@/lib/kb/proposal-copy";
import { proposalMenuUnavailableReason } from "@/lib/kb/proposal-entry";
import { MERGED_SOURCE_REASON } from "@/lib/tickets/lifecycle-copy";
import type { StateGroupKey } from "@/lib/tickets/state-copy";
import { cn } from "@/lib/utils";

export interface TicketActionsMenuProps {
  ticketId: string;
  ticketNumber: number;
  ticketSubject: string;
  /** The ticket's state name and colour key, shown on the merge confirmation pair (D-11). */
  ticketState: { name: string; colorToken: string };
  mergedSource: boolean;
  hasReceivedMerges: boolean;
  /** The ticket's state group; the proposal entry needs RESOLVED or CLOSED (D-07). */
  stateGroup: StateGroupKey;
  /** The actor is an owner or admin, computed on the server (D-01). */
  isAdmin: boolean;
  /** The organization's aiEnabled setting, read on the server (D-09). */
  aiEnabled: boolean;
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
  stateGroup,
  isAdmin,
  aiEnabled,
  triggerRef: parentTriggerRef,
}: TicketActionsMenuProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const proposeReasonId = useId();
  const mergeReason = mergeUnavailableReason(mergedSource, hasReceivedMerges);
  const proposeReason = proposalMenuUnavailableReason({
    aiEnabled,
    group: stateGroup,
    merged: mergedSource,
  });
  // The Copywriting "Link unavailable: merged source" reason (K34); a merge target keeps Link.
  const linkReason = mergedSource ? MERGED_SOURCE_REASON : null;
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = parentTriggerRef ?? ownTriggerRef;

  // UI-SPEC Surface 1 and 12.2 UI-SPEC 3i: every dialog here returns focus to the menu trigger when they close. They are
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
          {/* "Propose KB article…" (UI-SPEC 1a): admins only, after Merge, no pending state. A
              disabled item keeps its reason as a second 12px line and as its description. It is
              aria-disabled, not disabled: Radix drops disabled items from keyboard navigation,
              so the reason could never be heard (status-manager.tsx, review UI-WR-c1). The
              reason line is aria-hidden, so it is read once, as the description. */}
          {isAdmin && (
            <DropdownMenuItem
              aria-disabled={proposeReason !== null ? true : undefined}
              aria-describedby={proposeReason ? proposeReasonId : undefined}
              onSelect={(event) => {
                if (proposeReason !== null) {
                  event.preventDefault();
                  return;
                }
                setProposeOpen(true);
              }}
              className={cn("items-start gap-2 text-[13px]", proposeReason && "opacity-50")}
            >
              <Sparkles className="size-4" />
              <span className="flex flex-col">
                <span>{PROPOSE_KB_ARTICLE_ENTRY}</span>
                {proposeReason && (
                  <span
                    id={proposeReasonId}
                    aria-hidden="true"
                    className="text-[12px] text-muted-foreground"
                  >
                    {proposeReason}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          )}
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

      {isAdmin && (
        <StartProposalDialog
          open={proposeOpen}
          onOpenChange={setProposeOpen}
          ticketIds={[ticketId]}
          onCloseAutoFocus={returnFocusToTrigger}
        />
      )}
    </>
  );
}
