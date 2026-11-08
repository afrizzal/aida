// Phase 10, plan 10-03 (AIDA-43, D-07, D-09 amended, D-10, D-12, V-25, V-26): the team
// administration service on a real Postgres through Testcontainers, unmocked. Role changes and
// deactivations run under the organization lock with the duplicate-row rights of V-26; the owner
// floor is a second guard proven by direct assertOwnerFloor cases; races force their order with
// the lock-wait helpers (each run's backend PID recorded through the service's own hook, then
// waitForBlockedBy on exactly that PID), never with sleeps.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MemberAdminError } from "@/lib/workspace-members/errors";
import {
  assertOwnerFloor,
  changeMemberRole,
  listMembers,
} from "@/lib/workspace-members/member-admin";
import { countOwners } from "@/lib/workspace-members/member-rights";
import { type MemberRole, seedOrgWithMembers } from "../support/inbox-fixtures";

/** Adds one more member row for userId (explicit id and createdAt, as member-rights.test.ts does). */
async function addRow(orgId: string, userId: string, role: string): Promise<string> {
  const id = `z-dup-${randomUUID()}`;
  await prisma.member.create({
    data: { id, organizationId: orgId, userId, role, createdAt: new Date() },
  });
  return id;
}

async function seed(roles: readonly MemberRole[]) {
  const { orgId, users } = await seedOrgWithMembers(prisma, roles);
  return { orgId, users, ids: users.map((u) => u.id) };
}

function rowsOf(orgId: string, userId: string) {
  return prisma.member.findMany({
    where: { organizationId: orgId, userId },
    orderBy: { id: "asc" },
    select: { id: true, role: true },
  });
}

function memberAudit(orgId: string) {
  return prisma.memberAuditEvent.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function expectLastOwner(fn: () => unknown) {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(MemberAdminError);
  expect((caught as MemberAdminError).code).toBe("LAST_OWNER");
}

describe("changeMemberRole (tracer: lock, rights, floor, write, audit)", () => {
  it("an owner promotes a member to admin: every row updated, one ROLE_CHANGED with old and new role", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;

    const result = await changeMemberRole({
      orgId,
      actorUserId: owner,
      targetUserId: member,
      newRole: "admin",
    });
    expect(result).toEqual({ ok: true, owners: 1, admins: 1 });
    expect((await rowsOf(orgId, member)).map((r) => r.role)).toEqual(["admin"]);

    const audit = await memberAudit(orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "ROLE_CHANGED",
      actorUserId: owner,
      targetUserId: member,
      oldRole: "member",
      newRole: "admin",
      invitationId: null,
    });
  });

  it("a target with two member rows promoted to admin has both rows admin", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    await addRow(orgId, member, "member");

    const result = await changeMemberRole({
      orgId,
      actorUserId: owner,
      targetUserId: member,
      newRole: "admin",
    });
    expect(result).toEqual({ ok: true, owners: 1, admins: 1 });
    const rows = await rowsOf(orgId, member);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.role)).toEqual(["admin", "admin"]);
    const audit = await memberAudit(orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ oldRole: "member", newRole: "admin" });
  });

  it("rejects a role outside owner, admin and member with INVALID_ROLE and writes nothing", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    for (const newRole of ["viewer", "Owner", "member,admin", ""]) {
      expect(
        await changeMemberRole({ orgId, actorUserId: owner, targetUserId: member, newRole }),
      ).toEqual({ ok: false, error: "INVALID_ROLE" });
    }
    expect((await rowsOf(orgId, member)).map((r) => r.role)).toEqual(["member"]);
    expect(await memberAudit(orgId)).toHaveLength(0);
  });

  it("setting the role a member already holds writes nothing and adds no audit row", async () => {
    const { orgId, ids } = await seed(["owner", "admin"]);
    const [owner, admin] = ids;
    expect(
      await changeMemberRole({ orgId, actorUserId: owner, targetUserId: admin, newRole: "admin" }),
    ).toEqual({ ok: true, owners: 1, admins: 1 });
    expect(await memberAudit(orgId)).toHaveLength(0);
  });
});

describe("listMembers (V-26: one entry per user, conservative role)", () => {
  it("an organization whose only member is the owner lists one row", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const list = await listMembers(orgId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: ids[0], role: "owner" });
  });

  it("orders owners, admins, members, then name case-insensitively, then userId", async () => {
    const { orgId, ids } = await seed(["member", "admin", "member", "owner", "member", "admin"]);
    const names = ["bravo", "Zed", "alpha", "Yuri", "Bravo", "adam"];
    for (const [i, id] of ids.entries()) {
      await prisma.user.update({ where: { id }, data: { name: names[i] } });
    }
    const list = await listMembers(orgId);
    // Two members are named "bravo" and "Bravo": equal case-insensitively, so userId decides.
    const bravos = [ids[0], ids[4]].sort();
    expect(list.map((m) => [m.role, m.userId])).toEqual([
      ["owner", ids[3]],
      ["admin", ids[5]],
      ["admin", ids[1]],
      ["member", ids[2]],
      ["member", bravos[0]],
      ["member", bravos[1]],
    ]);
  });

  it("a user with duplicate rows is listed once with the conservative role", async () => {
    const { orgId, ids } = await seed(["owner", "owner", "admin"]);
    const [, mixedOwner, mixedAdmin] = ids;
    await addRow(orgId, mixedOwner, "admin"); // owner + admin: an admin, not an owner
    await addRow(orgId, mixedAdmin, "member"); // admin + member: a member
    await addRow(orgId, mixedAdmin, "admin");
    const list = await listMembers(orgId);
    expect(list).toHaveLength(3);
    expect(list.map((m) => [m.userId, m.role])).toEqual(
      expect.arrayContaining([
        [ids[0], "owner"],
        [mixedOwner, "admin"],
        [mixedAdmin, "member"],
      ]),
    );
    expect(list[0]?.userId).toBe(ids[0]);
    expect(list[2]?.userId).toBe(mixedAdmin);
  });

  it("an unknown role string is listed as member, never as admin or owner", async () => {
    const { orgId, ids } = await seed(["owner", "admin"]);
    await addRow(orgId, ids[1], "viewer");
    const list = await listMembers(orgId);
    expect(list.find((m) => m.userId === ids[1])?.role).toBe("member");
  });

  it("lists nothing of another organization", async () => {
    const a = await seed(["owner"]);
    const b = await seed(["owner", "member"]);
    const list = await listMembers(a.orgId);
    expect(list.map((m) => m.userId)).toEqual([a.ids[0]]);
    expect(list.some((m) => b.ids.includes(m.userId))).toBe(false);
  });
});

describe("assertOwnerFloor (direct cases, D-09 amended: the second guard)", () => {
  it("the only owner demoted throws LAST_OWNER", () => {
    expectLastOwner(() =>
      assertOwnerFloor({ ownersBefore: 1, targetIsOwner: true, targetStaysOwner: false }),
    );
  });

  it("the only owner removed (deactivation: targetStaysOwner false) throws LAST_OWNER", () => {
    expectLastOwner(() =>
      assertOwnerFloor({ ownersBefore: 1, targetIsOwner: true, targetStaysOwner: false }),
    );
    // A stale count of zero with an owner target fails closed as well.
    expectLastOwner(() =>
      assertOwnerFloor({ ownersBefore: 0, targetIsOwner: true, targetStaysOwner: false }),
    );
  });

  it("two owners with one removed passes and leaves one", () => {
    expect(
      assertOwnerFloor({ ownersBefore: 2, targetIsOwner: true, targetStaysOwner: false }),
    ).toBe(1);
  });

  it("an admin removed passes, also in an organization with no owner by count (O-4)", () => {
    expect(
      assertOwnerFloor({ ownersBefore: 1, targetIsOwner: false, targetStaysOwner: false }),
    ).toBe(1);
    expect(
      assertOwnerFloor({ ownersBefore: 0, targetIsOwner: false, targetStaysOwner: false }),
    ).toBe(0);
  });

  it("an owner kept an owner, and a promotion to owner, pass", () => {
    expect(assertOwnerFloor({ ownersBefore: 1, targetIsOwner: true, targetStaysOwner: true })).toBe(
      1,
    );
    expect(
      assertOwnerFloor({ ownersBefore: 1, targetIsOwner: false, targetStaysOwner: true }),
    ).toBe(2);
  });

  it("countOwners agrees with the floor's input after a promotion to owner", async () => {
    const { orgId, ids } = await seed(["owner", "admin"]);
    expect(await countOwners(prisma, orgId)).toBe(1);
    expect(
      await changeMemberRole({
        orgId,
        actorUserId: ids[0],
        targetUserId: ids[1],
        newRole: "owner",
      }),
    ).toEqual({ ok: true, owners: 2, admins: 0 });
    expect(await countOwners(prisma, orgId)).toBe(2);
  });
});
