// Phase 14 isolation of moveTask, duplicateTask and duplicateProject (Isolation class TARGET,
// contract sections 1, 2 and 17; K69; AIDA-71) on a real Postgres through Testcontainers. No
// mocks. One describe block per operation: manager and member get their result; teamMember (team
// only, K69), nonMember, orgAdmin and the outsider with their own organization get a result
// deep-equal to the call with missingId(); the outsider with organization A gets MEMBERSHIP_ENDED;
// every refused call leaves projectTableSnapshot() and the ProjectActivity count unchanged.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { ProjectActor } from "@/lib/projects/contract";
import { duplicateProject, duplicateTask } from "@/lib/projects/duplicate";
import { moveTask } from "@/lib/projects/move";
import {
  actorOf,
  missingId,
  type PrivacyWorld,
  projectTableSnapshot,
  seedPrivacyWorld,
  seedTask,
} from "../support/project-fixtures";

const REFUSED = ["teamMember", "nonMember", "orgAdmin", "outsider"] as const;

async function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

/** Runs a refused call and proves it changed no row and wrote no activity in either organization. */
async function refusedWithoutWrite<T>(w: PrivacyWorld, call: () => Promise<T>): Promise<T> {
  const beforeA = await projectTableSnapshot(prisma, w.orgA);
  const beforeB = await projectTableSnapshot(prisma, w.orgB);
  const countA = await activityCount(w.orgA);
  const countB = await activityCount(w.orgB);
  const result = await call();
  expect(await projectTableSnapshot(prisma, w.orgA)).toEqual(beforeA);
  expect(await projectTableSnapshot(prisma, w.orgB)).toEqual(beforeB);
  expect(await activityCount(w.orgA)).toBe(countA);
  expect(await activityCount(w.orgB)).toBe(countB);
  return result;
}

function outsiderInA(w: PrivacyWorld): ProjectActor {
  return actorOf(w.users.outsider, w.orgA);
}

describe("moveTask isolation", () => {
  it("manager and member move the private project's task to a project they can edit", async () => {
    for (const who of ["manager", "member"] as const) {
      const w = await seedPrivacyWorld(prisma);
      const result = await moveTask(w.actors[who], w.task.id, w.openProject.id, 0);
      expect(result).toMatchObject({ ok: true, taskId: w.task.id, subtaskCount: 1 });
      const rows = await prisma.projectActivity.findMany({
        where: { organizationId: w.orgA, verb: "TASK_MOVED" },
      });
      expect(rows.map((r) => [r.verb, r.projectId, r.relatedProjectId])).toEqual([
        ["TASK_MOVED", w.openProject.id, w.project.id],
      ]);
    }
  });

  it("teamMember, nonMember, orgAdmin and outsider get the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const who of REFUSED) {
      const actor = w.actors[who];
      const result = await refusedWithoutWrite(w, () =>
        moveTask(actor, w.task.id, w.openProject.id, 0),
      );
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(await moveTask(actor, missingId(), w.openProject.id, 0));
    }
    const ended = await refusedWithoutWrite(w, () =>
      moveTask(outsiderInA(w), w.task.id, w.openProject.id, 0),
    );
    expect(ended).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });

  it("moveTask into a private project the actor cannot read is NOT_FOUND", async () => {
    const w = await seedPrivacyWorld(prisma);
    const open = await seedTask(prisma, w.orgA, w.openProject.id, {});
    for (const who of ["teamMember", "nonMember", "orgAdmin"] as const) {
      const actor = w.actors[who];
      const result = await refusedWithoutWrite(w, () => moveTask(actor, open.id, w.project.id, 0));
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(await moveTask(actor, open.id, missingId(), 0));
    }
  });
});

describe("duplicateTask isolation", () => {
  it("manager and member duplicate the private project's task", async () => {
    for (const who of ["manager", "member"] as const) {
      const w = await seedPrivacyWorld(prisma);
      const result = await duplicateTask(w.actors[who], w.task.id);
      expect(result).toMatchObject({ ok: true, subtaskCount: 1 });
      const rows = await prisma.projectActivity.findMany({
        where: { organizationId: w.orgA, verb: "TASK_DUPLICATED" },
      });
      expect(rows.map((r) => [r.verb, r.projectId])).toEqual([
        ["TASK_DUPLICATED", w.project.id],
        ["TASK_DUPLICATED", w.project.id],
      ]);
    }
  });

  it("teamMember, nonMember, orgAdmin and outsider get the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const who of REFUSED) {
      const actor = w.actors[who];
      const result = await refusedWithoutWrite(w, () => duplicateTask(actor, w.task.id));
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(await duplicateTask(actor, missingId()));
    }
    const ended = await refusedWithoutWrite(w, () => duplicateTask(outsiderInA(w), w.task.id));
    expect(ended).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});

describe("duplicateProject isolation", () => {
  const input = { name: "Copy", keyPrefix: "ISO", includeTasks: true };

  it("manager and member duplicate the private project", async () => {
    for (const who of ["manager", "member"] as const) {
      const w = await seedPrivacyWorld(prisma);
      const result = await duplicateProject(w.actors[who], w.project.id, input);
      expect(result).toMatchObject({ ok: true, keyPrefix: "ISO", taskCount: 2 });
      if (!result.ok) continue;
      const rows = await prisma.projectActivity.findMany({
        where: { organizationId: w.orgA, projectId: result.projectId },
      });
      expect(rows.map((r) => r.verb).sort()).toEqual([
        "PROJECT_DUPLICATED",
        "TASK_DUPLICATED",
        "TASK_DUPLICATED",
      ]);
      expect(
        await prisma.projectMember.findMany({
          where: { organizationId: w.orgA, projectId: result.projectId },
          select: { userId: true, role: true },
        }),
      ).toEqual([{ userId: w.users[who], role: "MANAGER" }]);
    }
  });

  it("teamMember, nonMember, orgAdmin and outsider get the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const who of REFUSED) {
      const actor = w.actors[who];
      const result = await refusedWithoutWrite(w, () =>
        duplicateProject(actor, w.project.id, input),
      );
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(await duplicateProject(actor, missingId(), input));
    }
    const ended = await refusedWithoutWrite(w, () =>
      duplicateProject(outsiderInA(w), w.project.id, input),
    );
    expect(ended).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});
