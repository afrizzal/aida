// The ONE ticket mutation service (Phase 11, D-07 and D-08). Assign, set state, set priority,
// add tag and remove tag all run here, for one ticket (the ticket page's actions, mode "single")
// or for up to 100 tickets (the inbox bulk bar, mode "bulk"), inside one interactive transaction
// that writes exactly one TicketAuditEvent per ticket.
//
// Order inside the transaction, always:
//   1. hooks.onTransactionStart (test seam only)
//   2. the actor's member row (findActiveMembership), refused with MEMBERSHIP_ENDED (D-01)
//   3. the operation's references (assignee membership, tag in the organization; for a state
//      change the target state read FOR SHARE with shareLockActiveState, refused with
//      STATE_NOT_FOUND when it is missing, soft-deleted or another organization's: D-15 amended,
//      the state lock always precedes the ticket lock)
//   4. one SELECT … FROM "Ticket" WHERE "organizationId" = actor org ORDER BY id FOR UPDATE over
//      every ticket: one statement on the ticket table alone (no join, so no state row is
//      locked), locking in ascending id and waiting for rows held by others. The sla-flag worker
//      locks with SKIP LOCKED and never waits, so it cannot form a deadlock cycle with this
//      statement (proven by the two-ticket races of plan 12.1-06 Task 3, review C6). Keep this
//      order: those races depend on it. The statement is not lockTicketsInIdOrder because it
//      also needs priority, assigneeId, createdAt and the SLA columns.
//   5. a state change refuses the whole payload with MERGED_SOURCE when any locked ticket is a
//      merged source (Phase 12, D-07, D-08; Codex diff critique round 1, D1)
//   6. the current groups of the locked tickets (readStateGroups), then `now`, read after the
//      lock (hooks.clock in tests, D-16, D-17)
//   7. per locked ticket, in id order: apply, audit, hooks.afterItem (test seam only)
//
// A state change goes through applyStateTransition (state-transition.ts): lifecycle effects
// (resolvedAt, flags, SLA pause) fire only when the group changes (D-11, D-16). Its audit row is
// STATUS_CHANGED with before and after equal to stateAuditSnapshot ({ stateId, stateGroup }).
//
// Error contract (Codex review C5): a TicketMutationError rolls the transaction back and is
// RETURNED as { ok: false, error: code }. Any other error (database, or one thrown by a test
// hook) rolls the transaction back and is RETHROWN unchanged.
//
// Membership guarantee (Codex review C7): the member row is a plain read before any reference
// check, lock or write. A removal committed before that read refuses the mutation. A removal
// committed after it neither blocks nor undoes the mutation, which completes as the last act of
// a member who was active when it was authorized. Nothing stronger is claimed.
//
// Privacy (AIDA-48): audit before/after carry ids, enum values and booleans only.
//
// Relative imports only and no Next.js import: cache revalidation belongs to the server actions,
// after this function returned success.
import { randomUUID } from "node:crypto";
import type { Prisma, TicketPriority } from "../../generated/prisma/client";
import { prisma } from "../db";
import { findActiveMembership } from "../membership";
import { DEFAULT_SLA_TARGETS, type SlaTargets } from "./sla";
import { applyStateTransition, pausedDueTimestamps } from "./state-transition";
import type { TicketAuditSnapshot } from "./ticket-audit";
import { recordTicketAudit } from "./ticket-audit";
import {
  readStateGroups,
  type StateGroup,
  shareLockActiveState,
  stateAuditSnapshot,
} from "./ticket-states";

/** The most unique ticket ids one call may change (D-08). */
export const MAX_BULK_TICKETS = 100;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

const TICKET_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const satisfies readonly TicketPriority[];
/** The longest state id accepted (ids are cuid or uuid strings; this only refuses absurd input). */
const MAX_STATE_ID_LENGTH = 128;

export type TicketOp =
  | { kind: "assign"; assigneeId: string | null }
  | { kind: "state"; stateId: string }
  | { kind: "priority"; priority: TicketPriority }
  | { kind: "addTag"; tagId: string }
  /** Find-or-create by name, then add. Used only by the ticket page's single addTag action. */
  | { kind: "addTagByName"; name: string }
  | { kind: "removeTag"; tagId: string };

export interface TicketMutationActor {
  userId: string;
  orgId: string;
}

export type TicketMutationErrorCode =
  | "INVALID"
  | "TOO_MANY"
  | "TICKET_UNAVAILABLE"
  | "MEMBER_NOT_ACTIVE"
  | "TAG_MISSING"
  | "MEMBERSHIP_ENDED"
  | "MERGED_SOURCE"
  | "STATE_NOT_FOUND";

/** A refusal by the service. Rolled back and returned, never rethrown. */
export class TicketMutationError extends Error {
  readonly code: TicketMutationErrorCode;

  constructor(code: TicketMutationErrorCode) {
    super(`Ticket mutation refused: ${code}`);
    this.name = "TicketMutationError";
    this.code = code;
  }
}

export type TicketMutationResult =
  | { ok: true; count: number; batchId: string | null }
  | { ok: false; error: TicketMutationErrorCode };

export interface TicketMutationInput {
  actor: TicketMutationActor;
  ticketIds: readonly string[];
  op: TicketOp;
  mode: "single" | "bulk";
}

/** Test seams. Production callers never pass them. */
export interface TicketMutationHooks {
  /** Awaited as the very first step inside the transaction. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited after each ticket was changed and audited (D-09). */
  afterItem?(tx: Prisma.TransactionClient, ticketId: string, index: number): Promise<void> | void;
  /** The effective time, read once after the ticket lock (D-17). Defaults to new Date(). */
  clock?(): Date;
}

interface LockedTicket {
  id: string;
  stateId: string;
  priority: TicketPriority;
  assigneeId: string | null;
  createdAt: Date;
  mergedIntoTicketId: string | null;
  slaPausedAt: Date | null;
  slaPausedMs: bigint;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Checks that need no database. Throws INVALID or TOO_MANY. Returns the unique ids. */
function validateInput(ticketIds: readonly string[], op: TicketOp): string[] {
  if (!Array.isArray(ticketIds) || !ticketIds.every(isNonEmptyString)) {
    throw new TicketMutationError("INVALID");
  }
  const ids = [...new Set(ticketIds)];
  if (ids.length === 0) throw new TicketMutationError("INVALID");
  if (ids.length > MAX_BULK_TICKETS) throw new TicketMutationError("TOO_MANY");

  let valid: boolean;
  switch (op?.kind) {
    case "assign":
      valid = op.assigneeId === null || isNonEmptyString(op.assigneeId);
      break;
    case "state":
      valid = isNonEmptyString(op.stateId) && op.stateId.length <= MAX_STATE_ID_LENGTH;
      break;
    case "priority":
      valid = (TICKET_PRIORITIES as readonly string[]).includes(op.priority);
      break;
    case "addTag":
    case "removeTag":
      valid = isNonEmptyString(op.tagId);
      break;
    case "addTagByName":
      valid = typeof op.name === "string" && op.name.trim().length > 0;
      break;
    default:
      valid = false;
  }
  if (!valid) throw new TicketMutationError("INVALID");
  return ids;
}

/** The operation with its references resolved once for the whole payload. */
type ResolvedOp =
  | { kind: "assign"; assigneeId: string | null }
  | { kind: "state"; stateId: string; group: StateGroup }
  | { kind: "priority"; priority: TicketPriority; targets: SlaTargets }
  | { kind: "addTag"; tagId: string }
  | { kind: "removeTag"; tagId: string };

/**
 * Validates the operation's references inside the transaction, after the actor's membership
 * check and before the ticket lock (D-08). addTagByName finds or creates its tag here, so any
 * later refusal or failure rolls the new tag back with everything else (Codex review C1).
 */
async function resolveOp(
  tx: Prisma.TransactionClient,
  orgId: string,
  op: TicketOp,
): Promise<ResolvedOp> {
  switch (op.kind) {
    case "assign": {
      if (op.assigneeId !== null) {
        const assignee = await findActiveMembership(tx, op.assigneeId, orgId);
        if (!assignee) throw new TicketMutationError("MEMBER_NOT_ACTIVE");
      }
      return { kind: "assign", assigneeId: op.assigneeId };
    }
    case "state": {
      // D-15 amended: the target state is share-locked before any ticket lock, so a concurrent
      // soft delete either waits for this transaction or is seen here as gone.
      const state = await shareLockActiveState(tx, orgId, op.stateId);
      if (!state) throw new TicketMutationError("STATE_NOT_FOUND");
      return { kind: "state", stateId: state.id, group: state.group };
    }
    case "priority": {
      // Explicit organization predicate: tx is unscoped, so getSlaTargets (which relies on
      // scopedDb for the filter) must not be used here. Same fallback as getSlaTargets.
      const policy = await tx.slaPolicy.findFirst({
        where: { organizationId: orgId, priority: op.priority },
        select: { firstResponseTargetMinutes: true, resolutionTargetMinutes: true },
      });
      const targets: SlaTargets = policy
        ? {
            firstResponseMinutes: policy.firstResponseTargetMinutes,
            resolutionMinutes: policy.resolutionTargetMinutes,
          }
        : DEFAULT_SLA_TARGETS[op.priority];
      return { kind: "priority", priority: op.priority, targets };
    }
    case "addTag":
    case "removeTag": {
      const tag = await tx.tag.findFirst({
        where: { id: op.tagId, organizationId: orgId },
        select: { id: true },
      });
      if (!tag) throw new TicketMutationError("TAG_MISSING");
      return { kind: op.kind, tagId: tag.id };
    }
    case "addTagByName": {
      const name = op.name.trim();
      // ON CONFLICT DO NOTHING: a concurrent creator of the same name makes this INSERT wait
      // for that transaction, then either skip (it committed) or insert (it rolled back). The
      // read below is a new statement and sees whichever row now exists.
      await tx.$executeRaw`
        INSERT INTO "Tag" (id, "organizationId", name)
        VALUES (${randomUUID()}, ${orgId}, ${name})
        ON CONFLICT ("organizationId", name) DO NOTHING
      `;
      const tag = await tx.tag.findFirst({
        where: { organizationId: orgId, name },
        select: { id: true },
      });
      if (!tag) throw new TicketMutationError("TAG_MISSING");
      return { kind: "addTag", tagId: tag.id };
    }
  }
}

/**
 * Applies one operation to every listed ticket of the actor's organization, all or nothing,
 * with one TicketAuditEvent per ticket. Returns { ok: true, count, batchId } or
 * { ok: false, error }; rethrows any error that is not a TicketMutationError.
 */
export async function runTicketMutation(
  { actor, ticketIds, op, mode }: TicketMutationInput,
  hooks: TicketMutationHooks = {},
): Promise<TicketMutationResult> {
  try {
    const ids = validateInput(ticketIds, op);
    const { orgId, userId } = actor;

    return await prisma.$transaction(async (tx) => {
      if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);

      // D-01: the actor must still be a member, read inside this transaction.
      const membership = await findActiveMembership(tx, userId, orgId);
      if (!membership) throw new TicketMutationError("MEMBERSHIP_ENDED");

      const resolved = await resolveOp(tx, orgId, op);

      // One statement on the ticket table alone locks every ticket in ascending id order
      // (AIDA-48 concurrency; header step 4).
      const locked = await tx.$queryRaw<LockedTicket[]>`
        SELECT id, "stateId", priority, "assigneeId", "createdAt", "mergedIntoTicketId",
          "slaPausedAt", "slaPausedMs", "firstResponseDueAt", "resolutionDueAt"
        FROM "Ticket"
        WHERE "organizationId" = ${orgId} AND id = ANY(${ids}::text[])
        ORDER BY id
        FOR UPDATE
      `;
      if (locked.length !== ids.length) throw new TicketMutationError("TICKET_UNAVAILABLE");

      // A merged source stays closed (D-07, D-08): reopening it would put it back in the inbox
      // while its conversation, replies and CSAT live on the target. Read from the locked rows,
      // so a state change that waited on a merge's lock sees the committed merge and is
      // refused. Assignee, priority and tags stay changeable: they stay on the source (D-08).
      if (resolved.kind === "state" && locked.some((t) => t.mergedIntoTicketId !== null)) {
        throw new TicketMutationError("MERGED_SOURCE");
      }

      // Tag links of the locked tickets, read after the lock so no other mutation changes them.
      const linked = new Set<string>();
      if (resolved.kind === "addTag" || resolved.kind === "removeTag") {
        const links = await tx.ticketTag.findMany({
          where: { tagId: resolved.tagId, ticketId: { in: ids } },
          select: { ticketId: true },
        });
        for (const link of links) linked.add(link.ticketId);
      }

      // The current group of every locked ticket's state, read after the lock (the stateId
      // cannot change under it). The composite foreign key guarantees each id is present.
      const groups =
        resolved.kind === "state"
          ? await readStateGroups(
              tx,
              orgId,
              locked.map((t) => t.stateId),
            )
          : new Map<string, StateGroup>();

      const batchId = mode === "bulk" ? randomUUID() : null;
      // Read after the ticket lock (D-16): a transition that waited measures from when it runs.
      const now = hooks.clock ? hooks.clock() : new Date();

      for (const [index, ticket] of locked.entries()) {
        const change = await applyOp(
          tx,
          orgId,
          ticket,
          resolved,
          linked.has(ticket.id),
          now,
          groups,
        );
        await recordTicketAudit(tx, orgId, {
          ticketId: ticket.id,
          action: change.action,
          before: change.before,
          after: change.after,
          actorType: "USER",
          actorUserId: userId,
          batchId,
        });
        if (hooks.afterItem) await hooks.afterItem(tx, ticket.id, index);
      }

      return { ok: true as const, count: locked.length, batchId };
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof TicketMutationError) return { ok: false, error: err.code };
    throw err;
  }
}

interface AppliedChange {
  action: "ASSIGNEE_CHANGED" | "STATUS_CHANGED" | "PRIORITY_CHANGED" | "TAG_ADDED" | "TAG_REMOVED";
  before: TicketAuditSnapshot;
  after: TicketAuditSnapshot;
}

/**
 * Applies op to one locked ticket with the same side effects as the previous single actions.
 * A no-op (D-08) writes nothing to the ticket and reports before equal to after.
 */
async function applyOp(
  tx: Prisma.TransactionClient,
  orgId: string,
  ticket: LockedTicket,
  op: ResolvedOp,
  tagLinked: boolean,
  now: Date,
  groups: ReadonlyMap<string, StateGroup>,
): Promise<AppliedChange> {
  switch (op.kind) {
    case "assign": {
      if (ticket.assigneeId !== op.assigneeId) {
        await updateTicket(tx, orgId, ticket.id, { assigneeId: op.assigneeId });
      }
      return {
        action: "ASSIGNEE_CHANGED",
        before: { assigneeId: ticket.assigneeId },
        after: { assigneeId: op.assigneeId },
      };
    }
    case "state": {
      const fromGroup = groups.get(ticket.stateId);
      if (!fromGroup) throw new TicketMutationError("TICKET_UNAVAILABLE");
      if (ticket.stateId !== op.stateId) {
        const count = await applyStateTransition(tx, orgId, {
          row: ticket,
          fromGroup,
          toStateId: op.stateId,
          toGroup: op.group,
          now,
          policy: "by-group",
        });
        if (count !== 1) throw new TicketMutationError("TICKET_UNAVAILABLE");
      }
      // A no-op (same state) writes before equal to after, as the Phase 11 contract requires.
      return {
        action: "STATUS_CHANGED",
        before: stateAuditSnapshot(ticket.stateId, fromGroup),
        after: stateAuditSnapshot(op.stateId, op.group),
      };
    }
    case "priority": {
      // Parity with the previous changePriority (Codex review C2): the same seven fields in one
      // write. The sla-flag job reads both target-minute columns for its at-risk threshold.
      // The deadlines count the closed pauses (slaPausedMs); an open pause is added when it
      // closes (D-16).
      if (ticket.priority !== op.priority) {
        const { firstResponseDueAt, resolutionDueAt } = pausedDueTimestamps(
          new Date(ticket.createdAt),
          BigInt(ticket.slaPausedMs),
          op.targets.firstResponseMinutes,
          op.targets.resolutionMinutes,
        );
        await updateTicket(tx, orgId, ticket.id, {
          priority: op.priority,
          firstResponseTargetMinutes: op.targets.firstResponseMinutes,
          resolutionTargetMinutes: op.targets.resolutionMinutes,
          firstResponseDueAt,
          resolutionDueAt,
          isAtRisk: false,
          isBreached: false,
        });
      }
      return {
        action: "PRIORITY_CHANGED",
        before: { priority: ticket.priority },
        after: { priority: op.priority },
      };
    }
    case "addTag": {
      // TicketTag is a join table without organizationId: the ticket was locked under the
      // organization predicate and the tag was checked against it above.
      if (!tagLinked) {
        await tx.ticketTag.create({ data: { ticketId: ticket.id, tagId: op.tagId } });
      }
      return {
        action: "TAG_ADDED",
        before: { tagId: op.tagId, present: tagLinked },
        after: { tagId: op.tagId, present: true },
      };
    }
    case "removeTag": {
      if (tagLinked) {
        await tx.ticketTag.delete({
          where: { ticketId_tagId: { ticketId: ticket.id, tagId: op.tagId } },
        });
      }
      return {
        action: "TAG_REMOVED",
        before: { tagId: op.tagId, present: tagLinked },
        after: { tagId: op.tagId, present: false },
      };
    }
  }
}

/** One ticket write, always with the organization predicate. */
async function updateTicket(
  tx: Prisma.TransactionClient,
  orgId: string,
  ticketId: string,
  data: Prisma.TicketUncheckedUpdateManyInput,
): Promise<void> {
  const { count } = await tx.ticket.updateMany({
    where: { id: ticketId, organizationId: orgId },
    data,
  });
  if (count !== 1) throw new TicketMutationError("TICKET_UNAVAILABLE");
}
