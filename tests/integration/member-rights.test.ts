// Phase 10, V-26 (1) to (4) on a real Postgres through Testcontainers, unmocked: the rights of a
// user who holds more than one member row in one organization. Better Auth's member table has no
// unique key on (organizationId, userId) while owner item O-4 (12.2-o4) is open, so these rules
// must hold with duplicate rows:
//   (1) isAdmin uses findConservativeMembership's deciding row: admin only when EVERY row is
//       owner or admin;
//   (2) isOwner needs every row to be `owner`; countOwners counts distinct users all of whose rows
//       are `owner`;
//   (3) hasOwnerRow is true when ANY row is `owner` (target protection);
//   (4) a role string outside owner, admin and member is never admin and never owner.
//
// Duplicate rows are inserted with explicit ids and createdAt, as
// authz-conservative-membership.test.ts:34 does, in both id orders so neither the heap order nor
// the id order can hide a wrong read.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  countOwners,
  isMemberRole,
  MEMBER_ROLES,
  readMemberRights,
} from "@/lib/workspace-members/member-rights";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

type Placement = "before" | "after";

/** Adds one more member row for userId with an id that sorts before or after the fixture's. */
async function addRow(
  orgId: string,
  userId: string,
  baseMemberId: string,
  role: string,
  placement: Placement,
): Promise<string> {
  const id = `${placement === "before" ? "0" : "z"}-v26-${randomUUID()}-${baseMemberId}`;
  await prisma.member.create({
    data: { id, organizationId: orgId, userId, role, createdAt: new Date() },
  });
  return id;
}

/** A user with one fixture row of `first` (a seeded role) and a second row of `second`. */
async function seedTwoRows(
  first: "owner" | "admin" | "member",
  second: string,
  placement: Placement,
) {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", first]);
  const user = users[1];
  if (!user) throw new Error("fixture user missing");
  const extraId = await addRow(orgId, user.id, user.memberId, second, placement);
  return { orgId, userId: user.id, memberIds: [user.memberId, extraId].sort() };
}

describe("MEMBER_ROLES and isMemberRole (D-13, V-02)", () => {
  it("knows exactly owner, admin and member", () => {
    expect([...MEMBER_ROLES]).toEqual(["owner", "admin", "member"]);
    for (const role of MEMBER_ROLES) expect(isMemberRole(role)).toBe(true);
    for (const other of [
      "viewer",
      "Owner",
      "ADMIN",
      "member,admin",
      " owner",
      "",
      null,
      undefined,
      1,
    ]) {
      expect(isMemberRole(other), String(other)).toBe(false);
    }
  });
});

describe("readMemberRights with duplicate member rows (V-26)", () => {
  it("one owner row: isMember, isAdmin, isOwner and hasOwnerRow are all true", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
    const owner = users[0];
    if (!owner) throw new Error("fixture user missing");
    const rights = await readMemberRights(prisma, orgId, owner.id);
    expect(rights).toEqual({
      isMember: true,
      isAdmin: true,
      isOwner: true,
      hasOwnerRow: true,
      rowCount: 1,
      rowIds: [owner.memberId],
    });
  });

  for (const placement of ["before", "after"] as const) {
    it(`owner and admin rows (extra row ${placement}): isAdmin true, isOwner false, hasOwnerRow true`, async () => {
      const { orgId, userId, memberIds } = await seedTwoRows("owner", "admin", placement);
      const rights = await readMemberRights(prisma, orgId, userId);
      expect(rights).toEqual({
        isMember: true,
        isAdmin: true,
        isOwner: false,
        hasOwnerRow: true,
        rowCount: 2,
        rowIds: memberIds,
      });
    });

    it(`owner and member rows (extra row ${placement}): isAdmin false, isOwner false, hasOwnerRow true`, async () => {
      const { orgId, userId } = await seedTwoRows("owner", "member", placement);
      const rights = await readMemberRights(prisma, orgId, userId);
      expect(rights.isMember).toBe(true);
      expect(rights.isAdmin).toBe(false);
      expect(rights.isOwner).toBe(false);
      expect(rights.hasOwnerRow).toBe(true);
      expect(rights.rowCount).toBe(2);
    });

    it(`admin and viewer rows (extra row ${placement}): isAdmin false (an unknown role fails closed)`, async () => {
      const { orgId, userId } = await seedTwoRows("admin", "viewer", placement);
      const rights = await readMemberRights(prisma, orgId, userId);
      expect(rights.isMember).toBe(true);
      expect(rights.isAdmin).toBe(false);
      expect(rights.isOwner).toBe(false);
      expect(rights.hasOwnerRow).toBe(false);
    });

    it(`owner and viewer rows (extra row ${placement}): isAdmin false and isOwner false`, async () => {
      const { orgId, userId } = await seedTwoRows("owner", "viewer", placement);
      const rights = await readMemberRights(prisma, orgId, userId);
      expect(rights.isAdmin).toBe(false);
      expect(rights.isOwner).toBe(false);
      expect(rights.hasOwnerRow).toBe(true);
    });
  }

  it("a lone unknown role is a member row that is never admin and never owner", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
    const owner = users[0];
    if (!owner) throw new Error("fixture user missing");
    const other = await seedOrgWithMembers(prisma, ["member"]);
    const user = other.users[0];
    if (!user) throw new Error("fixture user missing");
    await addRow(orgId, user.id, user.memberId, "viewer", "after");
    const rights = await readMemberRights(prisma, orgId, user.id);
    expect(rights).toMatchObject({
      isMember: true,
      isAdmin: false,
      isOwner: false,
      hasOwnerRow: false,
      rowCount: 1,
    });
  });

  it("no row: isMember false and every flag false", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const stranger = await seedOrgWithMembers(prisma, ["owner"]);
    const user = stranger.users[0];
    if (!user) throw new Error("fixture user missing");
    const rights = await readMemberRights(prisma, orgId, user.id);
    expect(rights).toEqual({
      isMember: false,
      isAdmin: false,
      isOwner: false,
      hasOwnerRow: false,
      rowCount: 0,
      rowIds: [],
    });
    expect(await readMemberRights(prisma, "", user.id)).toMatchObject({
      isMember: false,
      rowCount: 0,
    });
    expect(await readMemberRights(prisma, orgId, "")).toMatchObject({
      isMember: false,
      rowCount: 0,
    });
  });

  it("reads only the given organization's rows (an owner elsewhere is a plain member here)", async () => {
    const here = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const user = here.users[1];
    if (!user) throw new Error("fixture user missing");
    const elsewhere = await seedOrgWithMembers(prisma, ["owner"]);
    await prisma.member.create({
      data: {
        id: `0-v26-elsewhere-${randomUUID()}`,
        organizationId: elsewhere.orgId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const rights = await readMemberRights(prisma, here.orgId, user.id);
    expect(rights).toMatchObject({
      isMember: true,
      isAdmin: false,
      isOwner: false,
      hasOwnerRow: false,
      rowCount: 1,
    });
  });

  it("works on an interactive transaction client", async () => {
    const { orgId, userId } = await seedTwoRows("owner", "admin", "before");
    const rights = await prisma.$transaction((tx) => readMemberRights(tx, orgId, userId));
    expect(rights).toMatchObject({ isAdmin: true, isOwner: false, hasOwnerRow: true, rowCount: 2 });
  });
});

describe("countOwners counts distinct users all of whose rows are owner (V-26 (2))", () => {
  it("owner A, owner-plus-admin B and admin C give 1; a second owner row for A still gives 1; a third user with two owner rows gives 2", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "owner", "admin"]);
    const [a, b] = users;
    if (!a || !b) throw new Error("fixture users missing");
    await addRow(orgId, b.id, b.memberId, "admin", "before");
    expect(await countOwners(prisma, orgId)).toBe(1);

    await addRow(orgId, a.id, a.memberId, "owner", "after");
    expect(await countOwners(prisma, orgId)).toBe(1);

    const d = await seedOrgWithMembers(prisma, ["member"]);
    const dUser = d.users[0];
    if (!dUser) throw new Error("fixture user missing");
    await addRow(orgId, dUser.id, dUser.memberId, "owner", "before");
    await addRow(orgId, dUser.id, dUser.memberId, "owner", "after");
    expect(await countOwners(prisma, orgId)).toBe(2);
  });

  it("ignores other organizations and unknown roles, and gives 0 for an organization without owners", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin"]);
    const owner = users[0];
    if (!owner) throw new Error("fixture user missing");
    await addRow(orgId, owner.id, owner.memberId, "viewer", "after");
    expect(await countOwners(prisma, orgId)).toBe(0);

    const other = await seedOrgWithMembers(prisma, ["owner", "owner"]);
    expect(await countOwners(prisma, other.orgId)).toBe(2);
    expect(await countOwners(prisma, randomUUID())).toBe(0);
  });
});
