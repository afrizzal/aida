// The single access boundary of the Notification table (Phase 10, AIDA-44, D-15, C10). Every
// read and write of notifications in src goes through a function here that takes the
// organization and the recipient explicitly:
//
// - Reads and updates outside a caller's transaction use scopedDb(orgId) and always filter
//   recipientUserId as well, because scopedDb adds only the organization.
// - Functions that run inside a caller's transaction (insert, digest claim, digest read and stamp)
//   receive a plain interactive transaction client, which may be unscoped (the worker), so they
//   write the organization term explicitly next to the recipient term.
// - listDigestPairs is the single named exception (see its comment).
// - The insert is createMany with skipDuplicates, which PostgreSQL runs as ON CONFLICT DO NOTHING
//   on the (organizationId, recipientUserId, type, eventKey) unique key: a duplicate is skipped
//   without aborting the caller's transaction (a caught P2002 would). scopedDb does not inject the
//   organization into createMany, so organizationId is written from the parameter on every row,
//   never from the item.
//
// Relative imports only and no framework import: the worker bundles this module.
import { scopedDb } from "../scoped-db";
import {
  isNotificationType,
  type NotificationItem,
  type NotificationTypeName,
  TICKET_ENTITY,
} from "./types";

/** One row as insertNotifications writes it. */
export interface NotificationRowData {
  organizationId: string;
  recipientUserId: string;
  actorUserId: string | null;
  type: NotificationTypeName;
  eventKey: string;
  entityType: string;
  entityId: string;
  unassignedFallback: boolean;
}

/**
 * The transaction client insertNotifications needs. Typed structurally (the TicketAuditTx shape of
 * tickets/ticket-audit.ts) so the global prisma client, a scopedDb client and either one's
 * interactive transaction client all fit. organizationId is always written explicitly.
 */
export interface NotificationInsertTx {
  notification: {
    createMany(args: {
      data: NotificationRowData[];
      skipDuplicates: boolean;
    }): PromiseLike<{ count: number }>;
  };
}

function requireIds(orgId: string, recipientUserId?: string): void {
  if (!orgId) throw new Error("notifications store requires a non-empty organizationId");
  if (recipientUserId !== undefined && !recipientUserId) {
    throw new Error("notifications store requires a non-empty recipientUserId");
  }
}

/**
 * Inserts the rows inside the caller's transaction, skipping any row whose (organization,
 * recipient, type, eventKey) already exists. Returns the number of rows inserted. A concurrent
 * transaction inserting the same key waits for this one and then skips, so both commit and one
 * row remains (AIDA-44).
 */
export async function insertNotifications(
  tx: NotificationInsertTx,
  orgId: string,
  rows: readonly NotificationItem[],
): Promise<number> {
  requireIds(orgId);
  if (rows.length === 0) return 0;
  const data = rows.map((row): NotificationRowData => {
    if (!row.recipientUserId) throw new Error("insertNotifications: empty recipientUserId");
    if (!row.eventKey) throw new Error("insertNotifications: empty eventKey");
    return {
      organizationId: orgId,
      recipientUserId: row.recipientUserId,
      actorUserId: row.actorUserId ?? null,
      type: row.type,
      eventKey: row.eventKey,
      entityType: row.entityType,
      entityId: row.entityId,
      unassignedFallback: row.unassignedFallback === true,
    };
  });
  const result = await tx.notification.createMany({ data, skipDuplicates: true });
  return result.count;
}

/** Unread and not archived notifications of this member in this organization (D-19). */
export async function countUnread(orgId: string, recipientUserId: string): Promise<number> {
  requireIds(orgId, recipientUserId);
  return scopedDb(orgId).notification.count({
    where: { recipientUserId, readAt: null, archivedAt: null },
  });
}

/** One bell row. ticketNumber and ticketSubject are resolved at read time, never stored. */
export interface NotificationListItem {
  id: string;
  type: NotificationTypeName;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  unassignedFallback: boolean;
  readAt: Date | null;
  createdAt: Date;
  /** Null when the entity is not a ticket or the ticket no longer exists. */
  ticketNumber: number | null;
  ticketSubject: string | null;
}

/**
 * The most recent not-archived notifications of this member in this organization, newest first
 * (createdAt desc, then id desc). Ticket number and subject come from one scoped ticket read; a
 * missing ticket gives null fields and the row is still returned.
 */
export async function listRecent(
  orgId: string,
  recipientUserId: string,
  limit = 20,
): Promise<NotificationListItem[]> {
  requireIds(orgId, recipientUserId);
  const take = Math.max(1, Math.min(Math.trunc(limit) || 20, 100));
  const db = scopedDb(orgId);
  const rows = await db.notification.findMany({
    where: { recipientUserId, archivedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      type: true,
      actorUserId: true,
      entityType: true,
      entityId: true,
      unassignedFallback: true,
      readAt: true,
      createdAt: true,
    },
  });
  const ticketIds = [
    ...new Set(rows.filter((r) => r.entityType === TICKET_ENTITY).map((r) => r.entityId)),
  ];
  const tickets =
    ticketIds.length === 0
      ? []
      : await db.ticket.findMany({
          where: { id: { in: ticketIds } },
          select: { id: true, number: true, subject: true },
        });
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return rows.map((row) => {
    const ticket = row.entityType === TICKET_ENTITY ? byId.get(row.entityId) : undefined;
    return {
      ...row,
      ticketNumber: ticket?.number ?? null,
      ticketSubject: ticket?.subject ?? null,
    };
  });
}

/**
 * Marks one notification of this member in this organization read. Returns true when this call
 * set readAt; false for a row already read, another member's row, another organization's row or
 * an unknown id (nothing changes then).
 */
export async function markRead(
  orgId: string,
  recipientUserId: string,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  requireIds(orgId, recipientUserId);
  if (!id) return false;
  const result = await scopedDb(orgId).notification.updateMany({
    where: { id, recipientUserId, readAt: null },
    data: { readAt: now },
  });
  return result.count > 0;
}

/**
 * Marks every unread, not archived notification of this member in this organization read and
 * returns how many rows changed (0 when none did).
 */
export async function markAllRead(
  orgId: string,
  recipientUserId: string,
  now: Date = new Date(),
): Promise<number> {
  requireIds(orgId, recipientUserId);
  const result = await scopedDb(orgId).notification.updateMany({
    where: { recipientUserId, readAt: null, archivedAt: null },
    data: { readAt: now },
  });
  return result.count;
}

/**
 * Archives one notification of this member in this organization: it leaves the list and the
 * count, and its read state persists. Returns true when this call set archivedAt; false for a
 * row already archived, another member's or organization's row, or an unknown id.
 */
export async function archive(
  orgId: string,
  recipientUserId: string,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  requireIds(orgId, recipientUserId);
  if (!id) return false;
  const result = await scopedDb(orgId).notification.updateMany({
    where: { id, recipientUserId, archivedAt: null },
    data: { archivedAt: now },
  });
  return result.count > 0;
}

/** One row claimed for a digest. */
export interface ClaimedNotification {
  id: string;
  type: NotificationTypeName;
  entityId: string;
  unassignedFallback: boolean;
}

/** Any client that runs a tagged raw query, in practice the digest's interactive transaction. */
export interface DigestClaimTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/**
 * Locks and returns this recipient's unread, not archived, not yet digested rows of the given
 * types in this organization, oldest first (createdAt, then id), for the rest of tx. Rows another
 * open transaction has locked are skipped, never waited for, so two digest runs never claim the
 * same row. Fallback rows (V-28) are left out when includeFallback is false.
 *
 * Deviation from D-15, recorded in plan 10-04 (C10): this is the only raw SQL of the module,
 * because a row-lock-and-skip claim has no Prisma equivalent. Every value is a bound parameter,
 * and the organization and the recipient are explicit terms.
 */
export async function claimDigestCandidates(
  tx: DigestClaimTx,
  orgId: string,
  recipientUserId: string,
  types: readonly NotificationTypeName[],
  includeFallback: boolean,
): Promise<ClaimedNotification[]> {
  requireIds(orgId, recipientUserId);
  const wanted = [...new Set(types)];
  for (const type of wanted) {
    if (!isNotificationType(type)) throw new Error(`unknown notification type: ${String(type)}`);
  }
  if (wanted.length === 0) return [];
  const rows = await tx.$queryRaw<ClaimedNotification[]>`
    SELECT "id", "type"::text AS "type", "entityId", "unassignedFallback"
    FROM "Notification"
    WHERE "organizationId" = ${orgId}
      AND "recipientUserId" = ${recipientUserId}
      AND "readAt" IS NULL
      AND "archivedAt" IS NULL
      AND "digestedAt" IS NULL
      AND "type"::text = ANY(${wanted}::text[])
      AND (${includeFallback}::boolean OR "unassignedFallback" = false)
    ORDER BY "createdAt", "id"
    FOR UPDATE SKIP LOCKED
  `;
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    entityId: row.entityId,
    unassignedFallback: row.unassignedFallback === true,
  }));
}

/** One row as the digest re-reads it before sending. */
export interface DigestRow {
  id: string;
  type: NotificationTypeName;
  entityType: string;
  entityId: string;
  unassignedFallback: boolean;
  createdAt: Date;
}

/** The client of readDigestRows and stampDigested, typed structurally like NotificationInsertTx. */
export interface DigestRowsTx {
  notification: {
    findMany(args: {
      where: {
        organizationId: string;
        recipientUserId: string;
        id: { in: string[] };
        readAt: null;
        archivedAt: null;
        digestedAt: null;
      };
      select: {
        id: true;
        type: true;
        entityType: true;
        entityId: true;
        unassignedFallback: true;
        createdAt: true;
      };
      orderBy: [{ createdAt: "asc" }, { id: "asc" }];
    }): PromiseLike<DigestRow[]>;
    updateMany(args: {
      where: {
        organizationId: string;
        recipientUserId: string;
        id: { in: string[] };
        digestedAt: null;
      };
      data: { digestedAt: Date };
    }): PromiseLike<{ count: number }>;
  };
}

/**
 * Of the given ids, this recipient's rows in this organization that are still unread, not
 * archived and not digested, oldest first. Ids of other recipients or organizations are ignored.
 */
export async function readDigestRows(
  tx: Pick<DigestRowsTx, "notification">,
  orgId: string,
  recipientUserId: string,
  ids: readonly string[],
): Promise<DigestRow[]> {
  requireIds(orgId, recipientUserId);
  if (ids.length === 0) return [];
  return tx.notification.findMany({
    where: {
      organizationId: orgId,
      recipientUserId,
      id: { in: [...new Set(ids)] },
      readAt: null,
      archivedAt: null,
      digestedAt: null,
    },
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      unassignedFallback: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Stamps digestedAt on the given ids that belong to this recipient in this organization and are
 * not yet digested; returns how many rows changed. Ids of other recipients or organizations are
 * never touched.
 */
export async function stampDigested(
  tx: Pick<DigestRowsTx, "notification">,
  orgId: string,
  recipientUserId: string,
  ids: readonly string[],
  now: Date,
): Promise<number> {
  requireIds(orgId, recipientUserId);
  if (ids.length === 0) return 0;
  const result = await tx.notification.updateMany({
    where: {
      organizationId: orgId,
      recipientUserId,
      id: { in: [...new Set(ids)] },
      digestedAt: null,
    },
    data: { digestedAt: now },
  });
  return result.count;
}

/** One (organization, recipient) pair with digest-eligible rows; exactly these two keys. */
export interface DigestPair {
  organizationId: string;
  recipientUserId: string;
}

/** The client of listDigestPairs: the global client, unscoped by design (see below). */
export interface DigestPairsClient {
  notification: {
    findMany(args: {
      where: { readAt: null; archivedAt: null; digestedAt: null };
      select: { organizationId: true; recipientUserId: true };
      distinct: ["organizationId", "recipientUserId"];
      orderBy: [{ organizationId: "asc" }, { recipientUserId: "asc" }];
    }): PromiseLike<DigestPair[]>;
  };
}

/**
 * The distinct (organization, recipient) pairs that have unread, not archived, not digested rows.
 *
 * The single named exception to D-15's per-organization, per-recipient filter (plan 10-04, cycle
 * 2 LOW finding): the scheduled digest job has no request organization and must discover its
 * candidate pairs, so this reads across organizations, once per digest run. It returns only the
 * two ids, never row content. Its only caller is src/lib/notifications/digest.ts (plan 10-09),
 * which then works per pair through the organization- and recipient-scoped functions above.
 */
export async function listDigestPairs(client: DigestPairsClient): Promise<DigestPair[]> {
  const rows = await client.notification.findMany({
    where: { readAt: null, archivedAt: null, digestedAt: null },
    select: { organizationId: true, recipientUserId: true },
    distinct: ["organizationId", "recipientUserId"],
    orderBy: [{ organizationId: "asc" }, { recipientUserId: "asc" }],
  });
  return rows.map((row) => ({
    organizationId: row.organizationId,
    recipientUserId: row.recipientUserId,
  }));
}
