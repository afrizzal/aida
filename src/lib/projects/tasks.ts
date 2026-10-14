// Phase 14 task core (contract sections 1 to 8, 14 and 15; D-03, D-08, D-10, K61, K65, K69):
// create, read, lists, versioned edits, dates, status changes and one-level parenting, plus the
// helpers later plans reuse (applyStatusChangeInTx, lockTaskTreeInTx, appendRankInTx,
// taskInputErrors). Relative imports only (worker-reachable), no Next.js import.
//
// Locks follow contract section 3: the project first (FOR SHARE for content writes, FOR UPDATE for
// status and parent moves), then task rows (a parent before its own subtasks), then the counter,
// then the key namespace, activity last. Refusals come before any write; the subtask trigger and
// Task_dates_check are the database's second fence, mapped by runProjectTransaction.
import type { Prisma } from "../../generated/prisma/client";
import { renderTaskMarkdown } from "../markdown/render";
import { isEligibleAssignee, requireProject, requireTask } from "./access";
import { recordProjectActivity } from "./activity";
import {
  type ActivityScalar,
  type CalendarDate,
  codePointLength,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  ESTIMATE_MAX_MINUTES,
  fromCalendarDate,
  hasNul,
  type ProjectActor,
  type ProjectRefusalCode,
  type ProjectResult,
  parseCalendarDate,
  RANK_MAX,
  type RecurrenceRule,
  TASK_DESCRIPTION_MAX,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX,
  type TaskPriority,
  type TaskStatus,
  toCalendarDate,
} from "./contract";
import { issueTaskKeyInTx, nextTaskNumberInTx } from "./keys";
import { appendRank, rebalancedRanks } from "./rank";
import {
  afterLock,
  isPlausibleId,
  newBatchId,
  type ProjectDb,
  refuse,
  runProjectRead,
  runProjectTransaction,
} from "./service";

type ActivityRecord = Record<string, ActivityScalar>;

// ---------------------------------------------------------------------------------------------
// Input (contract section 15)

/** The task fields a caller may set. Every field is optional; createTask needs a title. */
export interface TaskInput {
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  assigneeUserId?: unknown;
  startDate?: unknown;
  dueDate?: unknown;
  estimateMinutes?: unknown;
}

/** The validated values of a TaskInput (only the fields that were given). */
export interface ParsedTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeUserId?: string | null;
  startDate?: CalendarDate | null;
  dueDate?: CalendarDate | null;
  estimateMinutes?: number | null;
}

export interface TaskInputError {
  code: Extract<ProjectRefusalCode, "INVALID_INPUT" | "INVALID_DATE_RANGE">;
  field?: string;
}

function parseTaskInput(
  input: TaskInput,
  opts: { requireTitle: boolean },
): { value: ParsedTaskInput; errors: TaskInputError[] } {
  const value: ParsedTaskInput = {};
  const errors: TaskInputError[] = [];
  const bad = (field: string) => errors.push({ code: "INVALID_INPUT", field });
  const raw = (input ?? {}) as TaskInput;

  if (raw.title !== undefined || opts.requireTitle) {
    const title = typeof raw.title === "string" && !hasNul(raw.title) ? raw.title.trim() : null;
    if (title === null || title.length === 0 || codePointLength(title) > TASK_TITLE_MAX) {
      bad("title");
    } else {
      value.title = title;
    }
  }
  if (raw.description !== undefined) {
    if (raw.description === null) value.description = null;
    else if (typeof raw.description !== "string" || hasNul(raw.description)) bad("description");
    else if (raw.description.trim().length === 0) value.description = null;
    else if (codePointLength(raw.description.trim()) > TASK_DESCRIPTION_MAX) bad("description");
    else value.description = raw.description;
  }
  if (raw.status !== undefined) {
    if ((TASK_STATUSES as readonly unknown[]).includes(raw.status)) {
      value.status = raw.status as TaskStatus;
    } else {
      bad("status");
    }
  }
  if (raw.priority !== undefined) {
    if ((TASK_PRIORITIES as readonly unknown[]).includes(raw.priority)) {
      value.priority = raw.priority as TaskPriority;
    } else {
      bad("priority");
    }
  }
  if (raw.assigneeUserId !== undefined) {
    if (raw.assigneeUserId === null) value.assigneeUserId = null;
    else if (isPlausibleId(raw.assigneeUserId)) value.assigneeUserId = raw.assigneeUserId;
    else bad("assigneeUserId");
  }
  for (const field of ["startDate", "dueDate"] as const) {
    const given = raw[field];
    if (given === undefined) continue;
    if (given === null) {
      value[field] = null;
      continue;
    }
    const date = parseCalendarDate(given);
    if (date === null) bad(field);
    else value[field] = date;
  }
  if (raw.estimateMinutes !== undefined) {
    const e = raw.estimateMinutes;
    if (e === null) value.estimateMinutes = null;
    else if (typeof e === "number" && Number.isInteger(e) && e >= 0 && e <= ESTIMATE_MAX_MINUTES) {
      value.estimateMinutes = e;
    } else {
      bad("estimateMinutes");
    }
  }
  if (value.startDate && value.dueDate && value.startDate > value.dueDate) {
    errors.push({ code: "INVALID_DATE_RANGE" });
  }
  return { value, errors };
}

/**
 * The refusals a task input earns (contract section 15): lengths in code points after trim, NUL,
 * the status and priority sets, CalendarDate strings, start not after due (INVALID_DATE_RANGE)
 * and estimateMinutes 0 to ESTIMATE_MAX_MINUTES. Empty when the input is valid. With
 * requireTitle (createTask) a missing title is INVALID_INPUT with field title.
 */
export function taskInputErrors(
  input: TaskInput,
  opts: { requireTitle?: boolean } = {},
): TaskInputError[] {
  return parseTaskInput(input, { requireTitle: opts.requireTitle ?? false }).errors;
}

function validTaskInput(input: TaskInput, requireTitle: boolean): ParsedTaskInput {
  const { value, errors } = parseTaskInput(input, { requireTitle });
  const first = errors[0];
  if (first) refuse(first.code, first.field);
  return value;
}

function validVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    refuse("INVALID_INPUT", "expectedVersion");
  }
  return raw;
}

const dateOrNull = (value: CalendarDate | null | undefined): Date | null =>
  value ? fromCalendarDate(value) : null;

const calendarOrNull = (value: Date | null): CalendarDate | null =>
  value ? toCalendarDate(value) : null;

// ---------------------------------------------------------------------------------------------
// Rank (contract section 8)

/** A rank group: top-level tasks by (project, status), subtasks by parent. */
export type RankGroup =
  | { projectId: string; status: TaskStatus; parentId?: null }
  | { projectId: string; parentId: string };

function groupWhere(orgId: string, group: RankGroup, excludeTaskId?: string): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput =
    group.parentId != null
      ? { organizationId: orgId, projectId: group.projectId, parentId: group.parentId }
      : {
          organizationId: orgId,
          projectId: group.projectId,
          parentId: null,
          status: (group as { status: TaskStatus }).status,
        };
  if (excludeTaskId) where.id = { not: excludeTaskId };
  return where;
}

/**
 * The rank that appends a task to its group (contract section 8): the group's largest rank plus
 * RANK_GAP. When that would pass RANK_MAX, a caller holding the project FOR UPDATE passes
 * canRebalance true and the group is renumbered to (i + 1) * RANK_GAP in (rank, id) order before
 * the append is computed again; any other caller (createTask under FOR SHARE) gets
 * min(largest + 1, RANK_MAX), a tie ordered by id. excludeTaskId leaves the moving task out.
 */
export async function appendRankInTx(
  tx: ProjectDb,
  orgId: string,
  group: RankGroup,
  opts: { canRebalance: boolean; excludeTaskId?: string },
): Promise<number> {
  const where = groupWhere(orgId, group, opts.excludeTaskId);
  const max = await tx.task.aggregate({ where, _max: { rank: true } });
  const largest = max._max.rank ?? null;
  const next = appendRank(largest);
  if (next !== null) return next;
  if (!opts.canRebalance) return Math.min((largest ?? 0) + 1, RANK_MAX);
  const members = await tx.task.findMany({
    where,
    orderBy: [{ rank: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const ranks = rebalancedRanks(members.length);
  for (const [i, member] of members.entries()) {
    await tx.$executeRaw`
      UPDATE "Task" SET "rank" = ${ranks[i]}, "updatedAt" = now()
      WHERE "id" = ${member.id} AND "organizationId" = ${orgId}`;
  }
  const after = appendRank(ranks.length > 0 ? (ranks[ranks.length - 1] as number) : null);
  return after ?? RANK_MAX;
}

// ---------------------------------------------------------------------------------------------
// Create

export interface CreateTaskInput extends TaskInput {
  /** A top-level task of the same project, or null or absent for a top-level task. */
  parentId?: string | null;
}

interface LockedParentRow {
  id: string;
  projectId: string;
  parentId: string | null;
  archivedAt: Date | null;
}

/**
 * Creates a task (CONTENT, PROJECT_SHARE): the project FOR SHARE; with a parent, that parent FOR
 * SHARE (organization and project terms) and checked on the row the lock returned (missing
 * NOT_FOUND, itself a subtask SUBTASK_DEPTH, archived ARCHIVED; review C3); input validation;
 * assignee eligibility (NOT_ELIGIBLE); then the number from the counter, the rank appended to its
 * group, the Task row, its ACTIVE key and one TASK_CREATED row.
 */
export async function createTask(
  actor: ProjectActor,
  projectId: string,
  input: CreateTaskInput,
): Promise<ProjectResult<{ taskId: string; key: string; number: number; version: number }>> {
  return runProjectTransaction(actor, "createTask", async (tx) => {
    const access = await requireProject(tx, actor, projectId, { lock: "share", level: "CONTENT" });
    const parentIdRaw = input?.parentId ?? null;
    let parent: LockedParentRow | null = null;
    if (parentIdRaw !== null) {
      if (!isPlausibleId(parentIdRaw)) refuse("NOT_FOUND");
      const rows = await tx.$queryRaw<LockedParentRow[]>`
        SELECT "id", "projectId", "parentId", "archivedAt" FROM "Task"
        WHERE "id" = ${parentIdRaw} AND "organizationId" = ${actor.orgId}
          AND "projectId" = ${projectId}
        FOR SHARE`;
      parent = rows[0] ?? null;
      if (!parent) refuse("NOT_FOUND");
      if (parent.parentId !== null) refuse("SUBTASK_DEPTH");
      if (parent.archivedAt) refuse("ARCHIVED");
    }
    const value = validTaskInput(input, true);
    const assigneeUserId = value.assigneeUserId ?? null;
    if (
      assigneeUserId !== null &&
      !(await isEligibleAssignee(tx, actor.orgId, projectId, assigneeUserId))
    ) {
      refuse("NOT_ELIGIBLE");
    }
    await afterLock(tx, "createTask");

    const taskNumber = await nextTaskNumberInTx(tx, actor.orgId, projectId);
    const status = value.status ?? DEFAULT_TASK_STATUS;
    const priority = value.priority ?? DEFAULT_TASK_PRIORITY;
    const group: RankGroup = parent
      ? { projectId, parentId: parent.id }
      : { projectId, status, parentId: null };
    const rank = await appendRankInTx(tx, actor.orgId, group, { canRebalance: false });
    const prefix = access.project.keyPrefix;
    const key = `${prefix}-${taskNumber}`;
    const task = await tx.task.create({
      data: {
        organizationId: actor.orgId,
        projectId,
        parentId: parent?.id ?? null,
        number: taskNumber,
        key,
        title: value.title as string,
        descriptionMarkdown: value.description ?? null,
        status,
        priority,
        assigneeUserId,
        createdByUserId: actor.userId,
        startDate: dateOrNull(value.startDate),
        dueDate: dateOrNull(value.dueDate),
        estimateMinutes: value.estimateMinutes ?? null,
        rank,
      },
      select: { id: true },
    });
    await issueTaskKeyInTx(tx, {
      orgId: actor.orgId,
      projectId,
      taskId: task.id,
      prefix,
      number: taskNumber,
    });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      taskId: task.id,
      actorUserId: actor.userId,
      verb: "TASK_CREATED",
      entityType: "TASK",
      entityId: task.id,
      before: null,
      after: {
        key,
        title: value.title as string,
        status,
        priority,
        parentId: parent?.id ?? null,
        assigneeUserId,
        startDate: value.startDate ?? null,
        dueDate: value.dueDate ?? null,
        estimateMinutes: value.estimateMinutes ?? null,
      },
      batchId: newBatchId(),
    });
    return { taskId: task.id, key, number: taskNumber, version: 0 };
  });
}

// ---------------------------------------------------------------------------------------------
// Read

export interface TaskSubtaskView {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  rank: number;
  archivedAt: Date | null;
}

export interface TaskView {
  id: string;
  projectId: string;
  parentId: string | null;
  number: number;
  key: string;
  title: string;
  descriptionMarkdown: string | null;
  descriptionHtml: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeUserId: string | null;
  createdByUserId: string | null;
  startDate: CalendarDate | null;
  dueDate: CalendarDate | null;
  estimateMinutes: number | null;
  milestone: { id: string; name: string } | null;
  labels: { id: string; name: string; color: string }[];
  rank: number;
  archivedAt: Date | null;
  archivedViaParent: boolean;
  version: number;
  recurrenceRule: RecurrenceRule | null;
  recurrenceAnchor: CalendarDate | null;
  recurrenceTimeZone: string | null;
  recurrencePredecessorId: string | null;
  subtasks: TaskSubtaskView[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reads one task (READ; archived work allowed): the fields of contract section 15 with dates as
 * CalendarDate strings, the description rendered by renderTaskMarkdown (K65: no images, safe
 * links), labels, milestone, recurrence fields, subtasks in (rank, id) order and whether the task
 * counts as archived through its parent.
 */
export async function getTask(
  actor: ProjectActor,
  taskId: string,
): Promise<ProjectResult<{ task: TaskView }>> {
  return runProjectRead(actor, "getTask", async (db) => {
    const access = await requireTask(db, actor, taskId, { lock: "none", level: "READ" });
    const orgId = actor.orgId;
    const projectId = access.task.projectId;
    const row = await db.task.findFirst({
      where: { id: taskId, organizationId: orgId, projectId },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        number: true,
        key: true,
        title: true,
        descriptionMarkdown: true,
        status: true,
        priority: true,
        assigneeUserId: true,
        createdByUserId: true,
        startDate: true,
        dueDate: true,
        estimateMinutes: true,
        milestoneId: true,
        rank: true,
        archivedAt: true,
        version: true,
        recurrenceRule: true,
        recurrenceAnchor: true,
        recurrenceTimeZone: true,
        recurrencePredecessorId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!row) refuse("NOT_FOUND");
    const links = await db.taskLabel.findMany({
      where: { organizationId: orgId, projectId, taskId },
      select: { label: { select: { id: true, name: true, color: true } } },
    });
    const labels = links
      .map((link) => link.label)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
    const milestone = row.milestoneId
      ? await db.projectMilestone.findFirst({
          where: { id: row.milestoneId, organizationId: orgId, projectId },
          select: { id: true, name: true },
        })
      : null;
    const subtasks = await db.task.findMany({
      where: { organizationId: orgId, projectId, parentId: taskId },
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      select: { id: true, key: true, title: true, status: true, rank: true, archivedAt: true },
    });
    const { milestoneId: _milestoneId, ...rest } = row;
    return {
      task: {
        ...rest,
        status: row.status as TaskStatus,
        priority: row.priority as TaskPriority,
        descriptionHtml: renderTaskMarkdown(row.descriptionMarkdown ?? ""),
        startDate: calendarOrNull(row.startDate),
        dueDate: calendarOrNull(row.dueDate),
        recurrenceRule: (row.recurrenceRule ?? null) as RecurrenceRule | null,
        recurrenceAnchor: calendarOrNull(row.recurrenceAnchor),
        milestone: milestone ?? null,
        labels,
        archivedViaParent: Boolean(access.parent?.archivedAt),
        subtasks: subtasks.map((s) => ({ ...s, status: s.status as TaskStatus })),
      },
    };
  });
}
