// Phase 14 project milestones (contract sections 1, 5, 7, 14 and 15; C4, AIDA-105).
// Relative imports only, no Next.js import (the worker reaches these modules too).
//
// Milestones belong to one project, carry a calendar date (CalendarDate strings across the
// boundary, @db.Date in storage) and have case-insensitively unique names per project
// (NAME_TAKEN). Managing them is MANAGE under PROJECT_UPDATE: createMilestone inserts with
// INSERT ... ON CONFLICT DO NOTHING and re-reads; updateMilestone is a conditional update on
// (id, organizationId, version) with the miss classified (contract section 14); deleteMilestone
// clears the milestone of its tasks first (C4; their version increments) and writes one
// MILESTONE_DELETED row with affectedTaskCount. setTaskMilestone is CONTENT under PROJECT_SHARE
// with the task FOR UPDATE and a conditional update on the task version. The two reads serve the
// later Timeline (AIDA-78) and overview (AIDA-107).
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { readableProjectWhere, requireMembership, requireProject, requireTask } from "./access";
import { changedValues, recordProjectActivity } from "./activity";
import { validVersion } from "./comments";
import {
  type CalendarDate,
  codePointLength,
  fromCalendarDate,
  hasNul,
  MILESTONE_DESCRIPTION_MAX,
  MILESTONE_NAME_MAX,
  type ProjectActor,
  type ProjectResult,
  parseCalendarDate,
  toCalendarDate,
} from "./contract";
import { classifyTaskMissInTx } from "./labels";
import {
  afterLock,
  decodeKeyset,
  encodeKeyset,
  isPlausibleId,
  type ListPageOpts,
  listLimit,
  newBatchId,
  type ProjectDb,
  refuse,
  runProjectRead,
  runProjectTransaction,
} from "./service";

export interface MilestoneView {
  id: string;
  projectId: string;
  name: string;
  descriptionMarkdown: string | null;
  date: CalendarDate;
  version: number;
}

function validName(raw: unknown): string {
  if (typeof raw !== "string" || hasNul(raw)) refuse("INVALID_INPUT", "name");
  const name = raw.trim();
  const length = codePointLength(name);
  if (length < 1 || length > MILESTONE_NAME_MAX) refuse("INVALID_INPUT", "name");
  return name;
}

function validDate(raw: unknown, field = "date"): CalendarDate {
  return parseCalendarDate(raw) ?? refuse("INVALID_INPUT", field);
}

function validDescription(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || hasNul(raw)) refuse("INVALID_INPUT", "description");
  const text = raw.trim();
  if (codePointLength(text) > MILESTONE_DESCRIPTION_MAX) refuse("INVALID_INPUT", "description");
  return text === "" ? null : text;
}

const MILESTONE_SELECT = {
  id: true,
  projectId: true,
  name: true,
  descriptionMarkdown: true,
  date: true,
  version: true,
} as const;

function view(row: {
  id: string;
  projectId: string;
  name: string;
  descriptionMarkdown: string | null;
  date: Date;
  version: number;
}): MilestoneView {
  return { ...row, date: toCalendarDate(row.date) };
}

// ---------------------------------------------------------------------------------------------
// Reads

/** Keyset (date, id) after a cursor of [CalendarDate, id] (review b-WR-05). */
function dateKeysetWhere(cursor: (string | number)[] | null): Prisma.ProjectMilestoneWhereInput {
  if (!cursor) return {};
  const [rawDate, id] = cursor as [string, string];
  const parsed = parseCalendarDate(rawDate);
  if (parsed === null) refuse("INVALID_INPUT", "cursor");
  const date = fromCalendarDate(parsed);
  return { OR: [{ date: { gt: date } }, { date, id: { gt: id } }] };
}

function dateCursor(hasMore: boolean, rows: readonly { id: string; date: Date }[]): string | null {
  const last = rows[rows.length - 1];
  return hasMore && last ? encodeKeyset([toCalendarDate(last.date), last.id]) : null;
}

/** READ: the project's milestones by date, with task and done counts (non-archived tasks). */
export async function listProjectMilestones(
  actor: ProjectActor,
  projectId: string,
  opts: ListPageOpts = {},
): Promise<
  ProjectResult<{
    milestones: (MilestoneView & { taskCount: number; doneCount: number })[];
    hasMore: boolean;
    nextCursor: string | null;
  }>
> {
  return runProjectRead(actor, "listProjectMilestones", async (db) => {
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    const limit = listLimit(opts?.limit);
    const cursor = decodeKeyset(opts?.cursor, ["string", "string"]);
    const found = await db.projectMilestone.findMany({
      where: { AND: [{ organizationId: actor.orgId, projectId }, dateKeysetWhere(cursor)] },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: MILESTONE_SELECT,
    });
    const hasMore = found.length > limit;
    const rows = found.slice(0, limit);
    const counts = new Map<string, { taskCount: number; doneCount: number }>();
    if (rows.length > 0) {
      const groups = await db.task.groupBy({
        by: ["milestoneId", "status"],
        where: {
          organizationId: actor.orgId,
          projectId,
          archivedAt: null,
          milestoneId: { in: rows.map((row) => row.id) },
        },
        _count: { _all: true },
      });
      for (const group of groups) {
        if (!group.milestoneId) continue;
        const entry = counts.get(group.milestoneId) ?? { taskCount: 0, doneCount: 0 };
        entry.taskCount += group._count._all;
        if (group.status === "DONE") entry.doneCount += group._count._all;
        counts.set(group.milestoneId, entry);
      }
    }
    return {
      milestones: rows.map((row) => ({
        ...view(row),
        ...(counts.get(row.id) ?? { taskCount: 0, doneCount: 0 }),
      })),
      hasMore,
      nextCursor: dateCursor(hasMore, rows),
    };
  });
}

/**
 * READ (LIST): dated milestones of readable, non-archived projects between from and to
 * (inclusive, both optional), by date then id, keyset-paged (review b-WR-05).
 */
export async function listWorkspaceMilestones(
  actor: ProjectActor,
  opts: { from?: string; to?: string } & ListPageOpts = {},
): Promise<
  ProjectResult<{
    milestones: (MilestoneView & { projectName: string })[];
    hasMore: boolean;
    nextCursor: string | null;
  }>
> {
  return runProjectRead(actor, "listWorkspaceMilestones", async (db) => {
    const from = opts.from === undefined ? null : validDate(opts.from, "from");
    const to = opts.to === undefined ? null : validDate(opts.to, "to");
    if (from && to && from > to) refuse("INVALID_INPUT", "to");
    const date: Prisma.DateTimeFilter = {};
    if (from) date.gte = fromCalendarDate(from);
    if (to) date.lte = fromCalendarDate(to);
    const limit = listLimit(opts.limit);
    const cursor = decodeKeyset(opts.cursor, ["string", "string"]);
    const found = await db.projectMilestone.findMany({
      where: {
        AND: [
          {
            organizationId: actor.orgId,
            project: { AND: [readableProjectWhere(actor), { archivedAt: null }] },
            ...(from || to ? { date } : {}),
          },
          dateKeysetWhere(cursor),
        ],
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: { ...MILESTONE_SELECT, project: { select: { name: true } } },
    });
    const hasMore = found.length > limit;
    const rows = found.slice(0, limit);
    return {
      milestones: rows.map(({ project, ...row }) => ({ ...view(row), projectName: project.name })),
      hasMore,
      nextCursor: dateCursor(hasMore, rows),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Writes

async function milestoneProject(
  tx: ProjectDb,
  actor: ProjectActor,
  milestoneId: string,
): Promise<string> {
  await requireMembership(tx, actor);
  if (!isPlausibleId(milestoneId)) refuse("NOT_FOUND");
  const row = await tx.projectMilestone.findFirst({
    where: { id: milestoneId, organizationId: actor.orgId },
    select: { projectId: true },
  });
  return row ? row.projectId : refuse("NOT_FOUND");
}

async function nameClash(
  tx: ProjectDb,
  orgId: string,
  projectId: string,
  name: string,
  exceptId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "ProjectMilestone"
    WHERE "organizationId" = ${orgId} AND "projectId" = ${projectId}
      AND lower(name) = lower(${name}) AND id <> ${exceptId}
  `;
  return rows.length > 0;
}

/** MANAGE under PROJECT_UPDATE: creates a dated milestone, MILESTONE_CREATED. */
export async function createMilestone(
  actor: ProjectActor,
  projectId: string,
  input: { name: unknown; date: unknown; description?: unknown },
): Promise<ProjectResult<{ milestone: MilestoneView }>> {
  return runProjectTransaction(actor, "createMilestone", async (tx) => {
    const name = validName(input?.name);
    const date = validDate(input?.date);
    const description =
      input?.description === undefined ? null : validDescription(input.description);
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "createMilestone");
    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "ProjectMilestone"
        (id, "organizationId", "projectId", name, "descriptionMarkdown", date, "updatedAt")
      VALUES (${id}, ${actor.orgId}, ${projectId}, ${name}, ${description}, ${date}::date, now())
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      if (await nameClash(tx, actor.orgId, projectId, name, id)) refuse("NAME_TAKEN");
      throw new Error("createMilestone: insert refused without a name clash");
    }
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "MILESTONE_CREATED",
      entityType: "MILESTONE",
      entityId: id,
      after: { milestoneId: id, name, date },
      batchId: newBatchId(),
    });
    return {
      milestone: { id, projectId, name, descriptionMarkdown: description, date, version: 0 },
    };
  });
}

/**
 * A stale milestone version or a conditional update's miss (contract section 14): gone or
 * unreadable NOT_FOUND, archived project ARCHIVED, else CONFLICT.
 */
async function classifyMilestoneMiss(
  tx: ProjectDb,
  actor: ProjectActor,
  milestoneId: string,
): Promise<never> {
  const row = await tx.projectMilestone.findFirst({
    where: { id: milestoneId, organizationId: actor.orgId, project: readableProjectWhere(actor) },
    select: { project: { select: { archivedAt: true } } },
  });
  if (!row) refuse("NOT_FOUND");
  if (row.project.archivedAt) refuse("ARCHIVED");
  return refuse("CONFLICT");
}

/**
 * MANAGE under PROJECT_UPDATE: changes name, date or description when expectedVersion is current
 * (a conditional update on (id, organizationId, version)); MILESTONE_UPDATED with the changed keys
 * (a description change is descriptionChanged: true).
 */
export async function updateMilestone(
  actor: ProjectActor,
  milestoneId: string,
  expectedVersion: number,
  patch: { name?: unknown; date?: unknown; description?: unknown },
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, "updateMilestone", async (tx) => {
    const version = validVersion(expectedVersion);
    const name = patch?.name === undefined ? undefined : validName(patch.name);
    const date = patch?.date === undefined ? undefined : validDate(patch.date);
    const description =
      patch?.description === undefined ? undefined : validDescription(patch.description);
    const projectId = await milestoneProject(tx, actor, milestoneId);
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "updateMilestone");
    const current = await tx.projectMilestone.findFirst({
      where: { id: milestoneId, organizationId: actor.orgId, projectId },
      select: MILESTONE_SELECT,
    });
    if (!current) refuse("NOT_FOUND");
    if (current.version !== version) await classifyMilestoneMiss(tx, actor, milestoneId);
    const before = view(current);
    const next = {
      name: name ?? before.name,
      date: date ?? before.date,
      descriptionMarkdown: description === undefined ? before.descriptionMarkdown : description,
    };
    const descriptionChanged = next.descriptionMarkdown !== before.descriptionMarkdown;
    const diff = changedValues(
      { name: before.name, date: before.date, descriptionChanged: false },
      { name: next.name, date: next.date, descriptionChanged },
    );
    if (!diff) return { changed: false };
    if (
      next.name.toLowerCase() !== before.name.toLowerCase() &&
      (await nameClash(tx, actor.orgId, projectId, next.name, milestoneId))
    ) {
      refuse("NAME_TAKEN");
    }
    const updated = await tx.projectMilestone.updateMany({
      where: { id: milestoneId, organizationId: actor.orgId, version },
      data: {
        name: next.name,
        date: fromCalendarDate(next.date),
        descriptionMarkdown: next.descriptionMarkdown,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) await classifyMilestoneMiss(tx, actor, milestoneId);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "MILESTONE_UPDATED",
      entityType: "MILESTONE",
      entityId: milestoneId,
      before: diff.before,
      after: diff.after,
      batchId: newBatchId(),
    });
    return { changed: true, version: version + 1 };
  });
}

/**
 * MANAGE under PROJECT_UPDATE: clears the milestone of its tasks first (C4; their version
 * increments), deletes it and writes one MILESTONE_DELETED row with affectedTaskCount.
 */
export async function deleteMilestone(
  actor: ProjectActor,
  milestoneId: string,
): Promise<ProjectResult<{ affectedTaskCount: number }>> {
  return runProjectTransaction(actor, "deleteMilestone", async (tx) => {
    const projectId = await milestoneProject(tx, actor, milestoneId);
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "deleteMilestone");
    const current = await tx.projectMilestone.findFirst({
      where: { id: milestoneId, organizationId: actor.orgId, projectId },
      select: MILESTONE_SELECT,
    });
    if (!current) refuse("NOT_FOUND");
    const cleared = await tx.task.updateMany({
      where: { organizationId: actor.orgId, projectId, milestoneId },
      data: { milestoneId: null, version: { increment: 1 } },
    });
    await tx.projectMilestone.deleteMany({
      where: { id: milestoneId, organizationId: actor.orgId, projectId },
    });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "MILESTONE_DELETED",
      entityType: "MILESTONE",
      entityId: milestoneId,
      before: { milestoneId, name: current.name, date: toCalendarDate(current.date) },
      after: { affectedTaskCount: cleared.count },
      batchId: newBatchId(),
    });
    return { affectedTaskCount: cleared.count };
  });
}

/**
 * CONTENT under PROJECT_SHARE: sets (a milestone of the task's project) or clears (null) the
 * task's milestone when expectedVersion is current; TASK_UPDATED with milestoneId.
 */
export async function setTaskMilestone(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
  milestoneId: string | null,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, "setTaskMilestone", async (tx) => {
    const version = validVersion(expectedVersion);
    if (milestoneId !== null && !isPlausibleId(milestoneId)) refuse("INVALID_INPUT", "milestoneId");
    const access = await requireTask(tx, actor, taskId, {
      lock: "share",
      level: "CONTENT",
      taskLock: "update",
    });
    await afterLock(tx, "setTaskMilestone");
    const projectId = access.task.projectId;
    const task = await tx.task.findFirst({
      where: { id: taskId, organizationId: actor.orgId, projectId },
      select: { version: true, milestoneId: true },
    });
    if (!task) refuse("NOT_FOUND");
    if (task.version !== version) await classifyTaskMissInTx(tx, actor, taskId);
    if (milestoneId !== null) {
      const milestone = await tx.projectMilestone.findFirst({
        where: { id: milestoneId, organizationId: actor.orgId, projectId },
        select: { id: true },
      });
      if (!milestone) refuse("INVALID_INPUT", "milestoneId");
    }
    if (task.milestoneId === milestoneId) return { changed: false };
    const updated = await tx.task.updateMany({
      where: { id: taskId, organizationId: actor.orgId, version },
      data: { milestoneId, version: { increment: 1 } },
    });
    if (updated.count !== 1) await classifyTaskMissInTx(tx, actor, taskId);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      taskId,
      actorUserId: actor.userId,
      verb: "TASK_UPDATED",
      entityType: "TASK",
      entityId: taskId,
      before: { milestoneId: task.milestoneId },
      after: { milestoneId },
      batchId: newBatchId(),
    });
    return { changed: true, version: version + 1 };
  });
}
