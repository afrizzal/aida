// Phase 14 task core (contract sections 4 to 8, 14 and 15) on a real Postgres through
// Testcontainers. Every case seeds fresh organizations; every mutation asserts its exact activity
// row and every refusal asserts that no activity row was written.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createTask,
  getTask,
  listProjectTasks,
  listWorkspaceTasks,
  setTaskDates,
  setTaskParent,
  setTaskStatus,
  updateTask,
} from "@/lib/projects/tasks";
import {
  actorOf,
  seedOrgWithMembers,
  seedPrivacyWorld,
  seedProject,
  seedTask,
} from "../support/project-fixtures";

async function taskWorld(opts: { isPrivate?: boolean; keyPrefix?: string } = {}) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
  const [owner, manager, member, outsiderOfProject] = org.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
  ];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    keyPrefix: opts.keyPrefix,
    isPrivate: opts.isPrivate ?? false,
    managerUserIds: [manager],
    memberUserIds: [member],
  });
  return {
    orgId: org.orgId,
    users: { owner, manager, member, outsiderOfProject },
    manager: actorOf(manager, org.orgId),
    member: actorOf(member, org.orgId),
    project,
  };
}

function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

describe("createTask and getTask (tracer)", () => {
  it("a member creates OPS-1 and reads it back with the description safely rendered", async () => {
    const prefix = `O${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const w = await taskWorld({ keyPrefix: prefix });
    const created = await createTask(w.member, w.project.id, {
      title: "Write spec",
      description: "**hi** ![x](https://evil.example/a.png)",
      dueDate: "2026-03-31",
    });
    expect(created).toMatchObject({ ok: true, key: `${prefix}-1`, number: 1, version: 0 });
    if (!created.ok) throw new Error("create failed");

    const read = await getTask(w.member, created.taskId);
    if (!read.ok) throw new Error(`getTask refused: ${read.code}`);
    expect(read.task).toMatchObject({
      key: `${prefix}-1`,
      title: "Write spec",
      status: "TODO",
      priority: "NONE",
      dueDate: "2026-03-31",
      startDate: null,
      parentId: null,
      archivedViaParent: false,
      subtasks: [],
      labels: [],
      milestone: null,
      version: 0,
    });
    expect(read.task.descriptionHtml).toContain("<strong>hi</strong>");
    expect(read.task.descriptionHtml).not.toContain("<img");
    expect(read.task.descriptionHtml).not.toContain("evil.example");

    const keyRow = await prisma.taskKey.findFirstOrThrow({
      where: { organizationId: w.orgId, normalizedKey: `${prefix}-1` },
    });
    expect(keyRow).toMatchObject({ taskId: created.taskId, kind: "ACTIVE" });

    const rows = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, verb: "TASK_CREATED" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: w.project.id,
      taskId: created.taskId,
      entityType: "TASK",
      entityId: created.taskId,
      actorUserId: w.users.member,
      before: null,
    });
    expect(rows[0]?.after).toMatchObject({
      key: `${prefix}-1`,
      title: "Write spec",
      status: "TODO",
      dueDate: "2026-03-31",
    });
  });

  it("createTask with an invalid title writes nothing", async () => {
    const w = await taskWorld();
    const before = await activityCount(w.orgId);
    expect(await createTask(w.member, w.project.id, { title: "   " })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "title",
    });
    expect(await activityCount(w.orgId)).toBe(before);
    expect(await prisma.task.count({ where: { organizationId: w.orgId } })).toBe(0);
  });
});

function taskRow(orgId: string, id: string) {
  return prisma.task.findFirstOrThrow({ where: { id, organizationId: orgId } });
}

function rowsOf(
  orgId: string,
  verb: "TASK_UPDATED" | "TASK_STATUS_CHANGED" | "TASK_PARENT_CHANGED",
) {
  return prisma.projectActivity.findMany({ where: { organizationId: orgId, verb } });
}

describe("updateTask", () => {
  it("changes the content fields once, records only the changed keys and treats a repeat as a no-op", async () => {
    const w = await taskWorld();
    const t = await seedTask(prisma, w.orgId, w.project.id, { title: "Old" });
    const patch = {
      title: "New",
      description: "Body",
      priority: "HIGH" as const,
      assigneeUserId: w.users.member,
      estimateMinutes: 90,
    };
    expect(await updateTask(w.member, t.id, 0, patch)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await taskRow(w.orgId, t.id)).toMatchObject({
      title: "New",
      descriptionMarkdown: "Body",
      priority: "HIGH",
      assigneeUserId: w.users.member,
      estimateMinutes: 90,
      version: 1,
    });
    const rows = await rowsOf(w.orgId, "TASK_UPDATED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: t.id,
      entityId: t.id,
      projectId: w.project.id,
      actorUserId: w.users.member,
      before: {
        title: "Old",
        descriptionChanged: false,
        priority: "NONE",
        assigneeUserId: null,
        estimateMinutes: null,
      },
      after: {
        title: "New",
        descriptionChanged: true,
        priority: "HIGH",
        assigneeUserId: w.users.member,
        estimateMinutes: 90,
      },
    });
    expect(await updateTask(w.member, t.id, 1, patch)).toEqual({ ok: true, changed: false });
    expect(await rowsOf(w.orgId, "TASK_UPDATED")).toHaveLength(1);
  });

  it("a stale version is CONFLICT and a 201 code point title is INVALID_INPUT, neither recorded", async () => {
    const w = await taskWorld();
    const t = await seedTask(prisma, w.orgId, w.project.id);
    expect(await updateTask(w.member, t.id, 0, { title: "One" })).toMatchObject({ ok: true });
    const before = await activityCount(w.orgId);
    expect(await updateTask(w.member, t.id, 0, { title: "Two" })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await updateTask(w.member, t.id, 1, { title: "😀".repeat(201) })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "title",
    });
    expect(await updateTask(w.member, t.id, 1, { title: "😀".repeat(200) })).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(await activityCount(w.orgId)).toBe(before + 1);
  });

  it("an assignee outside the organization, or not a direct member of a private project, is NOT_ELIGIBLE", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const manager = pw.actors.manager;
    const before = await activityCount(pw.orgA);
    for (const userId of [pw.users.outsider, pw.users.teamMember, pw.users.nonMember]) {
      expect(await updateTask(manager, pw.task.id, 0, { assigneeUserId: userId })).toEqual({
        ok: false,
        code: "NOT_ELIGIBLE",
      });
      expect(
        await createTask(manager, pw.project.id, { title: "x", assigneeUserId: userId }),
      ).toEqual({ ok: false, code: "NOT_ELIGIBLE" });
    }
    expect(await activityCount(pw.orgA)).toBe(before);
    expect(await updateTask(manager, pw.task.id, 0, { assigneeUserId: pw.users.manager })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    // On a non-private project every active organization member is eligible.
    const open = await seedTask(prisma, pw.orgA, pw.openProject.id);
    expect(
      await updateTask(manager, open.id, 0, { assigneeUserId: pw.users.nonMember }),
    ).toMatchObject({ ok: true, changed: true });
    expect(await updateTask(manager, open.id, 1, { assigneeUserId: pw.users.outsider })).toEqual({
      ok: false,
      code: "NOT_ELIGIBLE",
    });
  });
});

describe("setTaskDates", () => {
  it("refuses a start after the due date, records valid dates and the database fences Task_dates_check", async () => {
    const w = await taskWorld();
    const t = await seedTask(prisma, w.orgId, w.project.id);
    const before = await activityCount(w.orgId);
    expect(
      await setTaskDates(w.member, t.id, 0, { startDate: "2026-04-10", dueDate: "2026-04-01" }),
    ).toEqual({ ok: false, code: "INVALID_DATE_RANGE" });
    expect(await activityCount(w.orgId)).toBe(before);
    expect(
      await setTaskDates(w.member, t.id, 0, { startDate: "2026-04-01", dueDate: "2026-04-10" }),
    ).toEqual({ ok: true, changed: true, version: 1 });
    const rows = await rowsOf(w.orgId, "TASK_UPDATED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      before: { startDate: null, dueDate: null },
      after: { startDate: "2026-04-01", dueDate: "2026-04-10" },
    });
    // Moving only the due date before the stored start is refused after merging.
    expect(await setTaskDates(w.member, t.id, 1, { dueDate: "2026-03-01" })).toEqual({
      ok: false,
      code: "INVALID_DATE_RANGE",
    });
    await expect(
      prisma.$executeRaw`UPDATE "Task" SET "startDate" = '2026-05-02', "dueDate" = '2026-05-01'
        WHERE "id" = ${t.id} AND "organizationId" = ${w.orgId}`,
    ).rejects.toThrow(/Task_dates_check/);
  });

  it("setTaskDates with a stale version is CONFLICT, changes nothing and writes no activity", async () => {
    const w = await taskWorld();
    const t = await seedTask(prisma, w.orgId, w.project.id);
    expect(await updateTask(w.member, t.id, 0, { title: "Bump" })).toMatchObject({ ok: true });
    const row = await taskRow(w.orgId, t.id);
    const count = await activityCount(w.orgId);
    expect(
      await setTaskDates(w.member, t.id, 0, { startDate: "2026-01-01", dueDate: "2026-01-02" }),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await taskRow(w.orgId, t.id)).toEqual(row);
    expect(await activityCount(w.orgId)).toBe(count);
  });
});

describe("setTaskStatus", () => {
  it("moves a task to the end of the IN_PROGRESS group and records TASK_STATUS_CHANGED", async () => {
    const w = await taskWorld();
    const busy = await seedTask(prisma, w.orgId, w.project.id, {
      status: "IN_PROGRESS",
      rank: 50_000,
    });
    const t = await seedTask(prisma, w.orgId, w.project.id);
    expect(await setTaskStatus(w.member, t.id, 0, "IN_PROGRESS")).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await taskRow(w.orgId, t.id)).toMatchObject({
      status: "IN_PROGRESS",
      rank: 50_000 + 1024,
      version: 1,
    });
    expect((await taskRow(w.orgId, busy.id)).rank).toBe(50_000);
    const rows = await rowsOf(w.orgId, "TASK_STATUS_CHANGED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: t.id,
      before: { status: "TODO" },
      after: { status: "IN_PROGRESS" },
    });
    expect(await setTaskStatus(w.member, t.id, 1, "IN_PROGRESS")).toEqual({
      ok: true,
      changed: false,
    });
    const count = await activityCount(w.orgId);
    expect(await setTaskStatus(w.member, t.id, 1, "OPEN" as never)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "status",
    });
    expect(await activityCount(w.orgId)).toBe(count);
  });

  it("setTaskStatus with a stale version is CONFLICT, changes nothing and writes no activity", async () => {
    const w = await taskWorld();
    const t = await seedTask(prisma, w.orgId, w.project.id);
    expect(await updateTask(w.member, t.id, 0, { title: "Bump" })).toMatchObject({ ok: true });
    const row = await taskRow(w.orgId, t.id);
    const count = await activityCount(w.orgId);
    expect(await setTaskStatus(w.member, t.id, 0, "DONE")).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await taskRow(w.orgId, t.id)).toEqual(row);
    expect(await activityCount(w.orgId)).toBe(count);
  });
});

describe("setTaskParent", () => {
  it("nests a top-level task one level, refuses every other shape and makes it top-level again", async () => {
    const w = await taskWorld();
    const parent = await seedTask(prisma, w.orgId, w.project.id);
    const child = await seedTask(prisma, w.orgId, w.project.id, { status: "REVIEW" });
    const existingSub = await seedTask(prisma, w.orgId, w.project.id, {
      parentId: parent.id,
      rank: 7000,
    });
    expect(await setTaskParent(w.member, child.id, 0, parent.id)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await taskRow(w.orgId, child.id)).toMatchObject({ parentId: parent.id, rank: 8024 });
    const rows = await rowsOf(w.orgId, "TASK_PARENT_CHANGED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: child.id,
      before: { parentId: null },
      after: { parentId: parent.id },
    });

    const other = await seedTask(prisma, w.orgId, w.project.id);
    const recurring = await seedTask(prisma, w.orgId, w.project.id, {
      recurrence: { rule: "WEEKLY", anchor: "2026-01-05", timeZone: "UTC" },
    });
    const otherProject = await seedProject(prisma, w.orgId, {
      createdByUserId: w.users.manager,
      memberUserIds: [w.users.member],
    });
    const foreignParent = await seedTask(prisma, w.orgId, otherProject.id);
    const count = await activityCount(w.orgId);
    expect(await setTaskParent(w.member, other.id, 0, existingSub.id)).toEqual({
      ok: false,
      code: "SUBTASK_DEPTH",
    });
    expect(await setTaskParent(w.member, parent.id, 0, other.id)).toEqual({
      ok: false,
      code: "SUBTASK_DEPTH",
    });
    expect(await setTaskParent(w.member, other.id, 0, other.id)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "parentId",
    });
    expect(await setTaskParent(w.member, recurring.id, 0, other.id)).toEqual({
      ok: false,
      code: "RECURRENCE_ON_SUBTASK",
    });
    expect(await setTaskParent(w.member, other.id, 0, foreignParent.id)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      await createTask(w.member, w.project.id, { title: "deep", parentId: existingSub.id }),
    ).toEqual({ ok: false, code: "SUBTASK_DEPTH" });
    expect(await activityCount(w.orgId)).toBe(count);

    const review = await seedTask(prisma, w.orgId, w.project.id, {
      status: "REVIEW",
      rank: 90_000,
    });
    expect(await setTaskParent(w.member, child.id, 1, null)).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
    expect(await taskRow(w.orgId, child.id)).toMatchObject({
      parentId: null,
      status: "REVIEW",
      rank: 90_000 + 1024,
    });
    expect((await taskRow(w.orgId, review.id)).rank).toBe(90_000);
  });

  it("setTaskParent with a stale version is CONFLICT, changes nothing and writes no activity", async () => {
    const w = await taskWorld();
    const parent = await seedTask(prisma, w.orgId, w.project.id);
    const t = await seedTask(prisma, w.orgId, w.project.id);
    expect(await updateTask(w.member, t.id, 0, { title: "Bump" })).toMatchObject({ ok: true });
    const row = await taskRow(w.orgId, t.id);
    const count = await activityCount(w.orgId);
    expect(await setTaskParent(w.member, t.id, 0, parent.id)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await taskRow(w.orgId, t.id)).toEqual(row);
    expect(await activityCount(w.orgId)).toBe(count);
  });
});

describe("archived work refuses writes", () => {
  it("every write on an archived task, under an archived parent or in an archived project is ARCHIVED", async () => {
    const w = await taskWorld();
    const archived = await seedTask(prisma, w.orgId, w.project.id, { archivedAt: new Date() });
    const archivedParent = await seedTask(prisma, w.orgId, w.project.id, {
      archivedAt: new Date(),
    });
    const underArchived = await seedTask(prisma, w.orgId, w.project.id, {
      parentId: archivedParent.id,
    });
    const top = await seedTask(prisma, w.orgId, w.project.id);
    const archivedProject = await seedProject(prisma, w.orgId, {
      createdByUserId: w.users.manager,
      memberUserIds: [w.users.member],
      archivedAt: new Date(),
    });
    const inArchivedProject = await seedTask(prisma, w.orgId, archivedProject.id);
    const count = await activityCount(w.orgId);
    const refused = { ok: false, code: "ARCHIVED" };
    for (const id of [archived.id, underArchived.id, inArchivedProject.id]) {
      expect(await updateTask(w.member, id, 0, { title: "x" })).toEqual(refused);
      expect(await setTaskDates(w.member, id, 0, { dueDate: "2026-01-01" })).toEqual(refused);
      expect(await setTaskStatus(w.member, id, 0, "DONE")).toEqual(refused);
      expect(await setTaskParent(w.member, id, 0, null)).toEqual(refused);
    }
    expect(await setTaskParent(w.member, top.id, 0, archived.id)).toEqual(refused);
    expect(await createTask(w.member, archivedProject.id, { title: "x" })).toEqual(refused);
    expect(
      await createTask(w.member, w.project.id, { title: "x", parentId: archivedParent.id }),
    ).toEqual(refused);
    expect(await activityCount(w.orgId)).toBe(count);
  });
});

describe("task lists", () => {
  it("listProjectTasks filters by status, parent, assignee and archive state and pages by (rank, id)", async () => {
    const w = await taskWorld();
    const a = await seedTask(prisma, w.orgId, w.project.id, { rank: 100 });
    const b = await seedTask(prisma, w.orgId, w.project.id, {
      rank: 100,
      assigneeUserId: w.users.member,
    });
    const c = await seedTask(prisma, w.orgId, w.project.id, { rank: 50, status: "DONE" });
    const gone = await seedTask(prisma, w.orgId, w.project.id, { archivedAt: new Date() });
    const sub = await seedTask(prisma, w.orgId, w.project.id, { parentId: a.id });
    const ids = (r: Awaited<ReturnType<typeof listProjectTasks>>) =>
      r.ok ? r.tasks.map((t) => t.id) : r.code;
    const [first, second] = [a.id, b.id].sort();
    expect(ids(await listProjectTasks(w.member, w.project.id))).toEqual([c.id, first, second]);
    expect(ids(await listProjectTasks(w.member, w.project.id, { status: "DONE" }))).toEqual([c.id]);
    expect(ids(await listProjectTasks(w.member, w.project.id, { parentId: a.id }))).toEqual([
      sub.id,
    ]);
    expect(
      ids(await listProjectTasks(w.member, w.project.id, { assigneeUserId: w.users.member })),
    ).toEqual([b.id]);
    expect(ids(await listProjectTasks(w.member, w.project.id, { archived: "only" }))).toEqual([
      gone.id,
    ]);
    const page1 = await listProjectTasks(w.member, w.project.id, { limit: 2 });
    if (!page1.ok) throw new Error(page1.code);
    expect(page1.tasks.map((t) => t.id)).toEqual([c.id, first]);
    expect(page1.hasMore).toBe(true);
    const page2 = await listProjectTasks(w.member, w.project.id, {
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2).toMatchObject({ ok: true, hasMore: false, nextCursor: null });
    expect(ids(page2)).toEqual([second]);
  });

  it("listWorkspaceTasks returns only readable projects' tasks, filtered by assignee, status and due range", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const open = await seedTask(prisma, pw.orgA, pw.openProject.id, {
      assigneeUserId: pw.users.nonMember,
      dueDate: "2026-06-15",
    });
    await seedTask(prisma, pw.orgA, pw.openProject.id, { dueDate: "2026-08-01", status: "DONE" });
    const ids = (r: Awaited<ReturnType<typeof listWorkspaceTasks>>) =>
      r.ok ? r.tasks.map((t) => t.id) : r.code;
    const nonMemberAll = ids(await listWorkspaceTasks(pw.actors.nonMember));
    expect(nonMemberAll).not.toContain(pw.task.id);
    expect(nonMemberAll).not.toContain(pw.subtask.id);
    expect(nonMemberAll).toContain(open.id);
    const managerAll = ids(await listWorkspaceTasks(pw.actors.manager));
    expect(managerAll).toEqual(expect.arrayContaining([pw.task.id, pw.subtask.id, open.id]));
    expect(
      ids(await listWorkspaceTasks(pw.actors.manager, { assigneeUserId: pw.users.nonMember })),
    ).toEqual([open.id]);
    expect(
      ids(
        await listWorkspaceTasks(pw.actors.manager, {
          status: "TODO",
          dueFrom: "2026-06-01",
          dueTo: "2026-06-30",
        }),
      ),
    ).toEqual([open.id]);
  });
});
