// Notification preferences (Phase 10, AIDA-46, D-22) and the per-person opt-out of the
// unassigned-ticket fallback (AIDA-44, owner item 11, V-28). Explicit defaults: a missing
// NotificationPreference row means in-app on and digest on; a missing NotificationSetting row
// means "Unassigned tickets" on.
//
// Reads and writes outside a transaction use scopedDb(orgId) and always name the user. The two
// reads that run inside an emitting transaction take that transaction's client and write the
// organization term explicitly, because the client may be unscoped (the worker).
//
// Relative imports only and no framework import: the worker bundles this module.
import { scopedDb } from "../scoped-db";
import { isNotificationType, NOTIFICATION_TYPES, type NotificationTypeName } from "./types";

export interface NotificationPreferenceValue {
  type: NotificationTypeName;
  inApp: boolean;
  digest: boolean;
}

function requireIds(orgId: string, userId: string): void {
  if (!orgId) throw new Error("notification preferences require a non-empty organizationId");
  if (!userId) throw new Error("notification preferences require a non-empty userId");
}

function requireType(type: unknown): asserts type is NotificationTypeName {
  if (!isNotificationType(type)) throw new Error(`unknown notification type: ${String(type)}`);
}

/** All five types in NOTIFICATION_TYPES order, with the defaults filled in for missing rows. */
export async function getPreferences(
  orgId: string,
  userId: string,
): Promise<NotificationPreferenceValue[]> {
  requireIds(orgId, userId);
  const rows = await scopedDb(orgId).notificationPreference.findMany({
    where: { userId },
    select: { type: true, inApp: true, digest: true },
  });
  const byType = new Map(rows.map((row) => [row.type, row]));
  return NOTIFICATION_TYPES.map((type) => {
    const row = byType.get(type);
    return { type, inApp: row?.inApp ?? true, digest: row?.digest ?? true };
  });
}

/**
 * Stores the given switches of one type for this member, through one scoped upsert on the
 * (organizationId, userId, type) unique key. A switch left undefined keeps its stored value, or
 * the default (on) when no row exists yet.
 */
export async function setPreference(
  orgId: string,
  userId: string,
  type: NotificationTypeName,
  change: { inApp?: boolean; digest?: boolean },
): Promise<NotificationPreferenceValue> {
  requireIds(orgId, userId);
  requireType(type);
  const update: { inApp?: boolean; digest?: boolean } = {};
  if (typeof change.inApp === "boolean") update.inApp = change.inApp;
  if (typeof change.digest === "boolean") update.digest = change.digest;
  const row = await scopedDb(orgId).notificationPreference.upsert({
    where: { organizationId_userId_type: { organizationId: orgId, userId, type } },
    create: {
      organizationId: orgId,
      userId,
      type,
      inApp: update.inApp ?? true,
      digest: update.digest ?? true,
    },
    update,
    select: { type: true, inApp: true, digest: true },
  });
  return { type: row.type, inApp: row.inApp, digest: row.digest };
}

/** Whether this member receives the unassigned-ticket fallback; true when no row exists. */
export async function getUnassignedSetting(orgId: string, userId: string): Promise<boolean> {
  requireIds(orgId, userId);
  const row = await scopedDb(orgId).notificationSetting.findFirst({
    where: { userId },
    select: { unassignedTickets: true },
  });
  return row?.unassignedTickets ?? true;
}

/** Stores this member's unassigned-ticket switch through one scoped upsert. */
export async function setUnassignedSetting(
  orgId: string,
  userId: string,
  enabled: boolean,
): Promise<boolean> {
  requireIds(orgId, userId);
  if (typeof enabled !== "boolean") throw new Error("setUnassignedSetting requires a boolean");
  const row = await scopedDb(orgId).notificationSetting.upsert({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    create: { organizationId: orgId, userId, unassignedTickets: enabled },
    update: { unassignedTickets: enabled },
    select: { unassignedTickets: true },
  });
  return row.unassignedTickets;
}

/**
 * The transaction client of the two in-transaction reads below, typed structurally so the global
 * client, a scopedDb client and their transactions all fit.
 */
export interface PreferenceReadTx {
  notificationPreference: {
    findMany(args: {
      where: {
        organizationId: string;
        userId: { in: string[] };
        type: NotificationTypeName;
        inApp: false;
      };
      select: { userId: true };
    }): PromiseLike<{ userId: string }[]>;
  };
  notificationSetting: {
    findMany(args: {
      where: { organizationId: string; userId: { in: string[] }; unassignedTickets: false };
      select: { userId: true };
    }): PromiseLike<{ userId: string }[]>;
  };
}

/**
 * The given users minus those whose in-app switch of this type is off (one query, explicit
 * organization term, inside tx). Order and duplicates of userIds are kept. Used by
 * emitNotifications.
 */
export async function enabledInAppRecipients(
  tx: Pick<PreferenceReadTx, "notificationPreference">,
  orgId: string,
  userIds: readonly string[],
  type: NotificationTypeName,
): Promise<string[]> {
  if (!orgId) throw new Error("enabledInAppRecipients requires a non-empty organizationId");
  requireType(type);
  if (userIds.length === 0) return [];
  const off = await tx.notificationPreference.findMany({
    where: { organizationId: orgId, userId: { in: [...new Set(userIds)] }, type, inApp: false },
    select: { userId: true },
  });
  const offIds = new Set(off.map((row) => row.userId));
  return userIds.filter((id) => !offIds.has(id));
}

/**
 * The given users minus those who turned the unassigned-ticket fallback off (one query, explicit
 * organization term, inside tx). Used by emitForTicket.
 */
export async function unassignedEnabledRecipients(
  tx: Pick<PreferenceReadTx, "notificationSetting">,
  orgId: string,
  userIds: readonly string[],
): Promise<string[]> {
  if (!orgId) throw new Error("unassignedEnabledRecipients requires a non-empty organizationId");
  if (userIds.length === 0) return [];
  const off = await tx.notificationSetting.findMany({
    where: {
      organizationId: orgId,
      userId: { in: [...new Set(userIds)] },
      unassignedTickets: false,
    },
    select: { userId: true },
  });
  const offIds = new Set(off.map((row) => row.userId));
  return userIds.filter((id) => !offIds.has(id));
}
