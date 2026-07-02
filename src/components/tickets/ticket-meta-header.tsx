"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addTag,
  assignTicket,
  changePriority,
  changeStatus,
  removeTag,
  setCustomFieldValue,
} from "@/app/(app)/tickets/[id]/actions";
import { AssigneeAvatar } from "@/components/tickets/assignee-avatar";
import {
  CustomFieldInput,
  type CustomFieldInputDefinition,
  type CustomFieldValue as CustomFieldInputValue,
} from "@/components/tickets/custom-field-input";
import { PriorityChip } from "@/components/tickets/priority-chip";
import { SlaDueChip } from "@/components/tickets/sla-due-chip";
import { StatusChip } from "@/components/tickets/status-chip";
import { TagChip } from "@/components/tickets/tag-chip";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TicketPriority, TicketStatus } from "@/generated/prisma/client";

const STATUSES: { value: TicketStatus; label: string }[] = [
  { value: "NEW", label: "New" },
  { value: "OPEN", label: "Open" },
  { value: "PENDING", label: "Pending" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const UNASSIGNED_VALUE = "unassigned";

export interface TicketMetaHeaderTicket {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  firstResponseDueAt: Date | string;
  resolutionDueAt: Date | string;
  firstRespondedAt: Date | string | null;
  resolvedAt: Date | string | null;
  isAtRisk: boolean;
  isBreached: boolean;
}

export interface TicketMetaHeaderMember {
  id: string;
  name: string;
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
  assigneeName: string | null;
  members: TicketMetaHeaderMember[];
  tags: TicketMetaHeaderTag[];
  availableTags: TicketMetaHeaderTag[];
  customFields: TicketMetaHeaderCustomField[];
}

/** Which SLA timer is still "live" — mirrors ticket-list-row.tsx's identical helper. */
function getActiveDue(ticket: TicketMetaHeaderTicket): Date | string | null {
  if (!ticket.firstRespondedAt) return ticket.firstResponseDueAt;
  if (!ticket.resolvedAt) return ticket.resolutionDueAt;
  return null;
}

export function TicketMetaHeader({
  ticket,
  assigneeName,
  members,
  tags,
  availableTags,
  customFields,
}: TicketMetaHeaderProps) {
  const [, startTransition] = useTransition();
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const activeDue = getActiveDue(ticket);
  const untaggedAvailable = availableTags.filter((t) => !tags.some((tg) => tg.id === t.id));

  function handleStatusChange(status: TicketStatus) {
    startTransition(async () => {
      const result = await changeStatus(ticket.id, status).catch(() => null);
      if (!result?.ok) toast.error("Couldn't update status. Try again.");
    });
  }

  function handlePriorityChange(priority: TicketPriority) {
    startTransition(async () => {
      const result = await changePriority(ticket.id, priority).catch(() => null);
      if (!result?.ok) toast.error("Couldn't update priority. Try again.");
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Change status">
                <StatusChip status={ticket.status} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={ticket.status}
                onValueChange={(value) => handleStatusChange(value as TicketStatus)}
              >
                {STATUSES.map((status) => (
                  <DropdownMenuRadioItem key={status.value} value={status.value}>
                    {status.label}
                  </DropdownMenuRadioItem>
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <AssigneeAvatar name={assigneeName} />
                <span className="max-w-[120px] truncate text-[13px]">
                  {assigneeName ?? "Unassigned"}
                </span>
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
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
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-border/70 border-b px-6 py-2">
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
    </div>
  );
}
