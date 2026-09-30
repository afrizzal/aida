"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { StateDot } from "@/components/tickets/state-dot";
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
import {
  DELETE_CANNOT_BE_UNDONE,
  DELETE_ERROR_ALREADY_DELETED,
  DELETE_ERROR_MEMBERSHIP_ENDED,
  DELETE_ERROR_NOT_ALLOWED,
  DELETE_ERROR_PREFIX,
  DELETE_ERROR_REPLACEMENT_INVALID,
  DELETE_ERROR_REPLACEMENT_REQUIRED,
  DELETE_ERROR_UNKNOWN,
  DELETE_OUTCOME_UNKNOWN,
  DELETE_STATUS_BUTTON,
  DELETE_UNUSED_DESCRIPTION,
  DELETING,
  deleteConsequences,
  deleteConsequencesRolesOnly,
  deletedAndMovedToast,
  deletedAndReplacedToast,
  deletedToast,
  deleteErrorLastInGroup,
  deleteInUseDescription,
  deleteRolesOnlyDescription,
  deleteTitle,
  GROUP_LABELS,
  KEEP_STATUS,
  MOVE_AND_DELETE_BUTTON,
  REPLACE_AND_DELETE_BUTTON,
  REPLACEMENT_LABEL,
  REPLACEMENT_NOT_CHOSEN,
  ROLE_NAMES,
  ROLES_INTRO,
  type StateRoleKey as RoleNameKey,
  replacementPlaceholder,
  type StateGroupKey,
} from "@/lib/tickets/state-copy";
import type {
  SettingsStateRow,
  StateAdminErrorCode,
  StateRoleKey,
} from "@/lib/tickets/ticket-state-admin";
import { deleteStatusAction } from "./actions";

// UI-SPEC Surface 1e (D-12, D-15): the Delete status dialog. The case comes from the page
// snapshot: A (no ticket, no role), B (tickets, with or without roles) and C (roles only). B and
// C need a same-group replacement, picked deliberately (no preselection). The server re-checks
// everything under its locks; a refusal changes nothing and a rejected call is an unknown
// outcome (P11 D2).

/** The service's role keys (12.1-08) mapped to the TicketStateConfig columns of the copy. */
const ROLE_COLUMN: Record<StateRoleKey, RoleNameKey> = {
  new: "newStateId",
  reopen: "reopenStateId",
  resolve: "resolveStateId",
  autoClose: "autoCloseStateId",
  mergeClose: "mergeCloseStateId",
};

type FocusTarget = "replacement" | "keep";

function refusalText(code: StateAdminErrorCode, group: StateGroupKey): string {
  switch (code) {
    case "STATE_NOT_FOUND":
      return DELETE_ERROR_ALREADY_DELETED;
    case "LAST_IN_GROUP":
      return `${DELETE_ERROR_PREFIX} ${deleteErrorLastInGroup(GROUP_LABELS[group])}`;
    case "REPLACEMENT_REQUIRED":
      return `${DELETE_ERROR_PREFIX} ${DELETE_ERROR_REPLACEMENT_REQUIRED}`;
    case "REPLACEMENT_INVALID":
      return `${DELETE_ERROR_PREFIX} ${DELETE_ERROR_REPLACEMENT_INVALID}`;
    case "NOT_ALLOWED":
      return `${DELETE_ERROR_PREFIX} ${DELETE_ERROR_NOT_ALLOWED}`;
    case "MEMBERSHIP_ENDED":
      return `${DELETE_ERROR_PREFIX} ${DELETE_ERROR_MEMBERSHIP_ENDED}`;
    default:
      return `${DELETE_ERROR_PREFIX} ${DELETE_ERROR_UNKNOWN}`;
  }
}

export function DeleteStatusDialog({
  open,
  state,
  replacements,
  onOpenChange,
  onDeleted,
  onReplacementRejected,
  onCloseAutoFocus,
}: {
  open: boolean;
  state: SettingsStateRow;
  /** The other active states of the same group, in sortOrder. */
  replacements: readonly SettingsStateRow[];
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
  /** The server refused the chosen replacement: the parent refreshes the page's states. */
  onReplacementRejected: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const group = state.group;
  const groupLabel = GROUP_LABELS[group];
  const kind: "A" | "B" | "C" = state.ticketCount > 0 ? "B" : state.roles.length > 0 ? "C" : "A";

  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [callout, setCallout] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  // Review UI-WR-c5: a replacement the server refused is not offered again, even before the
  // refreshed list arrives.
  const [rejectedIds, setRejectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const triggerRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const selectId = useId();

  useEffect(() => {
    if (!focusTarget || pending) return;
    (focusTarget === "replacement" ? triggerRef.current : keepRef.current)?.focus();
    setFocusTarget(null);
  }, [focusTarget, pending]);

  const options = replacements.filter((r) => !rejectedIds.has(r.id));
  const replacement = options.find((r) => r.id === replacementId) ?? null;
  const replacementName = replacement?.name ?? REPLACEMENT_NOT_CHOSEN;
  const needsReplacement = kind !== "A";
  const destructiveDisabled = pending || locked || (needsReplacement && !replacement);
  // Case A "Delete status", case B "Move tickets and delete", case C "Replace and delete".
  const destructiveLabel =
    kind === "A"
      ? DELETE_STATUS_BUTTON
      : kind === "B"
        ? MOVE_AND_DELETE_BUTTON
        : REPLACE_AND_DELETE_BUTTON;

  async function handleDelete() {
    if (destructiveDisabled) return;
    setCallout(null);
    setPending(true);
    const result = await deleteStatusAction({
      stateId: state.id,
      replacementStateId: needsReplacement ? replacementId : null,
    }).catch(() => null);
    setPending(false);

    if (result === null) {
      setCallout(DELETE_OUTCOME_UNKNOWN);
      setLocked(true);
      setFocusTarget("keep");
      return;
    }
    if (result.ok) {
      const message =
        result.movedCount > 0 && result.replacementName
          ? deletedAndMovedToast(result.name, result.movedCount, result.replacementName)
          : result.rolesMoved && result.replacementName
            ? deletedAndReplacedToast(result.name, result.replacementName)
            : deletedToast(result.name);
      toast.success(message);
      onDeleted();
      return;
    }
    setCallout(refusalText(result.error, group));
    if (result.error === "REPLACEMENT_INVALID") {
      const rejected = replacementId;
      if (rejected) setRejectedIds((prev) => new Set(prev).add(rejected));
      onReplacementRejected();
      setReplacementId(null);
      setFocusTarget("replacement");
      return;
    }
    setLocked(true);
    setFocusTarget("keep");
  }

  const roleNames = state.roles.map((role) => ROLE_NAMES[ROLE_COLUMN[role]]);
  const consequences =
    kind === "C"
      ? deleteConsequencesRolesOnly(state.name, replacementName)
      : deleteConsequences(state.name, replacementName, groupLabel);

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
        onOpenAutoFocus={(event) => {
          // UI-SPEC 1h: the replacement Select in cases B and C, "Keep status" in case A.
          event.preventDefault();
          (needsReplacement ? triggerRef.current : keepRef.current)?.focus();
        }}
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
            {deleteTitle(state.name)}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {kind === "A"
              ? DELETE_UNUSED_DESCRIPTION
              : kind === "B"
                ? deleteInUseDescription(state.ticketCount)
                : deleteRolesOnlyDescription(groupLabel)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsReplacement && roleNames.length > 0 && (
            <div className="space-y-2">
              <p className="text-[13px] text-foreground">{ROLES_INTRO}</p>
              <ul className="list-disc space-y-1 pl-4 text-[13px] text-foreground">
                {roleNames.map((role) => (
                  <li key={role}>{role}</li>
                ))}
              </ul>
            </div>
          )}

          {needsReplacement && (
            <div className="space-y-2">
              <Label htmlFor={selectId} className="text-[13px] font-semibold">
                {REPLACEMENT_LABEL}
              </Label>
              <Select
                value={replacementId ?? ""}
                disabled={pending}
                onValueChange={(value) => {
                  setReplacementId(value || null);
                  if (!locked) setCallout(null);
                }}
              >
                <SelectTrigger ref={triggerRef} id={selectId} className="h-8 w-full text-[13px]">
                  <SelectValue placeholder={replacementPlaceholder(groupLabel)} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id} className="text-[13px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <StateDot colorToken={option.colorToken} />
                        <span className="truncate">{option.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {needsReplacement && (
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-foreground">
              {consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          {needsReplacement && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground">
              <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>{DELETE_CANNOT_BE_UNDONE}</span>
            </div>
          )}

          {callout && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
            >
              {callout}
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
            onClick={() => onOpenChange(false)}
          >
            {KEEP_STATUS}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="text-[13px]"
            disabled={destructiveDisabled}
            onClick={handleDelete}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
            {pending ? DELETING : destructiveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
