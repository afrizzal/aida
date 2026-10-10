import { CheckCircle2, Inbox } from "lucide-react";
import Link from "next/link";
import { RedirectType, redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { findConservativeMembership, isAdminRole } from "@/lib/membership";
import { getScopedDb } from "@/lib/session";
import {
  legacyRedirectSearch,
  MAX_LIST_LIMIT,
  missingStateIds,
  parseUrlFilters,
} from "@/lib/tickets/list-filters";
import { loadTicketListPanelData } from "@/lib/tickets/list-panel-data";
import { parseTicketListFilters } from "@/lib/tickets/list-query";
import { BulkActionBar } from "./bulk-action-bar";
import { FilterChipRow } from "./filter-chip-row";
import { LIST_PANEL_ID, ListPanelFocus } from "./list-panel-focus";
import { MissingStatusNotice } from "./missing-status-notice";
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
  // The actor's membership is checked before any panel data is read (D-01, Codex diff critique
  // D1): a removed member with a still-valid session gets no roster, no tickets and no tags,
  // only the "membership ended" line below.
  const {
    membershipActive,
    tickets,
    totalTicketCount,
    tagOptions,
    fieldOptions,
    memberOptions,
    savedView,
    legacyStateIds,
    stateOptions,
    defaultStateId,
  } = await loadTicketListPanelData(prisma, { userId: session.user.id, orgId }, searchParams);

  // D-09: an old bookmark with status=<ENUM,...> is answered with the canonical state= URL of the
  // active organization (replace, so the old URL leaves no history entry). The target is this
  // panel's own base path plus a query built by URLSearchParams (T-12.1-40).
  if (membershipActive) {
    const legacySearch = legacyRedirectSearch(searchParams, legacyStateIds);
    if (legacySearch !== null) redirect(`${basePath}?${legacySearch}`, RedirectType.replace);
  }
  const filters = parseTicketListFilters(searchParams);

  // 12.2 UI-SPEC 1a (D-01, D-09): the bulk bar's "Propose KB article…" is for owners and admins
  // only, and is disabled while AI is off. The actor comes from this panel's own session (it has
  // no actor prop) and its role from findConservativeMembership (K59, Codex round 2 R2D-2), read
  // only for an active member. The bar only hides or explains the entry; requestProposalAction
  // decides again on the server.
  const membership = membershipActive
    ? await findConservativeMembership(prisma, session.user.id, orgId)
    : null;
  const isAdmin = isAdminRole(membership?.role);
  const aiSetting = isAdmin
    ? await db.setting.findFirst({
        where: { organizationId: orgId, key: "aiEnabled" },
        select: { value: true },
      })
    : null;
  // On only when the setting is exactly 'true', the request's own rule (D-09).
  const aiEnabled = aiSetting?.value === "true";
  // UI-SPEC 4c (D-09): state ids in the URL that are not active states of the organization.
  const urlMissingStateIds = missingStateIds(
    parseUrlFilters(searchParams).filters,
    stateOptions.map((state) => state.id),
  );

  const listQuery = buildListQuery(searchParams);

  const limit = filters.limit ?? 50;
  // A full page means more rows may exist. Below the cap, offer "Load more"; at the cap
  // (D-03, UI-SPEC Assumption 12) show the Load-more cap line instead.
  const pageIsFull = tickets.length === limit;
  const canLoadMore = pageIsFull && limit < MAX_LIST_LIMIT;
  const reachedCap = pageIsFull && limit >= MAX_LIST_LIMIT;

  return (
    <aside
      id={LIST_PANEL_ID}
      className="flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-r border-border"
    >
      <ListPanelFocus />
      {/* A removed member gets no filter row: no search, no Save view and no New Ticket
          control (Codex diff critique round 2, E1). Only the membership-ended line shows. */}
      {membershipActive && (
        <FilterChipRow
          tags={tagOptions}
          customFieldDefinitions={fieldOptions}
          states={stateOptions}
        />
      )}
      {membershipActive && savedView?.status !== "ok" && urlMissingStateIds.length > 0 && (
        <MissingStatusNotice missingIds={urlMissingStateIds} />
      )}

      {savedView?.status === "ok" && (
        <SavedViewStrip
          view={savedView.view}
          state={savedView.state}
          missing={savedView.missing}
          tags={tagOptions}
          customFieldDefinitions={fieldOptions}
          states={stateOptions}
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

      {!membershipActive ? null : totalTicketCount === 0 ? (
        <EmptyState
          icon={Inbox}
          heading="Your inbox is empty"
          body="New tickets will appear here as customers reach out through your web form. Share your intake link to start receiving requests."
        />
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="size-4 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            {/* UI-SPEC Surface 5: the Snoozed filter has its own no-match line. */}
            {filters.snoozed === true
              ? "No snoozed tickets match these filters."
              : "Nothing here — no tickets match this view."}
          </p>
        </div>
      ) : (
        <>
          {tickets.map((ticket) => (
            <TicketListRow
              key={ticket.id}
              ticket={ticket}
              isOpen={ticket.id === selectedId}
              listQuery={listQuery}
              defaultStateId={defaultStateId}
            />
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

      <BulkActionBar
        loaded={tickets.map((ticket) => ({
          id: ticket.id,
          tagIds: ticket.tags.map(({ tag }) => tag.id),
        }))}
        members={memberOptions}
        tags={tagOptions}
        states={stateOptions}
        isAdmin={isAdmin}
        aiEnabled={aiEnabled}
      />
    </aside>
  );
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

/** The list parameters a row link keeps (D-10): the filters, the open view and the page size. */
const LIST_QUERY_KEYS = ["view", "state", "tag", "cf", "q", "snoozed", "sv", "limit"] as const;

function buildListQuery(searchParams: Record<string, string | string[] | undefined>): string {
  const source = toSearchParams(searchParams);
  const params = new URLSearchParams();
  for (const key of LIST_QUERY_KEYS) {
    for (const value of source.getAll(key)) params.append(key, value);
  }
  return params.toString();
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
