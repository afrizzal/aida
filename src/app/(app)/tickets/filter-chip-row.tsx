"use client";

import {
  AlarmClock,
  BookmarkPlus,
  Filter,
  SlidersHorizontal,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useRegisterCommands } from "@/components/command-provider";
import { StateDot } from "@/components/tickets/state-dot";
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { CustomFieldType } from "@/generated/prisma/client";
import { parseCfParam, serializeCfParam } from "@/lib/tickets/cf-param";
import { hasAnyFilter, missingStateIds, parseUrlFilters } from "@/lib/tickets/list-filters";
import {
  GROUP_LABELS,
  MISSING_GROUP_LABEL,
  MISSING_STATUS_ITEM,
  STATE_GROUP_KEYS,
} from "@/lib/tickets/state-copy";
import { cn } from "@/lib/utils";
import { NewTicketDialog } from "./new-ticket-dialog";
import { SaveViewDialog } from "./save-view-dialog";
import { TicketSearchInput } from "./ticket-search-input";

const VIEWS = [
  { value: "unassigned", label: "Unassigned" },
  { value: "mine", label: "Mine" },
  { value: "all", label: "All" },
] as const;

/** The Status filter trigger's id: the missing-status notice moves focus here (UI-SPEC 4c). */
export const STATUS_FILTER_TRIGGER_ID = "inbox-status-filter-trigger";

/** One active state of the organization, as the Status filter lists it (UI-SPEC 4a). */
export interface FilterChipRowState {
  id: string;
  name: string;
  colorToken: string;
  group: string;
}

export interface FilterChipRowTag {
  id: string;
  name: string;
}

export interface FilterChipRowCustomField {
  id: string;
  label: string;
  type: CustomFieldType;
}

interface FilterChipRowProps {
  tags: FilterChipRowTag[];
  customFieldDefinitions: FilterChipRowCustomField[];
  /** The organization's active states in group, then sort order. */
  states: FilterChipRowState[];
}

export function FilterChipRow({ tags, customFieldDefinitions, states }: FilterChipRowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const view = searchParams.get("view") ?? "all";
  const activeTagId = searchParams.get("tag");
  const cfParam = searchParams.get("cf");
  const activeCf = cfParam ? parseCfParam(cfParam) : null;
  const activeCfDefinition = activeCf
    ? customFieldDefinitions.find((def) => def.id === activeCf.definitionId)
    : undefined;

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [cfMenuOpen, setCfMenuOpen] = useState(false);
  const [cfDraftDefinitionId, setCfDraftDefinitionId] = useState<string | null>(null);
  const [cfDraftValue, setCfDraftValue] = useState("");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  // Save view (AIDA-47, UI-SPEC Surface 2a): only when at least one filter is on screen.
  const urlFilters = parseUrlFilters(searchParams).filters;
  // D-09: state ids from the one grammar (a present but malformed state= fails closed there).
  const activeStateIds = urlFilters.stateIds;
  const missingIds = missingStateIds(
    urlFilters,
    states.map((state) => state.id),
  );
  const stateGroups = STATE_GROUP_KEYS.map((group) => ({
    group,
    items: states.filter((state) => state.group === group),
  })).filter((entry) => entry.items.length > 0);
  const canSaveView = hasAnyFilter(urlFilters);
  // UI-SPEC Surface 5 (D-16): on shows only snoozed tickets (snoozed=1); off is the default.
  const snoozedOn = urlFilters.snoozed === true;

  // The palette's "Save these filters as a view…" (AIDA-49, D-12, UI-SPEC 4c): listed only while
  // this row is mounted (the two inbox routes) and only when Save view is enabled; it opens the
  // same dialog in create mode, after the palette has closed.
  useRegisterCommands(
    [
      {
        id: "views.save",
        label: "Save these filters as a view…",
        group: "views",
        keywords: ["save view", "bookmark"],
        order: -1,
        icon: "bookmark-plus",
        when: (context) => hasAnyFilter(parseUrlFilters(context.searchParams).filters),
        run: () => setSaveViewOpen(true),
      },
    ],
    [],
  );

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function selectView(next: (typeof VIEWS)[number]["value"]) {
    updateParams({ view: next === "all" ? null : next });
  }

  function toggleState(stateId: string, checked: boolean) {
    const next = checked
      ? [...new Set([...activeStateIds, stateId])]
      : activeStateIds.filter((id) => id !== stateId);
    // The URL contract (D-09): state=<ids sorted in code-unit order>; no parameter when empty.
    updateParams({ state: next.length > 0 ? [...next].sort().join(",") : null });
  }

  function selectTag(tagId: string) {
    updateParams({ tag: activeTagId === tagId ? null : tagId });
    setTagPopoverOpen(false);
  }

  function openCfMenu(open: boolean) {
    setCfMenuOpen(open);
    if (open) {
      setCfDraftDefinitionId(activeCf?.definitionId ?? null);
      setCfDraftValue(activeCf?.value ?? "");
    }
  }

  function applyCfFilter() {
    if (cfDraftDefinitionId && cfDraftValue.trim()) {
      updateParams({ cf: serializeCfParam(cfDraftDefinitionId, cfDraftValue.trim()) });
    }
    setCfMenuOpen(false);
  }

  function clearCfFilter() {
    updateParams({ cf: null });
    setCfMenuOpen(false);
  }

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => selectView(v.value)}
              className={cn(
                "h-8 rounded-full px-3 text-[13px] font-medium",
                view === v.value
                  ? "bg-primary/10 text-primary-emphasis"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <NewTicketDialog />
          <div className="w-full max-w-[180px]">
            <TicketSearchInput />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 gap-y-2 border-t border-border/70 px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={STATUS_FILTER_TRIGGER_ID}
              variant="outline"
              size="sm"
              className={cn(activeStateIds.length > 0 && "border-primary/40 text-primary-emphasis")}
            >
              <Filter className="size-3.5" />
              Status
              {/* UI-SPEC 4a: the badge counts every id in the filter, missing ones included. */}
              {activeStateIds.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[12px]">
                  {activeStateIds.length}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[240px] max-h-[320px] overflow-y-auto">
            {stateGroups.map(({ group, items }, index) => (
              <div key={group}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[12px] font-semibold text-muted-foreground">
                  {GROUP_LABELS[group]}
                </DropdownMenuLabel>
                {items.map((state) => (
                  <DropdownMenuCheckboxItem
                    key={state.id}
                    className="text-[13px]"
                    title={state.name}
                    checked={activeStateIds.includes(state.id)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) => toggleState(state.id, checked === true)}
                  >
                    <StateDot colorToken={state.colorToken} />
                    <span className="min-w-0 truncate">{state.name}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </div>
            ))}
            {/* UI-SPEC 4a: a missing id is shown checked and can be removed on its own (D-09). */}
            {missingIds.length > 0 && (
              <>
                {stateGroups.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[12px] font-semibold text-muted-foreground">
                  {MISSING_GROUP_LABEL}
                </DropdownMenuLabel>
                {missingIds.map((id) => (
                  <DropdownMenuCheckboxItem
                    key={id}
                    className="text-[13px]"
                    checked
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) => {
                      if (checked !== true) toggleState(id, false);
                    }}
                  >
                    {MISSING_STATUS_ITEM}
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(activeTagId && "border-primary/40 text-primary-emphasis")}
            >
              <TagIcon className="size-3.5" />
              {tags.find((t) => t.id === activeTagId)?.name ?? "Tag"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0">
            <Command>
              <CommandInput placeholder="Search tags…" />
              <CommandList>
                <CommandEmpty>No tags found.</CommandEmpty>
                <CommandGroup>
                  {activeTagId && (
                    <CommandItem onSelect={() => selectTag(activeTagId)}>
                      <X className="size-3.5" />
                      Clear tag filter
                    </CommandItem>
                  )}
                  {tags.map((tag) => (
                    <CommandItem
                      key={tag.id}
                      data-checked={tag.id === activeTagId}
                      onSelect={() => selectTag(tag.id)}
                    >
                      {tag.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <DropdownMenu open={cfMenuOpen} onOpenChange={openCfMenu}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(activeCfDefinition && "border-primary/40 text-primary-emphasis")}
            >
              <SlidersHorizontal className="size-3.5" />
              {activeCfDefinition ? activeCfDefinition.label : "Custom field"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64 space-y-2 p-2">
            <DropdownMenuLabel className="px-0">Filter by custom field</DropdownMenuLabel>
            {customFieldDefinitions.length === 0 ? (
              <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
                No custom fields configured yet.
              </p>
            ) : (
              <DropdownMenuRadioGroup
                value={cfDraftDefinitionId ?? ""}
                onValueChange={setCfDraftDefinitionId}
              >
                {customFieldDefinitions.map((def) => (
                  <DropdownMenuRadioItem
                    key={def.id}
                    value={def.id}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {def.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            )}
            {cfDraftDefinitionId && (
              <Input
                autoFocus
                placeholder="Value…"
                value={cfDraftValue}
                onChange={(e) => setCfDraftValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyCfFilter();
                }}
              />
            )}
            <div className="flex justify-end gap-1.5 pt-1">
              {activeCfDefinition && (
                <Button variant="ghost" size="sm" onClick={clearCfFilter}>
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                disabled={!cfDraftDefinitionId || !cfDraftValue.trim()}
                onClick={applyCfFilter}
              >
                Apply
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          aria-pressed={snoozedOn}
          className={cn("text-[13px]", snoozedOn && "border-primary/40 text-primary-emphasis")}
          onClick={() => updateParams({ snoozed: snoozedOn ? null : "1" })}
        >
          <AlarmClock className="size-3.5" />
          Snoozed
        </Button>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button gets no pointer events, so the wrapper carries the tooltip
                  and is focusable only while the button is disabled. */}
              <span className="ml-auto inline-flex" tabIndex={canSaveView ? undefined : 0}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Save these filters as a view"
                  disabled={!canSaveView}
                  onClick={() => setSaveViewOpen(true)}
                >
                  <BookmarkPlus className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-[12px]">
              {canSaveView ? "Save view" : "Set at least one filter to save a view."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <SaveViewDialog
        mode="create"
        open={saveViewOpen}
        onOpenChange={setSaveViewOpen}
        tags={tags}
        customFieldDefinitions={customFieldDefinitions}
        states={states}
      />
    </div>
  );
}
