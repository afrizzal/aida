// Phase 14 recurring tasks (contract sections 1, 3, 5, 7 and 8; D-09, AIDA-102): set and clear a
// DAILY, WEEKLY or MONTHLY rule on a top-level task, and create the next occurrence exactly once
// in the transaction that moves a recurring task into DONE. Relative imports only
// (worker-reachable), no Next.js import. This module never imports tasks.ts: tasks.ts calls
// spawnRecurrenceSuccessorInTx from applyStatusChangeInTx, so the module graph stays acyclic.
//
// Exactly once (contract section 7): the successor is created only after a conditional update
// sets the predecessor's recurrenceSpawned from false to true under the task's row lock; no row
// updated means a successor already exists (or once existed) and nothing is created. The partial
// unique index Task_recurrence_predecessor_key is the database fence behind it.
//
// Date bound: the pure rules (recurrence-rules.ts) throw a RangeError when a result would fall
// after 2999-12-31 (CALENDAR_DATE_MAX). That is mapped here to the typed refusal
// INVALID_DATE_RANGE, so a completion whose next occurrence would leave the supported calendar
// range is refused as a whole (nothing changes) and never surfaces as an exception.
import type { Prisma } from "../../generated/prisma/client";
import { isEligibleAssignee, readableProjectWhere, requireTask } from "./access";
import { changedValues, recordProjectActivity } from "./activity";
import {
  type ActivityScalar,
  type CalendarDate,
  DEFAULT_TIME_ZONE,
  formatTaskKey,
  fromCalendarDate,
  isValidTimeZone,
  type ProjectActor,
  type ProjectResult,
  parseCalendarDate,
  RANK_MAX,
  RECURRENCE_RULES,
  type RecurrenceRule,
  TIME_ZONE_MAX_LENGTH,
  toCalendarDate,
} from "./contract";
import { issueTaskKeyInTx, nextTaskNumberInTx } from "./keys";
import { appendRank, rebalancedRanks } from "./rank";
import { initialAnchor, nextOccurrence, occurrenceBase, successorDates } from "./recurrence-rules";
import { afterLock, newBatchId, type ProjectDb, refuse, runProjectTransaction } from "./service";

type ActivityRecord = Record<string, ActivityScalar>;

const calendarOrNull = (value: Date | null): CalendarDate | null =>
  value ? toCalendarDate(value) : null;

const dateOrNull = (value: CalendarDate | null): Date | null =>
  value ? fromCalendarDate(value) : null;

/**
 * Runs a pure date rule and maps its RangeError (a result after 2999-12-31, or a clock outside the
 * supported range) to the typed refusal INVALID_DATE_RANGE. Any other error is rethrown.
 */
function withinCalendarRange<T>(rule: () => T): T {
  try {
    return rule();
  } catch (err) {
    if (err instanceof RangeError) refuse("INVALID_DATE_RANGE");
    throw err;
  }
}

function validVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    refuse("INVALID_INPUT", "expectedVersion");
  }
  return raw;
}

function validClock(now: unknown): Date {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) refuse("INVALID_INPUT", "now");
  return now;
}

/**
 * A stale version or a conditional update's miss, classified by an explicit re-read through the
 * read predicate (contract section 14): gone or unreadable NOT_FOUND, archived ARCHIVED, else
 * CONFLICT.
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

const RECURRENCE_ROW_SELECT = {
  id: true,
  projectId: true,
  parentId: true,
  startDate: true,
  dueDate: true,
  version: true,
  recurrenceRule: true,
  recurrenceAnchor: true,
  recurrenceTimeZone: true,
} as const;

type RecurrenceRow = Prisma.TaskGetPayload<{ select: typeof RECURRENCE_ROW_SELECT }>;

function recurrenceValues(row: {
  recurrenceRule: string | null;
  recurrenceAnchor: CalendarDate | null;
  recurrenceTimeZone: string | null;
}): ActivityRecord {
  return {
    recurrenceRule: row.recurrenceRule,
    recurrenceAnchor: row.recurrenceAnchor,
    recurrenceTimeZone: row.recurrenceTimeZone,
  };
}

/**
 * The shared skeleton of setTaskRecurrence and clearTaskRecurrence (CONTENT, PROJECT_SHARE): the
 * task FOR UPDATE through requireTask (a subtask's parent FOR SHARE first), afterLock, the clock
 * read once, a stale version classified, then `plan` computes the new recurrence columns; the
 * same values again are { changed: false }; otherwise a conditional update on (id,
 * organizationId, version) increments version and one TASK_UPDATED row carries the changed
 * recurrence keys only.
 */
async function editRecurrence(
  actor: ProjectActor,
  operation: "setTaskRecurrence" | "clearTaskRecurrence",
  taskId: string,
  expectedVersionRaw: unknown,
  nowRaw: Date | undefined,
  plan: (
    row: RecurrenceRow,
    now: Date,
  ) => {
    recurrenceRule: RecurrenceRule | null;
    recurrenceAnchor: CalendarDate | null;
    recurrenceTimeZone: string | null;
  },
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, operation, async (tx) => {
    const expectedVersion = validVersion(expectedVersionRaw);
    const access = await requireTask(tx, actor, taskId, {
      lock: "share",
      level: "CONTENT",
      taskLock: "update",
    });
    await afterLock(tx, operation);
    const now = validClock(nowRaw ?? new Date());
    const row = await tx.task.findFirst({
      where: { id: taskId, organizationId: actor.orgId, projectId: access.task.projectId },
      select: RECURRENCE_ROW_SELECT,
    });
    if (!row) refuse("NOT_FOUND");
    if (row.version !== expectedVersion) await classifyTaskMiss(tx, actor, taskId);
    const next = plan(row, now);
    const diff = changedValues(
      recurrenceValues({
        recurrenceRule: row.recurrenceRule,
        recurrenceAnchor: calendarOrNull(row.recurrenceAnchor),
        recurrenceTimeZone: row.recurrenceTimeZone,
      }),
      recurrenceValues(next),
    );
    if (!diff) return { changed: false };
    const updated = await tx.task.updateMany({
      where: { id: taskId, organizationId: actor.orgId, version: expectedVersion },
      data: {
        recurrenceRule: next.recurrenceRule,
        recurrenceAnchor: dateOrNull(next.recurrenceAnchor),
        recurrenceTimeZone: next.recurrenceTimeZone,
        version: { increment: 1 },
      },
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

export interface TaskRecurrenceInput {
  rule: RecurrenceRule;
  /** The series anchor; absent or null: the due date, else the start date, else today in the zone. */
  anchorDate?: CalendarDate | null;
  /** An IANA time zone name of at most 64 characters; absent or null: UTC. */
  timeZone?: string | null;
}

/**
 * Sets the recurrence of a top-level task (CONTENT, PROJECT_SHARE; contract section 7). A subtask
 * is RECURRENCE_ON_SUBTASK; a rule outside RECURRENCE_RULES is INVALID_INPUT (field rule); a zone
 * Intl does not accept is INVALID_INPUT (field timeZone); a malformed anchorDate is INVALID_INPUT
 * (field anchorDate). The anchor is the given anchorDate, else the due date, else the start date,
 * else today in the series time zone at opts.now. The same values again are { changed: false };
 * otherwise one TASK_UPDATED row with the changed recurrence keys.
 */
export async function setTaskRecurrence(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
  input: TaskRecurrenceInput,
  opts: { now?: Date } = {},
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return editRecurrence(
    actor,
    "setTaskRecurrence",
    taskId,
    expectedVersion,
    opts?.now,
    (row, now) => {
      if (row.parentId !== null) refuse("RECURRENCE_ON_SUBTASK");
      const value = (input ?? {}) as Partial<TaskRecurrenceInput>;
      if (!(RECURRENCE_RULES as readonly unknown[]).includes(value.rule)) {
        refuse("INVALID_INPUT", "rule");
      }
      const timeZone = value.timeZone ?? DEFAULT_TIME_ZONE;
      if (
        typeof timeZone !== "string" ||
        timeZone.length > TIME_ZONE_MAX_LENGTH ||
        !isValidTimeZone(timeZone)
      ) {
        refuse("INVALID_INPUT", "timeZone");
      }
      let anchorDate: CalendarDate | null = null;
      if (value.anchorDate !== undefined && value.anchorDate !== null) {
        anchorDate = parseCalendarDate(value.anchorDate);
        if (anchorDate === null) refuse("INVALID_INPUT", "anchorDate");
      }
      const anchor = withinCalendarRange(() =>
        initialAnchor(
          {
            anchorDate,
            dueDate: calendarOrNull(row.dueDate),
            startDate: calendarOrNull(row.startDate),
          },
          timeZone,
          now,
        ),
      );
      return {
        recurrenceRule: value.rule as RecurrenceRule,
        recurrenceAnchor: anchor,
        recurrenceTimeZone: timeZone,
      };
    },
  );
}

/**
 * Removes the recurrence of a task (CONTENT, PROJECT_SHARE). A task without a rule is
 * { changed: false }; otherwise one TASK_UPDATED row. A later completion creates nothing.
 */
export async function clearTaskRecurrence(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return editRecurrence(actor, "clearTaskRecurrence", taskId, expectedVersion, undefined, () => ({
    recurrenceRule: null,
    recurrenceAnchor: null,
    recurrenceTimeZone: null,
  }));
}

// ---------------------------------------------------------------------------------------------
// The successor (contract sections 5, 7 and 8)

interface ClaimedRow {
  id: string;
  projectId: string;
  key: string;
  title: string;
  descriptionMarkdown: string | null;
  priority: string;
  assigneeUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  recurrenceRule: string;
  recurrenceAnchor: string;
  recurrenceTimeZone: string;
}

/**
 * The rank that appends a task to the TODO group of the project (contract section 8): the
 * group's largest rank plus RANK_GAP, read with an explicit organization term; when that would
 * pass RANK_MAX the group is renumbered to (i + 1) * RANK_GAP in (rank, id) order first. The
 * rebalance is allowed because every caller of applyStatusChangeInTx holds the project FOR UPDATE.
 */
async function appendToTodoGroupInTx(
  tx: ProjectDb,
  orgId: string,
  projectId: string,
): Promise<number> {
  const where: Prisma.TaskWhereInput = {
    organizationId: orgId,
    projectId,
    parentId: null,
    status: "TODO",
  };
  const max = await tx.task.aggregate({ where, _max: { rank: true } });
  const next = appendRank(max._max.rank ?? null);
  if (next !== null) return next;
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

export interface SpawnSuccessorParams {
  orgId: string;
  actorUserId: string;
  task: { id: string };
  /** The clock the calling service read once after its locks. */
  now: Date;
  /** The batch id of the completing mutation (shared with its TASK_STATUS_CHANGED row). */
  batchId: string;
}

/**
 * Creates the next occurrence of a recurring task that the caller has just moved into DONE, in
 * the caller's transaction (the project FOR UPDATE and the task FOR UPDATE are already held).
 * First a conditional update sets recurrenceSpawned true where it is false (and the task is a
 * top-level task with a rule); no row means no successor is due and null is returned. Then: the
 * base date (due, else start, else today in the series time zone at `now`), the next sequence date
 * strictly after it, the successor's dates, the assignee only when still eligible, the rank
 * appended to the TODO group, the number from the counter and its key, the Task row with
 * recurrencePredecessorId, the copied TaskLabel rows, the ACTIVE TaskKey row and one TASK_RECURRED
 * row (entity the successor, same batch id, actor the completing user). A next date after
 * 2999-12-31 is the refusal INVALID_DATE_RANGE, which rolls back the whole completion.
 */
export async function spawnRecurrenceSuccessorInTx(
  tx: ProjectDb,
  params: SpawnSuccessorParams,
): Promise<{ taskId: string; key: string } | null> {
  const { orgId } = params;
  const claimed = await tx.$queryRaw<ClaimedRow[]>`
    UPDATE "Task" SET "recurrenceSpawned" = true
    WHERE "id" = ${params.task.id} AND "organizationId" = ${orgId}
      AND "recurrenceSpawned" = false AND "recurrenceRule" IS NOT NULL AND "parentId" IS NULL
    RETURNING "id", "projectId", "key", "title", "descriptionMarkdown", "priority"::text AS "priority",
      "assigneeUserId", "startDate"::text AS "startDate", "dueDate"::text AS "dueDate",
      "estimateMinutes", "recurrenceRule"::text AS "recurrenceRule",
      "recurrenceAnchor"::text AS "recurrenceAnchor", "recurrenceTimeZone"`;
  const predecessor = claimed[0];
  if (!predecessor) return null;

  const rule = predecessor.recurrenceRule as RecurrenceRule;
  const dates = withinCalendarRange(() => {
    const base = occurrenceBase(
      { dueDate: predecessor.dueDate, startDate: predecessor.startDate },
      predecessor.recurrenceTimeZone,
      params.now,
    );
    const next = nextOccurrence(predecessor.recurrenceAnchor, rule, base);
    return successorDates({ dueDate: predecessor.dueDate, startDate: predecessor.startDate }, next);
  });

  const projectId = predecessor.projectId;
  const assigneeUserId =
    predecessor.assigneeUserId !== null &&
    (await isEligibleAssignee(tx, orgId, projectId, predecessor.assigneeUserId))
      ? predecessor.assigneeUserId
      : null;
  const project = await tx.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { keyPrefix: true },
  });
  if (!project) refuse("NOT_FOUND");
  const labels = await tx.taskLabel.findMany({
    where: { organizationId: orgId, projectId, taskId: predecessor.id },
    orderBy: { labelId: "asc" },
    select: { labelId: true },
  });

  // Lock order (contract section 3): task rows (the rank group) before the counter and the keys.
  const rank = await appendToTodoGroupInTx(tx, orgId, projectId);
  const taskNumber = await nextTaskNumberInTx(tx, orgId, projectId);
  const key = formatTaskKey(project.keyPrefix, taskNumber);
  const successor = await tx.task.create({
    data: {
      organizationId: orgId,
      projectId,
      parentId: null,
      number: taskNumber,
      key,
      title: predecessor.title,
      descriptionMarkdown: predecessor.descriptionMarkdown,
      status: "TODO",
      priority: predecessor.priority as Prisma.TaskCreateManyInput["priority"],
      assigneeUserId,
      createdByUserId: params.actorUserId,
      startDate: dateOrNull(dates.startDate),
      dueDate: dateOrNull(dates.dueDate),
      estimateMinutes: predecessor.estimateMinutes,
      milestoneId: null,
      rank,
      recurrenceRule: rule,
      recurrenceAnchor: fromCalendarDate(predecessor.recurrenceAnchor),
      recurrenceTimeZone: predecessor.recurrenceTimeZone,
      recurrencePredecessorId: predecessor.id,
    },
    select: { id: true },
  });
  if (labels.length > 0) {
    await tx.taskLabel.createMany({
      data: labels.map((label) => ({
        organizationId: orgId,
        projectId,
        taskId: successor.id,
        labelId: label.labelId,
      })),
    });
  }
  await issueTaskKeyInTx(tx, {
    orgId,
    projectId,
    taskId: successor.id,
    prefix: project.keyPrefix,
    number: taskNumber,
  });
  await recordProjectActivity(tx, {
    orgId,
    projectId,
    taskId: successor.id,
    actorUserId: params.actorUserId,
    verb: "TASK_RECURRED",
    entityType: "TASK",
    entityId: successor.id,
    before: null,
    after: {
      predecessorTaskId: predecessor.id,
      predecessorTaskKey: predecessor.key,
      key,
      startDate: dates.startDate,
      dueDate: dates.dueDate,
    },
    batchId: params.batchId,
  });
  return { taskId: successor.id, key };
}
