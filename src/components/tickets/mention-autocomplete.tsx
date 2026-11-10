"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { type MentionCandidate, mentionOptionLabel } from "@/lib/mentions/composer-tokens";

/** The ids the textarea's combobox attributes point at. */
export interface MentionAria {
  listId: string | null;
  activeId: string | null;
}

interface MentionAutocompleteProps {
  open: boolean;
  /** The member list is still loading: the popover shows one Skeleton row. */
  loading: boolean;
  /** The text typed after "@", for the no-match row. */
  query: string;
  /** The members matching the query, already filtered by the composer. */
  options: readonly MentionCandidate[];
  /** The highlighted member's id. */
  activeId: string | null;
  onActiveChange: (id: string) => void;
  onPick: (candidate: MentionCandidate) => void;
  /** An outside click or Escape closed the popover; the typed text stays. */
  onDismiss: () => void;
  /** Reports the list id and the highlighted option's DOM id for aria-controls and
   * aria-activedescendant on the textarea. */
  onAriaChange: (aria: MentionAria) => void;
  /** The class of the wrapper the popover is anchored to (it holds the textarea). */
  anchorClassName?: string;
  children: ReactNode;
}

function initials(label: string): string {
  const source = label.includes("@") ? (label.split("@")[0] ?? "") : label;
  const parts = source.split(label.includes("@") ? /[\s._+-]+/ : /\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();
  return letters === "" ? "?" : letters;
}

/**
 * The member picker of the internal-note composer (Phase 10, AIDA-45, UI-SPEC Surface 4): a
 * Popover anchored to the composer wrapper with a Command list of current members (avatar, name,
 * email). The composer owns the query, the filtering, the highlighted option and every key: focus
 * stays in the textarea, which carries role combobox, aria-expanded, aria-controls and
 * aria-activedescendant (reported through onAriaChange). Pointer selection works too: a mouse down
 * inside the popover keeps the textarea focused.
 */
export function MentionAutocomplete({
  open,
  loading,
  query,
  options,
  activeId,
  onActiveChange,
  onPick,
  onDismiss,
  onAriaChange,
  anchorClassName,
  children,
}: MentionAutocompleteProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // cmdk gives the list and each option their DOM ids; read them after render, find the
  // highlighted option by its value (cmdk writes data-value in its own layout effect, which runs
  // before this one), keep it scrolled into view and report both ids to the textarea.
  useLayoutEffect(() => {
    const list = open && !loading ? listRef.current : null;
    let active: HTMLElement | null = null;
    if (list && activeId !== null) {
      for (const item of list.querySelectorAll<HTMLElement>("[cmdk-item]")) {
        if (item.getAttribute("data-value") === activeId) active = item;
      }
    }
    active?.scrollIntoView({ block: "nearest" });
    onAriaChange({ listId: list?.id || null, activeId: active?.id || null });
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={anchorClassName}>
          {children}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[280px] gap-0 p-0 text-[13px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // A click in the textarea moves the caret; it does not close the list.
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        {loading ? (
          <div className="py-1">
            <Skeleton className="mx-2 my-2 h-8" />
            <span className="sr-only">Loading members…</span>
          </div>
        ) : (
          <Command
            shouldFilter={false}
            value={activeId ?? ""}
            onValueChange={(value) => {
              if (value !== "") onActiveChange(value);
            }}
          >
            <CommandList ref={listRef} label="Members" className="max-h-[288px]">
              <CommandEmpty className="px-2 py-6 text-[13px] text-muted-foreground">
                {`No member matches "${query}".`}
              </CommandEmpty>
              {options.map((option) => {
                const label = mentionOptionLabel(option);
                return (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    onSelect={() => onPick(option)}
                    className="gap-2 py-0.5 text-[13px] data-selected:bg-accent data-selected:text-accent-foreground"
                  >
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-primary/10 text-[12px] text-primary-emphasis">
                        {initials(label)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] leading-[16px] font-semibold text-foreground">
                        {label}
                      </p>
                      <p className="truncate text-[12px] leading-[16px] text-muted-foreground">
                        {option.email}
                      </p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
