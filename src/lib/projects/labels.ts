// Phase 14 project labels (contract sections 1, 5, 14 and 15; C4, AIDA-65).
// Relative imports only, no Next.js import (the worker reaches these modules too).
//
// Labels belong to one project; names are unique case-insensitively per project (the lower(name)
// index, NAME_TAKEN). Managing labels is MANAGE under PROJECT_UPDATE: createLabel inserts with
// INSERT ... ON CONFLICT DO NOTHING and re-reads; updateLabel checks a clash under the project's
// FOR UPDATE lock (every label write of the project serializes on it) and the index stays the
// database fence; deleteLabel removes the label's task links first (C4) and writes one
// LABEL_DELETED row with affectedTaskCount. setTaskLabels is CONTENT under PROJECT_SHARE with the
// task FOR UPDATE and a conditional update on the task version (TASK_UPDATED with labelNames).
import { randomUUID } from "node:crypto";
import { readableProjectWhere, requireMembership, requireProject, requireTask } from "./access";
import { changedValues, recordProjectActivity } from "./activity";
import { validVersion } from "./comments";
import {
  codePointLength,
  DEFAULT_LABEL_COLOR,
  hasNul,
  LABEL_NAME_MAX,
  MAX_TASK_LABELS,
  PROJECT_COLORS,
  type ProjectActor,
  type ProjectColor,
  type ProjectResult,
} from "./contract";
import {
  afterLock,
  isPlausibleId,
  newBatchId,
  type ProjectDb,
  refuse,
  runProjectRead,
  runProjectTransaction,
} from "./service";

export interface LabelView {
  id: string;
  name: string;
  color: string;
}

const LABEL_SELECT = { id: true, name: true, color: true } as const;

function validName(raw: unknown, max: number, field = "name"): string {
  if (typeof raw !== "string" || hasNul(raw)) refuse("INVALID_INPUT", field);
  const name = raw.trim();
  const length = codePointLength(name);
  if (length < 1 || length > max) refuse("INVALID_INPUT", field);
  return name;
}

function validColor(raw: unknown): ProjectColor {
  if (typeof raw !== "string" || !(PROJECT_COLORS as readonly string[]).includes(raw)) {
    refuse("INVALID_INPUT", "color");
  }
  return raw as ProjectColor;
}

/** Plain code-unit order (never localeCompare). */
function codeUnitSort(values: string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A stale task version or a conditional update's miss, classified by an explicit re-read through
 * the read predicate (contract section 14): gone or unreadable NOT_FOUND, archived (the task, its
 * parent or its project) ARCHIVED, else CONFLICT.
 */
export async function classifyTaskMissInTx(
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

/**
 * The labels of that project for the given ids (deduplicated, in the given order), or
 * INVALID_INPUT field labelIds when any id is malformed or not a label of the project. Plans
 * 14-11 and 14-12 import it.
 */
export async function resolveProjectLabelIdsInTx(
  tx: ProjectDb,
  orgId: string,
  projectId: string,
  labelIds: readonly unknown[],
): Promise<LabelView[]> {
  const ids: string[] = [];
  for (const id of labelIds) {
    if (!isPlausibleId(id)) refuse("INVALID_INPUT", "labelIds");
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return [];
  const rows = await tx.projectLabel.findMany({
    where: { organizationId: orgId, projectId, id: { in: ids } },
    select: LABEL_SELECT,
  });
  if (rows.length !== ids.length) refuse("INVALID_INPUT", "labelIds");
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id) as LabelView);
}

/** READ: the project's labels by name, then id. */
export async function listLabels(
  actor: ProjectActor,
  projectId: string,
): Promise<ProjectResult<{ labels: LabelView[] }>> {
  return runProjectRead(actor, "listLabels", async (db) => {
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    const labels = await db.projectLabel.findMany({
      where: { organizationId: actor.orgId, projectId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: LABEL_SELECT,
    });
    return { labels };
  });
}

/** MANAGE under PROJECT_UPDATE: creates a label (color gray by default), LABEL_CREATED. */
export async function createLabel(
  actor: ProjectActor,
  projectId: string,
  input: { name: unknown; color?: unknown },
): Promise<ProjectResult<{ label: LabelView }>> {
  return runProjectTransaction(actor, "createLabel", async (tx) => {
    const name = validName(input?.name, LABEL_NAME_MAX);
    const color = input?.color === undefined ? DEFAULT_LABEL_COLOR : validColor(input.color);
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "createLabel");
    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "ProjectLabel" (id, "organizationId", "projectId", name, color, "updatedAt")
      VALUES (${id}, ${actor.orgId}, ${projectId}, ${name}, ${color}, now())
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      const clash = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "ProjectLabel"
        WHERE "organizationId" = ${actor.orgId} AND "projectId" = ${projectId}
          AND lower(name) = lower(${name})
      `;
      if (clash.length > 0) refuse("NAME_TAKEN");
      throw new Error("createLabel: insert refused without a name clash");
    }
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "LABEL_CREATED",
      entityType: "LABEL",
      entityId: id,
      after: { labelId: id, name, color },
      batchId: newBatchId(),
    });
    return { label: { id, name, color } };
  });
}

async function labelProject(tx: ProjectDb, actor: ProjectActor, labelId: string): Promise<string> {
  await requireMembership(tx, actor);
  if (!isPlausibleId(labelId)) refuse("NOT_FOUND");
  const row = await tx.projectLabel.findFirst({
    where: { id: labelId, organizationId: actor.orgId },
    select: { projectId: true },
  });
  return row ? row.projectId : refuse("NOT_FOUND");
}

/** MANAGE under PROJECT_UPDATE: renames or recolors a label, LABEL_UPDATED with changed keys. */
export async function updateLabel(
  actor: ProjectActor,
  labelId: string,
  patch: { name?: unknown; color?: unknown },
): Promise<ProjectResult<{ changed: boolean; label?: LabelView }>> {
  return runProjectTransaction(actor, "updateLabel", async (tx) => {
    const name = patch?.name === undefined ? undefined : validName(patch.name, LABEL_NAME_MAX);
    const color = patch?.color === undefined ? undefined : validColor(patch.color);
    const projectId = await labelProject(tx, actor, labelId);
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "updateLabel");
    const current = await tx.projectLabel.findFirst({
      where: { id: labelId, organizationId: actor.orgId, projectId },
      select: LABEL_SELECT,
    });
    if (!current) refuse("NOT_FOUND");
    const next = { name: name ?? current.name, color: color ?? current.color };
    const diff = changedValues(
      { name: current.name, color: current.color },
      { name: next.name, color: next.color },
    );
    if (!diff) return { changed: false };
    if (next.name.toLowerCase() !== current.name.toLowerCase()) {
      const clash = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "ProjectLabel"
        WHERE "organizationId" = ${actor.orgId} AND "projectId" = ${projectId}
          AND lower(name) = lower(${next.name}) AND id <> ${labelId}
      `;
      if (clash.length > 0) refuse("NAME_TAKEN");
    }
    await tx.projectLabel.updateMany({
      where: { id: labelId, organizationId: actor.orgId, projectId },
      data: next,
    });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "LABEL_UPDATED",
      entityType: "LABEL",
      entityId: labelId,
      before: diff.before,
      after: diff.after,
      batchId: newBatchId(),
    });
    return { changed: true, label: { id: labelId, ...next } };
  });
}

/** MANAGE under PROJECT_UPDATE: removes the label's task links first (C4), then the label. */
export async function deleteLabel(
  actor: ProjectActor,
  labelId: string,
): Promise<ProjectResult<{ affectedTaskCount: number }>> {
  return runProjectTransaction(actor, "deleteLabel", async (tx) => {
    const projectId = await labelProject(tx, actor, labelId);
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "deleteLabel");
    const current = await tx.projectLabel.findFirst({
      where: { id: labelId, organizationId: actor.orgId, projectId },
      select: LABEL_SELECT,
    });
    if (!current) refuse("NOT_FOUND");
    const links = await tx.taskLabel.deleteMany({
      where: { organizationId: actor.orgId, projectId, labelId },
    });
    await tx.projectLabel.deleteMany({
      where: { id: labelId, organizationId: actor.orgId, projectId },
    });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "LABEL_DELETED",
      entityType: "LABEL",
      entityId: labelId,
      before: { labelId, name: current.name, color: current.color },
      after: { affectedTaskCount: links.count },
      batchId: newBatchId(),
    });
    return { affectedTaskCount: links.count };
  });
}

/**
 * CONTENT under PROJECT_SHARE: replaces the task's labels (at most MAX_TASK_LABELS, labels of the
 * task's project only) when expectedVersion is current; TASK_UPDATED with labelNames before and
 * after; the same set is { changed: false }.
 */
export async function setTaskLabels(
  actor: ProjectActor,
  taskId: string,
  expectedVersion: number,
  labelIds: readonly string[],
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, "setTaskLabels", async (tx) => {
    const version = validVersion(expectedVersion);
    if (!Array.isArray(labelIds)) refuse("INVALID_INPUT", "labelIds");
    if (new Set(labelIds).size > MAX_TASK_LABELS) refuse("TOO_MANY");
    const access = await requireTask(tx, actor, taskId, {
      lock: "share",
      level: "CONTENT",
      taskLock: "update",
    });
    await afterLock(tx, "setTaskLabels");
    const projectId = access.task.projectId;
    const task = await tx.task.findFirst({
      where: { id: taskId, organizationId: actor.orgId, projectId },
      select: { version: true },
    });
    if (!task) refuse("NOT_FOUND");
    if (task.version !== version) await classifyTaskMissInTx(tx, actor, taskId);
    const wanted = await resolveProjectLabelIdsInTx(tx, actor.orgId, projectId, labelIds);
    const current = await tx.taskLabel.findMany({
      where: { organizationId: actor.orgId, projectId, taskId },
      select: { labelId: true, label: { select: { name: true } } },
    });
    const wantedIds = new Set(wanted.map((label) => label.id));
    const currentIds = new Set(current.map((link) => link.labelId));
    const removed = [...currentIds].filter((id) => !wantedIds.has(id));
    const added = [...wantedIds].filter((id) => !currentIds.has(id));
    if (removed.length === 0 && added.length === 0) return { changed: false };
    const updated = await tx.task.updateMany({
      where: { id: taskId, organizationId: actor.orgId, version },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1) await classifyTaskMissInTx(tx, actor, taskId);
    if (removed.length > 0) {
      await tx.taskLabel.deleteMany({
        where: { organizationId: actor.orgId, projectId, taskId, labelId: { in: removed } },
      });
    }
    if (added.length > 0) {
      await tx.taskLabel.createMany({
        data: added.map((labelId) => ({ organizationId: actor.orgId, projectId, taskId, labelId })),
      });
    }
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      taskId,
      actorUserId: actor.userId,
      verb: "TASK_UPDATED",
      entityType: "TASK",
      entityId: taskId,
      before: { labelNames: codeUnitSort(current.map((link) => link.label.name)) },
      after: { labelNames: codeUnitSort(wanted.map((label) => label.name)) },
      batchId: newBatchId(),
    });
    return { changed: true, version: version + 1 };
  });
}
