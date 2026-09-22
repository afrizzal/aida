// The every-minute snooze wake job (Phase 12, AIDA-54, D-13).
//
// Reads at most 500 due tickets across organizations (id and organizationId), ordered by
// snoozedUntil then id, and wakes each in its own transaction through wakeDueTicket, which is
// given the ticket's organization and puts it in both statements (review WR-01):
//   1. SELECT "snoozedUntil" … FOR UPDATE with the organization predicate: the deadline read
//      under the row lock is the WOKEN audit's `before` (review C6; an UPDATE … RETURNING yields
//      the new null)
//   2. hooks.afterWakeLock (test seam only)
//   3. one conditional UPDATE with the organization predicate that re-checks "snoozedUntil" IS
//      NOT NULL AND "snoozedUntil" <= now in the statement, so a re-snooze to a later time that
//      committed first is not undone
//   4. WOKEN (SYSTEM) only when a row changed
// A second run wakes nothing (idempotent); a run after a worker restart picks up whatever is
// due; anything beyond 500 is left for the next minute. Nothing is sent to anyone.
//
// Relative imports only: the worker bundles this module.
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db";
import { recordTicketAudit } from "../../tickets/ticket-audit";

/** The most tickets one run wakes. */
export const MAX_SNOOZE_WAKE_PER_RUN = 500;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export interface WakeDueHooks {
  /** Test seam: awaited after the deadline was read under the row lock, before the UPDATE. */
  afterWakeLock?(tx: Prisma.TransactionClient): Promise<void> | void;
}

/**
 * Wakes one ticket of the organization when its deadline is due at `now`; a ticket id of another
 * organization wakes nothing. Must run inside a transaction.
 */
export async function wakeDueTicket(
  tx: Prisma.TransactionClient,
  ticketId: string,
  now: Date,
  orgId: string,
  hooks: WakeDueHooks = {},
): Promise<boolean> {
  const locked = await tx.$queryRaw<{ snoozedUntil: Date | null }[]>`
    SELECT "snoozedUntil" FROM "Ticket"
    WHERE id = ${ticketId} AND "organizationId" = ${orgId}
    FOR UPDATE
  `;
  const row = locked[0];
  if (hooks.afterWakeLock) await hooks.afterWakeLock(tx);
  if (!row || row.snoozedUntil === null) return false;
  const deadline = row.snoozedUntil;

  const changed = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Ticket"
    SET "snoozedUntil" = NULL, "updatedAt" = now()
    WHERE id = ${ticketId}
      AND "organizationId" = ${orgId}
      AND "snoozedUntil" IS NOT NULL
      AND "snoozedUntil" <= ${now}
    RETURNING id
  `;
  if (changed.length === 0) return false;

  await recordTicketAudit(tx, orgId, {
    ticketId,
    actorType: "SYSTEM",
    actorUserId: null,
    action: "WOKEN",
    before: { snoozedUntil: deadline.toISOString() },
    after: { snoozedUntil: null },
  });
  return true;
}

export interface SnoozeWakeOptions extends WakeDueHooks {
  now?: Date;
  batchSize?: number;
  /** Test seam: awaited as the first step of each wake transaction. */
  onWakeTransaction?(tx: Prisma.TransactionClient, ticketId: string): Promise<void> | void;
}

/** The scheduled job (D-13). Returns how many tickets it woke. */
export async function snoozeWakeHandler(
  _data?: unknown,
  opts: SnoozeWakeOptions = {},
): Promise<{ woken: number }> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? MAX_SNOOZE_WAKE_PER_RUN;

  const due = await prisma.$queryRaw<{ id: string; organizationId: string }[]>`
    SELECT id, "organizationId" FROM "Ticket"
    WHERE "snoozedUntil" IS NOT NULL AND "snoozedUntil" <= ${now}
    ORDER BY "snoozedUntil" ASC, id ASC
    LIMIT ${batchSize}
  `;

  let woken = 0;
  for (const { id, organizationId } of due) {
    const done = await prisma.$transaction(async (tx) => {
      if (opts.onWakeTransaction) await opts.onWakeTransaction(tx, id);
      return wakeDueTicket(tx, id, now, organizationId, { afterWakeLock: opts.afterWakeLock });
    }, TRANSACTION_OPTIONS);
    if (done) woken += 1;
  }
  return { woken };
}
