// The merge service (Phase 12, AIDA-53, D-07 to D-10). Merges a source ticket into a target
// ticket of the same organization and the same contact, in ONE interactive transaction:
//   1. SELF is refused by comparing the two ids, before any query
//   2. hooks.onTransactionStart (test seam only)
//   3. the actor's member row (findActiveMembership) is the FIRST statement: MEMBERSHIP_ENDED
//      (D-01). No ticket data is read before it and there is no pre-read outside the
//      transaction (review C3), so a removed member cannot tell a merged source from an
//      unmerged one.
//   4. both ticket rows locked through lockTicketsInIdOrder (one statement, ascending id, FOR
//      UPDATE, organization predicate): TICKET_UNAVAILABLE when either is missing
//   5. hooks.afterLock (test seam only)
//   6. checks on the locked rows, in this order: SOURCE_MERGED, TARGET_MERGED,
//      SOURCE_HAS_MERGES, DIFFERENT_CONTACTS (K33). Merge chains are refused (D-07), a
//      documented limitation of this phase.
//   7. mergedAt = clock_timestamp() and mergeMessageSeq = nextval of the Message seq sequence,
//      both drawn after the two row locks (D-09 amended after review C1): every message insert
//      on an existing ticket holds that ticket's row lock, so a message with a greater seq was
//      written after the merge.
//   8. an existing link of the pair is replaced (RELATION_REMOVED on both tickets), the
//      source's messages move to the target with mergedFromTicketId = source (attachments
//      follow their message: Attachment belongs to messageId only), hooks.afterMove, the source
//      is closed with its merge fields, the DUPLICATE_OF link is inserted, and the audit rows
//      are written (STATUS_CHANGED only on a real change, WOKEN only when it was snoozed,
//      MERGED_INTO on the source, MERGED_FROM on the target, RELATION_ADDED on both only when a
//      link was replaced)
//   9. hooks.beforeCommit (test seam only)
//
// Lock-order contract (D-08, D-10): every writer that needs both a merge pair or a reply ticket
// locks Ticket rows through lockTicketsInIdOrder (or lockTicketForAgentWrite for one row), so
// the sort and the lock order are both decided by PostgreSQL and a merge and a reply never wait
// on each other in a cycle.
//
// Nothing is hard-deleted except a replaced TicketRelation row. Tags, assignee and custom field
// values stay on the source (D-08).
//
// Error contract (Phase 11 C5): a MergeError rolls back and is RETURNED as { ok: false, error }.
// Any other error (database, or one thrown by a test hook) rolls back and is RETHROWN unchanged.
//
// Privacy (D-21): audit before/after carry ids, enum values and the ISO mergedAt only.
//
// Relative imports only and no Next.js import: revalidation belongs to the server action.
import type { Prisma, PrismaClient, TicketStatus } from "../../generated/prisma/client";
import { findActiveMembership } from "../membership";
import type { RelationType } from "./relation-pairs";
import { recordTicketAudit } from "./ticket-audit";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export type MergeErrorCode =
  | "SELF"
  | "MEMBERSHIP_ENDED"
  | "TICKET_UNAVAILABLE"
  | "SOURCE_MERGED"
  | "TARGET_MERGED"
  | "SOURCE_HAS_MERGES"
  | "DIFFERENT_CONTACTS";

/** A refusal by the service. Rolled back and returned, never rethrown. */
export class MergeError extends Error {
  readonly code: MergeErrorCode;

  constructor(code: MergeErrorCode) {
    super(`Ticket merge refused: ${code}`);
    this.name = "MergeError";
    this.code = code;
  }
}

export interface MergeActor {
  userId: string;
  orgId: string;
}

export interface MergeInput {
  sourceTicketId: string;
  targetTicketId: string;
}

/** Test seams. Production callers never pass them. */
export interface MergeHooks {
  /** Awaited as the very first step inside the transaction. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited right after both ticket row locks. */
  afterLock?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited right after the source's messages moved to the target. */
  afterMove?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited after the last write, just before the transaction commits. */
  beforeCommit?(tx: Prisma.TransactionClient): Promise<void> | void;
}

export type MergeResult =
  | { ok: true; sourceTicketId: string; targetTicketId: string }
  | { ok: false; error: MergeErrorCode };

/** One row locked by lockTicketsInIdOrder. */
export interface LockedTicketRow {
  id: string;
  mergedIntoTicketId: string | null;
  contactId: string;
  status: TicketStatus;
  snoozedUntil: Date | null;
}

/** Any client that can run a tagged raw query: an interactive transaction client. */
export interface LockClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/**
 * Locks the given tickets of the organization FOR UPDATE in ascending id order, in ONE
 * statement, so PostgreSQL decides both the sort and the lock order (no JS sort on one side and
 * SQL collation on the other). Returns the locked rows in id order; a missing id or another
 * organization's id is simply absent. Every merge and every customer reply path (12-04) locks
 * through this helper (lock-order contract, D-08, D-10).
 */
export async function lockTicketsInIdOrder(
  tx: LockClient,
  orgId: string,
  ids: readonly string[],
): Promise<LockedTicketRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return tx.$queryRaw<LockedTicketRow[]>`
    SELECT id, "mergedIntoTicketId", "contactId", status::text AS status, "snoozedUntil"
    FROM "Ticket"
    WHERE "organizationId" = ${orgId} AND id = ANY(${unique}::text[])
    ORDER BY id
    FOR UPDATE
  `;
}

interface PairRelation {
  id: string;
  type: RelationType;
  fromTicketId: string;
  toTicketId: string;
}

/**
 * Merges sourceTicketId into targetTicketId (D-07, D-08). Returns { ok: true } or a refusal
 * code; any other error is rethrown after the whole transaction rolled back.
 */
export async function mergeTickets(
  client: PrismaClient,
  actor: MergeActor,
  { sourceTicketId, targetTicketId }: MergeInput,
  hooks: MergeHooks = {},
): Promise<MergeResult> {
  try {
    if (sourceTicketId === targetTicketId) throw new MergeError("SELF");
    if (
      typeof sourceTicketId !== "string" ||
      typeof targetTicketId !== "string" ||
      sourceTicketId.length === 0 ||
      targetTicketId.length === 0
    ) {
      throw new MergeError("TICKET_UNAVAILABLE");
    }
    const { orgId, userId } = actor;

    return await client.$transaction(async (tx) => {
      if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);

      // D-01 / review C3: the first statement; nothing about the tickets is read before it.
      const membership = await findActiveMembership(tx, userId, orgId);
      if (!membership) throw new MergeError("MEMBERSHIP_ENDED");

      const locked = await lockTicketsInIdOrder(tx, orgId, [sourceTicketId, targetTicketId]);
      if (hooks.afterLock) await hooks.afterLock(tx);
      const source = locked.find((row) => row.id === sourceTicketId);
      const target = locked.find((row) => row.id === targetTicketId);
      if (!source || !target) throw new MergeError("TICKET_UNAVAILABLE");

      if (source.mergedIntoTicketId !== null) throw new MergeError("SOURCE_MERGED");
      if (target.mergedIntoTicketId !== null) throw new MergeError("TARGET_MERGED");
      const received = await tx.ticket.findFirst({
        where: { organizationId: orgId, mergedIntoTicketId: sourceTicketId },
        select: { id: true },
      });
      if (received) throw new MergeError("SOURCE_HAS_MERGES");
      if (source.contactId !== target.contactId) throw new MergeError("DIFFERENT_CONTACTS");

      // D-09 amended (review C1): both markers are drawn after the two row locks.
      const clock = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const mergedAt = clock[0]?.now;
      const seqRows = await tx.$queryRaw<{ seq: bigint }[]>`
        SELECT nextval(pg_get_serial_sequence('"Message"', 'seq')) AS seq
      `;
      const mergeMessageSeq = seqRows[0]?.seq;
      if (!(mergedAt instanceof Date) || typeof mergeMessageSeq !== "bigint") {
        throw new Error("mergeTickets: could not read the merge markers");
      }
      const mergedAtIso = mergedAt.toISOString();

      // A link of the pair is replaced (the pair index allows one row per pair).
      const existing: PairRelation | null = await tx.ticketRelation.findFirst({
        where: {
          organizationId: orgId,
          OR: [
            { fromTicketId: sourceTicketId, toTicketId: targetTicketId },
            { fromTicketId: targetTicketId, toTicketId: sourceTicketId },
          ],
        },
        select: { id: true, type: true, fromTicketId: true, toTicketId: true },
      });
      if (existing) {
        await tx.ticketRelation.deleteMany({
          where: { id: existing.id, organizationId: orgId },
        });
        const before = {
          relationId: existing.id,
          type: existing.type,
          fromTicketId: existing.fromTicketId,
          toTicketId: existing.toTicketId,
        };
        for (const id of [sourceTicketId, targetTicketId]) {
          await recordTicketAudit(tx, orgId, {
            ticketId: id,
            action: "RELATION_REMOVED",
            before,
            after: {},
            actorType: "USER",
            actorUserId: userId,
          });
        }
      }

      // Move the thread. createdAt and seq are left untouched.
      await tx.message.updateMany({
        where: { organizationId: orgId, ticketId: sourceTicketId },
        data: { ticketId: targetTicketId, mergedFromTicketId: sourceTicketId },
      });
      if (hooks.afterMove) await hooks.afterMove(tx);

      const statusChanged = source.status !== "CLOSED";
      const wasTerminal = source.status === "RESOLVED";
      await tx.ticket.update({
        where: { id: sourceTicketId },
        data: {
          mergedIntoTicketId: targetTicketId,
          mergedAt,
          mergeMessageSeq,
          status: "CLOSED",
          snoozedUntil: null,
          ...(statusChanged && !wasTerminal
            ? { resolvedAt: mergedAt, isAtRisk: false, isBreached: false }
            : {}),
        },
        select: { id: true },
      });

      const created = await tx.ticketRelation.create({
        data: {
          organizationId: orgId,
          type: "DUPLICATE_OF",
          fromTicketId: sourceTicketId,
          toTicketId: targetTicketId,
          createdById: userId,
        },
        select: { id: true },
      });

      if (statusChanged) {
        await recordTicketAudit(tx, orgId, {
          ticketId: sourceTicketId,
          action: "STATUS_CHANGED",
          before: { status: source.status },
          after: { status: "CLOSED" },
          actorType: "USER",
          actorUserId: userId,
        });
      }
      if (source.snoozedUntil !== null) {
        await recordTicketAudit(tx, orgId, {
          ticketId: sourceTicketId,
          action: "WOKEN",
          before: { snoozedUntil: new Date(source.snoozedUntil).toISOString() },
          after: { snoozedUntil: null },
          actorType: "USER",
          actorUserId: userId,
        });
      }
      const mergeAfter = {
        sourceTicketId,
        targetTicketId,
        relationId: created.id,
        type: "DUPLICATE_OF",
        mergedAt: mergedAtIso,
        mergeMessageSeq: mergeMessageSeq.toString(),
      };
      await recordTicketAudit(tx, orgId, {
        ticketId: sourceTicketId,
        action: "MERGED_INTO",
        before: { mergedIntoTicketId: null },
        after: mergeAfter,
        actorType: "USER",
        actorUserId: userId,
      });
      await recordTicketAudit(tx, orgId, {
        ticketId: targetTicketId,
        action: "MERGED_FROM",
        before: {},
        after: mergeAfter,
        actorType: "USER",
        actorUserId: userId,
      });
      if (existing) {
        const after = {
          relationId: created.id,
          type: "DUPLICATE_OF",
          fromTicketId: sourceTicketId,
          toTicketId: targetTicketId,
        };
        for (const id of [sourceTicketId, targetTicketId]) {
          await recordTicketAudit(tx, orgId, {
            ticketId: id,
            action: "RELATION_ADDED",
            before: {},
            after,
            actorType: "USER",
            actorUserId: userId,
          });
        }
      }

      if (hooks.beforeCommit) await hooks.beforeCommit(tx);
      return { ok: true as const, sourceTicketId, targetTicketId };
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof MergeError) return { ok: false, error: err.code };
    throw err;
  }
}

export type AgentWriteLockResult =
  | { ok: true }
  | { ok: false; error: "MERGED_SOURCE" | "TICKET_UNAVAILABLE" };

/**
 * Locks one ticket FOR UPDATE (through lockTicketsInIdOrder, so the lock-order contract holds)
 * before an agent message is inserted on it, and refuses a merged source (MERGED_SOURCE) or a
 * ticket not in the organization (TICKET_UNAVAILABLE). Every agent message insert, and the seq
 * it draws, therefore happens under the ticket row lock (D-09 amended, review C1).
 */
export async function lockTicketForAgentWrite(
  tx: LockClient,
  orgId: string,
  ticketId: string,
): Promise<AgentWriteLockResult> {
  const [row] = await lockTicketsInIdOrder(tx, orgId, [ticketId]);
  if (!row || row.id !== ticketId) return { ok: false, error: "TICKET_UNAVAILABLE" };
  if (row.mergedIntoTicketId !== null) return { ok: false, error: "MERGED_SOURCE" };
  return { ok: true };
}

/** Test seams of the agent messages route (POST /api/tickets/{id}/messages). */
export interface AgentMessageObserver {
  /** Awaited first inside the route's transaction, before lockTicketForAgentWrite. */
  onTransactionStart?(tx: LockClient): Promise<void> | void;
  /** Awaited right after lockTicketForAgentWrite. */
  afterLock?(tx: LockClient): Promise<void> | void;
}

let agentMessageObserver: AgentMessageObserver | null = null;

/**
 * Test seam only (as setReopenObserverForTests, 11-04): lets a race test record the route
 * transaction's PID or hold it. null clears it. Production code never calls this.
 */
export function setAgentMessageObserverForTests(observer: AgentMessageObserver | null): void {
  agentMessageObserver = observer;
}

/** The observer the messages route awaits; null outside tests. */
export function getAgentMessageObserver(): AgentMessageObserver | null {
  return agentMessageObserver;
}
