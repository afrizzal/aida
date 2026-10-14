// Phase 14 task core (contract sections 4 to 8, 14 and 15) on a real Postgres through
// Testcontainers. Every case seeds fresh organizations; every mutation asserts its exact activity
// row and every refusal asserts that no activity row was written.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTask, getTask } from "@/lib/projects/tasks";
import { actorOf, seedOrgWithMembers, seedProject } from "../support/project-fixtures";

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
