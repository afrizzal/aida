// Ticket states (Phase 12.1, AIDA-56, D-03 to D-05, D-15 amended, D-19).
//
// Relative imports only: the worker bundles callers of this module.
import type { TicketStateGroup } from "../../generated/prisma/client";

/** The fixed group of a ticket state (OPEN, PENDING, RESOLVED, CLOSED). */
export type StateGroup = TicketStateGroup;

/** Any client that can run a tagged raw query: the global client or a transaction client. */
export interface StateQueryClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/** The organization's configuration row: the five role states (D-05). */
export interface StateConfigRow {
  newStateId: string;
  reopenStateId: string;
  resolveStateId: string;
  autoCloseStateId: string;
  mergeCloseStateId: string;
}

/** Thrown when an organization has no TicketStateConfig row (D-07 rules this out). */
export class StateConfigMissingError extends Error {
  constructor(orgId: string) {
    super(`TicketStateConfig missing for organization ${orgId}`);
    this.name = "StateConfigMissingError";
  }
}

/**
 * Reads the organization's configuration row FOR SHARE (first lock of every role writer).
 * Throws StateConfigMissingError when the row does not exist.
 */
export async function readStateConfigForShare(
  tx: StateQueryClient,
  orgId: string,
): Promise<StateConfigRow> {
  const rows = await tx.$queryRaw<StateConfigRow[]>`
    SELECT "newStateId", "reopenStateId", "resolveStateId", "autoCloseStateId", "mergeCloseStateId"
    FROM "TicketStateConfig"
    WHERE "organizationId" = ${orgId}
    FOR SHARE
  `;
  const row = rows[0];
  if (!row) throw new StateConfigMissingError(orgId);
  return row;
}

/**
 * Locks an active state of the organization FOR SHARE and returns its id and group, or null
 * when the state is missing, soft-deleted or belongs to another organization. A soft delete takes
 * a non-key update lock that the foreign key's key-share lock does not wait for, so every writer
 * that sets a ticket's stateId takes this explicit share lock first (D-15 amended).
 */
export async function shareLockActiveState(
  tx: StateQueryClient,
  orgId: string,
  stateId: string,
): Promise<{ id: string; group: StateGroup } | null> {
  const rows = await tx.$queryRaw<{ id: string; group: StateGroup }[]>`
    SELECT id, "group"::text AS "group"
    FROM "TicketState"
    WHERE id = ${stateId} AND "organizationId" = ${orgId} AND "deletedAt" IS NULL
    FOR SHARE
  `;
  return rows[0] ?? null;
}
