// Phase 14 task keys and the key namespace (contract section 6; D-08, AIDA-101, AIDA-103) on a
// real Postgres through Testcontainers.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTask } from "@/lib/projects/tasks";
import { actorOf, seedOrgWithMembers, seedProject } from "../support/project-fixtures";

async function keyWorld() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const manager = org.users[1]?.id as string;
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    managerUserIds: [manager],
  });
  return { orgId: org.orgId, manager: actorOf(manager, org.orgId), project };
}

describe("task keys", () => {
  it("20 parallel creates in one project get the numbers 1 to 20 and 20 distinct keys", async () => {
    const w = await keyWorld();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createTask(w.manager, w.project.id, { title: `T${i}` })),
    );
    const numbers: number[] = [];
    const keys: string[] = [];
    for (const result of results) {
      if (!result.ok) throw new Error(`create refused: ${result.code}`);
      numbers.push(result.number);
      keys.push(result.key);
    }
    expect(numbers.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(keys).size).toBe(20);
    expect(
      await prisma.taskKey.count({ where: { organizationId: w.orgId, kind: "ACTIVE" } }),
    ).toBe(20);
  });

  it("createTask in a project whose counter is at 999999999 is KEY_SPACE_EXHAUSTED and writes nothing", async () => {
    const w = await keyWorld();
    await prisma.projectTaskCounter.updateMany({
      where: { organizationId: w.orgId, projectId: w.project.id },
      data: { lastNumber: 999_999_999 },
    });
    const activity = await prisma.projectActivity.count({ where: { organizationId: w.orgId } });
    expect(await createTask(w.manager, w.project.id, { title: "One too many" })).toEqual({
      ok: false,
      code: "KEY_SPACE_EXHAUSTED",
    });
    expect(await prisma.task.count({ where: { organizationId: w.orgId } })).toBe(0);
    expect(await prisma.taskKey.count({ where: { organizationId: w.orgId } })).toBe(0);
    expect(await prisma.projectActivity.count({ where: { organizationId: w.orgId } })).toBe(
      activity,
    );
  });
});
