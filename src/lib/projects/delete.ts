// Phase 14 confirmed hard delete of tasks and projects (contract sections 1, 2, 3, 5, 6 and 12;
// D-06, D-07, run decisions K63, K64 and K66; reviews R2-2, R2-3 and P4; AIDA-103, AIDA-104).
// Relative imports only, no Next.js import.
//
// The delete record (K63, owner item 14-o2): the record of a delete is the append-only
// ProjectActivity row written in the delete transaction (TASK_DELETED per removed task with one
// batchId, PROJECT_DELETED with counts). This module never touches the AI audit table, never
// removes or changes a ProjectActivity row (it only inserts them) and never removes a
// ProjectKeyPrefix reservation. Whether that activity row satisfies "writes an audit event" is
// owner item 14-o2: the clause is claimed only as "recorded in ProjectActivity, owner
// confirmation pending".
//
// Order inside the one transaction (section 12, review R2-3). The lock classes of section 3 are
// entered in order and never re-entered, so a delete never takes a lock of an earlier class after a
// later one and never deadlocks with a concurrent create, write or favorite toggle:
//   0. Confirmation first (CONFIRMATION_REQUIRED, nothing locked or written). deleteProject's name
//      is compared after the access check, because comparing it before would tell an actor who
//      cannot read the project that it exists; a wrong name still writes nothing.
//   1. Every lock. deleteTask: the project FOR SHARE and the task through requireTask (a subtask's
//      parent FOR SHARE first), then the tree with lockTaskTreeInTx FOR UPDATE, root first.
//      deleteProject: the project FOR UPDATE, every task of the project FOR UPDATE in one statement
//      in id order, then its ProjectTaskCounter row FOR UPDATE. Then afterLock.
//   2. Reads: the storage keys of every TaskAttachment of the removed tasks and the counts the
//      activity values need (before any row is deleted).
//   3. Key rows: every TaskKey row of the removed tasks becomes TOMBSTONE (class 5).
//   4. Outbox: one ProjectFileCleanup row per collected storage key (class 6, K66); the scheduled
//      sweep removes the files after commit.
//   5. Deletes in foreign-key order, leaves first (RESTRICT, C3): TaskFavorite, TaskLabel,
//      TaskComment, TaskAttachment, the Task rows in one statement; for a project then
//      ProjectLabel, ProjectMilestone, ProjectMember, ProjectTeam, ProjectFavorite,
//      ProjectTaskCounter and the Project row. Every Task, counter and Project row deleted here
//      was locked in step 1.
//   6. Activity rows (section 5, cascades), last (class 7).
// Steps 2 to 5 for the task rows live in removeTasksInTx, shared by both operations.
import { requireProject, requireTask } from "./access";
import { recordProjectActivity } from "./activity";
import type { ProjectActor, ProjectResult } from "./contract";
import { enqueueFileCleanupInTx } from "./file-cleanup";
import { tombstoneTaskKeysInTx } from "./keys";
import { afterLock, newBatchId, type ProjectDb, refuse, runProjectTransaction } from "./service";
import { lockTaskTreeInTx } from "./tasks";

/** What removeTasksInTx read before it deleted (step 2), per task and in total. */
interface RemovedTasks {
  tasks: {
    id: string;
    key: string;
    title: string;
    parentId: string | null;
    commentCount: number;
    attachmentCount: number;
  }[];
  commentCount: number;
  attachmentCount: number;
  cleanupQueued: number;
}

/**
 * Steps 2 to 5 of the delete order for the given (already locked) task ids: reads the storage keys
 * and counts, tombstones the key rows, writes the file-cleanup outbox rows, and only then deletes
 * the rows hanging off the tasks and the Task rows (one statement). Every statement writes the
 * organization term.
 */
async function removeTasksInTx(
  tx: ProjectDb,
  orgId: string,
  taskIds: readonly string[],
): Promise<RemovedTasks> {
  const ids = [...new Set(taskIds)];
  // Step 2: storage keys and counts, read before any row is deleted.
  const attachments = await tx.taskAttachment.findMany({
    where: { organizationId: orgId, taskId: { in: ids } },
    orderBy: { id: "asc" },
    select: { taskId: true, storageKey: true },
  });
  const comments = await tx.taskComment.groupBy({
    by: ["taskId"],
    where: { organizationId: orgId, taskId: { in: ids } },
    _count: { _all: true },
  });
  const rows = await tx.task.findMany({
    where: { organizationId: orgId, id: { in: ids } },
    orderBy: { id: "asc" },
    select: { id: true, key: true, title: true, parentId: true },
  });
  const commentsByTask = new Map(comments.map((c) => [c.taskId, c._count._all]));
  const attachmentsByTask = new Map<string, number>();
  for (const a of attachments) {
    attachmentsByTask.set(a.taskId, (attachmentsByTask.get(a.taskId) ?? 0) + 1);
  }
  const storageKeys = [...new Set(attachments.map((a) => a.storageKey))];

  // Step 3: key rows become TOMBSTONE (class 5).
  await tombstoneTaskKeysInTx(tx, orgId, ids);
  // Step 4: one outbox row per storage key (class 6).
  await enqueueFileCleanupInTx(tx, orgId, storageKeys);
  // Step 5: deletes in foreign-key order, leaves first.
  await tx.taskFavorite.deleteMany({ where: { organizationId: orgId, taskId: { in: ids } } });
  await tx.taskLabel.deleteMany({ where: { organizationId: orgId, taskId: { in: ids } } });
  await tx.taskComment.deleteMany({ where: { organizationId: orgId, taskId: { in: ids } } });
  await tx.taskAttachment.deleteMany({ where: { organizationId: orgId, taskId: { in: ids } } });
  await tx.task.deleteMany({ where: { organizationId: orgId, id: { in: ids } } });

  const tasks = rows.map((row) => ({
    ...row,
    commentCount: commentsByTask.get(row.id) ?? 0,
    attachmentCount: attachmentsByTask.get(row.id) ?? 0,
  }));
  return {
    tasks,
    commentCount: tasks.reduce((sum, t) => sum + t.commentCount, 0),
    attachmentCount: attachments.length,
    cleanupQueued: storageKeys.length,
  };
}

export interface DeleteTaskInput {
  /** Must be exactly true. */
  confirm: boolean;
  /** The task's current version. */
  expectedVersion: number;
}

/**
 * Hard-deletes a task with its subtasks, comments, attachments, label links and favorites
 * (CREATOR_OR_MANAGE under PROJECT_SHARE; D-07, K64). Requires confirm true and the current
 * version of the task (CONFIRMATION_REQUIRED, CONFLICT). Its keys become TOMBSTONE, its files are
 * queued for the sweep, and one TASK_DELETED row per removed task (one batchId) records it.
 */
export async function deleteTask(
  actor: ProjectActor,
  taskId: string,
  input: DeleteTaskInput,
): Promise<ProjectResult<{ removedTaskCount: number; cleanupQueued: number }>> {
  return runProjectTransaction(actor, "deleteTask", async (tx) => {
    if (input?.confirm !== true) refuse("CONFIRMATION_REQUIRED");
    const expectedVersion = input.expectedVersion;
    if (
      typeof expectedVersion !== "number" ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      refuse("INVALID_INPUT", "expectedVersion");
    }
    // Step 1: the project FOR SHARE and the task (parent FOR SHARE first), then the tree.
    const access = await requireTask(tx, actor, taskId, {
      lock: "share",
      level: "CREATOR_OR_MANAGE",
      taskLock: "update",
      allow: (a) => a.task.createdByUserId === actor.userId,
    });
    const tree = await lockTaskTreeInTx(tx, actor.orgId, taskId, "update");
    if (!tree) refuse("NOT_FOUND");
    await afterLock(tx, "deleteTask");
    if (tree.root.version !== expectedVersion) refuse("CONFLICT");

    // Steps 2 to 5.
    const removed = await removeTasksInTx(tx, actor.orgId, [
      tree.root.id,
      ...tree.subtasks.map((s) => s.id),
    ]);

    // Step 6: one TASK_DELETED row per removed task, one batchId (section 5, cascades).
    const batchId = newBatchId();
    const ordered = [
      ...removed.tasks.filter((t) => t.id === tree.root.id),
      ...removed.tasks.filter((t) => t.id !== tree.root.id),
    ];
    for (const task of ordered) {
      await recordProjectActivity(tx, {
        orgId: actor.orgId,
        projectId: access.task.projectId,
        taskId: task.id,
        actorUserId: actor.userId,
        verb: "TASK_DELETED",
        entityType: "TASK",
        entityId: task.id,
        before: {
          key: task.key,
          title: task.title,
          parentId: task.parentId,
          commentCount: task.commentCount,
          attachmentCount: task.attachmentCount,
        },
        after: null,
        batchId,
      });
    }
    return { removedTaskCount: removed.tasks.length, cleanupQueued: removed.cleanupQueued };
  });
}

export interface DeleteProjectInput {
  /** Must equal the project's current name exactly. */
  confirmName: string;
}

/**
 * Hard-deletes a project with every task, comment, attachment, label link, label, milestone,
 * member, team link, favorite and its counter (MANAGE_ARCHIVED under PROJECT_UPDATE, so an
 * archived project may be deleted; D-07, K64). Requires confirmName equal to the current name
 * (CONFIRMATION_REQUIRED). Every key of the project becomes TOMBSTONE, the prefix stays reserved,
 * files are queued for the sweep, and one PROJECT_DELETED row with counts records it.
 */
export async function deleteProject(
  actor: ProjectActor,
  projectId: string,
  input: DeleteProjectInput,
): Promise<ProjectResult<{ removedTaskCount: number; cleanupQueued: number }>> {
  return runProjectTransaction(actor, "deleteProject", async (tx) => {
    const confirmName = input?.confirmName;
    if (typeof confirmName !== "string" || confirmName.length === 0) {
      refuse("CONFIRMATION_REQUIRED");
    }
    const orgId = actor.orgId;
    // Step 1: the project FOR UPDATE, then its tasks in id order, then its counter row.
    const access = await requireProject(tx, actor, projectId, {
      lock: "update",
      level: "MANAGE_ARCHIVED",
    });
    if (confirmName !== access.project.name) refuse("CONFIRMATION_REQUIRED");
    const lockedTasks = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Task"
      WHERE "projectId" = ${projectId} AND "organizationId" = ${orgId}
      ORDER BY "id"
      FOR UPDATE`;
    await tx.$queryRaw<{ projectId: string }[]>`
      SELECT "projectId" FROM "ProjectTaskCounter"
      WHERE "projectId" = ${projectId} AND "organizationId" = ${orgId}
      FOR UPDATE`;
    await afterLock(tx, "deleteProject");

    // Step 2 (project part): counts for the activity row.
    const labelCount = await tx.projectLabel.count({ where: { organizationId: orgId, projectId } });
    const milestoneCount = await tx.projectMilestone.count({
      where: { organizationId: orgId, projectId },
    });
    const memberCount = await tx.projectMember.count({
      where: { organizationId: orgId, projectId },
    });

    // Steps 2 to 5 for the tasks.
    const removed = await removeTasksInTx(
      tx,
      orgId,
      lockedTasks.map((t) => t.id),
    );

    // Step 5 (project part): project-owned rows, then the project row.
    await tx.projectLabel.deleteMany({ where: { organizationId: orgId, projectId } });
    await tx.projectMilestone.deleteMany({ where: { organizationId: orgId, projectId } });
    await tx.projectMember.deleteMany({ where: { organizationId: orgId, projectId } });
    await tx.projectTeam.deleteMany({ where: { organizationId: orgId, projectId } });
    await tx.projectFavorite.deleteMany({ where: { organizationId: orgId, projectId } });
    await tx.projectTaskCounter.deleteMany({ where: { organizationId: orgId, projectId } });
    const gone = await tx.project.deleteMany({ where: { organizationId: orgId, id: projectId } });
    if (gone.count !== 1) refuse("NOT_FOUND");

    // Step 6: one PROJECT_DELETED row with counts (section 5, cascades).
    await recordProjectActivity(tx, {
      orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "PROJECT_DELETED",
      entityType: "PROJECT",
      entityId: projectId,
      before: {
        name: access.project.name,
        keyPrefix: access.project.keyPrefix,
        taskCount: removed.tasks.length,
        commentCount: removed.commentCount,
        attachmentCount: removed.attachmentCount,
        labelCount,
        milestoneCount,
        memberCount,
      },
      after: null,
      batchId: newBatchId(),
    });
    return { removedTaskCount: removed.tasks.length, cleanupQueued: removed.cleanupQueued };
  });
}
