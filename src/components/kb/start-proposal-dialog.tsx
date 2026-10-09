"use client";

// The Start dialog (UI-SPEC Surface 1b, AIDA-18, D-07, D-09, D-10). Every entry point opens it:
// the inbox bulk bar, the ticket actions menu and the review page's NEW_PROPOSAL_BUTTON. It is a
// convenience: requestProposalAction checks the member row, the owner or admin role, the count,
// AI and every ticket inside one transaction, and a refusal changes nothing.
//
// Every result of the request, and a rejected call, goes through resolveActionOutcome('start', …)
// of plan 12.2-06; the dialog applies only the view it returns (message, disabled submit, focus
// target), so an unexpected server error and a rejected call show the same START_OUTCOME_UNKNOWN
// row (UI-SPEC amendment A4, review C6). All copy comes from proposal-copy.ts.

import { Info, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { loadStartSelectionAction, requestProposalAction } from "@/app/(app)/kb/proposals/actions";
import { StateChip } from "@/components/tickets/state-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { markStartedProposal } from "@/lib/kb/proposal-arrival";
import { MAX_PROPOSAL_SOURCES, MIN_PROPOSAL_SOURCES } from "@/lib/kb/proposal-contract";
import {
  CUSTOMER_CONTENT_NOTICE,
  GENERATE_PROPOSAL_CTA,
  requestRefusalCopy,
  START_DESCRIPTION,
  START_DISMISS,
  START_ERROR_UNKNOWN,
  START_INPUTS_LINE,
  START_PENDING,
  START_TITLE,
  ticketRefusalCopy,
  ticketRefusalMergedParts,
} from "@/lib/kb/proposal-copy";
import {
  type ActionOutcome,
  type OutcomeView,
  resolveActionOutcome,
} from "@/lib/kb/proposal-outcome";
import type { StartSelectionTicket } from "@/lib/kb/proposal-queries";
import type { SourceRefusal } from "@/lib/kb/proposal-sources";

export interface StartProposalDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 1 to 5 ticket ids; the caller guarantees the count and the dialog renders nothing otherwise. */
  ticketIds: readonly string[];
  /**
   * Where focus goes when the dialog closes without starting (a menu trigger, the bulk button,
   * merge-ticket-dialog.tsx pattern). Not called after a start: focus then goes to the new
   * review page's h1 (UI-SPEC 3i, review b-WR-05).
   */
  onCloseAutoFocus?(event: Event): void;
}

export function StartProposalDialog({
  open,
  onOpenChange,
  ticketIds,
  onCloseAutoFocus,
}: StartProposalDialogProps) {
  const [pending, setPending] = useState(false);
  /** Set by a successful start: the close does not return focus to the trigger (b-WR-05). */
  const started = useRef(false);

  // UI-SPEC 3i: the dialog never opens on an empty selection or on more than five tickets.
  if (ticketIds.length < MIN_PROPOSAL_SOURCES || ticketIds.length > MAX_PROPOSAL_SOURCES) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[520px]"
        onOpenAutoFocus={(event) => {
          // Focus moves to the submit button once the tickets are listed (UI-SPEC 3i); until
          // then it stays on the dialog itself.
          event.preventDefault();
          started.current = false;
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // UI-SPEC 3i "Start success": the review page focuses its h1 after the navigation, so
          // focus is not sent back to a trigger on the page being left.
          if (started.current) {
            event.preventDefault();
            return;
          }
          onCloseAutoFocus?.(event);
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        {open && (
          <StartFlow
            ticketIds={ticketIds}
            pending={pending}
            onPendingChange={setPending}
            onClose={() => onOpenChange(false)}
            onStarted={() => {
              started.current = true;
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Selection =
  | { kind: "loading" }
  | { kind: "ready"; tickets: StartSelectionTicket[] }
  | { kind: "unavailable"; message: string };

interface StartFlowProps {
  ticketIds: readonly string[];
  pending: boolean;
  onPendingChange(pending: boolean): void;
  onClose(): void;
  /** A proposal was started; called before the dialog closes and the browser navigates. */
  onStarted(): void;
}

/** Mounted per opening, so every opening reads the tickets again and starts without a callout. */
function StartFlow({ ticketIds, pending, onPendingChange, onClose, onStarted }: StartFlowProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selection, setSelection] = useState<Selection>({ kind: "loading" });
  const [view, setView] = useState<OutcomeView | null>(null);
  const [refusals, setRefusals] = useState<SourceRefusal[]>([]);
  const submitRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const calloutHeadingRef = useRef<HTMLParagraphElement>(null);
  const idsKey = ticketIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey.split(",");
    loadStartSelectionAction(ids).then(
      (result) => {
        if (cancelled) return;
        if (!("kind" in result)) {
          setSelection({ kind: "unavailable", message: START_ERROR_UNKNOWN });
        } else if (result.kind === "ok") {
          setSelection({ kind: "ready", tickets: result.tickets });
        } else {
          setSelection({ kind: "unavailable", message: requestRefusalCopy(result.kind) });
        }
      },
      () => {
        if (!cancelled) setSelection({ kind: "unavailable", message: START_ERROR_UNKNOWN });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const distinctCount = new Set(ticketIds).size;
  const everyTicketListed =
    selection.kind === "ready" && selection.tickets.length === distinctCount;

  // UI-SPEC 3i, Start dialog opens: the submit button once every ticket is listed.
  useEffect(() => {
    if (everyTicketListed) submitRef.current?.focus();
  }, [everyTicketListed]);

  // The tickets could not be read: nothing can be started, so the dismiss button leads on.
  useEffect(() => {
    if (selection.kind === "unavailable") dismissRef.current?.focus();
  }, [selection.kind]);

  // UI-SPEC 3i: focus after an outcome, as resolveActionOutcome decided.
  useEffect(() => {
    if (!view) return;
    if (view.focus === "calloutHeading") calloutHeadingRef.current?.focus();
    else if (view.focus === "dismiss") dismissRef.current?.focus();
    else if (view.focus === "submit") submitRef.current?.focus();
  }, [view]);

  function handleStart() {
    setView(null);
    setRefusals([]);
    onPendingChange(true);
    startTransition(async () => {
      let outcome: ActionOutcome;
      let proposalId: string | null = null;
      let selectionRefusals: SourceRefusal[] = [];
      try {
        const result = await requestProposalAction([...ticketIds]);
        outcome = result;
        if (result.ok) proposalId = result.proposalId;
        else if ("refusals" in result && result.refusals) selectionRefusals = result.refusals;
      } catch {
        outcome = { rejected: true };
      }
      const next = resolveActionOutcome("start", outcome);
      onPendingChange(false);
      if (next.kind === "success" && proposalId) {
        // Review b-WR-05: the review page takes this mark on mount and focuses its h1.
        markStartedProposal(proposalId);
        onStarted();
        onClose();
        if (next.message) toast.success(next.message);
        router.push(`/kb/proposals/${proposalId}`);
        return;
      }
      setRefusals(selectionRefusals);
      setView(next);
    });
  }

  const refusalByTicket = new Map(refusals.map((refusal) => [refusal.ticketId, refusal]));
  const listedIds = new Set(selection.kind === "ready" ? selection.tickets.map((t) => t.id) : []);
  // A refused id the list does not show (another organization's or a removed ticket).
  const unlistedRefusals = refusals.filter((refusal) => !listedIds.has(refusal.ticketId));
  const unavailableMessage = selection.kind === "unavailable" ? selection.message : null;
  const submitDisabled = pending || selection.kind !== "ready" || view?.disableSubmit === true;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold tracking-tight">
          {START_TITLE}
        </DialogTitle>
        <DialogDescription className="text-[13px]">{START_DESCRIPTION}</DialogDescription>
      </DialogHeader>

      <div className="min-w-0 space-y-4">
        {selection.kind === "loading" && (
          <div aria-busy="true" className="space-y-2 rounded-lg border border-border/70 p-4">
            {[...new Set(ticketIds)].map((id) => (
              <Skeleton key={id} className="h-5 w-full" />
            ))}
          </div>
        )}

        {selection.kind === "ready" && selection.tickets.length > 0 && (
          <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
            {selection.tickets.map((ticket) => {
              const refusal = refusalByTicket.get(ticket.id);
              return (
                <li
                  key={ticket.id}
                  className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]"
                >
                  <span className="text-muted-foreground tabular-nums">#{ticket.number}</span>
                  <span className="min-w-0 max-w-[240px] truncate" title={ticket.subject}>
                    {ticket.subject}
                  </span>
                  <StateChip name={ticket.stateName} colorToken={ticket.colorToken} />
                  {refusal && (
                    <TicketRefusalLine refusal={refusal} ticket={ticket} onNavigate={onClose} />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{CUSTOMER_CONTENT_NOTICE}</span>
        </div>

        <p className="flex items-start gap-2 text-[12px] text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          <span>{START_INPUTS_LINE}</span>
        </p>

        <div role="alert">
          {(view?.message || unavailableMessage) && (
            <div className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive">
              <p
                ref={calloutHeadingRef}
                tabIndex={-1}
                className={
                  refusals.length > 0
                    ? "rounded-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    : "rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                }
              >
                {view?.message ?? unavailableMessage}
              </p>
              {unlistedRefusals.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-[12px]">
                  {unlistedRefusals.map((refusal) => (
                    <li key={refusal.ticketId}>
                      {ticketRefusalCopy(refusal.reason, refusal.mergedIntoNumber)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button
          ref={dismissRef}
          type="button"
          variant="outline"
          size="sm"
          className="text-[13px]"
          disabled={pending}
          onClick={onClose}
        >
          {START_DISMISS}
        </Button>
        <Button
          ref={submitRef}
          type="button"
          size="sm"
          className="text-[13px]"
          disabled={submitDisabled}
          onClick={handleStart}
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              {START_PENDING}
            </>
          ) : (
            GENERATE_PROPOSAL_CTA
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * The 12px destructive reason under a refused ticket (D-07). A merged source names its target as
 * a link when the listed ticket's merge target is the refusal's number; otherwise the plain row.
 */
function TicketRefusalLine({
  refusal,
  ticket,
  onNavigate,
}: {
  refusal: SourceRefusal;
  ticket: StartSelectionTicket;
  onNavigate(): void;
}) {
  const target = ticket.mergedInto;
  if (
    refusal.reason === "MERGED" &&
    refusal.mergedIntoNumber !== undefined &&
    target !== null &&
    target.number === refusal.mergedIntoNumber
  ) {
    const parts = ticketRefusalMergedParts(refusal.mergedIntoNumber);
    return (
      <p className="w-full text-[12px] text-destructive">
        {parts.before}
        <Link
          href={`/tickets/${target.id}`}
          className="text-primary-emphasis tabular-nums hover:underline"
          onClick={onNavigate}
        >
          {parts.target}
        </Link>
        {parts.after}
      </p>
    );
  }
  return (
    <p className="w-full text-[12px] text-destructive">
      {ticketRefusalCopy(refusal.reason, refusal.mergedIntoNumber)}
    </p>
  );
}
