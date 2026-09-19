// The relations service (Phase 12, AIDA-52, D-03 to D-06). Adds, removes and lists typed links
// between two tickets of one organization. Each write runs in ONE interactive transaction, in
// ONE lock order (Codex review C5):
//   1. hooks.onTransactionStart (test seam only)
//   2. the actor's member row (findActiveMembership), refused with MEMBERSHIP_ENDED (D-01)
//   3. CHILD_OF inserts only: pg_advisory_xact_lock keyed on the organization (D-05)
//   4. both ticket rows SELECT … FOR UPDATE in id order, under the actor's organization
//   5. hooks.afterLock (test seam only)
//   6. validation (CHILD_OF: parent check, bounded ancestor walk), then the write and the audit
//   7. hooks.beforeCommit (test seam only)
//
// "One parent per child" is a technical choice of D-05 to keep the hierarchy explainable; it is
// not a scope cut of AIDA-52. TicketRelation_one_parent_key is the database's second guard.
//
// Error contract (as 11-02): a RelationError rolls back and is RETURNED as { ok: false, error }.
// Any other error (database, or one thrown by a test hook) rolls back and is RETHROWN unchanged.
// Uniqueness of a pair is decided by TicketRelation_pair_key, never by a pre-check.
//
// Privacy (D-21): audit before/after carry ids and enum values only.
//
// Relative imports only and no Next.js import: revalidation belongs to the server actions.
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { findActiveMembership } from "../membership";
import { scopedDb } from "../scoped-db";
import {
  LINK_CHOICES,
  type RelationLabel,
  type RelationType,
  relationLabel,
  relationSideFor,
  sortRelationChips,
} from "./relation-pairs";
import { recordTicketAudit } from "./ticket-audit";

/** The most ancestors of a proposed parent the CHILD_OF walk follows (review C5). */
export const ANCESTOR_WALK_LIMIT = 1000;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export type RelationErrorCode =
  | "INVALID"
  | "SELF"
  | "ALREADY_LINKED"
  | "PARENT_EXISTS"
  | "CYCLE"
  | "TICKET_UNAVAILABLE"
  | "MERGE_LINK"
  | "ALREADY_REMOVED"
  | "HIERARCHY_TOO_DEEP"
  | "MEMBERSHIP_ENDED";

/** A refusal by the service. Rolled back and returned, never rethrown. */
export class RelationError extends Error {
  readonly code: RelationErrorCode;

  constructor(code: RelationErrorCode) {
    super(`Ticket relation refused: ${code}`);
    this.name = "RelationError";
    this.code = code;
  }
}

export interface RelationActor {
  userId: string;
  orgId: string;
}

/** Test seams. Production callers never pass them. */
export interface RelationHooks {
  /** Awaited as the very first step inside the transaction. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited after the advisory lock (CHILD_OF inserts) and both ticket row locks. */
  afterLock?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited after the last write, just before the transaction commits. */
  beforeCommit?(tx: Prisma.TransactionClient): Promise<void> | void;
}

export type AddRelationResult =
  | { ok: true; relationId: string; ticketIds: [string, string] }
  | { ok: false; error: RelationErrorCode };

export type RemoveRelationResult =
  | { ok: true; ticketIds: [string, string] }
  | { ok: false; error: RelationErrorCode };

export interface AddRelationInput {
  ticketId: string;
  otherTicketId: string;
  /** The label of one LINK_CHOICES entry, read from ticketId's side. */
  choice: string;
}

export interface AddRelationOptions {
  /** Test-only override of ANCESTOR_WALK_LIMIT. */
  ancestorWalkLimit?: number;
}

interface LockedTicket {
  id: string;
  mergedIntoTicketId: string | null;
}

interface RelationRow {
  id: string;
  type: RelationType;
  fromTicketId: string;
  toTicketId: string;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Locks both tickets of the organization in id order; refuses when either is missing. */
async function lockPair(
  tx: Prisma.TransactionClient,
  orgId: string,
  a: string,
  b: string,
): Promise<Map<string, LockedTicket>> {
  const rows = await tx.$queryRaw<LockedTicket[]>`
    SELECT id, "mergedIntoTicketId"
    FROM "Ticket"
    WHERE "organizationId" = ${orgId} AND id = ANY(${[a, b]}::text[])
    ORDER BY id
    FOR UPDATE
  `;
  if (rows.length !== 2) throw new RelationError("TICKET_UNAVAILABLE");
  return new Map(rows.map((row) => [row.id, row]));
}

/** The name of the unique index a Postgres 23505 names, or null for any other error. */
function violatedIndex(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; meta?: unknown; message?: unknown };
  const text = `${String(e.message ?? "")} ${JSON.stringify(e.meta ?? {})}`;
  const unique =
    e.code === "P2002" ||
    e.code === "23505" ||
    /23505|UniqueConstraintViolation|duplicate key value/.test(text);
  if (!unique) return null;
  if (text.includes("TicketRelation_one_parent_key")) return "TicketRelation_one_parent_key";
  if (text.includes("TicketRelation_pair_key")) return "TicketRelation_pair_key";
  return "unknown";
}

/**
 * Walks the ancestors of parentId (parentId itself not counted; its own parent is depth 1) and
 * refuses CYCLE when childId is among them up to the limit, otherwise HIERARCHY_TOO_DEEP when an
 * ancestor at depth limit + 1 exists. One recursive CTE, bounded by its depth column.
 */
async function checkAncestors(
  tx: Prisma.TransactionClient,
  orgId: string,
  childId: string,
  parentId: string,
  limit: number,
): Promise<void> {
  const rows = await tx.$queryRaw<{ cycle: boolean; tooDeep: boolean }[]>`
    WITH RECURSIVE ancestors(id, depth) AS (
      SELECT r."toTicketId", 1
      FROM "TicketRelation" r
      WHERE r."organizationId" = ${orgId}
        AND r.type = 'CHILD_OF'::"TicketRelationType"
        AND r."fromTicketId" = ${parentId}
      UNION ALL
      SELECT r."toTicketId", a.depth + 1
      FROM "TicketRelation" r
      JOIN ancestors a ON r."fromTicketId" = a.id
      WHERE r."organizationId" = ${orgId}
        AND r.type = 'CHILD_OF'::"TicketRelationType"
        AND a.depth <= ${limit}::int
    )
    SELECT
      EXISTS (SELECT 1 FROM ancestors WHERE id = ${childId} AND depth <= ${limit}::int) AS cycle,
      EXISTS (SELECT 1 FROM ancestors WHERE depth > ${limit}::int) AS "tooDeep"
  `;
  if (rows[0]?.cycle) throw new RelationError("CYCLE");
  if (rows[0]?.tooDeep) throw new RelationError("HIERARCHY_TOO_DEEP");
}

/**
 * Links ticketId and otherTicketId with the chosen LINK_CHOICES entry. Writes one
 * TicketRelation row and RELATION_ADDED on both tickets, or returns a refusal code.
 */
export async function addRelation(
  client: PrismaClient,
  actor: RelationActor,
  { ticketId, otherTicketId, choice }: AddRelationInput,
  hooks: RelationHooks = {},
  options: AddRelationOptions = {},
): Promise<AddRelationResult> {
  try {
    const linkChoice = LINK_CHOICES.find((c) => c.label === choice);
    if (!linkChoice || !isNonEmptyString(ticketId) || !isNonEmptyString(otherTicketId)) {
      throw new RelationError("INVALID");
    }
    if (ticketId === otherTicketId) throw new RelationError("SELF");
    const [fromTicketId, toTicketId] =
      linkChoice.direction === "this-to-other"
        ? [ticketId, otherTicketId]
        : [otherTicketId, ticketId];
    const type = linkChoice.type;
    const limit = options.ancestorWalkLimit ?? ANCESTOR_WALK_LIMIT;
    const { orgId, userId } = actor;

    return await client.$transaction(async (tx) => {
      if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);

      const membership = await findActiveMembership(tx, userId, orgId);
      if (!membership) throw new RelationError("MEMBERSHIP_ENDED");

      if (type === "CHILD_OF") {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended('aida:ticket-relation:child-of:' || ${orgId}, 0))::text
        `;
      }

      await lockPair(tx, orgId, fromTicketId, toTicketId);
      if (hooks.afterLock) await hooks.afterLock(tx);

      if (type === "CHILD_OF") {
        const parent = await tx.ticketRelation.findFirst({
          where: { organizationId: orgId, type: "CHILD_OF", fromTicketId },
          select: { id: true },
        });
        if (parent) throw new RelationError("PARENT_EXISTS");
        await checkAncestors(tx, orgId, fromTicketId, toTicketId, limit);
      }

      let relationId: string;
      try {
        const created = await tx.ticketRelation.create({
          data: { organizationId: orgId, type, fromTicketId, toTicketId, createdById: userId },
          select: { id: true },
        });
        relationId = created.id;
      } catch (err) {
        const index = violatedIndex(err);
        if (index === "TicketRelation_one_parent_key") throw new RelationError("PARENT_EXISTS");
        if (index !== null) throw new RelationError("ALREADY_LINKED");
        throw err;
      }

      const after = { relationId, type, fromTicketId, toTicketId };
      for (const id of [fromTicketId, toTicketId]) {
        await recordTicketAudit(tx, orgId, {
          ticketId: id,
          action: "RELATION_ADDED",
          before: {},
          after,
          actorType: "USER",
          actorUserId: userId,
        });
      }

      if (hooks.beforeCommit) await hooks.beforeCommit(tx);
      return {
        ok: true as const,
        relationId,
        ticketIds: [fromTicketId, toTicketId] as [string, string],
      };
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof RelationError) return { ok: false, error: err.code };
    throw err;
  }
}

export interface RemoveRelationInput {
  /** The ticket the agent acts from; must be one of the relation's two ends. */
  ticketId: string;
  relationId: string;
}

/**
 * Removes one relation and writes RELATION_REMOVED on both tickets. The decision is taken from a
 * re-read of the relation under both row locks (review C10), so a relation removed or replaced
 * meanwhile returns ALREADY_REMOVED. The merge link cannot be removed (D-06).
 */
export async function removeRelation(
  client: PrismaClient,
  actor: RelationActor,
  { ticketId, relationId }: RemoveRelationInput,
  hooks: RelationHooks = {},
): Promise<RemoveRelationResult> {
  try {
    if (!isNonEmptyString(ticketId) || !isNonEmptyString(relationId)) {
      throw new RelationError("INVALID");
    }
    const { orgId, userId } = actor;

    return await client.$transaction(async (tx) => {
      if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);

      const membership = await findActiveMembership(tx, userId, orgId);
      if (!membership) throw new RelationError("MEMBERSHIP_ENDED");

      // Only to learn the two ticket ids to lock; nothing is decided from this read.
      const first = await tx.ticketRelation.findFirst({
        where: { id: relationId, organizationId: orgId },
        select: { fromTicketId: true, toTicketId: true },
      });
      if (!first) throw new RelationError("ALREADY_REMOVED");
      if (ticketId !== first.fromTicketId && ticketId !== first.toTicketId) {
        throw new RelationError("TICKET_UNAVAILABLE");
      }

      const locked = await lockPair(tx, orgId, first.fromTicketId, first.toTicketId);
      if (hooks.afterLock) await hooks.afterLock(tx);

      const relation = await tx.ticketRelation.findFirst({
        where: { id: relationId, organizationId: orgId },
        select: { id: true, type: true, fromTicketId: true, toTicketId: true },
      });
      if (!relation) throw new RelationError("ALREADY_REMOVED");
      const row: RelationRow = relation;
      if (
        row.type === "DUPLICATE_OF" &&
        locked.get(row.fromTicketId)?.mergedIntoTicketId === row.toTicketId
      ) {
        throw new RelationError("MERGE_LINK");
      }

      await tx.ticketRelation.deleteMany({ where: { id: row.id, organizationId: orgId } });

      const before = {
        relationId: row.id,
        type: row.type,
        fromTicketId: row.fromTicketId,
        toTicketId: row.toTicketId,
      };
      for (const id of [row.fromTicketId, row.toTicketId]) {
        await recordTicketAudit(tx, orgId, {
          ticketId: id,
          action: "RELATION_REMOVED",
          before,
          after: {},
          actorType: "USER",
          actorUserId: userId,
        });
      }

      if (hooks.beforeCommit) await hooks.beforeCommit(tx);
      return {
        ok: true as const,
        ticketIds: [row.fromTicketId, row.toTicketId] as [string, string],
      };
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof RelationError) return { ok: false, error: err.code };
    throw err;
  }
}

export interface RelationChip {
  relationId: string;
  type: RelationType;
  label: RelationLabel;
  otherTicketId: string;
  number: number;
  subject: string;
  /** The DUPLICATE_OF a merge created (D-06); it cannot be removed. */
  locked: boolean;
}

export type ListRelationsResult =
  | { ok: true; relations: RelationChip[] }
  | { ok: false; error: "MEMBERSHIP_ENDED" };

/**
 * The relations of one ticket from its own side, sorted for the chip row. Membership first
 * (D-01), then reads through scopedDb; a relation whose other ticket is not readable in the
 * actor's organization is left out (UI-SPEC Assumption 4).
 */
export async function listRelationsForTicket(
  client: PrismaClient,
  actor: RelationActor,
  ticketId: string,
): Promise<ListRelationsResult> {
  const membership = await findActiveMembership(client, actor.userId, actor.orgId);
  if (!membership) return { ok: false, error: "MEMBERSHIP_ENDED" };

  const db = scopedDb(actor.orgId);
  const ticketSelect = {
    id: true,
    number: true,
    subject: true,
    organizationId: true,
    mergedIntoTicketId: true,
  } as const;
  const rows = await db.ticketRelation.findMany({
    where: { OR: [{ fromTicketId: ticketId }, { toTicketId: ticketId }] },
    select: {
      id: true,
      type: true,
      fromTicketId: true,
      toTicketId: true,
      fromTicket: { select: ticketSelect },
      toTicket: { select: ticketSelect },
    },
  });

  const chips: RelationChip[] = [];
  for (const row of rows) {
    const side = relationSideFor(row, ticketId);
    const other = side === "from" ? row.toTicket : row.fromTicket;
    if (!other || other.organizationId !== actor.orgId) continue;
    chips.push({
      relationId: row.id,
      type: row.type,
      label: relationLabel(row.type, side),
      otherTicketId: other.id,
      number: other.number,
      subject: other.subject,
      locked: row.type === "DUPLICATE_OF" && row.fromTicket.mergedIntoTicketId === row.toTicketId,
    });
  }
  return { ok: true, relations: sortRelationChips(chips) };
}
