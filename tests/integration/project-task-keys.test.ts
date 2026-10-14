// Phase 14 task keys and the key namespace (contract section 6; D-08, AIDA-101, AIDA-103) on a
// real Postgres through Testcontainers.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  aliasTaskKeyInTx,
  issueTaskKeyInTx,
  resolveTaskKey,
  tombstoneTaskKeysInTx,
} from "@/lib/projects/keys";
import type { ProjectDb } from "@/lib/projects/service";
import { createTask } from "@/lib/projects/tasks";
import { actorOf, seedOrgWithMembers, seedProject, seedTask } from "../support/project-fixtures";

async function keyWorld(keyPrefix?: string) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const manager = org.users[1]?.id as string;
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    keyPrefix,
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

describe("key namespace", () => {
  it("an alias and a new active key both resolve, tombstones and malformed keys are NOT_FOUND", async () => {
    const w = await keyWorld("OPS");
    const t = await seedTask(prisma, w.orgId, w.project.id);
    expect(t.key).toBe("OPS-1");
    expect(await resolveTaskKey(w.manager, " ops-1 ")).toEqual({
      ok: true,
      taskId: t.id,
      key: "OPS-1",
      projectId: w.project.id,
      isAlias: false,
    });
    await prisma.$transaction(async (raw) => {
      const tx = raw as unknown as ProjectDb;
      expect(await aliasTaskKeyInTx(tx, w.orgId, "OPS-1")).toBe(1);
      expect(
        await issueTaskKeyInTx(tx, {
          orgId: w.orgId,
          projectId: w.project.id,
          taskId: t.id,
          prefix: "NEW",
          number: 1,
        }),
      ).toBe("NEW-1");
      await tx.task.updateMany({
        where: { id: t.id, organizationId: w.orgId },
        data: { key: "NEW-1" },
      });
    });
    const expected = { ok: true, taskId: t.id, key: "NEW-1", projectId: w.project.id };
    expect(await resolveTaskKey(w.manager, "ops-1")).toEqual({ ...expected, isAlias: true });
    expect(await resolveTaskKey(w.manager, "NEW-1")).toEqual({ ...expected, isAlias: false });
    expect(
      await prisma.taskKey.findMany({
        where: { organizationId: w.orgId },
        orderBy: { normalizedKey: "asc" },
        select: { normalizedKey: true, kind: true },
      }),
    ).toEqual([
      { normalizedKey: "NEW-1", kind: "ACTIVE" },
      { normalizedKey: "OPS-1", kind: "ALIAS" },
    ]);

    await prisma.$transaction(async (raw) => {
      expect(await tombstoneTaskKeysInTx(raw as unknown as ProjectDb, w.orgId, [t.id])).toBe(2);
    });
    const missing = { ok: false, code: "NOT_FOUND" };
    expect(await resolveTaskKey(w.manager, "OPS-1")).toEqual(missing);
    expect(await resolveTaskKey(w.manager, "NEW-1")).toEqual(missing);
    for (const malformed of ["OPS-0", "OPS1", "", "1-OPS", "OPS-01"]) {
      expect(await resolveTaskKey(w.manager, malformed)).toEqual(missing);
    }
  });

  it("a key of another organization is NOT_FOUND and an actor without membership is MEMBERSHIP_ENDED", async () => {
    const w = await keyWorld("OPS");
    await seedTask(prisma, w.orgId, w.project.id);
    const other = await keyWorld("OPS");
    expect(await resolveTaskKey(other.manager, "OPS-1")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await resolveTaskKey(actorOf(other.manager.userId, w.orgId), "OPS-1")).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
  });
});
