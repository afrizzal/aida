// The single access boundary of the Notification table (Phase 10, AIDA-44, D-15, C10). Every
// read and write of notifications in src goes through a function here that takes the
// organization and the recipient explicitly:
//
// - Reads and updates outside a caller's transaction use scopedDb(orgId) and always filter
//   recipientUserId as well, because scopedDb adds only the organization.
// - Functions that run inside a caller's transaction (insert, digest claim, digest read and stamp)
//   receive a plain interactive transaction client, which may be unscoped (the worker), so they
//   write the organization term explicitly next to the recipient term.
// - The insert is createMany with skipDuplicates, which PostgreSQL runs as ON CONFLICT DO NOTHING
//   on the (organizationId, recipientUserId, type, eventKey) unique key: a duplicate is skipped
//   without aborting the caller's transaction (a caught P2002 would). scopedDb does not inject the
//   organization into createMany, so organizationId is written from the parameter on every row,
//   never from the item.
//
// Relative imports only and no framework import: the worker bundles this module.
import { scopedDb } from "../scoped-db";
import { type NotificationItem, type NotificationTypeName, TICKET_ENTITY } from "./types";

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
