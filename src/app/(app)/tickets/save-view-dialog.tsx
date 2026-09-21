"use client";

import { Loader2, TriangleAlert, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SavedViewVisibility } from "@/generated/prisma/client";
import type { SavedViewErrorCode } from "@/lib/saved-views/service";
import {
  type InboxFiltersInput,
  parseUrlFilters,
  TICKET_STATUSES,
} from "@/lib/tickets/list-filters";
import { createSavedViewAction, updateSavedViewAction } from "./saved-view-actions";

// Save view / Edit view dialog (Phase 11, AIDA-47, D-03 to D-05, UI-SPEC Surface 2c). Copy is
// verbatim from the 11-UI-SPEC Copywriting Contract. The server action re-validates everything;
// this dialog only shows what will be saved, warns before sharing search text (D-05), and maps
// each refusal to exactly one error row. Values are rendered as React text (escaped).

const MAX_NAME_LENGTH = 80;

const STATUS_LABELS: Record<(typeof TICKET_STATUSES)[number], string> = {
  NEW: "New",
  OPEN: "Open",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const COPY = {
  createTitle: "Save view",
  createDescription: "Keep these inbox filters so you can open them again from the sidebar.",
  editTitle: "Edit view",
  editDescription: "Change the name or filters of this view.",
  namePlaceholder: "For example: Urgent billing",
  visibilityHelp:
    'Shared views appear in every member\'s sidebar. Only you see a view set to "Only me".',
  sharedNonOwner: "Shared with everyone in this workspace.",
  makePrivateNote: "Other members will no longer see this view.",
  replacingNote:
    "These are the filters on screen now. Saving replaces the filters stored in this view.",
  missingValue: "No longer exists",
} as const;

const ERROR_COPY = {
  invalidName: "Enter a name between 1 and 80 characters.",
  duplicatePrivate: (name: string) =>
    `You already have a view named "${name}". Choose another name.`,
  duplicateShared: (name: string) =>
    `A shared view named "${name}" already exists in this workspace. Choose another name.`,
  missingReference:
    "A tag or custom field in these filters no longer exists. Remove it from the filters, then save again.",
  notAllowed: "You can't change this view. Ask the person who created it, or a workspace admin.",
  membershipEnded: "Your access to this workspace has ended. Sign out, then sign in again.",
  unknown: "The view could not be saved. Wait a moment and try again.",
} as const;

/** One error row per server refusal. NOT_FOUND reads as not allowed so a hidden view is never revealed. */
function errorMessage(code: SavedViewErrorCode | null, name: string): string {
  switch (code) {
    case "INVALID_NAME":
      return ERROR_COPY.invalidName;
    case "DUPLICATE_PRIVATE_NAME":
      return ERROR_COPY.duplicatePrivate(name);
    case "DUPLICATE_SHARED_NAME":
      return ERROR_COPY.duplicateShared(name);
    case "MISSING_REFERENCE":
      return ERROR_COPY.missingReference;
    case "NOT_ALLOWED":
    case "NOT_FOUND":
      return ERROR_COPY.notAllowed;
    case "MEMBERSHIP_ENDED":
      return ERROR_COPY.membershipEnded;
    default:
      return ERROR_COPY.unknown;
  }
}

export interface SaveViewTag {
  id: string;
  name: string;
}

export interface SaveViewCustomField {
  id: string;
  label: string;
}

export interface EditableView {
  id: string;
  name: string;
  visibility: SavedViewVisibility;
  isOwner: boolean;
}

type ModeProps =
  | { mode: "create" }
  | {
      mode: "edit";
      view: EditableView;
      /** The filters to save: the on-screen filters ("Save changes") or the stored ones. */
      filters: InboxFiltersInput;
      /** True when opened from "Save changes": the on-screen filters replace the stored ones. */
      replacing: boolean;
      /** Stored references that no longer exist (D-05), from the server. */
      missing?: { tag: boolean; customField: boolean };
    };

export type SaveViewDialogProps = ModeProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: SaveViewTag[];
  customFieldDefinitions: SaveViewCustomField[];
};

export function SaveViewDialog(props: SaveViewDialogProps) {
  const { open, onOpenChange } = props;
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="text-[13px]">
        {/* Mounted only while open, so each opening starts from fresh state. */}
        <SaveViewForm {...props} pending={pending} setPending={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function SaveViewForm(
  props: SaveViewDialogProps & { pending: boolean; setPending: (pending: boolean) => void },
) {
  const { onOpenChange, tags, customFieldDefinitions, pending, setPending } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const ids = useId();
  const isEdit = props.mode === "edit";

  const [name, setName] = useState(isEdit ? props.view.name : "");
  const [visibility, setVisibility] = useState<SavedViewVisibility>(
    isEdit ? props.view.visibility : "PRIVATE",
  );
  const [draft, setDraft] = useState<InboxFiltersInput>(() =>
    isEdit ? props.filters : parseUrlFilters(searchParams).filters,
  );
  const [error, setError] = useState<string | null>(null);

  const canChangeVisibility = !isEdit || props.view.isOwner;
  const tag = draft.tagId ? tags.find((t) => t.id === draft.tagId) : undefined;
  const field = draft.cf
    ? customFieldDefinitions.find((d) => d.id === draft.cf?.definitionId)
    : undefined;
  const tagMissing =
    draft.tagId !== undefined && (tag === undefined || (isEdit && props.missing?.tag === true));
  const fieldMissing =
    draft.cf !== undefined &&
    (field === undefined || (isEdit && props.missing?.customField === true));
  const statuses = TICKET_STATUSES.filter((s) => draft.statuses?.includes(s));
  const view = draft.view ?? "all";
  const showSharedSearchWarning = visibility === "SHARED" && Boolean(draft.q);
  const showMakePrivateNote =
    isEdit && props.view.isOwner && props.view.visibility === "SHARED" && visibility === "PRIVATE";

  function ticketsValue(): string {
    if (view === "unassigned") return "Unassigned";
    if (view === "mine") {
      return visibility === "SHARED" ? "Assigned to whoever opens the view" : "Assigned to me";
    }
    return "All tickets";
  }

  function removeTag() {
    setDraft(({ tagId: _tagId, ...rest }) => rest);
  }

  function removeCustomField() {
    setDraft(({ cf: _cf, ...rest }) => rest);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) {
      setError(ERROR_COPY.invalidName);
      return;
    }
    setError(null);
    setPending(true);
    const filters: InboxFiltersInput = {
      view,
      statuses,
      ...(draft.tagId ? { tagId: draft.tagId } : {}),
      ...(draft.cf ? { cf: draft.cf } : {}),
      ...(draft.q ? { q: draft.q } : {}),
      // D-16: the Snoozed toggle is part of the stored filters.
      ...(draft.snoozed === true ? { snoozed: true as const } : {}),
    };
    const input = { name: trimmed, visibility, filters };
    const result = await (isEdit
      ? updateSavedViewAction(props.view.id, input)
      : createSavedViewAction(input)
    ).catch(() => null);
    setPending(false);

    if (!result) {
      setError(ERROR_COPY.unknown);
      return;
    }
    if (!result.ok) {
      setError(errorMessage(result.error, trimmed));
      return;
    }
    onOpenChange(false);
    router.push(result.href);
    toast.success(isEdit ? "View updated." : "View saved.");
  }

  const nameId = `${ids}-name`;
  const visibilityId = `${ids}-visibility`;
  const visibilityHelpId = `${ids}-visibility-help`;

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold tracking-tight">
          {isEdit ? COPY.editTitle : COPY.createTitle}
        </DialogTitle>
        <DialogDescription className="text-[13px]">
          {isEdit ? COPY.editDescription : COPY.createDescription}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={nameId} className="text-[13px] font-semibold">
            Name
          </Label>
          <Input
            id={nameId}
            autoFocus
            required
            maxLength={80}
            placeholder={COPY.namePlaceholder}
            value={name}
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          {canChangeVisibility ? (
            <>
              <Label htmlFor={visibilityId} className="text-[13px] font-semibold">
                Who can see it
              </Label>
              <Select
                value={visibility}
                onValueChange={(value) => setVisibility(value as SavedViewVisibility)}
                disabled={pending}
              >
                <SelectTrigger
                  id={visibilityId}
                  aria-describedby={visibilityHelpId}
                  className="h-8 w-full text-[13px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRIVATE" className="text-[13px]">
                    Only me
                  </SelectItem>
                  <SelectItem value="SHARED" className="text-[13px]">
                    Everyone in this workspace
                  </SelectItem>
                </SelectContent>
              </Select>
              <p id={visibilityHelpId} className="text-[12px] text-muted-foreground">
                {COPY.visibilityHelp}
              </p>
              {showMakePrivateNote && (
                <p className="text-[12px] text-muted-foreground">{COPY.makePrivateNote}</p>
              )}
            </>
          ) : (
            <>
              <p className="text-[13px] font-semibold">Who can see it</p>
              <p className="text-[12px] text-muted-foreground">{COPY.sharedNonOwner}</p>
            </>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-semibold">Filters</p>
          <dl className="space-y-1 rounded-lg border border-border/70 p-4 text-[13px]">
            <SummaryRow label="Tickets">{ticketsValue()}</SummaryRow>
            <SummaryRow label="Status">
              {statuses.length > 0
                ? statuses.map((s) => STATUS_LABELS[s]).join(", ")
                : "Any status"}
            </SummaryRow>
            {draft.tagId !== undefined && (
              <SummaryRow label="Tag">
                {tagMissing ? (
                  <BrokenValue
                    removeLabel="Remove the Tag filter"
                    onRemove={removeTag}
                    disabled={pending}
                  />
                ) : (
                  tag?.name
                )}
              </SummaryRow>
            )}
            {draft.cf !== undefined && (
              <SummaryRow label="Custom field">
                {fieldMissing ? (
                  <BrokenValue
                    removeLabel="Remove the Custom field filter"
                    onRemove={removeCustomField}
                    disabled={pending}
                  />
                ) : (
                  `${field?.label} is "${draft.cf.value}"`
                )}
              </SummaryRow>
            )}
            {draft.q && <SummaryRow label="Search">{`"${draft.q}"`}</SummaryRow>}
            {draft.snoozed === true && (
              <SummaryRow label="Snoozed">Only snoozed tickets</SummaryRow>
            )}
          </dl>
          {isEdit && props.replacing && (
            <p className="text-[12px] text-muted-foreground">{COPY.replacingNote}</p>
          )}
        </div>

        {showSharedSearchWarning && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-warning"
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            <p className="min-w-0 wrap-anywhere">
              {`This view includes the search text "${draft.q}". Everyone in this workspace will be able to see it.`}
            </p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
          >
            {error}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Close without saving
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {pending ? "Saving…" : isEdit ? "Save changes" : "Save view"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground wrap-anywhere">{children}</dd>
    </div>
  );
}

function BrokenValue({
  removeLabel,
  onRemove,
  disabled,
}: {
  removeLabel: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="text-destructive">{COPY.missingValue}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={removeLabel}
        disabled={disabled}
        onClick={onRemove}
      >
        <X className="size-4" />
      </Button>
    </span>
  );
}
