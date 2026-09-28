// Phase 12.1 migration proofs on the harness path (D-10 amended, D-08, D-09, D-16, review C8).
//
// Every case runs in its own database of this file's own Testcontainers container, never in the
// shared integration container: the migrations up to 20261109100000_ticket_lifecycle are applied
// in folder order, pre-12.1 data is seeded with raw SQL, then 20261110100000_ticket_states is
// applied with one client.query call. The real `prisma migrate deploy` path is proven separately
// in tests/integration/ticket-states-deploy.test.ts (review C2).
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyMigrations,
  connect,
  createDatabase,
  startMigrationContainer,
} from "../support/migration-harness";

const BASELINE = "20261109100000_ticket_lifecycle";
const STATES_MIGRATION = "20261110100000_ticket_states";

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
const clients: pg.Client[] = [];

/** A fresh database of the harness container with the migrations through the Phase 12 baseline. */
async function baselineDatabase(name: string): Promise<pg.Client> {
  await createDatabase(admin, name);
  const client = await connect(container, name);
  clients.push(client);
  await applyMigrations(client, { through: BASELINE });
  return client;
}

beforeAll(async () => {
  container = await startMigrationContainer();
  admin = await connect(container, "aida_migration");
}, 120_000);

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await container?.stop();
});

describe("ticket_states migration, harness path: tracer", () => {
  it("maps each ticket of one organization to its own state with the same legacy key", async () => {
    const db = await baselineDatabase("tracer");
    const ts = "2001-02-03T04:05:06.789Z";
    await db.query(
      `INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES ('org-t', 'Tracer', 'tracer', $1)`,
      [ts],
    );
    await db.query(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES ('user-t', 'Tracer Agent', 'agent@tracer.test', true, $1, $1)`,
      [ts],
    );
    await db.query(
      `INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
       VALUES ('member-t', 'org-t', 'user-t', 'owner', $1)`,
      [ts],
    );
    await db.query(
      `INSERT INTO "Contact" ("id", "organizationId", "email", "createdAt", "updatedAt")
       VALUES ('contact-t', 'org-t', 'customer@tracer.test', $1, $1)`,
      [ts],
    );
    const statuses = ["NEW", "OPEN", "PENDING", "RESOLVED", "CLOSED"];
    for (const [i, status] of statuses.entries()) {
      await db.query(
        `INSERT INTO "Ticket" ("id", "organizationId", "number", "statusToken", "subject", "status",
           "priority", "contactId", "firstResponseTargetMinutes", "resolutionTargetMinutes",
           "firstResponseDueAt", "resolutionDueAt", "isAtRisk", "isBreached", "createdAt", "updatedAt")
         VALUES ($1, 'org-t', $2, $3, $4, $5::"TicketStatus", 'NORMAL', 'contact-t', 60, 480,
           $6, $6, false, false, $6, $6)`,
        [`ticket-${status}`, i + 1, `token-${status}`, `Ticket ${status}`, status, ts],
      );
    }

    await applyMigrations(db, { only: STATES_MIGRATION });

    const rows = await db.query<{
      id: string;
      stateId: string;
      legacyStatus: string;
      group: string;
      stateOrg: string;
    }>(
      `SELECT t."id", t."stateId", s."legacyStatus", s."group"::text AS "group", s."organizationId" AS "stateOrg"
       FROM "Ticket" t JOIN "TicketState" s ON s."id" = t."stateId" ORDER BY t."id"`,
    );
    expect(rows.rows).toHaveLength(5);
    for (const row of rows.rows) {
      expect(row.stateOrg).toBe("org-t");
      expect(`ticket-${row.legacyStatus}`).toBe(row.id);
    }
    const byId = new Map(rows.rows.map((r) => [r.id, r]));
    expect(byId.get("ticket-NEW")?.stateId).not.toBe(byId.get("ticket-OPEN")?.stateId);
    expect(byId.get("ticket-NEW")?.group).toBe("OPEN");
    expect(byId.get("ticket-OPEN")?.group).toBe("OPEN");

    const states = await db.query(`SELECT 1 FROM "TicketState" WHERE "organizationId" = 'org-t'`);
    expect(states.rowCount).toBe(5);
    const config = await db.query(
      `SELECT 1 FROM "TicketStateConfig" WHERE "organizationId" = 'org-t'`,
    );
    expect(config.rowCount).toBe(1);
  });
});
