// Phase 14 recurring tasks (contract sections 5, 7 and 8; D-09, AIDA-102) on a real Postgres
// through Testcontainers. Every case seeds fresh organizations and passes opts.now; the real
// clock is never part of an assertion.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { toCalendarDate } from "@/lib/projects/contract";
import { clearTaskRecurrence, setTaskRecurrence } from "@/lib/projects/recurrence";
import { setTaskDates, setTaskStatus } from "@/lib/projects/tasks";
import {
  actorOf,
  removeOrgMember,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
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

/** Removes a task's rows leaves first (deleteTask belongs to plan 14-10 and is not used here). */
async function deleteTaskRows(orgId: string, taskId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "TaskLabel" WHERE "taskId" = ${taskId} AND "organizationId" = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM "TaskKey" WHERE "taskId" = ${taskId} AND "organizationId" = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM "Task" WHERE "id" = ${taskId} AND "organizationId" = ${orgId}`;
}

function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

describe("recurrence rules through the services", () => {
  it("WEEKLY follows the anchor weekday even after the due date moved", async () => {
    const w = await world();
    const task = await seedTask(prisma, w.orgId, w.project.id, { dueDate: "2026-01-07" });
    await recur(w, task.id, { rule: "WEEKLY", anchorDate: "2026-01-05" });
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    const successor = await onlySuccessor(w.orgId, task.id);
    expect(day(successor.dueDate)).toBe("2026-01-12");
    expect(day(successor.recurrenceAnchor)).toBe("2026-01-05");
  });

  it("MONTHLY anchored on the 31st clamps to the month end and returns to the anchor day", async () => {
    const w = await world();
    const january = await seedTask(prisma, w.orgId, w.project.id, { dueDate: "2026-01-31" });
    await recur(w, january.id, { rule: "MONTHLY" });
    expect(await complete(w, january.id)).toMatchObject({ ok: true, changed: true });
    const february = await onlySuccessor(w.orgId, january.id);
    expect(day(february.dueDate)).toBe("2026-02-28");
    expect(await complete(w, february.id)).toMatchObject({ ok: true, changed: true });
    const march = await onlySuccessor(w.orgId, february.id);
    expect(day(march.dueDate)).toBe("2026-03-31");
    expect(day(march.recurrenceAnchor)).toBe("2026-01-31");
  });

  it("MONTHLY anchored 2028-01-31 lands on the leap day 2028-02-29", async () => {
    const w = await world();
    const task = await seedTask(prisma, w.orgId, w.project.id, { dueDate: "2028-01-31" });
    await recur(w, task.id, { rule: "MONTHLY" });
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    expect(day((await onlySuccessor(w.orgId, task.id)).dueDate)).toBe("2028-02-29");
  });

  it("DAILY keeps the start-to-due gap, and a start-only task gets the next start date only", async () => {
    const w = await world();
    const both = await seedTask(prisma, w.orgId, w.project.id, {
      startDate: "2026-01-07",
      dueDate: "2026-01-10",
    });
    await recur(w, both.id, { rule: "DAILY", anchorDate: "2026-01-07" });
    expect(await complete(w, both.id)).toMatchObject({ ok: true, changed: true });
    const next = await onlySuccessor(w.orgId, both.id);
    expect([day(next.startDate), day(next.dueDate)]).toEqual(["2026-01-08", "2026-01-11"]);

    const startOnly = await seedTask(prisma, w.orgId, w.project.id, { startDate: "2026-01-07" });
    await recur(w, startOnly.id, { rule: "DAILY" });
    expect(await complete(w, startOnly.id)).toMatchObject({ ok: true, changed: true });
    const after = await onlySuccessor(w.orgId, startOnly.id);
    expect([day(after.startDate), day(after.dueDate)]).toEqual(["2026-01-08", null]);
  });

  it("a task without dates is dated by its occurrence in the series time zone", async () => {
    const w = await world();
    const now = new Date("2026-03-31T17:30:00Z");
    const jakarta = await seedTask(prisma, w.orgId, w.project.id);
    await recur(w, jakarta.id, { rule: "DAILY", timeZone: "Asia/Jakarta" }, now);
    expect(day((await taskRow(w.orgId, jakarta.id)).recurrenceAnchor)).toBe("2026-04-01");
    expect(await complete(w, jakarta.id, now)).toMatchObject({ ok: true, changed: true });
    const jakartaNext = await onlySuccessor(w.orgId, jakarta.id);
    expect([day(jakartaNext.startDate), day(jakartaNext.dueDate)]).toEqual([null, "2026-04-02"]);
    expect(jakartaNext.recurrenceTimeZone).toBe("Asia/Jakarta");

    const utc = await seedTask(prisma, w.orgId, w.project.id);
    await recur(w, utc.id, { rule: "DAILY" }, now);
    expect(day((await taskRow(w.orgId, utc.id)).recurrenceAnchor)).toBe("2026-03-31");
    expect(await complete(w, utc.id, now)).toMatchObject({ ok: true, changed: true });
    expect(day((await onlySuccessor(w.orgId, utc.id)).dueDate)).toBe("2026-04-01");

    // The open successor's series moves to UTC; its anchor (a calendar date) stays as it is.
    await recur(w, jakartaNext.id, { rule: "DAILY", anchorDate: "2026-04-01", timeZone: "UTC" });
    const moved = await taskRow(w.orgId, jakartaNext.id);
    expect([moved.recurrenceTimeZone, day(moved.recurrenceAnchor)]).toEqual(["UTC", "2026-04-01"]);
    const cleared = await setTaskDates(w.member, jakartaNext.id, moved.version, {
      startDate: null,
      dueDate: null,
    });
    expect(cleared).toMatchObject({ ok: true, changed: true });
    // 2026-04-02T17:30Z is 2026-04-02 in UTC (2026-04-03 in Jakarta): UTC gives due 2026-04-03.
    const later = new Date("2026-04-02T17:30:00Z");
    expect(await complete(w, jakartaNext.id, later)).toMatchObject({ ok: true, changed: true });
    const third = await onlySuccessor(w.orgId, jakartaNext.id);
    expect(day(third.dueDate)).toBe("2026-04-03");
    expect([third.recurrenceTimeZone, day(third.recurrenceAnchor)]).toEqual(["UTC", "2026-04-01"]);
  });

  it("America/New_York across the 2026-03-08 daylight-saving change uses the zone, not a fixed offset", async () => {
    const w = await world();
    const input = {
      rule: "DAILY" as const,
      anchorDate: "2026-03-01",
      timeZone: "America/New_York",
    };
    const afterChange = await seedTask(prisma, w.orgId, w.project.id);
    await recur(w, afterChange.id, input);
    // 2026-03-09T04:30:00Z is 00:30 on 2026-03-09 local (UTC-4): base 2026-03-09, due 2026-03-10.
    expect(await complete(w, afterChange.id, new Date("2026-03-09T04:30:00Z"))).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(day((await onlySuccessor(w.orgId, afterChange.id)).dueDate)).toBe("2026-03-10");

    const beforeChange = await seedTask(prisma, w.orgId, w.project.id);
    await recur(w, beforeChange.id, input);
    // 2026-03-08T04:30:00Z is 23:30 on 2026-03-07 local (UTC-5): base 2026-03-07, due 2026-03-08.
    expect(await complete(w, beforeChange.id, new Date("2026-03-08T04:30:00Z"))).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(day((await onlySuccessor(w.orgId, beforeChange.id)).dueDate)).toBe("2026-03-08");
  });

  it("a next occurrence after 2999-12-31 is refused with INVALID_DATE_RANGE and changes nothing", async () => {
    const w = await world();
    for (const [rule, dueDate] of [
      ["MONTHLY", "2999-12-15"],
      ["DAILY", "2999-12-31"],
    ] as const) {
      const task = await seedTask(prisma, w.orgId, w.project.id, { dueDate });
      await recur(w, task.id, { rule });
      const before = await taskRow(w.orgId, task.id);
      const count = await activityCount(w.orgId);
      expect(await complete(w, task.id)).toEqual({ ok: false, code: "INVALID_DATE_RANGE" });
      expect(await taskRow(w.orgId, task.id)).toEqual(before);
      expect(await successorsOf(w.orgId, task.id)).toHaveLength(0);
      expect(await activityCount(w.orgId)).toBe(count);
    }
  });
});

describe("recurrence lifecycle: exactly one successor", () => {
  it("reopening and completing again, and deleting the successor, never create a second one", async () => {
    const w = await world();
    const task = await seedTask(prisma, w.orgId, w.project.id, { dueDate: "2026-05-01" });
    await recur(w, task.id, { rule: "DAILY" });
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    const successor = await onlySuccessor(w.orgId, task.id);

    const reopenVersion = (await taskRow(w.orgId, task.id)).version;
    expect(await setTaskStatus(w.member, task.id, reopenVersion, "TODO", { now: NOW })).toEqual({
      ok: true,
      changed: true,
      version: reopenVersion + 1,
    });
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    expect((await successorsOf(w.orgId, task.id)).map((t) => t.id)).toEqual([successor.id]);

    await deleteTaskRows(w.orgId, successor.id);
    expect(await successorsOf(w.orgId, task.id)).toHaveLength(0);
    const version = (await taskRow(w.orgId, task.id)).version;
    expect(
      await setTaskStatus(w.member, task.id, version, "IN_PROGRESS", { now: NOW }),
    ).toMatchObject({
      ok: true,
      changed: true,
    });
    const count = await activityCount(w.orgId);
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    expect(await successorsOf(w.orgId, task.id)).toHaveLength(0);
    expect(await activityCount(w.orgId)).toBe(count + 1);
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: w.orgId, verb: "TASK_RECURRED" },
      }),
    ).toBe(1);
  });

  it("deleting the predecessor keeps the successor intact", async () => {
    const w = await world();
    const label = await seedLabel(prisma, w.orgId, w.project.id);
    const task = await seedTask(prisma, w.orgId, w.project.id, {
      dueDate: "2026-05-01",
      labelIds: [label.id],
    });
    await recur(w, task.id, { rule: "WEEKLY" });
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    const successor = await onlySuccessor(w.orgId, task.id);
    const successorLabels = await prisma.taskLabel.findMany({
      where: { organizationId: w.orgId, taskId: successor.id },
    });
    await deleteTaskRows(w.orgId, task.id);
    expect(await prisma.task.count({ where: { organizationId: w.orgId, id: task.id } })).toBe(0);
    expect(await taskRow(w.orgId, successor.id)).toEqual(successor);
    expect(successor.recurrencePredecessorId).toBe(task.id);
    expect(
      await prisma.taskLabel.findMany({ where: { organizationId: w.orgId, taskId: successor.id } }),
    ).toEqual(successorLabels);
    expect(successorLabels).toHaveLength(1);
  });
});

describe("recurrence assignee eligibility (K69)", () => {
  it("an assignee whose organization member row was removed is not copied", async () => {
    const w = await world();
    const task = await seedTask(prisma, w.orgId, w.project.id, {
      dueDate: "2026-05-01",
      assigneeUserId: w.users.other,
    });
    await recur(w, task.id, { rule: "DAILY" });
    await removeOrgMember(prisma, w.orgId, w.users.other);
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    expect((await onlySuccessor(w.orgId, task.id)).assigneeUserId).toBeNull();
  });

  it("on a private project an assignee who is no longer a direct member is not copied", async () => {
    const w = await world({ isPrivate: true });
    await prisma.projectMember.create({
      data: {
        organizationId: w.orgId,
        projectId: w.project.id,
        userId: w.users.other,
        role: "MEMBER",
      },
    });
    const task = await seedTask(prisma, w.orgId, w.project.id, {
      dueDate: "2026-05-01",
      assigneeUserId: w.users.other,
    });
    await recur(w, task.id, { rule: "DAILY" });
    await prisma.projectMember.deleteMany({
      where: { organizationId: w.orgId, projectId: w.project.id, userId: w.users.other },
    });
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    expect((await onlySuccessor(w.orgId, task.id)).assigneeUserId).toBeNull();
  });

  it("on a private project a member of an assigned team only is not eligible", async () => {
    const w = await world({ isPrivate: true });
    await seedTeam(prisma, w.orgId, { memberUserIds: [w.users.other], projectIds: [w.project.id] });
    const task = await seedTask(prisma, w.orgId, w.project.id, {
      dueDate: "2026-05-01",
      assigneeUserId: w.users.other,
    });
    await recur(w, task.id, { rule: "DAILY" });
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    expect((await onlySuccessor(w.orgId, task.id)).assigneeUserId).toBeNull();
  });
});

describe("setTaskRecurrence and clearTaskRecurrence refusals and clearing", () => {
  it("refuses a subtask, an unknown zone or rule, an archived task and a stale version, writing nothing", async () => {
    const w = await world();
    const parent = await seedTask(prisma, w.orgId, w.project.id);
    const subtask = await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id });
    const archived = await seedTask(prisma, w.orgId, w.project.id, { archivedAt: NOW });
    const count = await activityCount(w.orgId);
    const opts = { now: NOW };
    expect(await setTaskRecurrence(w.member, subtask.id, 0, { rule: "DAILY" }, opts)).toEqual({
      ok: false,
      code: "RECURRENCE_ON_SUBTASK",
    });
    expect(
      await setTaskRecurrence(
        w.member,
        parent.id,
        0,
        { rule: "DAILY", timeZone: "Mars/Base" },
        opts,
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "timeZone" });
    expect(
      await setTaskRecurrence(
        w.member,
        parent.id,
        0,
        { rule: "YEARLY" as unknown as "DAILY" },
        opts,
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "rule" });
    expect(await setTaskRecurrence(w.member, archived.id, 0, { rule: "DAILY" }, opts)).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await setTaskRecurrence(w.member, parent.id, 7, { rule: "DAILY" }, opts)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await clearTaskRecurrence(w.member, parent.id, 7)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await activityCount(w.orgId)).toBe(count);
    expect((await taskRow(w.orgId, parent.id)).recurrenceRule).toBeNull();
  });

  it("clearTaskRecurrence writes TASK_UPDATED and a later completion creates nothing", async () => {
    const w = await world();
    const task = await seedTask(prisma, w.orgId, w.project.id, { dueDate: "2026-05-01" });
    const version = await recur(w, task.id, { rule: "MONTHLY", timeZone: "Asia/Jakarta" });
    expect(await clearTaskRecurrence(w.member, task.id, version)).toEqual({
      ok: true,
      changed: true,
      version: version + 1,
    });
    const rows = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, verb: "TASK_UPDATED", entityId: task.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.after)).toContainEqual({
      recurrenceRule: null,
      recurrenceAnchor: null,
      recurrenceTimeZone: null,
    });
    expect(rows.map((r) => r.before)).toContainEqual({
      recurrenceRule: "MONTHLY",
      recurrenceAnchor: "2026-05-01",
      recurrenceTimeZone: "Asia/Jakarta",
    });
    expect(await clearTaskRecurrence(w.member, task.id, version + 1)).toEqual({
      ok: true,
      changed: false,
    });
    const stored = await taskRow(w.orgId, task.id);
    expect([stored.recurrenceRule, stored.recurrenceAnchor, stored.recurrenceTimeZone]).toEqual([
      null,
      null,
      null,
    ]);
    expect(await complete(w, task.id)).toMatchObject({ ok: true, changed: true });
    expect(await successorsOf(w.orgId, task.id)).toHaveLength(0);
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: w.orgId, verb: "TASK_RECURRED" },
      }),
    ).toBe(0);
  });
});
