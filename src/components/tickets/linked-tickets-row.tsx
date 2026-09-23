"use client";

// The Linked tickets row under the ticket header (AIDA-52, UI-SPEC 2a, D-04, D-06). The server
// stays the authority: removing a link goes through removeRelationAction (membership checked,
// both tickets audited), and the merge link has no remove button because the server refuses it.

import { Loader2, LockKeyhole, X } from "lucide-react";
import Link from "next/link";
import { type RefObject, useEffect, useRef, useState, useTransition } from "react";
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
  /** Where focus goes when the last chip is removed and the row disappears. */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

/** A removal that succeeded (focus the chip now at its place) or failed (focus its button). */
type FocusRequest =
  | { kind: "removed"; relationId: string; index: number }
  | { kind: "failed"; relationId: string };

export function LinkedTicketsRow({ ticketId, relations, fallbackFocusRef }: LinkedTicketsRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [, startTransition] = useTransition();
  const sectionRef = useRef<HTMLElement>(null);

  // The focused remove button is disabled during the call and leaves with its chip, so focus
  // would fall to <body> (review UI-WR-04). After a removal, focus the link of the chip that
  // took its place (or the one before it); with no chip left, the fallback. After a failure,
  // focus the same remove button again.
  useEffect(() => {
    if (focusRequest === null || pendingId !== null) return;
    const section = sectionRef.current;
    if (focusRequest.kind === "failed") {
      section
        ?.querySelector<HTMLButtonElement>(
          `button[data-relation-id="${CSS.escape(focusRequest.relationId)}"]`,
        )
        ?.focus();
      setFocusRequest(null);
      return;
    }
    // Wait for the refreshed list without the removed chip.
    if (relations.some((r) => r.relationId === focusRequest.relationId)) return;
    const links = section ? Array.from(section.querySelectorAll<HTMLElement>("li a[href]")) : [];
    const next = links[Math.min(focusRequest.index, links.length - 1)];
    if (next) next.focus();
    else fallbackFocusRef?.current?.focus();
    setFocusRequest(null);
  }, [focusRequest, pendingId, relations, fallbackFocusRef]);

  if (relations.length === 0) return null;

  const visible = expanded ? relations : relations.slice(0, VISIBLE_CHIP_LIMIT);

  function handleRemove(chip: LinkedTicketChip, index: number) {
    setError(null);
    setPendingId(chip.relationId);
    startTransition(async () => {
      try {
        const result = await removeRelationAction(ticketId, chip.relationId);
        if (result.ok) {
          toast.success("Link removed.");
          setFocusRequest({ kind: "removed", relationId: chip.relationId, index });
        } else {
          setError(relationErrorMessage(result.error));
          setFocusRequest({ kind: "failed", relationId: chip.relationId });
        }
      } catch {
        // No returned code: the outcome is not known (P11 D2).
        setError(
          "The result is not known. The link may have been saved. Refresh the page to check before you try again.",
        );
        setFocusRequest({ kind: "failed", relationId: chip.relationId });
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <TooltipProvider>
      <section
        ref={sectionRef}
        aria-labelledby="linked-tickets-heading"
        className="flex flex-wrap items-center gap-2 border-b border-border/70 px-6 py-2"
      >
        <h2 id="linked-tickets-heading" className="text-[12px] font-semibold text-muted-foreground">
          Linked tickets
        </h2>
        <ul className="contents">
          {visible.map((chip, index) => {
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
                    data-relation-id={chip.relationId}
                    disabled={pendingId !== null}
                    onClick={() => handleRemove(chip, index)}
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
