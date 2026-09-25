"use client";

// The two-step merge dialog (AIDA-53, UI-SPEC 3a). Step 1 picks the target, step 2 is the
// confirmation naming both tickets. The dialog is a convenience: mergeTicketAction checks
// membership and every D-07 rule inside one transaction, and a refusal changes nothing (D-08).

import { Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { mergeTicketAction } from "@/app/(app)/tickets/[id]/merge-actions";
import { StatusChip } from "@/components/tickets/status-chip";
import {
  fetchPickerRows,
  type PickerRow,
  pickerReason,
  TicketPicker,
} from "@/components/tickets/ticket-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TicketStatus } from "@/generated/prisma/client";
import {
  MERGE_CONFIRM_DESCRIPTION,
  MERGE_ERROR_LINK_CHANGED,
  mergeRecheckFailedText,
  mergeReplacesLinkText,
} from "@/lib/tickets/lifecycle-copy";
import type { MergeErrorCode } from "@/lib/tickets/merge";

export interface MergeSourceTicket {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
}

const MERGE_OUTCOME_UNKNOWN =
  "The result is not known. The tickets may have been merged. Refresh the page to check before you try again.";

/**
 * UI-SPEC Copywriting "Merge error: …" rows, one per MergeErrorCode. The switch is exhaustive:
 * the service returns only these codes and rethrows anything else, which reaches the dialog as a
 * rejected call ("Merge outcome unknown"), so every returned refusal is a rule refusal (review
 * UI-IN-02). A new code fails the type check here until it has its row.
 */
export function mergeErrorMessage(code: MergeErrorCode, source: number, target: number): string {
  switch (code) {
    case "DIFFERENT_CONTACTS":
      return "These tickets belong to different customers, so they can't be merged. Link them as related instead.";
    case "SELF":
      return "A ticket can't be merged into itself.";
    case "SOURCE_MERGED":
      return `#${source} was already merged into another ticket.`;
    case "TARGET_MERGED":
      return `#${target} was merged into another ticket, so it can't receive a merge. Open #${target} to see where its conversation continues.`;
    case "SOURCE_HAS_MERGES":
      return `Other tickets were merged into #${source}, so it can't be merged again. Merge #${target} into #${source} instead.`;
    case "TICKET_UNAVAILABLE":
      return "One of these tickets is no longer available. Refresh the page and try again.";
    case "MEMBERSHIP_ENDED":
      return "Your access to this workspace has ended. Sign out, then sign in again.";
    case "LINK_CHANGED":
      return MERGE_ERROR_LINK_CHANGED;
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

interface MergeTicketDialogProps {
  source: MergeSourceTicket;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Where focus goes when the dialog closes (the menu trigger, UI-SPEC Surface 1). */
  onCloseAutoFocus?(event: Event): void;
}

export function MergeTicketDialog({
  source,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: MergeTicketDialogProps) {
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[560px]"
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        {open && (
          <MergeFlow
            source={source}
            pending={pending}
            onPendingChange={setPending}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type MergeFailure = { kind: "refused"; message: string } | { kind: "unknown" };

interface MergeFlowProps {
  source: MergeSourceTicket;
  pending: boolean;
  onPendingChange(pending: boolean): void;
  onClose(): void;
}

/** Mounted per opening, so every opening starts on step 1 with an empty picker. */
function MergeFlow({ source, pending, onPendingChange, onClose }: MergeFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  // The row chosen in the picker (step 1) and the row the confirm step is about (step 2).
  const [target, setTarget] = useState<PickerRow | null>(null);
  const [reviewed, setReviewed] = useState<PickerRow | null>(null);
  // The picker's search text lives here, so "Back" remounts step 1 with the same search and the
  // chosen row checked, as UI-SPEC 3a asks ("the choice kept", review UI-WR-07).
  const [query, setQuery] = useState("");
  const [failure, setFailure] = useState<MergeFailure | null>(null);
  const [, startTransition] = useTransition();
  // "Review merge" re-reads the chosen row first (Codex diff round 1, D4); while it does, the
  // button is busy. pickerKey remounts the picker, so its rows are fetched again.
  const [reviewing, setReviewing] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  // The number of the ticket whose re-read failed, for the step 1 callout (R2-1); null hides it.
  const [recheckFailed, setRecheckFailed] = useState<number | null>(null);
  const reviewAbort = useRef<AbortController | null>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const eligible = target !== null && pickerReason(target, "merge") === null;

  useEffect(() => () => reviewAbort.current?.abort(), []);

  // The kept choice is a copy of a picker row. Whenever the picker shows newer rows (after Back,
  // or a new search) the copy is replaced by the newest row with the same id, so alreadyLinked,
  // linkLabel and the eligibility flags are never older than the list on screen (D4).
  function refreshChoice(rows: PickerRow[]) {
    setTarget((current) =>
      current ? (rows.find((row) => row.id === current.id) ?? current) : current,
    );
  }

  /**
   * Re-reads the chosen ticket's row by its number just before the confirm step, so a link
   * added after the rows were fetched is named there (D4). The confirm step opens only on a
   * re-read that still finds the row (Codex diff round 2, R2-1): if the read fails, the
   * membership ended, or the row is missing, step 1 stays with the choice kept, a callout says
   * the ticket could not be checked, and "Review merge" takes focus so the user can try again.
   * The link the confirm step names is then sent with the merge as its precondition. An
   * aborted read (the dialog closed) stays silent. If the fresh row is no longer eligible, the
   * choice is cleared and the picker fetches its rows again, so the row shows its reason, as
   * after a rule refusal (UI-WR-07).
   */
  async function review() {
    if (!target) return;
    const chosen = target;
    reviewAbort.current?.abort();
    const controller = new AbortController();
    reviewAbort.current = controller;
    setRecheckFailed(null);
    setReviewing(true);
    let latest: PickerRow | null = null;
    try {
      const result = await fetchPickerRows(
        `#${chosen.number}`,
        source.id,
        "merge",
        controller.signal,
      );
      if (result.kind === "results") {
        latest = result.rows.find((row) => row.id === chosen.id) ?? null;
      }
    } catch {
      return; // aborted: the dialog closed
    } finally {
      if (!controller.signal.aborted) setReviewing(false);
    }
    if (latest === null) {
      setRecheckFailed(chosen.number);
      return;
    }
    if (pickerReason(latest, "merge") !== null) {
      setTarget(null);
      setPickerKey((key) => key + 1);
      return;
    }
    setTarget(latest);
    setFailure(null);
    setReviewed(latest);
    setStep("confirm");
  }

  // A failed re-read leaves step 1 with the choice kept; "Review merge" is enabled again and
  // takes focus, because the busy (disabled) button had it (R2-1).
  useEffect(() => {
    if (recheckFailed !== null) reviewRef.current?.focus();
  }, [recheckFailed]);
  // Focus moves to the step's first control on each change; after a rule refusal "Back" takes it.
  useEffect(() => {
    if (step === "confirm") backRef.current?.focus();
  }, [step]);
  // After a rejected call, "Merge tickets" and "Back" stay disabled, so the only way on, "Keep
  // tickets separate", takes focus instead of leaving it on <body> (review UI-WR-04).
  useEffect(() => {
    if (failure?.kind === "refused") backRef.current?.focus();
    if (failure?.kind === "unknown") keepRef.current?.focus();
  }, [failure]);

  function handleMerge() {
    if (!reviewed) return;
    const chosen = reviewed;
    setFailure(null);
    onPendingChange(true);
    startTransition(async () => {
      try {
        // The link the confirm step named is sent as a precondition: the server refuses with
        // LINK_CHANGED when the pair's link is no longer that one (Codex diff round 2, R2-1).
        // linkLabel is set exactly when alreadyLinked is (UI-WR-06), so null means "no link".
        const result = await mergeTicketAction(source.id, chosen.id, chosen.linkLabel ?? null);
        if (result.ok) {
          onPendingChange(false);
          onClose();
          toast.success(`Merged #${source.number} into #${chosen.number}.`);
          router.push(`/tickets/${result.targetId}`);
          return;
        }
        setFailure({
          kind: "refused",
          message: mergeErrorMessage(result.error, source.number, chosen.number),
        });
        // A rule refused this target, so it is no longer the picker's choice: after "Back" the
        // user picks again from the refreshed rows instead of re-submitting it (review UI-WR-07).
        // The confirm step keeps showing the refused pair until then.
        setTarget(null);
      } catch {
        setFailure({ kind: "unknown" });
      }
      onPendingChange(false);
    });
  }

  if (step === "pick") {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            Merge this ticket into another
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Pick the ticket that keeps the conversation. #{source.number} will be closed as its
            duplicate.
          </DialogDescription>
        </DialogHeader>
        <TicketPicker
          key={pickerKey}
          ticketId={source.id}
          purpose="merge"
          selected={target}
          onSelect={(row) => {
            setRecheckFailed(null);
            setTarget(row);
          }}
          query={query}
          onQueryChange={setQuery}
          onRows={refreshChoice}
          disabled={reviewing}
        />
        {recheckFailed !== null && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
          >
            {mergeRecheckFailedText(recheckFailed)}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-[13px]"
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            ref={reviewRef}
            type="button"
            size="sm"
            className="text-[13px]"
            disabled={!eligible || reviewing}
            aria-busy={reviewing || undefined}
            onClick={() => void review()}
          >
            {reviewing && <Loader2 className="mr-2 size-4 animate-spin" />}
            Review merge
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (!reviewed) return null;
  // Every refusal is a rule refusal and a rejected call has no known outcome: either way
  // "Merge tickets" stays disabled (UI-SPEC 3a).
  const mergeBlocked = failure !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold tracking-tight">
          Merge #{source.number} into #{reviewed.number}?
        </DialogTitle>
        <DialogDescription className="sr-only">{MERGE_CONFIRM_DESCRIPTION}</DialogDescription>
      </DialogHeader>

      <div className="min-w-0 space-y-4">
        <div className="space-y-2 rounded-lg border border-border/70 p-4">
          {[
            { label: "From", ticket: source },
            { label: "Into", ticket: reviewed },
          ].map(({ label, ticket }) => (
            <div
              key={label}
              className="grid grid-cols-[48px_1fr_auto] items-center gap-2 text-[13px]"
            >
              <span className="text-[12px] text-muted-foreground">{label}</span>
              <span className="min-w-0 truncate" title={ticket.subject}>
                <span className="font-semibold tabular-nums">#{ticket.number}</span>{" "}
                {ticket.subject}
              </span>
              <StatusChip status={ticket.status} />
            </div>
          ))}
        </div>

        <ul className="list-disc space-y-1 pl-4 text-[13px] text-foreground">
          <li>
            All messages and attachments of #{source.number} move to #{reviewed.number}.
          </li>
          <li>
            #{source.number} is closed and marked as a duplicate of #{reviewed.number}.
          </li>
          <li>Tags, assignee and custom fields stay on #{source.number}.</li>
          <li>
            The customer's status links keep working. Each one shows what it showed before, plus new
            replies.
          </li>
          {/* The label comes with the chosen row, re-read when "Review merge" was pressed, so
              a link added after the page loaded or while this dialog was open is named
              correctly (review UI-WR-06, Codex diff round 1 D4); with no label the generic row
              is used, never a guessed type. */}
          {reviewed.alreadyLinked && <li>{mergeReplacesLinkText(reviewed.linkLabel ?? null)}</li>}
        </ul>

        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-warning">
          <TriangleAlert className="size-4 shrink-0" />
          <span>A merge can't be undone.</span>
        </div>

        {failure && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
          >
            {failure.kind === "unknown"
              ? MERGE_OUTCOME_UNKNOWN
              : `Nothing was changed. ${failure.message}`}
          </div>
        )}
      </div>

      <DialogFooter className="flex-wrap">
        <Button
          ref={backRef}
          type="button"
          variant="outline"
          size="sm"
          className="text-[13px]"
          disabled={pending || failure?.kind === "unknown"}
          onClick={() => {
            setFailure(null);
            setStep("pick");
          }}
        >
          Back
        </Button>
        <Button
          ref={keepRef}
          type="button"
          variant="outline"
          size="sm"
          className="text-[13px]"
          disabled={pending}
          onClick={onClose}
        >
          Keep tickets separate
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="text-[13px]"
          disabled={pending || mergeBlocked}
          onClick={handleMerge}
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Merging…
            </>
          ) : (
            "Merge tickets"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
