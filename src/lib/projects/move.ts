// Phase 14: moving a task tree to another project (contract sections 1, 2, 3, 5, 6 and 11; D-13,
// K67, C3; reviews C1 and R2-1; AIDA-103, AIDA-104). Relative imports only, no Next.js import.
//
// Order inside the one transaction (section 3):
//   1. A plain read of the task's project (organization term), then both projects FOR UPDATE in one
//      statement ordered by id (lockProjectsInIdOrder), then CONTENT on both (NOT_FOUND, ARCHIVED),
//      the same project INVALID_INPUT, then the tree with lockTaskTreeInTx (the root FOR UPDATE,
//      then its subtasks FOR UPDATE in id order). A subtask alone is SUBTASK_MOVE. Then afterLock
//      and the root's version (CONFLICT).
//   2. Mappings read under those locks: labels and milestone by lower(name) in the target (SQL
//      lower(), the same function as the unique indexes), the assignee through isEligibleAssignee.
//   3. One new number per task from the target counter (class 4), root first, then the subtasks
//      in (rank, id) order.
//   4. The tree's TaskLabel rows are deleted, then ONE UPDATE over the whole tree (an unnest join
//      with the organization term) sets projectId, number, key, rank, milestoneId and the assignee
//      and increments version; the self foreign key and the milestone foreign key hold at the end
//      of that statement (C3). The label links are then re-created in the target.
//   5. Old keys become ALIAS, new keys are inserted ACTIVE (class 5).
//   6. One TASK_MOVED row (class 7): projectId target, relatedProjectId source, entity the root;
//      before holds the source side and after the target side, each complete, so redactActivityRow
//      (activity.ts) can replace an unreadable side as a whole.
// Comments, attachments and task favorites follow the task because they reference
// (organizationId, taskId) only (K67). Recurrence columns are plain data and stay unchanged.
import {
  isEligibleAssignee,
  lockProjectsInIdOrder,
  requireMembership,
  requireProject,
} from "./access";
import { recordProjectActivity } from "./activity";
import { formatTaskKey, type ProjectActor, type ProjectResult, type TaskStatus } from "./contract";
import { aliasTaskKeyInTx, issueTaskKeyInTx, nextTaskNumberInTx } from "./keys";
import {
  afterLock,
  isPlausibleId,
  newBatchId,
  type ProjectDb,
  refuse,
  runProjectTransaction,
} from "./service";
import { appendRankInTx, lockTaskTreeInTx, type TreeTaskRow } from "./tasks";

export interface MoveTaskResult {
  taskId: string;
  key: string;
  projectId: string;
  version: number;
  subtaskCount: number;
}

function byRankThenId(a: TreeTaskRow, b: TreeTaskRow): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sortedNames(names: Iterable<string>): string[] {
  return [...names].sort();
}

/** Source id to target id, for rows of the two projects whose lower(name) is equal. */
async function nameMap(
  tx: ProjectDb,
  table: "ProjectLabel" | "ProjectMilestone",
  orgId: string,
  sourceId: string,
  targetId: string,
): Promise<Map<string, { id: string; name: string }>> {
  const rows =
    table === "ProjectLabel"
      ? await tx.$queryRaw<{ sourceId: string; targetId: string; targetName: string }[]>`
          SELECT s."id" AS "sourceId", t."id" AS "targetId", t."name" AS "targetName"
          FROM "ProjectLabel" s
          JOIN "ProjectLabel" t
            ON t."organizationId" = ${orgId} AND t."projectId" = ${targetId}
           AND lower(t."name") = lower(s."name")
          WHERE s."organizationId" = ${orgId} AND s."projectId" = ${sourceId}`
      : await tx.$queryRaw<{ sourceId: string; targetId: string; targetName: string }[]>`
          SELECT s."id" AS "sourceId", t."id" AS "targetId", t."name" AS "targetName"
          FROM "ProjectMilestone" s
          JOIN "ProjectMilestone" t
            ON t."organizationId" = ${orgId} AND t."projectId" = ${targetId}
           AND lower(t."name") = lower(s."name")
          WHERE s."organizationId" = ${orgId} AND s."projectId" = ${sourceId}`;
  return new Map(rows.map((r) => [r.sourceId, { id: r.targetId, name: r.targetName }]));
}

/**
 * Moves a top-level task with its subtasks to another project (CONTENT on both, PROJECTS_UPDATE).
 * Refusals: NOT_FOUND (missing, other organization, unreadable source or target), ARCHIVED,
 * INVALID_INPUT (target equal to source, or a malformed expectedVersion), SUBTASK_MOVE (a subtask
 * alone), CONFLICT (stale version, or the task moved meanwhile), KEY_SPACE_EXHAUSTED.
 */
export async function moveTask(
  actor: ProjectActor,
  taskId: string,
  targetProjectId: string,
  expectedVersion: number,
): Promise<ProjectResult<MoveTaskResult>> {
  return runProjectTransaction(actor, "moveTask", async (tx) => {
    if (
      typeof expectedVersion !== "number" ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      refuse("INVALID_INPUT", "expectedVersion");
    }
    if (!isPlausibleId(taskId) || !isPlausibleId(targetProjectId)) refuse("NOT_FOUND");
    await requireMembership(tx, actor);

    // Step 1: locks and access.
    const plain = await tx.task.findFirst({
      where: { id: taskId, organizationId: actor.orgId },
      select: { projectId: true },
    });
    if (!plain) refuse("NOT_FOUND");
    const sourceId = plain.projectId;
    await lockProjectsInIdOrder(tx, actor.orgId, [sourceId, targetProjectId], "update");
    await requireProject(tx, actor, sourceId, { lock: "none", level: "CONTENT" });
    const target = await requireProject(tx, actor, targetProjectId, {
      lock: "none",
      level: "CONTENT",
    });
    if (targetProjectId === sourceId) refuse("INVALID_INPUT", "targetProjectId");
    const tree = await lockTaskTreeInTx(tx, actor.orgId, taskId, "update");
    if (!tree) refuse("NOT_FOUND");
    // A task's project changes only under its project's FOR UPDATE lock, which this transaction
    // now holds, so a different project means a move committed before the lock (its version moved).
    if (tree.root.projectId !== sourceId) refuse("CONFLICT");
    if (tree.root.parentId !== null) refuse("SUBTASK_MOVE");
    if (tree.root.archivedAt) refuse("ARCHIVED");
    await afterLock(tx, "moveTask");
    if (tree.root.version !== expectedVersion) refuse("CONFLICT");

    // Step 2: mappings.
    const ordered = [tree.root, ...[...tree.subtasks].sort(byRankThenId)];
    const ids = ordered.map((t) => t.id);
    const rows = await tx.task.findMany({
      where: { organizationId: actor.orgId, id: { in: ids } },
      select: { id: true, milestoneId: true, assigneeUserId: true },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const links = await tx.taskLabel.findMany({
      where: { organizationId: actor.orgId, projectId: sourceId, taskId: { in: ids } },
      select: { taskId: true, labelId: true, label: { select: { name: true } } },
    });
    const labelMap = await nameMap(tx, "ProjectLabel", actor.orgId, sourceId, targetProjectId);
    const milestoneMap = await nameMap(
      tx,
      "ProjectMilestone",
      actor.orgId,
      sourceId,
      targetProjectId,
    );
    const eligible = new Map<string, boolean>();
    for (const row of rows) {
      const userId = row.assigneeUserId;
      if (userId === null || eligible.has(userId)) continue;
      eligible.set(userId, await isEligibleAssignee(tx, actor.orgId, targetProjectId, userId));
    }

    // Step 3: new numbers from the target counter, root first.
    const prefix = target.project.keyPrefix;
    const numbers: number[] = [];
    for (let i = 0; i < ordered.length; i++) {
      numbers.push(await nextTaskNumberInTx(tx, actor.orgId, targetProjectId));
    }
    const rootRank = await appendRankInTx(
      tx,
      actor.orgId,
      { projectId: targetProjectId, status: tree.root.status as TaskStatus, parentId: null },
      { canRebalance: true },
    );

    const plan = ordered.map((task, i) => {
      const row = rowById.get(task.id);
      const milestoneId = row?.milestoneId ? (milestoneMap.get(row.milestoneId)?.id ?? null) : null;
      const assigneeUserId =
        row?.assigneeUserId && eligible.get(row.assigneeUserId) ? row.assigneeUserId : null;
      const number = numbers[i] as number;
      return {
        id: task.id,
        oldKey: task.key,
        number,
        key: formatTaskKey(prefix, number),
        rank: i === 0 ? rootRank : task.rank,
        milestoneId,
        assigneeUserId,
        sourceMilestoneId: row?.milestoneId ?? null,
        sourceAssigneeUserId: row?.assigneeUserId ?? null,
      };
    });

    // Step 4: label links out, one UPDATE over the tree, label links back in the target.
    await tx.taskLabel.deleteMany({
      where: { organizationId: actor.orgId, projectId: sourceId, taskId: { in: ids } },
    });
    const updated = await tx.$executeRaw`
      UPDATE "Task" AS t
      SET "projectId" = ${targetProjectId},
          "number" = v."number",
          "key" = v."key",
          "rank" = v."rank",
          "milestoneId" = v."milestoneId",
          "assigneeUserId" = v."assigneeUserId",
          "version" = t."version" + 1,
          "updatedAt" = now()
      FROM unnest(
        ${plan.map((p) => p.id)}::text[],
        ${plan.map((p) => p.number)}::int[],
        ${plan.map((p) => p.key)}::text[],
        ${plan.map((p) => p.rank)}::int[],
        ${plan.map((p) => p.milestoneId)}::text[],
        ${plan.map((p) => p.assigneeUserId)}::text[]
      ) AS v("id", "number", "key", "rank", "milestoneId", "assigneeUserId")
      WHERE t."id" = v."id" AND t."organizationId" = ${actor.orgId}
        AND t."projectId" = ${sourceId}`;
    if (updated !== plan.length) throw new Error("moveTask: tree update count mismatch");
    const newLinks: {
      organizationId: string;
      projectId: string;
      taskId: string;
      labelId: string;
    }[] = [];
    const targetLabelNames = new Map<string, string[]>();
    for (const link of links) {
      const mapped = labelMap.get(link.labelId);
      if (!mapped) continue;
      newLinks.push({
        organizationId: actor.orgId,
        projectId: targetProjectId,
        taskId: link.taskId,
        labelId: mapped.id,
      });
      const names = targetLabelNames.get(link.taskId) ?? [];
      names.push(mapped.name);
      targetLabelNames.set(link.taskId, names);
    }
    if (newLinks.length > 0) await tx.taskLabel.createMany({ data: newLinks });

    // Step 5: keys.
    for (const p of plan) {
      await aliasTaskKeyInTx(tx, actor.orgId, p.oldKey);
      await issueTaskKeyInTx(tx, {
        orgId: actor.orgId,
        projectId: targetProjectId,
        taskId: p.id,
        prefix,
        number: p.number,
      });
    }

    // Step 6: one TASK_MOVED row.
    const root = plan[0] as (typeof plan)[number];
    const rootSourceLabels = links.filter((l) => l.taskId === root.id).map((l) => l.label.name);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: targetProjectId,
      relatedProjectId: sourceId,
      taskId: root.id,
      actorUserId: actor.userId,
      verb: "TASK_MOVED",
      entityType: "TASK",
      entityId: root.id,
      before: {
        projectId: sourceId,
        taskKey: root.oldKey,
        milestoneId: root.sourceMilestoneId,
        labelNames: sortedNames(rootSourceLabels),
        assigneeUserId: root.sourceAssigneeUserId,
      },
      after: {
        projectId: targetProjectId,
        taskKey: root.key,
        milestoneId: root.milestoneId,
        labelNames: sortedNames(targetLabelNames.get(root.id) ?? []),
        assigneeUserId: root.assigneeUserId,
        subtaskCount: plan.length - 1,
      },
      batchId: newBatchId(),
    });
    return {
      taskId: root.id,
      key: root.key,
      projectId: targetProjectId,
      version: tree.root.version + 1,
      subtaskCount: plan.length - 1,
    };
  });
}
