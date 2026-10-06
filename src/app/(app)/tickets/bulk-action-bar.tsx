"use client";

import {
  CircleDot,
  Flag,
  Loader2,
  type LucideIcon,
  Minus,
  Plus,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { StartProposalDialog } from "@/components/kb/start-proposal-dialog";
import { StateDot } from "@/components/tickets/state-dot";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TicketPriority } from "@/generated/prisma/client";
import { PROPOSE_KB_ARTICLE_ENTRY } from "@/lib/kb/proposal-copy";
import { proposalBulkUnavailableReason } from "@/lib/kb/proposal-entry";
import type { TicketMutationErrorCode } from "@/lib/tickets/mutations";
import {
  BULK_ERROR_STATE_DELETED,
  BULK_PICKER_SEARCH_PLACEHOLDER,
  BULK_STATUS_REFUSED_MERGED_SOURCE,
  bulkPickerNoMatch,
  GROUP_LABELS,
  STATE_GROUP_KEYS,
  type StateGroupKey,
} from "@/lib/tickets/state-copy";
import { type BulkUpdateInput, bulkUpdateTickets } from "./bulk-actions";
import { MAX_SELECTED_TICKETS, useTicketSelection } from "./ticket-selection";

// The bulk action bar (Phase 11, AIDA-48, D-08, D-10, UI-SPEC Surface 3b). Each choice applies
// at once to exactly the selected ids through bulkUpdateTickets: all or nothing, one audit row
// per ticket. Refusals come back as codes; any other failure rejects the call (11-02's one
// error contract). Both end in an inline callout, never in an error boundary, but only a
// refusal is a known rollback: a rejected call (a failure after commit, a lost response) has an
// unknown outcome and says so (Codex diff critique D2).
//
// The unknown-outcome warning stays until the agent refreshes the page or dismisses it (Codex
// diff critique round 2, E3): a changed or cleared selection, a filter change and moving between
// /tickets and /tickets/[id] all keep it, and bulk actions stay off while it shows, so the agent
// cannot retry without seeing it. It lives in this module rather than in component state, so a
// remount of the list panel keeps it and only a full page load (a refresh) starts without it.
//
// Phase 12.2 (UI-SPEC 1a, AIDA-18): owners and admins also get "Propose KB article…" after the
// pickers. It opens the Start dialog with the selected ids and stays focusable but
// aria-disabled, with a 12px reason under the bar, when AI is off, more than five tickets are
// selected, or the bar's call lock or unknown-outcome lock is on (the bar's own text is the
// reason). Each ticket's eligibility is judged by the dialog and the server, not here. A start
// keeps the selection. Members never see the button; requestProposalAction refuses them anyway.

type BulkOp = BulkUpdateInput["op"];
type Picker = "assign" | "status" | "priority" | "addTag" | "removeTag";

/** One active state of the organization, in group then sort order (UI-SPEC 3b, D-11). */
export interface BulkActionBarState {
  id: string;
  name: string;
  colorToken: string;
  group: StateGroupKey;
}

/** The 12px group headings of the shipped command palette (command-palette.tsx GROUP_CLASS). */
const GROUP_CLASS = "**:[[cmdk-group-heading]]:text-[12px]";

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

/** Remove tag and Status get a search input above this many entries; Assign and Add tag always
 * have one, because their lists have no upper bound (UI-SPEC Surface 3b). */
const SEARCH_THRESHOLD = 8;

const UNKNOWN_ERROR = "The change could not be saved. Wait a moment and try again.";

/** A refusal is a definite rollback; a rejected call may or may not have committed (D2). */
const REFUSED_PREFIX = "Nothing was changed.";
const OUTCOME_UNKNOWN_PREFIX = "The result is not known.";
const OUTCOME_UNKNOWN_REASON =
  "The change may have been saved. Refresh the page to check before you try again.";
const OUTCOME_UNKNOWN_CONTINUE =
  "Bulk actions stay off until you refresh the page or dismiss this message.";

// The unknown-outcome flag (E3). Set only by a rejected bulk call in the browser; the server
// never sets it, and its server snapshot is always false.
let outcomeUnknown = false;
// The pending flag and call guard (Codex diff critique round 3, F1). It lives here for the same
// reason as the flag above: opening a ticket remounts the bar while a call may still be pending,
// and the new bar must stay locked until that call ends (success, refusal or unknown outcome).
let callPending = false;
const outcomeListeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of outcomeListeners) listener();
}

function setOutcomeUnknown(value: boolean) {
  if (outcomeUnknown === value) return;
  outcomeUnknown = value;
  notifyListeners();
}

function setCallPending(value: boolean) {
  if (callPending === value) return;
  callPending = value;
  notifyListeners();
}

function subscribeOutcome(listener: () => void) {
  outcomeListeners.add(listener);
  return () => {
    outcomeListeners.delete(listener);
  };
}

function useOutcomeUnknown(): boolean {
  return useSyncExternalStore(
    subscribeOutcome,
    () => outcomeUnknown,
    () => false,
  );
}

function useCallPending(): boolean {
  return useSyncExternalStore(
    subscribeOutcome,
    () => callPending,
    () => false,
  );
}

export interface BulkActionBarTicket {
  id: string;
  tagIds: string[];
}

export interface BulkActionBarOption {
  id: string;
  name: string;
}

/** A refusal the service returned: a definite rollback. A rejected call is the module flag. */
interface BulkFailure {
  /** The selection the failure belongs to; a different selection hides the callout. */
  selectionKey: string;
  reason: string;
}

function tickets(count: number): string {
  return count === 1 ? "1 ticket" : `${count} tickets`;
}

function failureReason(code: TicketMutationErrorCode | null, memberName?: string): string {
  switch (code) {
    case "TICKET_UNAVAILABLE":
      return "One of the selected tickets is no longer available. Refresh the list and try again.";
    case "MEMBER_NOT_ACTIVE":
      return memberName
        ? `${memberName} is no longer a member of this workspace. Pick someone else.`
        : UNKNOWN_ERROR;
    case "TAG_MISSING":
      return "That tag no longer exists. Pick another tag.";
    case "MEMBERSHIP_ENDED":
      return "Your access to this workspace has ended. Sign out, then sign in again.";
    case "MERGED_SOURCE":
      return BULK_STATUS_REFUSED_MERGED_SOURCE;
    case "STATE_NOT_FOUND":
      return BULK_ERROR_STATE_DELETED;
    default:
      return UNKNOWN_ERROR;
  }
}

/** Matches on the option's label (keywords) only, never on its id value. */
function matchLabel(_value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLowerCase();
  if (!needle) return 1;
  return (keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle)) ? 1 : 0;
}

export function BulkActionBar({
  loaded,
  members,
  tags,
  states,
  isAdmin = false,
  aiEnabled = false,
}: {
  /** The tickets the panel rendered, with their tag ids (for Remove tag). */
  loaded: BulkActionBarTicket[];
  /** The active organization's members. */
  members: BulkActionBarOption[];
  /** The organization's tags. */
  tags: BulkActionBarOption[];
  /** The organization's active states, in group then sort order (D-11). */
  states: BulkActionBarState[];
  /** The actor is an owner or admin, computed on the server (12.2 UI-SPEC 1a, D-01). */
  isAdmin?: boolean;
  /** The organization's aiEnabled setting, read on the server (12.2 UI-SPEC 1a, D-09). */
  aiEnabled?: boolean;
}) {
  const { selectedIds, clear, reportLoaded } = useTicketSelection();
  const pending = useCallPending();
  const [openPicker, setOpenPicker] = useState<Picker | null>(null);
  const [failure, setFailure] = useState<BulkFailure | null>(null);
  // The picker whose trigger gets focus back once the call ends (review IN-04). While pending
  // every trigger is disabled (Surface 3b), so radix's return of focus on close lands on <body>.
  const [refocus, setRefocus] = useState<Picker | null>(null);
  const unknown = useOutcomeUnknown();
  // A rejected call ends with the triggers disabled, so focus goes to Dismiss instead (IN-04).
  const [focusDismiss, setFocusDismiss] = useState(false);
  // The Start dialog (12.2 UI-SPEC 1b) and the ids it was last opened with; the ids stay while it
  // closes, so its close animation and focus return run on the same tickets.
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeIds, setProposeIds] = useState<string[]>([]);
  const proposeRef = useRef<HTMLButtonElement>(null);
  const proposeReasonId = useId();

  // Report the rendered list so the selection is pruned to tickets on screen (Surface 3a).
  const loadedKey = loaded.map((ticket) => ticket.id).join(",");
  useEffect(() => {
    reportLoaded(loadedKey === "" ? [] : loadedKey.split(","));
  }, [loadedKey, reportLoaded]);

  const unknownCallout = unknown && (
    <OutcomeUnknownCallout
      takeFocus={focusDismiss && !pending}
      onFocused={() => setFocusDismiss(false)}
    />
  );

  if (selectedIds.length === 0) {
    // With nothing selected the bar shows only a pending unknown-outcome warning (E3).
    if (!unknownCallout) return null;
    return (
      <section
        aria-label="Bulk actions"
        className="sticky bottom-0 z-10 mt-auto border-t border-border/70 bg-background/95 px-4 py-2 backdrop-blur-sm"
      >
        {unknownCallout}
      </section>
    );
  }

  const selectionKey = selectedIds.join(",");
  const visibleFailure = failure?.selectionKey === selectionKey ? failure : null;

  // Remove tag offers only tags present on at least one selected ticket (UI-SPEC Assumption 5).
  const selected = new Set(selectedIds);
  const tagIdsOnSelection = new Set(
    loaded.filter((ticket) => selected.has(ticket.id)).flatMap((ticket) => ticket.tagIds),
  );
  const removableTags = tags.filter((tag) => tagIdsOnSelection.has(tag.id));

  async function run(op: BulkOp, memberName?: string) {
    // No retry while an earlier call's outcome is unknown (E3), and no second call while one is
    // pending, even from a remounted bar (F1); the triggers are disabled too.
    if (outcomeUnknown || callPending) return;
    setRefocus(openPicker);
    setOpenPicker(null);
    setFailure(null);
    const ticketIds = [...selectedIds];
    const key = ticketIds.join(",");
    setCallPending(true);
    try {
      const result = await bulkUpdateTickets({ ticketIds, op });
      if (result.ok) {
        toast.success(`Applied to ${tickets(result.count)}.`);
      } else {
        setFailure({ selectionKey: key, reason: failureReason(result.error, memberName) });
      }
    } catch {
      // Not a service refusal (11-02 rethrows everything else, Codex review C5). The call may
      // have failed after the commit, or its response may have been lost, so nothing proves a
      // rollback: say the result is not known and ask for a refresh (Codex diff critique D2).
      // The warning stays until a refresh or Dismiss (E3).
      setRefocus(null);
      setFocusDismiss(true);
      setOutcomeUnknown(true);
    } finally {
      setCallPending(false);
    }
  }

  // 12.2 UI-SPEC 1a: the proposal entry respects the bar's call lock and unknown-outcome lock
  // (no start while a bulk call runs or its outcome is unknown); the lock's reason is the bar's
  // own text for that lock.
  const lockReason =
    pending || unknown
      ? unknown
        ? OUTCOME_UNKNOWN_CONTINUE
        : `Updating ${tickets(selectedIds.length)}…`
      : null;
  const proposeReason = isAdmin
    ? proposalBulkUnavailableReason({ aiEnabled, count: selectedIds.length, locked: lockReason })
    : null;

  function openProposal() {
    // aria-disabled keeps the button focusable, so an activation is ignored here.
    if (proposeReason !== null || selectedIds.length === 0) return;
    setProposeIds([...selectedIds]);
    setProposeOpen(true);
  }

  const pickerProps = (picker: Picker) => ({
    open: openPicker === picker,
    onOpenChange: (open: boolean) => setOpenPicker(open ? picker : null),
    disabled: pending || unknown,
    refocus: !pending && refocus === picker,
    onRefocused: () => setRefocus(null),
  });

  return (
    <section
      aria-label="Bulk actions"
      className="sticky bottom-0 z-10 mt-auto space-y-2 border-t border-border/70 bg-background/95 px-4 py-2 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="text-[13px] font-semibold text-foreground">
          {pending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Updating {tickets(selectedIds.length)}…
            </span>
          ) : (
            `${tickets(selectedIds.length)} selected`
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="text-[13px]"
          disabled={pending}
          onClick={clear}
        >
          <X />
          Clear selection
        </Button>
      </div>

      {selectedIds.length >= MAX_SELECTED_TICKETS && (
        <p className="text-[12px] text-muted-foreground">
          You can select up to 100 tickets at a time.
        </p>
      )}

      {unknownCallout}

      {visibleFailure && !unknown && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
        >
          <p className="font-semibold">{REFUSED_PREFIX}</p>
          <p>{visibleFailure.reason}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <PickerButton icon={UserRound} label="Assign" {...pickerProps("assign")}>
          <MemberOptions
            members={members}
            onPick={(member) =>
              void run({ kind: "assign", assigneeId: member?.id ?? null }, member?.name)
            }
          />
        </PickerButton>

        <PickerButton icon={CircleDot} label="Status" {...pickerProps("status")}>
          <StateOptions
            states={states}
            onPick={(state) => void run({ kind: "state", stateId: state.id })}
          />
        </PickerButton>

        <PickerButton icon={Flag} label="Priority" {...pickerProps("priority")}>
          <FixedOptions
            options={PRIORITIES}
            onPick={(priority) => void run({ kind: "priority", priority })}
          />
        </PickerButton>

        <PickerButton icon={Plus} label="Add tag" {...pickerProps("addTag")}>
          <TagOptions
            tags={tags}
            alwaysSearch
            emptyText="No tags yet. Create tags in Settings → Tags."
            onPick={(tag) => void run({ kind: "addTag", tagId: tag.id })}
          />
        </PickerButton>

        <PickerButton icon={Minus} label="Remove tag" {...pickerProps("removeTag")}>
          <TagOptions
            tags={removableTags}
            emptyText="None of the selected tickets has a tag."
            onPick={(tag) => void run({ kind: "removeTag", tagId: tag.id })}
          />
        </PickerButton>

        {isAdmin && (
          <Button
            ref={proposeRef}
            variant="outline"
            size="sm"
            className="text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={proposeReason !== null ? "true" : undefined}
            aria-describedby={proposeReason !== null ? proposeReasonId : undefined}
            onClick={openProposal}
          >
            <Sparkles className="size-4" />
            {PROPOSE_KB_ARTICLE_ENTRY}
          </Button>
        )}
      </div>

      {isAdmin && proposeReason !== null && (
        <p id={proposeReasonId} className="text-[12px] text-muted-foreground">
          {proposeReason}
        </p>
      )}

      {isAdmin && (
        <StartProposalDialog
          open={proposeOpen}
          // The selection is kept after a start or a close (12.2 UI-SPEC 1b): only the dialog
          // closes, clear() is never called here.
          onOpenChange={setProposeOpen}
          ticketIds={proposeIds}
          onCloseAutoFocus={(event) => {
            // UI-SPEC 3i: focus returns to the bulk button when it is still on screen.
            if (!proposeRef.current) return;
            event.preventDefault();
            proposeRef.current.focus();
          }}
        />
      )}
    </section>
  );
}

/** The unknown-outcome warning (D2) with its way to continue (E3). */
function OutcomeUnknownCallout({
  takeFocus,
  onFocused,
}: {
  /** True once the rejected call has ended: focus moves to Dismiss. */
  takeFocus: boolean;
  onFocused: () => void;
}) {
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!takeFocus) return;
    dismissRef.current?.focus();
    onFocused();
  }, [takeFocus, onFocused]);

  return (
    <div
      role="alert"
      className="space-y-1 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
    >
      <p className="font-semibold">{OUTCOME_UNKNOWN_PREFIX}</p>
      <p>{OUTCOME_UNKNOWN_REASON}</p>
      <p>{OUTCOME_UNKNOWN_CONTINUE}</p>
      <Button
        ref={dismissRef}
        variant="outline"
        size="sm"
        className="mt-1 text-[13px]"
        onClick={() => setOutcomeUnknown(false)}
      >
        Dismiss
      </Button>
    </div>
  );
}

function PickerButton({
  icon: Icon,
  label,
  open,
  onOpenChange,
  disabled,
  refocus,
  onRefocused,
  children,
}: {
  icon: LucideIcon;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  /** True once a bulk call started from this picker has ended: focus returns to the trigger. */
  refocus: boolean;
  onRefocused: () => void;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Runs after the commit that re-enabled the trigger, so focus() is not refused.
  useEffect(() => {
    if (!refocus) return;
    triggerRef.current?.focus();
    onRefocused();
  }, [refocus, onRefocused]);

  return (
    <Popover open={open && !disabled} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          className="text-[13px]"
          disabled={disabled}
        >
          <Icon />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-0">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function OptionLabel({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate">{children}</span>;
}

function FixedOptions<T extends string>({
  options,
  onPick,
}: {
  options: { value: T; label: string }[];
  onPick: (value: T) => void;
}) {
  return (
    <Command>
      <CommandList>
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={option.value}
              className="text-[13px]"
              onSelect={() => onPick(option.value)}
            >
              <OptionLabel>{option.label}</OptionLabel>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

const UNASSIGN_VALUE = "__unassign__";

function MemberOptions({
  members,
  onPick,
}: {
  members: BulkActionBarOption[];
  /** null means Unassign. */
  onPick: (member: BulkActionBarOption | null) => void;
}) {
  const [query, setQuery] = useState("");

  // The member list has no upper bound, so it always has the search input (Surface 3b).
  return (
    <Command filter={matchLabel}>
      <CommandInput
        placeholder="Find a member…"
        value={query}
        onValueChange={setQuery}
        className="text-[13px]"
      />
      <CommandList>
        <CommandEmpty className="px-2 text-[13px] text-muted-foreground">
          No member matches "{query.trim()}".
        </CommandEmpty>
        <CommandGroup>
          <CommandItem
            value={UNASSIGN_VALUE}
            keywords={["Unassign"]}
            className="text-[13px]"
            onSelect={() => onPick(null)}
          >
            <OptionLabel>Unassign</OptionLabel>
          </CommandItem>
          {members.map((member) => (
            <CommandItem
              key={member.id}
              value={member.id}
              keywords={[member.name]}
              className="text-[13px]"
              onSelect={() => onPick(member)}
            >
              <OptionLabel>{member.name}</OptionLabel>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function TagOptions({
  tags,
  emptyText,
  alwaysSearch = false,
  onPick,
}: {
  tags: BulkActionBarOption[];
  /** Shown when there is no tag to offer at all. */
  emptyText: string;
  alwaysSearch?: boolean;
  onPick: (tag: BulkActionBarOption) => void;
}) {
  const [query, setQuery] = useState("");

  if (tags.length === 0) {
    return (
      <Command>
        <CommandList>
          <CommandEmpty className="px-2 text-[13px] text-muted-foreground">
            {emptyText}
          </CommandEmpty>
        </CommandList>
      </Command>
    );
  }

  const showSearch = alwaysSearch || tags.length > SEARCH_THRESHOLD;

  return (
    <Command filter={matchLabel}>
      {showSearch && (
        <CommandInput
          placeholder="Find a tag…"
          value={query}
          onValueChange={setQuery}
          className="text-[13px]"
        />
      )}
      <CommandList>
        <CommandEmpty className="px-2 text-[13px] text-muted-foreground">
          No tag matches "{query.trim()}".
        </CommandEmpty>
        <CommandGroup>
          {tags.map((tag) => (
            <CommandItem
              key={tag.id}
              value={tag.id}
              keywords={[tag.name]}
              className="text-[13px]"
              onSelect={() => onPick(tag)}
            >
              <OptionLabel>{tag.name}</OptionLabel>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** The grouped Status list (UI-SPEC 3b): one heading per non-empty group, a dot and the name per
 * state, a name-only search above SEARCH_THRESHOLD states. The list itself is never empty: every
 * organization keeps at least one Open, Resolved and Closed state (D-12). */
function StateOptions({
  states,
  onPick,
}: {
  states: BulkActionBarState[];
  onPick: (state: BulkActionBarState) => void;
}) {
  const [query, setQuery] = useState("");
  const showSearch = states.length > SEARCH_THRESHOLD;
  const groups = STATE_GROUP_KEYS.map((group) => ({
    group,
    items: states.filter((state) => state.group === group),
  })).filter(({ items }) => items.length > 0);

  return (
    <Command filter={matchLabel}>
      {showSearch && (
        <CommandInput
          placeholder={BULK_PICKER_SEARCH_PLACEHOLDER}
          value={query}
          onValueChange={setQuery}
          className="text-[13px]"
        />
      )}
      <CommandList>
        <CommandEmpty className="px-2 text-[13px] text-muted-foreground">
          {bulkPickerNoMatch(query.trim())}
        </CommandEmpty>
        {groups.map(({ group, items }) => (
          <CommandGroup key={group} heading={GROUP_LABELS[group]} className={GROUP_CLASS}>
            {items.map((state) => (
              <CommandItem
                key={state.id}
                value={state.id}
                keywords={[state.name]}
                title={state.name}
                className="text-[13px]"
                onSelect={() => onPick(state)}
              >
                <StateDot colorToken={state.colorToken} />
                <OptionLabel>{state.name}</OptionLabel>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
