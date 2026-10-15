// Phase 14: duplicating a task and a project (contract sections 1, 3, 5, 6, 8 and 11; D-13;
// reviews C1, C6, R2-1 and R3-2; AIDA-103, AIDA-104). Relative imports only, no Next.js import.
//
// duplicateTask (CONTENT, PROJECT_UPDATE, review C6): the project FOR UPDATE and the task through
// requireTask, then afterLock; the source and its non-archived subtasks are read after the lock.
// The copy goes directly after its source in the source's group: rankBetween(source rank, the
// next task's rank in (rank, id) order), or appendRank when the source is last; when that is null
// (adjacent integers, a tie, or past RANK_MAX) the group is renumbered with rebalancedRanks in
// (rank, id) order through raw updates (organization term, "updatedAt" = now()) and the rank is
// computed again. The copied subtasks get (i + 1) * RANK_GAP in the source subtasks' (rank, id)
// order. Copied: title, description, status, priority, dates, estimate, eligible assignee, labels
// and milestone. Never comments, attachments, activity, favorites or recurrence.
//
// duplicateProject (READ on the source, PROJECT_UPDATE on it, review R3-2; MEMBER to create): the
// source FOR UPDATE through requireProject at READ (an archived source is allowed), then afterLock,
// and only then every read of the source's labels, milestones, tasks and label links, so the copy
// reflects one committed state of the source (every content write of the source holds it at least
// FOR SHARE). The new project, its prefix reservation, its counter and the duplicating user's
// MANAGER row are written as createProject writes them; nobody else becomes a member.
//
// Activity (section 5): PROJECT_DUPLICATED on the copy (relatedProjectId the source, before the
// source side, after the copy side), TASK_DUPLICATED per created task (before the source task's
// projectId, taskId and taskKey, after the copy's projectId and taskKey; relatedProjectId the
// source project for a project duplicate, null for a task duplicate), one batch id per call. Each
// side is written whole, so redactActivityRow (activity.ts) can replace an unreadable side.
import type { Prisma } from "../../generated/prisma/client";
import { isEligibleAssignee, requireMembership, requireProject, requireTask } from "./access";
import { recordProjectActivity } from "./activity";
import {
  codePointLength,
  hasNul,
  normalizePrefix,
  PROJECT_NAME_MAX,
  type ProjectActor,
  type ProjectResult,
  RANK_GAP,
  RANK_MAX,
  TASK_STATUSES,
  type TaskStatus,
} from "./contract";
import { issueTaskKeyInTx, nextTaskNumberInTx } from "./keys";
import { appendRank, rankBetween, rebalancedRanks } from "./rank";
import { afterLock, newBatchId, type ProjectDb, refuse, runProjectTransaction } from "./service";

const COPY_SELECT = {
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
  milestoneId: true,
  rank: true,
  labels: { select: { labelId: true } },
} as const;

type CopySource = Prisma.TaskGetPayload<{ select: typeof COPY_SELECT }>;

function byRankThenId(a: { rank: number; id: string }, b: { rank: number; id: string }): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Cached eligibility of assignees in one project (C14, K69). */
function eligibilityOf(tx: ProjectDb, orgId: string, projectId: string) {
  const cache = new Map<string, boolean>();
  return async (userId: string | null): Promise<string | null> => {
    if (userId === null) return null;
    let ok = cache.get(userId);
    if (ok === undefined) {
      ok = await isEligibleAssignee(tx, orgId, projectId, userId);
      cache.set(userId, ok);
    }
    return ok ? userId : null;
  };
}

/** Inserts one copied task with its ACTIVE key and label links; returns its id and key. */
async function insertCopy(
  tx: ProjectDb,
  entry: {
    orgId: string;
    projectId: string;
    prefix: string;
    actorUserId: string;
    source: CopySource;
    parentId: string | null;
    rank: number;
    assigneeUserId: string | null;
    milestoneId: string | null;
    labelIds: readonly string[];
  },
): Promise<{ id: string; key: string }> {
  const number = await nextTaskNumberInTx(tx, entry.orgId, entry.projectId);
  const key = `${entry.prefix}-${number}`;
  const s = entry.source;
  const task = await tx.task.create({
    data: {
      organizationId: entry.orgId,
      projectId: entry.projectId,
      parentId: entry.parentId,
      number,
      key,
      title: s.title,
      descriptionMarkdown: s.descriptionMarkdown,
      status: s.status,
      priority: s.priority,
      assigneeUserId: entry.assigneeUserId,
      createdByUserId: entry.actorUserId,
      startDate: s.startDate,
      dueDate: s.dueDate,
      estimateMinutes: s.estimateMinutes,
      milestoneId: entry.milestoneId,
      rank: entry.rank,
    },
    select: { id: true },
  });
  await issueTaskKeyInTx(tx, {
    orgId: entry.orgId,
    projectId: entry.projectId,
    taskId: task.id,
    prefix: entry.prefix,
    number,
  });
  if (entry.labelIds.length > 0) {
    await tx.taskLabel.createMany({
      data: entry.labelIds.map((labelId) => ({
        organizationId: entry.orgId,
        projectId: entry.projectId,
        taskId: task.id,
        labelId,
      })),
    });
  }
  return { id: task.id, key };
}

// ---------------------------------------------------------------------------------------------
// duplicateTask

function groupWhere(orgId: string, source: CopySource): Prisma.TaskWhereInput {
  return source.parentId !== null
    ? { organizationId: orgId, projectId: source.projectId, parentId: source.parentId }
    : {
        organizationId: orgId,
        projectId: source.projectId,
        parentId: null,
        status: source.status,
      };
}

/** The copy's rank, directly after the source in (rank, id) order, or null to rebalance first. */
async function rankAfter(
  tx: ProjectDb,
  where: Prisma.TaskWhereInput,
  source: { id: string; rank: number },
): Promise<number | null> {
  const next = await tx.task.findFirst({
    where: {
      AND: [
        where,
        {
          OR: [{ rank: { gt: source.rank } }, { rank: source.rank, id: { gt: source.id } }],
        },
      ],
    },
    orderBy: [{ rank: "asc" }, { id: "asc" }],
    select: { rank: true },
  });
  return next ? rankBetween(source.rank, next.rank) : appendRank(source.rank);
}

/**
 * Duplicates a task and its non-archived subtasks within its project (CONTENT, PROJECT_UPDATE),
 * placing the copy directly after the source in its group.
 */
export async function duplicateTask(
  actor: ProjectActor,
  taskId: string,
): Promise<ProjectResult<{ taskId: string; key: string; subtaskCount: number }>> {
  return runProjectTransaction(actor, "duplicateTask", async (tx) => {
    const access = await requireTask(tx, actor, taskId, {
      lock: "update",
      level: "CONTENT",
      taskLock: "share",
    });
    await afterLock(tx, "duplicateTask");
    const projectId = access.task.projectId;
    const source = await tx.task.findFirst({
      where: { id: taskId, organizationId: actor.orgId, projectId },
      select: COPY_SELECT,
    });
    if (!source) refuse("NOT_FOUND");
    const subtasks =
      source.parentId === null
        ? await tx.task.findMany({
            where: {
              organizationId: actor.orgId,
              projectId,
              parentId: source.id,
              archivedAt: null,
            },
            orderBy: [{ rank: "asc" }, { id: "asc" }],
            select: COPY_SELECT,
          })
        : [];

    // Placement (review C6): rebalance the group when no integer rank fits.
    const where = groupWhere(actor.orgId, source);
    let rank = await rankAfter(tx, where, source);
    if (rank === null) {
      const members = await tx.task.findMany({
        where,
        orderBy: [{ rank: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      const ranks = rebalancedRanks(members.length);
      for (const [i, member] of members.entries()) {
        await tx.$executeRaw`
          UPDATE "Task" SET "rank" = ${ranks[i]}, "updatedAt" = now()
          WHERE "id" = ${member.id} AND "organizationId" = ${actor.orgId}`;
      }
      const position = members.findIndex((m) => m.id === source.id);
      rank = await rankAfter(tx, where, { id: source.id, rank: ranks[position] as number });
      if (rank === null) throw new Error("duplicateTask: no rank after a rebalance");
    }

    const prefix = access.project.keyPrefix;
    const eligible = eligibilityOf(tx, actor.orgId, projectId);
    const batchId = newBatchId();
    const created: { source: CopySource; id: string; key: string }[] = [];
    const copy = await insertCopy(tx, {
      orgId: actor.orgId,
      projectId,
      prefix,
      actorUserId: actor.userId,
      source,
      parentId: source.parentId,
      rank,
      assigneeUserId: await eligible(source.assigneeUserId),
      milestoneId: source.milestoneId,
      labelIds: source.labels.map((l) => l.labelId),
    });
    created.push({ source, ...copy });
    for (const [i, sub] of subtasks.entries()) {
      const subCopy = await insertCopy(tx, {
        orgId: actor.orgId,
        projectId,
        prefix,
        actorUserId: actor.userId,
        source: sub,
        parentId: copy.id,
        rank: (i + 1) * RANK_GAP,
        assigneeUserId: await eligible(sub.assigneeUserId),
        milestoneId: sub.milestoneId,
        labelIds: sub.labels.map((l) => l.labelId),
      });
      created.push({ source: sub, ...subCopy });
    }
    for (const entry of created) {
      await recordProjectActivity(tx, {
        orgId: actor.orgId,
        projectId,
        taskId: entry.id,
        actorUserId: actor.userId,
        verb: "TASK_DUPLICATED",
        entityType: "TASK",
        entityId: entry.id,
        before: { projectId, taskId: entry.source.id, taskKey: entry.source.key },
        after: { projectId, taskKey: entry.key },
        batchId,
      });
    }
    return { taskId: copy.id, key: copy.key, subtaskCount: subtasks.length };
  });
}

// ---------------------------------------------------------------------------------------------
// duplicateProject

export interface DuplicateProjectInput {
  name: string;
  keyPrefix: string;
  includeTasks: boolean;
}

function validName(raw: unknown): string {
  if (typeof raw !== "string" || hasNul(raw)) refuse("INVALID_INPUT", "name");
  const name = raw.trim();
  const length = codePointLength(name);
  if (length < 1 || length > PROJECT_NAME_MAX) refuse("INVALID_INPUT", "name");
  return name;
}

/**
 * Duplicates a project (READ on the source with the source FOR UPDATE, MEMBER to create): its
 * metadata, labels and milestones, and with includeTasks every non-archived task and its
 * non-archived subtasks. The duplicating user becomes the only member (MANAGER). The new prefix
 * must be free (PREFIX_TAKEN) and valid (PREFIX_INVALID).
 */
export async function duplicateProject(
  actor: ProjectActor,
  projectId: string,
  input: DuplicateProjectInput,
): Promise<ProjectResult<{ projectId: string; keyPrefix: string; taskCount: number }>> {
  return runProjectTransaction(actor, "duplicateProject", async (tx) => {
    await requireMembership(tx, actor);
    const name = validName(input?.name);
    const keyPrefix =
      typeof input?.keyPrefix === "string" && !hasNul(input.keyPrefix)
        ? normalizePrefix(input.keyPrefix)
        : null;
    if (keyPrefix === null) refuse("PREFIX_INVALID");
    if (typeof input?.includeTasks !== "boolean") refuse("INVALID_INPUT", "includeTasks");
    const access = await requireProject(tx, actor, projectId, { lock: "update", level: "READ" });
    await afterLock(tx, "duplicateProject");
    const org = actor.orgId;
    const src = access.project;

    // Reads of the source, all after its FOR UPDATE lock (review R3-2).
    const labels = await tx.projectLabel.findMany({
      where: { organizationId: org, projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, color: true },
    });
    const milestones = await tx.projectMilestone.findMany({
      where: { organizationId: org, projectId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true, name: true, descriptionMarkdown: true, date: true },
    });
    const tasks = input.includeTasks
      ? await tx.task.findMany({
          where: { organizationId: org, projectId, archivedAt: null },
          select: COPY_SELECT,
        })
      : [];

    // The new project as createProject writes it.
    const largest = await tx.project.aggregate({
      where: { organizationId: org },
      _max: { position: true },
    });
    const max = largest._max.position;
    const position = appendRank(max) ?? Math.min((max ?? 0) + 1, RANK_MAX);
    const copy = await tx.project.create({
      data: {
        organizationId: org,
        name,
        descriptionMarkdown: src.descriptionMarkdown,
        color: src.color,
        icon: src.icon,
        status: src.status,
        dueDate: src.dueDate,
        isPrivate: src.isPrivate,
        keyPrefix,
        position,
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    await tx.projectMember.create({
      data: { organizationId: org, projectId: copy.id, userId: actor.userId, role: "MANAGER" },
    });
    await tx.projectTaskCounter.create({ data: { organizationId: org, projectId: copy.id } });
    await tx.projectKeyPrefix.createMany({
      data: [{ organizationId: org, prefix: keyPrefix, projectId: copy.id }],
      skipDuplicates: true,
    });
    const reservation = await tx.projectKeyPrefix.findFirst({
      where: { organizationId: org, prefix: keyPrefix },
      select: { projectId: true },
    });
    if (!reservation || reservation.projectId !== copy.id) refuse("PREFIX_TAKEN");

    const labelMap = new Map<string, string>();
    for (const label of labels) {
      const row = await tx.projectLabel.create({
        data: { organizationId: org, projectId: copy.id, name: label.name, color: label.color },
        select: { id: true },
      });
      labelMap.set(label.id, row.id);
    }
    const milestoneMap = new Map<string, string>();
    for (const milestone of milestones) {
      const row = await tx.projectMilestone.create({
        data: {
          organizationId: org,
          projectId: copy.id,
          name: milestone.name,
          descriptionMarkdown: milestone.descriptionMarkdown,
          date: milestone.date,
        },
        select: { id: true },
      });
      milestoneMap.set(milestone.id, row.id);
    }

    // Tasks: top-level in (status order, rank, id), each followed by its subtasks in (rank, id).
    const statusOrder = (status: string) => TASK_STATUSES.indexOf(status as TaskStatus);
    const topLevel = tasks
      .filter((t) => t.parentId === null)
      .sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || byRankThenId(a, b));
    const subtasksOf = new Map<string, CopySource[]>();
    for (const t of tasks) {
      if (t.parentId === null) continue;
      const list = subtasksOf.get(t.parentId) ?? [];
      list.push(t);
      subtasksOf.set(t.parentId, list);
    }
    const eligible = eligibilityOf(tx, org, copy.id);
    const created: { source: CopySource; id: string; key: string }[] = [];
    const copyOne = async (source: CopySource, parentId: string | null) => {
      const entry = await insertCopy(tx, {
        orgId: org,
        projectId: copy.id,
        prefix: keyPrefix,
        actorUserId: actor.userId,
        source,
        parentId,
        rank: source.rank,
        assigneeUserId: await eligible(source.assigneeUserId),
        milestoneId: source.milestoneId ? (milestoneMap.get(source.milestoneId) ?? null) : null,
        labelIds: source.labels
          .map((l) => labelMap.get(l.labelId))
          .filter((id): id is string => id !== undefined),
      });
      created.push({ source, ...entry });
      return entry;
    };
    for (const parent of topLevel) {
      const parentCopy = await copyOne(parent, null);
      for (const sub of (subtasksOf.get(parent.id) ?? []).sort(byRankThenId)) {
        await copyOne(sub, parentCopy.id);
      }
    }

    const batchId = newBatchId();
    await recordProjectActivity(tx, {
      orgId: org,
      projectId: copy.id,
      relatedProjectId: projectId,
      actorUserId: actor.userId,
      verb: "PROJECT_DUPLICATED",
      entityType: "PROJECT",
      entityId: copy.id,
      before: { projectId },
      after: {
        projectId: copy.id,
        taskCount: created.length,
        labelCount: labels.length,
        milestoneCount: milestones.length,
      },
      batchId,
    });
    for (const entry of created) {
      await recordProjectActivity(tx, {
        orgId: org,
        projectId: copy.id,
        relatedProjectId: projectId,
        taskId: entry.id,
        actorUserId: actor.userId,
        verb: "TASK_DUPLICATED",
        entityType: "TASK",
        entityId: entry.id,
        before: { projectId, taskId: entry.source.id, taskKey: entry.source.key },
        after: { projectId: copy.id, taskKey: entry.key },
        batchId,
      });
    }
    return { projectId: copy.id, keyPrefix, taskCount: created.length };
  });
}
