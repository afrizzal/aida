"use client";

import { Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { revokeInvitationAction } from "./actions";
import {
  PENDING_EMPTY,
  PENDING_HEADING,
  REVOKE_CONFIRM,
  REVOKE_DESCRIPTION,
  REVOKE_ERROR,
  REVOKE_KEEP,
  REVOKE_TRIGGER,
  REVOKED_TOAST,
  REVOKING,
  revokeTitle,
} from "./team-copy";

// UI-SPEC Surface 1, the Pending invitations card (E2), rendered for owners and admins only. Only
// pending, unexpired invitations are listed (listPendingInvitations, 10-05); the meta line is
// built on the server. Revoke goes through revokeInvitationAction, whose service re-checks the
// actor's rights under the organization lock. The Revoke dialog lives in the card, not in the row,
// so a refusal keeps it open with its state.

/** One pending invitation as the page hands it over: the address and the "Pending row meta". */
export interface PendingInvitationRow {
  invitationId: string;
  email: string;
  meta: string;
}

export function PendingInvitationList({ invitations }: { invitations: PendingInvitationRow[] }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const revokedRef = useRef(false);
  const [target, setTarget] = useState<{ row: PendingInvitationRow; key: number } | null>(null);
  const [open, setOpen] = useState(false);

  function openRevoke(row: PendingInvitationRow) {
    revokedRef.current = false;
    setTarget((prev) => ({ row, key: (prev?.key ?? 0) + 1 }));
    setOpen(true);
  }

  return (
    // Card is flex-col with a 16px gap (--card-spacing): the contract's space-y-4 stack.
    <Card className="border-border/70 p-4 shadow-sm">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-[15px] font-semibold tracking-tight outline-none"
      >
        {PENDING_HEADING}
      </h2>
      {invitations.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{PENDING_EMPTY}</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {invitations.map((row) => (
            <li key={row.invitationId} className="flex flex-wrap items-center gap-4 py-2">
              {/* Under 640px the identity takes the whole line, so the action wraps below. */}
              <div className="w-full min-w-0 space-y-1 sm:w-auto sm:flex-1">
                <p className="truncate text-[13px] font-semibold text-foreground">{row.email}</p>
                <p className="truncate text-[12px] text-muted-foreground">{row.meta}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[13px] text-destructive"
                onClick={() => openRevoke(row)}
              >
                <X className="size-4" aria-hidden="true" />
                {REVOKE_TRIGGER}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {target && (
        <RevokeDialog
          key={target.key}
          open={open}
          row={target.row}
          onOpenChange={setOpen}
          onRevoked={() => {
            revokedRef.current = true;
          }}
          onCloseAutoFocus={(event) => {
            // After a revoke the row is gone: focus moves to the card heading.
            if (!revokedRef.current) return;
            event.preventDefault();
            headingRef.current?.focus();
          }}
        />
      )}
    </Card>
  );
}

function RevokeDialog({
  open,
  row,
  onOpenChange,
  onRevoked,
  onCloseAutoFocus,
}: {
  open: boolean;
  row: PendingInvitationRow;
  onOpenChange: (open: boolean) => void;
  onRevoked: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleRevoke() {
    if (pending) return;
    setFailed(false);
    setPending(true);
    const result = await revokeInvitationAction(row.invitationId).catch(() => null);
    setPending(false);
    if (!result?.ok) {
      setFailed(true);
      return;
    }
    toast.success(REVOKED_TOAST);
    onRevoked();
    onOpenChange(false);
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
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight wrap-anywhere">
            {revokeTitle(row.email)}
          </DialogTitle>
          <DialogDescription className="text-[13px]">{REVOKE_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        {failed && (
          <p role="alert" className="text-[13px] text-destructive">
            {REVOKE_ERROR}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-[13px]"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {REVOKE_KEEP}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="text-[13px]"
            disabled={pending}
            onClick={handleRevoke}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
            {pending ? REVOKING : REVOKE_CONFIRM}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
