"use client";

import { Filter, SlidersHorizontal, Tag as TagIcon, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CustomFieldType, TicketStatus } from "@/generated/prisma/client";
import { parseCfParam, serializeCfParam } from "@/lib/tickets/cf-param";
import { cn } from "@/lib/utils";
import { TicketSearchInput } from "./ticket-search-input";

const VIEWS = [
  { value: "unassigned", label: "Unassigned" },
  { value: "mine", label: "Mine" },
  { value: "all", label: "All" },
] as const;

const STATUSES: { value: TicketStatus; label: string }[] = [
  { value: "NEW", label: "New" },
  { value: "OPEN", label: "Open" },
  { value: "PENDING", label: "Pending" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

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
}

export function FilterChipRow({ tags, customFieldDefinitions }: FilterChipRowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const view = searchParams.get("view") ?? "all";
  const activeStatuses = (searchParams.get("status")?.split(",").filter(Boolean) ??
    []) as TicketStatus[];
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

  function toggleStatus(status: TicketStatus, checked: boolean) {
    const next = checked ? [...activeStatuses, status] : activeStatuses.filter((s) => s !== status);
    updateParams({ status: next.length > 0 ? next.join(",") : null });
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
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto w-full max-w-[180px]">
          <TicketSearchInput />
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-border/70 px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(activeStatuses.length > 0 && "border-primary/40 text-primary")}
            >
              <Filter className="size-3.5" />
              Status
              {activeStatuses.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[12px]">
                  {activeStatuses.length}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48">
            {STATUSES.map((status) => (
              <DropdownMenuCheckboxItem
                key={status.value}
                checked={activeStatuses.includes(status.value)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => toggleStatus(status.value, checked === true)}
              >
                {status.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(activeTagId && "border-primary/40 text-primary")}
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
              className={cn(activeCfDefinition && "border-primary/40 text-primary")}
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
      </div>
    </div>
  );
}
