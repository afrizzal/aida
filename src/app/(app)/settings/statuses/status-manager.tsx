"use client";

import { ArrowDown, ArrowUp, Ellipsis, Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { StateChip } from "@/components/tickets/state-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ADD_STATUS_BUTTON,
  addStatusAriaLabel,
  DEFAULT_BADGE,
  DEFAULT_ERROR_DELETED,
  DEFAULT_ERROR_MEMBERSHIP_ENDED,
  DEFAULT_ERROR_NOT_ALLOWED,
  DEFAULT_ERROR_NOT_OPEN,
  DEFAULT_ERROR_UNKNOWN,
  DEFAULT_OUTCOME_UNKNOWN,
  DEFAULT_UNAVAILABLE_ALREADY_DEFAULT,
  DEFAULT_UNAVAILABLE_NOT_OPEN,
  DELETE_UNAVAILABLE_NO_REPLACEMENT,
  defaultToast,
  deleteUnavailableLastInGroup,
  GROUP_DESCRIPTIONS,
  GROUP_EMPTY_PENDING,
  GROUP_LABELS,
  moveDownAriaLabel,
  moveUpAriaLabel,
  REORDER_ERROR_DELETED,
  REORDER_ERROR_MEMBERSHIP_ENDED,
  REORDER_ERROR_NOT_ALLOWED,
  REORDER_ERROR_UNKNOWN,
  REORDER_OUTCOME_UNKNOWN,
  ROW_MENU_DELETE,
  ROW_MENU_EDIT,
  ROW_MENU_SET_DEFAULT,
  reorderAnnouncement,
  rowOptionsAriaLabel,
  STATE_GROUP_KEYS,
  type StateGroupKey,
  ticketCountLabel,
} from "@/lib/tickets/state-copy";
import type { SettingsStateRow, StateAdminErrorCode } from "@/lib/tickets/ticket-state-admin";
import { cn } from "@/lib/utils";
import { moveStatusAction, setDefaultStatusAction } from "./actions";
import { DeleteStatusDialog } from "./delete-status-dialog";
import { StatusFormDialog, type StatusFormTarget } from "./status-form-dialog";

// UI-SPEC Surface 1b, 1c, 1f and 1h: the four group cards, the rows, reorder and set default,
// the polite live region and the per-group callouts. Nothing is optimistic: a row moves and the
// default badge follows when the refreshed list arrives. A returned code is a refusal; a
// rejected call (`.catch(() => null)`) is an unknown outcome (P11 D2).

type Direction = "up" | "down";

/** A focusable control, found by its data-focus-key after a refresh (UI-SPEC 1h). */
type FocusKey = `options-${string}` | `up-${string}` | `down-${string}` | `add-${string}`;

/** Focuses the first control found by its data-focus-key; false when none exists. */
function focusFirstIn(container: HTMLElement | null, keys: readonly FocusKey[]): boolean {
  for (const key of keys) {
    const el = container?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
    if (el) {
      el.focus();
      return true;
    }
  }
  return false;
}

function reorderError(code: StateAdminErrorCode): string {
  switch (code) {
    case "STATE_NOT_FOUND":
      return REORDER_ERROR_DELETED;
    case "NOT_ALLOWED":
      return REORDER_ERROR_NOT_ALLOWED;
    case "MEMBERSHIP_ENDED":
      return REORDER_ERROR_MEMBERSHIP_ENDED;
    default:
      return REORDER_ERROR_UNKNOWN;
  }
}

function defaultError(code: StateAdminErrorCode): string {
  switch (code) {
    case "NOT_OPEN_GROUP":
      return DEFAULT_ERROR_NOT_OPEN;
    case "STATE_NOT_FOUND":
      return DEFAULT_ERROR_DELETED;
    case "NOT_ALLOWED":
      return DEFAULT_ERROR_NOT_ALLOWED;
    case "MEMBERSHIP_ENDED":
      return DEFAULT_ERROR_MEMBERSHIP_ENDED;
    default:
      return DEFAULT_ERROR_UNKNOWN;
  }
}

/** UI-SPEC 1c: why "Use for new tickets" is unavailable on a row, or null when it is available. */
function defaultUnavailableReason(state: SettingsStateRow, defaultStateId: string): string | null {
  if (state.id === defaultStateId) return DEFAULT_UNAVAILABLE_ALREADY_DEFAULT;
  if (state.group !== "OPEN") return DEFAULT_UNAVAILABLE_NOT_OPEN;
  return null;
}

/** UI-SPEC 1c (D-12, K41): why deleting is refused up front, or null when the dialog may open. */
function deleteUnavailableReason(
  state: SettingsStateRow,
  groupStates: readonly SettingsStateRow[],
): string | null {
  if (state.group !== "PENDING" && groupStates.length <= 1) {
    return deleteUnavailableLastInGroup(GROUP_LABELS[state.group]);
  }
  if (state.group === "PENDING" && state.ticketCount > 0 && groupStates.length <= 1) {
    return DELETE_UNAVAILABLE_NO_REPLACEMENT;
  }
  return null;
}

export function StatusManager({
  states,
  defaultStateId,
  isAdmin,
}: {
  states: SettingsStateRow[];
  defaultStateId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  const [announcement, setAnnouncement] = useState("");
  const [callouts, setCallouts] = useState<Partial<Record<StateGroupKey, string>>>({});
  const [pendingMove, setPendingMove] = useState<{ id: string; direction: Direction } | null>(null);
  const [movesLocked, setMovesLocked] = useState(false);
  /** The group whose list is aria-busy: from the move call until the refreshed list arrives. */
  const [busyGroup, setBusyGroup] = useState<StateGroupKey | null>(null);
  const [formTarget, setFormTarget] = useState<StatusFormTarget | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SettingsStateRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  /** Focus to apply once the refreshed list arrives (first key found wins). */
  const pendingFocusRef = useRef<{ keys: FocusKey[]; states: SettingsStateRow[] } | null>(null);
  /** Focus to apply when a dialog closes (replaces the radix return). */
  const dialogReturnRef = useRef<FocusKey[]>([]);

  const moveBusy = pendingMove !== null || isRefreshing || movesLocked;
  // Review UI-WR-c4: one set-default at a time, so toasts and focus cannot finish out of order.
  // The ref is the guard; the state only renders the items aria-disabled while it is pending.
  const defaultPendingRef = useRef(false);
  const [defaultPending, setDefaultPending] = useState(false);

  const focusFirst = (keys: readonly FocusKey[]) => focusFirstIn(containerRef.current, keys);

  useEffect(() => {
    setBusyGroup(null);
    const pending = pendingFocusRef.current;
    if (!pending || pending.states === states) return;
    pendingFocusRef.current = null;
    focusFirstIn(containerRef.current, pending.keys);
  }, [states]);

  function refreshThenFocus(keys: FocusKey[]) {
    pendingFocusRef.current = { keys, states };
    startTransition(() => router.refresh());
  }

  function setGroupCallout(group: StateGroupKey, text: string | null) {
    setCallouts((prev) => {
      const next = { ...prev };
      if (text) next[group] = text;
      else delete next[group];
      return next;
    });
  }

  async function handleMove(state: SettingsStateRow, direction: Direction) {
    if (moveBusy) return;
    setGroupCallout(state.group, null);
    setPendingMove({ id: state.id, direction });
    setBusyGroup(state.group);
    const result = await moveStatusAction({ stateId: state.id, direction }).catch(() => null);
    setPendingMove(null);
    if (result === null || !result.ok) setBusyGroup(null);
    if (result === null) {
      setMovesLocked(true);
      setGroupCallout(state.group, REORDER_OUTCOME_UNKNOWN);
      return;
    }
    if (!result.ok) {
      setGroupCallout(state.group, reorderError(result.error));
      return;
    }
    setAnnouncement(
      reorderAnnouncement(result.name, result.position, result.total, GROUP_LABELS[result.group]),
    );
    refreshThenFocus([`${direction}-${state.id}`]);
  }

  async function handleSetDefault(state: SettingsStateRow) {
    if (defaultPendingRef.current) return;
    defaultPendingRef.current = true;
    setGroupCallout(state.group, null);
    // Rendered after the menu's select event, not inside it: Radix flushes that event
    // synchronously, and re-rendering the closing menu there dropped focus to the body.
    queueMicrotask(() => setDefaultPending(true));
    const result = await setDefaultStatusAction({ stateId: state.id })
      .catch(() => null)
      .finally(() => {
        defaultPendingRef.current = false;
        setDefaultPending(false);
      });
    if (result === null || !result.ok) {
      setGroupCallout(
        state.group,
        result === null ? DEFAULT_OUTCOME_UNKNOWN : defaultError(result.error),
      );
      // UI-SPEC 1h: the menu is gone, so focus returns to the row's options button explicitly.
      focusFirst([`options-${state.id}`]);
      return;
    }
    toast.success(defaultToast(result.name));
    refreshThenFocus([`options-${state.id}`]);
  }

  function openForm(target: StatusFormTarget, returnKeys: FocusKey[]) {
    setGroupCallout(target.group, null);
    dialogReturnRef.current = returnKeys;
    setFormTarget(target);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  }

  function handleFormSaved(saved: { id: string; group: StateGroupKey }) {
    const target = formTarget;
    setFormOpen(false);
    if (target?.mode === "add") {
      // UI-SPEC 1h: the new row's options button once it exists, else the group's Add button.
      dialogReturnRef.current = [`add-${saved.group}`];
      refreshThenFocus([`options-${saved.id}`, `add-${saved.group}`]);
    } else {
      dialogReturnRef.current = [`options-${saved.id}`];
      refreshThenFocus([`options-${saved.id}`]);
    }
  }

  function openDelete(state: SettingsStateRow) {
    setGroupCallout(state.group, null);
    // UI-SPEC 1h: closed without deleting returns to the row's options button.
    dialogReturnRef.current = [`options-${state.id}`];
    setDeleteTarget(state);
    setFormKey((k) => k + 1);
    setDeleteOpen(true);
  }

  function handleDeleted(state: SettingsStateRow) {
    // UI-SPEC 1h: the next row's options button, else the previous row's, else Add status.
    const groupStates = states.filter((s) => s.group === state.group);
    const index = groupStates.findIndex((s) => s.id === state.id);
    const next = groupStates[index + 1];
    const previous = index > 0 ? groupStates[index - 1] : undefined;
    const keys: FocusKey[] = [];
    if (next) keys.push(`options-${next.id}`);
    if (previous) keys.push(`options-${previous.id}`);
    keys.push(`add-${state.group}`);
    dialogReturnRef.current = keys;
    setDeleteOpen(false);
    refreshThenFocus(keys);
  }

  const otherNames = (excludeId: string | null) =>
    states.filter((s) => s.id !== excludeId).map((s) => s.name);

  return (
    <div ref={containerRef} className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {STATE_GROUP_KEYS.map((group) => {
        const groupStates = states.filter((s) => s.group === group);
        const groupLabel = GROUP_LABELS[group];
        const headingId = `group-${group}-heading`;
        const callout = callouts[group];
        return (
          <Card key={group} className="border-border/70 p-0 shadow-sm">
            <section aria-labelledby={headingId}>
              <div className="flex items-start justify-between gap-4 border-b border-border/70 p-4">
                <div className="space-y-1">
                  <h2 id={headingId} className="text-[15px] font-semibold tracking-tight">
                    {groupLabel}
                  </h2>
                  <p className="text-[12px] text-muted-foreground">{GROUP_DESCRIPTIONS[group]}</p>
                </div>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[13px]"
                    aria-label={addStatusAriaLabel(groupLabel)}
                    data-focus-key={`add-${group}`}
                    onClick={() => openForm({ mode: "add", group }, [`add-${group}`])}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {ADD_STATUS_BUTTON}
                  </Button>
                )}
              </div>
              {callout && (
                <div
                  role="alert"
                  className="mx-4 mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
                >
                  {callout}
                </div>
              )}
              {groupStates.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  {GROUP_EMPTY_PENDING}
                </p>
              ) : (
                <ol
                  aria-labelledby={headingId}
                  aria-busy={busyGroup === group}
                  className="divide-y divide-border/70"
                >
                  {groupStates.map((state, index) => (
                    <StatusRow
                      key={state.id}
                      state={state}
                      isDefault={state.id === defaultStateId}
                      isAdmin={isAdmin}
                      isFirst={index === 0}
                      isLast={index === groupStates.length - 1}
                      moveBusy={moveBusy}
                      pendingDirection={pendingMove?.id === state.id ? pendingMove.direction : null}
                      defaultReason={defaultUnavailableReason(state, defaultStateId)}
                      defaultBusy={defaultPending}
                      deleteReason={deleteUnavailableReason(state, groupStates)}
                      onMove={(direction) => handleMove(state, direction)}
                      onEdit={() =>
                        openForm(
                          {
                            mode: "edit",
                            group,
                            state: { id: state.id, name: state.name, colorToken: state.colorToken },
                          },
                          [`options-${state.id}`],
                        )
                      }
                      onSetDefault={() => handleSetDefault(state)}
                      onDelete={() => openDelete(state)}
                    />
                  ))}
                </ol>
              )}
            </section>
          </Card>
        );
      })}

      {deleteTarget && (
        <DeleteStatusDialog
          key={`delete-${formKey}`}
          open={deleteOpen}
          state={deleteTarget}
          replacements={states.filter(
            (s) => s.group === deleteTarget.group && s.id !== deleteTarget.id,
          )}
          onOpenChange={setDeleteOpen}
          onDeleted={() => handleDeleted(deleteTarget)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusFirstIn(containerRef.current, dialogReturnRef.current);
          }}
        />
      )}

      {formTarget && (
        <StatusFormDialog
          key={formKey}
          open={formOpen}
          target={formTarget}
          otherNames={otherNames(formTarget.mode === "edit" ? formTarget.state.id : null)}
          onOpenChange={setFormOpen}
          onSaved={handleFormSaved}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusFirst(dialogReturnRef.current);
          }}
        />
      )}
    </div>
  );
}

function StatusRow({
  state,
  isDefault,
  isAdmin,
  isFirst,
  isLast,
  moveBusy,
  pendingDirection,
  defaultReason,
  defaultBusy,
  deleteReason,
  onMove,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  state: SettingsStateRow;
  isDefault: boolean;
  isAdmin: boolean;
  isFirst: boolean;
  isLast: boolean;
  moveBusy: boolean;
  pendingDirection: Direction | null;
  defaultReason: string | null;
  /** A set-default is pending on some row: the item is aria-disabled until it settles. */
  defaultBusy: boolean;
  deleteReason: string | null;
  onMove: (direction: Direction) => void;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const defaultReasonId = `default-reason-${state.id}`;
  const deleteReasonId = `delete-reason-${state.id}`;
  const defaultUnavailable = defaultReason !== null || defaultBusy;
  const optionsRef = useRef<HTMLButtonElement>(null);

  return (
    <li className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">
      <StateChip name={state.name} colorToken={state.colorToken} />
      {isDefault && (
        <Badge variant="secondary" className="h-5 px-2 text-[12px]">
          {DEFAULT_BADGE}
        </Badge>
      )}
      <span className="text-[12px] text-muted-foreground tabular-nums">
        {ticketCountLabel(state.ticketCount)}
      </span>
      {isAdmin && (
        <div className="ml-auto flex items-center gap-1">
          <MoveButton
            direction="up"
            stateId={state.id}
            label={moveUpAriaLabel(state.name)}
            unavailable={isFirst || moveBusy}
            pending={pendingDirection === "up"}
            onMove={onMove}
          />
          <MoveButton
            direction="down"
            stateId={state.id}
            label={moveDownAriaLabel(state.name)}
            unavailable={isLast || moveBusy}
            pending={pendingDirection === "down"}
            onMove={onMove}
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                ref={optionsRef}
                aria-label={rowOptionsAriaLabel(state.name)}
                data-focus-key={`options-${state.id}`}
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-[260px]"
              onCloseAutoFocus={(event) => {
                // A menu still closing can take focus back (Radix focuses the content when the
                // pointer leaves an item), and its unmount then drops focus to the body. Only in
                // that case focus returns to this row's Options button; focus anywhere else stays.
                const active = document.activeElement;
                if (active && active !== document.body) return;
                event.preventDefault();
                optionsRef.current?.focus();
              }}
            >
              <DropdownMenuItem className="text-[13px]" onSelect={onEdit}>
                <Pencil aria-hidden="true" />
                {ROW_MENU_EDIT}
              </DropdownMenuItem>
              {/* aria-disabled, not disabled: Radix drops disabled items from keyboard navigation,
                  so the reason could never be heard (review UI-WR-c1). The reason line is
                  aria-hidden, so it is read once, as the description, not also in the name. */}
              <DropdownMenuItem
                className={cn("items-start text-[13px]", defaultUnavailable && "opacity-50")}
                aria-disabled={defaultUnavailable ? true : undefined}
                aria-describedby={defaultReason ? defaultReasonId : undefined}
                onSelect={(event) => {
                  if (defaultUnavailable) {
                    event.preventDefault();
                    return;
                  }
                  onSetDefault();
                }}
              >
                <Star aria-hidden="true" />
                <span className="space-y-1">
                  <span className="block">{ROW_MENU_SET_DEFAULT}</span>
                  {defaultReason && (
                    <span
                      id={defaultReasonId}
                      aria-hidden="true"
                      className="block text-[12px] text-muted-foreground"
                    >
                      {defaultReason}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className={cn("items-start text-[13px]", deleteReason && "opacity-50")}
                aria-disabled={deleteReason ? true : undefined}
                aria-describedby={deleteReason ? deleteReasonId : undefined}
                onSelect={(event) => {
                  if (deleteReason) {
                    event.preventDefault();
                    return;
                  }
                  onDelete();
                }}
              >
                <Trash2 aria-hidden="true" />
                <span className="space-y-1">
                  <span className="block">{ROW_MENU_DELETE}</span>
                  {deleteReason && (
                    <span
                      id={deleteReasonId}
                      aria-hidden="true"
                      className="block text-[12px] text-muted-foreground"
                    >
                      {deleteReason}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}

function MoveButton({
  direction,
  stateId,
  label,
  unavailable,
  pending,
  onMove,
}: {
  direction: Direction;
  stateId: string;
  label: string;
  unavailable: boolean;
  pending: boolean;
  onMove: (direction: Direction) => void;
}) {
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <Button
      variant="ghost"
      size="icon"
      // aria-disabled (not disabled) keeps focus on a button that just reached the end (1c).
      aria-disabled={unavailable ? true : undefined}
      aria-label={label}
      data-focus-key={`${direction}-${stateId}`}
      className={cn("size-8", unavailable && "opacity-50")}
      onClick={() => {
        if (!unavailable) onMove(direction);
      }}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}
