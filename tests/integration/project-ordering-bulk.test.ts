// Phase 14 reordering and bulk updates (contract sections 1, 3, 5, 8 and 15; D-09, D-10; AIDA-65,
// AIDA-68) on a real Postgres through Testcontainers. No mocks. Every activity verb of
// reorderTask and bulkUpdateTasks is asserted in an it block that calls that operation.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { bulkUpdateTasks } from "@/lib/projects/bulk";
import { reorderTask } from "@/lib/projects/ordering";
import { listProjectTasks } from "@/lib/projects/tasks";
import {
  actorOf,
  missingId,
  projectTableSnapshot,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
} from "../support/project-fixtures";

const NOW = new Date("2026-03-15T12:00:00Z");

async function world() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
  const managerId = org.users[1]?.id as string;
  const memberId = org.users[2]?.id as string;
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: managerId,
    managerUserIds: [managerId],
    memberUserIds: [memberId],
  });
  return {
    orgId: org.orgId,
    managerId,
    memberId,
    manager: actorOf(managerId, org.orgId),
    project,
  };
}

type World = Awaited<ReturnType<typeof world>>;

function activityOf(w: World, taskId?: string) {
  return prisma.projectActivity.findMany({
    where: { organizationId: w.orgId, ...(taskId ? { taskId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function order(w: World, status: "TODO" | "IN_PROGRESS" | "DONE" | "BACKLOG" | "REVIEW") {
  const result = await listProjectTasks(w.manager, w.project.id, { status });
  if (!result.ok) throw new Error(`listProjectTasks refused: ${result.code}`);
  return result.tasks.map((t) => t.id);
}

describe("reorderTask", () => {
  it("drags a TODO task between two IN_PROGRESS tasks: lands there, one TASK_STATUS_CHANGED row", async () => {
    const w = await world();
    const t1 = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO", rank: 1024 });
    const p1 = await seedTask(prisma, w.orgId, w.project.id, { status: "IN_PROGRESS", rank: 1024 });
    const p2 = await seedTask(prisma, w.orgId, w.project.id, { status: "IN_PROGRESS", rank: 2048 });
    const result = await reorderTask(
      w.manager,
      t1.id,
      { status: "IN_PROGRESS", placeAfterTaskId: p1.id },
      { now: NOW },
    );
    expect(result).toEqual({
      ok: true,
      changed: true,
      status: "IN_PROGRESS",
      rank: 1536,
      version: 1,
    });
    expect(await order(w, "IN_PROGRESS")).toEqual([p1.id, t1.id, p2.id]);
    const task = await prisma.task.findFirstOrThrow({ where: { id: t1.id } });
    expect(task.version).toBe(1);
    const rows = await activityOf(w);
    expect(rows.map((r) => [r.verb, r.taskId, r.before, r.after])).toEqual([
      [
        "TASK_STATUS_CHANGED",
        t1.id,
        { status: "TODO", rank: 1024 },
        { status: "IN_PROGRESS", rank: 1536 },
      ],
    ]);
  });

  it("moves a task first in its column: one TASK_REORDERED row, no version change", async () => {
    const w = await world();
    const p1 = await seedTask(prisma, w.orgId, w.project.id, { status: "IN_PROGRESS", rank: 1024 });
    const p2 = await seedTask(prisma, w.orgId, w.project.id, { status: "IN_PROGRESS", rank: 2048 });
    const result = await reorderTask(w.manager, p2.id, { placeAfterTaskId: null }, { now: NOW });
    expect(result).toEqual({
      ok: true,
      changed: true,
      status: "IN_PROGRESS",
      rank: 512,
      version: 0,
    });
    expect(await order(w, "IN_PROGRESS")).toEqual([p2.id, p1.id]);
    const task = await prisma.task.findFirstOrThrow({ where: { id: p2.id } });
    expect(task.version).toBe(0);
    const rows = await activityOf(w);
    expect(rows.map((r) => [r.verb, r.taskId, r.before, r.after])).toEqual([
      ["TASK_REORDERED", p2.id, { rank: 2048 }, { rank: 512 }],
    ]);
  });

  it("rebalances the group when the neighbours' ranks are adjacent integers and keeps the order", async () => {
    const w = await world();
    const a = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO", rank: 10 });
    const b = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO", rank: 11 });
    const c = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO", rank: 12 });
    const d = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO", rank: 5000 });
    const result = await reorderTask(w.manager, d.id, { placeAfterTaskId: a.id }, { now: NOW });
    expect(result).toMatchObject({ ok: true, changed: true, status: "TODO", version: 0 });
    expect(await order(w, "TODO")).toEqual([a.id, d.id, b.id, c.id]);
    const ranks = await prisma.task.findMany({
      where: { organizationId: w.orgId, projectId: w.project.id },
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      select: { id: true, rank: true },
    });
    expect(ranks.map((r) => r.id)).toEqual([a.id, d.id, b.id, c.id]);
    expect(ranks.filter((r) => r.id !== d.id).map((r) => r.rank)).toEqual([1024, 2048, 3072]);
    const rows = await activityOf(w);
    expect(rows.map((r) => [r.verb, r.taskId])).toEqual([["TASK_REORDERED", d.id]]);
  });

  it("moves a recurring task into DONE: one successor, TASK_STATUS_CHANGED plus TASK_RECURRED", async () => {
    const w = await world();
    const recurrence = { rule: "DAILY" as const, anchor: "2026-03-01", timeZone: "UTC" };
    const r = await seedTask(prisma, w.orgId, w.project.id, {
      status: "TODO",
      dueDate: "2026-03-10",
      recurrence,
    });
    const result = await reorderTask(
      w.manager,
      r.id,
      { status: "DONE", placeAfterTaskId: null },
      { now: NOW },
    );
    expect(result).toMatchObject({ ok: true, changed: true, status: "DONE", version: 1 });
    const successors = await prisma.task.findMany({
      where: { organizationId: w.orgId, recurrencePredecessorId: r.id },
      select: { id: true },
    });
    expect(successors).toHaveLength(1);
    const rows = await activityOf(w);
    expect(rows.map((row) => row.verb).sort()).toEqual(["TASK_RECURRED", "TASK_STATUS_CHANGED"]);
    const changed = rows.find((row) => row.verb === "TASK_STATUS_CHANGED");
    const recurred = rows.find((row) => row.verb === "TASK_RECURRED");
    expect(changed?.taskId).toBe(r.id);
    expect(changed?.before).toMatchObject({ status: "TODO" });
    expect(changed?.after).toMatchObject({ status: "DONE" });
    expect(recurred?.entityId).toBe(successors[0]?.id);
    expect(recurred?.batchId).toBe(changed?.batchId);
  });

  it("a subtask reorders within its parent only; another group's task is INVALID_INPUT", async () => {
    const w = await world();
    const parent = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO" });
    const other = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO" });
    const s1 = await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id, rank: 1024 });
    const s2 = await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id, rank: 2048 });
    const s3 = await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id, rank: 3072 });
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(
      await reorderTask(w.manager, s3.id, { placeAfterTaskId: other.id }, { now: NOW }),
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "placeAfterTaskId" });
    expect(
      await reorderTask(w.manager, other.id, { placeAfterTaskId: s1.id }, { now: NOW }),
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "placeAfterTaskId" });
    expect(
      await reorderTask(w.manager, s3.id, { placeAfterTaskId: missingId() }, { now: NOW }),
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "placeAfterTaskId" });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    const moved = await reorderTask(w.manager, s3.id, { placeAfterTaskId: s1.id }, { now: NOW });
    expect(moved).toMatchObject({ ok: true, changed: true, rank: 1536 });
    const subs = await listProjectTasks(w.manager, w.project.id, { parentId: parent.id });
    expect(subs.ok && subs.tasks.map((t) => t.id)).toEqual([s1.id, s3.id, s2.id]);
  });

  it("an archived task is ARCHIVED and the current placement is a no-op without a row", async () => {
    const w = await world();
    const a = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO", rank: 1024 });
    const b = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO", rank: 2048 });
    const gone = await seedTask(prisma, w.orgId, w.project.id, {
      status: "TODO",
      archivedAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect(await reorderTask(w.manager, gone.id, { placeAfterTaskId: null }, { now: NOW })).toEqual(
      { ok: false, code: "ARCHIVED" },
    );
    expect(await reorderTask(w.manager, b.id, { placeAfterTaskId: a.id }, { now: NOW })).toEqual({
      ok: true,
      changed: false,
    });
    expect(await reorderTask(w.manager, a.id, { placeAfterTaskId: null }, { now: NOW })).toEqual({
      ok: true,
      changed: false,
    });
    expect(await activityOf(w)).toEqual([]);
  });
});

describe("bulkUpdateTasks", () => {
  async function twoProjects() {
    const w = await world();
    const second = await seedProject(prisma, w.orgId, {
      createdByUserId: w.managerId,
      managerUserIds: [w.managerId],
    });
    return { ...w, second };
  }

  it("updates priority and due date of 3 tasks in two projects: one TASK_UPDATED per changed task, shared batchId", async () => {
    const w = await twoProjects();
    const a = await seedTask(prisma, w.orgId, w.project.id, {});
    const b = await seedTask(prisma, w.orgId, w.project.id, {});
    const c = await seedTask(prisma, w.orgId, w.second.id, {});
    const same = await seedTask(prisma, w.orgId, w.second.id, {});
    await prisma.task.update({
      where: { id: same.id },
      data: { priority: "HIGH", dueDate: new Date("2026-05-01T00:00:00Z") },
    });
    const result = await bulkUpdateTasks(
      w.manager,
      [a.id, b.id, c.id, same.id],
      { priority: "HIGH", dueDate: "2026-05-01" },
      { now: NOW },
    );
    expect(result).toEqual({ ok: true, changedCount: 3, batchId: expect.any(String) });
    if (!result.ok) return;
    const rows = await activityOf(w);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.verb).toBe("TASK_UPDATED");
      expect(row.batchId).toBe(result.batchId);
      expect(row.before).toEqual({ priority: "NONE", dueDate: null });
      expect(row.after).toEqual({ priority: "HIGH", dueDate: "2026-05-01" });
    }
    expect(rows.map((r) => r.taskId).sort()).toEqual([a.id, b.id, c.id].sort());
    const versions = await prisma.task.findMany({
      where: { id: { in: [a.id, b.id, c.id, same.id] } },
      select: { id: true, version: true },
    });
    expect(Object.fromEntries(versions.map((v) => [v.id, v.version]))).toEqual({
      [a.id]: 1,
      [b.id]: 1,
      [c.id]: 1,
      [same.id]: 0,
    });
  });

  it("status DONE on a recurring task: one TASK_STATUS_CHANGED with the other keys and one TASK_RECURRED", async () => {
    const w = await world();
    const recurrence = { rule: "DAILY" as const, anchor: "2026-03-01", timeZone: "UTC" };
    const r = await seedTask(prisma, w.orgId, w.project.id, {
      status: "TODO",
      dueDate: "2026-03-10",
      recurrence,
    });
    const result = await bulkUpdateTasks(
      w.manager,
      [r.id],
      { status: "DONE", priority: "URGENT" },
      { now: NOW },
    );
    expect(result).toEqual({ ok: true, changedCount: 1, batchId: expect.any(String) });
    if (!result.ok) return;
    const rows = await activityOf(w);
    const changed = rows.filter((row) => row.verb === "TASK_STATUS_CHANGED");
    const recurred = rows.filter((row) => row.verb === "TASK_RECURRED");
    expect(rows).toHaveLength(2);
    expect(changed).toHaveLength(1);
    expect(recurred).toHaveLength(1);
    expect(changed[0]?.taskId).toBe(r.id);
    expect(changed[0]?.before).toEqual({ status: "TODO", priority: "NONE" });
    expect(changed[0]?.after).toEqual({ status: "DONE", priority: "URGENT" });
    expect(changed[0]?.batchId).toBe(result.batchId);
    expect(recurred[0]?.batchId).toBe(result.batchId);
    const successors = await prisma.task.findMany({
      where: { organizationId: w.orgId, recurrencePredecessorId: r.id },
      select: { id: true },
    });
    expect(successors).toHaveLength(1);
    expect(recurred[0]?.entityId).toBe(successors[0]?.id);
    const task = await prisma.task.findFirstOrThrow({ where: { id: r.id } });
    expect(task.version).toBe(1);
    expect(task.priority).toBe("URGENT");
  });

  it("refuses TOO_MANY, empty input, INVALID_DATE_RANGE, NOT_ELIGIBLE, foreign milestone or label and ARCHIVED as a whole, changing nothing", async () => {
    const w = await twoProjects();
    const privateProject = await seedProject(prisma, w.orgId, {
      createdByUserId: w.managerId,
      isPrivate: true,
      managerUserIds: [w.managerId],
    });
    const a = await seedTask(prisma, w.orgId, w.project.id, {});
    const dated = await seedTask(prisma, w.orgId, w.project.id, { startDate: "2026-06-01" });
    const priv = await seedTask(prisma, w.orgId, privateProject.id, {});
    const archived = await seedTask(prisma, w.orgId, w.second.id, {
      archivedAt: new Date("2026-03-01T00:00:00Z"),
    });
    const foreignMilestone = await seedMilestone(prisma, w.orgId, w.second.id);
    const foreignLabel = await seedLabel(prisma, w.orgId, w.second.id);
    const before = await projectTableSnapshot(prisma, w.orgId);
    const many = Array.from({ length: 101 }, () => missingId());
    const cases: [readonly string[], Parameters<typeof bulkUpdateTasks>[2], unknown][] = [
      [many, { priority: "HIGH" }, { ok: false, code: "TOO_MANY" }],
      [[], { priority: "HIGH" }, { ok: false, code: "INVALID_INPUT", field: "taskIds" }],
      [[a.id], {}, { ok: false, code: "INVALID_INPUT", field: "patch" }],
      [[a.id, dated.id], { dueDate: "2026-05-01" }, { ok: false, code: "INVALID_DATE_RANGE" }],
      [[a.id, priv.id], { assigneeUserId: w.memberId }, { ok: false, code: "NOT_ELIGIBLE" }],
      [
        [a.id],
        { milestoneId: foreignMilestone.id },
        { ok: false, code: "INVALID_INPUT", field: "milestoneId" },
      ],
      [
        [a.id],
        { addLabelIds: [foreignLabel.id] },
        { ok: false, code: "INVALID_INPUT", field: "labelIds" },
      ],
      [[a.id, archived.id], { priority: "HIGH" }, { ok: false, code: "ARCHIVED" }],
    ];
    for (const [ids, patch, expected] of cases) {
      expect(await bulkUpdateTasks(w.manager, ids, patch, { now: NOW })).toEqual(expected);
      expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    }
    expect(await activityOf(w)).toEqual([]);
  });

  it("adds and removes labels within each task's project", async () => {
    const w = await world();
    const keep = await seedLabel(prisma, w.orgId, w.project.id, { name: "keep" });
    const drop = await seedLabel(prisma, w.orgId, w.project.id, { name: "drop" });
    const add = await seedLabel(prisma, w.orgId, w.project.id, { name: "add" });
    const a = await seedTask(prisma, w.orgId, w.project.id, { labelIds: [keep.id, drop.id] });
    const b = await seedTask(prisma, w.orgId, w.project.id, { labelIds: [add.id] });
    const result = await bulkUpdateTasks(
      w.manager,
      [a.id, b.id],
      { addLabelIds: [add.id], removeLabelIds: [drop.id] },
      { now: NOW },
    );
    expect(result).toMatchObject({ ok: true, changedCount: 1 });
    const links = await prisma.taskLabel.findMany({
      where: { organizationId: w.orgId, taskId: a.id },
      select: { labelId: true },
    });
    expect(links.map((l) => l.labelId).sort()).toEqual([keep.id, add.id].sort());
    const rows = await activityOf(w);
    expect(rows.map((r) => [r.verb, r.taskId, r.before, r.after])).toEqual([
      ["TASK_UPDATED", a.id, { labelNames: ["drop", "keep"] }, { labelNames: ["add", "keep"] }],
    ]);
  });
});
