"use client";

// The ticket picker shared by the Link a ticket and Merge dialogs (UI-SPEC 2c). Results come from
// GET /api/tickets/picker (12-02: membership checked, the actor's organization only, at most 10
// rows, no message or contact data). The endpoint returns the same rows for both purposes; this
// component marks the ineligible rows per purpose. Disabled rows are a convenience: the server
// still refuses every rule (D-07).

import { Check, Loader2 } from "lucide-react";
import { type Ref, useEffect, useRef, useState } from "react";
import { StatusChip } from "@/components/tickets/status-chip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { TicketStatus } from "@/generated/prisma/client";
import { PICKER_REASON_MERGED } from "@/lib/tickets/lifecycle-copy";
import type { RelationLabel } from "@/lib/tickets/relation-pairs";

export type PickerPurpose = "link" | "merge";

export interface PickerRow {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  alreadyLinked: boolean;
  /** The current link from this ticket's side, null when the pair is not linked (UI-WR-06). */
  linkLabel: RelationLabel | null;
  sameContact: boolean;
  mergedSource: boolean;
}

const DEBOUNCE_MS = 300;
const NUMBER_QUERY = /^#?\d+$/;

/** Number lookup from one digit (`#12`, `12`), text search from two characters. */
export function meetsPickerMinimum(query: string): boolean {
  const q = query.trim();
  return NUMBER_QUERY.test(q) ? true : q.length >= 2;
}

/**
 * The Copywriting "Picker reason" for an ineligible row, or null when the row can be chosen. A
 * merged source can neither be linked (run decision K34: the server refuses it with
 * TICKET_UNAVAILABLE) nor merge again, so both dialogs show it as merged.
 */
export function pickerReason(row: PickerRow, purpose: PickerPurpose): string | null {
  if (row.mergedSource) return PICKER_REASON_MERGED;
  if (purpose === "link") return row.alreadyLinked ? "Already linked" : null;
  if (!row.sameContact)
    return "Different customer. Tickets of different customers can't be merged.";
  return null;
}

type SearchOutcome =
  | { query: string; kind: "results"; rows: PickerRow[] }
  | { query: string; kind: "error" }
  | { query: string; kind: "membership" };

interface TicketPickerProps {
  ticketId: string;
  purpose: PickerPurpose;
  selected: PickerRow | null;
  onSelect(row: PickerRow): void;
  disabled?: boolean;
  /** The search input, so a dialog can hand focus back to it after a refusal. */
  inputRef?: Ref<HTMLInputElement>;
  /**
   * The search text, when the dialog keeps it across a remount (the merge dialog's Back, review
   * UI-WR-07). Without it the picker keeps its own text and starts empty on every mount.
   */
  query?: string;
  onQueryChange?(query: string): void;
}

export function TicketPicker({
  ticketId,
  purpose,
  selected,
  onSelect,
  disabled,
  inputRef,
  query: controlledQuery,
  onQueryChange,
}: TicketPickerProps) {
  const [ownQuery, setOwnQuery] = useState("");
  const query = controlledQuery ?? ownQuery;
  const setQuery = onQueryChange ?? setOwnQuery;
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  // Stale-response guard: only the response for the current query is ever shown.
  const currentQuery = useRef("");
  const trimmed = query.trim();
  currentQuery.current = trimmed;

  useEffect(() => {
    if (!meetsPickerMinimum(trimmed)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const show = (next: SearchOutcome) => {
        if (!controller.signal.aborted && currentQuery.current === trimmed) setOutcome(next);
      };
      try {
        const params = new URLSearchParams({ q: trimmed, ticketId, purpose });
        const response = await fetch(`/api/tickets/picker?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as {
          results?: PickerRow[];
          error?: string;
        } | null;
        if (response.status === 403 && body?.error === "membership_ended") {
          show({ query: trimmed, kind: "membership" });
        } else if (!response.ok || !Array.isArray(body?.results)) {
          show({ query: trimmed, kind: "error" });
        } else {
          show({ query: trimmed, kind: "results", rows: body.results });
        }
      } catch {
        show({ query: trimmed, kind: "error" });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, ticketId, purpose]);

  const current = outcome && outcome.query === trimmed ? outcome : null;

  return (
    <Command shouldFilter={false} className="rounded-lg border border-border/70">
      <CommandInput
        ref={inputRef}
        autoFocus
        aria-label="Ticket"
        value={query}
        onValueChange={setQuery}
        placeholder="Search by number or subject…"
        disabled={disabled}
        className="text-[13px]"
      />
      <CommandList>
        {!meetsPickerMinimum(trimmed) ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            Type a ticket number, or at least 2 letters of the subject.
          </p>
        ) : current === null ? (
          <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Searching tickets…
          </p>
        ) : current.kind === "membership" ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            Your access to this workspace has ended. Sign out, then sign in again.
          </p>
        ) : current.kind === "error" ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            Ticket search is not available right now. Try again in a moment.
          </p>
        ) : current.rows.length === 0 ? (
          <CommandEmpty className="py-8 text-[13px] text-muted-foreground">
            No tickets match "{trimmed}".
          </CommandEmpty>
        ) : (
          <CommandGroup>
            {current.rows.map((row) => {
              const reason = pickerReason(row, purpose);
              const chosen = selected?.id === row.id;
              return (
                <CommandItem
                  key={row.id}
                  value={row.id}
                  disabled={disabled || reason !== null}
                  onSelect={() => onSelect(row)}
                  data-chosen={chosen ? "true" : undefined}
                  className={`flex items-center gap-2 text-[13px] ${chosen ? "bg-muted" : ""}`}
                >
                  {chosen && <Check className="size-4 shrink-0" />}
                  <span className="w-12 shrink-0 text-[12px] text-muted-foreground tabular-nums">
                    #{row.number}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate" title={row.subject}>
                      {row.subject}
                    </span>
                    {reason && <span className="text-[12px] text-muted-foreground">{reason}</span>}
                  </span>
                  <StatusChip status={row.status} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
