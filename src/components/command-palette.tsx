"use client";

// The command palette dialog (Phase 11, AIDA-49, D-12, UI-SPEC Surface 4b and 4d).
//
// Ticket search: hidden under 2 characters; from 2 characters a 300 ms debounce, then
// GET /api/palette/tickets?q= (membership-checked, at most 10 server-ranked rows of
// { id, number, subject, status }). A response whose query is no longer the current one is
// discarded. cmdk's own filter is off (shouldFilter false), so the server's ranking is never
// re-filtered on the client. Ticket text is rendered as React text only (T-11-35).
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusChip } from "@/components/tickets/status-chip";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import type { TicketStatus } from "@/generated/prisma/client";

export const PALETTE_SEARCH_DEBOUNCE_MS = 300;
export const PALETTE_MIN_QUERY = 2;

const KNOWN_STATUSES: ReadonlySet<string> = new Set<TicketStatus>([
  "NEW",
  "OPEN",
  "PENDING",
  "RESOLVED",
  "CLOSED",
]);

export interface PaletteTicket {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
}

type TicketSearch =
  | { query: string; status: "ok"; results: PaletteTicket[] }
  | { query: string; status: "error" };

/** Keeps only well-formed rows; anything else in the body counts as a failed search. */
function readResults(body: unknown): PaletteTicket[] | null {
  if (typeof body !== "object" || body === null) return null;
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const rows: PaletteTicket[] = [];
  for (const row of results) {
    if (
      typeof row === "object" &&
      row !== null &&
      typeof row.id === "string" &&
      typeof row.number === "number" &&
      typeof row.subject === "string" &&
      typeof row.status === "string" &&
      KNOWN_STATUSES.has(row.status)
    ) {
      rows.push({
        id: row.id,
        number: row.number,
        subject: row.subject,
        status: row.status as TicketStatus,
      });
    }
  }
  return rows;
}

/** Debounced, stale-safe ticket search for the current palette query. */
function useTicketSearch(query: string): TicketSearch | null {
  const [search, setSearch] = useState<TicketSearch | null>(null);
  const latestQuery = useRef(query);
  latestQuery.current = query;

  useEffect(() => {
    if (query.length < PALETTE_MIN_QUERY) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      let next: TicketSearch;
      try {
        const response = await fetch(`/api/palette/tickets?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const results = response.ok ? readResults(await response.json()) : null;
        next = results ? { query, status: "ok", results } : { query, status: "error" };
      } catch {
        if (controller.signal.aborted) return;
        next = { query, status: "error" };
      }
      // A response for an older query is discarded (D-12).
      if (latestQuery.current !== query) return;
      setSearch(next);
    }, PALETTE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  // Only a response for exactly this query counts; until then the group shows "Searching".
  return search && search.query === query ? search : null;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const query = input.trim();
  const ticketSearch = useTicketSearch(query);
  const showTickets = query.length >= PALETTE_MIN_QUERY;

  function handleOpenChange(next: boolean) {
    if (!next) setInput("");
    onOpenChange(next);
  }

  /** The palette closes before anything runs, so a dialog opened by a command never stacks. */
  function choose(run: () => void) {
    handleOpenChange(false);
    run();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command palette"
      description="Search tickets, open a view, go to a page, or run a command."
      className="sm:max-w-[560px]"
    >
      <Command shouldFilter={false} className="p-0" data-command-palette="">
        <CommandInput
          value={input}
          onValueChange={setInput}
          placeholder="Search tickets or type a command…"
          className="text-[15px]"
        />
        <CommandList>
          {showTickets && (
            <CommandGroup heading="Tickets" className="**:[[cmdk-group-heading]]:text-[12px]">
              {ticketSearch === null ? (
                <div className="flex items-center gap-2 px-2 py-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Searching tickets…
                </div>
              ) : ticketSearch.status === "error" ? (
                <div role="alert" className="px-2 py-2 text-[13px] text-muted-foreground">
                  Ticket search is not available right now. Try again in a moment.
                </div>
              ) : ticketSearch.results.length === 0 ? (
                <div className="px-2 py-2 text-[13px] text-muted-foreground">
                  No tickets match "{query}".
                </div>
              ) : (
                ticketSearch.results.map((ticket) => (
                  <CommandItem
                    key={ticket.id}
                    value={ticket.id}
                    className="text-[13px]"
                    onSelect={() => choose(() => router.push(`/tickets/${ticket.id}`))}
                  >
                    <span className="w-12 shrink-0 text-[12px] text-muted-foreground tabular-nums">
                      #{ticket.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{ticket.subject}</span>
                    <CommandShortcut className="shrink-0 tracking-normal">
                      <StatusChip status={ticket.status} />
                    </CommandShortcut>
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          )}
        </CommandList>
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2 text-[12px] text-muted-foreground">
          <span>↑ ↓ to move, Enter to run, Esc to close</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
