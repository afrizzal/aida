import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { seedContactTicket, seedOrgWithMembers, seedRelation } from "../support/lifecycle-fixtures";

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

async function twoTickets(label: string) {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
  const email = `lc-${label}-${randomUUID()}@example.test`;
  const a = await seedContactTicket(orgId, { contactEmail: email });
  const b = await seedContactTicket(orgId, { contactEmail: email });
  return { orgId, userId: users[0].id, a, b };
}

describe("Phase 12 schema: TicketRelation", () => {
  it("writes a relation through scopedDb(orgA) and reads it back", async () => {
    const { orgId, userId, a, b } = await twoTickets("roundtrip");
    const db = scopedDb(orgId);

    const created = await db.ticketRelation.create({
      data: {
        organizationId: orgId,
        type: "RELATED_TO",
        fromTicketId: a.id,
        toTicketId: b.id,
        createdById: userId,
      },
    });
    const rows = await db.ticketRelation.findMany({ where: { fromTicketId: a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.id,
      organizationId: orgId,
      type: "RELATED_TO",
      fromTicketId: a.id,
      toTicketId: b.id,
      createdById: userId,
    });
  });

  it("refuses B->A after A->B, A->B twice and a second type on the same pair (TicketRelation_pair_key)", async () => {
    const { orgId, userId, a, b } = await twoTickets("pair");
    await seedRelation(prisma, orgId, {
      type: "RELATED_TO",
      fromTicketId: a.id,
      toTicketId: b.id,
      createdById: userId,
    });

    for (const attempt of [
      { type: "RELATED_TO" as const, fromTicketId: b.id, toTicketId: a.id },
      { type: "RELATED_TO" as const, fromTicketId: a.id, toTicketId: b.id },
      { type: "DUPLICATE_OF" as const, fromTicketId: a.id, toTicketId: b.id },
      { type: "CHILD_OF" as const, fromTicketId: b.id, toTicketId: a.id },
    ]) {
      const text = await rejection(
        seedRelation(prisma, orgId, { ...attempt, createdById: userId }),
      );
      expect(text).toMatch(/P2002|23505|unique/i);
      expect(text).toContain("TicketRelation_pair_key");
    }
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("refuses a self-link (TicketRelation_no_self_check)", async () => {
    const { orgId, userId, a } = await twoTickets("self");
    const text = await rejection(
      seedRelation(prisma, orgId, {
        type: "RELATED_TO",
        fromTicketId: a.id,
        toTicketId: a.id,
        createdById: userId,
      }),
    );
    expect(text).toContain("TicketRelation_no_self_check");
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("resolves the Message.seq sequence through pg_get_serial_sequence", async () => {
    const rows = await prisma.$queryRaw<{ seq: string | null }[]>`
      SELECT pg_get_serial_sequence('"Message"', 'seq') AS seq`;
    expect(rows[0]?.seq).not.toBeNull();
  });
});
