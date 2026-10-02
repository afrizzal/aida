// Phase 12.2 schema proofs (AIDA-18, D-03, D-04, D-12, D-16): the KB proposal tables, their
// database-enforced tenancy, the status fence and the catalog. Unmocked, on the shared
// Testcontainers database.
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
