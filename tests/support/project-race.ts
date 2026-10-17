// Test-only race harness of Phase 14 (contract section 17, C17): the one style every projects race
// test uses. Every proof records each run's backend PID itself, through the service observer
// (setProjectServiceObserverForTests) or inside the test's own raw transaction, and then waits
// for exactly that waiter PID to be blocked by the holder PID (waitForBlockedBy of lock-wait.ts on
// the one-connection observer client). Never a sleep. Every settled promise is checked for 40P01.
// Relative imports only.
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { type ProjectDb, setProjectServiceObserverForTests } from "../../src/lib/projects/service";
import { backendPid, type Deferred, deferred } from "./lock-wait";

/** A one-connection client for waitForBlockedBy (shape of kb-proposal-publish-race.test.ts). */
export function createObserverClient(): { client: PrismaClient; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    client,
    close: async () => {
      await client.$disconnect();
      await pool.end();
    },
  };
}

export interface ServiceRace {
  /** Resolves with the PID of the first transaction of `operation` to reach afterLock or afterReadCheck, parked there. */
  holdAt(operation: string): Promise<number>;
  /** Resolves with the PID of the next transaction of `operation` to start. */
  nextStartPid(operation: string): Promise<number>;
  /** Releases every parked transaction. */
  release(): void;
  /** Releases every parked transaction and removes the observer (call in afterEach). */
  clear(): void;
}

/** Installs the service observer and returns the race controls. */
export function createServiceRace(): ServiceRace {
  const holds = new Map<string, Deferred<number>>();
  const starts = new Map<string, Deferred<number>[]>();
  const parked: Deferred<void>[] = [];
  let released = false;

  async function park(tx: ProjectDb, operation: string) {
    const hold = holds.get(operation);
    if (!hold || released) return;
    holds.delete(operation);
    const gate = deferred<void>();
    parked.push(gate);
    hold.resolve(await backendPid(tx));
    await gate.promise;
  }

  setProjectServiceObserverForTests({
    async onTransactionStart(tx: ProjectDb, operation: string) {
      const waiting = starts.get(operation);
      const next = waiting?.shift();
      if (next) next.resolve(await backendPid(tx));
    },
    afterLock: park,
    // Reads park at the same gate, after their access check (K73).
    afterReadCheck: park,
  });

  const release = () => {
    for (const gate of parked.splice(0)) gate.resolve();
  };

  return {
    holdAt(operation) {
      const d = deferred<number>();
      holds.set(operation, d);
      return d.promise;
    },
    nextStartPid(operation) {
      const d = deferred<number>();
      const list = starts.get(operation) ?? [];
      list.push(d);
      starts.set(operation, list);
      return d.promise;
    },
    release,
    clear() {
      released = true;
      release();
      holds.clear();
      starts.clear();
      setProjectServiceObserverForTests(null);
    },
  };
}

/** Waits for every promise to settle. */
export async function settleAll<T>(promises: Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(promises);
}

/** Fails when any settled promise rejected with a deadlock (40P01 in its code or message). */
export function assertNoDeadlock(results: readonly PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status !== "rejected") continue;
    let current: unknown = result.reason;
    for (let depth = 0; current && depth < 5; depth++) {
      const e = current as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
      const text = `${String(e.code ?? "")} ${String(e.message ?? "")} ${JSON.stringify(e.meta ?? {})}`;
      if (text.includes("40P01")) throw new Error(`deadlock (40P01): ${String(e.message ?? "")}`);
      current = e.cause;
    }
  }
}
