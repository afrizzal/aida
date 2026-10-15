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
 * Runs a read (no transaction unless fn opens one): the actor's organization membership is read
 * conservatively first (no row: MEMBERSHIP_ENDED), then fn runs on the scoped client. Refusals
 * are returned, other errors rethrown.
 */
export async function runProjectRead<T extends object>(
  actor: ProjectActor,
  _operation: string,
  fn: (db: ProjectDb) => Promise<T>,
): Promise<ProjectResult<T>> {
  if (!hasActor(actor)) return refusalResult("MEMBERSHIP_ENDED");
  try {
    const db = scopedDb(actor.orgId) as unknown as ProjectDb;
    const membership = await findConservativeMembership(db, actor.userId, actor.orgId);
    if (!membership) return refusalResult("MEMBERSHIP_ENDED");
    const value = await fn(db);
    return { ok: true, ...value } as ProjectResult<T>;
  } catch (err) {
    return asResult<T>(err);
  }
}
