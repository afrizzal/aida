"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deactivateMemberAction, reassignTicketsAction } from "./actions";
import {
  DEACTIVATE_CONFIRM,
  DEACTIVATE_DESCRIPTION,
  DEACTIVATE_KEEP,
  DEACTIVATING,
  type DeactivateErrorKey,
  deactivatedToast,
  deactivateError,
  deactivateTitle,
  displayName,
  openTicketsLine,
  REASSIGN_KEEP,
  REASSIGN_LABEL,
  REASSIGN_RETRY,
  reassignFailedText,
  reassignSkippedText,
} from "./team-copy";
import type { TeamMember } from "./team-rights";

// UI-SPEC Surface 1, "Deactivate" (D-07, V-25, amendment A7). The member is removed first, in one
// locked transaction (deactivateMember); reassigning their open tickets is an optional second step
// after that commit and is never forced: "Keep them assigned" is the default. Reassignment never
// overwrites a newer assignment (the service skips and counts it). When part of it fails the member
// is already gone, so the dialog stays open with a warning callout and a retry. The dialog lives
// in the Members card, not in the row, so it keeps its state when the row leaves the list.

const KEEP_VALUE = "__keep__";

const WARNING_CALLOUT =
  "flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-warning";

export function DeactivateDialog({
  open,
  target,
  reassignees,
  onOpenChange,
  onRemoved,
  onCloseAutoFocus,
}: {
  open: boolean;
  target: TeamMember;
  /** Every other current member, in list order. */
  reassignees: readonly TeamMember[];
  onOpenChange: (open: boolean) => void;
  /** The member was removed: the parent moves focus to the Members heading on close. */
  onRemoved: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const name = displayName(target.name, target.email);
  const selectId = useId();

  const [reassignTo, setReassignTo] = useState<string>(KEEP_VALUE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DeactivateErrorKey | null>(null);
  /** Set once the member is removed but some open tickets could not be reassigned (A7). */
  const [failedCount, setFailedCount] = useState<number | null>(null);
  const [skippedTotal, setSkippedTotal] = useState(0);

  const removed = failedCount !== null;
  const reassigneeId = reassignTo === KEEP_VALUE ? null : reassignTo;

  function finish(skipped: number) {
    const base = deactivatedToast(name);
    toast.success(skipped > 0 ? `${base} ${reassignSkippedText(skipped)}` : base);
    onRemoved();
    onOpenChange(false);
  }

  function handleCounts(counts: { skipped: number; failed: number | null }, fallback: number) {
    const skipped = skippedTotal + counts.skipped;
    setSkippedTotal(skipped);
    const failed = counts.failed ?? fallback;
    if (failed > 0) {
      setFailedCount(failed);
      return;
    }
    finish(skipped);
  }

  async function handleDeactivate() {
    if (pending || removed) return;
    setError(null);
    setPending(true);
    const result = await deactivateMemberAction(target.userId, reassigneeId).catch(() => null);
    setPending(false);
    if (!result?.ok) {
      setError(result ? result.error : "unknown");
      return;
    }
    if (reassigneeId === null) {
      finish(0);
      return;
    }
    onRemoved();
    handleCounts(result, target.openTickets);
  }

  async function handleRetry() {
    if (pending || !reassigneeId || failedCount === null) return;
    setPending(true);
    const result = await reassignTicketsAction(target.userId, reassigneeId).catch(() => null);
    setPending(false);
    // A rejected or refused retry changes nothing that is known: the callout stays as it was.
    if (!result?.ok) return;
    handleCounts(result, failedCount);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-[520px]"
        showCloseButton={removed}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            {deactivateTitle(name)}
          </DialogTitle>
          <DialogDescription className="text-[13px]">{DEACTIVATE_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {target.openTickets > 0 && !removed && (
            <div className="space-y-2">
              <p className="text-[13px] text-foreground">
                {openTicketsLine(name, target.openTickets)}
              </p>
              <Label htmlFor={selectId} className="text-[13px] font-semibold">
                {REASSIGN_LABEL}
              </Label>
              <Select value={reassignTo} disabled={pending} onValueChange={setReassignTo}>
                <SelectTrigger id={selectId} className="h-8 w-full text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP_VALUE} className="text-[13px]">
                    {REASSIGN_KEEP}
                  </SelectItem>
                  {reassignees.map((member) => (
                    <SelectItem key={member.userId} value={member.userId} className="text-[13px]">
                      <span className="truncate">{displayName(member.name, member.email)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {failedCount !== null && (
            <div className={WARNING_CALLOUT}>
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 space-y-2">
                <p role="alert">{reassignFailedText(name, failedCount)}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-[13px]"
                  disabled={pending}
                  onClick={handleRetry}
                >
                  {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
                  {REASSIGN_RETRY}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {deactivateError(error, name)}
            </p>
          )}
        </div>

        {!removed && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-[13px]"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {DEACTIVATE_KEEP}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="text-[13px]"
              disabled={pending}
              onClick={handleDeactivate}
            >
              {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
              {pending ? DEACTIVATING : DEACTIVATE_CONFIRM}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
