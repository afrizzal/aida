"use client";

// The Linked tickets row under the ticket header (AIDA-52, UI-SPEC 2a, D-04, D-06). The server
// stays the authority: removing a link goes through removeRelationAction (membership checked,
// both tickets audited), and the merge link has no remove button because the server refuses it.

import { Loader2, LockKeyhole, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { removeRelationAction } from "@/app/(app)/tickets/[id]/relation-actions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RelationLabel } from "@/lib/tickets/relation-pairs";
import type { RelationErrorCode } from "@/lib/tickets/relations";

export interface LinkedTicketChip {
  relationId: string;
  label: RelationLabel;
  otherTicketId: string;
  number: number;
  subject: string;
  locked: boolean;
}

const VISIBLE_CHIP_LIMIT = 8;

const MERGE_LINK_LOCKED = "Created by a merge. This link can't be removed.";

/** UI-SPEC Copywriting "Link error: …" rows; one row per server code, never raw text. */
export function relationErrorMessage(
  code: RelationErrorCode,
  context: { childNumber?: number } = {},
): string {
  switch (code) {
    case "ALREADY_LINKED":
      return "These tickets are already linked. Remove that link first to change its type.";
    case "SELF":
      return "A ticket can't be linked to itself.";
    case "PARENT_EXISTS":
      return context.childNumber !== undefined
        ? `#${context.childNumber} already has a parent ticket. A ticket can have only one parent.`
        : "The link could not be saved. Wait a moment and try again.";
    case "CYCLE":
      return "This link would make a ticket its own parent or ancestor. Pick another ticket.";
    case "HIERARCHY_TOO_DEEP":
      return "This ticket is already deep in a chain of parent tickets. Link it to a ticket higher up instead.";
    case "MERGE_LINK":
      return MERGE_LINK_LOCKED;
    case "ALREADY_REMOVED":
      return "This link was already removed. Refresh the page to see the current links.";
    case "TICKET_UNAVAILABLE":
      return "That ticket is no longer available. Pick another ticket.";
    case "MEMBERSHIP_ENDED":
      return "Your access to this workspace has ended. Sign out, then sign in again.";
    default:
      return "The link could not be saved. Wait a moment and try again.";
  }
}

interface LinkedTicketsRowProps {
  ticketId: string;
  relations: LinkedTicketChip[];
}

export function LinkedTicketsRow({ ticketId, relations }: LinkedTicketsRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (relations.length === 0) return null;

  const visible = expanded ? relations : relations.slice(0, VISIBLE_CHIP_LIMIT);

  function handleRemove(chip: LinkedTicketChip) {
    setError(null);
    setPendingId(chip.relationId);
    startTransition(async () => {
      try {
        const result = await removeRelationAction(ticketId, chip.relationId);
        if (result.ok) {
          toast.success("Link removed.");
        } else {
          setError(relationErrorMessage(result.error));
        }
      } catch {
        // No returned code: the outcome is not known (P11 D2).
        setError(
          "The result is not known. The link may have been saved. Refresh the page to check before you try again.",
        );
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <TooltipProvider>
      <section
        aria-labelledby="linked-tickets-heading"
        className="flex flex-wrap items-center gap-2 border-b border-border/70 px-6 py-2"
      >
        <h2 id="linked-tickets-heading" className="text-[12px] font-semibold text-muted-foreground">
          Linked tickets
        </h2>
        <ul className="contents">
          {visible.map((chip) => {
            const pending = pendingId === chip.relationId;
            return (
              <li
                key={chip.relationId}
                aria-busy={pending ? "true" : undefined}
                className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted px-2 text-[12px]"
              >
                <span className="shrink-0 text-muted-foreground">{chip.label}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/tickets/${chip.otherTicketId}`}
                      title={chip.subject}
                      className="inline-flex min-w-0 items-center gap-1 text-foreground hover:text-primary-emphasis hover:underline"
                    >
                      <span className="shrink-0 tabular-nums">#{chip.number}</span>
                      <span className="max-w-[200px] truncate">{chip.subject}</span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[320px] text-[12px]">
                    {chip.subject}
                  </TooltipContent>
                </Tooltip>
                {chip.locked ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="img"
                        aria-label={MERGE_LINK_LOCKED}
                        className="inline-flex size-5 shrink-0 items-center justify-center"
                      >
                        <LockKeyhole className="size-3 text-muted-foreground" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-[12px]">{MERGE_LINK_LOCKED}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0"
                    aria-label={`Remove the link "${chip.label} #${chip.number}"`}
                    disabled={pendingId !== null}
                    onClick={() => handleRemove(chip)}
                  >
                    {pending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <X className="size-3" />
                    )}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {relations.length > VISIBLE_CHIP_LIMIT && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[12px]"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show fewer" : `Show all ${relations.length}`}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}
      </section>
    </TooltipProvider>
  );
}
