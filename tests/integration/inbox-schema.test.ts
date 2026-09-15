import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { recordTicketAudit } from "@/lib/tickets/ticket-audit";

// Better Auth's organization/user/member models have no @default() on id or createdAt,
// so every seed row carries explicit values.
async function seedOrg(label: string) {
  return prisma.organization.create({
    data: {
      id: randomUUID(),
      name: `Inbox ${label}`,
      slug: `inbox-${label}-${randomUUID()}`,
      createdAt: new Date(),
    },
  });
}

describe("Phase 11 schema: TicketAuditEvent", () => {
  it("recordTicketAudit writes one row with the given fields", async () => {
    const org = await seedOrg("audit-write");
    const ticketId = randomUUID();
    const userId = randomUUID();
    const batchId = randomUUID();

    const { id } = await prisma.$transaction((tx) =>
      recordTicketAudit(tx, org.id, {
        ticketId,
        actorType: "USER",
        actorUserId: userId,
        action: "STATUS_CHANGED",
        before: { status: "OPEN" },
        after: { status: "RESOLVED" },
        batchId,
      }),
    );

    const rows = await prisma.ticketAuditEvent.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      organizationId: org.id,
      ticketId,
      actorType: "USER",
      actorUserId: userId,
      action: "STATUS_CHANGED",
      before: { status: "OPEN" },
      after: { status: "RESOLVED" },
      batchId,
    });
  });

  it("records through a scopedDb transaction client with organizationId set explicitly", async () => {
    const org = await seedOrg("audit-scoped");
    const ticketId = randomUUID();
    const db = scopedDb(org.id);

    await db.$transaction((tx) =>
      recordTicketAudit(tx, org.id, {
        ticketId,
        actorType: "SYSTEM",
        actorUserId: null,
        action: "AUTO_CLOSED",
        before: { status: "RESOLVED" },
        after: { status: "CLOSED" },
      }),
    );

    const row = await db.ticketAuditEvent.findFirst({ where: { ticketId } });
    expect(row).toMatchObject({
      organizationId: org.id,
      actorType: "SYSTEM",
      actorUserId: null,
      batchId: null,
    });
  });

  it("rejects a direct UPDATE and a direct DELETE at the database level", async () => {
    const org = await seedOrg("audit-immutable");
    const { id } = await recordTicketAudit(prisma, org.id, {
      ticketId: randomUUID(),
      actorType: "SYSTEM",
      actorUserId: null,
      action: "AUTO_CLOSED",
      before: { status: "RESOLVED" },
      after: { status: "CLOSED" },
    });

    await expect(
      prisma.ticketAuditEvent.update({ where: { id }, data: { action: "TAG_ADDED" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.ticketAuditEvent.delete({ where: { id } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`UPDATE "TicketAuditEvent" SET "batchId" = 'x' WHERE id = ${id}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`DELETE FROM "TicketAuditEvent" WHERE id = ${id}`,
    ).rejects.toThrow(/append-only/);

    const still = await prisma.ticketAuditEvent.findUnique({ where: { id } });
    expect(still?.action).toBe("AUTO_CLOSED");
    expect(still?.batchId).toBeNull();
  });

  it("hides organization A's audit rows from scopedDb(orgB) reads and updateMany", async () => {
    const orgA = await seedOrg("audit-iso-a");
    const orgB = await seedOrg("audit-iso-b");
    const ticketId = randomUUID();
    await recordTicketAudit(prisma, orgA.id, {
      ticketId,
      actorType: "SYSTEM",
      actorUserId: null,
      action: "AUTO_CLOSED",
      before: { status: "RESOLVED" },
      after: { status: "CLOSED" },
    });

    const dbB = scopedDb(orgB.id);
    expect(await dbB.ticketAuditEvent.findMany({ where: { ticketId } })).toHaveLength(0);
    expect(await dbB.ticketAuditEvent.findFirst({ where: { ticketId } })).toBeNull();
    expect(await dbB.ticketAuditEvent.count({ where: { ticketId } })).toBe(0);
    // updateMany through B touches zero rows of A, so the trigger never even fires.
    const updated = await dbB.ticketAuditEvent.updateMany({
      where: { ticketId },
      data: { batchId: "tampered" },
    });
    expect(updated.count).toBe(0);

    expect(await scopedDb(orgA.id).ticketAuditEvent.count({ where: { ticketId } })).toBe(1);
  });
});
