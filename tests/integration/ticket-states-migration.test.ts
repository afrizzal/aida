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
  assertFixtureCoverage,
  connect,
  createDatabase,
  listMigrationFolders,
  snapshotTables,
  startMigrationContainer,
  type TableSnapshot,
} from "../support/migration-harness";
import {
  FIXTURE_TIMESTAMP_VALUES,
  type SeededPre121,
  seedPopulatedPre121,
} from "../support/migration-seed";

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

/** Epoch milliseconds of the database clock, truncated to milliseconds like the migration's now(). */
async function dbClockMs(db: pg.Client): Promise<number> {
  const r = await db.query<{ ms: string }>(
    `SELECT (extract(epoch FROM date_trunc('milliseconds', clock_timestamp())) * 1000)::bigint::text AS ms`,
  );
  return Number(r.rows[0].ms);
}

// Insight window covering every fixture createdAt (all before 2005).
const INSIGHT_START = "1990-01-01T00:00:00.000Z";
const INSIGHT_END = "2010-01-01T00:00:00.000Z";

/**
 * The SLA and CSAT aggregates of src/lib/insight/sla-csat.ts (computeSlaCsat: the three ticket
 * counts at lines 58-64, avgDurationSeconds at lines 17-41, the CSAT aggregate and distribution at
 * lines 72-84), copied as SQL with the organization term (D-11 Insight row).
 */
async function insightAggregates(db: pg.Client, orgId: string) {
  const params = [orgId, INSIGHT_START, INSIGHT_END];
  const window = `"organizationId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3`;
  const counts = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE "isBreached" = true)::int AS breached,
            count(*) FILTER (WHERE "isAtRisk" = true AND "isBreached" = false)::int AS "atRiskOnly"
     FROM "Ticket" WHERE ${window}`,
    params,
  );
  const firstResponse = await db.query(
    `SELECT AVG(EXTRACT(EPOCH FROM ("firstRespondedAt" - "createdAt")))::float AS "avgSeconds"
     FROM "Ticket" WHERE ${window} AND "firstRespondedAt" IS NOT NULL`,
    params,
  );
  const resolution = await db.query(
    `SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")))::float AS "avgSeconds"
     FROM "Ticket" WHERE ${window} AND "resolvedAt" IS NOT NULL`,
    params,
  );
  const csat = await db.query(
    `SELECT COUNT(*)::int AS "responseCount", AVG(cr.score)::float AS "averageScore"
     FROM "CsatResponse" cr JOIN "Ticket" t ON t.id = cr."ticketId"
     WHERE cr."organizationId" = $1 AND t."createdAt" >= $2 AND t."createdAt" < $3`,
    params,
  );
  const distribution = await db.query(
    `SELECT cr.score AS score, COUNT(*)::int AS count
     FROM "CsatResponse" cr JOIN "Ticket" t ON t.id = cr."ticketId"
     WHERE cr."organizationId" = $1 AND t."createdAt" >= $2 AND t."createdAt" < $3
     GROUP BY cr.score ORDER BY cr.score`,
    params,
  );
  return {
    counts: counts.rows[0],
    avgFirstResponseSeconds: firstResponse.rows[0].avgSeconds,
    avgResolutionSeconds: resolution.rows[0].avgSeconds,
    csat: csat.rows[0],
    distribution: distribution.rows,
  };
}

/** The organization's state id for each legacy key. */
async function statesByLegacy(db: pg.Client, orgId: string): Promise<Record<string, string>> {
  const r = await db.query<{ id: string; legacyStatus: string }>(
    `SELECT "id", "legacyStatus" FROM "TicketState" WHERE "organizationId" = $1`,
    [orgId],
  );
  return Object.fromEntries(r.rows.map((row) => [row.legacyStatus, row.id]));
}

const AUDIT_COLUMNS = `"id", "organizationId", "ticketId", "actorType"::text, "actorUserId", "action"::text,
  "before", "after", "batchId", "createdAt"`;

describe("ticket_states migration, harness path: populated data across three organizations", () => {
  let db: pg.Client;
  let seed: SeededPre121;
  let uncovered: string[];
  let before: TableSnapshot;
  let after: TableSnapshot;
  let ticketsBefore: Record<string, unknown>[];
  let auditBefore: Record<string, unknown>[];
  let viewsBefore: { id: string; filters: Record<string, unknown>; updatedAt: Date }[];
  let insightBefore: Record<string, unknown>;
  let objectsBefore: string[];
  let clockBefore: number;
  let clockAfter: number;

  const objectNames = async () =>
    (
      await db.query<{ name: string }>(
        `SELECT 'constraint:' || conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace
         UNION ALL SELECT 'index:' || indexname FROM pg_indexes WHERE schemaname = 'public'
         UNION ALL SELECT 'trigger:' || tgname FROM pg_trigger WHERE NOT tgisinternal
         UNION ALL SELECT 'column:' || table_name || '.' || column_name FROM information_schema.columns
           WHERE table_schema = 'public'
         ORDER BY 1`,
      )
    ).rows.map((r) => r.name);

  beforeAll(async () => {
    db = await baselineDatabase("populated");
    seed = await seedPopulatedPre121(db);

    uncovered = await assertFixtureCoverage(db, ["organization", "Ticket", "SavedView"], {
      fixtureTimestamps: FIXTURE_TIMESTAMP_VALUES,
    });
    before = await snapshotTables(db, { exclude: ["Ticket.status", "SavedView.filters"] });
    ticketsBefore = (
      await db.query(
        `SELECT "id", "organizationId", "firstResponseDueAt", "resolutionDueAt", "isAtRisk", "isBreached",
           "firstRespondedAt", "resolvedAt", "createdAt", "updatedAt" FROM "Ticket" ORDER BY "id"`,
      )
    ).rows;
    auditBefore = (await db.query(`SELECT ${AUDIT_COLUMNS} FROM "TicketAuditEvent" ORDER BY "id"`))
      .rows;
    viewsBefore = (
      await db.query(`SELECT "id", "filters", "updatedAt" FROM "SavedView" ORDER BY "id"`)
    ).rows;
    insightBefore = {};
    for (const org of Object.values(seed.orgs))
      insightBefore[org] = await insightAggregates(db, org);
    objectsBefore = await objectNames();

    clockBefore = await dbClockMs(db);
    await applyMigrations(db, { only: STATES_MIGRATION });
    clockAfter = await dbClockMs(db);

    after = await snapshotTables(db, { restrictTo: before.columns });
  }, 120_000);

  it("seeds a non-null, non-default fixture value in every pre-existing column of organization, Ticket and SavedView", () => {
    expect(uncovered).toEqual([]);
  });

  it("leaves every pre-existing column of every pre-existing table equal, except Ticket.status and SavedView.filters", () => {
    expect(Object.keys(after.columns)).toEqual(Object.keys(before.columns));
    expect(after.columns).toEqual(before.columns);
    for (const table of Object.keys(before.rows)) {
      expect({ table, rows: after.rows[table] }).toEqual({ table, rows: before.rows[table] });
    }
    // The snapshot is not vacuous: the seeded tables hold rows.
    expect(before.rows.Ticket).toHaveLength(9);
    expect(before.rows.SavedView).toHaveLength(4);
    expect(before.rows.organization).toHaveLength(3);
  });

  it("keeps per-organization ticket ids, counts, deadlines, flags and timestamps", async () => {
    const rows = (
      await db.query(
        `SELECT "id", "organizationId", "firstResponseDueAt", "resolutionDueAt", "isAtRisk", "isBreached",
           "firstRespondedAt", "resolvedAt", "createdAt", "updatedAt" FROM "Ticket" ORDER BY "id"`,
      )
    ).rows;
    expect(rows).toEqual(ticketsBefore);
    const perOrg = await db.query<{ organizationId: string; n: number }>(
      `SELECT "organizationId", count(*)::int AS n FROM "Ticket" GROUP BY 1 ORDER BY 1`,
    );
    expect(perOrg.rows).toEqual([
      { organizationId: seed.orgs.a, n: 7 },
      { organizationId: seed.orgs.b, n: 2 },
    ]);
    const pausedMs = await db.query(`SELECT DISTINCT "slaPausedMs"::text AS v FROM "Ticket"`);
    expect(pausedMs.rows).toEqual([{ v: "0" }]);
  });

  it("puts every ticket in the state of its own organization whose legacyStatus is its old value", async () => {
    const r = await db.query<{
      id: string;
      ticketOrg: string;
      stateOrg: string;
      legacyStatus: string;
    }>(
      `SELECT t."id", t."organizationId" AS "ticketOrg", s."organizationId" AS "stateOrg", s."legacyStatus"
       FROM "Ticket" t JOIN "TicketState" s ON s."id" = t."stateId" ORDER BY t."id"`,
    );
    expect(r.rows).toHaveLength(9);
    for (const row of r.rows) {
      expect(row.stateOrg).toBe(row.ticketOrg);
      expect(row.legacyStatus).toBe(seed.statusById[row.id]);
    }
  });

  it("starts the pause of every PENDING ticket at one migration instant and of no other ticket", async () => {
    const r = await db.query<{ id: string; ms: string | null }>(
      `SELECT "id", (extract(epoch FROM "slaPausedAt") * 1000)::bigint::text AS ms FROM "Ticket" ORDER BY "id"`,
    );
    const pending = new Set([...seed.tickets.a.PENDING, ...seed.tickets.b.PENDING]);
    expect(pending.size).toBe(3);
    const instants = new Set<number>();
    for (const row of r.rows) {
      if (pending.has(row.id)) {
        expect(row.ms).not.toBeNull();
        instants.add(Number(row.ms));
      } else {
        expect(row.ms).toBeNull();
      }
    }
    expect(instants.size).toBe(1);
    const [instant] = [...instants];
    expect(instant).toBeGreaterThanOrEqual(clockBefore);
    expect(instant).toBeLessThanOrEqual(clockAfter);
  });

  it("converts saved views to version 2 with sorted stateIds and every other key and updatedAt unchanged", async () => {
    const statesA = await statesByLegacy(db, seed.orgs.a);
    const statesB = await statesByLegacy(db, seed.orgs.b);
    const rows = (
      await db.query(`SELECT "id", "filters", "updatedAt" FROM "SavedView" ORDER BY "id"`)
    ).rows;
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    for (const view of viewsBefore) {
      const now = byId.get(view.id);
      expect(now?.updatedAt).toEqual(view.updatedAt);
      const { version: _v1, statuses: _s, ...rest } = view.filters;
      const { version, stateIds, ...restAfter } = now?.filters as Record<string, unknown>;
      expect(version).toBe(2);
      expect(restAfter).toEqual(rest);
      expect(Array.isArray(stateIds)).toBe(true);
    }
    const expectedA = [statesA.PENDING, statesA.OPEN].sort();
    expect(byId.get(seed.savedViews.aPrivate)?.filters).toEqual({
      version: 2,
      stateIds: expectedA,
      view: "mine",
      tagId: seed.tagId,
      cf: { definitionId: seed.fieldId, value: "gold" },
      q: "refund",
      snoozed: true,
    });
    // Code-unit order, exactly as stored (the AIDA-56 ordering edge).
    expect((byId.get(seed.savedViews.aShared)?.filters as { stateIds: string[] }).stateIds).toEqual(
      expectedA,
    );
    expect(byId.get(seed.savedViews.aEmpty)?.filters).toEqual({
      version: 2,
      view: "all",
      stateIds: [],
    });
    expect((byId.get(seed.savedViews.bShared)?.filters as { stateIds: string[] }).stateIds).toEqual(
      [statesB.RESOLVED, statesB.NEW, statesB.CLOSED].sort(),
    );
  });

  it("leaves every TicketAuditEvent row untouched", async () => {
    const rows = (await db.query(`SELECT ${AUDIT_COLUMNS} FROM "TicketAuditEvent" ORDER BY "id"`))
      .rows;
    expect(rows).toHaveLength(4);
    expect(rows).toEqual(auditBefore);
  });

  it("gives every organization, including the one without tickets or views, five states and a config row", async () => {
    for (const org of Object.values(seed.orgs)) {
      const states = await db.query(
        `SELECT "legacyStatus", "group"::text AS "group" FROM "TicketState" WHERE "organizationId" = $1
         ORDER BY "sortOrder"`,
        [org],
      );
      expect(states.rows).toEqual([
        { legacyStatus: "NEW", group: "OPEN" },
        { legacyStatus: "OPEN", group: "OPEN" },
        { legacyStatus: "PENDING", group: "PENDING" },
        { legacyStatus: "RESOLVED", group: "RESOLVED" },
        { legacyStatus: "CLOSED", group: "CLOSED" },
      ]);
      const config = await db.query(
        `SELECT 1 FROM "TicketStateConfig" WHERE "organizationId" = $1`,
        [org],
      );
      expect(config.rowCount).toBe(1);
    }
  });

  it("refuses a state of organization B on a ticket of organization A (composite foreign key)", async () => {
    const statesB = await statesByLegacy(db, seed.orgs.b);
    let code: string | undefined;
    let message = "";
    try {
      await db.query(`UPDATE "Ticket" SET "stateId" = $1 WHERE "id" = $2`, [
        statesB.OPEN,
        seed.tickets.a.OPEN[0],
      ]);
    } catch (err) {
      code = (err as { code?: string }).code;
      message = String((err as Error).message);
    }
    expect(code).toBe("23503");
    expect(message).toContain("Ticket_organizationId_stateId_fkey");
  });

  it("keeps the Insight SLA and CSAT aggregates of every organization equal", async () => {
    for (const org of Object.values(seed.orgs)) {
      expect(await insightAggregates(db, org)).toEqual(insightBefore[org]);
    }
    // Not vacuous: organization A has CSAT responses and SLA flags in the window.
    const a = insightBefore[seed.orgs.a] as {
      counts: { total: number; breached: number };
      csat: { responseCount: number };
    };
    expect(a.counts.total).toBe(7);
    expect(a.counts.breached).toBe(2);
    expect(a.csat.responseCount).toBe(2);
  });

  it("keeps the earlier hand-written objects and drops only the old status index and column", async () => {
    const objectsAfter = new Set(await objectNames());
    const missing = objectsBefore.filter((name) => !objectsAfter.has(name));
    expect(missing.sort()).toEqual([
      "column:Ticket.status",
      "index:Ticket_organizationId_status_idx",
    ]);
    expect(objectsAfter.has("column:Ticket.searchVector")).toBe(true);
    expect(objectsAfter.has("constraint:Ticket_merge_fields_check")).toBe(true);
    expect(objectsAfter.has("trigger:aida_ticket_audit_event_no_update_delete")).toBe(true);
  });
});

describe("ticket_states migration, harness path: fresh install", () => {
  it("applies every migration to an empty database and seeds states for an organization inserted afterwards", async () => {
    await createDatabase(admin, "fresh");
    const db = await connect(container, "fresh");
    clients.push(db);
    const applied = await applyMigrations(db);
    // The whole chain in folder order; since review WR-01 the phase migration is no longer the
    // last one (20261110110000_ticket_state_fk_on_update_restrict follows it).
    expect(applied).toEqual(listMigrationFolders());
    expect(applied).toContain(STATES_MIGRATION);
    await db.query(
      `INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES ('org-fresh', 'Fresh', 'fresh', $1)`,
      [FIXTURE_TIMESTAMP_VALUES[0]],
    );
    const states = await db.query(
      `SELECT 1 FROM "TicketState" WHERE "organizationId" = 'org-fresh'`,
    );
    expect(states.rowCount).toBe(5);
    const config = await db.query(
      `SELECT 1 FROM "TicketStateConfig" WHERE "organizationId" = 'org-fresh'`,
    );
    expect(config.rowCount).toBe(1);
  });
});

describe("fixture coverage check discriminates (review C8, review R2-3)", () => {
  it("reports default values and an insertion-time timestamp as uncovered", async () => {
    const db = await baselineDatabase("coverage_check");
    const ts = FIXTURE_TIMESTAMP_VALUES[0];
    await db.query(
      `INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES ('org-cc', 'Cov', 'cov', $1)`,
      [ts],
    );
    await db.query(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES ('user-cc', 'Cov Agent', 'agent@cov.test', true, $1, $1)`,
      [ts],
    );
    await db.query(
      `INSERT INTO "Contact" ("id", "organizationId", "email", "createdAt", "updatedAt")
       VALUES ('contact-cc', 'org-cc', 'c@cov.test', $1, $1)`,
      [ts],
    );
    // Priority, flags and status left to their defaults.
    await db.query(
      `INSERT INTO "Ticket" ("id", "organizationId", "number", "statusToken", "subject", "contactId",
         "firstResponseTargetMinutes", "resolutionTargetMinutes", "firstResponseDueAt", "resolutionDueAt",
         "createdAt", "updatedAt")
       VALUES ('ticket-cc', 'org-cc', 1, 'token-cc', 'Cov', 'contact-cc', 60, 480, $1, $1, $1, $1)`,
      [ts],
    );
    // createdAt filled in at insertion by its CURRENT_TIMESTAMP default.
    await db.query(
      `INSERT INTO "SavedView" ("id", "organizationId", "ownerUserId", "name", "visibility", "filters",
         "position", "updatedAt")
       VALUES ('view-cc', 'org-cc', 'user-cc', 'Cov', 'PRIVATE', '{"version":1,"view":"all","statuses":[]}', 0, $1)`,
      [ts],
    );
    const uncovered = await assertFixtureCoverage(db, ["organization", "Ticket", "SavedView"], {
      fixtureTimestamps: FIXTURE_TIMESTAMP_VALUES,
    });
    expect(uncovered).toEqual(
      expect.arrayContaining([
        "organization.logo: no row holds a non-null value",
        "Ticket.status: no row holds a non-null non-default value",
        "Ticket.priority: no row holds a non-null non-default value",
        "Ticket.isAtRisk: no row holds a non-null non-default value",
        "Ticket.resolvedAt: no row holds a value",
        "SavedView.createdAt: 1 value(s) outside the fixture timestamps",
      ]),
    );
    expect(uncovered.some((u) => u.startsWith("SavedView.updatedAt"))).toBe(false);
  });
});

/** Full text of a Prisma or pg adapter error, including meta and the cause chain. */
// Copied from tests/integration/lifecycle-schema.test.ts (lines 21-41).
function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; message?: string; meta?: unknown; cause?: unknown };
    parts.push(String(e.code ?? ""), String(e.message ?? current), JSON.stringify(e.meta ?? {}));
    current = e.cause;
  }
  return parts.join(" ");
}

/** Resolves with the error text when the promise rejects; fails the test when it resolves. */
async function rejection(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return errorText(err);
  }
  throw new Error("expected the operation to be rejected");
}

describe("ticket_states migration, harness path: a malformed saved view rolls everything back (D-09, D-10)", () => {
  const cases: { name: string; filters: string; expected: string }[] = [
    {
      name: "rollback_unknown",
      filters: JSON.stringify({ version: 1, view: "all", statuses: ["ARCHIVED"] }),
      expected: "has an unknown status value",
    },
    { name: "rollback_string", filters: JSON.stringify("oops"), expected: "has malformed filters" },
    {
      name: "rollback_version",
      filters: JSON.stringify({ version: 3, view: "all", statuses: [] }),
      expected: "has malformed filters",
    },
    {
      name: "rollback_not_array",
      filters: JSON.stringify({ version: 1, view: "all", statuses: "OPEN" }),
      expected: "has malformed filters",
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name}: rejects with the view id and '${testCase.expected}', and changes nothing`, async () => {
      const db = await baselineDatabase(testCase.name);
      const t = FIXTURE_TIMESTAMP_VALUES;
      const viewId = `view-${testCase.name}`;
      await db.query(
        `INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES ('org-r', 'R', 'r', $1)`,
        [t[0]],
      );
      await db.query(
        `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
         VALUES ('user-r', 'R Agent', 'agent@r.test', true, $1, $2)`,
        [t[1], t[2]],
      );
      await db.query(
        `INSERT INTO "Contact" ("id", "organizationId", "email", "createdAt", "updatedAt")
         VALUES ('contact-r', 'org-r', 'c@r.test', $1, $2)`,
        [t[3], t[4]],
      );
      await db.query(
        `INSERT INTO "Ticket" ("id", "organizationId", "number", "statusToken", "subject", "status",
           "contactId", "firstResponseTargetMinutes", "resolutionTargetMinutes", "firstResponseDueAt",
           "resolutionDueAt", "createdAt", "updatedAt")
         VALUES ('ticket-r', 'org-r', 1, 'token-r', 'R', 'PENDING', 'contact-r', 60, 480, $1, $2, $3, $4)`,
        [t[5], t[6], t[7], t[8]],
      );
      await db.query(
        `INSERT INTO "SavedView" ("id", "organizationId", "ownerUserId", "name", "visibility", "filters",
           "position", "createdAt", "updatedAt")
         VALUES ($1, 'org-r', 'user-r', 'Bad view', 'SHARED', $2::jsonb, 0, $3, $4)`,
        [viewId, testCase.filters, t[9], t[10]],
      );
      const before = await snapshotTables(db);

      const text = await rejection(applyMigrations(db, { only: STATES_MIGRATION }));
      expect(text).toContain(viewId);
      expect(text).toContain(testCase.expected);

      const status = await db.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'Ticket' AND column_name = 'status'`,
      );
      expect(status.rowCount).toBe(1);
      const regclass = await db.query(`SELECT to_regclass('"TicketState"') AS r`);
      expect(regclass.rows[0].r).toBeNull();
      const enumType = await db.query(`SELECT 1 FROM pg_type WHERE typname = 'TicketStatus'`);
      expect(enumType.rowCount).toBe(1);
      expect(await snapshotTables(db)).toEqual(before);
    });
  }
});
