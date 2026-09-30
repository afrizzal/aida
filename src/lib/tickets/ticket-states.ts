// Ticket states (Phase 12.1, AIDA-56, D-03 to D-05, D-15 amended, D-19): the frozen lock
// protocol, the shared state reads and the audit shape every later plan uses.
//
// Lock protocol (D-15 amended; frozen for every plan of Phase 12.1):
//   1. Locks are taken in the order TicketStateConfig, then TicketState, then Ticket rows in
//      ascending id (through lockTicketsInIdOrder in merge.ts or one statement ORDER BY id
//      FOR UPDATE). Never the other way round.
//   2. A writer that uses a role (create, reopen, auto-close, merge) takes readStateConfigForShare
//      and then shareLockActiveState on the role state before any ticket lock. Create does so as
//      the first two statements of its transaction (review C7).
//   3. An agent writer (single or bulk state change) takes shareLockActiveState on its target
//      state before the ticket lock, and refuses when it returns null (soft-deleted, missing or
//      another organization's state).
//   4. Admin operations take the configuration row FOR UPDATE first, then the state rows they
//      change FOR UPDATE in ascending id; deletion then moves tickets and roles to the same-group
//      replacement and sets deletedAt (K41, K42).
//   5. No statement that locks rows joins TicketState: a ticket lock locks only ticket rows
//      (a join under FOR UPDATE would also lock the state row; use FOR UPDATE OF the ticket alias
//      when a join is unavoidable).
//   6. A batch job that updates many tickets (the sla-flag worker, plan 12.1-06) locks its
//      candidates in one statement ordered by id with FOR UPDATE OF the ticket alias SKIP LOCKED
//      and then updates only the ids it locked, so it never waits on a ticket lock and cannot
//      close a deadlock cycle with a bulk mutation that waits in ascending id (review C6).
//
// Audit contract (D-11 amended, K42): a state change writes before and after as the flat
// snapshot { stateId, stateGroup } built by stateAuditSnapshot. No state name or other free text
// enters TicketAuditEvent.
//
// Every raw statement carries the organizationId term and quotes "group" (a reserved word).
// Relative imports only: the worker bundles callers of this module.
import type { TicketStateGroup } from "../../generated/prisma/client";
import type { TicketAuditSnapshot } from "./ticket-audit";

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

/** The legacy status key of the five migrated or default states (old URLs only, D-09). */
export type LegacyStatusKey = "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";

export const LEGACY_STATUS_KEYS: readonly LegacyStatusKey[] = [
  "NEW",
  "OPEN",
  "PENDING",
  "RESOLVED",
  "CLOSED",
];

/**
 * Reads the group of each given state id of the organization, soft-deleted states included,
 * without a lock. Ids of another organization and unknown ids are absent from the map.
 */
export async function readStateGroups(
  tx: StateQueryClient,
  orgId: string,
  stateIds: readonly string[],
): Promise<Map<string, StateGroup>> {
  const unique = [...new Set(stateIds)];
  if (unique.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; group: StateGroup }[]>`
    SELECT id, "group"::text AS "group"
    FROM "TicketState"
    WHERE "organizationId" = ${orgId} AND id = ANY(${unique}::text[])
  `;
  return new Map(rows.map((r) => [r.id, r.group]));
}

/** One active state as pickers, chips and filters show it. */
export interface ActiveStateRow {
  id: string;
  name: string;
  colorToken: string;
  group: StateGroup;
  sortOrder: number;
}

/**
 * The organization's active states ordered by group (enum order OPEN, PENDING, RESOLVED,
 * CLOSED), then sortOrder, then id in code-unit order (stable for equal sortOrder). The ORDER BY
 * names the table columns: the bare output alias "group" is text and would sort alphabetically.
 */
export async function listActiveStates(
  client: StateQueryClient,
  orgId: string,
): Promise<ActiveStateRow[]> {
  const rows = await client.$queryRaw<ActiveStateRow[]>`
    SELECT id, name, "colorToken", "group"::text AS "group", "sortOrder"
    FROM "TicketState"
    WHERE "organizationId" = ${orgId} AND "deletedAt" IS NULL
    ORDER BY "TicketState"."group", "TicketState"."sortOrder", "TicketState".id COLLATE "C"
  `;
  return rows.map((r) => ({ ...r, sortOrder: Number(r.sortOrder) }));
}

/**
 * The ids of the organization's active states keyed by legacy key (NEW to CLOSED); a key whose
 * state is soft-deleted or absent maps to null. Used only to map old URLs and fixtures (D-09).
 */
export async function readLegacyStateIds(
  client: StateQueryClient,
  orgId: string,
): Promise<Record<LegacyStatusKey, string | null>> {
  const rows = await client.$queryRaw<{ id: string; legacyStatus: LegacyStatusKey }[]>`
    SELECT id, "legacyStatus"
    FROM "TicketState"
    WHERE "organizationId" = ${orgId} AND "deletedAt" IS NULL AND "legacyStatus" IS NOT NULL
  `;
  const result: Record<LegacyStatusKey, string | null> = {
    NEW: null,
    OPEN: null,
    PENDING: null,
    RESOLVED: null,
    CLOSED: null,
  };
  for (const row of rows) result[row.legacyStatus] = row.id;
  return result;
}

/** The flat audit snapshot of a ticket's state (D-11 amended, K42): ids and enum values only. */
export function stateAuditSnapshot(stateId: string, group: StateGroup): TicketAuditSnapshot {
  return { stateId, stateGroup: group };
}
