// Test-only helpers for forced-order concurrency proofs (Phase 11).
//
// Every proof records each run's backend PID itself (backendPid from inside the run's own
// transaction, through a test hook where the run is production code) and then waits for
// exactly those PIDs to be blocked by the holder it expects them to queue behind. Nothing
// here counts anonymous waiting backends (Codex review C6): a count can be satisfied by an
// unrelated backend and proves nothing about a given run.
//
// pg_blocking_pids is used rather than a pg_locks relation predicate: a row-lock waiter queues
// on the holder's transaction id, which pg_blocking_pids reports and a relation predicate does
// not. A second waiter on the same row queues behind the first waiter's tuple lock, so
// pg_blocking_pids names the first waiter, not the original holder; name that first waiter as
// the holder in such a wait.
//
// Relative imports only.

/** Any client that can run a tagged raw query: global prisma or an interactive transaction. */
export interface RawQueryClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** A promise together with its resolve function. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The Postgres backend PID of the connection running this transaction. */
export async function backendPid(tx: RawQueryClient): Promise<number> {
  const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  const pid = Number(rows[0]?.pid);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("backendPid: no backend PID returned");
  return pid;
}

/**
 * Resolves once every PID in waiterPids is blocked by holderPid (holderPid is in
 * pg_blocking_pids(waiter)). Polls every 50 ms on the observer connection. Rejects after
 * timeoutMs with an error naming the listed PIDs that were not blocked by that holder.
 * Throws at once, before any query, when waiterPids is empty.
 */
export async function waitForBlockedBy(
  observer: RawQueryClient,
  holderPid: number,
  waiterPids: readonly number[],
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  if (waiterPids.length === 0) {
    throw new Error("waitForBlockedBy: waiterPids must name at least one recorded PID");
  }
  const wanted = [...new Set(waiterPids)];
  const deadline = Date.now() + timeoutMs;
  let missing = wanted;
  for (;;) {
    const rows = await observer.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE pid = ANY(${wanted}::int[])
        AND ${holderPid}::int = ANY(pg_blocking_pids(pid))
    `;
    const blocked = new Set(rows.map((r) => Number(r.pid)));
    missing = wanted.filter((pid) => !blocked.has(pid));
    if (missing.length === 0) return;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `waitForBlockedBy: PID(s) ${missing.join(", ")} not blocked by holder ${holderPid} within ${timeoutMs} ms`,
  );
}
