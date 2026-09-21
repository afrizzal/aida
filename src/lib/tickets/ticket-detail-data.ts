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
import { listRelationsForTicket, type RelationChip } from "@/lib/tickets/relations";

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
  const [related, relationList, receivedMerges] = await Promise.all([
    findRelated(client, db, orgId, ticketId),
    listRelationsForTicket(client, actor, ticketId),
    db.ticket.count({ where: { mergedIntoTicketId: ticketId } }),
  ]);
  if (!relationList.ok) return { status: "membership_ended" };

  const mergeTarget = ticket.mergedIntoTicketId
    ? await db.ticket.findFirst({
        where: { id: ticket.mergedIntoTicketId },
        select: { id: true, number: true },
      })
    : null;

  return {
    status: "ok",
    ticket,
    relations: relationList.relations,
    hasReceivedMerges: receivedMerges > 0,
    mergeTarget,
    ...related,
  };
}
