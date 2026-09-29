// The data the ticket page (`tickets/[id]/page.tsx`) renders. Kept out of the server component
// so a test can run it against a real Postgres.
//
// Codex diff critique round 2, E1 (run-loop K31): the page sends the ticket, its messages and the
// organization's member roster (names) to the browser, and Phase 11's palette routes agents to
// it. The actor's member row is checked with findActiveMembership (D-01) BEFORE anything is
// read. A removed member whose session still carries the organization gets the defined
// "membership_ended" state and no ticket, message, tag, field or roster data; nothing throws, so
// the page never reaches an error boundary (Phase 10 review C6).
import type { PrismaClient } from "@/generated/prisma/client";
import { findActiveMembership } from "@/lib/membership";
import { scopedDb } from "@/lib/scoped-db";
import { buildActivityFeed, type FeedItem, referencedIds } from "@/lib/tickets/activity-feed";
import { listRelationsForTicket, type RelationChip } from "@/lib/tickets/relations";
import { type ActiveStateRow, listActiveStates } from "@/lib/tickets/ticket-states";

export interface TicketDetailActor {
  userId: string;
  orgId: string;
}

function findTicket(db: ReturnType<typeof scopedDb>, ticketId: string) {
  return db.ticket.findFirst({
    where: { id: ticketId },
    include: {
      contact: true,
      assignee: true,
      // Phase 12.1 (D-11, UI-SPEC Surface 2): the chip shows the state's name and colour, and the
      // snooze control decides by its group. slaPausedAt is a scalar and comes with the row.
      state: { select: { id: true, name: true, colorToken: true, group: true } },
      tags: { include: { tag: true } },
      messages: {
        include: { authorUser: true, authorContact: true, attachments: true },
        orderBy: { createdAt: "asc" },
      },
      customFieldValues: { include: { definition: true } },
    },
  });
}

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof findTicket>>>;

async function findRelated(
  client: PrismaClient,
  db: ReturnType<typeof scopedDb>,
  orgId: string,
  ticketId: string,
) {
  // Better Auth's `member` model is excluded from scopedDb's DOMAIN_MODELS allowlist: the global
  // client with an explicit organizationId filter, same idiom as src/lib/authz.ts.
  const [members, definitions, availableTags, auditEvents, draftableKbCount] = await Promise.all([
    client.member.findMany({ where: { organizationId: orgId }, include: { user: true } }),
    db.customFieldDefinition.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: { name: "asc" } }),
    db.auditEvent.findMany({ where: { ticketId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.kbArticle.count({ where: { embeddingStatus: "COMPLETED" } }),
  ]);
  return { members, definitions, availableTags, auditEvents, draftableKbCount };
}

/** One audit row as the feed reads it: ids, enum values and timestamps only (D-21). */
export interface FeedAuditEvent {
  id: string;
  createdAt: Date;
  action: string;
  actorType: "USER" | "SYSTEM";
  actorUserId: string | null;
  batchId: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Names and numbers the feed may show, each resolved inside the ticket's organization (D-18):
 * tickets and tags through scopedDb, users only among the organization's current members. An id
 * missing here renders as its marker ("a ticket that is no longer available", "a deleted tag",
 * "A former member").
 */
export interface FeedReferences {
  tickets: Record<string, { id: string; number: number }>;
  tags: Record<string, string>;
  members: Record<string, string>;
  /**
   * States named by STATUS_CHANGED rows (Phase 12.1, K42), soft-deleted ones included and
   * flagged; an id that is not a state of this organization is absent ("a deleted status").
   */
  states: Record<string, { name: string; deleted: boolean }>;
}

function asSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type TicketDetailData =
  | { status: "membership_ended" }
  | { status: "not_found" }
  | ({
      status: "ok";
      ticket: TicketDetail;
      /** The ticket's relations from its own side, sorted for the chip row (12-06, D-04). */
      relations: RelationChip[];
      /** True when at least one other ticket was merged into this one (D-07). */
      hasReceivedMerges: boolean;
      /** The merge target of a merged source, resolved through scopedDb; null when unreadable or not merged (UI-SPEC 3b). */
      mergeTarget: { id: string; number: number } | null;
      /** Source ticket number per mergedFromTicketId on this ticket's messages (UI-SPEC 3d); an unreadable source is absent. */
      movedFromSources: Record<string, { id: string; number: number }>;
      /** Messages and TicketAuditEvent rows in one stable order (D-18, AIDA-55). */
      feed: FeedItem<TicketDetail["messages"][number], FeedAuditEvent>[];
      feedReferences: FeedReferences;
      /** The organization's active states for the top-bar picker, in group then sort order (UI-SPEC 3a). */
      stateOptions: ActiveStateRow[];
    } & Awaited<ReturnType<typeof findRelated>>);

export async function loadTicketDetailData(
  client: PrismaClient,
  actor: TicketDetailActor,
  ticketId: string,
): Promise<TicketDetailData> {
  const { userId, orgId } = actor;

  // D-01: no read of ticket data before the member row is confirmed.
  if (!(await findActiveMembership(client, userId, orgId))) {
    return { status: "membership_ended" };
  }

  const db = scopedDb(orgId);
  const ticket = await findTicket(db, ticketId);
  if (!ticket) return { status: "not_found" };

  // Relations go through the 12-02 service, which checks membership again and resolves the
  // other tickets through scopedDb; an unreadable other ticket is left out (UI-SPEC 2a).
  // The picker's states are read in the actor's organization after the membership check
  // (D-01); soft-deleted states are never offered (K42).
  const [related, relationList, receivedMerges, stateOptions] = await Promise.all([
    findRelated(client, db, orgId, ticketId),
    listRelationsForTicket(client, actor, ticketId),
    db.ticket.count({ where: { mergedIntoTicketId: ticketId } }),
    listActiveStates(client, orgId),
  ]);
  if (!relationList.ok) return { status: "membership_ended" };

  const mergeTarget = ticket.mergedIntoTicketId
    ? await db.ticket.findFirst({
        where: { id: ticket.mergedIntoTicketId },
        select: { id: true, number: true },
      })
    : null;

  const sourceIds = [
    ...new Set(
      ticket.messages
        .map((message) => message.mergedFromTicketId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const sources =
    sourceIds.length > 0
      ? await db.ticket.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, number: true },
        })
      : [];
  const movedFromSources = Object.fromEntries(sources.map((source) => [source.id, source]));

  // D-18: the feed's audit rows are read through scopedDb after the membership check, so
  // another organization's rows never appear, even with the same ticketId.
  const auditRows = await db.ticketAuditEvent.findMany({
    where: { ticketId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const events: FeedAuditEvent[] = auditRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    action: row.action,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    batchId: row.batchId,
    before: asSnapshot(row.before),
    after: asSnapshot(row.after),
  }));
  const refs = referencedIds(events);
  const [refTickets, refTags, refStates] = await Promise.all([
    refs.ticketIds.length > 0
      ? db.ticket.findMany({
          where: { id: { in: refs.ticketIds } },
          select: { id: true, number: true },
        })
      : Promise.resolve([]),
    refs.tagIds.length > 0
      ? db.tag.findMany({ where: { id: { in: refs.tagIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    // Through scopedDb, so a state id of another organization never resolves (T-12.1-47); no
    // deletedAt filter, so a soft-deleted state keeps its name for the marker (K42).
    refs.stateIds.length > 0
      ? db.ticketState.findMany({
          where: { id: { in: refs.stateIds } },
          select: { id: true, name: true, deletedAt: true },
        })
      : Promise.resolve([]),
  ]);
  // Users are named only when they are members of this organization now (D-18); the roster
  // came from the organization-filtered member query above.
  const wantedUsers = new Set<string>(refs.userIds);
  for (const event of events) if (event.actorUserId) wantedUsers.add(event.actorUserId);
  const members: Record<string, string> = {};
  for (const member of related.members) {
    if (wantedUsers.has(member.user.id)) members[member.user.id] = member.user.name;
  }
  const feedReferences: FeedReferences = {
    tickets: Object.fromEntries(refTickets.map((t) => [t.id, { id: t.id, number: t.number }])),
    tags: Object.fromEntries(refTags.map((t) => [t.id, t.name])),
    members,
    states: Object.fromEntries(
      refStates.map((s) => [s.id, { name: s.name, deleted: s.deletedAt !== null }]),
    ),
  };

  return {
    status: "ok",
    ticket,
    movedFromSources,
    feed: buildActivityFeed(ticket.messages, events),
    feedReferences,
    relations: relationList.relations,
    hasReceivedMerges: receivedMerges > 0,
    mergeTarget,
    stateOptions,
    ...related,
  };
}
