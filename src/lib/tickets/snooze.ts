// Snooze and manual wake of one ticket (Phase 12, AIDA-54, D-12).
//
// A separate service, not new runTicketMutation operations, so the Phase 11 bulk contract stays
// unchanged. Each call is one interactive transaction:
//   1. hooks.onTransactionStart (test seam only)
//   2. the actor's member row (findActiveMembership) is the FIRST statement: MEMBERSHIP_ENDED
//   3. SELECT … FOR UPDATE on the ticket row with the organization predicate: TICKET_UNAVAILABLE
//   4. the checks, the update and one SNOOZED or WOKEN audit row (USER), before/after hold the
//      deadline as an ISO string or null only (D-21)
//   5. hooks.beforeCommit (test seam only)
//
// Snooze refusals, in this order: MERGED_SOURCE (a merged source is also CLOSED, and it gets
// MERGED_SOURCE), TICKET_CLOSED, TOO_SOON (earlier than now + 4 minutes; the UI asks for 5, one
// minute absorbs client clock skew), TOO_FAR (later than now + 366 days; the UI asks for 365).
// NEW, OPEN, PENDING and RESOLVED tickets can be snoozed (UI-SPEC Assumption 8). A re-snooze
// while snoozed replaces the deadline. A manual wake is allowed in every status, including a
// ticket closed after it was snoozed; it refuses NOT_SNOOZED when there is no deadline.
//
// Nothing is sent when a ticket is snoozed or woken (notifications are parked Phase 10).
// Relative imports only and no Next.js import: revalidation belongs to the server action.
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { findActiveMembership } from "../membership";
import { recordTicketAudit } from "./ticket-audit";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** The earliest accepted deadline, relative to the server's now. */
export const SNOOZE_MIN_LEAD_MS = 4 * 60 * 1000;
/** The latest accepted deadline, relative to the server's now. */
export const SNOOZE_MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;

export type SnoozeErrorCode =
  | "INVALID"
  | "MEMBERSHIP_ENDED"
  | "TICKET_UNAVAILABLE"
  | "MERGED_SOURCE"
  | "TICKET_CLOSED"
  | "TOO_SOON"
  | "TOO_FAR"
  | "NOT_SNOOZED";

/** A refusal by the service. Rolled back and returned, never rethrown. */
export class SnoozeError extends Error {
  readonly code: SnoozeErrorCode;

  constructor(code: SnoozeErrorCode) {
    super(`Ticket snooze refused: ${code}`);
    this.name = "SnoozeError";
    this.code = code;
  }
}

export interface SnoozeActor {
  userId: string;
  orgId: string;
}

/** Test seams. Production callers never pass them. */
export interface SnoozeHooks {
  /** Awaited as the very first step inside the transaction. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited after the last write, just before the transaction commits. */
  beforeCommit?(tx: Prisma.TransactionClient): Promise<void> | void;
}

export interface SnoozeOptions {
  now?: Date;
  hooks?: SnoozeHooks;
}

export type SnoozeResult =
  | { ok: true; ticketId: string; snoozedUntil: Date }
  | { ok: false; error: SnoozeErrorCode };

export type WakeResult = { ok: true; ticketId: string } | { ok: false; error: SnoozeErrorCode };

interface LockedSnoozeRow {
  id: string;
  status: string;
  mergedIntoTicketId: string | null;
  snoozedUntil: Date | null;
}

async function lockTicket(
  tx: Prisma.TransactionClient,
  orgId: string,
  ticketId: string,
): Promise<LockedSnoozeRow> {
  const rows = await tx.$queryRaw<LockedSnoozeRow[]>`
    SELECT id, status::text AS status, "mergedIntoTicketId", "snoozedUntil"
    FROM "Ticket"
    WHERE id = ${ticketId} AND "organizationId" = ${orgId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new SnoozeError("TICKET_UNAVAILABLE");
  return row;
}

function validTicketId(ticketId: unknown): ticketId is string {
  return typeof ticketId === "string" && ticketId.length > 0;
}

/** Snoozes the ticket until `until` (D-12). Returns ok or a refusal code; other errors rethrow. */
export async function snoozeTicket(
  client: PrismaClient,
  actor: SnoozeActor,
  { ticketId, until }: { ticketId: string; until: Date },
  { now, hooks = {} }: SnoozeOptions = {},
): Promise<SnoozeResult> {
  try {
    if (!(until instanceof Date) || Number.isNaN(until.getTime())) {
      throw new SnoozeError("INVALID");
    }
    if (!validTicketId(ticketId)) throw new SnoozeError("TICKET_UNAVAILABLE");
    const { orgId, userId } = actor;

    return await client.$transaction(async (tx) => {
      if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);

      const membership = await findActiveMembership(tx, userId, orgId);
      if (!membership) throw new SnoozeError("MEMBERSHIP_ENDED");

      const row = await lockTicket(tx, orgId, ticketId);
      if (row.mergedIntoTicketId !== null) throw new SnoozeError("MERGED_SOURCE");
      if (row.status === "CLOSED") throw new SnoozeError("TICKET_CLOSED");

      // The bounds are measured after the lock, so a wait on the lock never stretches them.
      const at = (now ?? new Date()).getTime();
      if (until.getTime() < at + SNOOZE_MIN_LEAD_MS) throw new SnoozeError("TOO_SOON");
      if (until.getTime() > at + SNOOZE_MAX_LEAD_MS) throw new SnoozeError("TOO_FAR");

      await tx.$executeRaw`
        UPDATE "Ticket"
        SET "snoozedUntil" = ${until}, "updatedAt" = now()
        WHERE id = ${ticketId} AND "organizationId" = ${orgId}
      `;
      await recordTicketAudit(tx, orgId, {
        ticketId,
        actorType: "USER",
        actorUserId: userId,
        action: "SNOOZED",
        before: { snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null },
        after: { snoozedUntil: until.toISOString() },
      });

      if (hooks.beforeCommit) await hooks.beforeCommit(tx);
      return { ok: true as const, ticketId, snoozedUntil: until };
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof SnoozeError) return { ok: false, error: err.code };
    throw err;
  }
}

/** Wakes a snoozed ticket by hand (D-12), in any status. */
export async function wakeTicket(
  client: PrismaClient,
  actor: SnoozeActor,
  { ticketId }: { ticketId: string },
  { hooks = {} }: { hooks?: SnoozeHooks } = {},
): Promise<WakeResult> {
  try {
    if (!validTicketId(ticketId)) throw new SnoozeError("TICKET_UNAVAILABLE");
    const { orgId, userId } = actor;

    return await client.$transaction(async (tx) => {
      if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);

      const membership = await findActiveMembership(tx, userId, orgId);
      if (!membership) throw new SnoozeError("MEMBERSHIP_ENDED");

      const row = await lockTicket(tx, orgId, ticketId);
      if (row.snoozedUntil === null) throw new SnoozeError("NOT_SNOOZED");

      await tx.$executeRaw`
        UPDATE "Ticket"
        SET "snoozedUntil" = NULL, "updatedAt" = now()
        WHERE id = ${ticketId} AND "organizationId" = ${orgId}
      `;
      await recordTicketAudit(tx, orgId, {
        ticketId,
        actorType: "USER",
        actorUserId: userId,
        action: "WOKEN",
        before: { snoozedUntil: row.snoozedUntil.toISOString() },
        after: { snoozedUntil: null },
      });

      if (hooks.beforeCommit) await hooks.beforeCommit(tx);
      return { ok: true as const, ticketId };
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof SnoozeError) return { ok: false, error: err.code };
    throw err;
  }
}
