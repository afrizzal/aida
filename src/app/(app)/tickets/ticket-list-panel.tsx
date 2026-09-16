import { CheckCircle2, Inbox } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { getSavedViewForPanel } from "@/lib/saved-views/service";
import { panelOrMembershipEnded, type SavedViewPanelState } from "@/lib/saved-views/ui-state";
import { getScopedDb } from "@/lib/session";
import { MAX_LIST_LIMIT, parseUrlFilters } from "@/lib/tickets/list-filters";
import { fetchTicketList, parseTicketListFilters } from "@/lib/tickets/list-query";
import { FilterChipRow } from "./filter-chip-row";
import { SavedViewStrip } from "./saved-view-strip";
import { TicketListRow } from "./ticket-list-row";

const LOAD_MORE_STEP = 50;

export interface TicketListPanelProps {
  searchParams: Record<string, string | string[] | undefined>;
  selectedId?: string;
  /** Base path the "Load more" link paginates against — `/tickets` by default. Plan 09's
   * `/tickets/[id]` route reuses this same panel and passes its own path so pagination
   * doesn't navigate away from the open ticket. */
  basePath?: string;
}

export async function TicketListPanel({
  searchParams,
  selectedId,
  basePath = "/tickets",
}: TicketListPanelProps) {
  const { db, orgId, session } = await getScopedDb();
  const filters = parseTicketListFilters(searchParams);

  const [tickets, totalTicketCount, tags, customFieldDefinitions] = await Promise.all([
    fetchTicketList(filters, { db, orgId, userId: session.user.id }),
    db.ticket.count(),
    db.tag.findMany({ orderBy: { name: "asc" } }),
    db.customFieldDefinition.findMany({ orderBy: { position: "asc" } }),
  ]);

  // Saved view in the URL (AIDA-47, UI-SPEC Surface 2b): the service decides the strip state and
  // whether the viewer may edit. The list below always runs with the URL filters, so a broken
  // reference is never dropped (D-05). A removed member gets a defined line, not an error page.
  const svId = firstParam(searchParams.sv);
  const savedView: SavedViewPanelState | null = svId
    ? await panelOrMembershipEnded(() =>
        getSavedViewForPanel(
          prisma,
          { userId: session.user.id, orgId },
          svId,
          parseUrlFilters(searchParams).filters,
        ),
      )
    : null;
  const tagOptions = tags.map((tag) => ({ id: tag.id, name: tag.name }));
  const fieldOptions = customFieldDefinitions.map((def) => ({
    id: def.id,
    label: def.label,
    type: def.type,
  }));

  const limit = filters.limit ?? 50;
  // A full page means more rows may exist. Below the cap, offer "Load more"; at the cap
  // (D-03, UI-SPEC Assumption 12) show the Load-more cap line instead.
  const pageIsFull = tickets.length === limit;
  const canLoadMore = pageIsFull && limit < MAX_LIST_LIMIT;
  const reachedCap = pageIsFull && limit >= MAX_LIST_LIMIT;

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-r border-border">
      <FilterChipRow tags={tagOptions} customFieldDefinitions={fieldOptions} />

      {savedView?.status === "ok" && (
        <SavedViewStrip
          view={savedView.view}
          state={savedView.state}
          missing={savedView.missing}
          tags={tagOptions}
          customFieldDefinitions={fieldOptions}
        />
      )}
      {(savedView?.status === "not_available" || savedView?.status === "membership_ended") && (
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2">
          <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
            {savedView.status === "not_available"
              ? "This view was deleted or is not shared with you."
              : "Your access to this workspace has ended. Sign out, then sign in again."}
          </p>
          <Button variant="ghost" size="sm" className="text-[13px]" asChild>
            <Link href={buildClearViewHref(basePath, searchParams)}>Clear</Link>
          </Button>
        </div>
      )}

      {totalTicketCount === 0 ? (
        <EmptyState
          icon={Inbox}
          heading="Your inbox is empty"
          body="New tickets will appear here as customers reach out through your web form. Share your intake link to start receiving requests."
        />
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="size-4 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            Nothing here — no tickets match this view.
          </p>
        </div>
      ) : (
        <>
          {tickets.map((ticket) => (
            <TicketListRow key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} />
          ))}
          {canLoadMore && (
            <div className="flex justify-center py-4">
              <Button variant="outline" asChild>
                <Link href={buildLoadMoreHref(basePath, searchParams, limit)}>Load more</Link>
              </Button>
            </div>
          )}
          {reachedCap && (
            <p className="py-4 text-center text-[12px] text-muted-foreground">
              Showing the first {MAX_LIST_LIMIT} tickets. Narrow the filters to see others.
            </p>
          )}
        </>
      )}
    </aside>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.set(key, value);
    }
  }
  return params;
}

/** The same URL without sv: the filters stay as plain filters (UI-SPEC Surface 2b). */
function buildClearViewHref(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = toSearchParams(searchParams);
  params.delete("sv");
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function buildLoadMoreHref(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
  limit: number,
): string {
  const params = toSearchParams(searchParams);
  params.set("limit", String(Math.min(limit + LOAD_MORE_STEP, MAX_LIST_LIMIT)));
  return `${basePath}?${params.toString()}`;
}
