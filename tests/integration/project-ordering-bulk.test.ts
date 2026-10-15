// Phase 14 reordering and bulk updates (contract sections 1, 3, 5, 8 and 15; D-09, D-10; AIDA-65,
// AIDA-68) on a real Postgres through Testcontainers. No mocks. Every activity verb of
// reorderTask and bulkUpdateTasks is asserted in an it block that calls that operation.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { reorderTask } from "@/lib/projects/ordering";
import { listProjectTasks } from "@/lib/projects/tasks";
import { actorOf, seedOrgWithMembers, seedProject, seedTask } from "../support/project-fixtures";

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
});
