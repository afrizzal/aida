// The organization row lock of every Phase 10 membership writer (V-25): deactivation, role
// change and invitation accept each take it first, inside their own transaction, so they
// serialise against each other per organization.
//
// Why NO KEY UPDATE and not FOR UPDATE (V-25): every ticket mutation inserts a TicketAuditEvent,
// and every notification insert a Notification, whose foreign key to "organization" makes
// PostgreSQL take FOR KEY SHARE on the organization row. FOR UPDATE blocks FOR KEY SHARE, so an
// assignment that holds the assignee's member rows FOR SHARE would wait on the organization row
// for its audit insert, while a deactivation holding that row waits to delete the same member
// rows: a deadlock. The NO KEY UPDATE strength conflicts with itself (membership writers still
// serialise) but not with FOR KEY SHARE, so ticket mutations, notification inserts and the SLA
// worker never wait on it. tests/integration/team-schema.test.ts proves both halves.
//
// "organization" is Better Auth's table, outside DOMAIN_MODELS, so the statement is raw and the
// id term is explicit.
//
// Relative imports only and no framework import: the worker may bundle it.

/** Any client that runs a tagged raw query; in practice an interactive transaction client. */
export interface OrgLockClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/** Test seam. Production callers pass none. */
export interface OrgLockHooks<Tx extends OrgLockClient = OrgLockClient> {
  /** Awaited right before the lock statement (a test records the backend PID here). */
  beforeLock?(tx: Tx): Promise<void> | void;
  /** Awaited right after the lock statement returned. */
  afterLock?(tx: Tx): Promise<void> | void;
}

/**
 * Locks the organization row for the rest of the caller's transaction and returns whether the
 * row exists. Must run inside an interactive transaction: on an autocommit client the lock ends
 * with the statement.
 */
export async function lockOrganization<Tx extends OrgLockClient>(
  tx: Tx,
  orgId: string,
  hooks?: OrgLockHooks<Tx>,
): Promise<boolean> {
  if (!orgId) throw new Error("lockOrganization requires a non-empty organizationId");
  await hooks?.beforeLock?.(tx);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "organization" WHERE id = ${orgId} FOR NO KEY UPDATE
  `;
  await hooks?.afterLock?.(tx);
  return rows.length > 0;
}
