// Auto-close settings (Phase 11, AIDA-51, D-15). Two organization settings in Setting:
//
//   autoCloseResolvedAfterDays  whole number 0..365 as a canonical decimal; 0 or absent = off
//   autoCloseEnabledAt          ISO timestamp; set when the days go from 0 to a positive value,
//                               kept when one positive value replaces another, removed at 0
//
// The quiet period of a resolved ticket starts at the later of its resolvedAt and
// autoCloseEnabledAt (D-16 as amended), so tickets resolved before enabling do not all close
// at once.
//
// Lock protocol (Codex reviews C8 and R2-3):
//   - saveAutoCloseDays holds SELECT … FOR UPDATE on the organization's days row for its whole
//     transaction and writes both keys only under that lock.
//   - Every close transaction of the auto-close job first calls lockAutoCloseSettings, which
//     takes FOR SHARE on the same row and computes everything from what it read under it. A
//     save waits for a close that holds the share lock; a close waits for a save in progress
//     and then reads what the save committed.
//   - When the FOR SHARE statement finds no days row, auto-close is off for that close and no
//     further setting is read: a share lock on no row protects nothing.
//
// Every Setting read and write carries an explicit organizationId predicate, because the worker
// passes the unscoped client. Relative imports only: the worker bundles this module.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { findActiveMembership, isAdminRole } from "../membership";
import { parseAutoCloseDays } from "./auto-close-days";

export const AUTO_CLOSE_DAYS_KEY = "autoCloseResolvedAfterDays";
export const AUTO_CLOSE_ENABLED_AT_KEY = "autoCloseEnabledAt";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * The effective auto-close settings of one organization. `days` is 0 whenever auto-close is
 * off, including when the stored values are not valid (`invalid` true): a stored days value
 * that parseAutoCloseDays refuses, or a positive value without a parseable enabledAt.
 */
export interface AutoCloseSettings {
  days: number;
  enabledAt: Date | null;
  invalid: boolean;
}

const OFF: AutoCloseSettings = Object.freeze({ days: 0, enabledAt: null, invalid: false });
const INVALID: AutoCloseSettings = Object.freeze({ days: 0, enabledAt: null, invalid: true });

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function parseEnabledAt(raw: string | null | undefined): Date | null {
  if (typeof raw !== "string" || !ISO_TIMESTAMP.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Combines the two stored values into the effective settings. */
function toSettings(
  daysRaw: string | null | undefined,
  enabledAtRaw: string | null | undefined,
): AutoCloseSettings {
  if (daysRaw === null || daysRaw === undefined) return OFF;
  const parsed = parseAutoCloseDays(daysRaw);
  if (!parsed.ok) return INVALID;
  if (parsed.days === 0) return OFF;
  const enabledAt = parseEnabledAt(enabledAtRaw);
  if (!enabledAt) return INVALID;
  return { days: parsed.days, enabledAt, invalid: false };
}

/** A client that can read Setting rows: the global client or a transaction client. */
type SettingReadClient = Pick<Prisma.TransactionClient, "setting">;

/** Reads both settings without a lock (the settings page, and the job's first pass). */
export async function readAutoCloseSettings(
  client: SettingReadClient,
  orgId: string,
): Promise<AutoCloseSettings> {
  const rows = await client.setting.findMany({
    where: {
      organizationId: orgId,
      key: { in: [AUTO_CLOSE_DAYS_KEY, AUTO_CLOSE_ENABLED_AT_KEY] },
    },
    select: { key: true, value: true },
  });
  const days = rows.find((r) => r.key === AUTO_CLOSE_DAYS_KEY)?.value;
  const enabledAt = rows.find((r) => r.key === AUTO_CLOSE_ENABLED_AT_KEY)?.value;
  return toSettings(days, enabledAt);
}

/** Test seam. Production callers never pass it. */
export interface LockAutoCloseSettingsHooks {
  /** Awaited right after the FOR SHARE statement, before anything else (Codex review R2-3). */
  afterShareLock?(tx: Prisma.TransactionClient): Promise<void> | void;
}

/**
 * Takes FOR SHARE on the organization's days row and returns the settings read under that lock.
 * Must run inside the close's transaction. When the statement finds no row, returns off at once
 * and reads nothing else (Codex review R2-3).
 */
export async function lockAutoCloseSettings(
  tx: Prisma.TransactionClient,
  orgId: string,
  hooks: LockAutoCloseSettingsHooks = {},
): Promise<AutoCloseSettings> {
  const rows = await tx.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "Setting"
    WHERE "organizationId" = ${orgId} AND "key" = ${AUTO_CLOSE_DAYS_KEY}
    FOR SHARE
  `;
  if (hooks.afterShareLock) await hooks.afterShareLock(tx);
  const daysRow = rows[0];
  if (!daysRow) return OFF;

  const parsed = parseAutoCloseDays(daysRow.value);
  if (!parsed.ok) return INVALID;
  if (parsed.days === 0) return OFF;

  // Saves write enabledAt only while holding FOR UPDATE on the days row, so it cannot change
  // before this transaction ends.
  const enabledRow = await tx.setting.findFirst({
    where: { organizationId: orgId, key: AUTO_CLOSE_ENABLED_AT_KEY },
    select: { value: true },
  });
  return toSettings(daysRow.value, enabledRow?.value);
}

export interface AutoCloseActor {
  userId: string;
  orgId: string;
}

export type AutoCloseSaveErrorCode = "INVALID" | "NOT_ALLOWED" | "MEMBERSHIP_ENDED";

export type AutoCloseSaveResult =
  | { ok: true; days: number; enabledAt: Date | null }
  | { ok: false; error: AutoCloseSaveErrorCode };

/** Test seams. Production callers never pass them. */
export interface AutoCloseSaveHooks {
  /** Awaited as the very first step inside the transaction. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited as the last step before the transaction returns (and commits). */
  beforeCommit?(tx: Prisma.TransactionClient): Promise<void> | void;
}

export interface AutoCloseSaveOptions {
  now?: Date;
  hooks?: AutoCloseSaveHooks;
}

/** Needs $transaction and the member delegate: the global prisma client. */
type SaveClient = Pick<PrismaClient, "$transaction" | "member">;

/**
 * Saves the days setting for the actor's organization (owners and admins only, D-15, D-01).
 * Stores the canonical decimal ("007" → "7") and sets, keeps or clears autoCloseEnabledAt.
 * Refusals are returned; any other error is rethrown.
 */
export async function saveAutoCloseDays(
  client: SaveClient,
  actor: AutoCloseActor,
  raw: unknown,
  opts: AutoCloseSaveOptions = {},
): Promise<AutoCloseSaveResult> {
  const now = opts.now ?? new Date();
  const hooks = opts.hooks ?? {};

  const membership = await findActiveMembership(client, actor?.userId, actor?.orgId);
  if (!membership) return { ok: false, error: "MEMBERSHIP_ENDED" };
  if (!isAdminRole(membership.role)) return { ok: false, error: "NOT_ALLOWED" };
  const parsed = parseAutoCloseDays(raw);
  if (!parsed.ok) return { ok: false, error: "INVALID" };

  const orgId = actor.orgId;
  const days = parsed.days;

  return client.$transaction(async (tx) => {
    if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);

    // The row must exist so FOR UPDATE has something to lock (a close's FOR SHARE on a missing
    // row locks nothing, see lockAutoCloseSettings).
    await tx.$executeRaw`
      INSERT INTO "Setting" ("id", "organizationId", "key", "value", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${orgId}, ${AUTO_CLOSE_DAYS_KEY}, '0', ${now}, ${now})
      ON CONFLICT ("organizationId", "key") DO NOTHING
    `;
    const locked = await tx.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "Setting"
      WHERE "organizationId" = ${orgId} AND "key" = ${AUTO_CLOSE_DAYS_KEY}
      FOR UPDATE
    `;
    const previous = parseAutoCloseDays(locked[0]?.value);
    const previousDays = previous.ok ? previous.days : 0;

    await tx.setting.updateMany({
      where: { organizationId: orgId, key: AUTO_CLOSE_DAYS_KEY },
      data: { value: String(days) },
    });

    let enabledAt: Date | null = null;
    if (days === 0) {
      await tx.setting.deleteMany({
        where: { organizationId: orgId, key: AUTO_CLOSE_ENABLED_AT_KEY },
      });
    } else {
      const existingRow = await tx.setting.findFirst({
        where: { organizationId: orgId, key: AUTO_CLOSE_ENABLED_AT_KEY },
        select: { value: true },
      });
      const existing = parseEnabledAt(existingRow?.value);
      // Kept only when one positive value replaces another and the stored moment is valid.
      enabledAt = previousDays > 0 && existing ? existing : now;
      if (enabledAt !== existing) {
        await tx.setting.upsert({
          where: { organizationId_key: { organizationId: orgId, key: AUTO_CLOSE_ENABLED_AT_KEY } },
          create: {
            organizationId: orgId,
            key: AUTO_CLOSE_ENABLED_AT_KEY,
            value: enabledAt.toISOString(),
          },
          update: { value: enabledAt.toISOString() },
        });
      }
    }

    if (hooks.beforeCommit) await hooks.beforeCommit(tx);
    return { ok: true as const, days, enabledAt };
  }, TRANSACTION_OPTIONS);
}
