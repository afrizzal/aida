// Phase 14: atomic bulk updates of up to BULK_MAX tasks across projects (contract sections 1, 3,
// 5, 14 and 15; D-09, D-10; AIDA-68). Relative imports only, no Next.js import.
//
// The shape follows the ticket bulk mutation, without its no-op row (C8): the ids and the patch
// are validated before any lock (more than BULK_MAX distinct ids TOO_MANY, none or an empty patch
// INVALID_INPUT); the organization membership is read; each task's project is resolved with the
// organization term and the read predicate (a task of a project the actor cannot read is NOT_FOUND
// for the whole batch, exactly like a missing id); every involved project is locked FOR UPDATE in
// one statement in id order (PROJECTS_UPDATE) and checked at CONTENT; every task is locked FOR
// UPDATE in one statement in id order and must still belong to a locked project (else CONFLICT);
// then afterLock. Per-task checks (archived task or parent, assignee eligibility, the date range
// against the stored values, milestone and labels of that task's project, the label bound) run
// for every task before the first write, so one refusal refuses the batch and nothing changes.
// Only real changes are written: the status through applyStatusChangeInTx with record false (its
// version increment is the task's only one), the other fields without a second increment; one row
// per changed task (TASK_STATUS_CHANGED when the status changed, holding the other changed keys
// too, else TASK_UPDATED) with one batch id; unchanged tasks get no row.
import type { Prisma } from "../../generated/prisma/client";
import {
  isEligibleAssignee,
  lockProjectsInIdOrder,
  readableProjectWhere,
  requireMembership,
  requireProject,
} from "./access";
import { recordProjectActivity } from "./activity";
import {
  type ActivityScalar,
  BULK_MAX,
  type CalendarDate,
  fromCalendarDate,
  MAX_TASK_LABELS,
  type ProjectActor,
  type ProjectResult,
  parseCalendarDate,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
  toCalendarDate,
} from "./contract";
import { resolveProjectLabelIdsInTx } from "./labels";
import { afterLock, isPlausibleId, newBatchId, refuse, runProjectTransaction } from "./service";
import { applyStatusChangeInTx } from "./tasks";

export interface BulkTaskPatch {
  status?: TaskStatus;
  assigneeUserId?: string | null;
  priority?: TaskPriority;
  startDate?: CalendarDate | null;
  dueDate?: CalendarDate | null;
  milestoneId?: string | null;
  addLabelIds?: readonly string[];
  removeLabelIds?: readonly string[];
}

interface ValidPatch {
  status?: TaskStatus;
  assigneeUserId?: string | null;
  priority?: TaskPriority;
  startDate?: CalendarDate | null;
  dueDate?: CalendarDate | null;
  milestoneId?: string | null;
  addLabelIds: string[];
  removeLabelIds: string[];
}

interface LockedTask {
  id: string;
  projectId: string;
  parentId: string | null;
  status: string;
  version: number;
  archivedAt: Date | null;
  recurrenceRule: string | null;
  assigneeUserId: string | null;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  milestoneId: string | null;
}

type ActivityRecord = Record<string, ActivityScalar | readonly string[]>;

function validIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) refuse("INVALID_INPUT", "taskIds");
  const ids = [...new Set(raw as unknown[])];
  if (ids.length > BULK_MAX) refuse("TOO_MANY");
  if (ids.length === 0) refuse("INVALID_INPUT", "taskIds");
  // A malformed id is answered like a missing one.
  if (ids.some((id) => !isPlausibleId(id))) refuse("NOT_FOUND");
  return (ids as string[]).sort();
}

function validDate(raw: unknown, field: string): CalendarDate | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const date = parseCalendarDate(raw);
  if (date === null) refuse("INVALID_INPUT", field);
  return date;
}

function validLabelIds(raw: unknown, field: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) refuse("INVALID_INPUT", field);
  const ids = [...new Set(raw as unknown[])];
  if (ids.some((id) => !isPlausibleId(id))) refuse("INVALID_INPUT", field);
  if (ids.length > MAX_TASK_LABELS) refuse("TOO_MANY");
  return ids as string[];
}

function validPatch(raw: unknown): ValidPatch {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    refuse("INVALID_INPUT", "patch");
  }
  const p = raw as Record<string, unknown>;
  const out: ValidPatch = { addLabelIds: [], removeLabelIds: [] };
  if (p.status !== undefined) {
    if (!(TASK_STATUSES as readonly unknown[]).includes(p.status))
      refuse("INVALID_INPUT", "status");
    out.status = p.status as TaskStatus;
  }
  if (p.priority !== undefined) {
    if (!(TASK_PRIORITIES as readonly unknown[]).includes(p.priority)) {
      refuse("INVALID_INPUT", "priority");
    }
    out.priority = p.priority as TaskPriority;
  }
  if (p.assigneeUserId !== undefined) {
    if (p.assigneeUserId !== null && !isPlausibleId(p.assigneeUserId)) {
      refuse("INVALID_INPUT", "assigneeUserId");
    }
    out.assigneeUserId = p.assigneeUserId as string | null;
  }
  if (p.milestoneId !== undefined) {
    if (p.milestoneId !== null && !isPlausibleId(p.milestoneId)) {
      refuse("INVALID_INPUT", "milestoneId");
    }
    out.milestoneId = p.milestoneId as string | null;
  }
  const start = validDate(p.startDate, "startDate");
  const due = validDate(p.dueDate, "dueDate");
  if (start !== undefined) out.startDate = start;
  if (due !== undefined) out.dueDate = due;
  if (start && due && start > due) refuse("INVALID_DATE_RANGE");
  out.addLabelIds = validLabelIds(p.addLabelIds, "addLabelIds");
  out.removeLabelIds = validLabelIds(p.removeLabelIds, "removeLabelIds");
  if (out.addLabelIds.some((id) => out.removeLabelIds.includes(id))) {
    refuse("INVALID_INPUT", "labelIds");
  }
  const empty =
    out.status === undefined &&
    out.priority === undefined &&
    out.assigneeUserId === undefined &&
    out.milestoneId === undefined &&
    out.startDate === undefined &&
    out.dueDate === undefined &&
    out.addLabelIds.length === 0 &&
    out.removeLabelIds.length === 0;
  if (empty) refuse("INVALID_INPUT", "patch");
  return out;
}

const calendarOrNull = (value: Date | null): CalendarDate | null =>
  value ? toCalendarDate(value) : null;

const codeUnitSort = (values: string[]): string[] =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

interface TaskPlan {
  task: LockedTask;
  data: Prisma.TaskUncheckedUpdateManyInput;
  before: ActivityRecord;
  after: ActivityRecord;
  newStatus: TaskStatus | null;
  addLabelIds: string[];
  removeLabelIds: string[];
}

/**
 * Changes status, assignee, priority, dates, milestone and labels of up to BULK_MAX tasks
 * atomically (CONTENT on every involved project, PROJECTS_UPDATE). Returns the number of changed
 * tasks and the batch id their activity rows share.
 */
export async function bulkUpdateTasks(
  actor: ProjectActor,
  taskIds: readonly string[],
  patch: BulkTaskPatch,
  opts: { now?: Date } = {},
): Promise<ProjectResult<{ changedCount: number; batchId: string }>> {
  return runProjectTransaction(actor, "bulkUpdateTasks", async (tx) => {
    const ids = validIds(taskIds);
    const value = validPatch(patch);
    await requireMembership(tx, actor);

    // Resolve each task's project through the read predicate: unreadable is NOT_FOUND.
    const resolved = await tx.task.findMany({
      where: { organizationId: actor.orgId, id: { in: ids }, project: readableProjectWhere(actor) },
      select: { id: true, projectId: true },
    });
    if (resolved.length !== ids.length) refuse("NOT_FOUND");
    const projectIds = [...new Set(resolved.map((r) => r.projectId))].sort();

    await lockProjectsInIdOrder(tx, actor.orgId, projectIds, "update");
    for (const projectId of projectIds) {
      await requireProject(tx, actor, projectId, { lock: "none", level: "CONTENT" });
    }
    const lockedRows = await tx.$queryRaw<{ id: string; projectId: string }[]>`
      SELECT "id", "projectId" FROM "Task"
      WHERE "organizationId" = ${actor.orgId} AND "id" = ANY(${ids}::text[])
      ORDER BY "id"
      FOR UPDATE`;
    await afterLock(tx, "bulkUpdateTasks");
    if (lockedRows.length !== ids.length) refuse("NOT_FOUND");
    const lockedProjects = new Set(projectIds);
    if (lockedRows.some((t) => !lockedProjects.has(t.projectId))) refuse("CONFLICT");
    const locked: LockedTask[] = await tx.task.findMany({
      where: { organizationId: actor.orgId, id: { in: ids } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        status: true,
        version: true,
        archivedAt: true,
        recurrenceRule: true,
        assigneeUserId: true,
        priority: true,
        startDate: true,
        dueDate: true,
        milestoneId: true,
      },
    });
    const now = opts?.now ?? new Date();

    // Per-task checks, all before the first write.
    const plans: TaskPlan[] = [];
    for (const task of locked) {
      if (task.archivedAt) refuse("ARCHIVED");
      if (task.parentId !== null) {
        const parent = await tx.task.findFirst({
          where: { id: task.parentId, organizationId: actor.orgId, projectId: task.projectId },
          select: { archivedAt: true },
        });
        if (!parent || parent.archivedAt) refuse("ARCHIVED");
      }
      const data: Prisma.TaskUncheckedUpdateManyInput = {};
      const before: ActivityRecord = {};
      const after: ActivityRecord = {};
      if (value.priority !== undefined && value.priority !== task.priority) {
        data.priority = value.priority;
        before.priority = task.priority;
        after.priority = value.priority;
      }
      if (value.assigneeUserId !== undefined && value.assigneeUserId !== task.assigneeUserId) {
        if (
          value.assigneeUserId !== null &&
          !(await isEligibleAssignee(tx, actor.orgId, task.projectId, value.assigneeUserId))
        ) {
          refuse("NOT_ELIGIBLE");
        }
        data.assigneeUserId = value.assigneeUserId;
        before.assigneeUserId = task.assigneeUserId;
        after.assigneeUserId = value.assigneeUserId;
      }
      const storedStart = calendarOrNull(task.startDate);
      const storedDue = calendarOrNull(task.dueDate);
      const start = value.startDate !== undefined ? value.startDate : storedStart;
      const due = value.dueDate !== undefined ? value.dueDate : storedDue;
      if (start && due && start > due) refuse("INVALID_DATE_RANGE");
      if (start !== storedStart) {
        data.startDate = start ? fromCalendarDate(start) : null;
        before.startDate = storedStart;
        after.startDate = start;
      }
      if (due !== storedDue) {
        data.dueDate = due ? fromCalendarDate(due) : null;
        before.dueDate = storedDue;
        after.dueDate = due;
      }
      if (value.milestoneId !== undefined && value.milestoneId !== task.milestoneId) {
        if (value.milestoneId !== null) {
          const milestone = await tx.projectMilestone.findFirst({
            where: {
              id: value.milestoneId,
              organizationId: actor.orgId,
              projectId: task.projectId,
            },
            select: { id: true },
          });
          if (!milestone) refuse("INVALID_INPUT", "milestoneId");
        }
        data.milestoneId = value.milestoneId;
        before.milestoneId = task.milestoneId;
        after.milestoneId = value.milestoneId;
      }
      let addLabelIds: string[] = [];
      let removeLabelIds: string[] = [];
      if (value.addLabelIds.length > 0 || value.removeLabelIds.length > 0) {
        const add = await resolveProjectLabelIdsInTx(
          tx,
          actor.orgId,
          task.projectId,
          value.addLabelIds,
        );
        const remove = await resolveProjectLabelIdsInTx(
          tx,
          actor.orgId,
          task.projectId,
          value.removeLabelIds,
        );
        const current = await tx.taskLabel.findMany({
          where: { organizationId: actor.orgId, projectId: task.projectId, taskId: task.id },
          select: { labelId: true, label: { select: { name: true } } },
        });
        const currentIds = new Set(current.map((l) => l.labelId));
        addLabelIds = add.filter((l) => !currentIds.has(l.id)).map((l) => l.id);
        removeLabelIds = remove.filter((l) => currentIds.has(l.id)).map((l) => l.id);
        if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
          const names = new Map(current.map((l) => [l.labelId, l.label.name]));
          for (const label of add) names.set(label.id, label.name);
          const finalIds = [
            ...current.map((l) => l.labelId).filter((id) => !removeLabelIds.includes(id)),
            ...addLabelIds,
          ];
          if (finalIds.length > MAX_TASK_LABELS) refuse("TOO_MANY");
          before.labelNames = codeUnitSort(current.map((l) => l.label.name));
          after.labelNames = codeUnitSort(finalIds.map((id) => names.get(id) as string));
        }
      }
      const newStatus =
        value.status !== undefined && value.status !== task.status ? value.status : null;
      if (newStatus !== null) {
        before.status = task.status;
        after.status = newStatus;
      }
      plans.push({ task, data, before, after, newStatus, addLabelIds, removeLabelIds });
    }

    // Writes: only real changes, one row per changed task, one batch id.
    const batchId = newBatchId();
    let changedCount = 0;
    for (const plan of plans) {
      const { task } = plan;
      const fieldsChanged = Object.keys(plan.data).length > 0;
      const labelsChanged = plan.addLabelIds.length > 0 || plan.removeLabelIds.length > 0;
      if (plan.newStatus === null && !fieldsChanged && !labelsChanged) continue;
      if (plan.newStatus !== null) {
        await applyStatusChangeInTx(
          tx,
          { orgId: actor.orgId, actorUserId: actor.userId },
          task,
          plan.newStatus,
          { now, batchId, record: false },
        );
        if (fieldsChanged) {
          await tx.task.updateMany({
            where: { id: task.id, organizationId: actor.orgId },
            data: plan.data,
          });
        }
      } else {
        const updated = await tx.task.updateMany({
          where: { id: task.id, organizationId: actor.orgId, version: task.version },
          data: { ...plan.data, version: { increment: 1 } },
        });
        if (updated.count !== 1) refuse("CONFLICT");
      }
      if (plan.removeLabelIds.length > 0) {
        await tx.taskLabel.deleteMany({
          where: {
            organizationId: actor.orgId,
            taskId: task.id,
            labelId: { in: plan.removeLabelIds },
          },
        });
      }
      if (plan.addLabelIds.length > 0) {
        await tx.taskLabel.createMany({
          data: plan.addLabelIds.map((labelId) => ({
            organizationId: actor.orgId,
            projectId: task.projectId,
            taskId: task.id,
            labelId,
          })),
        });
      }
      await recordProjectActivity(tx, {
        orgId: actor.orgId,
        projectId: task.projectId,
        taskId: task.id,
        actorUserId: actor.userId,
        verb: plan.newStatus !== null ? "TASK_STATUS_CHANGED" : "TASK_UPDATED",
        entityType: "TASK",
        entityId: task.id,
        before: plan.before,
        after: plan.after,
        batchId,
      });
      changedCount++;
    }
    return { changedCount, batchId };
  });
}
