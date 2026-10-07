"use client";

// The Reject dialog (UI-SPEC 3g, D-16): a confirmation before rejectProposalAction runs. Rejection
// is terminal; the proposal stays in the list and can never be published.
//
// Every result, and a rejected call caught as { rejected: true }, goes through
// resolveActionOutcome('reject', …) of plan 12.2-06; the dialog applies its message, disabled
// state and focus target and never compares a result code itself (UI-SPEC amendment A4, review
// C6). All copy comes from proposal-copy.ts.

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { rejectProposalAction } from "@/app/(app)/kb/proposals/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  KEEP_PROPOSAL,
  REJECT_DESCRIPTION,
  REJECT_PENDING,
  REJECT_PROPOSAL,
  REJECT_TITLE,
  RELOAD_BUTTON,
} from "@/lib/kb/proposal-copy";
import {
  type ActionOutcome,
  type OutcomeView,
  resolveActionOutcome,
} from "@/lib/kb/proposal-outcome";

export interface RejectDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  proposalId: string;
  /** The saved version the reviewer is looking at. */
  expectedVersion: number;
  /** "Reject…": focus returns to it when the dialog closes without acting. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  /** Moves focus to the page h1 now and again after the refresh (UI-SPEC 3i). */
  onFocusHeading(): void;
  /** "Reload proposal" in the callout (conflict, not draft, unknown outcome; review b-WR-03). */
  onReload(): void;
}

export function RejectDialog({
  open,
  onOpenChange,
  proposalId,
  expectedVersion,
  returnFocusRef,
  onFocusHeading,
  onReload,
}: RejectDialogProps) {
  const [pending, setPending] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes when the dialog closes: the opening button, or the h1 after success or reload. */
  const closeFocus = useRef<"opener" | "heading">("opener");
  /**
   * Review b-WR-03: after an unknown outcome the write may have committed, so closing the dialog
   * reloads the proposal (as "Reload proposal" does, focus on the h1) instead of leaving a stale
   * DRAFT editor on screen.
   */
  const reloadOnClose = useRef(false);

  function close() {
    if (reloadOnClose.current) {
      reloadOnClose.current = false;
      closeFocus.current = "heading";
      onOpenChange(false);
      onReload();
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[520px]"
        onOpenAutoFocus={(event) => {
          // UI-SPEC 3i: the dialog opens with focus on "Keep proposal".
          event.preventDefault();
          closeFocus.current = "opener";
          reloadOnClose.current = false;
          keepRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (closeFocus.current === "heading") onFocusHeading();
          else returnFocusRef.current?.focus();
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
          <RejectFlow
            proposalId={proposalId}
            expectedVersion={expectedVersion}
            keepRef={keepRef}
            pending={pending}
            onPendingChange={setPending}
            onClose={close}
            onUnknown={() => {
              reloadOnClose.current = true;
            }}
            onRejected={() => {
              closeFocus.current = "heading";
              onOpenChange(false);
              onFocusHeading();
            }}
            onReload={() => {
              closeFocus.current = "heading";
              onOpenChange(false);
              onReload();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RejectFlowProps {
  proposalId: string;
  expectedVersion: number;
  keepRef: RefObject<HTMLButtonElement | null>;
  pending: boolean;
  onPendingChange(pending: boolean): void;
  onClose(): void;
  /** An unknown outcome: closing the dialog then reloads the proposal (review b-WR-03). */
  onUnknown(): void;
  onRejected(): void;
  onReload(): void;
}

/** Mounted per opening, so every opening starts without a callout. */
function RejectFlow({
  proposalId,
  expectedVersion,
  keepRef,
  pending,
  onPendingChange,
  onClose,
  onUnknown,
  onRejected,
  onReload,
}: RejectFlowProps) {
  const router = useRouter();
  const [view, setView] = useState<OutcomeView | null>(null);

  // UI-SPEC 3i "Reject refusal, conflict, rejected call": focus on "Keep proposal".
  useEffect(() => {
    if (view?.focus === "dismiss") keepRef.current?.focus();
  }, [view, keepRef]);

  async function handleReject() {
    if (pending || view?.disableSubmit) return;
    setView(null);
    onPendingChange(true);
    let outcome: ActionOutcome;
    try {
      outcome = await rejectProposalAction({ proposalId, expectedVersion });
    } catch {
      outcome = { rejected: true };
    }
    onPendingChange(false);

    const next = resolveActionOutcome("reject", outcome);
    if (next.kind === "success") {
      if (next.message) toast.success(next.message);
      router.refresh();
      onRejected();
      return;
    }
    if (next.kind === "unknown") onUnknown();
    setView(next);
  }

  const rejectDisabled = pending || view?.disableSubmit === true;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold tracking-tight">
          {REJECT_TITLE}
        </DialogTitle>
        <DialogDescription className="text-[13px]">{REJECT_DESCRIPTION}</DialogDescription>
      </DialogHeader>

      <div role="alert">
        {view?.message && (
          <div className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive">
            <p>{view.message}</p>
            {view.offerReload && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-[13px]"
                onClick={onReload}
              >
                {RELOAD_BUTTON}
              </Button>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          ref={keepRef}
          type="button"
          variant="outline"
          size="sm"
          className="text-[13px]"
          disabled={pending}
          onClick={onClose}
        >
          {KEEP_PROPOSAL}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="text-[13px]"
          disabled={rejectDisabled}
          onClick={handleReject}
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              {REJECT_PENDING}
            </>
          ) : (
            REJECT_PROPOSAL
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
