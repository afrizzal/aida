// Phase 14 service kit (contract sections 2, 3 and 14; C13, C17): the transaction runner, the
// typed refusal and the test seam every projects service uses. Relative imports only, no Next.js
// import (the worker reaches these modules too).
//
// Error contract (C13): a ProjectRefusal thrown inside a transaction rolls it back and comes back
// as `{ ok: false, code, field? }` (field only with INVALID_INPUT). The database errors of
// contract section 14 are a second fence and come back the same way: a unique violation maps by
// index name (prefix indexes to PREFIX_TAKEN, label, milestone and team name indexes to
// NAME_TAKEN), the two subtask trigger messages to SUBTASK_DEPTH, Task_dates_check to
// INVALID_DATE_RANGE, the text length CHECKs to INVALID_INPUT with their field and a deadlock
// (40P01) to CONFLICT, always by SQLSTATE and constraint name (db-errors.ts). Every other error
// rolls back and is rethrown (a programming error or an outage, never a refusal).
//
// Test seam (C17, one style for all services): setProjectServiceObserverForTests installs an
// observer whose onTransactionStart is awaited as the first statement of every service
// transaction and whose afterLock is awaited right after the last lock and before the first
// write (services call afterLock themselves). Production never sets the observer.
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { findConservativeMembership } from "../membership";
import { scopedDb } from "../scoped-db";
import {
  isWellFormedId,
  LIST_DEFAULT,
  LIST_MAX,
  type ProjectActor,
  type ProjectRefusalCode,
  type ProjectRefusal as ProjectRefusalResult,
  type ProjectResult,
  TRANSACTION_OPTIONS,
} from "./contract";
import { mapDatabaseError } from "./db-errors";

export { mapDatabaseError };

/** The client every projects helper takes: an interactive transaction or a scoped client. */
export type ProjectDb = Prisma.TransactionClient;

/** A refusal of a projects operation. Thrown inside the work, returned by the runner. */
export class ProjectRefusal extends Error {
  readonly code: ProjectRefusalCode;
  readonly field?: string;

  constructor(code: ProjectRefusalCode, field?: string) {
    super(`Project operation refused: ${code}${field ? ` (${field})` : ""}`);
    this.name = "ProjectRefusal";
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

/** Throws a ProjectRefusal (for use in expressions). */
export function refuse(code: ProjectRefusalCode, field?: string): never {
  throw new ProjectRefusal(code, field);
}

/** The result shape of a refusal: field only with INVALID_INPUT (contract section 14). */
export function refusalResult(code: ProjectRefusalCode, field?: string): ProjectRefusalResult {
  return code === "INVALID_INPUT" && field !== undefined
    ? { ok: false, code, field }
    : { ok: false, code };
}

/** Test seam of every projects service transaction (race proofs). Production never sets it. */
export interface ProjectServiceObserver {
  /** Awaited as the first statement of every service transaction. */
  onTransactionStart?(tx: ProjectDb, operation: string): Promise<void> | void;
  /** Awaited right after the operation's last lock, before its first write. */
  afterLock?(tx: ProjectDb, operation: string): Promise<void> | void;
  /** Awaited by a read right after its access check, before its content queries (K73). */
  afterReadCheck?(tx: ProjectDb, operation: string): Promise<void> | void;
}

let serviceObserver: ProjectServiceObserver | null = null;

/** Test seam only: installs (or with null clears) the observer. Production never calls it. */
export function setProjectServiceObserverForTests(observer: ProjectServiceObserver | null): void {
  serviceObserver = observer;
}

/** Called by every service right after its last lock and before its first write. */
export async function afterLock(tx: ProjectDb, operation: string): Promise<void> {
  await serviceObserver?.afterLock?.(tx, operation);
}

/**
 * Called by a read right after its access check and before its content queries (run decision
 * K73): a race proof parks the read here, changes access, then lets the content queries run.
 */
export async function afterReadCheck(tx: ProjectDb, operation: string): Promise<void> {
  await serviceObserver?.afterReadCheck?.(tx, operation);
}

/**
 * The one limit rule of every paged list (contract section 15, review b-IN-09): absent is the
 * default; a safe integer from 1 to max is used as it is; anything else, including a limit above
 * the maximum, is INVALID_INPUT field limit (never silently clamped).
 */
export function listLimit(
  raw: unknown,
  max: number = LIST_MAX,
  fallback: number = LIST_DEFAULT,
): number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1 || raw > max) {
    refuse("INVALID_INPUT", "limit");
  }
  return raw;
}

/** A page request of a keyset-paged list: the previous page's opaque cursor and a limit. */
export interface ListPageOpts {
  cursor?: string | null;
  limit?: number;
}

/** An opaque keyset cursor over sort values ending with the row id (contract section 15). */
export function encodeKeyset(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/**
 * The decoded keyset cursor (its values match `kinds`, the last one a well-formed id), null for no
 * cursor, or INVALID_INPUT field cursor.
 */
export function decodeKeyset(
  raw: unknown,
  kinds: readonly ("string" | "number")[],
): (string | number)[] | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.length > 4096) refuse("INVALID_INPUT", "cursor");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === kinds.length &&
      parsed.every((value, i) => typeof value === kinds[i]) &&
      isWellFormedId(parsed[parsed.length - 1])
    ) {
      return parsed as (string | number)[];
    }
  } catch {
    // falls through to the refusal
  }
  return refuse("INVALID_INPUT", "cursor");
}

/**
 * One page of a list already sorted in memory by `compare` (people lists, which re-check the
 * `member` table and so are filtered after the read): the rows strictly after the cursor's key,
 * at most `limit`, with hasMore and the next cursor from the last returned row.
 */
export function pageInMemory<T>(
  sorted: readonly T[],
  opts: ListPageOpts,
  keyOf: (row: T) => (string | number)[],
  compareKeys: (a: (string | number)[], b: (string | number)[]) => number,
  kinds: readonly ("string" | "number")[],
): { rows: T[]; hasMore: boolean; nextCursor: string | null } {
  const limit = listLimit(opts.limit);
  const cursor = decodeKeyset(opts.cursor, kinds);
  const after = cursor ? sorted.filter((row) => compareKeys(keyOf(row), cursor) > 0) : sorted;
  const rows = after.slice(0, limit);
  const hasMore = after.length > limit;
  const last = rows[rows.length - 1];
  return { rows, hasMore, nextCursor: hasMore && last ? encodeKeyset(keyOf(last)) : null };
}

/** One batch id per mutation call (contract section 5). */
export function newBatchId(): string {
  return randomUUID();
}

/** Contract section 2 step 1: a well-formed id (1 to 64 of A-Z, a-z, 0-9, _ and -). */
export function isPlausibleId(value: unknown): value is string {
  return isWellFormedId(value);
}

function hasActor(actor: ProjectActor): boolean {
  return (
    typeof actor?.userId === "string" &&
    actor.userId.length > 0 &&
    typeof actor?.orgId === "string" &&
    actor.orgId.length > 0
  );
}

function asResult<T extends object>(err: unknown): ProjectResult<T> {
  if (err instanceof ProjectRefusal) return refusalResult(err.code, err.field);
  const mapped = mapDatabaseError(err);
  if (mapped) return mapped;
  throw err;
}

/**
 * Runs one service transaction on scopedDb(actor.orgId).$transaction with TRANSACTION_OPTIONS.
 * The observer's onTransactionStart is awaited first. Returns `{ ok: true, ...value }`, a
 * refusal result for a ProjectRefusal or a mapped database error, and rethrows anything else.
 */
export async function runProjectTransaction<T extends object>(
  actor: ProjectActor,
  operation: string,
  fn: (tx: ProjectDb) => Promise<T>,
): Promise<ProjectResult<T>> {
  if (!hasActor(actor)) return refusalResult("MEMBERSHIP_ENDED");
  try {
    const value = await scopedDb(actor.orgId).$transaction(async (rawTx) => {
      const tx = rawTx as unknown as ProjectDb;
      await serviceObserver?.onTransactionStart?.(tx, operation);
      return fn(tx);
    }, TRANSACTION_OPTIONS);
    return { ok: true, ...value } as ProjectResult<T>;
  } catch (err) {
    return asResult<T>(err);
  }
}

/**
 * Runs a read (run decision K73): one read transaction on one connection, the actor's
 * organization membership read conservatively first (no row: MEMBERSHIP_ENDED), then fn.
 * Same as runProjectReadInTransaction. The transaction alone does not close the check-then-read
 * gap under READ COMMITTED; every query of fn that returns content, rows, counts, cursors or
 * hasMore carries the current read predicate (readableProjectWhere, which includes the actor's
 * organization membership).
 */
export async function runProjectRead<T extends object>(
  actor: ProjectActor,
  operation: string,
  fn: (db: ProjectDb) => Promise<T>,
): Promise<ProjectResult<T>> {
  return runProjectReadInTransaction(actor, operation, fn);
}

/**
 * Runs a content read on one connection inside a read transaction (Codex diff D1): the membership
 * is read first (no row: MEMBERSHIP_ENDED), then fn runs. The observer's onTransactionStart is
 * awaited first, as for every service transaction, so a race test can bind the read's PID. The
 * transaction alone does not close the check-then-read gap under READ COMMITTED; every content
 * query of fn also carries the current read predicate.
 */
export async function runProjectReadInTransaction<T extends object>(
  actor: ProjectActor,
  operation: string,
  fn: (tx: ProjectDb) => Promise<T>,
): Promise<ProjectResult<T>> {
  return runProjectTransaction(actor, operation, async (tx) => {
    const membership = await findConservativeMembership(tx, actor.userId, actor.orgId);
    if (!membership) refuse("MEMBERSHIP_ENDED");
    return fn(tx);
  });
}
