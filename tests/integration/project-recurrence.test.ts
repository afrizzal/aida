// Phase 14 recurring tasks (contract sections 5, 7 and 8; D-09, AIDA-102) on a real Postgres
// through Testcontainers. Every case seeds fresh organizations and passes opts.now; the real
// clock is never part of an assertion.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { toCalendarDate } from "@/lib/projects/contract";
import { setTaskRecurrence } from "@/lib/projects/recurrence";
import { setTaskStatus } from "@/lib/projects/tasks";
import {
  actorOf,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
} from "../support/project-fixtures";

const NOW = new Date("2026-03-15T12:00:00Z");

async function world(opts: { isPrivate?: boolean } = {}) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
  const [owner, manager, member, other] = org.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
  ];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    isPrivate: opts.isPrivate ?? false,
    managerUserIds: [manager],
    memberUserIds: [member],
  });
  return {
    orgId: org.orgId,
    users: { owner, manager, member, other },
    manager: actorOf(manager, org.orgId),
    member: actorOf(member, org.orgId),
    project,
  };
}

type World = Awaited<ReturnType<typeof world>>;

const day = (value: Date | null) => (value ? toCalendarDate(value) : null);

async function taskRow(orgId: string, id: string) {
  return prisma.task.findFirstOrThrow({ where: { id, organizationId: orgId } });
}

async function successorsOf(orgId: string, predecessorId: string) {
  return prisma.task.findMany({
    where: { organizationId: orgId, recurrencePredecessorId: predecessorId },
  });
}

async function onlySuccessor(orgId: string, predecessorId: string) {
  const rows = await successorsOf(orgId, predecessorId);
  expect(rows).toHaveLength(1);
  return rows[0] as (typeof rows)[number];
}

/** setTaskRecurrence on the task's current version; returns the new version. */
async function recur(
  w: World,
  taskId: string,
  input: Parameters<typeof setTaskRecurrence>[3],
  now: Date = NOW,
): Promise<number> {
  const version = (await taskRow(w.orgId, taskId)).version;
  const result = await setTaskRecurrence(w.member, taskId, version, input, { now });
  expect(result).toEqual({ ok: true, changed: true, version: version + 1 });
  return version + 1;
}

/** setTaskStatus(DONE) on the task's current version with the given clock. */
async function complete(w: World, taskId: string, now: Date = NOW) {
  const version = (await taskRow(w.orgId, taskId)).version;
  return setTaskStatus(w.member, taskId, version, "DONE", { now });
}

describe("recurrence tracer: a daily task completed once", () => {
  it("creates exactly one next occurrence with the right dates, key, copies and activity", async () => {
    const w = await world();
    const labelA = await seedLabel(prisma, w.orgId, w.project.id);
    const labelB = await seedLabel(prisma, w.orgId, w.project.id);
    const milestone = await seedMilestone(prisma, w.orgId, w.project.id);
    const task = await seedTask(prisma, w.orgId, w.project.id, {
      title: "Daily check",
      dueDate: "2026-03-31",
      assigneeUserId: w.users.member,
      milestoneId: milestone.id,
      labelIds: [labelA.id, labelB.id],
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { descriptionMarkdown: "Check **all** boxes", priority: "HIGH", estimateMinutes: 45 },
    });
    const subtask = await seedTask(prisma, w.orgId, w.project.id, { parentId: task.id });
    await prisma.taskComment.create({
      data: {
        organizationId: w.orgId,
        taskId: task.id,
        authorUserId: w.users.member,
        bodyMarkdown: "c",
      },
    });

    const before = await prisma.projectActivity.count({ where: { organizationId: w.orgId } });
    const set = await setTaskRecurrence(w.member, task.id, 0, { rule: "DAILY" }, { now: NOW });
    expect(set).toEqual({ ok: true, changed: true, version: 1 });
    const stored = await taskRow(w.orgId, task.id);
    expect(stored.recurrenceRule).toBe("DAILY");
    expect(day(stored.recurrenceAnchor)).toBe("2026-03-31");
    expect(stored.recurrenceTimeZone).toBe("UTC");
    const updated = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, verb: "TASK_UPDATED", entityId: task.id },
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      actorUserId: w.users.member,
      before: { recurrenceRule: null, recurrenceAnchor: null, recurrenceTimeZone: null },
      after: { recurrenceRule: "DAILY", recurrenceAnchor: "2026-03-31", recurrenceTimeZone: "UTC" },
    });

    const done = await setTaskStatus(w.member, task.id, 1, "DONE", { now: NOW });
    expect(done).toEqual({ ok: true, changed: true, version: 2 });

    const successor = await onlySuccessor(w.orgId, task.id);
    const counter = await prisma.projectTaskCounter.findFirstOrThrow({
      where: { organizationId: w.orgId, projectId: w.project.id },
    });
    expect(successor).toMatchObject({
      projectId: w.project.id,
      parentId: null,
      recurrencePredecessorId: task.id,
      title: "Daily check",
      descriptionMarkdown: "Check **all** boxes",
      priority: "HIGH",
      estimateMinutes: 45,
      assigneeUserId: w.users.member,
      createdByUserId: w.users.member,
      status: "TODO",
      milestoneId: null,
      archivedAt: null,
      version: 0,
      recurrenceRule: "DAILY",
      recurrenceTimeZone: "UTC",
      recurrenceSpawned: false,
      number: counter.lastNumber,
      key: `${w.project.keyPrefix}-${counter.lastNumber}`,
    });
    expect(counter.lastNumber).toBe(subtask.number + 1);
    expect(day(successor.dueDate)).toBe("2026-04-01");
    expect(day(successor.startDate)).toBeNull();
    expect(day(successor.recurrenceAnchor)).toBe("2026-03-31");
    const labels = await prisma.taskLabel.findMany({
      where: { organizationId: w.orgId, taskId: successor.id },
      orderBy: { labelId: "asc" },
    });
    expect(labels.map((l) => l.labelId)).toEqual([labelA.id, labelB.id].sort());
    expect(
      await prisma.task.count({ where: { organizationId: w.orgId, parentId: successor.id } }),
    ).toBe(0);
    expect(
      await prisma.taskComment.count({ where: { organizationId: w.orgId, taskId: successor.id } }),
    ).toBe(0);
    expect(
      await prisma.taskKey.findMany({
        where: { organizationId: w.orgId, taskId: successor.id },
        select: { normalizedKey: true, kind: true, projectId: true },
      }),
    ).toEqual([{ normalizedKey: successor.key, kind: "ACTIVE", projectId: w.project.id }]);

    const predecessor = await taskRow(w.orgId, task.id);
    expect(predecessor.recurrenceSpawned).toBe(true);
    expect(predecessor.status).toBe("DONE");

    const statusRows = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, verb: "TASK_STATUS_CHANGED" },
    });
    const recurredRows = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, verb: "TASK_RECURRED" },
    });
    expect(statusRows).toHaveLength(1);
    expect(recurredRows).toHaveLength(1);
    const statusRow = statusRows[0] as (typeof statusRows)[number];
    const recurredRow = recurredRows[0] as (typeof recurredRows)[number];
    expect(statusRow).toMatchObject({
      entityType: "TASK",
      entityId: task.id,
      taskId: task.id,
      actorUserId: w.users.member,
      before: { status: "TODO" },
      after: { status: "DONE" },
    });
    expect(recurredRow).toMatchObject({
      projectId: w.project.id,
      entityType: "TASK",
      entityId: successor.id,
      taskId: successor.id,
      actorUserId: w.users.member,
      before: null,
      after: {
        predecessorTaskId: task.id,
        predecessorTaskKey: task.key,
        key: successor.key,
        startDate: null,
        dueDate: "2026-04-01",
      },
    });
    expect(recurredRow.batchId).toBe(statusRow.batchId);
    expect(await prisma.projectActivity.count({ where: { organizationId: w.orgId } })).toBe(
      before + 3,
    );

    const again = await setTaskStatus(w.member, task.id, 2, "DONE", { now: NOW });
    expect(again).toEqual({ ok: true, changed: false });
    expect(await successorsOf(w.orgId, task.id)).toHaveLength(1);
    expect(await prisma.projectActivity.count({ where: { organizationId: w.orgId } })).toBe(
      before + 3,
    );
  });
});
