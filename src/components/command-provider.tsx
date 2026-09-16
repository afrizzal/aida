"use client";

// The command palette's shell state (Phase 11, AIDA-49, D-11, UI-SPEC Surface 4). Mounted once by
// the (app) layout around the sidebar, top bar and page, and renders the palette dialog once.
// The views list comes from the layout, which already read it through sidebarViewsOrEmpty
// (src/lib/saved-views/ui-state.ts), so a removed member gets empty lists, never a thrown
// MEMBERSHIP_ENDED (11-05).
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CommandPalette } from "@/components/command-palette";
import type { SidebarViews } from "@/lib/saved-views/ui-state";

interface CommandsValue {
  /** Whether the palette dialog is open. */
  open: boolean;
  setOpen(open: boolean): void;
  openPalette(): void;
  closePalette(): void;
  togglePalette(): void;
}

const CommandsContext = createContext<CommandsValue | null>(null);

export function useCommands(): CommandsValue {
  const value = useContext(CommandsContext);
  if (!value) throw new Error("useCommands must be used inside CommandProvider");
  return value;
}

interface CommandProviderProps {
  /** The viewer's own private views and the organization's shared views (AIDA-47, D-12). */
  views: SidebarViews;
  children: React.ReactNode;
}

export function CommandProvider({ views: _views, children }: CommandProviderProps) {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const togglePalette = useCallback(() => setOpen((current) => !current), []);

  const value = useMemo<CommandsValue>(
    () => ({ open, setOpen, openPalette, closePalette, togglePalette }),
    [open, openPalette, closePalette, togglePalette],
  );

  return (
    <CommandsContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </CommandsContext.Provider>
  );
}
