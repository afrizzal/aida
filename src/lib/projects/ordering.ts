// Phase 14: drag-style reordering of a task within its group or into another status column
// (contract sections 1, 3, 5 and 8; D-10; AIDA-65). Relative imports only, no Next.js import.
//
// reorderTask (CONTENT, PROJECT_UPDATE): the project FOR UPDATE and the task FOR UPDATE through
// requireTask, then afterLock. The group is the top-level tasks of the project in the target
// status, or the subtasks of the task's parent. placeAfterTaskId names a task of that group (null:
// first in the group); anything else is INVALID_INPUT with field placeAfterTaskId. A status change
// goes through applyStatusChangeInTx with record false (so a recurring task moved into DONE gets
// its successor and its TASK_RECURRED row, D-09). The rank comes from rankBetween with the
// neighbours of the placement (the task itself excluded); when no integer fits, the group is
// renumbered with rebalancedRanks in (rank, id) order through raw updates (organization term,
// "updatedAt" = now()) and the rank is computed again. A rank change never increments version.
// Exactly one row: TASK_STATUS_CHANGED (status and rank) when the status changed, else
// TASK_REORDERED (rank). A placement equal to the current one is { changed: false } and writes
// nothing (C8).
import type { Prisma } from "../../generated/prisma/client";
import { requireTask } from "./access";
import { recordProjectActivity } from "./activity";
import { type ProjectActor, type ProjectResult, TASK_STATUSES, type TaskStatus } from "./contract";
import { rankBetween, rebalancedRanks } from "./rank";
import {
  afterLock,
  isPlausibleId,
  newBatchId,
  type ProjectDb,
  refuse,
  runProjectTransaction,
} from "./service";
import { applyStatusChangeInTx } from "./tasks";

export interface ReorderTaskInput {
  /** The target status column; absent keeps the task's status. */
  status?: TaskStatus;
  /** The task of the group the moved task goes directly after; null places it first. */
  placeAfterTaskId: string | null;
}

interface GroupMember {
  id: string;
  rank: number;
}

/** (rank, id) order, plain code-unit comparison of ids. */
function before(a: GroupMember, b: GroupMember): boolean {
  return a.rank < b.rank || (a.rank === b.rank && a.id < b.id);
}

function groupWhere(
  orgId: string,
  task: { id: string; projectId: string; parentId: string | null },
  status: TaskStatus,
): Prisma.TaskWhereInput {
  const base: Prisma.TaskWhereInput =
    task.parentId !== null
      ? { organizationId: orgId, projectId: task.projectId, parentId: task.parentId }
      : { organizationId: orgId, projectId: task.projectId, parentId: null, status };
  return { ...base, id: { not: task.id } };
}

async function readGroup(tx: ProjectDb, where: Prisma.TaskWhereInput): Promise<GroupMember[]> {
  return tx.task.findMany({
    where,
    orderBy: [{ rank: "asc" }, { id: "asc" }],
    select: { id: true, rank: true },
  });
}

/** The rank for the slot after members[index] (index -1: first), or null when none fits. */
function slotRank(members: readonly GroupMember[], index: number): number | null {
  const prev = index >= 0 ? (members[index] as GroupMember) : null;
  const next = members[index + 1] ?? null;
  return rankBetween(prev ? prev.rank : null, next ? next.rank : null);
}

/**
 * Places a task after a given task of its group, or first, optionally in another status column
 * (CONTENT, PROJECT_UPDATE). Returns { changed: false } when the placement is the current one.
 */
export async function reorderTask(
  actor: ProjectActor,
  taskId: string,
  input: ReorderTaskInput,
  opts: { now?: Date } = {},
): Promise<
  ProjectResult<{ changed: boolean; status?: TaskStatus; rank?: number; version?: number }>
> {
  return runProjectTransaction(actor, "reorderTask", async (tx) => {
    const access = await requireTask(tx, actor, taskId, {
      lock: "update",
      level: "CONTENT",
      taskLock: "update",
    });
    await afterLock(tx, "reorderTask");
    const now = opts?.now ?? new Date();
    const value = (input ?? {}) as Partial<ReorderTaskInput>;
    if (
      value.status !== undefined &&
      !(TASK_STATUSES as readonly unknown[]).includes(value.status)
    ) {
      refuse("INVALID_INPUT", "status");
    }
    const placeAfter = value.placeAfterTaskId ?? null;
    if (placeAfter !== null && (!isPlausibleId(placeAfter) || placeAfter === taskId)) {
      refuse("INVALID_INPUT", "placeAfterTaskId");
    }

    const row = await tx.task.findFirst({
      where: { id: taskId, organizationId: actor.orgId, projectId: access.task.projectId },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        status: true,
        rank: true,
        version: true,
        recurrenceRule: true,
      },
    });
    if (!row) refuse("NOT_FOUND");
    const fromStatus = row.status as TaskStatus;
    const target = (value.status ?? fromStatus) as TaskStatus;
    const statusChanged = target !== fromStatus;
    const where = groupWhere(actor.orgId, row, target);

    // The placement must name a task of the target group (refused before any write).
    let members = await readGroup(tx, where);
    if (placeAfter !== null && !members.some((m) => m.id === placeAfter)) {
      refuse("INVALID_INPUT", "placeAfterTaskId");
    }

    if (!statusChanged) {
      // No-op: the task already sits directly after the requested neighbour.
      const self = { id: row.id, rank: row.rank };
      const predecessors = members.filter((m) => before(m, self));
      const current =
        predecessors.length > 0 ? (predecessors[predecessors.length - 1] as GroupMember).id : null;
      if (current === placeAfter) return { changed: false };
    }

    const batchId = newBatchId();
    let version = row.version;
    if (statusChanged) {
      const result = await applyStatusChangeInTx(
        tx,
        { orgId: actor.orgId, actorUserId: actor.userId },
        row,
        target,
        { now, batchId, record: false },
      );
      version = result.version;
      // The append inside applyStatusChangeInTx may have renumbered the group; read it again.
      members = await readGroup(tx, where);
    }

    const index = placeAfter === null ? -1 : members.findIndex((m) => m.id === placeAfter);
    let rank = slotRank(members, index);
    if (rank === null) {
      const ranks = rebalancedRanks(members.length);
      for (const [i, member] of members.entries()) {
        await tx.$executeRaw`
          UPDATE "Task" SET "rank" = ${ranks[i]}, "updatedAt" = now()
          WHERE "id" = ${member.id} AND "organizationId" = ${actor.orgId}`;
      }
      members = members.map((m, i) => ({ id: m.id, rank: ranks[i] as number }));
      rank = slotRank(members, index);
      if (rank === null) throw new Error("reorderTask: no rank after a rebalance");
    }
    await tx.$executeRaw`
      UPDATE "Task" SET "rank" = ${rank}, "updatedAt" = now()
      WHERE "id" = ${row.id} AND "organizationId" = ${actor.orgId}`;

    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: row.projectId,
      taskId: row.id,
      actorUserId: actor.userId,
      verb: statusChanged ? "TASK_STATUS_CHANGED" : "TASK_REORDERED",
      entityType: "TASK",
      entityId: row.id,
      before: statusChanged ? { status: fromStatus, rank: row.rank } : { rank: row.rank },
      after: statusChanged ? { status: target, rank } : { rank },
      batchId,
    });
    return { changed: true, status: target, rank, version };
  });
}
