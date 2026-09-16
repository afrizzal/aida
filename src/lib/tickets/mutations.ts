// The ONE ticket mutation service (Phase 11, D-07 and D-08). Assign, set status, set priority,
// add tag and remove tag all run here, for one ticket (the ticket page's actions, mode "single")
// or for up to 100 tickets (the inbox bulk bar, mode "bulk"), inside one interactive transaction
// that writes exactly one TicketAuditEvent per ticket.
//
// Order inside the transaction, always:
//   1. hooks.onTransactionStart (test seam only)
//   2. the actor's member row (findActiveMembership), refused with MEMBERSHIP_ENDED (D-01)
//   3. the operation's references (assignee membership, tag in the organization)
//   4. one SELECT … WHERE "organizationId" = actor org ORDER BY id FOR UPDATE over every ticket
//   5. per locked ticket, in id order: apply, audit, hooks.afterItem (test seam only)
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
import type { Prisma, TicketPriority, TicketStatus } from "../../generated/prisma/client";
import { prisma } from "../db";
import { findActiveMembership } from "../membership";
import { computeDueTimestamps, DEFAULT_SLA_TARGETS, type SlaTargets } from "./sla";
import type { TicketAuditSnapshot } from "./ticket-audit";
import { recordTicketAudit } from "./ticket-audit";

/** The most unique ticket ids one call may change (D-08). */
export const MAX_BULK_TICKETS = 100;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

const TICKET_STATUSES = [
  "NEW",
  "OPEN",
  "PENDING",
  "RESOLVED",
  "CLOSED",
] as const satisfies readonly TicketStatus[];
const TICKET_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const satisfies readonly TicketPriority[];
const TERMINAL_STATUSES: readonly TicketStatus[] = ["RESOLVED", "CLOSED"];

export type TicketOp =
  | { kind: "assign"; assigneeId: string | null }
  | { kind: "status"; status: TicketStatus }
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
  | "MEMBERSHIP_ENDED";

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
}

interface LockedTicket {
  id: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  createdAt: Date;
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
    case "status":
      valid = (TICKET_STATUSES as readonly string[]).includes(op.status);
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
  | { kind: "status"; status: TicketStatus }
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
    case "status":
      return { kind: "status", status: op.status };
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

      // One statement locks every ticket in ascending id order (AIDA-48 concurrency).
      const locked = await tx.$queryRaw<LockedTicket[]>`
        SELECT id, status, priority, "assigneeId", "createdAt"
        FROM "Ticket"
        WHERE "organizationId" = ${orgId} AND id = ANY(${ids}::text[])
        ORDER BY id
        FOR UPDATE
      `;
      if (locked.length !== ids.length) throw new TicketMutationError("TICKET_UNAVAILABLE");

      // Tag links of the locked tickets, read after the lock so no other mutation changes them.
      const linked = new Set<string>();
      if (resolved.kind === "addTag" || resolved.kind === "removeTag") {
        const links = await tx.ticketTag.findMany({
          where: { tagId: resolved.tagId, ticketId: { in: ids } },
          select: { ticketId: true },
        });
        for (const link of links) linked.add(link.ticketId);
      }

      const batchId = mode === "bulk" ? randomUUID() : null;
      const now = new Date();

      for (const [index, ticket] of locked.entries()) {
        const change = await applyOp(tx, orgId, ticket, resolved, linked.has(ticket.id), now);
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
    case "status": {
      if (ticket.status !== op.status) {
        await updateTicket(
          tx,
          orgId,
          ticket.id,
          TERMINAL_STATUSES.includes(op.status)
            ? { status: op.status, resolvedAt: now, isAtRisk: false, isBreached: false }
            : { status: op.status, resolvedAt: null },
        );
      }
      return {
        action: "STATUS_CHANGED",
        before: { status: ticket.status },
        after: { status: op.status },
      };
    }
    case "priority": {
      // Parity with the previous changePriority (Codex review C2): the same seven fields in one
      // write. The sla-flag job reads both target-minute columns for its at-risk threshold.
      if (ticket.priority !== op.priority) {
        const { firstResponseDueAt, resolutionDueAt } = computeDueTimestamps(
          new Date(ticket.createdAt),
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
