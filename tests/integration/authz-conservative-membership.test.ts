// Phase 9, run decision K151 (Codex diff critique round 1, finding 4): getActiveOrgAccess, the one
// session-plus-role read behind every admin write gate (requireOrgAdminScope), reads the caller's
// member rows conservatively, on a real Postgres through Testcontainers. Better Auth's member
// table has no unique key on (organizationId, userId), so one user can hold an admin row and a
// plain member row in the same organization. An unordered single-row read (findFirst) returns
// whichever row the scan meets first; the conservative read (findConservativeMembership) is admin
// only when every row is owner or admin.
//
// Each mixed case inserts the two rows in both orders and with the extra row's id sorting before
// and after the first row's, so neither the heap order nor the id order can hide the old read.
// Only the session read is replaced (it returns the seeded user with the seeded organization
// active); the member rows, the query and the gate are real.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionEnv = vi.hoisted(() => ({ userId: "", orgId: "" }));

vi.mock("@/lib/session", () => ({
  requireSession: async () => ({
    user: { id: sessionEnv.userId },
    session: { activeOrganizationId: sessionEnv.orgId },
  }),
}));

import { getActiveOrgAccess, getOrgRole, requireOrgAdminScope } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

type Role = "owner" | "admin" | "member";

/** One user with a `firstRole` row from the fixture and a second `secondRole` row. */
async function seedTwoRows(firstRole: Role, secondRole: Role, placement: "before" | "after") {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", firstRole]);
  const user = users[1];
  await prisma.member.create({
    data: {
      id: `${placement === "before" ? "0" : "z"}-k151-${user.memberId}`,
      organizationId: orgId,
      userId: user.id,
      role: secondRole,
      createdAt: new Date(),
    },
  });
  sessionEnv.userId = user.id;
  sessionEnv.orgId = orgId;
  return { orgId, userId: user.id };
}

beforeEach(() => {
  sessionEnv.userId = "";
  sessionEnv.orgId = "";
});

describe("getActiveOrgAccess reads member rows conservatively (K151)", () => {
  const mixed: [Role, Role][] = [
    ["admin", "member"],
    ["member", "admin"],
    ["owner", "member"],
  ];
  for (const [firstRole, secondRole] of mixed) {
    for (const placement of ["before", "after"] as const) {
      it(`a ${firstRole} row then a ${secondRole} row (extra id sorts ${placement}) is not admin`, async () => {
        const { orgId } = await seedTwoRows(firstRole, secondRole, placement);
        const access = await getActiveOrgAccess();
        expect(access.orgId).toBe(orgId);
        expect(access.role).toBe("member");
        expect(await getOrgRole()).toBe("member");
        await expect(requireOrgAdminScope()).rejects.toThrow("Forbidden: admin role required");
      });
    }
  }

  it("two admin-level rows stay admin (the allowed control)", async () => {
    const { orgId } = await seedTwoRows("admin", "owner", "after");
    const scope = await requireOrgAdminScope();
    expect(scope.orgId).toBe(orgId);
    expect(["owner", "admin"]).toContain(scope.role);
  });

  it("a single member row is refused and a single admin row is allowed", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
    sessionEnv.orgId = orgId;
    sessionEnv.userId = users[1].id;
    await expect(requireOrgAdminScope()).rejects.toThrow("Forbidden: admin role required");
    sessionEnv.userId = users[0].id;
    expect((await requireOrgAdminScope()).role).toBe("admin");
  });

  it("no member row in the active organization gives role null", async () => {
    const { users } = await seedOrgWithMembers(prisma, ["admin"]);
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    sessionEnv.userId = users[0].id;
    sessionEnv.orgId = other.orgId;
    const access = await getActiveOrgAccess();
    expect(access.role).toBeNull();
    await expect(requireOrgAdminScope()).rejects.toThrow("Forbidden: admin role required");
  });
});
