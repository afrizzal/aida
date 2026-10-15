// Phase 14 confirmed hard delete of tasks and projects (contract sections 3, 5, 6, 10, 12 and 17;
// D-06, D-07, K63, K64, K66; reviews C3, R2-2, R2-3, P4 and R3-4; AIDA-103, AIDA-104) on a real
// Postgres through Testcontainers. No mocks. Races record the holder's and the waiter's backend
// PIDs and wait for exactly that waiter to be blocked by that holder (waitForBlockedBy on the
// one-connection observer client); every settled promise is checked for 40P01. UPLOADS_DIR is a
// fresh temporary directory set before the dynamic import of the file storage. The ProjectFileCleanup
// outbox rows written by a delete are read directly; the sweep (sweepProjectFileCleanup) removes the
// files. The AuditEvent table is seeded with raw SQL and compared before and after.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FileStorage } from "@/lib/attachments/file-storage";
import { prisma } from "@/lib/db";
import { listProjectActivity } from "@/lib/projects/activity";
import { addTaskComment } from "@/lib/projects/comments";
import { ACTIVITY_FEED_ROW_KEYS, type ProjectActor, REDACTED_SIDE } from "@/lib/projects/contract";
import { deleteProject, deleteTask } from "@/lib/projects/delete";
import {
  favoriteProject,
  favoriteTask,
  unfavoriteProject,
  unfavoriteTask,
} from "@/lib/projects/favorites";
import { sweepProjectFileCleanup } from "@/lib/projects/file-cleanup";
import { aliasTaskKeyInTx, issueTaskKeyInTx, resolveTaskKey } from "@/lib/projects/keys";
import { createProject } from "@/lib/projects/projects";
import type { ProjectDb } from "@/lib/projects/service";
import { createTask, updateTask } from "@/lib/projects/tasks";
import { waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  missingId,
  projectTableSnapshot,
  seedActivity,
  seedAttachment,
  seedComment,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
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
let dir = "";
let previousUploadsDir: string | undefined;
let storage: FileStorage;

beforeAll(async () => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
  dir = await mkdtemp(path.join(os.tmpdir(), "aida-project-delete-"));
  previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  storage = (await import("@/lib/attachments/local-file-storage")).localFileStorage;
});

afterAll(async () => {
  console.info(`project-delete PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  race?.clear();
  race = null;
});

// ---------------------------------------------------------------------------------------------
// Worlds and helpers

/** One organization: owner, manager D, member U, creator C; one project managed by D. */
async function world(opts: { isPrivate?: boolean; name?: string } = {}) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
  const [owner, manager, member, creator] = org.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
  ];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    name: opts.name,
    isPrivate: opts.isPrivate ?? true,
    managerUserIds: [manager],
    memberUserIds: [member, creator],
  });
  return {
    orgId: org.orgId,
    project,
    name: opts.name ?? `Project ${project.keyPrefix}`,
    owner: actorOf(owner, org.orgId),
    manager: actorOf(manager, org.orgId),
    member: actorOf(member, org.orgId),
    creator: actorOf(creator, org.orgId),
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** A top-level task P (by the manager) with two subtasks. */
async function tree(w: World) {
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
  return { p, s1, s2 };
}

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" ? r.value : r.reason;

/**
 * Holds `first` after its locks (operation holdOp), starts `second` (operation waitOp), proves
 * that exactly second's backend PID is blocked by first's, runs `during` while first still
 * holds, releases, settles both and checks for 40P01.
 */
async function raceInOrder(
  name: string,
  holdOp: string,
  first: () => Promise<unknown>,
  waitOp: string,
  second: () => Promise<unknown>,
  during?: () => Promise<void>,
): Promise<[unknown, unknown]> {
  race = createServiceRace();
  const holderPid = race.holdAt(holdOp);
  const a = first();
  const holder = await holderPid;
  const waiterPid = race.nextStartPid(waitOp);
  const b = second();
  const waiter = await waiterPid;
  await waitForBlockedBy(observer, holder, [waiter]);
  racePids.push({ race: name, holder, waiter });
  if (during) await during();
  race.release();
  const results = await settleAll<unknown>([a, b]);
  assertNoDeadlock(results);
  return [
    outcome(results[0] as PromiseSettledResult<unknown>),
    outcome(results[1] as PromiseSettledResult<unknown>),
  ];
}

async function activityRows(orgId: string, where: { taskId?: string; projectId?: string } = {}) {
  return prisma.projectActivity.findMany({
    where: { organizationId: orgId, ...where },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function keyKinds(orgId: string, taskIds: readonly string[]) {
  const rows = await prisma.taskKey.findMany({
    where: { organizationId: orgId, taskId: { in: [...taskIds] } },
    select: { kind: true },
  });
  return rows.map((r) => r.kind);
}

async function auditRows(orgId: string) {
  return prisma.auditEvent.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" } });
}

async function fileExists(orgId: string, key: string): Promise<boolean> {
  try {
    await stat(path.join(dir, orgId, key));
    return true;
  } catch {
    return false;
  }
}

const confirmTask = (expectedVersion = 0) => ({ confirm: true, expectedVersion });

// ---------------------------------------------------------------------------------------------
// deleteTask

describe("deleteTask", () => {
  it("needs confirmation, the current version and the creator or a manager; then removes the tree with TASK_DELETED rows", async () => {
    const w = await world();
    const t = await tree(w);
    const label = await seedLabel(prisma, w.orgId, w.project.id);
    await prisma.taskLabel.create({
      data: { organizationId: w.orgId, projectId: w.project.id, taskId: t.p.id, labelId: label.id },
    });
    await seedComment(prisma, w.orgId, t.p.id, { authorUserId: w.member.userId });
    await seedComment(prisma, w.orgId, t.s1.id, { authorUserId: w.member.userId });
    await seedAttachment(prisma, w.orgId, t.p.id, { uploadedByUserId: w.member.userId });
    await seedAttachment(prisma, w.orgId, t.s2.id, { uploadedByUserId: w.member.userId });
    await prisma.taskFavorite.create({
      data: { organizationId: w.orgId, userId: w.member.userId, taskId: t.p.id },
    });
    await prisma.taskFavorite.create({
      data: { organizationId: w.orgId, userId: w.member.userId, taskId: t.s1.id },
    });

    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await deleteTask(w.manager, t.p.id, { confirm: false, expectedVersion: 0 })).toEqual({
      ok: false,
      code: "CONFIRMATION_REQUIRED",
    });
    expect(
      await deleteTask(w.manager, t.p.id, { expectedVersion: 0 } as unknown as {
        confirm: boolean;
        expectedVersion: number;
      }),
    ).toEqual({ ok: false, code: "CONFIRMATION_REQUIRED" });
    expect(await deleteTask(w.manager, t.p.id, confirmTask(5))).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await deleteTask(w.member, t.p.id, confirmTask())).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);

    expect(await deleteTask(w.manager, t.p.id, confirmTask())).toEqual({
      ok: true,
      removedTaskCount: 3,
      cleanupQueued: 2,
    });
    const ids = [t.p.id, t.s1.id, t.s2.id];
    const where = { organizationId: w.orgId, taskId: { in: ids } };
    expect(await prisma.task.count({ where: { organizationId: w.orgId, id: { in: ids } } })).toBe(
      0,
    );
    expect(await prisma.taskComment.count({ where })).toBe(0);
    expect(await prisma.taskAttachment.count({ where })).toBe(0);
    expect(await prisma.taskLabel.count({ where })).toBe(0);
    expect(await prisma.taskFavorite.count({ where })).toBe(0);
    expect(await prisma.projectLabel.count({ where: { organizationId: w.orgId } })).toBe(1);

    const deleted = (await activityRows(w.orgId)).filter((r) => r.verb === "TASK_DELETED");
    expect(deleted).toHaveLength(3);
    expect(new Set(deleted.map((r) => r.batchId)).size).toBe(1);
    expect(deleted.map((r) => r.entityId).sort()).toEqual([...ids].sort());
    const root = deleted.find((r) => r.entityId === t.p.id);
    expect(root?.verb).toBe("TASK_DELETED");
    expect(root?.projectId).toBe(w.project.id);
    expect(root?.actorUserId).toBe(w.manager.userId);
    expect(root?.before).toEqual({
      key: t.p.key,
      title: "Parent",
      parentId: null,
      commentCount: 1,
      attachmentCount: 1,
    });
    expect(deleted.find((r) => r.entityId === t.s1.id)?.before).toMatchObject({
      parentId: t.p.id,
      commentCount: 1,
      attachmentCount: 0,
    });
  });

  it("the creator of a task may delete it, a member who did not create it may not", async () => {
    const w = await world();
    const created = await createTask(w.creator, w.project.id, { title: "Mine" });
    if (!created.ok) throw new Error(created.code);
    expect(await deleteTask(w.member, created.taskId, confirmTask())).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await deleteTask(w.creator, created.taskId, confirmTask())).toEqual({
      ok: true,
      removedTaskCount: 1,
      cleanupQueued: 0,
    });
  });

  it("after deleteTask the key and its alias are NOT_FOUND, the key rows are TOMBSTONE, earlier activity stays and the sweep removes the files", async () => {
    const w = await world();
    const created = await createTask(w.manager, w.project.id, { title: "Keyed" });
    if (!created.ok) throw new Error(created.code);
    expect((await updateTask(w.manager, created.taskId, 0, { title: "Keyed again" })).ok).toBe(
      true,
    );
    // A second key for the task: the first becomes an ALIAS (aliasTaskKeyInTx) and a new ACTIVE
    // key is issued, as a move would.
    const newKey = await prisma.$transaction(async (raw) => {
      const tx = raw as unknown as ProjectDb;
      expect(await aliasTaskKeyInTx(tx, w.orgId, created.key)).toBe(1);
      return issueTaskKeyInTx(tx, {
        orgId: w.orgId,
        projectId: w.project.id,
        taskId: created.taskId,
        prefix: w.project.keyPrefix,
        number: 900,
      });
    });
    expect(await resolveTaskKey(w.manager, created.key)).toMatchObject({ ok: true, isAlias: true });
    const keys = [`${randomUUID().replace(/-/g, "")}.png`, `${randomUUID().replace(/-/g, "")}.png`];
    for (const key of keys) {
      await storage.save({ orgId: w.orgId, key, data: Buffer.from("delete me") });
      await seedAttachment(prisma, w.orgId, created.taskId, {
        uploadedByUserId: w.manager.userId,
        storageKey: key,
      });
    }
    const earlier = await activityRows(w.orgId, { taskId: created.taskId });
    expect(earlier.map((r) => r.verb)).toEqual(["TASK_CREATED", "TASK_UPDATED"]);

    expect(await deleteTask(w.manager, created.taskId, confirmTask(1))).toEqual({
      ok: true,
      removedTaskCount: 1,
      cleanupQueued: 2,
    });
    const nowhere = await resolveTaskKey(w.manager, "NOWHERE-1");
    expect(nowhere).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await resolveTaskKey(w.manager, created.key)).toEqual(nowhere);
    expect(await resolveTaskKey(w.manager, newKey)).toEqual(nowhere);
    expect(await keyKinds(w.orgId, [created.taskId])).toEqual(["TOMBSTONE", "TOMBSTONE"]);
    const after = await activityRows(w.orgId, { taskId: created.taskId });
    expect(after.slice(0, 2)).toEqual(earlier);
    expect(after.map((r) => r.verb)).toEqual(["TASK_CREATED", "TASK_UPDATED", "TASK_DELETED"]);

    for (const key of keys) expect(await fileExists(w.orgId, key)).toBe(true);
    await sweepProjectFileCleanup({ client: prisma, storage });
    for (const key of keys) expect(await fileExists(w.orgId, key)).toBe(false);
    expect(
      await prisma.projectFileCleanup.count({
        where: { organizationId: w.orgId, storageKey: { in: keys } },
      }),
    ).toBe(0);
  });

  it("delete order: key rows TOMBSTONE, two ProjectFileCleanup rows with exactly the two storage keys, no attachment row left", async () => {
    const w = await world();
    const t = await seedTask(prisma, w.orgId, w.project.id, { createdByUserId: w.manager.userId });
    const a1 = await seedAttachment(prisma, w.orgId, t.id, { uploadedByUserId: w.member.userId });
    const a2 = await seedAttachment(prisma, w.orgId, t.id, { uploadedByUserId: w.member.userId });
    expect(await deleteTask(w.manager, t.id, confirmTask())).toEqual({
      ok: true,
      removedTaskCount: 1,
      cleanupQueued: 2,
    });
    expect(await keyKinds(w.orgId, [t.id])).toEqual(["TOMBSTONE"]);
    const outbox = await prisma.projectFileCleanup.findMany({
      where: { organizationId: w.orgId },
      select: { storageKey: true },
    });
    expect(outbox.map((r) => r.storageKey).sort()).toEqual([a1.storageKey, a2.storageKey].sort());
    expect(await prisma.taskAttachment.count({ where: { organizationId: w.orgId } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// deleteProject

describe("deleteProject", () => {
  it("needs the exact name and a manager; removes every owned row, keeps the prefix, activity and AuditEvent rows, and its feed is NOT_FOUND", async () => {
    const w = await world();
    const outsider = await world();
    const t = await tree(w);
    const label = await seedLabel(prisma, w.orgId, w.project.id);
    await seedMilestone(prisma, w.orgId, w.project.id);
    await prisma.taskLabel.create({
      data: { organizationId: w.orgId, projectId: w.project.id, taskId: t.p.id, labelId: label.id },
    });
    await seedComment(prisma, w.orgId, t.p.id, { authorUserId: w.member.userId });
    await seedComment(prisma, w.orgId, t.s1.id, { authorUserId: w.member.userId });
    await seedAttachment(prisma, w.orgId, t.s2.id, { uploadedByUserId: w.member.userId });
    await seedTeam(prisma, w.orgId, { projectIds: [w.project.id] });
    await prisma.projectFavorite.create({
      data: { organizationId: w.orgId, userId: w.member.userId, projectId: w.project.id },
    });
    await prisma.taskFavorite.create({
      data: { organizationId: w.orgId, userId: w.member.userId, taskId: t.p.id },
    });
    const solo = await seedTask(prisma, w.orgId, w.project.id, {
      createdByUserId: w.manager.userId,
    });
    await seedActivity(prisma, w.orgId, { projectId: w.project.id, actorUserId: w.member.userId });
    await prisma.$executeRaw`
      INSERT INTO "AuditEvent" ("id", "organizationId", "actionType", "provider", "model", "input", "output")
      VALUES (${randomUUID()}, ${w.orgId}, 'TRIAGE', 'fake', 'fake-model', 'in', 'out')`;
    const audit = await auditRows(w.orgId);
    expect(audit).toHaveLength(1);
    const activityBefore = await activityRows(w.orgId);

    // A task delete first (the AuditEvent rows survive both deletes).
    expect(await deleteTask(w.manager, solo.id, confirmTask())).toMatchObject({ ok: true });
    const activityMid = await activityRows(w.orgId);
    expect(activityMid.slice(0, activityBefore.length)).toEqual(activityBefore);

    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await deleteProject(w.manager, w.project.id, { confirmName: "wrong" })).toEqual({
      ok: false,
      code: "CONFIRMATION_REQUIRED",
    });
    expect(
      await deleteProject(w.manager, w.project.id, {} as unknown as { confirmName: string }),
    ).toEqual({ ok: false, code: "CONFIRMATION_REQUIRED" });
    expect(await deleteProject(w.member, w.project.id, { confirmName: w.name })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);

    // Archived projects may be deleted (MANAGE_ARCHIVED).
    await prisma.project.updateMany({
      where: { id: w.project.id, organizationId: w.orgId },
      data: { archivedAt: new Date() },
    });
    expect(await deleteProject(w.manager, w.project.id, { confirmName: w.name })).toEqual({
      ok: true,
      removedTaskCount: 3,
      cleanupQueued: 1,
    });

    const orgId = w.orgId;
    const projectId = w.project.id;
    expect(await prisma.project.count({ where: { organizationId: orgId, id: projectId } })).toBe(0);
    for (const count of [
      prisma.task.count({ where: { organizationId: orgId, projectId } }),
      prisma.taskComment.count({ where: { organizationId: orgId } }),
      prisma.taskAttachment.count({ where: { organizationId: orgId } }),
      prisma.taskLabel.count({ where: { organizationId: orgId } }),
      prisma.taskFavorite.count({ where: { organizationId: orgId } }),
      prisma.projectLabel.count({ where: { organizationId: orgId, projectId } }),
      prisma.projectMilestone.count({ where: { organizationId: orgId, projectId } }),
      prisma.projectMember.count({ where: { organizationId: orgId, projectId } }),
      prisma.projectTeam.count({ where: { organizationId: orgId, projectId } }),
      prisma.projectFavorite.count({ where: { organizationId: orgId, projectId } }),
      prisma.projectTaskCounter.count({ where: { organizationId: orgId, projectId } }),
    ]) {
      expect(await count).toBe(0);
    }
    const keys = await prisma.taskKey.findMany({
      where: { organizationId: orgId, projectId },
      select: { kind: true },
    });
    expect(keys).toHaveLength(4);
    expect(keys.every((k) => k.kind === "TOMBSTONE")).toBe(true);
    expect(
      await prisma.projectKeyPrefix.count({
        where: { organizationId: orgId, prefix: w.project.keyPrefix, projectId },
      }),
    ).toBe(1);
    expect(
      await createProject(w.member, { name: "Reuse", keyPrefix: w.project.keyPrefix }),
    ).toEqual({ ok: false, code: "PREFIX_TAKEN" });

    const activityAfter = await activityRows(orgId);
    expect(activityAfter.slice(0, activityMid.length)).toEqual(activityMid);
    const deletedRows = activityAfter.filter((r) => r.verb === "PROJECT_DELETED");
    expect(deletedRows).toHaveLength(1);
    expect(deletedRows[0]?.verb).toBe("PROJECT_DELETED");
    expect(deletedRows[0]?.projectId).toBe(projectId);
    expect(deletedRows[0]?.before).toEqual({
      name: w.name,
      keyPrefix: w.project.keyPrefix,
      taskCount: 3,
      commentCount: 2,
      attachmentCount: 1,
      labelCount: 1,
      milestoneCount: 1,
      memberCount: 3,
    });
    expect(await auditRows(orgId)).toEqual(audit);

    // 14-o2 default: nobody reads the deleted project's feed.
    for (const actor of [w.manager, w.member, w.owner]) {
      const feed = await listProjectActivity(actor, projectId);
      expect(feed).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(feed).toEqual(await listProjectActivity(actor, missingId()));
    }
    // The other organization is untouched.
    expect(await prisma.project.count({ where: { organizationId: outsider.orgId } })).toBe(1);
  });

  it("on a non-private project the organization owner may delete it", async () => {
    const w = await world({ isPrivate: false });
    await seedTask(prisma, w.orgId, w.project.id, { createdByUserId: w.manager.userId });
    expect(await deleteProject(w.owner, w.project.id, { confirmName: w.name })).toEqual({
      ok: true,
      removedTaskCount: 1,
      cleanupQueued: 0,
    });
    expect((await activityRows(w.orgId, { projectId: w.project.id })).map((r) => r.verb)).toEqual([
      "PROJECT_DELETED",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Races

describe("delete races", () => {
  it("deleteProject held after its locks: addTaskComment waits and is NOT_FOUND", async () => {
    const w = await world();
    const t = await seedTask(prisma, w.orgId, w.project.id, { createdByUserId: w.manager.userId });
    const [deleted, comment] = await raceInOrder(
      "deleteProject vs addTaskComment",
      "deleteProject",
      () => deleteProject(w.manager, w.project.id, { confirmName: w.name }),
      "addTaskComment",
      () => addTaskComment(w.member, t.id, { body: "Late" }),
    );
    expect(deleted).toEqual({ ok: true, removedTaskCount: 1, cleanupQueued: 0 });
    expect(comment).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await prisma.taskComment.count({ where: { organizationId: w.orgId } })).toBe(0);
  });

  it("deleteTask: delete first, then the subtask update waits and is NOT_FOUND", async () => {
    const w = await world();
    const t = await tree(w);
    const [deleted, updated] = await raceInOrder(
      "deleteTask: delete first",
      "deleteTask",
      () => deleteTask(w.manager, t.p.id, confirmTask()),
      "updateTask",
      () => updateTask(w.member, t.s1.id, 0, { title: "Late" }),
    );
    expect(deleted).toEqual({ ok: true, removedTaskCount: 3, cleanupQueued: 0 });
    expect(updated).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("deleteTask: subtask write first, then the delete waits for the root and removes P and S", async () => {
    const w = await world();
    const p = await seedTask(prisma, w.orgId, w.project.id, { createdByUserId: w.manager.userId });
    const s = await seedTask(prisma, w.orgId, w.project.id, {
      parentId: p.id,
      createdByUserId: w.manager.userId,
    });
    const [updated, deleted] = await raceInOrder(
      "deleteTask: subtask write first",
      "updateTask",
      () => updateTask(w.member, s.id, 0, { title: "Early" }),
      "deleteTask",
      () => deleteTask(w.manager, p.id, confirmTask()),
    );
    expect(updated).toEqual({ ok: true, changed: true, version: 1 });
    expect(deleted).toEqual({ ok: true, removedTaskCount: 2, cleanupQueued: 0 });
    const rows = await activityRows(w.orgId);
    expect(rows.map((r) => r.verb)).toEqual(["TASK_UPDATED", "TASK_DELETED", "TASK_DELETED"]);
  });

  it("deleteTask: createTask, delete first, the subtask create is NOT_FOUND while a top-level create commits", async () => {
    const w = await world();
    const t = await tree(w);
    await seedAttachment(prisma, w.orgId, t.p.id, { uploadedByUserId: w.member.userId });
    let topLevel: { taskId: string; key: string; number: number } | null = null;
    const [deleted, blocked] = await raceInOrder(
      "deleteTask: createTask, delete first",
      "deleteTask",
      () => deleteTask(w.manager, t.p.id, confirmTask()),
      "createTask",
      () => createTask(w.member, w.project.id, { title: "Late child", parentId: t.p.id }),
      async () => {
        // Needs no lock the delete holds: completes while the delete is still parked.
        const top = await createTask(w.member, w.project.id, { title: "Top level" });
        if (!top.ok) throw new Error(top.code);
        topLevel = { taskId: top.taskId, key: top.key, number: top.number };
      },
    );
    expect(deleted).toEqual({ ok: true, removedTaskCount: 3, cleanupQueued: 1 });
    expect(blocked).toEqual({ ok: false, code: "NOT_FOUND" });
    const top = topLevel as unknown as { taskId: string; key: string; number: number };
    expect(top.number).toBe(4);
    const rows = await activityRows(w.orgId);
    const deletedRows = rows.filter((r) => r.verb === "TASK_DELETED");
    expect(deletedRows).toHaveLength(3);
    expect(new Set(deletedRows.map((r) => r.batchId)).size).toBe(1);
    expect(rows.filter((r) => r.verb === "TASK_CREATED").map((r) => r.taskId)).toEqual([
      top.taskId,
    ]);
    expect(await keyKinds(w.orgId, [t.p.id, t.s1.id, t.s2.id])).toEqual([
      "TOMBSTONE",
      "TOMBSTONE",
      "TOMBSTONE",
    ]);
    expect(await prisma.task.count({ where: { organizationId: w.orgId } })).toBe(1);
    expect(await prisma.taskKey.count({ where: { organizationId: w.orgId } })).toBe(4);
    expect(await keyKinds(w.orgId, [top.taskId])).toEqual(["ACTIVE"]);
    expect(await resolveTaskKey(w.member, top.key)).toMatchObject({ ok: true, taskId: top.taskId });
  });

  it("deleteTask: createTask, create first, then the delete removes P, its two subtasks and the new one", async () => {
    const w = await world();
    const t = await tree(w);
    await seedAttachment(prisma, w.orgId, t.p.id, { uploadedByUserId: w.member.userId });
    const [created, deleted] = await raceInOrder(
      "deleteTask: createTask, create first",
      "createTask",
      () => createTask(w.member, w.project.id, { title: "Early child", parentId: t.p.id }),
      "deleteTask",
      () => deleteTask(w.manager, t.p.id, confirmTask()),
    );
    expect(created).toMatchObject({ ok: true, number: 4 });
    const newId = (created as { taskId: string }).taskId;
    expect(deleted).toEqual({ ok: true, removedTaskCount: 4, cleanupQueued: 1 });
    const rows = await activityRows(w.orgId);
    expect(rows.filter((r) => r.verb === "TASK_CREATED").map((r) => r.taskId)).toEqual([newId]);
    const deletedRows = rows.filter((r) => r.verb === "TASK_DELETED");
    expect(deletedRows).toHaveLength(4);
    expect(new Set(deletedRows.map((r) => r.batchId)).size).toBe(1);
    expect(await keyKinds(w.orgId, [t.p.id, t.s1.id, t.s2.id, newId])).toEqual([
      "TOMBSTONE",
      "TOMBSTONE",
      "TOMBSTONE",
      "TOMBSTONE",
    ]);
    expect(await prisma.task.count({ where: { organizationId: w.orgId } })).toBe(0);
  });
});

describe("task favorite toggles against deleteTask", () => {
  async function expectToggleNotFoundAfter(actor: ProjectActor, taskId: string) {
    const fav = await favoriteTask(actor, taskId);
    expect(fav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fav).toEqual(await favoriteTask(actor, missingId()));
    const unfav = await unfavoriteTask(actor, taskId);
    expect(unfav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(unfav).toEqual(await unfavoriteTask(actor, missingId()));
  }

  it("favoriteTask: delete first, then the favorite is NOT_FOUND and writes no row", async () => {
    const w = await world();
    const t = await seedTask(prisma, w.orgId, w.project.id, { createdByUserId: w.manager.userId });
    const [deleted, fav] = await raceInOrder(
      "favoriteTask: delete first",
      "deleteTask",
      () => deleteTask(w.manager, t.id, confirmTask()),
      "favoriteTask",
      () => favoriteTask(w.member, t.id),
    );
    expect(deleted).toEqual({ ok: true, removedTaskCount: 1, cleanupQueued: 0 });
    expect(fav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fav).toEqual(await favoriteTask(w.member, missingId()));
    expect(await prisma.taskFavorite.count({ where: { organizationId: w.orgId } })).toBe(0);
    await expectToggleNotFoundAfter(w.member, t.id);
  });

  it("favoriteTask: favorite first on a subtask, then deleteTask of the parent removes it with the favorite", async () => {
    const w = await world();
    const p = await seedTask(prisma, w.orgId, w.project.id, { createdByUserId: w.manager.userId });
    const s = await seedTask(prisma, w.orgId, w.project.id, {
      parentId: p.id,
      createdByUserId: w.manager.userId,
    });
    const [fav, deleted] = await raceInOrder(
      "favoriteTask: favorite first",
      "favoriteTask",
      () => favoriteTask(w.member, s.id),
      "deleteTask",
      () => deleteTask(w.manager, p.id, confirmTask()),
    );
    expect(fav).toEqual({ ok: true, changed: true });
    expect(deleted).toEqual({ ok: true, removedTaskCount: 2, cleanupQueued: 0 });
    expect(await prisma.taskFavorite.count({ where: { organizationId: w.orgId } })).toBe(0);
    await expectToggleNotFoundAfter(w.member, s.id);
  });

  it("unfavoriteTask: delete first, then the unfavorite is NOT_FOUND and no row remains", async () => {
    const w = await world();
    const t = await seedTask(prisma, w.orgId, w.project.id, { createdByUserId: w.manager.userId });
    await prisma.taskFavorite.create({
      data: { organizationId: w.orgId, userId: w.member.userId, taskId: t.id },
    });
    const [deleted, unfav] = await raceInOrder(
      "unfavoriteTask: delete first",
      "deleteTask",
      () => deleteTask(w.manager, t.id, confirmTask()),
      "unfavoriteTask",
      () => unfavoriteTask(w.member, t.id),
    );
    expect(deleted).toEqual({ ok: true, removedTaskCount: 1, cleanupQueued: 0 });
    expect(unfav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(unfav).toEqual(await unfavoriteTask(w.member, missingId()));
    expect(await prisma.taskFavorite.count({ where: { organizationId: w.orgId } })).toBe(0);
    await expectToggleNotFoundAfter(w.member, t.id);
  });

  it("unfavoriteTask: unfavorite first, then the delete waits and succeeds", async () => {
    const w = await world();
    const t = await seedTask(prisma, w.orgId, w.project.id, { createdByUserId: w.manager.userId });
    await prisma.taskFavorite.create({
      data: { organizationId: w.orgId, userId: w.member.userId, taskId: t.id },
    });
    const [unfav, deleted] = await raceInOrder(
      "unfavoriteTask: unfavorite first",
      "unfavoriteTask",
      () => unfavoriteTask(w.member, t.id),
      "deleteTask",
      () => deleteTask(w.manager, t.id, confirmTask()),
    );
    expect(unfav).toEqual({ ok: true, changed: true });
    expect(deleted).toEqual({ ok: true, removedTaskCount: 1, cleanupQueued: 0 });
    expect(await prisma.taskFavorite.count({ where: { organizationId: w.orgId } })).toBe(0);
    await expectToggleNotFoundAfter(w.member, t.id);
  });
});

describe("project favorite toggles against deleteProject", () => {
  async function expectToggleNotFoundAfter(actor: ProjectActor, projectId: string) {
    const fav = await favoriteProject(actor, projectId);
    expect(fav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fav).toEqual(await favoriteProject(actor, missingId()));
    const unfav = await unfavoriteProject(actor, projectId);
    expect(unfav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(unfav).toEqual(await unfavoriteProject(actor, missingId()));
  }

  const favoriteRows = (orgId: string, projectId: string) =>
    prisma.projectFavorite.count({ where: { organizationId: orgId, projectId } });

  it("favoriteProject: delete first, then the favorite is NOT_FOUND and writes no row", async () => {
    const w = await world();
    const [deleted, fav] = await raceInOrder(
      "favoriteProject: delete first",
      "deleteProject",
      () => deleteProject(w.manager, w.project.id, { confirmName: w.name }),
      "favoriteProject",
      () => favoriteProject(w.member, w.project.id),
    );
    expect(deleted).toEqual({ ok: true, removedTaskCount: 0, cleanupQueued: 0 });
    expect(fav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fav).toEqual(await favoriteProject(w.member, missingId()));
    expect(await favoriteRows(w.orgId, w.project.id)).toBe(0);
    await expectToggleNotFoundAfter(w.member, w.project.id);
  });

  it("favoriteProject: favorite first, then deleteProject removes the favorite with the project", async () => {
    const w = await world();
    const [fav, deleted] = await raceInOrder(
      "favoriteProject: favorite first",
      "favoriteProject",
      () => favoriteProject(w.member, w.project.id),
      "deleteProject",
      () => deleteProject(w.manager, w.project.id, { confirmName: w.name }),
    );
    expect(fav).toEqual({ ok: true, changed: true });
    expect(deleted).toEqual({ ok: true, removedTaskCount: 0, cleanupQueued: 0 });
    expect(await favoriteRows(w.orgId, w.project.id)).toBe(0);
    await expectToggleNotFoundAfter(w.member, w.project.id);
  });

  it("unfavoriteProject: delete first, then the unfavorite is NOT_FOUND and no row remains", async () => {
    const w = await world();
    await prisma.projectFavorite.create({
      data: { organizationId: w.orgId, userId: w.member.userId, projectId: w.project.id },
    });
    const [deleted, unfav] = await raceInOrder(
      "unfavoriteProject: delete first",
      "deleteProject",
      () => deleteProject(w.manager, w.project.id, { confirmName: w.name }),
      "unfavoriteProject",
      () => unfavoriteProject(w.member, w.project.id),
    );
    expect(deleted).toEqual({ ok: true, removedTaskCount: 0, cleanupQueued: 0 });
    expect(unfav).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(unfav).toEqual(await unfavoriteProject(w.member, missingId()));
    expect(await favoriteRows(w.orgId, w.project.id)).toBe(0);
    await expectToggleNotFoundAfter(w.member, w.project.id);
  });

  it("unfavoriteProject: unfavorite first, then the delete waits and succeeds", async () => {
    const w = await world();
    await prisma.projectFavorite.create({
      data: { organizationId: w.orgId, userId: w.member.userId, projectId: w.project.id },
    });
    const [unfav, deleted] = await raceInOrder(
      "unfavoriteProject: unfavorite first",
      "unfavoriteProject",
      () => unfavoriteProject(w.member, w.project.id),
      "deleteProject",
      () => deleteProject(w.manager, w.project.id, { confirmName: w.name }),
    );
    expect(unfav).toEqual({ ok: true, changed: true });
    expect(deleted).toEqual({ ok: true, removedTaskCount: 0, cleanupQueued: 0 });
    expect(await favoriteRows(w.orgId, w.project.id)).toBe(0);
    await expectToggleNotFoundAfter(w.member, w.project.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Redaction after a real deleteProject (review R3-4)

describe("redaction after a real delete", () => {
  it("redaction: after deleteProject the remaining project's feed shows the redacted projection and the deleted feed is NOT_FOUND", async () => {
    const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
    const [, m, us, ut] = org.users.map((u) => u.id) as [string, string, string, string];
    const orgId = org.orgId;
    const M = actorOf(m, orgId);
    const s = await seedProject(prisma, orgId, {
      createdByUserId: m,
      name: "S-secret-name",
      keyPrefix: "SSEC",
      isPrivate: true,
      managerUserIds: [m],
      memberUserIds: [us],
    });
    const t = await seedProject(prisma, orgId, {
      createdByUserId: ut,
      name: "T-secret-name",
      keyPrefix: "TSEC",
      isPrivate: true,
      managerUserIds: [ut],
      memberUserIds: [m],
    });
    const sLabel = await seedLabel(prisma, orgId, s.id, { name: "s-only-label" });
    const sMilestone = await seedMilestone(prisma, orgId, s.id);
    const sTask = await seedTask(prisma, orgId, s.id, {
      assigneeUserId: us,
      createdByUserId: m,
      labelIds: [sLabel.id],
      milestoneId: sMilestone.id,
    });
    await seedComment(prisma, orgId, sTask.id, { authorUserId: us });
    await seedAttachment(prisma, orgId, sTask.id, { uploadedByUserId: us });
    const tLabel = await seedLabel(prisma, orgId, t.id, { name: "t-only-label" });
    const tMilestone = await seedMilestone(prisma, orgId, t.id);
    const tTask = await seedTask(prisma, orgId, t.id, {
      assigneeUserId: ut,
      createdByUserId: ut,
      labelIds: [tLabel.id],
      milestoneId: tMilestone.id,
    });
    const batchId = randomUUID();
    const before = {
      projectId: s.id,
      taskKey: "SSEC-1",
      milestoneId: sMilestone.id,
      labelNames: ["s-only-label"],
      assigneeUserId: us,
    };
    const after = {
      projectId: t.id,
      taskKey: "TSEC-1",
      milestoneId: tMilestone.id,
      labelNames: ["t-only-label"],
      assigneeUserId: ut,
      subtaskCount: 0,
    };
    const seeded = await seedActivity(prisma, orgId, {
      projectId: t.id,
      relatedProjectId: s.id,
      taskId: tTask.id,
      teamId: null,
      actorUserId: m,
      verb: "TASK_MOVED",
      entityType: "TASK",
      entityId: tTask.id,
      before,
      after,
      batchId,
    });
    const stored = await prisma.projectActivity.findFirstOrThrow({
      where: { organizationId: orgId, id: seeded.id },
      select: { id: true, createdAt: true },
    });

    expect(await listProjectActivity(M, t.id)).toEqual({
      ok: true,
      rows: [
        {
          id: stored.id,
          projectId: t.id,
          relatedProjectId: s.id,
          taskId: tTask.id,
          teamId: null,
          actorUserId: m,
          verb: "TASK_MOVED",
          entityType: "TASK",
          entityId: tTask.id,
          before,
          after,
          batchId,
          createdAt: stored.createdAt,
          redacted: false,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });

    expect(await deleteProject(M, s.id, { confirmName: "S-secret-name" })).toEqual({
      ok: true,
      removedTaskCount: 1,
      cleanupQueued: 1,
    });

    const feed = await listProjectActivity(M, t.id);
    expect(feed).toEqual({
      ok: true,
      rows: [
        {
          id: stored.id,
          projectId: t.id,
          relatedProjectId: null,
          taskId: null,
          teamId: null,
          actorUserId: m,
          verb: "TASK_MOVED",
          entityType: "TASK",
          entityId: null,
          before: { redacted: true },
          after,
          batchId: null,
          createdAt: stored.createdAt,
          redacted: true,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    if (!feed.ok) throw new Error("unreachable");
    const row = feed.rows[0];
    expect(Object.keys(row ?? {})).toEqual([...ACTIVITY_FEED_ROW_KEYS]);
    expect(row?.before).toEqual(REDACTED_SIDE);
    const text = JSON.stringify(row);
    for (const secret of [
      s.id,
      "S-secret-name",
      "SSEC",
      "s-only-label",
      sMilestone.id,
      us,
      tTask.id,
      batchId,
    ]) {
      expect(text).not.toContain(secret);
    }
    const gone = await listProjectActivity(M, s.id);
    expect(gone).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(gone).toEqual(await listProjectActivity(M, missingId()));
  });
});
