import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pgPool?: pg.Pool };
// Kept with the cached client in development, so dbPoolWaitingCount reads the pool that client
// actually uses after a hot reload.
const pool =
  globalForPrisma.pgPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Sized so app_pool + worker_pool < Postgres max_connections (default 100)
    // Compose sets DB_POOL_MAX=10 for app and DB_POOL_MAX=5 for worker (total 15)
    max: Number(process.env.DB_POOL_MAX) || 10,
  });
const adapter = new PrismaPg(pool);
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}

/**
 * Connect requests queued in this process's pool, waiting for a free connection. Read by the
 * rate limiter's admission check (K132) so it does not add to an already queued pool.
 */
export function dbPoolWaitingCount(): number {
  return pool.waitingCount;
}
