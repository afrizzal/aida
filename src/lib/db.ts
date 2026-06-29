import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Sized so app_pool + worker_pool < Postgres max_connections (default 100)
  // Compose sets DB_POOL_MAX=10 for app and DB_POOL_MAX=5 for worker (total 15)
  max: Number(process.env.DB_POOL_MAX) || 10,
});
const adapter = new PrismaPg(pool);
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
