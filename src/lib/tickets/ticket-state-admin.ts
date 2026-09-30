// The admin service behind AIDA-97 (Phase 12.1, D-01, D-03, D-05, D-06, D-12, D-14, D-15
// amended, K40, K41, K42): create, rename, recolour, reorder, set the default and delete a ticket
// state, plus the settings list.
//
// Admin gate (D-01): every operation runs in one transaction whose first statement (after the
// onTransactionStart test seam) is findActiveMembership (MEMBERSHIP_ENDED), followed by
// isAdminRole on the exact role (NOT_ALLOWED). The settings list checks membership only: members
// read it, only admins change it.
//
// Lock protocol (D-15 amended, frozen in ticket-states.ts):
//   1. the organization's TicketStateConfig row FOR UPDATE (every admin operation, so admin
//      operations of one organization run one at a time, and a role writer that holds the
//      config share lock, such as a customer reply, finishes first);
//   2. the state rows the operation changes FOR UPDATE in ascending id (a state that is only
//      referenced, such as a replacement or a new default, is locked FOR SHARE through
//      shareLockActiveState);
//   3. ticket rows through lockTicketsInIdOrder (ascending id, Ticket table alone).
//
// Soft delete (K42): deleting a state moves every ticket of it to a same-group replacement
// (K41: fromGroup equals toGroup, so only stateId changes) in one set-based UPDATE, writes one
// STATUS_CHANGED audit row per ticket sharing one batchId in one INSERT ... SELECT (review
// WR-a2-1), re-points every role column that held it, and then sets deletedAt. The row stays, so foreign keys and history keep resolving. A
// soft-deleted state, an unknown id and another organization's id are all STATE_NOT_FOUND.
//
// Error contract: a refusal is thrown as StateAdminError inside the transaction (rolling it
// back) and RETURNED as { ok: false, error }. Any other error is rethrown unchanged.
//
// Privacy (K42): audit rows carry the flat { stateId, stateGroup } snapshot only, never a name.
//
// Relative imports only and no Next.js import: revalidation belongs to the server action.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { findActiveMembership, isAdminRole } from "../membership";
import { lockTicketsInIdOrder } from "./merge";
import { isStateColorKey } from "./state-colors";
import { type StateGroup, shareLockActiveState, stateAuditSnapshot } from "./ticket-states";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** The longest state id accepted (ids are cuid or uuid strings; this only refuses absurd input). */
const MAX_STATE_ID_LENGTH = 128;
/** Name length in code points, as the database's char_length counts it (D-03). */
const MAX_NAME_LENGTH = 40;

const STATE_GROUPS: readonly StateGroup[] = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];

export interface StateAdminActor {
  userId: string;
  orgId: string;
}

/** Frozen for the admin UI (plan 12.1-12) and the UI-SPEC error rows. */
export type StateAdminErrorCode =
  | "INVALID"
  | "INVALID_NAME"
  | "DUPLICATE_NAME"
  | "INVALID_COLOR"
  | "STATE_NOT_FOUND"
  | "NOT_ALLOWED"
  | "MEMBERSHIP_ENDED"
  | "NOT_OPEN_GROUP"
  | "LAST_IN_GROUP"
  | "REPLACEMENT_REQUIRED"
  | "REPLACEMENT_INVALID";

/** The five role keys of TicketStateConfig (D-05), frozen. */
export type StateRoleKey = "new" | "reopen" | "resolve" | "autoClose" | "mergeClose";

/** A refusal by the service. Rolled back and returned, never rethrown. */
export class StateAdminError extends Error {
  readonly code: StateAdminErrorCode;

  constructor(code: StateAdminErrorCode) {
    super(`Ticket state admin refused: ${code}`);
    this.name = "StateAdminError";
    this.code = code;
  }
}

export type StateAdminFailure = { ok: false; error: StateAdminErrorCode };

/** Test seams. Production callers never pass them. */
export interface StateAdminHooks {
  /** Awaited as the very first step inside the transaction. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited right after the configuration row lock. */
  afterConfigLock?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited right after the changed state row(s) are locked. */
  afterStateLock?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Deletion only: awaited right after the deleted state's tickets are locked. */
  afterTicketsLocked?(
    tx: Prisma.TransactionClient,
    ticketIds: readonly string[],
  ): Promise<void> | void;
  /** Awaited as the last step before the transaction returns (and commits). */
  beforeCommit?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** The effective time, read after the locks. Defaults to new Date(). */
  clock?(): Date;
}

/** Needs $transaction (and, for the list, member and $queryRaw): the global prisma client. */
type AdminClient = Pick<PrismaClient, "$transaction">;
type ListClient = Pick<PrismaClient, "member" | "$transaction">;

interface ConfigRow {
  newStateId: string;
  reopenStateId: string;
  resolveStateId: string;
  autoCloseStateId: string;
  mergeCloseStateId: string;
}

const ROLE_COLUMNS: readonly { key: StateRoleKey; column: keyof ConfigRow }[] = [
  { key: "new", column: "newStateId" },
  { key: "reopen", column: "reopenStateId" },
  { key: "resolve", column: "resolveStateId" },
  { key: "autoClose", column: "autoCloseStateId" },
  { key: "mergeClose", column: "mergeCloseStateId" },
];

function rolesOf(config: ConfigRow, stateId: string): StateRoleKey[] {
  return ROLE_COLUMNS.filter((r) => config[r.column] === stateId).map((r) => r.key);
}

interface LockedState {
  id: string;
  name: string;
  colorToken: string;
  group: StateGroup;
  sortOrder: number;
}

// --- input parsing -------------------------------------------------------------------------

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function parseStateId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_STATE_ID_LENGTH) {
    throw new StateAdminError("INVALID");
  }
  return value;
}

/**
 * Control (Cc), format (Cf: zero-width, bidi overrides, soft hyphen, BOM, joiners) and line or
 * paragraph separators (Zl, Zp). A name with one of them could look identical to another state's
 * name in chips, filters and the feed without colliding under lower(name) (review IN-a2-3).
 */
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Trims and checks 1 to 40 code points (the database's char_length) without control, format or
 * separator characters, else INVALID_NAME.
 */
function parseName(value: unknown): string {
  if (typeof value !== "string") throw new StateAdminError("INVALID_NAME");
  const name = value.trim();
  const length = [...name].length;
  if (length < 1 || length > MAX_NAME_LENGTH) throw new StateAdminError("INVALID_NAME");
  if (INVISIBLE_OR_CONTROL.test(name)) throw new StateAdminError("INVALID_NAME");
  return name;
}

function parseColor(value: unknown): string {
  if (!isStateColorKey(value)) throw new StateAdminError("INVALID_COLOR");
  return value;
}

/** Postgres 23505 as surfaced by Prisma (P2002), with or without the pg driver adapter. */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; meta?: unknown };
  if (e.code === "P2002") return true;
  if (e.code === "23505") return true;
  const meta = JSON.stringify(e.meta ?? {});
  return /"originalCode":"23505"|UniqueConstraintViolation/.test(meta);
}

// --- the shared transaction ------------------------------------------------------------------

interface AdminContext {
  tx: Prisma.TransactionClient;
  orgId: string;
  userId: string;
  config: ConfigRow;
  hooks: StateAdminHooks;
}

/**
 * Opens the transaction, runs the admin gate (membership first, then the exact admin role),
 * locks the configuration row FOR UPDATE and runs body. Refusals are returned.
 */
async function runAdminOperation<T>(
  client: AdminClient,
  actor: StateAdminActor,
  hooks: StateAdminHooks,
  body: (ctx: AdminContext) => Promise<T>,
): Promise<T | StateAdminFailure> {
  try {
    return await client.$transaction(async (tx) => {
      if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);

      // D-01: the actor must still be a member, read inside this transaction, and an exact
      // owner or admin.
      const membership = await findActiveMembership(tx, actor?.userId, actor?.orgId);
      if (!membership) throw new StateAdminError("MEMBERSHIP_ENDED");
      if (!isAdminRole(membership.role)) throw new StateAdminError("NOT_ALLOWED");
      const orgId = actor.orgId;

      // D-15 step 1: the configuration row FOR UPDATE.
      const configRows = await tx.$queryRaw<ConfigRow[]>`
        SELECT "newStateId", "reopenStateId", "resolveStateId", "autoCloseStateId",
          "mergeCloseStateId"
        FROM "TicketStateConfig"
        WHERE "organizationId" = ${orgId}
        FOR UPDATE
      `;
      const config = configRows[0];
      if (!config) throw new Error(`TicketStateConfig missing for organization ${orgId}`);
      if (hooks.afterConfigLock) await hooks.afterConfigLock(tx);

      const result = await body({ tx, orgId, userId: actor.userId, config, hooks });
      if (hooks.beforeCommit) await hooks.beforeCommit(tx);
      return result;
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof StateAdminError) return { ok: false, error: err.code };
    throw err;
  }
}

/** Locks one active state of the organization FOR UPDATE, else STATE_NOT_FOUND. */
async function lockStateForUpdate(
  tx: Prisma.TransactionClient,
  orgId: string,
  stateId: string,
): Promise<LockedState> {
  const rows = await tx.$queryRaw<LockedState[]>`
    SELECT id, name, "colorToken", "group"::text AS "group", "sortOrder"
    FROM "TicketState"
    WHERE id = ${stateId} AND "organizationId" = ${orgId} AND "deletedAt" IS NULL
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new StateAdminError("STATE_NOT_FOUND");
  return { ...row, sortOrder: Number(row.sortOrder) };
}

async function countActiveInGroup(
  tx: Prisma.TransactionClient,
  orgId: string,
  group: StateGroup,
): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "TicketState"
    WHERE "organizationId" = ${orgId} AND "group" = ${group}::"TicketStateGroup"
      AND "deletedAt" IS NULL
  `;
  return Number(rows[0]?.n ?? 0);
}

// --- delete ------------------------------------------------------------------------------------

export type DeleteTicketStateResult =
  | {
      ok: true;
      movedCount: number;
      rolesMoved: boolean;
      name: string;
      replacementName: string | null;
    }
  | StateAdminFailure;

/**
 * Soft-deletes a state (K42). Allowed when no ticket and no role uses it, or with a replacement
 * that is an active state of the same group in the same organization (D-12, K41), which then
 * receives every ticket and every role of the deleted state.
 */
export async function deleteTicketState(
  client: AdminClient,
  actor: StateAdminActor,
  raw: unknown,
  hooks: StateAdminHooks = {},
): Promise<DeleteTicketStateResult> {
  return runAdminOperation(client, actor, hooks, async ({ tx, orgId, userId, config }) => {
    if (!isRecord(raw)) throw new StateAdminError("INVALID");
    const stateId = parseStateId(raw.stateId);
    const replacementStateId =
      raw.replacementStateId === null || raw.replacementStateId === undefined
        ? null
        : parseStateId(raw.replacementStateId);

    // D-15 step 2: the deleted state FOR UPDATE. A writer setting a ticket to it waits on our
    // lock (its FOR SHARE) and, after our commit, finds it deleted.
    const state = await lockStateForUpdate(tx, orgId, stateId);
    if (hooks.afterStateLock) await hooks.afterStateLock(tx);

    // Each of OPEN, RESOLVED and CLOSED keeps at least one state; PENDING may become empty.
    if (state.group !== "PENDING" && (await countActiveInGroup(tx, orgId, state.group)) <= 1) {
      throw new StateAdminError("LAST_IN_GROUP");
    }

    const roles = rolesOf(config, state.id);
    const countRows = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Ticket"
      WHERE "organizationId" = ${orgId} AND "stateId" = ${state.id}
    `;
    const ticketCount = Number(countRows[0]?.n ?? 0);
    if ((ticketCount > 0 || roles.length > 0) && replacementStateId === null) {
      throw new StateAdminError("REPLACEMENT_REQUIRED");
    }

    let replacement: { id: string; name: string } | null = null;
    if (replacementStateId !== null) {
      if (replacementStateId === state.id) throw new StateAdminError("REPLACEMENT_INVALID");
      const locked = await shareLockActiveState(tx, orgId, replacementStateId);
      if (!locked || locked.group !== state.group) {
        throw new StateAdminError("REPLACEMENT_INVALID");
      }
      const named = await tx.$queryRaw<{ name: string }[]>`
        SELECT name FROM "TicketState"
        WHERE id = ${locked.id} AND "organizationId" = ${orgId}
      `;
      replacement = { id: locked.id, name: named[0]?.name ?? "" };
    }

    // D-15 step 3: the deleted state's tickets, locked in ascending id. A ticket another writer
    // held is read here with its committed state: one moved out of the state is skipped.
    const idRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Ticket"
      WHERE "organizationId" = ${orgId} AND "stateId" = ${state.id}
      ORDER BY id
    `;
    const lockedTickets = await lockTicketsInIdOrder(
      tx,
      orgId,
      idRows.map((r) => r.id),
    );
    if (hooks.afterTicketsLocked) {
      await hooks.afterTicketsLocked(
        tx,
        lockedTickets.map((t) => t.id),
      );
    }

    let movedCount = 0;
    if (replacement !== null) {
      const now = hooks.clock ? hooks.clock() : new Date();
      const batchId = randomUUID();
      // A ticket another writer moved out of the state before our lock is skipped.
      const stillInState = lockedTickets.filter((t) => t.stateId === state.id).map((t) => t.id);
      if (stillInState.length > 0) {
        // Set-based (review WR-a2-1): one UPDATE and one INSERT ... SELECT, whatever the number
        // of tickets, so a large state is moved well inside the transaction timeout while the
        // config row is held. K41: same group, so only stateId (and updatedAt) changes, exactly
        // what planStateTransition plans for fromGroup equal to toGroup (no resolvedAt, flag,
        // deadline or pause effect). updatedAt and the audit time are the wall clock, as the
        // per-ticket writes had them.
        const writtenAt = new Date();
        const moved = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "Ticket" SET "stateId" = ${replacement.id}, "updatedAt" = ${writtenAt}
          WHERE "organizationId" = ${orgId} AND "stateId" = ${state.id}
            AND id = ANY(${stillInState}::text[])
          RETURNING id
        `;
        // Every locked ticket still in the state must move; otherwise the whole delete rolls
        // back and the state stays active (K42; review IN-a2-1).
        if (moved.length !== stillInState.length) {
          throw new Error(
            `state delete: moved ${moved.length} of ${stillInState.length} locked tickets`,
          );
        }
        // One STATUS_CHANGED row per moved ticket, one batchId, the flat { stateId, stateGroup }
        // snapshot only (K42), as recordTicketAudit writes it.
        const before = JSON.stringify(stateAuditSnapshot(state.id, state.group));
        const after = JSON.stringify(stateAuditSnapshot(replacement.id, state.group));
        const movedIds = moved.map((m) => m.id);
        await tx.$executeRaw`
          INSERT INTO "TicketAuditEvent" (id, "organizationId", "ticketId", "actorType",
            "actorUserId", action, before, after, "batchId", "createdAt")
          SELECT gen_random_uuid()::text, ${orgId}, m.id, 'USER'::"TicketAuditActorType",
            ${userId}, 'STATUS_CHANGED'::"TicketAuditAction", ${before}::jsonb, ${after}::jsonb,
            ${batchId}, ${writtenAt}
          FROM unnest(${movedIds}::text[]) AS m(id)
        `;
        movedCount = moved.length;
      }

      // Every role column that held the deleted state now holds the replacement (D-05 group
      // invariant: same group).
      if (roles.length > 0) {
        await tx.$executeRaw`
          UPDATE "TicketStateConfig" SET
            "newStateId" = CASE WHEN "newStateId" = ${state.id} THEN ${replacement.id} ELSE "newStateId" END,
            "reopenStateId" = CASE WHEN "reopenStateId" = ${state.id} THEN ${replacement.id} ELSE "reopenStateId" END,
            "resolveStateId" = CASE WHEN "resolveStateId" = ${state.id} THEN ${replacement.id} ELSE "resolveStateId" END,
            "autoCloseStateId" = CASE WHEN "autoCloseStateId" = ${state.id} THEN ${replacement.id} ELSE "autoCloseStateId" END,
            "mergeCloseStateId" = CASE WHEN "mergeCloseStateId" = ${state.id} THEN ${replacement.id} ELSE "mergeCloseStateId" END,
            "updatedAt" = ${now}
          WHERE "organizationId" = ${orgId}
        `;
      }
    } else if (lockedTickets.some((t) => t.stateId === state.id)) {
      // Unreachable while the state lock is held (no writer can move a ticket into it), kept as
      // a guard so a ticket is never left on a deleted state.
      throw new StateAdminError("REPLACEMENT_REQUIRED");
    }

    const deletedAt = hooks.clock ? hooks.clock() : new Date();
    await tx.$executeRaw`
      UPDATE "TicketState" SET "deletedAt" = ${deletedAt}, "updatedAt" = ${deletedAt}
      WHERE id = ${state.id} AND "organizationId" = ${orgId}
    `;

    return {
      ok: true as const,
      movedCount,
      rolesMoved: roles.length > 0,
      name: state.name,
      replacementName: replacement?.name ?? null,
    };
  });
}

// --- create, update ----------------------------------------------------------------------------

/** One state as the admin operations return it. */
export interface AdminStateRow {
  id: string;
  name: string;
  colorToken: string;
  group: StateGroup;
  sortOrder: number;
}

export type TicketStateWriteResult = { ok: true; state: AdminStateRow } | StateAdminFailure;

/** Runs a write that may hit TicketState_active_name_key; a violation becomes DUPLICATE_NAME. */
async function withDuplicateName<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (isUniqueViolation(err)) throw new StateAdminError("DUPLICATE_NAME");
    throw err;
  }
}

/**
 * Creates a state in one of the four groups with a trimmed, unique name and a palette colour,
 * one sortOrder above the group's highest active state (D-03, D-14).
 */
export async function createTicketState(
  client: AdminClient,
  actor: StateAdminActor,
  raw: unknown,
  hooks: StateAdminHooks = {},
): Promise<TicketStateWriteResult> {
  return runAdminOperation(client, actor, hooks, async ({ tx, orgId }) => {
    if (!isRecord(raw)) throw new StateAdminError("INVALID");
    const group = raw.group;
    if (typeof group !== "string" || !(STATE_GROUPS as readonly string[]).includes(group)) {
      throw new StateAdminError("INVALID");
    }
    const name = parseName(raw.name);
    const colorToken = parseColor(raw.colorToken);

    const maxRows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT max("sortOrder")::int AS max FROM "TicketState"
      WHERE "organizationId" = ${orgId} AND "group" = ${group}::"TicketStateGroup"
        AND "deletedAt" IS NULL
    `;
    const max = maxRows[0]?.max;
    const sortOrder = max === null || max === undefined ? 0 : Number(max) + 1;

    // The unique index decides duplicates (never a pre-check alone): a concurrent insert of the
    // same name in another transaction is refused here too.
    const state = await withDuplicateName(() =>
      tx.ticketState.create({
        data: { organizationId: orgId, name, colorToken, group: group as StateGroup, sortOrder },
        select: { id: true, name: true, colorToken: true, group: true, sortOrder: true },
      }),
    );
    return { ok: true as const, state };
  });
}

/** Renames and/or recolours an active state. The group never changes (D-03). */
export async function updateTicketState(
  client: AdminClient,
  actor: StateAdminActor,
  raw: unknown,
  hooks: StateAdminHooks = {},
): Promise<TicketStateWriteResult> {
  return runAdminOperation(client, actor, hooks, async ({ tx, orgId }) => {
    if (!isRecord(raw)) throw new StateAdminError("INVALID");
    const stateId = parseStateId(raw.stateId);
    if (raw.name === undefined && raw.colorToken === undefined) {
      throw new StateAdminError("INVALID");
    }
    const name = raw.name === undefined ? undefined : parseName(raw.name);
    const colorToken = raw.colorToken === undefined ? undefined : parseColor(raw.colorToken);

    const state = await lockStateForUpdate(tx, orgId, stateId);
    if (hooks.afterStateLock) await hooks.afterStateLock(tx);

    const now = hooks.clock ? hooks.clock() : new Date();
    await withDuplicateName(() =>
      tx.ticketState.updateMany({
        where: { id: state.id, organizationId: orgId, deletedAt: null },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(colorToken !== undefined ? { colorToken } : {}),
          updatedAt: now,
        },
      }),
    );
    return {
      ok: true as const,
      state: {
        id: state.id,
        name: name ?? state.name,
        colorToken: colorToken ?? state.colorToken,
        group: state.group,
        sortOrder: state.sortOrder,
      },
    };
  });
}

// --- reorder -------------------------------------------------------------------------------------

export type MoveTicketStateResult =
  | { ok: true; position: number; total: number; group: StateGroup; name: string }
  | StateAdminFailure;

/**
 * Moves a state up or down inside its group: it swaps with its neighbour and the group's active
 * states are renumbered 0..n-1 by (sortOrder, id in code-unit order), so equal sortOrder values
 * never make the order ambiguous. The first state up or the last state down is ok and unchanged.
 * Returns the new 1-based position and the group's count (the live region of UI-SPEC 1f).
 */
export async function moveTicketState(
  client: AdminClient,
  actor: StateAdminActor,
  raw: unknown,
  hooks: StateAdminHooks = {},
): Promise<MoveTicketStateResult> {
  return runAdminOperation(client, actor, hooks, async ({ tx, orgId }) => {
    if (!isRecord(raw)) throw new StateAdminError("INVALID");
    const stateId = parseStateId(raw.stateId);
    const direction = raw.direction;
    if (direction !== "up" && direction !== "down") throw new StateAdminError("INVALID");

    const targetRows = await tx.$queryRaw<{ id: string; group: StateGroup }[]>`
      SELECT id, "group"::text AS "group" FROM "TicketState"
      WHERE id = ${stateId} AND "organizationId" = ${orgId} AND "deletedAt" IS NULL
    `;
    const target = targetRows[0];
    if (!target) throw new StateAdminError("STATE_NOT_FOUND");

    // Every active state of the group FOR UPDATE in ascending id (the target and its neighbour
    // among them, and every row the renumbering may write). Admin operations of the
    // organization are serialized by the config lock, so this set cannot change meanwhile.
    await tx.$queryRaw`
      SELECT id FROM "TicketState"
      WHERE "organizationId" = ${orgId} AND "group" = ${target.group}::"TicketStateGroup"
        AND "deletedAt" IS NULL
      ORDER BY id
      FOR UPDATE
    `;
    if (hooks.afterStateLock) await hooks.afterStateLock(tx);

    const ordered = await tx.$queryRaw<{ id: string; name: string; sortOrder: number }[]>`
      SELECT id, name, "sortOrder" FROM "TicketState"
      WHERE "organizationId" = ${orgId} AND "group" = ${target.group}::"TicketStateGroup"
        AND "deletedAt" IS NULL
      ORDER BY "sortOrder", id COLLATE "C"
    `;
    const index = ordered.findIndex((s) => s.id === target.id);
    if (index < 0) throw new StateAdminError("STATE_NOT_FOUND");
    const swapWith = direction === "up" ? index - 1 : index + 1;
    let position = index;
    const next = [...ordered];
    if (swapWith >= 0 && swapWith < ordered.length) {
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      position = swapWith;
    }

    const now = hooks.clock ? hooks.clock() : new Date();
    for (let i = 0; i < next.length; i += 1) {
      if (Number(next[i].sortOrder) === i) continue;
      await tx.ticketState.updateMany({
        where: { id: next[i].id, organizationId: orgId },
        data: { sortOrder: i, updatedAt: now },
      });
    }

    return {
      ok: true as const,
      position: position + 1,
      total: next.length,
      group: target.group,
      name: ordered[index].name,
    };
  });
}

// --- set default ---------------------------------------------------------------------------------

export type SetDefaultTicketStateResult =
  | { ok: true; defaultStateId: string; name: string }
  | StateAdminFailure;

/**
 * Makes an active OPEN-group state the default for new tickets (newStateId, D-06, K40). The
 * current default returns ok and changes nothing. No other role changes.
 */
export async function setDefaultTicketState(
  client: AdminClient,
  actor: StateAdminActor,
  raw: unknown,
  hooks: StateAdminHooks = {},
): Promise<SetDefaultTicketStateResult> {
  return runAdminOperation(client, actor, hooks, async ({ tx, orgId, config }) => {
    if (!isRecord(raw)) throw new StateAdminError("INVALID");
    const stateId = parseStateId(raw.stateId);

    // Referenced, not changed: FOR SHARE (the config row is the row this operation changes).
    const state = await shareLockActiveState(tx, orgId, stateId);
    if (!state) throw new StateAdminError("STATE_NOT_FOUND");
    if (hooks.afterStateLock) await hooks.afterStateLock(tx);
    if (state.group !== "OPEN") throw new StateAdminError("NOT_OPEN_GROUP");

    const named = await tx.$queryRaw<{ name: string }[]>`
      SELECT name FROM "TicketState" WHERE id = ${state.id} AND "organizationId" = ${orgId}
    `;
    if (config.newStateId !== state.id) {
      const now = hooks.clock ? hooks.clock() : new Date();
      await tx.$executeRaw`
        UPDATE "TicketStateConfig" SET "newStateId" = ${state.id}, "updatedAt" = ${now}
        WHERE "organizationId" = ${orgId}
      `;
    }
    return { ok: true as const, defaultStateId: state.id, name: named[0]?.name ?? "" };
  });
}

// --- the settings list ---------------------------------------------------------------------------

/** One row of the settings page (UI-SPEC Surface 1a). */
export interface SettingsStateRow extends AdminStateRow {
  ticketCount: number;
  roles: StateRoleKey[];
}

export type ListStatesForSettingsResult =
  | { ok: true; states: SettingsStateRow[]; defaultStateId: string; isAdmin: boolean }
  | { ok: false; error: "membership_ended" };

/**
 * The organization's active states in group and sort order with their ticket counts, the roles
 * each holds, the default state id and whether the viewer is an admin. Members read the list;
 * a removed member gets membership_ended. No lock; the three reads share one read-only
 * REPEATABLE READ snapshot, and every read carries the organization term.
 */
export async function listStatesForSettings(
  client: ListClient,
  actor: StateAdminActor,
): Promise<ListStatesForSettingsResult> {
  const membership = await findActiveMembership(client, actor?.userId, actor?.orgId);
  if (!membership) return { ok: false, error: "membership_ended" };
  const orgId = actor.orgId;

  // One REPEATABLE READ, read-only snapshot for the three reads, so a delete that commits between
  // them never yields a role or count that disagrees with the listed states (review IN-a2-4).
  const { states, counts, configRows } = await client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const states = await tx.$queryRaw<AdminStateRow[]>`
        SELECT id, name, "colorToken", "group"::text AS "group", "sortOrder"
        FROM "TicketState"
        WHERE "organizationId" = ${orgId} AND "deletedAt" IS NULL
        ORDER BY "TicketState"."group", "TicketState"."sortOrder", "TicketState".id COLLATE "C"
      `;
      const counts = await tx.$queryRaw<{ stateId: string; n: number }[]>`
        SELECT "stateId", count(*)::int AS n FROM "Ticket"
        WHERE "organizationId" = ${orgId}
        GROUP BY "stateId"
      `;
      const configRows = await tx.$queryRaw<ConfigRow[]>`
        SELECT "newStateId", "reopenStateId", "resolveStateId", "autoCloseStateId",
          "mergeCloseStateId"
        FROM "TicketStateConfig"
        WHERE "organizationId" = ${orgId}
      `;
      return { states, counts, configRows };
    },
    { isolationLevel: "RepeatableRead" },
  );
  const config = configRows[0];
  if (!config) throw new Error(`TicketStateConfig missing for organization ${orgId}`);
  const countOf = new Map(counts.map((c) => [c.stateId, Number(c.n)]));

  return {
    ok: true,
    states: states.map((s) => ({
      ...s,
      sortOrder: Number(s.sortOrder),
      ticketCount: countOf.get(s.id) ?? 0,
      roles: rolesOf(config, s.id),
    })),
    defaultStateId: config.newStateId,
    isAdmin: isAdminRole(membership.role),
  };
}
