"use client";

import { useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
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
