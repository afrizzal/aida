// Phase 10 team schema (plan 10-01) on a real Postgres through Testcontainers, unmocked:
// MemberAuditEvent's single writer, its database-level append-only trigger and its organization
// isolation through scopedDb (D-12, D-28, V-14).
//
// Better Auth's organization, user and member models have no @default() on id or createdAt, so
// every seeded row carries explicit values. Each case seeds fresh organizations.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { recordMemberAudit } from "@/lib/workspace-members/member-audit";

async function seedOrg(label: string): Promise<{ id: string }> {
  const id = randomUUID();
  await prisma.organization.create({
    data: {
      id,
      name: `Team schema ${label}`,
      slug: `team-schema-${label}-${id}`,
      createdAt: new Date(),
    },
  });
  return { id };
}

async function seedUser(label: string): Promise<{ id: string }> {
  const id = randomUUID();
  const now = new Date();
  await prisma.user.create({
    data: {
      id,
      name: `Team schema ${label}`,
      email: `team-schema-${label}-${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id };
}

describe("MemberAuditEvent (D-12, V-14)", () => {
  it("recordMemberAudit writes exactly one row with the given ids, action and roles", async () => {
    const org = await seedOrg("audit-write");
    const actor = await seedUser("audit-actor");
    const target = await seedUser("audit-target");

    const { id } = await recordMemberAudit(prisma, org.id, {
      actorUserId: actor.id,
      action: "ROLE_CHANGED",
      targetUserId: target.id,
      oldRole: "member",
      newRole: "admin",
    });

    const rows = await prisma.memberAuditEvent.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      organizationId: org.id,
      actorUserId: actor.id,
      targetUserId: target.id,
      invitationId: null,
      action: "ROLE_CHANGED",
      oldRole: "member",
      newRole: "admin",
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("holds ids, an action, roles and a timestamp only: no email, token or free-text column", async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'MemberAuditEvent'
      ORDER BY column_name
    `;
    expect(columns.map((c) => c.column_name)).toEqual(
      [
        "action",
        "actorUserId",
        "createdAt",
        "id",
        "invitationId",
        "newRole",
        "oldRole",
        "organizationId",
        "targetUserId",
      ].sort(),
    );
  });

  it("rejects a raw UPDATE and a raw DELETE at the database level with the trigger's message", async () => {
    const org = await seedOrg("audit-immutable");
    const actor = await seedUser("audit-immutable-actor");
    const { id } = await recordMemberAudit(prisma, org.id, {
      actorUserId: actor.id,
      action: "INVITATION_CREATED",
      invitationId: randomUUID(),
      newRole: "member",
    });

    await expect(
      prisma.$executeRaw`UPDATE "MemberAuditEvent" SET "newRole" = 'owner' WHERE id = ${id}`,
    ).rejects.toThrow(/MemberAuditEvent is append-only: UPDATE is not permitted/);
    await expect(
      prisma.$executeRaw`DELETE FROM "MemberAuditEvent" WHERE id = ${id}`,
    ).rejects.toThrow(/MemberAuditEvent is append-only: DELETE is not permitted/);
    await expect(
      prisma.memberAuditEvent.update({ where: { id }, data: { newRole: "owner" } }),
    ).rejects.toThrow(/append-only/);

    const still = await prisma.memberAuditEvent.findUnique({ where: { id } });
    expect(still?.newRole).toBe("member");
  });

  it("is invisible and immutable through another organization's scopedDb", async () => {
    const orgA = await seedOrg("audit-iso-a");
    const orgB = await seedOrg("audit-iso-b");
    const actor = await seedUser("audit-iso-actor");
    const { id } = await recordMemberAudit(prisma, orgA.id, {
      actorUserId: actor.id,
      action: "MEMBER_DEACTIVATED",
      targetUserId: randomUUID(),
      oldRole: "member",
    });

    const dbB = scopedDb(orgB.id);
    expect(await dbB.memberAuditEvent.findMany()).toEqual([]);
    expect(await dbB.memberAuditEvent.findFirst({ where: { id } })).toBeNull();
    expect(await dbB.memberAuditEvent.count()).toBe(0);
    const updated = await dbB.memberAuditEvent.updateMany({
      where: { id },
      data: { oldRole: "owner" },
    });
    expect(updated.count).toBe(0);
    const deleted = await dbB.memberAuditEvent.deleteMany({ where: { id } });
    expect(deleted.count).toBe(0);

    const dbA = scopedDb(orgA.id);
    const own = await dbA.memberAuditEvent.findMany();
    expect(own.map((r) => r.id)).toEqual([id]);
    expect(own[0]?.oldRole).toBe("member");
  });

  it("keeps the audit row when the actor's user account is removed (no user relation)", async () => {
    const org = await seedOrg("audit-user-gone");
    const actor = await seedUser("audit-user-gone-actor");
    const { id } = await recordMemberAudit(prisma, org.id, {
      actorUserId: actor.id,
      action: "INVITATION_REVOKED",
      invitationId: randomUUID(),
    });

    await prisma.user.delete({ where: { id: actor.id } });

    const still = await prisma.memberAuditEvent.findUnique({ where: { id } });
    expect(still?.actorUserId).toBe(actor.id);
  });
});
