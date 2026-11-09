// Emitting notifications inside the caller's transaction (Phase 10, AIDA-44, D-16, D-25, V-28).
// Notifications are written synchronously, in the same transaction as the change that causes
// them; there is no queue hop. This module decides WHO is notified; every write of the table goes
// through store.insertNotifications, and this file holds no query of that table (C10).
//
// Relative imports only and no framework import: the worker bundles this module.
import {
  enabledInAppRecipients,
  type PreferenceReadTx,
  unassignedEnabledRecipients,
} from "./preferences";
import { type RecipientsTx, unassignedFallbackRecipients } from "./recipients";
import { insertNotifications, type NotificationInsertTx } from "./store";
import { type NotificationItem, type NotificationTypeName, TICKET_ENTITY } from "./types";

/**
 * The transaction client emitNotifications needs, typed structurally like the store's
 * NotificationInsertTx so the global client, a scopedDb client and their transactions all fit.
 * `member` is a Better Auth model outside DOMAIN_MODELS, so its organization term is explicit.
 */
export interface EmitTx
  extends NotificationInsertTx,
    Pick<PreferenceReadTx, "notificationPreference"> {
  member: {
    findMany(args: {
      where: { organizationId: string; userId: { in: string[] } };
      select: { userId: true };
    }): PromiseLike<{ userId: string }[]>;
  };
}

/** The transaction client emitForTicket needs: emitNotifications' plus the fallback reads. */
export type EmitForTicketTx = EmitTx & RecipientsTx & Pick<PreferenceReadTx, "notificationSetting">;

/** At most this many rows per createMany of a fallback emission (all in the same transaction). */
export const FALLBACK_INSERT_CHUNK = 500;

/**
 * Writes the items inside tx and returns the number of rows inserted. Skipped, in order:
 *   1. an item whose recipient is its actor (nobody is notified of their own action);
 *   2. an item whose recipient holds no member row in orgId (D-16, D-25): one plain read of the
 *      member rows of every remaining recipient, with an explicit organization term;
 *   3. an item whose type the recipient turned off in-app (D-22; a missing preference row means
 *      on): one preference read per distinct type through enabledInAppRecipients.
 * Duplicate keys are skipped by the store without aborting tx (D-14).
 */
export async function emitNotifications(
  tx: EmitTx,
  orgId: string,
  items: readonly NotificationItem[],
): Promise<number> {
  if (!orgId) throw new Error("emitNotifications requires a non-empty organizationId");
  const notSelf = items.filter(
    (item) => item.recipientUserId && item.recipientUserId !== (item.actorUserId ?? null),
  );
  if (notSelf.length === 0) return 0;

  const recipientIds = [...new Set(notSelf.map((item) => item.recipientUserId))];
  const members = await tx.member.findMany({
    where: { organizationId: orgId, userId: { in: recipientIds } },
    select: { userId: true },
  });
  const memberIds = new Set(members.map((m) => m.userId));
  const ofMembers = notSelf.filter((item) => memberIds.has(item.recipientUserId));
  if (ofMembers.length === 0) return 0;

  const enabled: NotificationItem[] = [];
  const types = [...new Set(ofMembers.map((item) => item.type))];
  for (const type of types) {
    const ofType = ofMembers.filter((item) => item.type === type);
    const on = new Set(
      await enabledInAppRecipients(
        tx,
        orgId,
        ofType.map((item) => item.recipientUserId),
        type,
      ),
    );
    enabled.push(...ofType.filter((item) => on.has(item.recipientUserId)));
  }
  if (enabled.length === 0) return 0;

  return insertNotifications(tx, orgId, enabled);
}

export interface TicketEvent {
  /** The ticket's current assignee; null for an unassigned ticket. */
  assigneeId: string | null;
  type: NotificationTypeName;
  /** One key serves every recipient: the unique key includes the recipient (D-14). */
  eventKey: string;
  /** The ticket id. */
  entityId: string;
  /** The member who caused the event; absent for a customer or the system. */
  actorUserId?: string | null;
}

/**
 * Notifies the audience of a ticket event inside tx and returns the number of rows inserted.
 *
 * - With an assignee: one item to the assignee through emitNotifications (actor, membership and
 *   in-app rules apply). An assignee who is no longer a member gets nothing (O-7 (b) default).
 * - Without one (owner item 11 option b, V-28): every current owner and admin from
 *   unassignedFallbackRecipients, minus the actor, minus users whose "Unassigned tickets" switch
 *   is off (one NotificationSetting read, explicit organization term), every row marked
 *   `unassignedFallback: true`. The per-type in-app switch is not applied to these rows: the
 *   fallback has its own switch, which governs in-app and digest alike (V-28; a flagged
 *   assumption of plan 10-04). No cap and no silent truncation: the rows are written in chunks
 *   of at most FALLBACK_INSERT_CHUNK, all in tx, duplicates skipped.
 */
export async function emitForTicket(
  tx: EmitForTicketTx,
  orgId: string,
  event: TicketEvent,
): Promise<number> {
  if (!orgId) throw new Error("emitForTicket requires a non-empty organizationId");
  const actorUserId = event.actorUserId ?? null;
  const base = {
    actorUserId,
    type: event.type,
    eventKey: event.eventKey,
    entityType: TICKET_ENTITY,
    entityId: event.entityId,
  };

  if (event.assigneeId) {
    return emitNotifications(tx, orgId, [{ ...base, recipientUserId: event.assigneeId }]);
  }

  const candidates = (await unassignedFallbackRecipients(tx, orgId)).filter(
    (userId) => userId !== actorUserId,
  );
  if (candidates.length === 0) return 0;
  const recipients = await unassignedEnabledRecipients(tx, orgId, candidates);
  if (recipients.length === 0) return 0;

  const rows: NotificationItem[] = recipients.map((recipientUserId) => ({
    ...base,
    recipientUserId,
    unassignedFallback: true,
  }));
  let inserted = 0;
  for (let start = 0; start < rows.length; start += FALLBACK_INSERT_CHUNK) {
    inserted += await insertNotifications(
      tx,
      orgId,
      rows.slice(start, start + FALLBACK_INSERT_CHUNK),
    );
  }
  return inserted;
}
