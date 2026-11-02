import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";

// One pool and one Prisma client per process, in every environment (K138, Codex diff critique 2
// item 3). A production build may instantiate this module once per route bundle, and a dev hot
// reload re-evaluates it; both then reuse the pool and the client kept on globalThis under these
// registered symbols, as the health state does. So DB_POOL_MAX bounds the whole process, and
// dbPoolWaitingCount (K132) reads the pool every route really uses. The worker is its own
// process and so builds its own pool, with its own DB_POOL_MAX.
const POOL_KEY = Symbol.for("aida.db.pool");
const PRISMA_KEY = Symbol.for("aida.db.prisma");
const g = globalThis as typeof globalThis & {
  [POOL_KEY]?: pg.Pool;
  [PRISMA_KEY]?: PrismaClient;
};

let pool = g[POOL_KEY];
if (!pool) {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Sized so app_pool + worker_pool < Postgres max_connections (default 100)
    // Compose sets DB_POOL_MAX=10 for app and DB_POOL_MAX=5 for worker (total 15)
    max: Number(process.env.DB_POOL_MAX) || 10,
  });
  g[POOL_KEY] = pool;
}
const sharedPool: pg.Pool = pool;

let client = g[PRISMA_KEY];
if (!client) {
  client = new PrismaClient({ adapter: new PrismaPg(sharedPool) });
  g[PRISMA_KEY] = client;
}
export const prisma: PrismaClient = client;

/**
 * Connect requests queued in this process's pool, waiting for a free connection. Read by the
 * rate limiter's admission check (K132) so it does not add to an already queued pool.
 */
export function dbPoolWaitingCount(): number {
  return sharedPool.waitingCount;
}
