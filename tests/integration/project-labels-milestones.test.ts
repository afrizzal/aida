// Phase 14 labels and milestones (contract sections 1, 5, 14 and 15; C4, AIDA-65, AIDA-105) on a
// real Postgres through Testcontainers: case-insensitive names per project (NAME_TAKEN), MANAGE
// for label and milestone management, CONTENT for a task's labels and milestone with a versioned
// conditional update, deletes that clear task references first and write affectedTaskCount, and
// a PID-bound race of deleteLabel against setTaskLabels (never a sleep).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  createLabel,
  deleteLabel,
  listLabels,
  setTaskLabels,
  updateLabel,
} from "@/lib/projects/labels";
import {
  createMilestone,
  deleteMilestone,
  listProjectMilestones,
  listWorkspaceMilestones,
  setTaskMilestone,
  updateMilestone,
} from "@/lib/projects/milestones";
import { waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
} from "../support/project-fixtures";
import {
  assertNoDeadlock,
  createObserverClient,
  createServiceRace,
  type ServiceRace,
  settleAll,
} from "../support/project-race";

let observer: PrismaClient;
let closeObserver: () => Promise<void>;
let race: ServiceRace | null = null;
const racePids: { race: string; holder: number; waiter: number }[] = [];

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-labels-milestones race PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
});

async function world() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
  const [admin, manager, member] = org.users.map((u) => u.id) as [string, string, string];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    isPrivate: true,
    managerUserIds: [manager],
    memberUserIds: [member],
  });
  const other = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    isPrivate: true,
    managerUserIds: [manager],
    memberUserIds: [member],
  });
  const task = await seedTask(prisma, org.orgId, project.id, { createdByUserId: manager });
  return {
    orgId: org.orgId,
    project,
    other,
    task,
    admin: actorOf(admin, org.orgId),
    manager: actorOf(manager, org.orgId),
    member: actorOf(member, org.orgId),
  };
}

const activityCount = (orgId: string) =>
  prisma.projectActivity.count({ where: { organizationId: orgId } });
const lastActivity = (orgId: string) =>
  prisma.projectActivity.findFirstOrThrow({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
const taskRow = (id: string) => prisma.task.findFirstOrThrow({ where: { id } });

describe("labels", () => {
  it("createLabel, NAME_TAKEN per project, NOT_ALLOWED for a member, updateLabel and deleteLabel with affectedTaskCount", async () => {
    const w = await world();
    const bug = await createLabel(w.manager, w.project.id, { name: "Bug" });
    expect(bug).toMatchObject({ ok: true, label: { name: "Bug", color: "gray" } });
    if (!bug.ok) throw new Error("no label");
    expect(await lastActivity(w.orgId)).toMatchObject({
      verb: "LABEL_CREATED",
      entityType: "LABEL",
      entityId: bug.label.id,
      projectId: w.project.id,
    });
    expect(await createLabel(w.manager, w.project.id, { name: "bug" })).toEqual({
      ok: false,
      code: "NAME_TAKEN",
    });
    expect(await createLabel(w.manager, w.other.id, { name: "Bug" })).toMatchObject({ ok: true });
    expect(await createLabel(w.member, w.project.id, { name: "Mine" })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    const ui = await createLabel(w.manager, w.project.id, { name: "UI", color: "blue" });
    if (!ui.ok) throw new Error("no label");
    expect(await updateLabel(w.manager, ui.label.id, { name: "BUG" })).toEqual({
      ok: false,
      code: "NAME_TAKEN",
    });
    expect(
      await updateLabel(w.manager, bug.label.id, { name: "Defect", color: "red" }),
    ).toMatchObject({ ok: true, changed: true, label: { name: "Defect", color: "red" } });
    expect(await lastActivity(w.orgId)).toMatchObject({
      verb: "LABEL_UPDATED",
      before: { name: "Bug", color: "gray" },
      after: { name: "Defect", color: "red" },
    });
    expect(await updateLabel(w.manager, bug.label.id, { name: "Defect" })).toEqual({
      ok: true,
      changed: false,
    });
    const listed = await listLabels(w.member, w.project.id);
    expect(listed.ok && listed.labels.map((l) => l.name)).toEqual(["Defect", "UI"]);

    const second = await seedTask(prisma, w.orgId, w.project.id, {
      labelIds: [bug.label.id],
    });
    await prisma.taskLabel.create({
      data: {
        organizationId: w.orgId,
        projectId: w.project.id,
        taskId: w.task.id,
        labelId: bug.label.id,
      },
    });
    expect(await deleteLabel(w.manager, bug.label.id)).toEqual({ ok: true, affectedTaskCount: 2 });
    expect(
      await prisma.taskLabel.count({ where: { taskId: { in: [w.task.id, second.id] } } }),
    ).toBe(0);
    expect(await prisma.projectLabel.count({ where: { id: bug.label.id } })).toBe(0);
    expect(await lastActivity(w.orgId)).toMatchObject({
      verb: "LABEL_DELETED",
      entityId: bug.label.id,
      after: { affectedTaskCount: 2 },
    });
  });

  it("setTaskLabels writes labelNames, increments the version, and refuses TOO_MANY, a foreign label and a stale version", async () => {
    const w = await world();
    const a = await seedLabel(prisma, w.orgId, w.project.id, { name: "Alpha" });
    const b = await seedLabel(prisma, w.orgId, w.project.id, { name: "Beta" });
    const foreign = await seedLabel(prisma, w.orgId, w.other.id, { name: "Gamma" });
    expect(await setTaskLabels(w.member, w.task.id, 0, [b.id, a.id])).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await lastActivity(w.orgId)).toMatchObject({
      verb: "TASK_UPDATED",
      entityType: "TASK",
      taskId: w.task.id,
      before: { labelNames: [] },
      after: { labelNames: ["Alpha", "Beta"] },
    });
    expect((await taskRow(w.task.id)).version).toBe(1);
    const count = await activityCount(w.orgId);
    expect(await setTaskLabels(w.member, w.task.id, 1, [a.id, b.id])).toEqual({
      ok: true,
      changed: false,
    });
    const many = Array.from({ length: 21 }, (_, i) => `label${i}`);
    expect(await setTaskLabels(w.member, w.task.id, 1, many)).toEqual({
      ok: false,
      code: "TOO_MANY",
    });
    expect(await setTaskLabels(w.member, w.task.id, 1, [foreign.id])).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "labelIds",
    });
    expect(await setTaskLabels(w.member, w.task.id, 0, [a.id])).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await activityCount(w.orgId)).toBe(count);
    expect((await taskRow(w.task.id)).version).toBe(1);
  });

  it("setTaskLabels stale version: CONFLICT, links and version unchanged, no activity row", async () => {
    const w = await world();
    const a = await seedLabel(prisma, w.orgId, w.project.id);
    expect(await setTaskLabels(w.member, w.task.id, 0, [a.id])).toMatchObject({ ok: true });
    const count = await activityCount(w.orgId);
    expect(await setTaskLabels(w.member, w.task.id, 0, [])).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await prisma.taskLabel.count({ where: { taskId: w.task.id } })).toBe(1);
    expect((await taskRow(w.task.id)).version).toBe(1);
    expect(await activityCount(w.orgId)).toBe(count);
  });

  it("race: deleteLabel held after its lock blocks setTaskLabels, which then returns INVALID_INPUT and writes nothing", async () => {
    const w = await world();
    const label = await seedLabel(prisma, w.orgId, w.project.id);
    race = createServiceRace();
    const held = race.holdAt("deleteLabel");
    const deleting = deleteLabel(w.manager, label.id);
    const holder = await held;
    const started = race.nextStartPid("setTaskLabels");
    const setting = setTaskLabels(w.member, w.task.id, 0, [label.id]);
    const waiter = await started;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "deleteLabel vs setTaskLabels", holder, waiter });
    const count = await activityCount(w.orgId);
    race.release();
    const results = await settleAll<unknown>([deleting, setting]);
    assertNoDeadlock(results);
    expect(results[0]).toEqual({ status: "fulfilled", value: { ok: true, affectedTaskCount: 0 } });
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { ok: false, code: "INVALID_INPUT", field: "labelIds" },
    });
    expect(await activityCount(w.orgId)).toBe(count + 1);
    expect(await prisma.taskLabel.count({ where: { taskId: w.task.id } })).toBe(0);
    expect((await taskRow(w.task.id)).version).toBe(0);
  });
});

describe("milestones", () => {
  it("createMilestone, NAME_TAKEN, updateMilestone and deleteMilestone with affectedTaskCount", async () => {
    const w = await world();
    const beta = await createMilestone(w.manager, w.project.id, {
      name: "Beta",
      date: "2026-06-30",
    });
    expect(beta).toMatchObject({ ok: true, milestone: { name: "Beta", date: "2026-06-30" } });
    if (!beta.ok) throw new Error("no milestone");
    expect(await lastActivity(w.orgId)).toMatchObject({
      verb: "MILESTONE_CREATED",
      entityType: "MILESTONE",
      after: { milestoneId: beta.milestone.id, name: "Beta", date: "2026-06-30" },
    });
    expect(
      await createMilestone(w.manager, w.project.id, { name: "BETA", date: "2026-07-01" }),
    ).toEqual({ ok: false, code: "NAME_TAKEN" });
    expect(
      await createMilestone(w.member, w.project.id, { name: "Mine", date: "2026-07-01" }),
    ).toEqual({ ok: false, code: "NOT_ALLOWED" });
    expect(await updateMilestone(w.manager, beta.milestone.id, 0, { date: "2026-07-15" })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await lastActivity(w.orgId)).toMatchObject({
      verb: "MILESTONE_UPDATED",
      before: { date: "2026-06-30" },
      after: { date: "2026-07-15" },
    });
    const tasked = await seedTask(prisma, w.orgId, w.project.id, {
      milestoneId: beta.milestone.id,
      status: "DONE",
    });
    await seedTask(prisma, w.orgId, w.project.id, { milestoneId: beta.milestone.id });
    const listed = await listProjectMilestones(w.member, w.project.id);
    expect(listed.ok && listed.milestones).toEqual([
      expect.objectContaining({ id: beta.milestone.id, taskCount: 2, doneCount: 1, version: 1 }),
    ]);
    expect(await deleteMilestone(w.manager, beta.milestone.id)).toEqual({
      ok: true,
      affectedTaskCount: 2,
    });
    expect(await taskRow(tasked.id)).toMatchObject({ milestoneId: null, version: 1 });
    expect(await lastActivity(w.orgId)).toMatchObject({
      verb: "MILESTONE_DELETED",
      entityId: beta.milestone.id,
      after: { affectedTaskCount: 2 },
    });
  });

  it("updateMilestone stale version: CONFLICT, milestone unchanged, no activity row", async () => {
    const w = await world();
    const m = await seedMilestone(prisma, w.orgId, w.project.id, {
      name: "Gate",
      date: "2026-05-01",
    });
    expect(await updateMilestone(w.manager, m.id, 0, { name: "Gate 1" })).toMatchObject({
      ok: true,
      version: 1,
    });
    const before = await prisma.projectMilestone.findFirstOrThrow({ where: { id: m.id } });
    const count = await activityCount(w.orgId);
    expect(
      await updateMilestone(w.manager, m.id, 0, {
        name: "Gate 2",
        date: "2026-09-09",
        description: "late",
      }),
    ).toEqual({ ok: false, code: "CONFLICT" });
    const after = await prisma.projectMilestone.findFirstOrThrow({ where: { id: m.id } });
    expect(after).toEqual(before);
    expect(after).toMatchObject({ name: "Gate 1", descriptionMarkdown: null, version: 1 });
    expect(await activityCount(w.orgId)).toBe(count);
  });

  it("setTaskMilestone sets and clears a milestone of the same project and refuses another project's", async () => {
    const w = await world();
    const m = await seedMilestone(prisma, w.orgId, w.project.id);
    const foreign = await seedMilestone(prisma, w.orgId, w.other.id);
    expect(await setTaskMilestone(w.member, w.task.id, 0, m.id)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await lastActivity(w.orgId)).toMatchObject({
      verb: "TASK_UPDATED",
      before: { milestoneId: null },
      after: { milestoneId: m.id },
    });
    expect(await setTaskMilestone(w.member, w.task.id, 1, foreign.id)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "milestoneId",
    });
    expect(await setTaskMilestone(w.member, w.task.id, 1, null)).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
    expect(await taskRow(w.task.id)).toMatchObject({ milestoneId: null, version: 2 });
  });

  it("setTaskMilestone stale version: CONFLICT, milestoneId and version unchanged, no activity row", async () => {
    const w = await world();
    const m = await seedMilestone(prisma, w.orgId, w.project.id);
    const n = await seedMilestone(prisma, w.orgId, w.project.id);
    expect(await setTaskMilestone(w.member, w.task.id, 0, m.id)).toMatchObject({ ok: true });
    const count = await activityCount(w.orgId);
    expect(await setTaskMilestone(w.member, w.task.id, 0, n.id)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await taskRow(w.task.id)).toMatchObject({ milestoneId: m.id, version: 1 });
    expect(await activityCount(w.orgId)).toBe(count);
  });

  it("listWorkspaceMilestones returns readable, non-archived projects' milestones in range, never a hidden private one", async () => {
    const w = await world();
    const open = await seedProject(prisma, w.orgId, {
      createdByUserId: w.manager.userId,
      isPrivate: false,
      managerUserIds: [w.manager.userId],
    });
    const archived = await seedProject(prisma, w.orgId, {
      createdByUserId: w.manager.userId,
      isPrivate: false,
      archivedAt: new Date(),
      managerUserIds: [w.manager.userId],
    });
    const hidden = await seedMilestone(prisma, w.orgId, w.project.id, { date: "2026-03-01" });
    const visible = await seedMilestone(prisma, w.orgId, open.id, { date: "2026-03-02" });
    const late = await seedMilestone(prisma, w.orgId, open.id, { date: "2026-12-01" });
    await seedMilestone(prisma, w.orgId, archived.id, { date: "2026-03-03" });
    const forAdmin = await listWorkspaceMilestones(w.admin, {
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(forAdmin.ok && forAdmin.milestones.map((m) => m.id)).toEqual([visible.id]);
    const forManager = await listWorkspaceMilestones(w.manager, {
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(forManager.ok && forManager.milestones.map((m) => m.id)).toEqual([
      hidden.id,
      visible.id,
    ]);
    const all = await listWorkspaceMilestones(w.admin);
    expect(all.ok && all.milestones.map((m) => m.id)).toEqual([visible.id, late.id]);
  });
});
