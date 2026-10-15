// Phase 14 archive, restore and favorites (contract sections 1, 2, 3, 10 and 14; D-12, AIDA-70,
// AIDA-103; reviews C3, R2-2 and P4) on a real Postgres through Testcontainers. No mocks. Races
// record the holder's and the waiter's backend PIDs and wait for exactly that waiter to be blocked
// by that holder (waitForBlockedBy on the one-connection observer client); every settled promise
// is checked for 40P01.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { archiveProject, archiveTask, restoreProject, restoreTask } from "@/lib/projects/archive";
import { addTaskComment, listTaskComments } from "@/lib/projects/comments";
import {
  favoriteProject,
  favoriteTask,
  listFavorites,
  unfavoriteProject,
  unfavoriteTask,
} from "@/lib/projects/favorites";
import { createLabel } from "@/lib/projects/labels";
import { getProject, listProjects, updateProject } from "@/lib/projects/projects";
import { createTask, listProjectTasks, updateTask } from "@/lib/projects/tasks";
import { waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  missingId,
  projectTableSnapshot,
  seedOrgWithMembers,
  seedProject,
  seedTask,
} from "../support/project-fixtures";
import {
  assertNoDeadlock,
  createObserverClient,
  createServiceRace,
  type ServiceRace,
  settleAll,
} from "../support/project-race";

let observer: PrismaClient;
let closeObserver: () => Promise<void>;
let race: ServiceRace | null = null;
const racePids: { race: string; holder: number; waiter: number }[] = [];

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-archive-favorites PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
});

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

// ---------------------------------------------------------------------------------------------
// Tasks

/** The world plus a top-level task P (by the manager) with subtasks S1 and S2. */
async function taskWorld(opts: { isPrivate?: boolean } = {}) {
  const w = await world(opts);
  const p = await seedTask(prisma, w.orgId, w.project.id, {
    title: "Parent",
    createdByUserId: w.manager.userId,
  });
  const s1 = await seedTask(prisma, w.orgId, w.project.id, {
    title: "Sub one",
    parentId: p.id,
    createdByUserId: w.manager.userId,
  });
  const s2 = await seedTask(prisma, w.orgId, w.project.id, {
    title: "Sub two",
    parentId: p.id,
    createdByUserId: w.manager.userId,
  });
  return { ...w, p, s1, s2 };
}

async function taskIds(
  actor: ReturnType<typeof actorOf>,
  projectId: string,
  filters: { parentId?: string; archived?: "exclude" | "only" | "include" } = {},
) {
  const result = await listProjectTasks(actor, projectId, filters);
  if (!result.ok) throw new Error(`listProjectTasks refused: ${result.code}`);
  return result.tasks.map((t) => t.id).sort();
}

async function taskVersion(orgId: string, taskId: string): Promise<number> {
  const row = await prisma.task.findFirstOrThrow({
    where: { id: taskId, organizationId: orgId },
    select: { version: true },
  });
  return row.version;
}

async function verbsOf(orgId: string, taskId: string) {
  const rows = await prisma.projectActivity.findMany({
    where: { organizationId: orgId, taskId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { verb: true },
  });
  return rows.map((r) => r.verb);
}

describe("task archive and restore", () => {
  it("archiveTask by a member writes TASK_ARCHIVED and restoreTask writes TASK_RESTORED", async () => {
    const w = await taskWorld();
    const t = await seedTask(prisma, w.orgId, w.project.id, { title: "Solo" });
    expect(await archiveTask(w.member, t.id, 0)).toEqual({ ok: true, changed: true, version: 1 });
    const archived = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, taskId: t.id },
    });
    expect(archived).toHaveLength(1);
    expect(archived[0]?.verb).toBe("TASK_ARCHIVED");
    expect(archived[0]?.entityId).toBe(t.id);
    expect(archived[0]?.projectId).toBe(w.project.id);
    expect(await taskIds(w.member, w.project.id)).not.toContain(t.id);
    expect(await taskIds(w.member, w.project.id, { archived: "only" })).toContain(t.id);
    expect(await restoreTask(w.member, t.id)).toEqual({ ok: true, changed: true, version: 2 });
    expect(await verbsOf(w.orgId, t.id)).toEqual(["TASK_ARCHIVED", "TASK_RESTORED"]);
    expect(await taskIds(w.member, w.project.id)).toContain(t.id);
    expect(await restoreTask(w.member, t.id)).toEqual({ ok: true, changed: false });
    expect(await verbsOf(w.orgId, t.id)).toEqual(["TASK_ARCHIVED", "TASK_RESTORED"]);
  });

  it("restoreTask while the project is archived is ARCHIVED", async () => {
    const w = await taskWorld();
    expect((await archiveTask(w.member, w.p.id, 0)).ok).toBe(true);
    expect((await archiveProject(w.manager, w.project.id, 0)).ok).toBe(true);
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await restoreTask(w.member, w.p.id)).toEqual({ ok: false, code: "ARCHIVED" });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
  });

  it("archiving a parent hides and freezes its subtasks without touching their archivedAt; restore brings them back as they were", async () => {
    const w = await taskWorld();
    // S2 is archived on its own first.
    expect((await archiveTask(w.member, w.s2.id, 0)).ok).toBe(true);
    const s2Archived = await prisma.task.findFirstOrThrow({
      where: { id: w.s2.id, organizationId: w.orgId },
      select: { archivedAt: true },
    });
    expect(await archiveTask(w.member, w.p.id, 0)).toEqual({ ok: true, changed: true, version: 1 });
    const subs = await prisma.task.findMany({
      where: { organizationId: w.orgId, parentId: w.p.id },
      orderBy: { id: "asc" },
      select: { id: true, archivedAt: true },
    });
    expect(subs.find((s) => s.id === w.s1.id)?.archivedAt).toBeNull();
    expect(subs.find((s) => s.id === w.s2.id)?.archivedAt).toEqual(s2Archived.archivedAt);
    expect(await taskIds(w.member, w.project.id)).not.toContain(w.p.id);
    expect(await taskIds(w.member, w.project.id, { parentId: w.p.id })).toEqual([]);
    expect(await taskIds(w.member, w.project.id, { parentId: w.p.id, archived: "only" })).toEqual(
      [w.s1.id, w.s2.id].sort(),
    );
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await updateTask(w.member, w.s1.id, 0, { title: "Changed" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await addTaskComment(w.member, w.s1.id, { body: "Hello" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    expect(await restoreTask(w.member, w.p.id)).toEqual({ ok: true, changed: true, version: 2 });
    expect(await taskIds(w.member, w.project.id, { parentId: w.p.id })).toEqual([w.s1.id]);
    expect(await taskIds(w.member, w.project.id, { parentId: w.p.id, archived: "only" })).toEqual([
      w.s2.id,
    ]);
    const s2After = await prisma.task.findFirstOrThrow({
      where: { id: w.s2.id, organizationId: w.orgId },
      select: { archivedAt: true },
    });
    expect(s2After.archivedAt).toEqual(s2Archived.archivedAt);
    // TASK_ARCHIVED on P only (subtasks are not touched).
    expect(await verbsOf(w.orgId, w.p.id)).toEqual(["TASK_ARCHIVED", "TASK_RESTORED"]);
    expect(await verbsOf(w.orgId, w.s1.id)).toEqual([]);
    expect((await updateTask(w.member, w.s1.id, 0, { title: "Changed" })).ok).toBe(true);
  });

  it("with the project archived every content write is ARCHIVED, reads and favoriteProject still work", async () => {
    const w = await taskWorld();
    expect((await archiveProject(w.manager, w.project.id, 0)).ok).toBe(true);
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await createTask(w.member, w.project.id, { title: "New" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await updateTask(w.member, w.p.id, 0, { title: "Changed" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await addTaskComment(w.member, w.p.id, { body: "Hello" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await createLabel(w.manager, w.project.id, { name: "bug" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await updateProject(w.manager, w.project.id, 1, { name: "Renamed" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await archiveTask(w.member, w.p.id, 0)).toEqual({ ok: false, code: "ARCHIVED" });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    expect((await getProject(w.member, w.project.id)).ok).toBe(true);
    expect(await taskIds(w.member, w.project.id)).toEqual([w.p.id]);
    const comments = await listTaskComments(w.member, w.p.id);
    expect(comments.ok && comments.comments).toEqual([]);
    expect(await favoriteProject(w.member, w.project.id)).toEqual({ ok: true, changed: true });
  });
});

describe("task favorites", () => {
  it("favoriteTask and unfavoriteTask toggle a per-user favorite with no activity", async () => {
    const w = await taskWorld();
    const count = await activityCount(w.orgId);
    expect(await favoriteTask(w.member, w.p.id)).toEqual({ ok: true, changed: true });
    expect(await favoriteTask(w.member, w.p.id)).toEqual({ ok: true, changed: false });
    const listed = await listFavorites(w.member);
    expect(listed.ok && listed.tasks.map((t) => t.taskId)).toEqual([w.p.id]);
    expect(await unfavoriteTask(w.member, w.p.id)).toEqual({ ok: true, changed: true });
    expect(await unfavoriteTask(w.member, w.p.id)).toEqual({ ok: true, changed: false });
    const after = await listFavorites(w.member);
    expect(after.ok && after.tasks).toEqual([]);
    expect(await activityCount(w.orgId)).toBe(count);
    const missingFav = await favoriteTask(w.member, missingId());
    expect(missingFav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await favoriteTask(w.nonMember, w.p.id)).toEqual(missingFav);
    expect(await unfavoriteTask(w.nonMember, w.p.id)).toEqual(
      await unfavoriteTask(w.member, missingId()),
    );
  });

  it("listFavorites follows current access: after the membership row is removed the private project and its task leave the list", async () => {
    const w = await taskWorld();
    expect((await favoriteProject(w.member, w.project.id)).ok).toBe(true);
    expect((await favoriteTask(w.member, w.p.id)).ok).toBe(true);
    const before = await listFavorites(w.member);
    expect(before.ok && before.projects.map((p) => p.projectId)).toEqual([w.project.id]);
    expect(before.ok && before.tasks.map((t) => t.taskId)).toEqual([w.p.id]);
    await prisma.projectMember.deleteMany({
      where: { organizationId: w.orgId, projectId: w.project.id, userId: w.member.userId },
    });
    const after = await listFavorites(w.member);
    expect(after).toEqual({
      ok: true,
      projects: [],
      tasks: [],
      hasMoreProjects: false,
      hasMoreTasks: false,
    });
    expect(
      await prisma.projectFavorite.count({
        where: { organizationId: w.orgId, userId: w.member.userId },
      }),
    ).toBe(1);
    expect(
      await prisma.taskFavorite.count({
        where: { organizationId: w.orgId, userId: w.member.userId },
      }),
    ).toBe(1);
  });

  it("listFavorites leaves archived entries out unless includeArchived", async () => {
    const w = await taskWorld();
    expect((await favoriteTask(w.member, w.s1.id)).ok).toBe(true);
    expect((await archiveTask(w.member, w.p.id, 0)).ok).toBe(true);
    const hidden = await listFavorites(w.member);
    expect(hidden.ok && hidden.tasks).toEqual([]);
    const shown = await listFavorites(w.member, { includeArchived: true });
    expect(shown.ok && shown.tasks.map((t) => t.taskId)).toEqual([w.s1.id]);
  });

  it("favorites: archive exception on an archived task, under an archived parent and in an archived project", async () => {
    const w = await taskWorld();
    const solo = await seedTask(prisma, w.orgId, w.project.id, { title: "Solo" });
    expect((await archiveTask(w.member, solo.id, 0)).ok).toBe(true);
    expect((await archiveTask(w.member, w.p.id, 0)).ok).toBe(true);
    const count = await activityCount(w.orgId);
    const archivedState = async () =>
      prisma.task.findMany({
        where: { organizationId: w.orgId, projectId: w.project.id },
        orderBy: { id: "asc" },
        select: { id: true, archivedAt: true, version: true },
      });
    const stateBefore = await archivedState();
    // An archived task and a subtask whose parent is archived.
    for (const id of [solo.id, w.s1.id]) {
      expect(await favoriteTask(w.member, id)).toEqual({ ok: true, changed: true });
      expect(await unfavoriteTask(w.member, id)).toEqual({ ok: true, changed: true });
    }
    // A task of an archived project, and the archived project itself.
    expect((await archiveProject(w.manager, w.project.id, 0)).ok).toBe(true);
    const countArchived = await activityCount(w.orgId);
    const projectRow = async () =>
      prisma.project.findFirstOrThrow({
        where: { id: w.project.id, organizationId: w.orgId },
        select: { archivedAt: true, version: true },
      });
    const projectBefore = await projectRow();
    const live = await seedTask(prisma, w.orgId, w.project.id, { title: "Live" });
    expect(await favoriteTask(w.member, live.id)).toEqual({ ok: true, changed: true });
    expect(await unfavoriteTask(w.member, live.id)).toEqual({ ok: true, changed: true });
    expect(await favoriteProject(w.member, w.project.id)).toEqual({ ok: true, changed: true });
    expect(await unfavoriteProject(w.member, w.project.id)).toEqual({ ok: true, changed: true });
    expect(await activityCount(w.orgId)).toBe(countArchived);
    expect(countArchived).toBe(count + 1);
    expect(await projectRow()).toEqual(projectBefore);
    const stateAfter = (await archivedState()).filter((t) => t.id !== live.id);
    expect(stateAfter).toEqual(stateBefore);
    // In the same setup a write on the subtask is still ARCHIVED.
    expect(await updateTask(w.member, w.s1.id, 0, { title: "Changed" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Races (review C3 and D-04)

describe("archive races", () => {
  it("archiveProject held after its lock: addTaskComment waits and is ARCHIVED, nothing stored", async () => {
    const w = await taskWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("archiveProject");
    const first = archiveProject(w.manager, w.project.id, 0);
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("addTaskComment");
    const second = addTaskComment(w.member, w.p.id, { body: "Late" });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "archiveProject vs addTaskComment", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason))).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: false, code: "ARCHIVED" },
    ]);
    expect(await prisma.taskComment.count({ where: { organizationId: w.orgId } })).toBe(0);
  });

  it("updateTask: archive first, then the subtask update is ARCHIVED and S is unchanged", async () => {
    const w = await taskWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("archiveTask");
    const first = archiveTask(w.member, w.p.id, 0);
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("updateTask");
    const second = updateTask(w.member, w.s1.id, 0, { title: "Changed" });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "updateTask: archive first", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason))).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: false, code: "ARCHIVED" },
    ]);
    const s = await prisma.task.findFirstOrThrow({
      where: { id: w.s1.id, organizationId: w.orgId },
      select: { title: true, version: true },
    });
    expect(s).toEqual({ title: "Sub one", version: 0 });
    expect(await verbsOf(w.orgId, w.s1.id)).toEqual([]);
  });

  it("updateTask: subtask write first, then the archive waits and succeeds", async () => {
    const w = await taskWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("updateTask");
    const first = updateTask(w.member, w.s1.id, 0, { title: "Changed" });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("archiveTask");
    const second = archiveTask(w.member, w.p.id, 0);
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "updateTask: subtask write first", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason))).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: true, changed: true, version: 1 },
    ]);
    expect(await verbsOf(w.orgId, w.s1.id)).toEqual(["TASK_UPDATED"]);
    expect(await verbsOf(w.orgId, w.p.id)).toEqual(["TASK_ARCHIVED"]);
    expect(await updateTask(w.member, w.s1.id, 1, { title: "Again" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
  });

  it("addTaskComment: archive first, then the comment is ARCHIVED and not stored", async () => {
    const w = await taskWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("archiveTask");
    const first = archiveTask(w.member, w.p.id, 0);
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("addTaskComment");
    const second = addTaskComment(w.member, w.s1.id, { body: "Late" });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "addTaskComment: archive first", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason))).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: false, code: "ARCHIVED" },
    ]);
    expect(await prisma.taskComment.count({ where: { organizationId: w.orgId } })).toBe(0);
    expect(await verbsOf(w.orgId, w.s1.id)).toEqual([]);
  });

  it("addTaskComment: subtask write first, then the archive waits and succeeds", async () => {
    const w = await taskWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("addTaskComment");
    const first = addTaskComment(w.member, w.s1.id, { body: "Early" });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("archiveTask");
    const second = archiveTask(w.member, w.p.id, 0);
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "addTaskComment: subtask write first", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results[0]?.status === "fulfilled" && (results[0].value as { ok: boolean }).ok).toBe(
      true,
    );
    expect(results[1]?.status === "fulfilled" && results[1].value).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await prisma.taskComment.count({ where: { organizationId: w.orgId } })).toBe(1);
    expect(await verbsOf(w.orgId, w.s1.id)).toEqual(["COMMENT_ADDED"]);
    expect(await verbsOf(w.orgId, w.p.id)).toEqual(["TASK_ARCHIVED"]);
  });

  it("createTask: archive first, then the subtask create is ARCHIVED and nothing is created", async () => {
    const w = await taskWorld();
    const tasksBefore = await prisma.task.count({ where: { organizationId: w.orgId } });
    race = createServiceRace();
    const holderPid = race.holdAt("archiveTask");
    const first = archiveTask(w.member, w.p.id, 0);
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("createTask");
    const second = createTask(w.member, w.project.id, { title: "Late", parentId: w.p.id });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "createTask: archive first", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason))).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: false, code: "ARCHIVED" },
    ]);
    expect(await prisma.task.count({ where: { organizationId: w.orgId } })).toBe(tasksBefore);
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: w.orgId, verb: "TASK_CREATED" },
      }),
    ).toBe(0);
  });

  it("createTask: subtask write first, then the archive waits and the new subtask counts as archived", async () => {
    const w = await taskWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("createTask");
    const first = createTask(w.member, w.project.id, { title: "Early", parentId: w.p.id });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("archiveTask");
    const second = archiveTask(w.member, w.p.id, 0);
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "createTask: subtask write first", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    const created = results[0]?.status === "fulfilled" ? results[0].value : null;
    expect((created as { ok: boolean } | null)?.ok).toBe(true);
    const newId = (created as { taskId: string }).taskId;
    expect(results[1]?.status === "fulfilled" && results[1].value).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await verbsOf(w.orgId, newId)).toEqual(["TASK_CREATED"]);
    expect(await verbsOf(w.orgId, w.p.id)).toEqual(["TASK_ARCHIVED"]);
    expect(await taskIds(w.member, w.project.id, { parentId: w.p.id })).toEqual([]);
    expect(await taskIds(w.member, w.project.id, { parentId: w.p.id, archived: "only" })).toContain(
      newId,
    );
    expect(await taskVersion(w.orgId, newId)).toBe(0);
  });
});
