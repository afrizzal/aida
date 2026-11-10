"use client";

import type { ReactNode } from "react";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { MentionCandidate } from "@/lib/mentions/composer-tokens";

interface MentionAutocompleteProps {
  open: boolean;
  options: readonly MentionCandidate[];
  onPick: (candidate: MentionCandidate) => void;
  /** The composer wrapper the popover is anchored to. */
  children: ReactNode;
}

/**
 * The member picker of the internal-note composer (Phase 10, AIDA-45, UI-SPEC Surface 4). The
 * composer owns the query, the options and when it opens; focus stays in the textarea.
 */
export function MentionAutocomplete({ open, options, onPick, children }: MentionAutocompleteProps) {
  return (
    <Popover open={open}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[280px] p-0 text-[13px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-[288px]">
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={option.id}
                onSelect={() => onPick(option)}
                className="text-[13px]"
              >
                {option.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
