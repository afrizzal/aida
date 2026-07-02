import { CheckCircle2, Inbox } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { getScopedDb } from "@/lib/session";
import { fetchTicketList, parseTicketListFilters } from "@/lib/tickets/list-query";
import { FilterChipRow } from "./filter-chip-row";
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

  const limit = filters.limit ?? 50;
  const canLoadMore = tickets.length === limit;

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-r border-border">
      <FilterChipRow
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        customFieldDefinitions={customFieldDefinitions.map((def) => ({
          id: def.id,
          label: def.label,
          type: def.type,
        }))}
      />

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
        </>
      )}
    </aside>
  );
}

function buildLoadMoreHref(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
  limit: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.set(key, value);
    }
  }
  params.set("limit", String(limit + LOAD_MORE_STEP));
  return `${basePath}?${params.toString()}`;
}
