"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  addTag,
  assignTicket,
  changePriority,
  changeState,
  removeTag,
  setCustomFieldValue,
  setTriageCategory,
  setTriageLanguage,
  setTriageSentiment,
} from "@/app/(app)/tickets/[id]/actions";
import { useRegisterCommands } from "@/components/command-provider";
import { AssigneeAvatar } from "@/components/tickets/assignee-avatar";
import {
  CustomFieldInput,
  type CustomFieldInputDefinition,
  type CustomFieldValue as CustomFieldInputValue,
} from "@/components/tickets/custom-field-input";
import { type LinkedTicketChip, LinkedTicketsRow } from "@/components/tickets/linked-tickets-row";
import { PriorityChip } from "@/components/tickets/priority-chip";
import { SlaDueChip } from "@/components/tickets/sla-due-chip";
import { StateChip } from "@/components/tickets/state-chip";
import { StateDot } from "@/components/tickets/state-dot";
import { TagChip } from "@/components/tickets/tag-chip";
import { TicketActionsMenu } from "@/components/tickets/ticket-actions-menu";
import { TriageCategoryChip } from "@/components/tickets/triage-category-chip";
import { TriageSentimentChip } from "@/components/tickets/triage-sentiment-chip";
import { TriageStatusChip } from "@/components/tickets/triage-status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  TicketPriority,
  TriageCategory,
  TriageSentiment,
  TriageStatus,
} from "@/generated/prisma/client";
import type { Command as RegistryCommand } from "@/lib/commands/registry";
import type { TicketMutationErrorCode } from "@/lib/tickets/mutations";
import {
  GROUP_LABELS,
  MERGED_SOURCE_REASON,
  STATE_GROUP_KEYS,
  STATUS_CHANGE_ERROR_MEMBERSHIP_ENDED,
  STATUS_CHANGE_ERROR_STATE_DELETED,
  STATUS_CHANGE_ERROR_TICKET_UNAVAILABLE,
  STATUS_CHANGE_ERROR_UNKNOWN,
  STATUS_CHANGE_OUTCOME_UNKNOWN,
  STATUS_MENU_TRIGGER_LABEL,
  STATUS_REFUSED_MERGED_SOURCE,
  type StateGroupKey,
} from "@/lib/tickets/state-copy";

/** UI-SPEC 3a: the "Status change error" row for a returned refusal code. */
function statusChangeErrorText(code: TicketMutationErrorCode | undefined): string {
  switch (code) {
    case "MERGED_SOURCE":
      return STATUS_REFUSED_MERGED_SOURCE;
    case "STATE_NOT_FOUND":
      return STATUS_CHANGE_ERROR_STATE_DELETED;
    case "TICKET_UNAVAILABLE":
      return STATUS_CHANGE_ERROR_TICKET_UNAVAILABLE;
    case "MEMBERSHIP_ENDED":
      return STATUS_CHANGE_ERROR_MEMBERSHIP_ENDED;
    default:
      return STATUS_CHANGE_ERROR_UNKNOWN;
  }
}

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const CATEGORIES: { value: TriageCategory; label: string }[] = [
  { value: "BILLING", label: "Billing" },
  { value: "TECHNICAL", label: "Technical" },
  { value: "ACCOUNT", label: "Account" },
  { value: "FEATURE_REQUEST", label: "Feature Request" },
  { value: "OTHER", label: "Other" },
];

const SENTIMENTS: { value: TriageSentiment; label: string }[] = [
  { value: "POSITIVE", label: "Positive" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "NEGATIVE", label: "Negative" },
];

const UNASSIGNED_VALUE = "unassigned";

export interface TicketMetaHeaderTicket {
  id: string;
  number: number;
  subject: string;
  /** The ticket's state (Phase 12.1, D-11): the chip shows name and colour; rules read the group. */
  state: { id: string; name: string; colorToken: string; group: StateGroupKey };
  /** Set while the ticket is in a Pending state (D-16); the SLA chip then reads as paused (D-18). */
  slaPausedAt: Date | string | null;
  priority: TicketPriority;
  assigneeId: string | null;
  firstResponseDueAt: Date | string;
  resolutionDueAt: Date | string;
  firstRespondedAt: Date | string | null;
  resolvedAt: Date | string | null;
  isAtRisk: boolean;
  isBreached: boolean;
  triageCategory: TriageCategory | null;
  triageSentiment: TriageSentiment | null;
  triageLanguage: string | null;
  triageStatus: TriageStatus | null;
}

export interface TicketMetaHeaderMember {
  id: string;
  name: string;
}

/** One active state of the organization as the top-bar picker lists it (UI-SPEC 3a). */
export interface TicketMetaHeaderState {
  id: string;
  name: string;
  colorToken: string;
  group: StateGroupKey;
}

export interface TicketMetaHeaderTag {
  id: string;
  name: string;
}

export interface TicketMetaHeaderCustomField {
  definition: CustomFieldInputDefinition;
  value: CustomFieldInputValue;
}

interface TicketMetaHeaderProps {
  ticket: TicketMetaHeaderTicket;
  /** The organization's active states in group then sort order (UI-SPEC 3a). */
  states: TicketMetaHeaderState[];
  assigneeName: string | null;
  members: TicketMetaHeaderMember[];
  tags: TicketMetaHeaderTag[];
  availableTags: TicketMetaHeaderTag[];
  customFields: TicketMetaHeaderCustomField[];
  /** Relations from this ticket's side, sorted (12-06, UI-SPEC 2a). */
  relations?: LinkedTicketChip[];
  /** The ticket was merged into another one (D-07). */
  mergedSource?: boolean;
  /** Other tickets were merged into this one (D-07). */
  hasReceivedMerges?: boolean;
  /** The actor is an owner or admin, computed on the server (12.2 UI-SPEC 1a, D-01). */
  isAdmin?: boolean;
  /** The organization's aiEnabled setting, read on the server (12.2 UI-SPEC 1a, D-09). */
  aiEnabled?: boolean;
  /** Slot for the snooze control (12-07), rendered before the actions menu (UI-SPEC Surface 1). */
  snoozeControl?: ReactNode;
}

/**
 * When a menu was opened by its key or palette command (11-08, UI-SPEC 5c), focus goes to the
 * current value as soon as the menu content mounts. Radix's own open focus then sees focus
 * already inside the menu and leaves it there. A menu opened by a click keeps Radix's own focus.
 */
function focusCurrentValue(content: HTMLElement | null, requested: RefObject<boolean>) {
  if (!content || !requested.current) return;
  requested.current = false;
  const item = content.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
  item?.focus({ preventScroll: true });
  // The status menu scrolls (max-h-[320px]): bring the focused value into view inside it only
  // (review UI-WR-c2). preventScroll above keeps the page itself from jumping.
  item?.scrollIntoView({ block: "nearest" });
}

/** Which SLA timer is still "live" — mirrors ticket-list-row.tsx's identical helper. */
function getActiveDue(ticket: TicketMetaHeaderTicket): Date | string | null {
  if (!ticket.firstRespondedAt) return ticket.firstResponseDueAt;
  if (!ticket.resolvedAt) return ticket.resolutionDueAt;
  return null;
}

export function TicketMetaHeader({
  ticket,
  states,
  assigneeName,
  members,
  tags,
  availableTags,
  customFields,
  relations = [],
  mergedSource = false,
  hasReceivedMerges = false,
  isAdmin = false,
  aiEnabled = false,
  snoozeControl,
}: TicketMetaHeaderProps) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [languagePopoverOpen, setLanguagePopoverOpen] = useState(false);
  // Controlled so the a and s keys (and the palette's This ticket group) can open them (11-08).
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const focusStatusValue = useRef(false);
  const focusAssigneeValue = useRef(false);
  // The "More ticket actions" trigger, shared with the Linked tickets row (review UI-WR-04).
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const statusReasonId = useId();
  const stateChipId = useId();
  const statusMenuRef = useCallback(
    (node: HTMLDivElement | null) => focusCurrentValue(node, focusStatusValue),
    [],
  );
  const assigneeMenuRef = useCallback(
    (node: HTMLDivElement | null) => focusCurrentValue(node, focusAssigneeValue),
    [],
  );

  // The This ticket commands (AIDA-49, AIDA-50, UI-SPEC 4c and 5c): the a, s and t keys run the
  // same handlers as the palette items.
  const ticketCommands: RegistryCommand[] = [
    {
      id: "ticket.assign",
      label: "Assign this ticket",
      group: "this-ticket",
      keywords: ["assignee", "owner"],
      order: 0,
      icon: "user-plus",
      when: (context) => context.ticketId !== null,
      run: () => {
        focusAssigneeValue.current = true;
        setAssigneeMenuOpen(true);
      },
    },
    {
      id: "ticket.status",
      label: "Change status",
      group: "this-ticket",
      keywords: ["status", "resolve", "close"],
      order: 1,
      icon: "circle-dot",
      when: (context) => context.ticketId !== null,
      run: () => {
        focusStatusValue.current = true;
        setStatusMenuOpen(true);
      },
    },
    {
      id: "ticket.tag",
      label: "Add a tag",
      group: "this-ticket",
      keywords: ["tag", "label"],
      order: 2,
      icon: "tag",
      when: (context) => context.ticketId !== null,
      // The popover moves focus into its search input when it opens.
      run: () => setTagPopoverOpen(true),
    },
  ];
  useRegisterCommands(ticketCommands, [ticket.id]);

  const activeDue = getActiveDue(ticket);
  const stateMenuGroups = STATE_GROUP_KEYS.map((group) => ({
    group,
    items: states.filter((state) => state.group === group),
  })).filter(({ items }) => items.length > 0);
  const untaggedAvailable = availableTags.filter((t) => !tags.some((tg) => tg.id === t.id));

  // UI-SPEC 3a: success shows nothing (the page refreshes through revalidation); a returned code
  // shows its "Status change error" row; a rejected call may have changed the state, so its toast
  // stays until dismissed (P11 D2). Focus stays on the trigger (Radix returns it there).
  function handleStateChange(stateId: string) {
    startTransition(async () => {
      const result = await changeState(ticket.id, stateId).catch(() => null);
      if (result === null) {
        toast.error(STATUS_CHANGE_OUTCOME_UNKNOWN, { duration: Infinity });
        return;
      }
      if (result.ok) return;
      // A merged source keeps its status (Codex diff round 1, D1); this page may predate the merge.
      toast.error(statusChangeErrorText(result.error));
      // The chosen state was deleted meanwhile: refresh so the menu lists current states.
      if (result.error === "STATE_NOT_FOUND") router.refresh();
    });
  }

  function handlePriorityChange(priority: TicketPriority) {
    startTransition(async () => {
      const result = await changePriority(ticket.id, priority).catch(() => null);
      if (!result?.ok) toast.error("Couldn't update priority. Try again.");
    });
  }

  function handleCategoryChange(category: TriageCategory) {
    startTransition(async () => {
      const result = await setTriageCategory(ticket.id, category).catch(() => null);
      if (!result?.ok) toast.error("Couldn't update category. Try again.");
    });
  }

  function handleSentimentChange(sentiment: TriageSentiment) {
    startTransition(async () => {
      const result = await setTriageSentiment(ticket.id, sentiment).catch(() => null);
      if (!result?.ok) toast.error("Couldn't update sentiment. Try again.");
    });
  }

  function handleLanguageChange(code: string) {
    setLanguagePopoverOpen(false);
    startTransition(async () => {
      const result = await setTriageLanguage(ticket.id, code).catch(() => null);
      if (!result?.ok) toast.error("Couldn't update language. Try again.");
    });
  }

  function handleAssigneeChange(value: string) {
    const assigneeId = value === UNASSIGNED_VALUE ? null : value;
    startTransition(async () => {
      const result = await assignTicket(ticket.id, assigneeId).catch(() => null);
      if (!result?.ok) toast.error("Couldn't update assignee. Try again.");
    });
  }

  function handleAddTag(name: string) {
    setTagPopoverOpen(false);
    startTransition(async () => {
      const result = await addTag(ticket.id, name).catch(() => null);
      if (!result?.ok) toast.error("Couldn't add tag. Try again.");
    });
  }

  function handleRemoveTag(tagId: string) {
    startTransition(async () => {
      const result = await removeTag(ticket.id, tagId).catch(() => null);
      if (!result?.ok) toast.error("Couldn't remove tag. Try again.");
    });
  }

  function handleCustomFieldChange(definitionId: string, value: CustomFieldInputValue) {
    startTransition(async () => {
      const result = await setCustomFieldValue(ticket.id, definitionId, value ?? null).catch(
        () => null,
      );
      if (!result?.ok) toast.error("Couldn't update field. Try again.");
    });
  }

  return (
    <div>
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur-sm">
        <span className="shrink-0 text-[18px] font-semibold text-muted-foreground">
          #{ticket.number}
        </span>
        <h1 className="truncate text-[18px] font-semibold">{ticket.subject}</h1>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <DropdownMenu open={statusMenuOpen} onOpenChange={setStatusMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={STATUS_MENU_TRIGGER_LABEL}
                aria-describedby={stateChipId}
              >
                <StateChip
                  id={stateChipId}
                  name={ticket.state.name}
                  colorToken={ticket.state.colorToken}
                />
              </button>
            </DropdownMenuTrigger>
            {/* A merged source keeps its status (D-07, D-08; Codex diff round 1, D1): every
                choice is disabled (not hidden) and the reason is a 12px muted line, as Merge
                shows its reason in "More ticket actions". The server refuses it anyway. */}
            <DropdownMenuContent
              ref={statusMenuRef}
              className="w-[240px] max-h-[320px] overflow-y-auto"
              aria-describedby={mergedSource ? statusReasonId : undefined}
            >
              {mergedSource && (
                <p
                  id={statusReasonId}
                  className="max-w-[240px] px-2 py-1.5 text-[12px] text-muted-foreground"
                >
                  {MERGED_SOURCE_REASON}
                </p>
              )}
              {/* UI-SPEC 3a: one radio group over the active states, a label per non-empty
                  group (OPEN, PENDING, RESOLVED, CLOSED) and a separator between groups. */}
              <DropdownMenuRadioGroup
                value={ticket.state.id}
                onValueChange={(value) => {
                  if (!mergedSource && value !== ticket.state.id) handleStateChange(value);
                }}
              >
                {stateMenuGroups.map(({ group, items }, index) => (
                  <Fragment key={group}>
                    {index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-[12px] font-semibold text-muted-foreground">
                      {GROUP_LABELS[group]}
                    </DropdownMenuLabel>
                    {items.map((state) => (
                      <DropdownMenuRadioItem
                        key={state.id}
                        value={state.id}
                        disabled={mergedSource}
                        title={state.name}
                        className="text-[13px]"
                      >
                        <StateDot colorToken={state.colorToken} />
                        <span className="min-w-0 truncate">{state.name}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </Fragment>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Change priority">
                <PriorityChip priority={ticket.priority} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={ticket.priority}
                onValueChange={(value) => handlePriorityChange(value as TicketPriority)}
              >
                {PRIORITIES.map((priority) => (
                  <DropdownMenuRadioItem key={priority.value} value={priority.value}>
                    {priority.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu open={assigneeMenuOpen} onOpenChange={setAssigneeMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <AssigneeAvatar name={assigneeName} />
                <span className="max-w-[120px] truncate text-[13px]">
                  {assigneeName ?? "Unassigned"}
                </span>
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent ref={assigneeMenuRef}>
              <DropdownMenuRadioGroup
                value={ticket.assigneeId ?? UNASSIGNED_VALUE}
                onValueChange={handleAssigneeChange}
              >
                <DropdownMenuRadioItem value={UNASSIGNED_VALUE}>Unassign</DropdownMenuRadioItem>
                {members.map((member) => (
                  <DropdownMenuRadioItem key={member.id} value={member.id}>
                    {member.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {activeDue && (
            <SlaDueChip
              dueAt={activeDue}
              isAtRisk={ticket.isAtRisk}
              isBreached={ticket.isBreached}
              pausedAt={ticket.slaPausedAt}
            />
          )}

          {snoozeControl}

          <TicketActionsMenu
            ticketId={ticket.id}
            ticketNumber={ticket.number}
            ticketSubject={ticket.subject}
            ticketState={{ name: ticket.state.name, colorToken: ticket.state.colorToken }}
            mergedSource={mergedSource}
            hasReceivedMerges={hasReceivedMerges}
            stateGroup={ticket.state.group}
            isAdmin={isAdmin}
            aiEnabled={aiEnabled}
            triggerRef={actionsTriggerRef}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-border/70 border-b px-6 py-2">
        {ticket.triageCategory !== null && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Change category">
                <TriageCategoryChip category={ticket.triageCategory} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={ticket.triageCategory}
                onValueChange={(value) => handleCategoryChange(value as TriageCategory)}
              >
                {CATEGORIES.map((category) => (
                  <DropdownMenuRadioItem key={category.value} value={category.value}>
                    {category.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {ticket.triageSentiment !== null && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Change sentiment">
                <TriageSentimentChip sentiment={ticket.triageSentiment} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={ticket.triageSentiment}
                onValueChange={(value) => handleSentimentChange(value as TriageSentiment)}
              >
                {SENTIMENTS.map((sentiment) => (
                  <DropdownMenuRadioItem key={sentiment.value} value={sentiment.value}>
                    {sentiment.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {ticket.triageLanguage !== null && (
          <Popover open={languagePopoverOpen} onOpenChange={setLanguagePopoverOpen}>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Change language">
                <Badge
                  variant="outline"
                  className="h-5 px-2 py-0.5 text-[12px] text-muted-foreground"
                >
                  {ticket.triageLanguage.toUpperCase()}
                </Badge>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-2">
              <Input
                defaultValue={ticket.triageLanguage}
                maxLength={2}
                placeholder="en"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleLanguageChange((event.target as HTMLInputElement).value);
                  }
                }}
              />
            </PopoverContent>
          </Popover>
        )}

        {ticket.triageStatus !== null && (
          <TriageStatusChip ticketId={ticket.id} triageStatus={ticket.triageStatus} />
        )}

        {tags.map((tag) => (
          <TagChip key={tag.id} label={tag.name} onRemove={() => handleRemoveTag(tag.id)} />
        ))}

        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[12px]">
              <Plus className="size-3" />
              Add tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0">
            <Command>
              <CommandInput
                placeholder="Search or create tag…"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const value = (event.target as HTMLInputElement).value.trim();
                    if (value) handleAddTag(value);
                  }
                }}
              />
              <CommandList>
                <CommandEmpty>Press enter to create a new tag.</CommandEmpty>
                <CommandGroup>
                  {untaggedAvailable.map((tag) => (
                    <CommandItem key={tag.id} onSelect={() => handleAddTag(tag.name)}>
                      {tag.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {customFields.map(({ definition, value }) => (
          <div key={definition.id} className="flex items-center gap-1.5 text-[12px]">
            <span className="text-muted-foreground">{definition.label}:</span>
            <CustomFieldInput
              definition={definition}
              value={value}
              onChange={(next) => handleCustomFieldChange(definition.id, next)}
            />
          </div>
        ))}
      </div>

      {/* Always mounted (it renders nothing without relations), so after the last link is
          removed it can still move focus to the actions menu trigger (review UI-WR-04). */}
      <LinkedTicketsRow
        ticketId={ticket.id}
        relations={relations}
        fallbackFocusRef={actionsTriggerRef}
      />
    </div>
  );
}
