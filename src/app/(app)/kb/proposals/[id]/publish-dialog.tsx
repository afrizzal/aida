"use client";

// The Approve and publish dialog (UI-SPEC 3f, D-06, D-16, Assumption 4): one explicit confirmation
// with a required checkbox before publishProposalAction runs. The server publishes the stored row
// at the expected version, so only the saved version is published (the review page disables the
// trigger while the form is dirty).
//
// Every result, and a rejected call caught as { rejected: true }, goes through
// resolveActionOutcome('publish', …) of plan 12.2-06; the dialog applies its message, disabled
// state and focus target and never compares a result code itself (UI-SPEC amendment A4, review
// C6). The UI never retries a publish on its own. All copy comes from proposal-copy.ts.

import { Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { publishProposalAction } from "@/app/(app)/kb/proposals/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  KEEP_REVIEWING,
  PUBLISH_ARTICLE_CTA,
  PUBLISH_CANNOT_BE_UNDONE,
  PUBLISH_CHECKLIST,
  PUBLISH_CONFIRM_CHECKBOX,
  PUBLISH_PENDING,
  PUBLISH_TITLE,
  PUBLISHED_TOAST_INDEXING_NOT_STARTED,
  publishDescription,
  RELOAD_BUTTON,
} from "@/lib/kb/proposal-copy";
import {
  type ActionOutcome,
  type OutcomeView,
  resolveActionOutcome,
} from "@/lib/kb/proposal-outcome";

export interface PublishDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  proposalId: string;
  /** The saved version the reviewer is looking at. */
  expectedVersion: number;
  /** The saved title, shown escaped in the description. */
  title: string;
  /** "Approve and publish…": focus returns to it when the dialog closes without acting. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  /** Moves focus to the page h1 now and again after the refresh (UI-SPEC 3i). */
  onFocusHeading(): void;
  /** "Reload proposal" in the callout (conflict, not draft, unknown outcome; review b-WR-03). */
  onReload(): void;
}

export function PublishDialog({
  open,
  onOpenChange,
  proposalId,
  expectedVersion,
  title,
  returnFocusRef,
  onFocusHeading,
  onReload,
}: PublishDialogProps) {
  const [pending, setPending] = useState(false);
  const checkboxRef = useRef<HTMLButtonElement>(null);
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
          // UI-SPEC 3i: the dialog opens with focus on the confirm checkbox.
          event.preventDefault();
          closeFocus.current = "opener";
          reloadOnClose.current = false;
          checkboxRef.current?.focus();
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
          <PublishFlow
            proposalId={proposalId}
            expectedVersion={expectedVersion}
            title={title}
            checkboxRef={checkboxRef}
            pending={pending}
            onPendingChange={setPending}
            onClose={close}
            onUnknown={() => {
              reloadOnClose.current = true;
            }}
            onPublished={() => {
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

interface PublishFlowProps {
  proposalId: string;
  expectedVersion: number;
  title: string;
  checkboxRef: RefObject<HTMLButtonElement | null>;
  pending: boolean;
  onPendingChange(pending: boolean): void;
  onClose(): void;
  /** An unknown outcome: closing the dialog then reloads the proposal (review b-WR-03). */
  onUnknown(): void;
  onPublished(): void;
  onReload(): void;
}

/** Mounted per opening, so every opening starts unchecked and without a callout. */
function PublishFlow({
  proposalId,
  expectedVersion,
  title,
  checkboxRef,
  pending,
  onPendingChange,
  onClose,
  onUnknown,
  onPublished,
  onReload,
}: PublishFlowProps) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [view, setView] = useState<OutcomeView | null>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const checkboxId = useId();

  // UI-SPEC 3i "Publish refusal, conflict, rejected call": focus on "Keep reviewing".
  useEffect(() => {
    if (view?.focus === "dismiss") dismissRef.current?.focus();
  }, [view]);

  async function handlePublish() {
    if (!checked || pending || view?.disableSubmit) return;
    setView(null);
    onPendingChange(true);
    let outcome: ActionOutcome;
    try {
      outcome = await publishProposalAction({ proposalId, expectedVersion });
    } catch {
      outcome = { rejected: true };
    }
    onPendingChange(false);

    const next = resolveActionOutcome("publish", outcome);
    if (next.kind === "success") {
      // Amendment A1 (review C2): a publish whose embed send failed (indexingQueued false) is
      // a warning toast, never the plain success toast.
      if (next.tone === "warning") {
        toast.warning(next.message ?? PUBLISHED_TOAST_INDEXING_NOT_STARTED);
      } else if (next.message) {
        toast.success(next.message);
      }
      router.refresh();
      onPublished();
      return;
    }
    if (next.kind === "unknown") onUnknown();
    setView(next);
  }

  const publishDisabled = !checked || pending || view?.disableSubmit === true;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold tracking-tight">
          {PUBLISH_TITLE}
        </DialogTitle>
        <DialogDescription className="text-[13px]">{publishDescription(title)}</DialogDescription>
      </DialogHeader>

      <div className="min-w-0 space-y-4">
        <ul className="list-disc space-y-1 pl-4 text-[13px] text-foreground">
          {PUBLISH_CHECKLIST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{PUBLISH_CANNOT_BE_UNDONE}</span>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            ref={checkboxRef}
            id={checkboxId}
            required
            checked={checked}
            disabled={pending}
            onCheckedChange={(value) => setChecked(value === true)}
            className="mt-0.5"
          />
          <Label htmlFor={checkboxId} className="text-[13px] leading-normal font-normal">
            {PUBLISH_CONFIRM_CHECKBOX}
          </Label>
        </div>

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
          {KEEP_REVIEWING}
        </Button>
        <Button
          type="button"
          size="sm"
          className="text-[13px]"
          disabled={publishDisabled}
          onClick={handlePublish}
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              {PUBLISH_PENDING}
            </>
          ) : (
            PUBLISH_ARTICLE_CTA
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
