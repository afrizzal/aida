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
import {
  isEligibleAssignee,
  type ProjectAccess,
  type RowLockMode,
  readableProjectIds,
  readableProjectWhere,
  requireProject,
  requireTask,
} from "./access";
import { changedValues, recordProjectActivity } from "./activity";
import {
  type ActivityScalar,
  type CalendarDate,
  codePointLength,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  ESTIMATE_MAX_MINUTES,
  fromCalendarDate,
  hasNul,
  LIST_DEFAULT,
  LIST_MAX,
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
import { spawnRecurrenceSuccessorInTx } from "./recurrence";
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
    else {
      // The stored value is the validated one (review b-WR-02): the CHECK measures what is stored.
      const text = raw.description.trim();
      if (text.length === 0) value.description = null;
      else if (codePointLength(text) > TASK_DESCRIPTION_MAX) bad("description");
      else value.description = text;
    }
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

function groupWhere(
  orgId: string,
  group: RankGroup,
  excludeTaskId?: string,
): Prisma.TaskWhereInput {
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
    // Review b-IN-03: the predecessor's id only when the reader can read its project now.
    let recurrencePredecessorId: string | null = null;
    if (row.recurrencePredecessorId) {
      const predecessor = await db.task.findFirst({
        where: { id: row.recurrencePredecessorId, organizationId: orgId },
        select: { projectId: true },
      });
      if (
        predecessor &&
        (await readableProjectIds(db, actor, [predecessor.projectId])).has(predecessor.projectId)
      ) {
        recurrencePredecessorId = row.recurrencePredecessorId;
      }
    }
    const { milestoneId: _milestoneId, ...rest } = row;
    return {
      task: {
        ...rest,
        recurrencePredecessorId,
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

// ---------------------------------------------------------------------------------------------
// Shared write helpers (contract sections 3 and 14)

const TASK_ROW_SELECT = {
  id: true,
  projectId: true,
  parentId: true,
  key: true,
  title: true,
  descriptionMarkdown: true,
  status: true,
  priority: true,
  assigneeUserId: true,
  startDate: true,
  dueDate: true,
  estimateMinutes: true,
  rank: true,
  archivedAt: true,
  version: true,
  recurrenceRule: true,
} as const;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_ROW_SELECT }>;

async function readTaskRow(
  tx: ProjectDb,
  orgId: string,
  taskId: string,
  projectId: string,
): Promise<TaskRow> {
  const row = await tx.task.findFirst({
    where: { id: taskId, organizationId: orgId, projectId },
    select: TASK_ROW_SELECT,
  });
  if (!row) refuse("NOT_FOUND");
  return row;
}

/**
 * A stale version or a conditional update's miss, classified by an explicit re-read through the
 * read predicate (contract section 14): gone or unreadable NOT_FOUND, archived (the task, its
 * parent or its project) ARCHIVED, else CONFLICT.
 */
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

interface TaskEdit {
  data: Prisma.TaskUncheckedUpdateManyInput;
  before: ActivityRecord;
  after: ActivityRecord;
}

/**
 * The skeleton of the content edits (CONTENT, PROJECT_SHARE): the task FOR UPDATE through
 * requireTask (a subtask's parent FOR SHARE first), afterLock, a stale version classified, no-op
 * detection before any write, a conditional update on (id, organizationId, version) that
 * increments version, and one TASK_UPDATED row with the changed keys only.
 */
async function editTask(
  actor: ProjectActor,
  operation: string,
  taskId: string,
  expectedVersionRaw: unknown,
  plan: (tx: ProjectDb, row: TaskRow, access: ProjectAccess) => Promise<TaskEdit | null>,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, operation, async (tx) => {
    const expectedVersion = validVersion(expectedVersionRaw);
    const access = await requireTask(tx, actor, taskId, {
      lock: "share",
      level: "CONTENT",
      taskLock: "update",
    });
    await afterLock(tx, operation);
    const row = await readTaskRow(tx, actor.orgId, taskId, access.task.projectId);
    if (row.version !== expectedVersion) await classifyTaskMiss(tx, actor, taskId);
    const edit = await plan(tx, row, access);
    const diff = edit ? changedValues(edit.before, edit.after) : null;
    if (!edit || !diff) return { changed: false };
    const updated = await tx.task.updateMany({
      where: { id: taskId, organizationId: actor.orgId, version: expectedVersion },
      data: { ...edit.data, version: { increment: 1 } },
    });
    if (updated.count !== 1) await classifyTaskMiss(tx, actor, taskId);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: row.projectId,
      taskId,
      actorUserId: actor.userId,
      verb: "TASK_UPDATED",
      entityType: "TASK",
      entityId: taskId,
      before: diff.before,
      after: diff.after,
      batchId: newBatchId(),
    });
    return { changed: true, version: expectedVersion + 1 };
  });
}

// ---------------------------------------------------------------------------------------------
// Edits

export interface UpdateTaskPatch {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assigneeUserId?: string | null;
  estimateMinutes?: number | null;
}

/**
 * Edits title, description, priority, assignee and estimate (CONTENT, PROJECT_SHARE, the task FOR
 * UPDATE). A description change is recorded as descriptionChanged, never the text. An assignee
 * must be eligible (an active organization member and, on a private project, a direct project
 * member; K69): otherwise NOT_ELIGIBLE. The same values again are { changed: false }.
 */
export async function updateTask(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
  patch: UpdateTaskPatch,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return editTask(actor, "updateTask", taskId, expectedVersion, async (tx, row) => {
    const p = (patch ?? {}) as UpdateTaskPatch;
    const value = validTaskInput(
      {
        title: p.title,
        description: p.description,
        priority: p.priority,
        assigneeUserId: p.assigneeUserId,
        estimateMinutes: p.estimateMinutes,
      },
      false,
    );
    const data: Prisma.TaskUncheckedUpdateManyInput = {};
    const before: ActivityRecord = {};
    const after: ActivityRecord = {};
    if (value.title !== undefined && value.title !== row.title) {
      data.title = value.title;
      before.title = row.title;
      after.title = value.title;
    }
    if (value.description !== undefined && value.description !== row.descriptionMarkdown) {
      data.descriptionMarkdown = value.description;
      before.descriptionChanged = false;
      after.descriptionChanged = true;
    }
    if (value.priority !== undefined && value.priority !== row.priority) {
      data.priority = value.priority;
      before.priority = row.priority;
      after.priority = value.priority;
    }
    if (value.assigneeUserId !== undefined && value.assigneeUserId !== row.assigneeUserId) {
      if (
        value.assigneeUserId !== null &&
        !(await isEligibleAssignee(tx, actor.orgId, row.projectId, value.assigneeUserId))
      ) {
        refuse("NOT_ELIGIBLE");
      }
      data.assigneeUserId = value.assigneeUserId;
      before.assigneeUserId = row.assigneeUserId;
      after.assigneeUserId = value.assigneeUserId;
    }
    if (value.estimateMinutes !== undefined && value.estimateMinutes !== row.estimateMinutes) {
      data.estimateMinutes = value.estimateMinutes;
      before.estimateMinutes = row.estimateMinutes;
      after.estimateMinutes = value.estimateMinutes;
    }
    return { data, before, after };
  });
}

/**
 * Sets the start and due dates (CONTENT, PROJECT_SHARE). A field left undefined keeps its stored
 * value; null clears it. A start date after the due date (after merging) is INVALID_DATE_RANGE,
 * and Task_dates_check refuses the same in the database. One TASK_UPDATED row with the changed
 * dates only.
 */
export async function setTaskDates(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
  dates: { startDate?: CalendarDate | null; dueDate?: CalendarDate | null },
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return editTask(actor, "setTaskDates", taskId, expectedVersion, async (_tx, row) => {
    const value = validTaskInput({ startDate: dates?.startDate, dueDate: dates?.dueDate }, false);
    const storedStart = calendarOrNull(row.startDate);
    const storedDue = calendarOrNull(row.dueDate);
    const start = value.startDate !== undefined ? value.startDate : storedStart;
    const due = value.dueDate !== undefined ? value.dueDate : storedDue;
    if (start && due && start > due) refuse("INVALID_DATE_RANGE");
    const data: Prisma.TaskUncheckedUpdateManyInput = {};
    const before: ActivityRecord = {};
    const after: ActivityRecord = {};
    if (start !== storedStart) {
      data.startDate = dateOrNull(start);
      before.startDate = storedStart;
      after.startDate = start;
    }
    if (due !== storedDue) {
      data.dueDate = dateOrNull(due);
      before.dueDate = storedDue;
      after.dueDate = due;
    }
    return { data, before, after };
  });
}

// ---------------------------------------------------------------------------------------------
// Status (contract sections 1, 5 and 8)

export interface StatusChangeContext {
  orgId: string;
  actorUserId: string;
}

export interface StatusChangeTask {
  id: string;
  projectId: string;
  parentId: string | null;
  status: string;
  version: number;
  /** The task's rule when the caller read it; undefined lets the successor step check itself. */
  recurrenceRule?: string | null;
}

/**
 * Writes a new status under the caller's project FOR UPDATE and task FOR UPDATE locks: a top-level
 * task is appended to the end of its new status group (rebalancing that group when needed; a
 * subtask keeps its rank, its group is its parent), version is incremented, and the status part
 * of the change is returned. With record true (the default) one TASK_STATUS_CHANGED row is
 * written; with record false the caller merges the values into its own single row (bulk and
 * reorder, plan 14-12). opts.now is the clock read after the locks. Moving a recurring task into
 * DONE from another status also creates its next occurrence in the same transaction
 * (spawnRecurrenceSuccessorInTx, plan 14-09; D-09), with the same batch id: every status path
 * that calls this helper (setTaskStatus, reorderTask, bulkUpdateTasks) gets it.
 */
export async function applyStatusChangeInTx(
  tx: ProjectDb,
  context: StatusChangeContext,
  task: StatusChangeTask,
  newStatus: TaskStatus,
  opts: { now: Date; batchId: string; record?: boolean },
): Promise<{ before: { status: TaskStatus }; after: { status: TaskStatus }; version: number }> {
  const record = opts.record ?? true;
  const data: Prisma.TaskUncheckedUpdateManyInput = { status: newStatus };
  if (task.parentId === null) {
    data.rank = await appendRankInTx(
      tx,
      context.orgId,
      { projectId: task.projectId, status: newStatus, parentId: null },
      { canRebalance: true, excludeTaskId: task.id },
    );
  }
  const updated = await tx.task.updateMany({
    where: { id: task.id, organizationId: context.orgId, version: task.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (updated.count !== 1) refuse("CONFLICT");
  if (task.status !== "DONE" && newStatus === "DONE" && task.recurrenceRule !== null) {
    await spawnRecurrenceSuccessorInTx(tx, {
      orgId: context.orgId,
      actorUserId: context.actorUserId,
      task: { id: task.id },
      now: opts.now,
      batchId: opts.batchId,
    });
  }
  const values = {
    before: { status: task.status as TaskStatus },
    after: { status: newStatus },
  };
  if (record) {
    await recordProjectActivity(tx, {
      orgId: context.orgId,
      projectId: task.projectId,
      taskId: task.id,
      actorUserId: context.actorUserId,
      verb: "TASK_STATUS_CHANGED",
      entityType: "TASK",
      entityId: task.id,
      before: values.before,
      after: values.after,
      batchId: opts.batchId,
    });
  }
  return { ...values, version: task.version + 1 };
}

/**
 * Moves a task to another status (CONTENT, PROJECT_UPDATE; the parent FOR SHARE and the task FOR
 * UPDATE through requireTask). A status outside TASK_STATUSES is INVALID_INPUT; the same status
 * is { changed: false }; a stale version is CONFLICT.
 */
export async function setTaskStatus(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
  status: TaskStatus,
  opts: { now?: Date } = {},
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, "setTaskStatus", async (tx) => {
    const version = validVersion(expectedVersion);
    const access = await requireTask(tx, actor, taskId, {
      lock: "update",
      level: "CONTENT",
      taskLock: "update",
    });
    await afterLock(tx, "setTaskStatus");
    const now = opts?.now ?? new Date();
    if (!(TASK_STATUSES as readonly unknown[]).includes(status)) refuse("INVALID_INPUT", "status");
    const row = await readTaskRow(tx, actor.orgId, taskId, access.task.projectId);
    if (row.version !== version) await classifyTaskMiss(tx, actor, taskId);
    if (row.status === status) return { changed: false };
    const result = await applyStatusChangeInTx(
      tx,
      { orgId: actor.orgId, actorUserId: actor.userId },
      row,
      status,
      { now, batchId: newBatchId() },
    );
    return { changed: true, version: result.version };
  });
}

// ---------------------------------------------------------------------------------------------
// Parent (contract section 4)

interface LockedTaskRow {
  id: string;
  projectId: string;
  parentId: string | null;
  status: string;
  rank: number;
  version: number;
  archivedAt: Date | null;
  recurrenceRule: string | null;
}

/**
 * Makes a task a subtask of another top-level task of the same project, or top-level again with
 * null (CONTENT, PROJECT_UPDATE; then the task and the new parent FOR UPDATE in one statement in
 * id order). Refused before any write: the task itself INVALID_INPUT (field parentId), a parent
 * outside the project NOT_FOUND, a parent that is a subtask or a task with subtasks
 * SUBTASK_DEPTH, a recurring task RECURRENCE_ON_SUBTASK, an archived parent ARCHIVED. The trigger
 * aida_task_subtask_depth is the second fence. The task is appended to its new group; one
 * TASK_PARENT_CHANGED row.
 */
export async function setTaskParent(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
  parentId: string | null,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, "setTaskParent", async (tx) => {
    const version = validVersion(expectedVersion);
    const access = await requireTask(tx, actor, taskId, { lock: "update", level: "CONTENT" });
    const projectId = access.task.projectId;
    const newParentId = parentId ?? null;
    if (newParentId !== null && !isPlausibleId(newParentId)) refuse("NOT_FOUND");
    if (newParentId === taskId) refuse("INVALID_INPUT", "parentId");
    const ids = newParentId ? [taskId, newParentId] : [taskId];
    const locked = await tx.$queryRaw<LockedTaskRow[]>`
      SELECT "id", "projectId", "parentId", "status"::text AS "status", "rank", "version",
             "archivedAt", "recurrenceRule"::text AS "recurrenceRule"
      FROM "Task"
      WHERE "organizationId" = ${actor.orgId} AND "projectId" = ${projectId}
        AND "id" = ANY(${ids}::text[])
      ORDER BY "id"
      FOR UPDATE`;
    await afterLock(tx, "setTaskParent");
    const task = locked.find((row) => row.id === taskId);
    if (!task) refuse("NOT_FOUND");
    if (task.archivedAt) refuse("ARCHIVED");
    if (task.version !== version) await classifyTaskMiss(tx, actor, taskId);
    if (task.parentId === newParentId) return { changed: false };
    let rank: number;
    if (newParentId !== null) {
      const parent = locked.find((row) => row.id === newParentId);
      if (!parent) refuse("NOT_FOUND");
      if (parent.parentId !== null) refuse("SUBTASK_DEPTH");
      if (parent.archivedAt) refuse("ARCHIVED");
      const child = await tx.task.findFirst({
        where: { organizationId: actor.orgId, projectId, parentId: taskId },
        select: { id: true },
      });
      if (child) refuse("SUBTASK_DEPTH");
      if (task.recurrenceRule !== null) refuse("RECURRENCE_ON_SUBTASK");
      rank = await appendRankInTx(
        tx,
        actor.orgId,
        { projectId, parentId: newParentId },
        { canRebalance: true, excludeTaskId: taskId },
      );
    } else {
      rank = await appendRankInTx(
        tx,
        actor.orgId,
        { projectId, status: task.status as TaskStatus, parentId: null },
        { canRebalance: true, excludeTaskId: taskId },
      );
    }
    const updated = await tx.task.updateMany({
      where: { id: taskId, organizationId: actor.orgId, version },
      data: { parentId: newParentId, rank, version: { increment: 1 } },
    });
    if (updated.count !== 1) await classifyTaskMiss(tx, actor, taskId);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      taskId,
      actorUserId: actor.userId,
      verb: "TASK_PARENT_CHANGED",
      entityType: "TASK",
      entityId: taskId,
      before: { parentId: task.parentId },
      after: { parentId: newParentId },
      batchId: newBatchId(),
    });
    return { changed: true, version: version + 1 };
  });
}

// ---------------------------------------------------------------------------------------------
// Tree lock (contract section 3, review C3)

export interface TreeTaskRow {
  id: string;
  projectId: string;
  parentId: string | null;
  number: number;
  key: string;
  status: string;
  rank: number;
  version: number;
  archivedAt: Date | null;
}

/**
 * Locks a task tree (deleteTask, moveTask): first the root in its own statement, then, in a second
 * statement that runs after the root lock, its subtasks in id order, both with the organization
 * term. A subtask committed while the root lock waited is therefore included. Null when the root
 * is gone. The caller holds the project lock of its operation.
 */
export async function lockTaskTreeInTx(
  tx: ProjectDb,
  orgId: string,
  rootTaskId: string,
  mode: RowLockMode,
): Promise<{ root: TreeTaskRow; subtasks: TreeTaskRow[] } | null> {
  if (!isPlausibleId(rootTaskId)) return null;
  const roots =
    mode === "update"
      ? await tx.$queryRaw<TreeTaskRow[]>`
          SELECT "id", "projectId", "parentId", "number", "key", "status"::text AS "status",
                 "rank", "version", "archivedAt"
          FROM "Task" WHERE "id" = ${rootTaskId} AND "organizationId" = ${orgId}
          FOR UPDATE`
      : await tx.$queryRaw<TreeTaskRow[]>`
          SELECT "id", "projectId", "parentId", "number", "key", "status"::text AS "status",
                 "rank", "version", "archivedAt"
          FROM "Task" WHERE "id" = ${rootTaskId} AND "organizationId" = ${orgId}
          FOR SHARE`;
  const root = roots[0];
  if (!root) return null;
  const subtasks =
    mode === "update"
      ? await tx.$queryRaw<TreeTaskRow[]>`
          SELECT "id", "projectId", "parentId", "number", "key", "status"::text AS "status",
                 "rank", "version", "archivedAt"
          FROM "Task" WHERE "parentId" = ${rootTaskId} AND "organizationId" = ${orgId}
          ORDER BY "id"
          FOR UPDATE`
      : await tx.$queryRaw<TreeTaskRow[]>`
          SELECT "id", "projectId", "parentId", "number", "key", "status"::text AS "status",
                 "rank", "version", "archivedAt"
          FROM "Task" WHERE "parentId" = ${rootTaskId} AND "organizationId" = ${orgId}
          ORDER BY "id"
          FOR SHARE`;
  return { root, subtasks };
}

// ---------------------------------------------------------------------------------------------
// Lists (contract sections 2, 10 and 15)

export interface TaskListItem {
  id: string;
  projectId: string;
  parentId: string | null;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeUserId: string | null;
  startDate: CalendarDate | null;
  dueDate: CalendarDate | null;
  rank: number;
  archivedAt: Date | null;
  version: number;
}

const TASK_LIST_SELECT = {
  id: true,
  projectId: true,
  parentId: true,
  key: true,
  title: true,
  status: true,
  priority: true,
  assigneeUserId: true,
  startDate: true,
  dueDate: true,
  rank: true,
  archivedAt: true,
  version: true,
} as const;

function toListItem(row: Prisma.TaskGetPayload<{ select: typeof TASK_LIST_SELECT }>): TaskListItem {
  return {
    ...row,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    startDate: calendarOrNull(row.startDate),
    dueDate: calendarOrNull(row.dueDate),
  };
}

function listLimit(raw: unknown): number {
  const limit = raw ?? LIST_DEFAULT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    refuse("INVALID_INPUT", "limit");
  }
  return Math.min(limit, LIST_MAX);
}

function encodeCursor(value: unknown[]): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor: unknown): unknown[] {
  try {
    if (typeof cursor !== "string") throw new Error("cursor");
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // falls through to the refusal
  }
  return refuse("INVALID_INPUT", "cursor");
}

function validStatusFilter(raw: unknown): TaskStatus | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!(TASK_STATUSES as readonly unknown[]).includes(raw)) refuse("INVALID_INPUT", "status");
  return raw as TaskStatus;
}

function validAssigneeFilter(filters: object): Prisma.TaskWhereInput | null {
  if (!("assigneeUserId" in filters)) return null;
  const raw = (filters as { assigneeUserId?: unknown }).assigneeUserId;
  if (raw === undefined) return null;
  if (raw === null) return { assigneeUserId: null };
  if (!isPlausibleId(raw)) refuse("INVALID_INPUT", "assigneeUserId");
  return { assigneeUserId: raw };
}

function archivedTerms(orgId: string, archived: unknown): Prisma.TaskWhereInput[] {
  const mode = archived ?? "exclude";
  if (mode === "include") return [];
  const parentLive: Prisma.TaskWhereInput = {
    OR: [{ parentId: null }, { parent: { organizationId: orgId, archivedAt: null } }],
  };
  if (mode === "exclude") return [{ archivedAt: null }, parentLive];
  if (mode === "only") {
    return [
      {
        OR: [
          { archivedAt: { not: null } },
          { parent: { organizationId: orgId, archivedAt: { not: null } } },
        ],
      },
    ];
  }
  return refuse("INVALID_INPUT", "archived");
}

export interface ListProjectTasksFilters {
  status?: TaskStatus;
  /** Top-level tasks when absent or null; the subtasks of that task otherwise. */
  parentId?: string | null;
  /** null lists unassigned tasks. */
  assigneeUserId?: string | null;
  archived?: "exclude" | "only" | "include";
  cursor?: string | null;
  limit?: number;
}

/**
 * The tasks of one project (READ): top-level by default or the subtasks of parentId, filtered by
 * status, assignee and archive state (default exclude; a subtask of an archived parent counts as
 * archived), ordered by (rank, id), keyset-paged (limit at most LIST_MAX).
 */
export async function listProjectTasks(
  actor: ProjectActor,
  projectId: string,
  filters: ListProjectTasksFilters = {},
): Promise<ProjectResult<{ tasks: TaskListItem[]; hasMore: boolean; nextCursor: string | null }>> {
  return runProjectRead(actor, "listProjectTasks", async (db) => {
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    const f = filters ?? {};
    const orgId = actor.orgId;
    const limit = listLimit(f.limit);
    const parentId = f.parentId ?? null;
    if (parentId !== null && !isPlausibleId(parentId)) refuse("INVALID_INPUT", "parentId");
    const terms: Prisma.TaskWhereInput[] = [{ organizationId: orgId, projectId, parentId }];
    const status = validStatusFilter(f.status);
    if (status) terms.push({ status });
    const assignee = validAssigneeFilter(f);
    if (assignee) terms.push(assignee);
    terms.push(...archivedTerms(orgId, f.archived));
    if (f.cursor !== undefined && f.cursor !== null) {
      const [rank, id] = decodeCursor(f.cursor);
      if (typeof rank !== "number" || !Number.isSafeInteger(rank) || typeof id !== "string") {
        refuse("INVALID_INPUT", "cursor");
      }
      terms.push({ OR: [{ rank: { gt: rank } }, { rank, id: { gt: id } }] });
    }
    const found = await db.task.findMany({
      where: { AND: terms },
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: TASK_LIST_SELECT,
    });
    const hasMore = found.length > limit;
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    return {
      tasks: page.map(toListItem),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor([last.rank, last.id]) : null,
    };
  });
}

export interface ListWorkspaceTasksFilters {
  /** null lists unassigned tasks. */
  assigneeUserId?: string | null;
  status?: TaskStatus;
  dueFrom?: CalendarDate;
  dueTo?: CalendarDate;
  cursor?: string | null;
  limit?: number;
}

/**
 * Tasks across every project the actor can read now (READ, isolation LIST: a non-private project
 * or a direct ProjectMember row, K69), leaving out archived projects, archived tasks and subtasks
 * of archived parents, filtered by assignee, status and a due-date range (inclusive), ordered by
 * id, keyset-paged.
 */
export async function listWorkspaceTasks(
  actor: ProjectActor,
  filters: ListWorkspaceTasksFilters = {},
): Promise<ProjectResult<{ tasks: TaskListItem[]; hasMore: boolean; nextCursor: string | null }>> {
  return runProjectRead(actor, "listWorkspaceTasks", async (db) => {
    const f = filters ?? {};
    const orgId = actor.orgId;
    const limit = listLimit(f.limit);
    const terms: Prisma.TaskWhereInput[] = [
      {
        organizationId: orgId,
        project: { AND: [readableProjectWhere(actor), { archivedAt: null }] },
      },
      ...archivedTerms(orgId, "exclude"),
    ];
    const status = validStatusFilter(f.status);
    if (status) terms.push({ status });
    const assignee = validAssigneeFilter(f);
    if (assignee) terms.push(assignee);
    const range: { gte?: Date; lte?: Date } = {};
    if (f.dueFrom !== undefined) {
      const from = parseCalendarDate(f.dueFrom);
      if (from === null) refuse("INVALID_INPUT", "dueFrom");
      range.gte = fromCalendarDate(from);
    }
    if (f.dueTo !== undefined) {
      const to = parseCalendarDate(f.dueTo);
      if (to === null) refuse("INVALID_INPUT", "dueTo");
      range.lte = fromCalendarDate(to);
    }
    if (range.gte || range.lte) terms.push({ dueDate: range });
    if (f.cursor !== undefined && f.cursor !== null) {
      const [id] = decodeCursor(f.cursor);
      if (typeof id !== "string") refuse("INVALID_INPUT", "cursor");
      terms.push({ id: { gt: id } });
    }
    const found = await db.task.findMany({
      where: { AND: terms },
      orderBy: [{ id: "asc" }],
      take: limit + 1,
      select: TASK_LIST_SELECT,
    });
    const hasMore = found.length > limit;
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    return {
      tasks: page.map(toListItem),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor([last.id]) : null,
    };
  });
}
