// Emitting notifications inside the caller's transaction (Phase 10, AIDA-44, D-16, D-25, V-28).
// Notifications are written synchronously, in the same transaction as the change that causes
// them; there is no queue hop. This module decides WHO is notified; every write of the table goes
// through store.insertNotifications, and this file holds no query of that table (C10).
//
// Relative imports only and no framework import: the worker bundles this module.
import { insertNotifications, type NotificationInsertTx } from "./store";
import type { NotificationItem, NotificationTypeName } from "./types";

/**
 * The transaction client emitNotifications needs, typed structurally like the store's
 * NotificationInsertTx so the global client, a scopedDb client and their transactions all fit.
 * `member` is a Better Auth model outside DOMAIN_MODELS, so its organization term is explicit.
 */
export interface EmitTx extends NotificationInsertTx {
  member: {
    findMany(args: {
      where: { organizationId: string; userId: { in: string[] } };
      select: { userId: true };
    }): PromiseLike<{ userId: string }[]>;
  };
  notificationPreference: {
    findMany(args: {
      where: {
        organizationId: string;
        userId: { in: string[] };
        type: { in: NotificationTypeName[] };
        inApp: false;
      };
      select: { userId: true; type: true };
    }): PromiseLike<{ userId: string; type: NotificationTypeName }[]>;
  };
}

/**
 * Writes the items inside tx and returns the number of rows inserted. Skipped, in order:
 *   1. an item whose recipient is its actor (nobody is notified of their own action);
 *   2. an item whose recipient holds no member row in orgId (D-16, D-25): one plain read of the
 *      member rows of every remaining recipient, with an explicit organization term;
 *   3. an item whose type the recipient turned off in-app (D-22; a missing preference row means
 *      on).
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

  const off = await tx.notificationPreference.findMany({
    where: {
      organizationId: orgId,
      userId: { in: [...new Set(ofMembers.map((item) => item.recipientUserId))] },
      type: { in: [...new Set(ofMembers.map((item) => item.type))] },
      inApp: false,
    },
    select: { userId: true, type: true },
  });
  const offKeys = new Set(off.map((p) => `${p.userId}\u0000${p.type}`));
  const enabled = ofMembers.filter(
    (item) => !offKeys.has(`${item.recipientUserId}\u0000${item.type}`),
  );
  if (enabled.length === 0) return 0;

  return insertNotifications(tx, orgId, enabled);
}
