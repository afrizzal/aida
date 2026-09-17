"use client";

import { useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRegisterCommands } from "@/components/command-provider";
import { Checkbox } from "@/components/ui/checkbox";
import type { Command, CommandContext } from "@/lib/commands/registry";
import { filtersToSearchParams, parseUrlFilters } from "@/lib/tickets/list-filters";
import { cn } from "@/lib/utils";

// Row selection for bulk actions (Phase 11, AIDA-48, D-10, UI-SPEC Surface 3a).
//
// The provider is mounted in tickets/layout.tsx, so the selection survives moving between
// /tickets and /tickets/[id] and is dropped when the user leaves /tickets (the layout unmounts).
// Only rows the agent checked are selected; there is no control that selects every row.
// The selection clears whenever the filters or the open saved view (sv) change; `limit` is page
// size, not a filter, so "Load more" keeps it. Each time the list panel reports the ids it has
// loaded, the selection is pruned to them, so it never covers a ticket that is not on screen.
//
// Keyboard (11-08, AIDA-50, UI-SPEC Surface 5b): the provider registers list.next, list.prev,
// list.toggle and list.clearSelection as hidden commands (bound to j, k, x and Esc; the palette
// never lists them). The cursor row is the loaded row whose link or checkbox holds focus. With no
// cursor, j and k start at the open ticket's row when it is loaded, otherwise at the first row.
// They move real focus to the row link (id ticket-row-{id}), so Enter opens it through the
// browser's own link activation; there is no wrap, and nothing ever triggers "Load more".

/** The most tickets one bulk action may change (D-08); the server refuses more. */
export const MAX_SELECTED_TICKETS = 100;

interface SelectionState {
  /** Canonical filter key the ids belong to. */
  key: string;
  /** Selected ticket ids in the order they were checked. */
  ids: string[];
  /** Ticket ids the list panel has loaded, in list order. */
  loadedIds: string[];
}

export interface TicketSelection {
  selectedIds: readonly string[];
  /** Ticket ids currently loaded in the list, in list order (11-08 binds the row cursor to it). */
  loadedIds: readonly string[];
  atCap: boolean;
  isSelected: (ticketId: string) => boolean;
  /** Checks or unchecks one ticket; checking does nothing at the cap. */
  toggle: (ticketId: string) => void;
  clear: () => void;
  /** Called by the list panel with the ids it rendered; prunes the selection to them. */
  reportLoaded: (ticketIds: readonly string[]) => void;
}

const TicketSelectionContext = createContext<TicketSelection | null>(null);

/** The row link of a loaded ticket (TicketListRow gives it this id). */
function rowLink(ticketId: string): HTMLElement | null {
  return document.getElementById(`ticket-row-${ticketId}`);
}

/** The index of the loaded row whose link or checkbox holds focus, or -1. */
function cursorIndex(loadedIds: readonly string[]): number {
  const active = document.activeElement;
  if (!active) return -1;
  return loadedIds.findIndex((id) => rowLink(id)?.parentElement?.contains(active) ?? false);
}

/** Moves the cursor by one loaded row (j: +1, k: -1); no wrap, nothing with no rows. */
function moveCursor(loadedIds: readonly string[], openTicketId: string | null, step: 1 | -1) {
  if (loadedIds.length === 0) return;
  const current = cursorIndex(loadedIds);
  let next: number;
  if (current === -1) {
    const open = openTicketId === null ? -1 : loadedIds.indexOf(openTicketId);
    next = open === -1 ? 0 : open;
  } else {
    next = current + step;
    if (next < 0 || next >= loadedIds.length) return;
  }
  const link = rowLink(loadedIds[next]);
  if (!link) return;
  link.focus();
  link.scrollIntoView({ block: "nearest" });
}

function onInboxRoute(context: CommandContext): boolean {
  return context.pathname === "/tickets" || context.pathname.startsWith("/tickets/");
}

/** Filters plus sv, without limit: the selection belongs to one list, not to one page size. */
function selectionKey(searchParams: URLSearchParams | null): string {
  if (!searchParams) return "";
  const filters = filtersToSearchParams(parseUrlFilters(searchParams).filters).toString();
  return `${filters}|sv=${searchParams.get("sv") ?? ""}`;
}

export function TicketSelectionProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const key = selectionKey(searchParams);
  const [state, setState] = useState<SelectionState>({ key, ids: [], loadedIds: [] });

  // A filter or sv change starts a new, empty selection (D-10). Adjusting state during render
  // (instead of in an effect) means no frame ever shows the old selection under new filters.
  if (state.key !== key) {
    setState({ key, ids: [], loadedIds: state.loadedIds });
  }

  const ids = state.key === key ? state.ids : [];

  const toggle = useCallback((ticketId: string) => {
    setState((prev) => {
      if (prev.ids.includes(ticketId)) {
        return { ...prev, ids: prev.ids.filter((id) => id !== ticketId) };
      }
      if (prev.ids.length >= MAX_SELECTED_TICKETS) return prev;
      return { ...prev, ids: [...prev.ids, ticketId] };
    });
  }, []);

  const clear = useCallback(() => {
    setState((prev) => (prev.ids.length === 0 ? prev : { ...prev, ids: [] }));
  }, []);

  const reportLoaded = useCallback((ticketIds: readonly string[]) => {
    setState((prev) => {
      const loaded = new Set(ticketIds);
      const kept = prev.ids.filter((id) => loaded.has(id));
      const sameLoaded =
        prev.loadedIds.length === ticketIds.length &&
        prev.loadedIds.every((id, index) => id === ticketIds[index]);
      if (sameLoaded && kept.length === prev.ids.length) return prev;
      return {
        ...prev,
        ids: kept.length === prev.ids.length ? prev.ids : kept,
        loadedIds: sameLoaded ? prev.loadedIds : [...ticketIds],
      };
    });
  }, []);

  // The key-bound list commands read the latest loaded ids and handlers.
  const latest = useRef({ loadedIds: state.loadedIds, toggle, clear });
  latest.current = { loadedIds: state.loadedIds, toggle, clear };

  const listCommands: Command[] = [
    {
      id: "list.next",
      label: "Move to the next ticket",
      group: "tickets",
      keywords: [],
      order: 0,
      hidden: true,
      when: onInboxRoute,
      run: (context) => moveCursor(latest.current.loadedIds, context.ticketId, 1),
    },
    {
      id: "list.prev",
      label: "Move to the previous ticket",
      group: "tickets",
      keywords: [],
      order: 1,
      hidden: true,
      when: onInboxRoute,
      run: (context) => moveCursor(latest.current.loadedIds, context.ticketId, -1),
    },
    {
      id: "list.toggle",
      label: "Select or unselect the highlighted ticket",
      group: "tickets",
      keywords: [],
      order: 2,
      hidden: true,
      when: onInboxRoute,
      run: () => {
        // Toggling respects the 100 cap (toggle does nothing when checking at the cap).
        const { loadedIds } = latest.current;
        const index = cursorIndex(loadedIds);
        if (index !== -1) latest.current.toggle(loadedIds[index]);
      },
    },
    {
      id: "list.clearSelection",
      label: "Clear selection",
      group: "tickets",
      keywords: [],
      order: 3,
      hidden: true,
      when: onInboxRoute,
      run: () => latest.current.clear(),
    },
  ];
  useRegisterCommands(listCommands, []);

  const value = useMemo<TicketSelection>(() => {
    const selected = new Set(ids);
    return {
      selectedIds: ids,
      loadedIds: state.loadedIds,
      atCap: ids.length >= MAX_SELECTED_TICKETS,
      isSelected: (ticketId) => selected.has(ticketId),
      toggle,
      clear,
      reportLoaded,
    };
  }, [ids, state.loadedIds, toggle, clear, reportLoaded]);

  return (
    <TicketSelectionContext.Provider value={value}>{children}</TicketSelectionContext.Provider>
  );
}

export function useTicketSelection(): TicketSelection {
  const context = useContext(TicketSelectionContext);
  if (!context) {
    throw new Error("useTicketSelection must be used inside TicketSelectionProvider");
  }
  return context;
}

/**
 * The inbox row container (UI-SPEC Surface 3a): the checkbox column and the row link are
 * siblings, because interactive content inside an anchor is invalid. The link must be the
 * direct child passed as `children`, so the container's focus ring (`has-[>a:focus-visible]`)
 * shows when the link has keyboard focus.
 */
export function SelectableRow({
  ticketId,
  ticketNumber,
  subject,
  isOpen,
  children,
}: {
  ticketId: string;
  ticketNumber: number;
  subject: string;
  /** The ticket shown in the reading pane. */
  isOpen: boolean;
  children: ReactNode;
}) {
  const { isSelected, toggle, atCap } = useTicketSelection();
  const checked = isSelected(ticketId);

  return (
    <div
      className={cn(
        "group/row relative flex shrink-0 border-b border-border/70 has-[>a:focus-visible]:ring-2 has-[>a:focus-visible]:ring-inset has-[>a:focus-visible]:ring-ring",
        isOpen
          ? "border-l-2 border-l-primary bg-accent"
          : checked
            ? "bg-muted"
            : "hover:bg-muted/50",
      )}
    >
      <div className="flex shrink-0 items-start pl-4 pt-3">
        <div className="flex h-5 items-center">
          <Checkbox
            checked={checked}
            disabled={!checked && atCap}
            onCheckedChange={() => toggle(ticketId)}
            aria-label={`Select ticket #${ticketNumber}: ${subject}`}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
