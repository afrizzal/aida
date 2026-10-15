// Phase 14 archive and restore of projects and tasks (contract sections 1, 2, 3, 10 and 14; D-12,
// AIDA-70, AIDA-103). Relative imports only, no Next.js import.
//
// - archiveProject (MANAGE, PROJECT_UPDATE) and restoreProject (MANAGE_ARCHIVED, PROJECT_UPDATE)
//   lock the project FOR UPDATE, so a content write holding the project FOR SHARE either commits
//   first or waits and then sees the archive (ARCHIVED).
// - archiveTask (CONTENT) and restoreTask (CONTENT_ARCHIVED_TASK) run under PROJECT_SHARE and lock
//   their task FOR UPDATE through requireTask, after the parent FOR SHARE when the task is a
//   subtask (review C3). Archive state is read from the locked rows. Archiving a parent sets
//   archivedAt on the parent only: its subtasks keep their own archivedAt and count as archived
//   through the parent; restoring the parent brings them back exactly as they were.
//
// Every change is a conditional update (archivedAt null or not null, and the version where one is
// given) that increments version, followed by one activity row; a miss is classified by a re-read
// through the read predicate (the missRefusal pattern of section 14). Every statement writes the
// organization term (C1).
import { readableProjectWhere, requireProject, requireTask } from "./access";
import { recordProjectActivity } from "./activity";
import type { ProjectActor, ProjectResult } from "./contract";
import { afterLock, newBatchId, type ProjectDb, refuse, runProjectTransaction } from "./service";

function validVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    refuse("INVALID_INPUT", "expectedVersion");
  }
  return raw;
}

/** A project miss: gone or unreadable NOT_FOUND, archived ARCHIVED, else CONFLICT. */
async function classifyProjectMiss(
  tx: ProjectDb,
  actor: ProjectActor,
  projectId: string,
): Promise<never> {
  const row = await tx.project.findFirst({
    where: { AND: [readableProjectWhere(actor), { id: projectId }] },
    select: { archivedAt: true },
  });
  if (!row) refuse("NOT_FOUND");
  if (row.archivedAt) refuse("ARCHIVED");
  return refuse("CONFLICT");
}

/** A task miss: gone or unreadable NOT_FOUND, archived (task, parent or project) ARCHIVED, else CONFLICT. */
async function classifyTaskMiss(
  tx: ProjectDb,
  actor: ProjectActor,
  taskId: string,
): Promise<never> {
  const row = await tx.task.findFirst({
    where: { id: taskId, organizationId: actor.orgId, project: readableProjectWhere(actor) },
    select: {
      projectId: true,
      parentId: true,
      archivedAt: true,
      project: { select: { archivedAt: true } },
    },
  });
  if (!row) refuse("NOT_FOUND");
  if (row.archivedAt || row.project.archivedAt) refuse("ARCHIVED");
  if (row.parentId) {
    const parent = await tx.task.findFirst({
      where: { id: row.parentId, organizationId: actor.orgId, projectId: row.projectId },
      select: { archivedAt: true },
    });
    if (parent?.archivedAt) refuse("ARCHIVED");
  }
  return refuse("CONFLICT");
}

// ---------------------------------------------------------------------------------------------
// Projects

/**
 * Archives a project (MANAGE under PROJECT_UPDATE): a conditional update where archivedAt is null
 * and the version matches, version incremented, one PROJECT_ARCHIVED row. An archived project
 * leaves default lists and refuses every write with ARCHIVED except restore, delete and favorites.
 */
export async function archiveProject(
  actor: ProjectActor,
  projectId: string,
  expectedVersion: number,
): Promise<ProjectResult<{ changed: boolean; version: number }>> {
  return runProjectTransaction(actor, "archiveProject", async (tx) => {
    const version = validVersion(expectedVersion);
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "archiveProject");
    const now = new Date();
    const updated = await tx.project.updateMany({
      where: { id: projectId, organizationId: actor.orgId, version, archivedAt: null },
      data: { archivedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) await classifyProjectMiss(tx, actor, projectId);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "PROJECT_ARCHIVED",
      entityType: "PROJECT",
      entityId: projectId,
      before: { archived: false },
      after: { archived: true, archivedAt: now.toISOString() },
      batchId: newBatchId(),
    });
    return { changed: true, version: version + 1 };
  });
}

/**
 * Restores an archived project (MANAGE_ARCHIVED under PROJECT_UPDATE): a conditional update where
 * archivedAt is not null, version incremented, one PROJECT_RESTORED row. A project that is not
 * archived is a no-op `{ changed: false }` with no row.
 */
export async function restoreProject(
  actor: ProjectActor,
  projectId: string,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, "restoreProject", async (tx) => {
    const access = await requireProject(tx, actor, projectId, {
      lock: "update",
      level: "MANAGE_ARCHIVED",
    });
    await afterLock(tx, "restoreProject");
    if (!access.project.archivedAt) return { changed: false };
    const updated = await tx.project.updateMany({
      where: { id: projectId, organizationId: actor.orgId, archivedAt: { not: null } },
      data: { archivedAt: null, version: { increment: 1 } },
    });
    if (updated.count !== 1) return { changed: false };
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "PROJECT_RESTORED",
      entityType: "PROJECT",
      entityId: projectId,
      before: { archived: true, archivedAt: access.project.archivedAt.toISOString() },
      after: { archived: false },
      batchId: newBatchId(),
    });
    return { changed: true, version: access.project.version + 1 };
  });
}

// ---------------------------------------------------------------------------------------------
// Tasks

/**
 * Archives a task (CONTENT under PROJECT_SHARE): the task FOR UPDATE through requireTask (a
 * subtask's parent FOR SHARE first, review C3), archive state read from the locked rows, a
 * conditional update of this row only (archivedAt null and the version matching), version
 * incremented, one TASK_ARCHIVED row. A parent's subtasks keep their own archivedAt and count as
 * archived through the parent.
 */
export async function archiveTask(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
): Promise<ProjectResult<{ changed: boolean; version: number }>> {
  return runProjectTransaction(actor, "archiveTask", async (tx) => {
    const version = validVersion(expectedVersion);
    const access = await requireTask(tx, actor, taskId, {
      lock: "share",
      level: "CONTENT",
      taskLock: "update",
    });
    await afterLock(tx, "archiveTask");
    const now = new Date();
    const updated = await tx.task.updateMany({
      where: { id: taskId, organizationId: actor.orgId, version, archivedAt: null },
      data: { archivedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) await classifyTaskMiss(tx, actor, taskId);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: access.task.projectId,
      taskId,
      actorUserId: actor.userId,
      verb: "TASK_ARCHIVED",
      entityType: "TASK",
      entityId: taskId,
      before: { archived: false },
      after: { archived: true, archivedAt: now.toISOString() },
      batchId: newBatchId(),
    });
    return { changed: true, version: version + 1 };
  });
}

/**
 * Restores an archived task (CONTENT_ARCHIVED_TASK under PROJECT_SHARE): the task FOR UPDATE the
 * same way; an archived project or an archived parent is ARCHIVED (restore those first); a task
 * that is not archived is a no-op `{ changed: false }`. One TASK_RESTORED row.
 */
export async function restoreTask(
  actor: ProjectActor,
  taskId: string,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, "restoreTask", async (tx) => {
    const access = await requireTask(tx, actor, taskId, {
      lock: "share",
      level: "CONTENT_ARCHIVED_TASK",
      taskLock: "update",
    });
    await afterLock(tx, "restoreTask");
    const archivedAt = access.task.archivedAt;
    if (!archivedAt) return { changed: false };
    const rows = await tx.$queryRaw<{ version: number }[]>`
      UPDATE "Task" SET "archivedAt" = NULL, "version" = "version" + 1, "updatedAt" = now()
      WHERE "id" = ${taskId} AND "organizationId" = ${actor.orgId} AND "archivedAt" IS NOT NULL
      RETURNING "version"`;
    const version = rows[0]?.version;
    if (version === undefined) return { changed: false };
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: access.task.projectId,
      taskId,
      actorUserId: actor.userId,
      verb: "TASK_RESTORED",
      entityType: "TASK",
      entityId: taskId,
      before: { archived: true, archivedAt: new Date(archivedAt).toISOString() },
      after: { archived: false },
      batchId: newBatchId(),
    });
    return { changed: true, version: Number(version) };
  });
}
