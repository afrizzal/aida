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
import { type PickerRow, pickerReason, TicketPicker } from "@/components/tickets/ticket-picker";
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
import type { MergeErrorCode } from "@/lib/tickets/merge";

export interface MergeSourceTicket {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
}

const MERGE_OUTCOME_UNKNOWN =
  "The result is not known. The tickets may have been merged. Refresh the page to check before you try again.";

/** UI-SPEC Copywriting "Merge error: …" rows; null for a code with no row (the unknown refusal). */
export function mergeErrorMessage(code: MergeErrorCode, source: number, target: number) {
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
    default:
      return null;
  }
}

interface MergeTicketDialogProps {
  source: MergeSourceTicket;
  /** The current link label from this ticket's side, per other ticket id (for "Merge replaces link"). */
  linkLabels: Record<string, string>;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function MergeTicketDialog({
  source,
  linkLabels,
  open,
  onOpenChange,
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
            linkLabels={linkLabels}
            pending={pending}
            onPendingChange={setPending}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type MergeFailure = { kind: "refused"; message: string; rule: boolean } | { kind: "unknown" };

interface MergeFlowProps {
  source: MergeSourceTicket;
  linkLabels: Record<string, string>;
  pending: boolean;
  onPendingChange(pending: boolean): void;
  onClose(): void;
}

/** Mounted per opening, so every opening starts on step 1 with an empty picker. */
function MergeFlow({ source, linkLabels, pending, onPendingChange, onClose }: MergeFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [target, setTarget] = useState<PickerRow | null>(null);
  const [failure, setFailure] = useState<MergeFailure | null>(null);
  const [, startTransition] = useTransition();
  const backRef = useRef<HTMLButtonElement>(null);

  const eligible = target !== null && pickerReason(target, "merge") === null;

  // Focus moves to the step's first control on each change; after a rule refusal "Back" takes it.
  useEffect(() => {
    if (step === "confirm") backRef.current?.focus();
  }, [step]);
  useEffect(() => {
    if (failure?.kind === "refused" && failure.rule) backRef.current?.focus();
  }, [failure]);

  function handleMerge() {
    if (!target) return;
    const chosen = target;
    setFailure(null);
    onPendingChange(true);
    startTransition(async () => {
      try {
        const result = await mergeTicketAction(source.id, chosen.id);
        if (result.ok) {
          onPendingChange(false);
          onClose();
          toast.success(`Merged #${source.number} into #${chosen.number}.`);
          router.push(`/tickets/${result.targetId}`);
          return;
        }
        const message = mergeErrorMessage(result.error, source.number, chosen.number);
        setFailure(
          message === null
            ? {
                kind: "refused",
                message: "The tickets could not be merged. Wait a moment and try again.",
                rule: false,
              }
            : { kind: "refused", message, rule: true },
        );
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
          ticketId={source.id}
          purpose="merge"
          selected={target}
          onSelect={(row) => setTarget(row)}
        />
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
            type="button"
            size="sm"
            className="text-[13px]"
            disabled={!eligible}
            onClick={() => {
              setFailure(null);
              setStep("confirm");
            }}
          >
            Review merge
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (!target) return null;
  const replacedLabel = target.alreadyLinked ? linkLabels[target.id] : undefined;
  const mergeBlocked = failure !== null && (failure.kind === "unknown" || failure.rule);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold tracking-tight">
          Merge #{source.number} into #{target.number}?
        </DialogTitle>
        <DialogDescription className="sr-only">
          Review what happens before you merge these tickets.
        </DialogDescription>
      </DialogHeader>

      <div className="min-w-0 space-y-4">
        <div className="space-y-2 rounded-lg border border-border/70 p-4">
          {[
            { label: "From", ticket: source },
            { label: "Into", ticket: target },
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
            All messages and attachments of #{source.number} move to #{target.number}.
          </li>
          <li>
            #{source.number} is closed and marked as a duplicate of #{target.number}.
          </li>
          <li>Tags, assignee and custom fields stay on #{source.number}.</li>
          <li>
            The customer's status links keep working. Each one shows what it showed before, plus new
            replies.
          </li>
          {target.alreadyLinked && (
            <li>
              The current link "{replacedLabel ?? "Related to"}" between these tickets is replaced
              by "Duplicate of".
            </li>
          )}
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
