// Review C9 (D-08, D-16): a ticket that was PENDING when 20261110100000_ticket_states ran resumes
// correctly. A populated pre-12.1 database is migrated in plan 12.1-03's harness container; one
// migrated PENDING ticket is then resumed to Open through the real runTicketMutation with the
// clock at the migration's pause start plus 37 minutes and 250 milliseconds.
//
// Containers (review R2-4): `pnpm test:integration` runs the global setup, which starts its own
// Testcontainers container; this file starts the harness's Testcontainers container in beforeAll
// and stops it in afterAll. Both are removed after the run; no other container is touched.
//
// The real transition runs against the harness database through a fresh module graph: the
// global client is saved, DATABASE_URL points at the harness database, modules are reset and
// imported again. The fresh graph's "@/lib/db" is a new Prisma client on a pg pool this file owns
// (vi.doMock), because src/lib/db.ts does not expose its pool and Prisma's $disconnect leaves a
// caller-supplied pool open: its idle connections would then fail with 57P01 when the container
// stops. afterAll disconnects the client, ends the pool, restores DATABASE_URL and the global
// client and resets modules again, so nothing else in the run talks to this database. Every expected value comes from the
// pre-migration reads and the migration's pause start M, never from the current clock.

import { appendFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import {
  applyMigrations,
  connect,
  createDatabase,
  databaseUrl,
  startMigrationContainer,
} from "../support/migration-harness";
import { type SeededPre121, seedPopulatedPre121 } from "../support/migration-seed";

const BASELINE = "20261109100000_ticket_lifecycle";
const STATES_MIGRATION = "20261110100000_ticket_states";
const DATABASE = "sla_pause_migrated";
/** 37 minutes and 250 milliseconds. */
const PAUSE_MS = 2220250;

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let db: pg.Client;
let seed: SeededPre121;

let freshPool: pg.Pool | undefined;
let freshPrisma: PrismaClient | undefined;
let savedUrl: string | undefined;
let savedPrisma: unknown;

interface Deadlines {
  first: number;
  resolution: number;
}

/** Epoch milliseconds of both deadlines, read in SQL so no client time zone is involved. */
async function deadlines(ticketId: string): Promise<Deadlines> {
  const r = await db.query<{ first: string; resolution: string }>(
    `SELECT (extract(epoch FROM "firstResponseDueAt") * 1000)::bigint::text AS first,
            (extract(epoch FROM "resolutionDueAt") * 1000)::bigint::text AS resolution
     FROM "Ticket" WHERE id = $1`,
    [ticketId],
  );
  return { first: Number(r.rows[0].first), resolution: Number(r.rows[0].resolution) };
}

async function rowJson(ticketId: string): Promise<unknown> {
  const r = await db.query<{ row: unknown }>(
    `SELECT to_jsonb(t) AS row FROM "Ticket" t WHERE id = $1`,
    [ticketId],
  );
  return r.rows[0].row;
}

/** The database clock in epoch milliseconds, truncated like the migration's pause start. */
async function dbClockMs(): Promise<number> {
  const r = await db.query<{ ms: string }>(
    `SELECT (extract(epoch FROM date_trunc('milliseconds', clock_timestamp())) * 1000)::bigint::text AS ms`,
  );
  return Number(r.rows[0].ms);
}

let pendingId: string;
let openId: string;
let pendingBefore: Deadlines;
let openBefore: Deadlines;
let openRowAfterMigration: unknown;
let pauseStart: number;
let clockBefore: number;
let clockAfter: number;

beforeAll(async () => {
  container = await startMigrationContainer();
  admin = await connect(container, "aida_migration");
  await createDatabase(admin, DATABASE);
  db = await connect(container, DATABASE);
  await applyMigrations(db, { through: BASELINE });
  seed = await seedPopulatedPre121(db);
  pendingId = seed.tickets.a.PENDING[0];
  openId = seed.tickets.a.OPEN[0];
  pendingBefore = await deadlines(pendingId);
  openBefore = await deadlines(openId);

  clockBefore = await dbClockMs();
  await applyMigrations(db, { only: STATES_MIGRATION });
  clockAfter = await dbClockMs();

  const paused = await db.query<{ ms: string | null }>(
    `SELECT (extract(epoch FROM "slaPausedAt") * 1000)::bigint::text AS ms FROM "Ticket" WHERE id = $1`,
    [pendingId],
  );
  pauseStart = Number(paused.rows[0].ms);
  openRowAfterMigration = await rowJson(openId);

  const g = globalThis as unknown as { prisma?: unknown };
  savedUrl = process.env.DATABASE_URL;
  savedPrisma = g.prisma;
  process.env.DATABASE_URL = databaseUrl(container, DATABASE);
  vi.resetModules();
  delete g.prisma;
  freshPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const client = new PrismaClient({ adapter: new PrismaPg(freshPool) });
  freshPrisma = client;
  vi.doMock("@/lib/db", () => ({ prisma: client }));
}, 180_000);

afterAll(async () => {
  if (freshPrisma) await freshPrisma.$disconnect();
  if (freshPool) await freshPool.end();
  vi.doUnmock("@/lib/db");
  const g = globalThis as unknown as { prisma?: unknown };
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
  g.prisma = savedPrisma;
  vi.resetModules();
  await db?.end();
  await admin?.end();
  await container?.stop();
}, 120_000);

describe("resume of a ticket that was PENDING at migration time (review C9)", () => {
  it("moves both deadlines and slaPausedMs by exactly the time since the migration's pause start", async () => {
    // The migration started the pause inside the window of the one-query apply (plan 12.1-03).
    expect(pauseStart).toBeGreaterThanOrEqual(clockBefore);
    expect(pauseStart).toBeLessThanOrEqual(clockAfter);

    const { prisma } = await import("@/lib/db");
    expect(prisma).toBe(freshPrisma);
    const { runTicketMutation } = await import("@/lib/tickets/mutations");
    const { readLegacyStateIds } = await import("@/lib/tickets/ticket-states");
    const ids = await readLegacyStateIds(prisma, seed.orgs.a);
    const pendingState = ids.PENDING as string;
    const openState = ids.OPEN as string;
    expect(pendingState).toBeTruthy();
    expect(openState).toBeTruthy();

    const auditBefore = await db.query<{ id: string }>(
      `SELECT id FROM "TicketAuditEvent" WHERE "ticketId" = $1`,
      [pendingId],
    );
    const result = await runTicketMutation(
      {
        actor: { orgId: seed.orgs.a, userId: seed.users.a1 },
        ticketIds: [pendingId],
        op: { kind: "state", stateId: openState },
        mode: "single",
      },
      { clock: () => new Date(pauseStart + PAUSE_MS) },
    );
    expect(result).toMatchObject({ ok: true, count: 1 });

    expect(await deadlines(pendingId)).toEqual({
      first: pendingBefore.first + PAUSE_MS,
      resolution: pendingBefore.resolution + PAUSE_MS,
    });
    const after = await db.query<{
      slaPausedMs: string;
      slaPausedAt: Date | null;
      resolvedAt: Date | null;
      stateId: string;
    }>(
      `SELECT "slaPausedMs"::text AS "slaPausedMs", "slaPausedAt", "resolvedAt", "stateId"
       FROM "Ticket" WHERE id = $1`,
      [pendingId],
    );
    expect(after.rows[0]).toEqual({
      slaPausedMs: String(PAUSE_MS),
      slaPausedAt: null,
      resolvedAt: null,
      stateId: openState,
    });

    const known = new Set(auditBefore.rows.map((r) => r.id));
    const audit = await db.query<{ id: string; action: string; before: unknown; after: unknown }>(
      `SELECT id, action, before, after FROM "TicketAuditEvent" WHERE "ticketId" = $1`,
      [pendingId],
    );
    const added = audit.rows.filter((r) => !known.has(r.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      action: "STATUS_CHANGED",
      before: { stateId: pendingState, stateGroup: "PENDING" },
      after: { stateId: openState, stateGroup: "OPEN" },
    });

    // Run evidence for the SUMMARY, only when the executor names a file for it.
    const evidenceFile = process.env.AIDA_P121_06_EVIDENCE;
    if (evidenceFile) {
      const moved = await deadlines(pendingId);
      appendFileSync(
        evidenceFile,
        `${JSON.stringify({
          M: new Date(pauseStart).toISOString(),
          clock: new Date(pauseStart + PAUSE_MS).toISOString(),
          before: {
            first: new Date(pendingBefore.first).toISOString(),
            resolution: new Date(pendingBefore.resolution).toISOString(),
          },
          after: {
            first: new Date(moved.first).toISOString(),
            resolution: new Date(moved.resolution).toISOString(),
          },
        })}\n`,
      );
    }

    // The ticket that was not pending is unchanged.
    expect(await deadlines(openId)).toEqual(openBefore);
    expect(await rowJson(openId)).toEqual(openRowAfterMigration);
  });
});
