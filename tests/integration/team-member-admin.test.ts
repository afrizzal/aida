// Phase 10, plan 10-03 (AIDA-43, D-07, D-09 amended, D-10, D-12, V-25, V-26): the team
// administration service on a real Postgres through Testcontainers, unmocked. Role changes and
// deactivations run under the organization lock with the duplicate-row rights of V-26; the owner
// floor is a second guard proven by direct assertOwnerFloor cases; races force their order with
// the lock-wait helpers (each run's backend PID recorded through the service's own hook, then
// waitForBlockedBy on exactly that PID), never with sleeps.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { MemberAdminError } from "@/lib/workspace-members/errors";
import {
  assertOwnerFloor,
  changeMemberRole,
  countOpenAssignedTickets,
  deactivateMember,
  listMembers,
  reassignOpenTickets,
} from "@/lib/workspace-members/member-admin";
import { countOwners } from "@/lib/workspace-members/member-rights";
import {
  type MemberRole,
  seedOrgWithMembers,
  seedTicket,
  stateIdFor,
} from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";
import { assertNoDeadlock, createObserverClient, settleAll } from "../support/project-race";

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

// ---------------------------------------------------------------------------------------------
// Task 2: deactivation (D-07, D-09, D-10, V-25, O-8) and reassignment after commit
// ---------------------------------------------------------------------------------------------

/** A second organization in which userId holds one member row created at `createdAt`. */
async function addOtherMembership(userId: string, createdAt: Date, id?: string) {
  const { orgId } = await seedOrgWithMembers(prisma, []);
  await prisma.member.create({
    data: { id: id ?? randomUUID(), organizationId: orgId, userId, role: "member", createdAt },
  });
  return orgId;
}

async function addSession(userId: string, activeOrganizationId: string | null) {
  const now = new Date();
  const id = randomUUID();
  await prisma.session.create({
    data: {
      id,
      token: `tok-${randomUUID()}`,
      userId,
      activeOrganizationId,
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

async function addInvitation(orgId: string, inviterId: string, email: string, status = "pending") {
  const id = randomUUID();
  await prisma.invitation.create({
    data: {
      id,
      organizationId: orgId,
      inviterId,
      email,
      role: "member",
      status,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      createdAt: new Date(),
    },
  });
  return id;
}

async function emailOf(userId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;
}

describe("deactivateMember (D-07, D-09, D-10, V-26 (5))", () => {
  it("deletes every member row of the user in this organization; the user and other memberships stay", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    await addRow(orgId, member, "member");
    const otherOrg = await addOtherMembership(member, new Date());

    const result = await deactivateMember({ orgId, actorUserId: owner, targetUserId: member });
    expect(result).toMatchObject({ ok: true, owners: 1, admins: 0 });
    expect(await rowsOf(orgId, member)).toEqual([]);
    expect(await prisma.user.findUnique({ where: { id: member } })).not.toBeNull();
    expect(await rowsOf(otherOrg, member)).toHaveLength(1);

    const audit = await memberAudit(orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "MEMBER_DEACTIVATED",
      actorUserId: owner,
      targetUserId: member,
      oldRole: "member",
      newRole: null,
    });
  });

  it("moves the target's sessions on this organization to the oldest remaining membership (createdAt, then id)", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const later = await addOtherMembership(member, new Date("2026-06-01T00:00:00.000Z"));
    // Two memberships with the same createdAt: the smaller member id decides.
    const tieA = await addOtherMembership(member, t0, `a-${randomUUID()}`);
    const tieB = await addOtherMembership(member, t0, `b-${randomUUID()}`);
    const onThis1 = await addSession(member, orgId);
    const onThis2 = await addSession(member, orgId);
    const onOther = await addSession(member, later);
    const ownerSession = await addSession(owner, orgId);

    const result = await deactivateMember({ orgId, actorUserId: owner, targetUserId: member });
    expect(result).toMatchObject({ ok: true, sessionsMoved: 2 });
    const read = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
    expect((await read(onThis1)).activeOrganizationId).toBe(tieA);
    expect((await read(onThis2)).activeOrganizationId).toBe(tieA);
    expect((await read(onOther)).activeOrganizationId).toBe(later);
    expect((await read(ownerSession)).activeOrganizationId).toBe(orgId);
    expect(tieB).not.toBe(tieA);
  });

  it("sets the moved sessions to null when the user has no other membership", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    const s = await addSession(member, orgId);
    const none = await addSession(member, null);
    expect(
      await deactivateMember({ orgId, actorUserId: owner, targetUserId: member }),
    ).toMatchObject({ ok: true, sessionsMoved: 1 });
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: s } })).activeOrganizationId,
    ).toBe(null);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: none } })).activeOrganizationId,
    ).toBe(null);
  });

  it("cancels pending invitations sent by the target and addressed to the target's email, in this organization only", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "member"]);
    const [owner, admin, other] = ids;
    const email = await emailOf(admin);
    const sent = await addInvitation(orgId, admin, `invitee-${randomUUID()}@example.test`);
    const toTarget = await addInvitation(orgId, owner, `  ${email.toUpperCase()} `);
    const unrelated = await addInvitation(orgId, other, `someone-${randomUUID()}@example.test`);
    const accepted = await addInvitation(
      orgId,
      admin,
      `old-${randomUUID()}@example.test`,
      "accepted",
    );
    const elsewhere = await seed(["owner"]);
    const foreign = await addInvitation(elsewhere.orgId, elsewhere.ids[0], email);

    const result = await deactivateMember({ orgId, actorUserId: owner, targetUserId: admin });
    expect(result).toMatchObject({ ok: true, invitationsRevoked: 2 });
    const status = async (id: string) =>
      (await prisma.invitation.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(sent)).toBe("canceled");
    expect(await status(toTarget)).toBe("canceled");
    expect(await status(unrelated)).toBe("pending");
    expect(await status(accepted)).toBe("accepted");
    expect(await status(foreign)).toBe("pending");

    const audit = await memberAudit(orgId);
    const revoked = audit.filter((a) => a.action === "INVITATION_REVOKED");
    expect(revoked.map((a) => a.invitationId).sort()).toEqual([sent, toTarget].sort());
    expect(revoked.every((a) => a.actorUserId === owner)).toBe(true);
    expect(audit.filter((a) => a.action === "MEMBER_DEACTIVATED")).toHaveLength(1);
    expect(await memberAudit(elsewhere.orgId)).toHaveLength(0);
  });

  it("rule matrix: admin on an owner or an owner-row target, member on anyone and self are refused", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "member", "member"]);
    const [owner, admin, member, mixed] = ids;
    await addRow(orgId, mixed, "owner"); // member + owner rows: protected like an owner

    expect(await deactivateMember({ orgId, actorUserId: admin, targetUserId: owner })).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect(await deactivateMember({ orgId, actorUserId: admin, targetUserId: mixed })).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect(await deactivateMember({ orgId, actorUserId: member, targetUserId: mixed })).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect(await deactivateMember({ orgId, actorUserId: member, targetUserId: admin })).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect(await deactivateMember({ orgId, actorUserId: admin, targetUserId: admin })).toEqual({
      ok: false,
      error: "SELF_CHANGE",
    });
    expect(await memberAudit(orgId)).toHaveLength(0);

    // An admin may deactivate a plain member; one MEMBER_DEACTIVATED row per success.
    expect(
      await deactivateMember({ orgId, actorUserId: admin, targetUserId: member }),
    ).toMatchObject({ ok: true });
    const audit = await memberAudit(orgId);
    expect(audit.map((a) => a.action)).toEqual(["MEMBER_DEACTIVATED"]);
    expect(await rowsOf(orgId, mixed)).toHaveLength(2);
  });

  it("a user id of another organization is NOT_A_MEMBER and nothing changes there (T-10-13)", async () => {
    const a = await seed(["owner"]);
    const b = await seed(["owner", "member"]);
    expect(
      await deactivateMember({ orgId: a.orgId, actorUserId: a.ids[0], targetUserId: b.ids[1] }),
    ).toEqual({ ok: false, error: "NOT_A_MEMBER" });
    expect(
      await changeMemberRole({
        orgId: a.orgId,
        actorUserId: a.ids[0],
        targetUserId: b.ids[1],
        newRole: "admin",
      }),
    ).toEqual({ ok: false, error: "NOT_A_MEMBER" });
    expect(await rowsOf(b.orgId, b.ids[1])).toEqual([expect.objectContaining({ role: "member" })]);
  });

  it("adjacency: one owner, an admin on that owner is NOT_ALLOWED and the owner on themselves SELF_CHANGE", async () => {
    const { orgId, ids } = await seed(["owner", "admin"]);
    const [owner, admin] = ids;
    expect(await deactivateMember({ orgId, actorUserId: admin, targetUserId: owner })).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect(
      await changeMemberRole({ orgId, actorUserId: admin, targetUserId: owner, newRole: "member" }),
    ).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await deactivateMember({ orgId, actorUserId: owner, targetUserId: owner })).toEqual({
      ok: false,
      error: "SELF_CHANGE",
    });
    expect(
      await changeMemberRole({ orgId, actorUserId: owner, targetUserId: owner, newRole: "admin" }),
    ).toEqual({ ok: false, error: "SELF_CHANGE" });
    expect(await countOwners(prisma, orgId)).toBe(1);
  });

  it("adjacency: owners A and B, A deactivates B, then A acting on themselves is SELF_CHANGE", async () => {
    const { orgId, ids } = await seed(["owner", "owner"]);
    const [a, b] = ids;
    expect(await deactivateMember({ orgId, actorUserId: a, targetUserId: b })).toMatchObject({
      ok: true,
      owners: 1,
    });
    expect(await deactivateMember({ orgId, actorUserId: a, targetUserId: a })).toEqual({
      ok: false,
      error: "SELF_CHANGE",
    });
    expect(
      await changeMemberRole({ orgId, actorUserId: a, targetUserId: a, newRole: "member" }),
    ).toEqual({ ok: false, error: "SELF_CHANGE" });
    expect(await countOwners(prisma, orgId)).toBe(1);
  });

  it("duplicate rows: an owner with an extra admin row is no owner; every owner-right action is NOT_ALLOWED (O-4)", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "member"]);
    const [mixedOwner, admin, member] = ids;
    await addRow(orgId, mixedOwner, "admin");
    expect(await countOwners(prisma, orgId)).toBe(0);

    expect(
      await changeMemberRole({
        orgId,
        actorUserId: mixedOwner,
        targetUserId: member,
        newRole: "owner",
      }),
    ).toEqual({ ok: false, error: "NOT_ALLOWED" });
    // Acting on a target with an owner row is an owner right as well.
    const second = await seed(["owner", "owner"]);
    await addRow(second.orgId, second.ids[0], "admin");
    await addRow(second.orgId, second.ids[1], "admin");
    expect(
      await deactivateMember({
        orgId: second.orgId,
        actorUserId: second.ids[0],
        targetUserId: second.ids[1],
      }),
    ).toEqual({ ok: false, error: "NOT_ALLOWED" });
    // Admin rights stay: the mixed owner may still demote a plain admin.
    expect(
      await changeMemberRole({
        orgId,
        actorUserId: mixedOwner,
        targetUserId: admin,
        newRole: "member",
      }),
    ).toMatchObject({ ok: true, owners: 0 });
    expect(await countOwners(prisma, orgId)).toBe(0);
  });

  it("duplicate rows: an admin acting on a target with an owner and a member row is NOT_ALLOWED", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "member"]);
    const [, admin, target] = ids;
    await addRow(orgId, target, "owner");
    expect(
      await changeMemberRole({ orgId, actorUserId: admin, targetUserId: target, newRole: "admin" }),
    ).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await deactivateMember({ orgId, actorUserId: admin, targetUserId: target })).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect((await rowsOf(orgId, target)).map((r) => r.role).sort()).toEqual(["member", "owner"]);
  });

  it("a role change that lowers the target's rights cancels the invitations the target sent", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "member"]);
    const [owner, admin, member] = ids;
    const byAdmin = await addInvitation(orgId, admin, `i-${randomUUID()}@example.test`);
    const byMember = await addInvitation(orgId, member, `j-${randomUUID()}@example.test`);
    expect(
      await changeMemberRole({ orgId, actorUserId: owner, targetUserId: member, newRole: "admin" }),
    ).toMatchObject({ ok: true });
    expect(
      await changeMemberRole({ orgId, actorUserId: owner, targetUserId: admin, newRole: "member" }),
    ).toMatchObject({ ok: true });
    const status = async (id: string) =>
      (await prisma.invitation.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(byAdmin)).toBe("canceled");
    expect(await status(byMember)).toBe("pending");
    const audit = await memberAudit(orgId);
    expect(audit.map((a) => a.action)).toEqual([
      "ROLE_CHANGED",
      "INVITATION_REVOKED",
      "ROLE_CHANGED",
    ]);
    expect(audit[1]?.invitationId).toBe(byAdmin);
  });

  it("changes no ProjectMember row and is not blocked by a private project (O-8 default)", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    const project = await prisma.project.create({
      data: { organizationId: orgId, name: "Private", keyPrefix: "PRV", isPrivate: true },
    });
    await prisma.projectMember.create({
      data: { organizationId: orgId, projectId: project.id, userId: member, role: "MANAGER" },
    });
    expect(
      await deactivateMember({ orgId, actorUserId: owner, targetUserId: member }),
    ).toMatchObject({ ok: true });
    expect(
      await prisma.projectMember.count({ where: { organizationId: orgId, userId: member } }),
    ).toBe(1);
  });
});

describe("reassignOpenTickets and countOpenAssignedTickets (V-25, D-07)", () => {
  it("without reassignment the open tickets keep their assignee; the count uses the open definition", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    const open = await seedTicket(orgId, { status: "OPEN", assigneeId: member });
    const fresh = await seedTicket(orgId, { status: "NEW", assigneeId: member });
    const pending = await seedTicket(orgId, { status: "PENDING", assigneeId: member });
    await seedTicket(orgId, { status: "RESOLVED", assigneeId: member });
    await seedTicket(orgId, { status: "CLOSED", assigneeId: member });
    await seedTicket(orgId, { status: "OPEN", assigneeId: owner });
    expect(await countOpenAssignedTickets(orgId, member)).toBe(3);

    expect(
      await deactivateMember({ orgId, actorUserId: owner, targetUserId: member }),
    ).toMatchObject({ ok: true });
    for (const t of [open, fresh, pending]) {
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBe(
        member,
      );
    }
    expect(await countOpenAssignedTickets(orgId, member)).toBe(3);
  });

  it("moves open tickets to a current member, leaves resolved and closed ones, one audit row per moved ticket", async () => {
    const { orgId, ids } = await seed(["owner", "member", "member"]);
    const [owner, gone, heir] = ids;
    const open = await seedTicket(orgId, { status: "OPEN", assigneeId: gone });
    const pending = await seedTicket(orgId, { status: "PENDING", assigneeId: gone });
    const resolved = await seedTicket(orgId, { status: "RESOLVED", assigneeId: gone });
    const closed = await seedTicket(orgId, { status: "CLOSED", assigneeId: gone });
    expect(await deactivateMember({ orgId, actorUserId: owner, targetUserId: gone })).toMatchObject(
      { ok: true },
    );

    const result = await reassignOpenTickets({
      orgId,
      actorUserId: owner,
      fromUserId: gone,
      toUserId: heir,
    });
    expect(result).toEqual({ ok: true, reassigned: 2, skipped: 0, failed: 0, batchErrors: [] });
    const assignee = async (id: string) =>
      (await prisma.ticket.findUniqueOrThrow({ where: { id } })).assigneeId;
    expect(await assignee(open.id)).toBe(heir);
    expect(await assignee(pending.id)).toBe(heir);
    expect(await assignee(resolved.id)).toBe(gone);
    expect(await assignee(closed.id)).toBe(gone);
    const audit = await prisma.ticketAuditEvent.findMany({ where: { organizationId: orgId } });
    expect(audit.map((a) => a.ticketId).sort()).toEqual([open.id, pending.id].sort());
    for (const row of audit) {
      expect(row).toMatchObject({ action: "ASSIGNEE_CHANGED", actorUserId: owner });
      expect(row.before).toEqual({ assigneeId: gone });
      expect(row.after).toEqual({ assigneeId: heir });
    }
    expect(await countOpenAssignedTickets(orgId, gone)).toBe(0);
  });

  it("a ticket reassigned or resolved between the list and the batch is skipped and counted", async () => {
    const { orgId, ids } = await seed(["owner", "member", "member", "member"]);
    const [owner, gone, heir, someoneElse] = ids;
    const keep = await seedTicket(orgId, { status: "OPEN", assigneeId: gone });
    const taken = await seedTicket(orgId, { status: "OPEN", assigneeId: gone });
    const done = await seedTicket(orgId, { status: "OPEN", assigneeId: gone });
    await deactivateMember({ orgId, actorUserId: owner, targetUserId: gone });
    const resolvedId = await stateIdFor(orgId, "RESOLVED");

    const result = await reassignOpenTickets(
      { orgId, actorUserId: owner, fromUserId: gone, toUserId: heir },
      {
        async beforeBatch(ticketIds) {
          expect([...ticketIds].sort()).toEqual([keep.id, taken.id, done.id].sort());
          await prisma.ticket.update({
            where: { id: taken.id },
            data: { assigneeId: someoneElse },
          });
          await prisma.ticket.update({ where: { id: done.id }, data: { stateId: resolvedId } });
        },
      },
    );
    expect(result).toEqual({ ok: true, reassigned: 1, skipped: 2, failed: 0, batchErrors: [] });
    const assignee = async (id: string) =>
      (await prisma.ticket.findUniqueOrThrow({ where: { id } })).assigneeId;
    expect(await assignee(keep.id)).toBe(heir);
    expect(await assignee(taken.id)).toBe(someoneElse);
    expect(await assignee(done.id)).toBe(gone);
    const audit = await prisma.ticketAuditEvent.findMany({ where: { organizationId: orgId } });
    expect(audit.map((a) => a.ticketId)).toEqual([keep.id]);
  });

  it("a reassignee who is not a member fails the batch with MEMBER_NOT_ACTIVE and changes nothing; a retry succeeds", async () => {
    const { orgId, ids } = await seed(["owner", "member", "member"]);
    const [owner, gone, heir] = ids;
    const stranger = (await seed(["owner"])).ids[0];
    const t1 = await seedTicket(orgId, { status: "OPEN", assigneeId: gone });
    const t2 = await seedTicket(orgId, { status: "OPEN", assigneeId: gone });
    await deactivateMember({ orgId, actorUserId: owner, targetUserId: gone });

    expect(
      await reassignOpenTickets({
        orgId,
        actorUserId: owner,
        fromUserId: gone,
        toUserId: stranger,
      }),
    ).toEqual({
      ok: true,
      reassigned: 0,
      skipped: 0,
      failed: 2,
      batchErrors: ["MEMBER_NOT_ACTIVE"],
    });
    for (const t of [t1, t2]) {
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBe(
        gone,
      );
    }
    expect(await prisma.ticketAuditEvent.count({ where: { organizationId: orgId } })).toBe(0);

    // Calling it again retries what is still assigned to the deactivated user.
    expect(
      await reassignOpenTickets({ orgId, actorUserId: owner, fromUserId: gone, toUserId: heir }),
    ).toEqual({ ok: true, reassigned: 2, skipped: 0, failed: 0, batchErrors: [] });
  });

  it("refuses a non-admin actor with NOT_ALLOWED and the same user as both ends with INVALID_REASSIGNEE", async () => {
    const { orgId, ids } = await seed(["owner", "member", "member"]);
    const [owner, member, other] = ids;
    await seedTicket(orgId, { status: "OPEN", assigneeId: other });
    expect(
      await reassignOpenTickets({
        orgId,
        actorUserId: member,
        fromUserId: other,
        toUserId: member,
      }),
    ).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(
      await reassignOpenTickets({ orgId, actorUserId: owner, fromUserId: other, toUserId: other }),
    ).toEqual({ ok: false, error: "INVALID_REASSIGNEE" });
    expect(await countOpenAssignedTickets(orgId, other)).toBe(1);
  });

  it("150 open tickets move in two batches with one TicketAuditEvent per moved ticket", {
    timeout: 180_000,
  }, async () => {
    const { orgId, ids } = await seed(["owner", "member", "member"]);
    const [owner, gone, heir] = ids;
    for (let i = 0; i < 150; i++) await seedTicket(orgId, { status: "OPEN", assigneeId: gone });
    expect(await countOpenAssignedTickets(orgId, gone)).toBe(150);
    await deactivateMember({ orgId, actorUserId: owner, targetUserId: gone });

    const batches: number[] = [];
    const result = await reassignOpenTickets(
      { orgId, actorUserId: owner, fromUserId: gone, toUserId: heir },
      {
        beforeBatch(ticketIds) {
          batches.push(ticketIds.length);
        },
      },
    );
    expect(result).toEqual({ ok: true, reassigned: 150, skipped: 0, failed: 0, batchErrors: [] });
    expect(batches).toEqual([100, 50]);
    expect(await countOpenAssignedTickets(orgId, heir)).toBe(150);
    const audit = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId },
      select: { ticketId: true, batchId: true, action: true },
    });
    expect(audit).toHaveLength(150);
    expect(new Set(audit.map((a) => a.ticketId)).size).toBe(150);
    expect(new Set(audit.map((a) => a.batchId)).size).toBe(2);
    expect(audit.every((a) => a.action === "ASSIGNEE_CHANGED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 3: forced-order races (C3, R2-4, R3-3, V-16, V-26). The holder records its backend PID from
// inside its own transaction in a service hook and parks there on a deferred; the waiter records
// its PID in beforeLock; waitForBlockedBy proves that exact PID is blocked by the holder's PID
// before the holder is released. Every race asserts the error code its check order produces and
// the final database state, and ends with assertNoDeadlock. None expects LAST_OWNER: the loser
// fails at the actor re-read (NOT_ALLOWED) or the target read (NOT_A_MEMBER), D-09 amended.
// ---------------------------------------------------------------------------------------------

const observer = createObserverClient();
afterAll(async () => {
  await observer.close();
});

type Tx = Prisma.TransactionClient;

/** A hook that records the PID of its transaction and parks until release(). */
function holdPoint() {
  const pid = deferred<number>();
  const gate = deferred<void>();
  return {
    pid: pid.promise,
    release: () => gate.resolve(),
    hook: async (tx: Tx) => {
      pid.resolve(await backendPid(tx));
      await gate.promise;
    },
  };
}

/** A hook that records the PID of its transaction and continues. */
function pidPoint() {
  const pid = deferred<number>();
  return {
    pid: pid.promise,
    hook: async (tx: Tx) => {
      pid.resolve(await backendPid(tx));
    },
  };
}

/**
 * Starts the holder (parked in its hook), then the waiter, runs `proveBlocked` with both recorded
 * PIDs (each race passes waitForBlockedBy: the waiter's PID blocked by the holder's PID), always
 * releases the holder, and returns both settled results after assertNoDeadlock.
 */
async function forcedOrder<H, W>(
  startHolder: (hook: (tx: Tx) => Promise<void>) => Promise<H>,
  startWaiter: (hook: (tx: Tx) => Promise<void>) => Promise<W>,
  proveBlocked: (holderPid: number, waiterPid: number) => Promise<void>,
): Promise<[PromiseSettledResult<H>, PromiseSettledResult<W>]> {
  const hold = holdPoint();
  const wait = pidPoint();
  const holder = startHolder(hold.hook);
  holder.catch(() => {});
  let waiter: Promise<W> | undefined;
  try {
    const holderPid = await hold.pid;
    waiter = startWaiter(wait.hook);
    waiter.catch(() => {});
    const waiterPid = await wait.pid;
    await proveBlocked(holderPid, waiterPid);
  } finally {
    hold.release();
  }
  const results = (await settleAll<unknown>([holder, waiter ?? Promise.resolve()])) as [
    PromiseSettledResult<H>,
    PromiseSettledResult<W>,
  ];
  assertNoDeadlock(results);
  return results;
}

function settledValue<T>(r: PromiseSettledResult<T>): T {
  if (r.status !== "fulfilled") throw r.reason;
  return r.value;
}

describe("races between the last two owners (D-09 amended, R2-4)", () => {
  it("owners A and B deactivate each other: A succeeds, B is NOT_ALLOWED, one owner remains", async () => {
    const { orgId, ids } = await seed(["owner", "owner"]);
    const [a, b] = ids;
    const [first, second] = await forcedOrder(
      (hook) => deactivateMember({ orgId, actorUserId: a, targetUserId: b }, { afterLock: hook }),
      (hook) => deactivateMember({ orgId, actorUserId: b, targetUserId: a }, { beforeLock: hook }),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(first)).toMatchObject({ ok: true, owners: 1, admins: 0 });
    expect(settledValue(second)).toEqual({ ok: false, error: "NOT_ALLOWED" });

    expect((await rowsOf(orgId, a)).map((r) => r.role)).toEqual(["owner"]);
    expect(await rowsOf(orgId, b)).toEqual([]);
    expect(await countOwners(prisma, orgId)).toBe(1);
    const audit = await memberAudit(orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "MEMBER_DEACTIVATED",
      actorUserId: a,
      targetUserId: b,
    });
  });

  it("owners A and B demote each other to admin: A succeeds, B is NOT_ALLOWED, A owner and B admin", async () => {
    const { orgId, ids } = await seed(["owner", "owner"]);
    const [a, b] = ids;
    const [first, second] = await forcedOrder(
      (hook) =>
        changeMemberRole(
          { orgId, actorUserId: a, targetUserId: b, newRole: "admin" },
          { afterLock: hook },
        ),
      (hook) =>
        changeMemberRole(
          { orgId, actorUserId: b, targetUserId: a, newRole: "admin" },
          { beforeLock: hook },
        ),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(first)).toEqual({ ok: true, owners: 1, admins: 1 });
    expect(settledValue(second)).toEqual({ ok: false, error: "NOT_ALLOWED" });

    expect((await rowsOf(orgId, a)).map((r) => r.role)).toEqual(["owner"]);
    expect((await rowsOf(orgId, b)).map((r) => r.role)).toEqual(["admin"]);
    expect(await countOwners(prisma, orgId)).toBe(1);
    const audit = await memberAudit(orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "ROLE_CHANGED",
      actorUserId: a,
      targetUserId: b,
      oldRole: "owner",
      newRole: "admin",
    });
  });
});

describe("an actor removed or demoted mid-race (R2-4)", () => {
  it("owner O deactivates admin X while X deactivates member M: X is NOT_ALLOWED, M stays", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "member"]);
    const [o, x, m] = ids;
    const [first, second] = await forcedOrder(
      (hook) => deactivateMember({ orgId, actorUserId: o, targetUserId: x }, { afterLock: hook }),
      (hook) => deactivateMember({ orgId, actorUserId: x, targetUserId: m }, { beforeLock: hook }),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(first)).toMatchObject({ ok: true, owners: 1, admins: 0 });
    expect(settledValue(second)).toEqual({ ok: false, error: "NOT_ALLOWED" });

    expect(await rowsOf(orgId, x)).toEqual([]);
    expect((await rowsOf(orgId, m)).map((r) => r.role)).toEqual(["member"]);
    const audit = await memberAudit(orgId);
    expect(audit.map((a) => [a.action, a.targetUserId])).toEqual([["MEMBER_DEACTIVATED", x]]);
  });

  it("owner O demotes admin X to member while X deactivates member M: X is NOT_ALLOWED, M stays", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "member"]);
    const [o, x, m] = ids;
    const [first, second] = await forcedOrder(
      (hook) =>
        changeMemberRole(
          { orgId, actorUserId: o, targetUserId: x, newRole: "member" },
          { afterLock: hook },
        ),
      (hook) => deactivateMember({ orgId, actorUserId: x, targetUserId: m }, { beforeLock: hook }),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(first)).toEqual({ ok: true, owners: 1, admins: 0 });
    expect(settledValue(second)).toEqual({ ok: false, error: "NOT_ALLOWED" });

    expect((await rowsOf(orgId, x)).map((r) => r.role)).toEqual(["member"]);
    expect((await rowsOf(orgId, m)).map((r) => r.role)).toEqual(["member"]);
    const audit = await memberAudit(orgId);
    expect(audit.map((a) => [a.action, a.targetUserId, a.newRole])).toEqual([
      ["ROLE_CHANGED", x, "member"],
    ]);
  });
});

describe("serialised deactivations that both may succeed, and one target twice", () => {
  it("owner O deactivates admins X and Y under a forced order: both succeed and the owner count stays 1", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "admin"]);
    const [o, x, y] = ids;
    const [first, second] = await forcedOrder(
      (hook) => deactivateMember({ orgId, actorUserId: o, targetUserId: x }, { afterLock: hook }),
      (hook) => deactivateMember({ orgId, actorUserId: o, targetUserId: y }, { beforeLock: hook }),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(first)).toMatchObject({ ok: true, owners: 1, admins: 1 });
    expect(settledValue(second)).toMatchObject({ ok: true, owners: 1, admins: 0 });

    expect(await rowsOf(orgId, x)).toEqual([]);
    expect(await rowsOf(orgId, y)).toEqual([]);
    expect(await countOwners(prisma, orgId)).toBe(1);
    const audit = await memberAudit(orgId);
    expect(audit.map((a) => a.targetUserId)).toEqual([x, y]);
  });

  it("two admins deactivate the same member: one success, one NOT_A_MEMBER, one audit row", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "admin", "member"]);
    const [, x1, x2, m] = ids;
    await addRow(orgId, m, "member");
    const [first, second] = await forcedOrder(
      (hook) => deactivateMember({ orgId, actorUserId: x1, targetUserId: m }, { afterLock: hook }),
      (hook) => deactivateMember({ orgId, actorUserId: x2, targetUserId: m }, { beforeLock: hook }),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(first)).toMatchObject({ ok: true });
    expect(settledValue(second)).toEqual({ ok: false, error: "NOT_A_MEMBER" });

    expect(await rowsOf(orgId, m)).toEqual([]);
    const audit = await memberAudit(orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "MEMBER_DEACTIVATED",
      actorUserId: x1,
      targetUserId: m,
    });
  });
});

describe("duplicate rows under the lock (V-26 (2), O-4)", () => {
  it("an owner with an extra admin row and no other owner cannot grant owner, behind a held change", async () => {
    const { orgId, ids } = await seed(["owner", "admin", "member"]);
    const [d, admin, m] = ids;
    await addRow(orgId, d, "admin");
    expect(await countOwners(prisma, orgId)).toBe(0);

    const [first, second] = await forcedOrder(
      (hook) =>
        changeMemberRole(
          { orgId, actorUserId: d, targetUserId: admin, newRole: "member" },
          { afterLock: hook },
        ),
      (hook) =>
        changeMemberRole(
          { orgId, actorUserId: d, targetUserId: m, newRole: "owner" },
          { beforeLock: hook },
        ),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(first)).toEqual({ ok: true, owners: 0, admins: 1 });
    expect(settledValue(second)).toEqual({ ok: false, error: "NOT_ALLOWED" });

    expect(await countOwners(prisma, orgId)).toBe(0);
    expect((await rowsOf(orgId, m)).map((r) => r.role)).toEqual(["member"]);
    expect((await rowsOf(orgId, d)).map((r) => r.role).sort()).toEqual(["admin", "owner"]);
  });

  it("a real owner's change to owner makes every row owner; the mixed user's grant queued behind it then succeeds", async () => {
    const { orgId, ids } = await seed(["owner", "owner", "member"]);
    const [r, d, m] = ids;
    await addRow(orgId, d, "admin");
    expect(await countOwners(prisma, orgId)).toBe(1);

    const [first, second] = await forcedOrder(
      (hook) =>
        changeMemberRole(
          { orgId, actorUserId: r, targetUserId: d, newRole: "owner" },
          { afterLock: hook },
        ),
      (hook) =>
        changeMemberRole(
          { orgId, actorUserId: d, targetUserId: m, newRole: "owner" },
          { beforeLock: hook },
        ),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(first)).toEqual({ ok: true, owners: 2, admins: 0 });
    // The waiter re-read d's rights under the lock, after the holder committed.
    expect(settledValue(second)).toEqual({ ok: true, owners: 3, admins: 0 });

    const dRows = await rowsOf(orgId, d);
    expect(dRows).toHaveLength(2);
    expect(dRows.map((row) => row.role)).toEqual(["owner", "owner"]);
    expect((await rowsOf(orgId, m)).map((row) => row.role)).toEqual(["owner"]);
    const audit = await memberAudit(orgId);
    expect(audit.map((a) => [a.actorUserId, a.targetUserId, a.oldRole, a.newRole])).toEqual([
      [r, d, "admin", "owner"],
      [d, m, "member", "owner"],
    ]);
  });
});
