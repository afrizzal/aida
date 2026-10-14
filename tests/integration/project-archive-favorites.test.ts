// Phase 14 archive, restore and favorites (contract sections 1, 2, 3, 10 and 14; D-12, AIDA-70,
// AIDA-103; reviews C3, R2-2 and P4) on a real Postgres through Testcontainers. No mocks. Races
// record the holder's and the waiter's backend PIDs and wait for exactly that waiter to be blocked
// by that holder (waitForBlockedBy on the one-connection observer client); every settled promise
// is checked for 40P01.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { archiveProject, restoreProject } from "@/lib/projects/archive";
import { favoriteProject, listFavorites, unfavoriteProject } from "@/lib/projects/favorites";
import { getProject, listProjects } from "@/lib/projects/projects";
import {
  actorOf,
  missingId,
  projectTableSnapshot,
  seedOrgWithMembers,
  seedProject,
} from "../support/project-fixtures";

/** One organization: a manager, a member and a nonMember; one private project. */
async function world(opts: { isPrivate?: boolean } = {}) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
  const [, manager, member, nonMember] = org.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
  ];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    isPrivate: opts.isPrivate ?? true,
    managerUserIds: [manager],
    memberUserIds: [member],
  });
  return {
    orgId: org.orgId,
    project,
    manager: actorOf(manager, org.orgId),
    member: actorOf(member, org.orgId),
    nonMember: actorOf(nonMember, org.orgId),
  };
}

async function activityOf(orgId: string, projectId: string) {
  return prisma.projectActivity.findMany({
    where: { organizationId: orgId, projectId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

async function projectIds(
  actor: ReturnType<typeof actorOf>,
  archived?: "exclude" | "only" | "include",
) {
  const result = await listProjects(actor, archived ? { archived } : {});
  if (!result.ok) throw new Error(`listProjects refused: ${result.code}`);
  return result.projects.map((p) => p.id);
}

describe("project archive and restore", () => {
  it("archiveProject by the manager writes PROJECT_ARCHIVED and leaves the default list", async () => {
    const w = await world();
    expect(await archiveProject(w.manager, w.project.id, 0)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    const rows = await activityOf(w.orgId, w.project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verb).toBe("PROJECT_ARCHIVED");
    expect(rows[0]?.entityType).toBe("PROJECT");
    expect(rows[0]?.entityId).toBe(w.project.id);
    expect(rows[0]?.actorUserId).toBe(w.manager.userId);
    expect(await projectIds(w.manager)).not.toContain(w.project.id);
    expect(await projectIds(w.manager, "only")).toContain(w.project.id);
    expect(await projectIds(w.manager, "include")).toContain(w.project.id);
    const detail = await getProject(w.manager, w.project.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.project.archivedAt).toBeInstanceOf(Date);
    // A stale version on an archived project is ARCHIVED (MANAGE refuses an archived project).
    expect(await archiveProject(w.manager, w.project.id, 1)).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
  });

  it("archiveProject with a stale version is CONFLICT and writes nothing", async () => {
    const w = await world();
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await archiveProject(w.manager, w.project.id, 7)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
  });

  it("restoreProject writes PROJECT_RESTORED and the project is back in the default list", async () => {
    const w = await world();
    expect((await archiveProject(w.manager, w.project.id, 0)).ok).toBe(true);
    expect(await restoreProject(w.manager, w.project.id)).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
    const rows = await activityOf(w.orgId, w.project.id);
    expect(rows.map((r) => r.verb)).toEqual(["PROJECT_ARCHIVED", "PROJECT_RESTORED"]);
    expect(rows[1]?.entityId).toBe(w.project.id);
    expect(await projectIds(w.manager)).toContain(w.project.id);
    expect(await projectIds(w.manager, "only")).not.toContain(w.project.id);
  });

  it("restoreProject on a project that is not archived is changed false with no row", async () => {
    const w = await world();
    const count = await activityCount(w.orgId);
    expect(await restoreProject(w.manager, w.project.id)).toEqual({ ok: true, changed: false });
    expect(await activityCount(w.orgId)).toBe(count);
  });

  it("a member is NOT_ALLOWED to archive or restore and nothing changes", async () => {
    const w = await world();
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await archiveProject(w.member, w.project.id, 0)).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await restoreProject(w.member, w.project.id)).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    expect((await archiveProject(w.manager, w.project.id, 0)).ok).toBe(true);
    const archived = await projectTableSnapshot(prisma, w.orgId);
    expect(await restoreProject(w.member, w.project.id)).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(archived);
  });
});

describe("project favorites", () => {
  it("favoriteProject and unfavoriteProject by a member toggle the favorite and write no activity", async () => {
    const w = await world();
    const count = await activityCount(w.orgId);
    expect(await favoriteProject(w.member, w.project.id)).toEqual({ ok: true, changed: true });
    const listed = await listFavorites(w.member);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.projects.map((p) => p.projectId)).toEqual([w.project.id]);
    expect(listed.tasks).toEqual([]);
    expect(await favoriteProject(w.member, w.project.id)).toEqual({ ok: true, changed: false });
    expect(
      await prisma.projectFavorite.count({
        where: { organizationId: w.orgId, userId: w.member.userId },
      }),
    ).toBe(1);
    expect(await unfavoriteProject(w.member, w.project.id)).toEqual({ ok: true, changed: true });
    expect(await unfavoriteProject(w.member, w.project.id)).toEqual({ ok: true, changed: false });
    const after = await listFavorites(w.member);
    expect(after.ok && after.projects).toEqual([]);
    expect(await activityCount(w.orgId)).toBe(count);
  });

  it("favorites are per user: the manager's list does not show the member's favorite", async () => {
    const w = await world();
    expect((await favoriteProject(w.member, w.project.id)).ok).toBe(true);
    const listed = await listFavorites(w.manager);
    expect(listed.ok && listed.projects).toEqual([]);
  });

  it("a missing id and a nonMember on a private project are NOT_FOUND like missingId() and write no row", async () => {
    const w = await world();
    const before = await projectTableSnapshot(prisma, w.orgId);
    const missingFav = await favoriteProject(w.member, missingId());
    const missingUnfav = await unfavoriteProject(w.member, missingId());
    expect(missingFav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(missingUnfav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await favoriteProject(w.nonMember, w.project.id)).toEqual(missingFav);
    expect(await unfavoriteProject(w.nonMember, w.project.id)).toEqual(missingUnfav);
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
  });
});
