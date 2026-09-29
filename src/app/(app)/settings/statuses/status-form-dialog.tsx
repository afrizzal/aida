"use client";

import { Check, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PublicGroupChip } from "@/components/tickets/public-group-chip";
import { StateChip } from "@/components/tickets/state-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_GROUP_COLOR, STATE_COLOR_KEYS, STATE_COLORS } from "@/lib/tickets/state-colors";
import {
  addStatusTitle,
  COLOR_LEGEND,
  CREATE_OUTCOME_UNKNOWN,
  CREATE_STATUS_CTA,
  createdToast,
  EDIT_OUTCOME_UNKNOWN,
  EDIT_STATUS_TITLE,
  FORM_CLOSE,
  FORM_PENDING_CREATE,
  FORM_PENDING_SAVE,
  GROUP_DESCRIPTIONS,
  GROUP_FIXED_ADD,
  GROUP_LABELS,
  groupFixedEdit,
  NAME_LABEL,
  nameHelp,
  PREVIEW_CUSTOMER_LABEL,
  PREVIEW_PLACEHOLDER_NAME,
  PREVIEW_TEAM_LABEL,
  SAVE_CHANGES_CTA,
  STATUS_FORM_ERROR_DELETED,
  STATUS_FORM_ERROR_INVALID_COLOR,
  STATUS_FORM_ERROR_MEMBERSHIP_ENDED,
  STATUS_FORM_ERROR_NAME,
  STATUS_FORM_ERROR_NOT_ALLOWED,
  STATUS_FORM_ERROR_UNKNOWN,
  type StateGroupKey,
  savedToast,
  statusFormErrorDuplicate,
} from "@/lib/tickets/state-copy";
import type { AdminStateRow, StateAdminErrorCode } from "@/lib/tickets/ticket-state-admin";
import { cn } from "@/lib/utils";
import { createStatusAction, updateStatusAction } from "./actions";

// UI-SPEC Surface 1d: the Add status and Edit status dialog. Client checks (trimmed name of 1 to
// 40 code points, case-insensitive uniqueness against the page's names) are a convenience; the
// server's codes are authoritative. A rejected call (no returned code) is an unknown outcome:
// submit stays disabled and the admin is told to refresh (P11 D2).

const MAX_NAME_LENGTH = 40;

export type StatusFormTarget =
  | { mode: "add"; group: StateGroupKey }
  | {
      mode: "edit";
      group: StateGroupKey;
      state: { id: string; name: string; colorToken: string };
    };

type FocusTarget = "name" | "submit" | "close";

function calloutFor(code: StateAdminErrorCode, mode: "add" | "edit"): string {
  switch (code) {
    case "INVALID_COLOR":
      return STATUS_FORM_ERROR_INVALID_COLOR;
    case "STATE_NOT_FOUND":
      return mode === "edit" ? STATUS_FORM_ERROR_DELETED : STATUS_FORM_ERROR_UNKNOWN;
    case "NOT_ALLOWED":
      return STATUS_FORM_ERROR_NOT_ALLOWED;
    case "MEMBERSHIP_ENDED":
      return STATUS_FORM_ERROR_MEMBERSHIP_ENDED;
    default:
      return STATUS_FORM_ERROR_UNKNOWN;
  }
}

export function StatusFormDialog({
  open,
  target,
  otherNames,
  onOpenChange,
  onSaved,
  onCloseAutoFocus,
}: {
  open: boolean;
  target: StatusFormTarget;
  /** The names of every other state on the page (uniqueness is checked case-insensitively). */
  otherNames: readonly string[];
  onOpenChange: (open: boolean) => void;
  onSaved: (state: AdminStateRow) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const mode = target.mode;
  const groupLabel = GROUP_LABELS[target.group];
  const initialName = target.mode === "edit" ? target.state.name : "";
  const initialColor =
    target.mode === "edit" ? target.state.colorToken : DEFAULT_GROUP_COLOR[target.group];

  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<string>(initialColor);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitLocked, setSubmitLocked] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const helpId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!focusTarget || pending) return;
    const el =
      focusTarget === "name"
        ? nameRef.current
        : focusTarget === "submit"
          ? submitRef.current
          : closeRef.current;
    el?.focus();
    setFocusTarget(null);
  }, [focusTarget, pending]);

  const trimmed = name.trim();
  const unchanged = mode === "edit" && trimmed === initialName && color === initialColor;
  const submitDisabled = pending || submitLocked || unchanged;

  function clientNameError(): string | null {
    const length = [...trimmed].length;
    if (length < 1 || length > MAX_NAME_LENGTH) return STATUS_FORM_ERROR_NAME;
    const lower = trimmed.toLowerCase();
    if (otherNames.some((n) => n.toLowerCase() === lower)) return statusFormErrorDuplicate(trimmed);
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    setCallout(null);
    const clientError = clientNameError();
    if (clientError) {
      setFieldError(clientError);
      setFocusTarget("name");
      return;
    }
    setFieldError(null);
    setPending(true);

    const result =
      target.mode === "add"
        ? await createStatusAction({ group: target.group, name: trimmed, colorToken: color }).catch(
            () => null,
          )
        : await updateStatusAction({
            stateId: target.state.id,
            ...(trimmed !== initialName ? { name: trimmed } : {}),
            ...(color !== initialColor ? { colorToken: color } : {}),
          }).catch(() => null);

    setPending(false);

    if (result === null) {
      setCallout(mode === "add" ? CREATE_OUTCOME_UNKNOWN : EDIT_OUTCOME_UNKNOWN);
      setSubmitLocked(true);
      setFocusTarget("close");
      return;
    }
    if (result.ok) {
      toast.success(
        mode === "add" ? createdToast(result.state.name) : savedToast(result.state.name),
      );
      onSaved(result.state);
      return;
    }
    if (result.error === "DUPLICATE_NAME") {
      setFieldError(statusFormErrorDuplicate(trimmed));
      setFocusTarget("name");
      return;
    }
    if (result.error === "INVALID_NAME") {
      setFieldError(STATUS_FORM_ERROR_NAME);
      setFocusTarget("name");
      return;
    }
    setCallout(calloutFor(result.error, mode));
    if (mode === "edit" && result.error === "STATE_NOT_FOUND") {
      setSubmitLocked(true);
      setFocusTarget("close");
      return;
    }
    setFocusTarget("submit");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-[480px]"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
          if (mode === "edit") nameRef.current?.select();
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
            {mode === "add" ? addStatusTitle(groupLabel) : EDIT_STATUS_TITLE}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {mode === "add"
              ? `${GROUP_DESCRIPTIONS[target.group]} ${GROUP_FIXED_ADD}`
              : groupFixedEdit(groupLabel)}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" noValidate onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor={nameId} className="text-[13px] font-semibold">
              {NAME_LABEL}
            </Label>
            <Input
              ref={nameRef}
              id={nameId}
              value={name}
              maxLength={MAX_NAME_LENGTH}
              disabled={pending}
              autoComplete="off"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${errorId} ${helpId}` : helpId}
              className="h-8 text-[13px]"
              onChange={(event) => {
                setName(event.target.value);
                if (fieldError) setFieldError(null);
              }}
            />
            {fieldError && (
              <p id={errorId} className="text-[12px] text-destructive">
                {fieldError}
              </p>
            )}
            <p id={helpId} className="text-[12px] text-muted-foreground">
              {nameHelp(groupLabel)}
            </p>
          </div>

          <fieldset className="space-y-2" disabled={pending}>
            <legend className="text-[13px] font-semibold">{COLOR_LEGEND}</legend>
            <div className="flex flex-wrap gap-2">
              {STATE_COLOR_KEYS.map((key) => {
                const checked = color === key;
                return (
                  <label key={key} className="cursor-pointer">
                    <input
                      type="radio"
                      name="color"
                      value={key}
                      checked={checked}
                      onChange={() => setColor(key)}
                      className="peer sr-only"
                    />
                    {/* The StateChip classes with the Check mark before the name (the
                        non-colour signal of the checked option). */}
                    <Badge
                      className={cn(
                        "h-5 max-w-[160px] gap-1 px-2 py-0.5 text-[12px] peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                        STATE_COLORS[key].chip,
                      )}
                    >
                      {checked && <Check className="size-3" aria-hidden="true" />}
                      <span className="truncate">{STATE_COLORS[key].displayName}</span>
                    </Badge>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div
            aria-hidden="true"
            className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground"
          >
            <span>{PREVIEW_TEAM_LABEL}</span>
            <StateChip name={trimmed || PREVIEW_PLACEHOLDER_NAME} colorToken={color} />
            <span>{PREVIEW_CUSTOMER_LABEL}</span>
            <PublicGroupChip group={target.group} />
          </div>

          {callout && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
            >
              {callout}
            </div>
          )}

          <DialogFooter>
            <Button
              ref={closeRef}
              type="button"
              variant="outline"
              size="sm"
              className="text-[13px]"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {FORM_CLOSE}
            </Button>
            <Button
              ref={submitRef}
              type="submit"
              size="sm"
              className="text-[13px]"
              disabled={submitDisabled}
            >
              {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
              {pending
                ? mode === "add"
                  ? FORM_PENDING_CREATE
                  : FORM_PENDING_SAVE
                : mode === "add"
                  ? CREATE_STATUS_CTA
                  : SAVE_CHANGES_CTA}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
