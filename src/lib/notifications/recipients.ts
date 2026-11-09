// Recipients of the unassigned-ticket fallback (Phase 10, AIDA-44, owner item 11 option b, V-28,
// V-26). When a customer reply or an SLA transition hits a ticket with no assignee, every current
// owner and admin of the organization is notified, and each can turn this off for themselves
// (preferences.ts, NotificationSetting.unassignedTickets).
//
// The read runs inside the emitting transaction, after that transaction's existing locks, as a
// plain read with no row lock of its own: a share lock taken after a ticket lock could invert the
// lock order of the ticket mutation service and the SLA worker. The set is therefore a snapshot at
// read time, not a promise that each recipient is still a member at commit; the bell and the
// digest re-check membership when they read (C8, D-25).
//
// Relative imports only and no framework import: the worker bundles this module.
import { isAdminRole } from "../membership";

/**
 * The transaction client unassignedFallbackRecipients needs, typed structurally so the global
 * client, a scopedDb client and their transactions all fit. `member` is a Better Auth model outside
 * DOMAIN_MODELS, so the organization term is explicit.
 */
export interface RecipientsTx {
  member: {
    findMany(args: {
      where: { organizationId: string };
      select: { userId: true; role: true };
      orderBy: { id: "asc" };
    }): PromiseLike<{ userId: string; role: string }[]>;
  };
}

/**
 * The user ids of every current owner and admin of orgId, in the id order of their first member
 * row. The member table has no unique key on (organizationId, userId) while owner item O-4 is
 * open, so the rows are grouped by user and the deciding-row rule applies (V-26 (1), the rule of
 * findConservativeMembership): a user qualifies only when EVERY row is `owner` or `admin`. A user
 * with an `owner` and a `member` row, or with any role outside the three, is excluded (V-26 (4),
 * fail closed); a user with two admin rows appears once.
 */
export async function unassignedFallbackRecipients(
  tx: RecipientsTx,
  orgId: string,
): Promise<string[]> {
  if (!orgId) throw new Error("unassignedFallbackRecipients requires a non-empty organizationId");
  const rows = await tx.member.findMany({
    where: { organizationId: orgId },
    select: { userId: true, role: true },
    orderBy: { id: "asc" },
  });
  const qualifies = new Map<string, boolean>();
  for (const row of rows) {
    const sofar = qualifies.get(row.userId) ?? true;
    qualifies.set(row.userId, sofar && isAdminRole(row.role));
  }
  return [...qualifies].filter(([, ok]) => ok).map(([userId]) => userId);
}

/** The transaction client ticketAssigneeId needs, typed structurally like RecipientsTx. */
export interface TicketAssigneeTx {
  ticket: {
    findFirst(args: {
      where: { id: string; organizationId: string };
      select: { assigneeId: true };
    }): PromiseLike<{ assigneeId: string | null } | null>;
  };
}

/**
 * The current assignee of a ticket of orgId, or null when it has none or is not in orgId. A plain
 * read with an explicit organization term and no lock of its own: the reply writers call it inside
 * their transaction after resolveReplyTicket locked the effective ticket (V-28), so the value
 * cannot change before commit. An assignee who is no longer a member is still returned, and
 * emitForTicket then skips them (O-7 (b) default: such a ticket is not unassigned).
 */
export async function ticketAssigneeId(
  tx: TicketAssigneeTx,
  orgId: string,
  ticketId: string,
): Promise<string | null> {
  if (!orgId) throw new Error("ticketAssigneeId requires a non-empty organizationId");
  const row = await tx.ticket.findFirst({
    where: { id: ticketId, organizationId: orgId },
    select: { assigneeId: true },
  });
  return row?.assigneeId ?? null;
}
