// Phase 14 isolation of reorderTask, bulkUpdateTasks and the progress reads (contract sections 1,
// 2 and 17; K69; reviews P3 and C5; AIDA-71) on a real Postgres through Testcontainers. No mocks.
// One describe block per operation. TARGET (reorderTask, bulkUpdateTasks, getProjectProgress,
// getTaskProgress): manager and member get their result; teamMember (team only, K69), nonMember,
// orgAdmin and the outsider with their own organization get a result deep-equal to the call with
// missingId(); the outsider with organization A gets MEMBERSHIP_ENDED. LIST (getProjectsProgress):
// every actor succeeds and only the manager's result holds the private project. Every refused
// write leaves projectTableSnapshot() and the ProjectActivity count unchanged.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { bulkUpdateTasks } from "@/lib/projects/bulk";
import type { ProjectActor } from "@/lib/projects/contract";
import { reorderTask } from "@/lib/projects/ordering";
import { getProjectProgress, getProjectsProgress, getTaskProgress } from "@/lib/projects/progress";
import {
  actorOf,
  missingId,
  type PrivacyWorld,
  projectTableSnapshot,
  seedPrivacyWorld,
  seedTask,
} from "../support/project-fixtures";

const REFUSED = ["teamMember", "nonMember", "orgAdmin", "outsider"] as const;
const NOW = new Date("2026-03-15T12:00:00Z");

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

describe("reorderTask isolation", () => {
  it("manager and member reorder a task of the private project", async () => {
    for (const who of ["manager", "member"] as const) {
      const w = await seedPrivacyWorld(prisma);
      const later = await seedTask(prisma, w.orgA, w.project.id, {});
      const result = await reorderTask(
        w.actors[who],
        later.id,
        { placeAfterTaskId: null },
        { now: NOW },
      );
      expect(result, who).toMatchObject({ ok: true, changed: true });
      const rows = await prisma.projectActivity.findMany({ where: { organizationId: w.orgA } });
      expect(rows.map((r) => [r.verb, r.taskId])).toEqual([["TASK_REORDERED", later.id]]);
    }
  });

  it("teamMember, nonMember, orgAdmin and outsider get the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    const input = { placeAfterTaskId: null };
    for (const who of REFUSED) {
      const actor = w.actors[who];
      const result = await refusedWithoutWrite(w, () =>
        reorderTask(actor, w.task.id, input, { now: NOW }),
      );
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(await reorderTask(actor, missingId(), input, { now: NOW }));
    }
    const ended = await refusedWithoutWrite(w, () =>
      reorderTask(outsiderInA(w), w.task.id, input, { now: NOW }),
    );
    expect(ended).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});

describe("bulkUpdateTasks isolation", () => {
  it("manager and member update the private project's task", async () => {
    for (const who of ["manager", "member"] as const) {
      const w = await seedPrivacyWorld(prisma);
      const result = await bulkUpdateTasks(
        w.actors[who],
        [w.task.id],
        { priority: "HIGH" },
        { now: NOW },
      );
      expect(result, who).toEqual({ ok: true, changedCount: 1, batchId: expect.any(String) });
      const rows = await prisma.projectActivity.findMany({ where: { organizationId: w.orgA } });
      expect(rows.map((r) => [r.verb, r.taskId])).toEqual([["TASK_UPDATED", w.task.id]]);
    }
  });

  it("teamMember, nonMember, orgAdmin and outsider get the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    const patch = { priority: "HIGH" as const };
    for (const who of REFUSED) {
      const actor = w.actors[who];
      const result = await refusedWithoutWrite(w, () =>
        bulkUpdateTasks(actor, [w.task.id], patch, { now: NOW }),
      );
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(await bulkUpdateTasks(actor, [missingId()], patch, { now: NOW }));
    }
    const ended = await refusedWithoutWrite(w, () =>
      bulkUpdateTasks(outsiderInA(w), [w.task.id], patch, { now: NOW }),
    );
    expect(ended).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });

  it("a batch mixing a readable task and a task of an unreadable private project is NOT_FOUND as a whole", async () => {
    const w = await seedPrivacyWorld(prisma);
    const open = await seedTask(prisma, w.orgA, w.openProject.id, {});
    const patch = { priority: "HIGH" as const };
    for (const who of ["teamMember", "nonMember", "orgAdmin"] as const) {
      const actor = w.actors[who];
      const result = await refusedWithoutWrite(w, () =>
        bulkUpdateTasks(actor, [open.id, w.task.id], patch, { now: NOW }),
      );
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(
        await bulkUpdateTasks(actor, [open.id, missingId()], patch, { now: NOW }),
      );
    }
  });
});

describe("getProjectProgress isolation", () => {
  it("manager and member read the private project's progress", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const who of ["manager", "member"] as const) {
      expect(await getProjectProgress(w.actors[who], w.project.id), who).toEqual({
        ok: true,
        done: 0,
        total: 1,
        percent: 0,
      });
    }
  });

  it("teamMember, nonMember, orgAdmin and outsider get the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const who of REFUSED) {
      const actor = w.actors[who];
      const result = await getProjectProgress(actor, w.project.id);
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(await getProjectProgress(actor, missingId()));
    }
    expect(await getProjectProgress(outsiderInA(w), w.project.id)).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
  });
});

describe("getProjectsProgress isolation", () => {
  it("only the manager's and member's results hold the private project; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    const ids = [w.project.id, w.openProject.id];
    for (const who of ["manager", "member"] as const) {
      const result = await getProjectsProgress(w.actors[who], ids);
      expect(result, who).toEqual({
        ok: true,
        projects: [
          { projectId: w.project.id, done: 0, total: 1, percent: 0 },
          { projectId: w.openProject.id, done: 0, total: 0, percent: 0 },
        ],
      });
    }
    for (const who of ["teamMember", "nonMember", "orgAdmin"] as const) {
      const result = await getProjectsProgress(w.actors[who], ids);
      expect(result, who).toEqual({
        ok: true,
        projects: [{ projectId: w.openProject.id, done: 0, total: 0, percent: 0 }],
      });
      expect(JSON.stringify(result)).not.toContain(w.project.id);
    }
    const outsider = await getProjectsProgress(w.actors.outsider, ids);
    expect(outsider).toEqual({ ok: true, projects: [] });
    expect(await getProjectsProgress(outsiderInA(w), ids)).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
  });
});

describe("getTaskProgress isolation", () => {
  it("manager and member read the private task's subtask progress", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const who of ["manager", "member"] as const) {
      expect(await getTaskProgress(w.actors[who], w.task.id), who).toEqual({
        ok: true,
        done: 0,
        total: 1,
        percent: 0,
      });
    }
  });

  it("teamMember, nonMember, orgAdmin and outsider get the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const who of REFUSED) {
      const actor = w.actors[who];
      const result = await getTaskProgress(actor, w.task.id);
      expect(result, who).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(result, who).toEqual(await getTaskProgress(actor, missingId()));
    }
    expect(await getTaskProgress(outsiderInA(w), w.task.id)).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
  });
});
