// Phase 12.2 schema proofs (AIDA-18, D-03, D-04, D-12, D-16): the KB proposal tables, their
// database-enforced tenancy, the status fence and the catalog. Unmocked, on the shared
// Testcontainers database.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import {
  seedOrgWithMembers,
  seedProposal,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";

// errorText and rejection: copied from tests/integration/ticket-states-schema.test.ts (test files
// do not import each other).
/** Full text of a Prisma or pg adapter error, including meta and the cause chain. */
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

// Captured from migration 20260701234808_ticket_search, copied from
// tests/integration/ticket-states-schema.test.ts: this phase's migration must not have rewritten
// the generated FTS columns or their GIN indexes.
const TICKET_SEARCH_EXPR = `(setweight(to_tsvector('simple'::regconfig, COALESCE((number)::text, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(subject, ''::text)), 'B'::"char"))`;
const MESSAGE_SEARCH_EXPR = `to_tsvector('english'::regconfig, COALESCE("bodyMarkdown", ''::text))`;
const TICKET_SEARCH_INDEXDEF = `CREATE INDEX "Ticket_searchVector_idx" ON public."Ticket" USING gin ("searchVector")`;
const MESSAGE_SEARCH_INDEXDEF = `CREATE INDEX "Message_searchVector_idx" ON public."Message" USING gin ("searchVector")`;

async function freshOrg(): Promise<string> {
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  return orgId;
}

interface ProposalInsert {
  status?: "GENERATING" | "DRAFT" | "REJECTED" | "PUBLISHED" | "FAILED";
  title?: string | null;
  bodyMarkdown?: string | null;
  version?: number;
  generationEpoch?: number;
  failureCode?: string | null;
  publishedArticleId?: string | null;
  publishedAt?: Date | null;
  publishedByUserId?: string | null;
  rejectedAt?: Date | null;
  rejectedByUserId?: string | null;
}

/**
 * Inserts one proposal with raw SQL, so constraint names reach the error text unchanged. Every
 * column not given takes the value a GENERATING row has (version 0, epoch 1, nothing set).
 */
async function insertProposal(orgId: string, row: ProposalInsert = {}): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "KbProposal"
      ("id", "organizationId", "status", "version", "generationEpoch", "title", "bodyMarkdown",
       "failureCode", "requestedByUserId", "publishedArticleId", "publishedAt", "publishedByUserId",
       "rejectedAt", "rejectedByUserId", "updatedAt")
    VALUES
      (${id}, ${orgId}, ${row.status ?? "GENERATING"}::"KbProposalStatus", ${row.version ?? 0},
       ${row.generationEpoch ?? 1}, ${row.title ?? null}, ${row.bodyMarkdown ?? null},
       ${row.failureCode ?? null}::"KbProposalFailureCode", ${randomUUID()},
       ${row.publishedArticleId ?? null}, ${row.publishedAt ?? null}::timestamp(3),
       ${row.publishedByUserId ?? null}, ${row.rejectedAt ?? null}::timestamp(3),
       ${row.rejectedByUserId ?? null}, now())`;
  return id;
}

async function insertArticle(orgId: string): Promise<string> {
  const row = await prisma.kbArticle.create({
    data: {
      organizationId: orgId,
      title: "Fixture article",
      slug: `fixture-${randomUUID()}`,
      bodyMarkdown: "Body",
      bodyHtml: "<p>Body</p>",
    },
    select: { id: true },
  });
  return row.id;
}

function setStatus(id: string, status: string) {
  return prisma.$executeRaw`
    UPDATE "KbProposal" SET "status" = ${status}::"KbProposalStatus" WHERE id = ${id}`;
}

describe("Phase 12.2 schema: a proposal and its sources (tracer)", () => {
  it("inserts a proposal with one source of its own organization and reads it back through scopedDb", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
    const ticket = await seedResolvedTicket(orgId);
    const db = scopedDb(orgId);
    const created = await (
      db.kbProposal.create as (a: { data: Record<string, unknown> }) => Promise<{ id: string }>
    )({ data: { requestedByUserId: users[0].id } });
    await (
      db.kbProposalSource.create as (a: { data: Record<string, unknown> }) => Promise<unknown>
    )({ data: { proposalId: created.id, ticketId: ticket.id, position: 1, citedSections: [] } });

    const row = await db.kbProposal.findFirst({
      where: { id: created.id },
      include: { sources: true },
    });
    expect(row?.status).toBe("GENERATING");
    expect(row?.version).toBe(0);
    expect(row?.generationEpoch).toBe(1);
    expect(row?.organizationId).toBe(orgId);
    expect(row?.sources).toHaveLength(1);
    expect(row?.sources[0]).toMatchObject({
      organizationId: orgId,
      ticketId: ticket.id,
      position: 1,
      snapshotSeq: null,
    });
  });

  it("refuses a source linking organization A's proposal to organization B's ticket", async () => {
    const a = await seedOrgWithMembers(prisma, ["admin"]);
    const b = await seedOrgWithMembers(prisma, ["admin"]);
    const ticketB = await seedResolvedTicket(b.orgId);
    const proposalA = await seedProposal(a.orgId, { status: "GENERATING", ticketIds: [] });
    const err = await rejection(
      prisma.kbProposalSource.create({
        data: {
          organizationId: a.orgId,
          proposalId: proposalA.id,
          ticketId: ticketB.id,
          position: 1,
          citedSections: [],
        },
      }),
    );
    expect(err).toContain("KbProposalSource_organizationId_ticketId_fkey");
  });
});

describe("Phase 12.2 schema: the status fence (D-16, aida_kb_proposal_status_fence)", () => {
  it("refuses REJECTED to PUBLISHED, even with every publish column set", async () => {
    const orgId = await freshOrg();
    const { id } = await seedProposal(orgId, { status: "REJECTED", ticketIds: [] });
    const articleId = await insertArticle(orgId);
    const text = await rejection(prisma.$executeRaw`
      UPDATE "KbProposal"
      SET "status" = 'PUBLISHED', "publishedArticleId" = ${articleId}, "publishedAt" = now(),
          "publishedByUserId" = 'someone', "rejectedAt" = NULL, "rejectedByUserId" = NULL
      WHERE id = ${id}`);
    expect(text).toContain("KbProposal status transition REJECTED -> PUBLISHED is not allowed");
    const row = await prisma.kbProposal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("REJECTED");
    expect(row.publishedArticleId).toBeNull();
  });

  it("refuses FAILED to DRAFT", async () => {
    const orgId = await freshOrg();
    const { id } = await seedProposal(orgId, { status: "FAILED", ticketIds: [] });
    expect(await rejection(setStatus(id, "DRAFT"))).toContain(
      "KbProposal status transition FAILED -> DRAFT is not allowed",
    );
  });

  it("refuses PUBLISHED to DRAFT", async () => {
    const orgId = await freshOrg();
    const { id } = await seedProposal(orgId, { status: "PUBLISHED", ticketIds: [] });
    expect(await rejection(setStatus(id, "DRAFT"))).toContain(
      "KbProposal status transition PUBLISHED -> DRAFT is not allowed",
    );
  });

  it("refuses DRAFT to GENERATING", async () => {
    const orgId = await freshOrg();
    const { id } = await seedProposal(orgId, { status: "DRAFT", ticketIds: [] });
    expect(await rejection(setStatus(id, "GENERATING"))).toContain(
      "KbProposal status transition DRAFT -> GENERATING is not allowed",
    );
  });

  it("refuses a body or article change on a PUBLISHED proposal ('KbProposal is final')", async () => {
    const orgId = await freshOrg();
    const { id } = await seedProposal(orgId, { status: "PUBLISHED", ticketIds: [] });
    expect(
      await rejection(
        prisma.$executeRaw`UPDATE "KbProposal" SET "bodyMarkdown" = 'changed' WHERE id = ${id}`,
      ),
    ).toContain("KbProposal is final");
    const otherArticle = await insertArticle(orgId);
    expect(
      await rejection(
        prisma.$executeRaw`UPDATE "KbProposal" SET "publishedArticleId" = ${otherArticle} WHERE id = ${id}`,
      ),
    ).toContain("KbProposal is final");
    const rejected = await seedProposal(orgId, { status: "REJECTED", ticketIds: [] });
    expect(
      await rejection(
        prisma.$executeRaw`UPDATE "KbProposal" SET "title" = 'New title' WHERE id = ${rejected.id}`,
      ),
    ).toContain("KbProposal is final");
  });

  // Review a-IN-01 (migration 20261112100000_kb_proposal_final_fence): a final row keeps its
  // actor, time, failure and version columns, the only record of who did what (D-12).
  const FROZEN_ON_EVERY_FINAL_ROW: Record<string, string> = {
    version: `"version" = "version" + 1`,
    generationEpoch: `"generationEpoch" = "generationEpoch" + 1`,
    inputTruncated: `"inputTruncated" = NOT "inputTruncated"`,
    requestedByUserId: `"requestedByUserId" = 'someone-else'`,
    generationQueuedAt: `"generationQueuedAt" = "generationQueuedAt" - interval '1 hour'`,
    generationClaimedAt: `"generationClaimedAt" = now() - interval '2 hours'`,
    generatedAt: `"generatedAt" = now() - interval '1 day'`,
    lastEditedByUserId: `"lastEditedByUserId" = 'someone-else'`,
    lastEditedAt: `"lastEditedAt" = now() - interval '1 day'`,
    createdAt: `"createdAt" = "createdAt" - interval '1 day'`,
  };
  const FROZEN_BY_STATUS: Record<"REJECTED" | "PUBLISHED" | "FAILED", Record<string, string>> = {
    REJECTED: {
      rejectedByUserId: `"rejectedByUserId" = 'someone-else'`,
      rejectedAt: `"rejectedAt" = "rejectedAt" - interval '1 day'`,
    },
    PUBLISHED: {
      publishedByUserId: `"publishedByUserId" = 'someone-else'`,
      publishedAt: `"publishedAt" = "publishedAt" - interval '1 day'`,
    },
    FAILED: {
      failureCode: `"failureCode" = CASE WHEN "failureCode" = 'PROVIDER' THEN 'UNKNOWN'::"KbProposalFailureCode" ELSE 'PROVIDER'::"KbProposalFailureCode" END`,
      failedAt: `"failedAt" = "failedAt" - interval '1 day'`,
    },
  };

  for (const status of ["REJECTED", "PUBLISHED", "FAILED"] as const) {
    it(`refuses a change of every actor, time, failure and version column on a ${status} row (review a-IN-01)`, async () => {
      const orgId = await freshOrg();
      const { id } = await seedProposal(orgId, { status, ticketIds: [] });
      const before = await prisma.kbProposal.findUniqueOrThrow({ where: { id } });
      const sets = { ...FROZEN_ON_EVERY_FINAL_ROW, ...FROZEN_BY_STATUS[status] };
      for (const [column, set] of Object.entries(sets)) {
        const text = await rejection(
          prisma.$executeRawUnsafe(`UPDATE "KbProposal" SET ${set} WHERE id = $1`, id),
        );
        expect(text, column).toContain("KbProposal is final");
      }
      const after = await prisma.kbProposal.findUniqueOrThrow({ where: { id } });
      expect(after).toEqual(before);
      // updatedAt alone is not frozen (it records the last write attempt Prisma makes).
      expect(
        await prisma.$executeRaw`UPDATE "KbProposal" SET "updatedAt" = now() WHERE id = ${id}`,
      ).toBe(1);
    });
  }

  it("still lets a DRAFT row change those columns (review a-IN-01: only final rows are frozen)", async () => {
    const orgId = await freshOrg();
    const { id } = await seedProposal(orgId, { status: "DRAFT", ticketIds: [] });
    for (const set of Object.values(FROZEN_ON_EVERY_FINAL_ROW)) {
      expect(
        await prisma.$executeRawUnsafe(`UPDATE "KbProposal" SET ${set} WHERE id = $1`, id),
      ).toBe(1);
    }
  });

  it("allows GENERATING to DRAFT with title and body, then DRAFT to REJECTED with the reviewer columns", async () => {
    const orgId = await freshOrg();
    const { id } = await seedProposal(orgId, { status: "GENERATING", ticketIds: [] });
    const drafted = await prisma.kbProposal.updateMany({
      where: { id, organizationId: orgId, status: "GENERATING", version: 0 },
      data: {
        status: "DRAFT",
        title: "How to reset a password",
        bodyMarkdown: "Open Settings, then Security.",
        generatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    expect(drafted.count).toBe(1);
    const rejected = await prisma.kbProposal.updateMany({
      where: { id, organizationId: orgId, status: "DRAFT", version: 1 },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedByUserId: randomUUID(),
        version: { increment: 1 },
      },
    });
    expect(rejected.count).toBe(1);
    const row = await prisma.kbProposal.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "REJECTED", version: 2, title: "How to reset a password" });
  });
});

describe("Phase 12.2 schema: column types (reviews P1, C5, R2-3)", () => {
  it("stores snapshotSeq above 2^31 and above 2^53 exactly as bigint", async () => {
    const orgId = await freshOrg();
    const t1 = await seedResolvedTicket(orgId);
    const t2 = await seedResolvedTicket(orgId);
    const { id } = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [t1.id, t2.id],
      snapshotSeqs: [2147483653n, 9007199254740993n],
    });
    const sources = await scopedDb(orgId).kbProposalSource.findMany({
      where: { proposalId: id },
      orderBy: { position: "asc" },
    });
    expect(sources.map((s) => typeof s.snapshotSeq)).toEqual(["bigint", "bigint"]);
    expect(sources[0].snapshotSeq).toBe(2147483653n);
    expect(sources[1].snapshotSeq).toBe(9007199254740993n);
    const raw = await prisma.$queryRaw<{ seq: string }[]>`
      SELECT "snapshotSeq"::text AS seq FROM "KbProposalSource"
      WHERE "proposalId" = ${id} ORDER BY "position"`;
    expect(raw.map((r) => r.seq)).toEqual(["2147483653", "9007199254740993"]);
  });

  it("reports snapshotSeq bigint, generationQueuedAt NOT NULL with a default, generationEpoch integer NOT NULL default 1", async () => {
    const rows = await prisma.$queryRaw<
      {
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }[]
    >`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'KbProposalSource' AND column_name = 'snapshotSeq')
          OR (table_name = 'KbProposal' AND column_name IN ('generationQueuedAt', 'generationEpoch')))
      ORDER BY column_name`;
    const byColumn = new Map(rows.map((r) => [r.column_name, r]));
    expect(byColumn.get("snapshotSeq")).toMatchObject({ data_type: "bigint", is_nullable: "YES" });
    expect(byColumn.get("generationQueuedAt")?.is_nullable).toBe("NO");
    expect(byColumn.get("generationQueuedAt")?.column_default).toBeTruthy();
    expect(byColumn.get("generationEpoch")).toMatchObject({
      data_type: "integer",
      is_nullable: "NO",
      column_default: "1",
    });
  });

  it("gives a proposal inserted without generationEpoch the epoch 1 and a generationQueuedAt", async () => {
    const orgId = await freshOrg();
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "KbProposal" ("id", "organizationId", "requestedByUserId", "updatedAt")
      VALUES (${id}, ${orgId}, ${randomUUID()}, now())`;
    const row = await prisma.kbProposal.findUniqueOrThrow({ where: { id } });
    expect(row.generationEpoch).toBe(1);
    expect(row.status).toBe("GENERATING");
    expect(row.version).toBe(0);
    expect(row.generationQueuedAt).toBeInstanceOf(Date);
    expect(row.generationClaimedAt).toBeNull();
  });
});

describe("Phase 12.2 schema: CHECKs (D-03, D-16, review R2-3)", () => {
  it("KbProposal_status_fields_check refuses FAILED without a code, PUBLISHED without an article, DRAFT without a body", async () => {
    const orgId = await freshOrg();
    expect(await rejection(insertProposal(orgId, { status: "FAILED" }))).toContain(
      "KbProposal_status_fields_check",
    );
    expect(
      await rejection(
        insertProposal(orgId, {
          status: "PUBLISHED",
          title: "Title",
          bodyMarkdown: "Body",
          publishedAt: new Date(),
          publishedByUserId: "someone",
        }),
      ),
    ).toContain("KbProposal_status_fields_check");
    expect(
      await rejection(
        insertProposal(orgId, { status: "DRAFT", title: "Title", bodyMarkdown: null }),
      ),
    ).toContain("KbProposal_status_fields_check");
    expect(
      await rejection(
        insertProposal(orgId, { status: "REJECTED", title: "Title", bodyMarkdown: "Body" }),
      ),
    ).toContain("KbProposal_status_fields_check");
    expect(
      await rejection(insertProposal(orgId, { status: "GENERATING", failureCode: "PROVIDER" })),
    ).toContain("KbProposal_status_fields_check");
    // The valid shapes insert.
    await insertProposal(orgId, { status: "FAILED", failureCode: "PROVIDER" });
    await insertProposal(orgId, { status: "DRAFT", title: "Title", bodyMarkdown: "Body" });
  });

  it("KbProposal_version_check refuses version -1", async () => {
    const orgId = await freshOrg();
    expect(await rejection(insertProposal(orgId, { version: -1 }))).toContain(
      "KbProposal_version_check",
    );
  });

  it("KbProposal_generation_epoch_check refuses generationEpoch 0", async () => {
    const orgId = await freshOrg();
    expect(await rejection(insertProposal(orgId, { generationEpoch: 0 }))).toContain(
      "KbProposal_generation_epoch_check",
    );
    const { id } = await seedProposal(orgId, {
      status: "GENERATING",
      ticketIds: [],
      generationEpoch: 3,
    });
    expect(
      await rejection(
        prisma.$executeRaw`UPDATE "KbProposal" SET "generationEpoch" = 0 WHERE id = ${id}`,
      ),
    ).toContain("KbProposal_generation_epoch_check");
  });

  it("KbProposal_title_length_check counts code points: 2 and 121 refused, 120 astral characters allowed", async () => {
    const orgId = await freshOrg();
    expect(await rejection(insertProposal(orgId, { title: "ab" }))).toContain(
      "KbProposal_title_length_check",
    );
    expect(await rejection(insertProposal(orgId, { title: "x".repeat(121) }))).toContain(
      "KbProposal_title_length_check",
    );
    const astral = "\u{1F600}".repeat(120);
    expect(astral.length).toBe(240);
    const id = await insertProposal(orgId, { title: astral });
    const row = await prisma.kbProposal.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe(astral);
    await insertProposal(orgId, { title: "abc" });
  });

  it("KbProposalSource_position_check refuses position 6", async () => {
    const orgId = await freshOrg();
    const ticket = await seedResolvedTicket(orgId);
    const { id } = await seedProposal(orgId, { status: "GENERATING", ticketIds: [] });
    expect(
      await rejection(prisma.$executeRaw`
        INSERT INTO "KbProposalSource" ("organizationId", "proposalId", "ticketId", "position", "citedSections")
        VALUES (${orgId}, ${id}, ${ticket.id}, 6, ARRAY[]::text[])`),
    ).toContain("KbProposalSource_position_check");
  });
});

describe("Phase 12.2 schema: tenancy in the database (D-03, D-04, D-12)", () => {
  it("refuses publishedArticleId pointing at another organization's article", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const articleB = await insertArticle(orgB);
    expect(
      await rejection(
        insertProposal(orgA, {
          status: "PUBLISHED",
          title: "Title",
          bodyMarkdown: "Body",
          publishedArticleId: articleB,
          publishedAt: new Date(),
          publishedByUserId: "someone",
        }),
      ),
    ).toContain("KbProposal_organizationId_publishedArticleId_fkey");
  });

  it("refuses AuditEvent.kbProposalId pointing at another organization's proposal", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const proposalB = await seedProposal(orgB, { status: "GENERATING", ticketIds: [] });
    const text = await rejection(prisma.$executeRaw`
      INSERT INTO "AuditEvent"
        ("id", "organizationId", "actionType", "provider", "model", "input", "output", "kbProposalId")
      VALUES
        (${randomUUID()}, ${orgA}, 'KB_PROPOSAL_GENERATED', 'fake', 'fake-model', 'in', 'out',
         ${proposalB.id})`);
    expect(text).toContain("AuditEvent_organizationId_kbProposalId_fkey");
    // The same row for the proposal's own organization inserts.
    const proposalA = await seedProposal(orgA, { status: "GENERATING", ticketIds: [] });
    await prisma.auditEvent.create({
      data: {
        organizationId: orgA,
        actionType: "KB_PROPOSAL_GENERATED",
        provider: "fake",
        model: "fake-model",
        input: "in",
        output: "out",
        kbProposalId: proposalA.id,
      },
    });
  });

  it("refuses a second source with the same position", async () => {
    const orgId = await freshOrg();
    const t1 = await seedResolvedTicket(orgId);
    const t2 = await seedResolvedTicket(orgId);
    const { id } = await seedProposal(orgId, { status: "GENERATING", ticketIds: [t1.id] });
    expect(
      await rejection(prisma.$executeRaw`
        INSERT INTO "KbProposalSource" ("organizationId", "proposalId", "ticketId", "position", "citedSections")
        VALUES (${orgId}, ${id}, ${t2.id}, 1, ARRAY[]::text[])`),
    ).toContain("KbProposalSource_proposalId_position_key");
  });

  it("refuses deleting a ticket that is a proposal source (ON DELETE RESTRICT)", async () => {
    const orgId = await freshOrg();
    const ticket = await seedResolvedTicket(orgId);
    await seedProposal(orgId, { status: "DRAFT", ticketIds: [ticket.id] });
    expect(
      await rejection(prisma.$executeRaw`DELETE FROM "Ticket" WHERE id = ${ticket.id}`),
    ).toContain("KbProposalSource_organizationId_ticketId_fkey");
    expect(await prisma.ticket.count({ where: { id: ticket.id } })).toBe(1);
  });
});

describe("Phase 12.2 schema: scopedDb isolation (D-01, unmocked)", () => {
  it("scopedDb(orgB).kbProposal never reads, counts, updates or deletes organization A's rows", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const ticketA = await seedResolvedTicket(orgA);
    const proposalA = await seedProposal(orgA, {
      status: "DRAFT",
      ticketIds: [ticketA.id],
      title: "Organization A proposal",
    });
    const dbB = scopedDb(orgB);

    expect(await dbB.kbProposal.findMany()).toEqual([]);
    expect(await dbB.kbProposal.findMany({ where: { id: proposalA.id } })).toEqual([]);
    expect(await dbB.kbProposal.findFirst({ where: { id: proposalA.id } })).toBeNull();
    expect(await dbB.kbProposal.count()).toBe(0);
    expect(await dbB.kbProposal.count({ where: { id: proposalA.id } })).toBe(0);
    const updated = await dbB.kbProposal.updateMany({
      where: { id: proposalA.id },
      data: { title: "Hijacked", version: { increment: 1 } },
    });
    expect(updated.count).toBe(0);
    const deleted = await dbB.kbProposal.deleteMany({ where: { id: proposalA.id } });
    expect(deleted.count).toBe(0);

    const row = await scopedDb(orgA).kbProposal.findFirst({ where: { id: proposalA.id } });
    expect(row).toMatchObject({ title: "Organization A proposal", version: 0, status: "DRAFT" });
    expect(await scopedDb(orgA).kbProposal.count()).toBe(1);
  });

  it("scopedDb(orgB).kbProposalSource never reads or deletes organization A's rows", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const ticketA = await seedResolvedTicket(orgA);
    const proposalA = await seedProposal(orgA, { status: "DRAFT", ticketIds: [ticketA.id] });
    const dbB = scopedDb(orgB);

    expect(await dbB.kbProposalSource.findMany()).toEqual([]);
    expect(await dbB.kbProposalSource.findMany({ where: { proposalId: proposalA.id } })).toEqual(
      [],
    );
    const deleted = await dbB.kbProposalSource.deleteMany({ where: { proposalId: proposalA.id } });
    expect(deleted.count).toBe(0);
    expect(
      await scopedDb(orgA).kbProposalSource.count({ where: { proposalId: proposalA.id } }),
    ).toBe(1);
  });
});

describe("Phase 12.2 schema: catalog (D-16, D-12; earlier hand-written objects survive)", () => {
  it("has the three composite foreign keys (RESTRICT) and the five CHECKs", async () => {
    const fks = [
      "AuditEvent_organizationId_kbProposalId_fkey",
      "KbProposalSource_organizationId_proposalId_fkey",
      "KbProposalSource_organizationId_ticketId_fkey",
      "KbProposal_organizationId_publishedArticleId_fkey",
    ];
    const fkRows = await prisma.$queryRaw<
      { conname: string; upd: string; del: string; ncols: number }[]
    >`
      SELECT conname, confupdtype::text AS upd, confdeltype::text AS del,
             array_length(conkey, 1) AS ncols
      FROM pg_constraint WHERE contype = 'f' AND conname = ANY(${fks}::text[])
      ORDER BY conname`;
    expect(fkRows).toEqual(
      [...fks].sort().map((conname) => ({ conname, upd: "r", del: "r", ncols: 2 })),
    );

    const checks = [
      "KbProposalSource_position_check",
      "KbProposal_generation_epoch_check",
      "KbProposal_status_fields_check",
      "KbProposal_title_length_check",
      "KbProposal_version_check",
    ];
    const checkRows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND conname = ANY(${checks}::text[])
      ORDER BY conname`;
    expect(checkRows.map((r) => r.conname)).toEqual([...checks].sort());

    const uniques = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('Ticket_organizationId_id_key', 'KbArticle_organizationId_id_key',
                          'KbProposal_organizationId_id_key', 'KbProposal_publishedArticleId_key',
                          'KbProposalSource_proposalId_position_key')
      ORDER BY indexname`;
    expect(uniques.map((r) => r.indexname)).toEqual([
      "KbArticle_organizationId_id_key",
      "KbProposalSource_proposalId_position_key",
      "KbProposal_organizationId_id_key",
      "KbProposal_publishedArticleId_key",
      "Ticket_organizationId_id_key",
    ]);
  });

  it("has the trigger aida_kb_proposal_status_fence enabled in pg_trigger and KB_PROPOSAL_GENERATED in pg_enum", async () => {
    const triggers = await prisma.$queryRaw<
      { relname: string; proname: string; tgenabled: string }[]
    >`
      SELECT c.relname, p.proname, t.tgenabled::text AS tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgname = 'aida_kb_proposal_status_fence'`;
    expect(triggers).toEqual([
      { relname: "KbProposal", proname: "aida_kb_proposal_status_immutable", tgenabled: "O" },
    ]);
    // Review a-IN-01: the fence function names every frozen column of a final row, besides the
    // original title, body and article.
    const [definition] = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_functiondef('aida_kb_proposal_status_immutable()'::regprocedure) AS def`;
    for (const column of [
      "title",
      "bodyMarkdown",
      "publishedArticleId",
      "version",
      "generationEpoch",
      "inputTruncated",
      "requestedByUserId",
      "generationQueuedAt",
      "generationClaimedAt",
      "generatedAt",
      "lastEditedByUserId",
      "lastEditedAt",
      "rejectedByUserId",
      "rejectedAt",
      "publishedByUserId",
      "publishedAt",
      "failureCode",
      "failedAt",
      "createdAt",
    ]) {
      expect(definition.def, column).toContain(`OLD."${column}" IS DISTINCT FROM NEW."${column}"`);
    }
    expect(definition.def).not.toContain(`OLD."updatedAt"`);
    const labels = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'AuditActionType' ORDER BY e.enumsortorder`;
    expect(labels.map((r) => r.enumlabel)).toEqual([
      "TRIAGE",
      "DRAFT_GENERATED",
      "DRAFT_APPROVED",
      "INSIGHT_CLUSTER_LABELS",
      "INSIGHT_SUMMARY",
      "KB_PROPOSAL_GENERATED",
    ]);
  });

  it("keeps the earlier triggers: both append-only triggers and the two Phase 12.1 triggers", async () => {
    const rows = await prisma.$queryRaw<
      { tgname: string; relname: string; proname: string; tgenabled: string }[]
    >`
      SELECT t.tgname, c.relname, p.proname, t.tgenabled::text AS tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgname IN ('aida_audit_event_no_update_delete', 'aida_ticket_audit_event_no_update_delete',
                         'aida_organization_ticket_states', 'aida_ticket_state_group_fixed')
      ORDER BY t.tgname`;
    expect(rows).toEqual([
      {
        tgname: "aida_audit_event_no_update_delete",
        relname: "AuditEvent",
        proname: "aida_audit_event_immutable",
        tgenabled: "O",
      },
      {
        tgname: "aida_organization_ticket_states",
        relname: "organization",
        proname: "aida_organization_seed_ticket_states",
        tgenabled: "O",
      },
      {
        tgname: "aida_ticket_audit_event_no_update_delete",
        relname: "TicketAuditEvent",
        proname: "aida_ticket_audit_event_immutable",
        tgenabled: "O",
      },
      {
        tgname: "aida_ticket_state_group_fixed",
        relname: "TicketState",
        proname: "aida_ticket_state_group_immutable",
        tgenabled: "O",
      },
    ]);
  });

  it("keeps the generated searchVector columns and their GIN indexes unchanged", async () => {
    const columns = await prisma.$queryRaw<
      { relname: string; attgenerated: string; expr: string }[]
    >`
      SELECT c.relname, a.attgenerated::text AS attgenerated, pg_get_expr(d.adbin, d.adrelid) AS expr
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attname = 'searchVector' AND c.relname IN ('Ticket', 'Message') AND NOT a.attisdropped
      ORDER BY c.relname`;
    expect(columns).toEqual([
      { relname: "Message", attgenerated: "s", expr: MESSAGE_SEARCH_EXPR },
      { relname: "Ticket", attgenerated: "s", expr: TICKET_SEARCH_EXPR },
    ]);
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('Ticket_searchVector_idx', 'Message_searchVector_idx')
      ORDER BY indexname`;
    expect(indexes).toEqual([
      { indexname: "Message_searchVector_idx", indexdef: MESSAGE_SEARCH_INDEXDEF },
      { indexname: "Ticket_searchVector_idx", indexdef: TICKET_SEARCH_INDEXDEF },
    ]);
  });

  it("keeps the SavedView, TicketRelation, Ticket and TicketState hand-written indexes and CHECKs", async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('SavedView_private_name_key', 'SavedView_shared_name_key',
                          'TicketRelation_pair_key', 'TicketRelation_one_parent_key',
                          'TicketState_active_name_key', 'TicketState_legacy_status_key')
      ORDER BY indexname`;
    expect(indexes.map((r) => r.indexname)).toEqual([
      "SavedView_private_name_key",
      "SavedView_shared_name_key",
      "TicketRelation_one_parent_key",
      "TicketRelation_pair_key",
      "TicketState_active_name_key",
      "TicketState_legacy_status_key",
    ]);
    const indexdef = new Map(indexes.map((r) => [r.indexname, r.indexdef]));
    expect(indexdef.get("TicketState_active_name_key")).toBe(
      `CREATE UNIQUE INDEX "TicketState_active_name_key" ON public."TicketState" USING btree ("organizationId", lower(name)) WHERE ("deletedAt" IS NULL)`,
    );
    expect(indexdef.get("TicketRelation_pair_key")).toContain("LEAST(");
    expect(indexdef.get("TicketRelation_pair_key")).toContain("GREATEST(");
    expect(indexdef.get("SavedView_private_name_key")).toContain("WHERE");
    expect(indexdef.get("SavedView_shared_name_key")).toContain("WHERE");

    const checks = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND conname IN ('SavedView_name_length_check', 'TicketAuditEvent_actor_check',
                                          'TicketRelation_no_self_check', 'Ticket_merge_fields_check',
                                          'Ticket_sla_paused_ms_check')
      ORDER BY conname`;
    expect(checks.map((r) => r.conname)).toEqual([
      "SavedView_name_length_check",
      "TicketAuditEvent_actor_check",
      "TicketRelation_no_self_check",
      "Ticket_merge_fields_check",
      "Ticket_sla_paused_ms_check",
    ]);

    const fk = await prisma.$queryRaw<{ upd: string; del: string }[]>`
      SELECT confupdtype::text AS upd, confdeltype::text AS del
      FROM pg_constraint WHERE conname = 'Ticket_organizationId_stateId_fkey'`;
    expect(fk).toEqual([{ upd: "r", del: "r" }]);
  });
});
