// Phase 14 derived progress (contract section 9; D-11; AIDA-66, AIDA-100, SC7) on a real Postgres
// through Testcontainers. No mocks. Progress is computed on read: nothing is stored, so a status
// change shows in the next read.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getProjectProgress, getProjectsProgress, getTaskProgress } from "@/lib/projects/progress";
import { setTaskStatus } from "@/lib/projects/tasks";
import { actorOf, seedOrgWithMembers, seedProject, seedTask } from "../support/project-fixtures";

const NOW = new Date("2026-03-15T12:00:00Z");
const ARCHIVED_AT = new Date("2026-03-01T00:00:00Z");

async function world() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
  const managerId = org.users[1]?.id as string;
  const otherId = org.users[2]?.id as string;
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: managerId,
    managerUserIds: [managerId],
  });
  return {
    orgId: org.orgId,
    managerId,
    manager: actorOf(managerId, org.orgId),
    other: actorOf(otherId, org.orgId),
    project,
  };
}

describe("getProjectProgress", () => {
  it("an empty project is 0 percent of 0", async () => {
    const w = await world();
    expect(await getProjectProgress(w.manager, w.project.id)).toEqual({
      ok: true,
      done: 0,
      total: 0,
      percent: 0,
    });
  });

  it("counts top-level non-archived tasks only and follows a status change without a stored value", async () => {
    const w = await world();
    const done = await seedTask(prisma, w.orgId, w.project.id, { status: "DONE" });
    await seedTask(prisma, w.orgId, w.project.id, { status: "DONE", archivedAt: ARCHIVED_AT });
    const todo = await seedTask(prisma, w.orgId, w.project.id, { status: "TODO" });
    await seedTask(prisma, w.orgId, w.project.id, { parentId: done.id, status: "DONE" });
    await seedTask(prisma, w.orgId, w.project.id, { parentId: todo.id, status: "DONE" });
    expect(await getProjectProgress(w.manager, w.project.id)).toEqual({
      ok: true,
      done: 1,
      total: 2,
      percent: 50,
    });
    expect(await setTaskStatus(w.manager, todo.id, 0, "DONE", { now: NOW })).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(await getProjectProgress(w.manager, w.project.id)).toEqual({
      ok: true,
      done: 2,
      total: 2,
      percent: 100,
    });
  });

  it("rounds the percent down", async () => {
    const w = await world();
    await seedTask(prisma, w.orgId, w.project.id, { status: "DONE" });
    await seedTask(prisma, w.orgId, w.project.id, { status: "TODO" });
    await seedTask(prisma, w.orgId, w.project.id, { status: "REVIEW" });
    expect(await getProjectProgress(w.manager, w.project.id)).toEqual({
      ok: true,
      done: 1,
      total: 3,
      percent: 33,
    });
  });
});

describe("getTaskProgress", () => {
  it("is 0 without subtasks and counts non-archived subtasks only", async () => {
    const w = await world();
    const lone = await seedTask(prisma, w.orgId, w.project.id, {});
    expect(await getTaskProgress(w.manager, lone.id)).toEqual({
      ok: true,
      done: 0,
      total: 0,
      percent: 0,
    });
    const parent = await seedTask(prisma, w.orgId, w.project.id, {});
    await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id, status: "DONE" });
    await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id, status: "TODO" });
    await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id, status: "TODO" });
    await seedTask(prisma, w.orgId, w.project.id, {
      parentId: parent.id,
      status: "DONE",
      archivedAt: ARCHIVED_AT,
    });
    expect(await getTaskProgress(w.manager, parent.id)).toEqual({
      ok: true,
      done: 1,
      total: 3,
      percent: 33,
    });
  });

  it("a DONE parent with one open of two subtasks shows 50 percent as it is", async () => {
    const w = await world();
    const parent = await seedTask(prisma, w.orgId, w.project.id, { status: "DONE" });
    await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id, status: "DONE" });
    await seedTask(prisma, w.orgId, w.project.id, { parentId: parent.id, status: "IN_PROGRESS" });
    expect(await getTaskProgress(w.manager, parent.id)).toEqual({
      ok: true,
      done: 1,
      total: 2,
      percent: 50,
    });
    const stored = await prisma.task.findFirstOrThrow({ where: { id: parent.id } });
    expect(stored.status).toBe("DONE");
  });
});

describe("getProjectsProgress", () => {
  it("returns entries only for readable projects among the ids given, in the given order", async () => {
    const w = await world();
    const second = await seedProject(prisma, w.orgId, {
      createdByUserId: w.managerId,
      managerUserIds: [w.managerId],
    });
    const hidden = await seedProject(prisma, w.orgId, {
      createdByUserId: w.managerId,
      isPrivate: true,
      managerUserIds: [w.managerId],
    });
    await seedTask(prisma, w.orgId, w.project.id, { status: "DONE" });
    await seedTask(prisma, w.orgId, w.project.id, { status: "TODO" });
    await seedTask(prisma, w.orgId, hidden.id, { status: "DONE" });
    const ids = [second.id, hidden.id, w.project.id];
    expect(await getProjectsProgress(w.other, ids)).toEqual({
      ok: true,
      projects: [
        { projectId: second.id, done: 0, total: 0, percent: 0 },
        { projectId: w.project.id, done: 1, total: 2, percent: 50 },
      ],
    });
    expect(await getProjectsProgress(w.manager, ids)).toEqual({
      ok: true,
      projects: [
        { projectId: second.id, done: 0, total: 0, percent: 0 },
        { projectId: hidden.id, done: 1, total: 1, percent: 100 },
        { projectId: w.project.id, done: 1, total: 2, percent: 50 },
      ],
    });
  });
});
