// Phase 14 task isolation (contract section 17, review C5, K69) on a real Postgres through
// Testcontainers. Every task operation and resolveTaskKey is called by each actor of the privacy
// world on a private project: manager and member succeed; teamMember (team only, K69),
// nonMember, orgAdmin and outsider get a result deep-equal to the call with missingId() (TARGET),
// see none of the private tasks (LIST) or get the missing-key result (KEY); the outsider with
// organization A gets MEMBERSHIP_ENDED; refused writes change no row and add no activity.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { aliasTaskKeyInTx, issueTaskKeyInTx, resolveTaskKey } from "@/lib/projects/keys";
import type { ProjectDb } from "@/lib/projects/service";
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
  missingId,
  type PrivacyWorld,
  projectActivityCounts,
  projectTableSnapshotAll,
  seedPrivacyWorld,
} from "../support/project-fixtures";

const ENDED = { ok: false, code: "MEMBERSHIP_ENDED" };

function refused(pw: PrivacyWorld) {
  return [pw.actors.teamMember, pw.actors.nonMember, pw.actors.orgAdmin, pw.actors.outsider];
}

function endedOutsider(pw: PrivacyWorld) {
  return actorOf(pw.users.outsider, pw.orgA);
}

describe("createTask isolation", () => {
  it("only project members create; the rest get the missing-id result and nothing is written", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB]);
    const count = await projectActivityCounts(prisma, [pw.orgA, pw.orgB]);
    for (const actor of refused(pw)) {
      expect(await createTask(actor, pw.project.id, { title: "x" })).toEqual(
        await createTask(actor, missingId(), { title: "x" }),
      );
    }
    expect(await createTask(endedOutsider(pw), pw.project.id, { title: "x" })).toEqual(ENDED);
    expect(await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB])).toEqual(snapshot);
    expect(await projectActivityCounts(prisma, [pw.orgA, pw.orgB])).toEqual(count);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      expect(await createTask(actor, pw.project.id, { title: "ok" })).toMatchObject({ ok: true });
    }
  });
});

describe("getTask isolation", () => {
  it("only project members read the task", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      expect(await getTask(actor, pw.task.id)).toEqual(await getTask(actor, missingId()));
      expect(await getTask(actor, pw.subtask.id)).toEqual(await getTask(actor, missingId()));
    }
    expect(await getTask(endedOutsider(pw), pw.task.id)).toEqual(ENDED);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      expect(await getTask(actor, pw.task.id)).toMatchObject({
        ok: true,
        task: { id: pw.task.id, key: pw.task.key },
      });
    }
  });
});

describe("listProjectTasks isolation", () => {
  it("only project members list the tasks", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      expect(await listProjectTasks(actor, pw.project.id)).toEqual(
        await listProjectTasks(actor, missingId()),
      );
    }
    expect(await listProjectTasks(endedOutsider(pw), pw.project.id)).toEqual(ENDED);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      const result = await listProjectTasks(actor, pw.project.id);
      expect(result.ok && result.tasks.map((t) => t.id)).toEqual([pw.task.id]);
    }
  });
});

describe("listWorkspaceTasks isolation", () => {
  it("refused actors see no private task, members see them (missingId is not used: LIST)", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const secrets = [pw.task.id, pw.subtask.id, pw.project.id, pw.task.key, pw.subtask.key];
    for (const actor of refused(pw)) {
      const result = await listWorkspaceTasks(actor);
      expect(result.ok).toBe(true);
      const text = JSON.stringify(result);
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    expect(await listWorkspaceTasks(endedOutsider(pw))).toEqual(ENDED);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      const result = await listWorkspaceTasks(actor);
      expect(result.ok && result.tasks.map((t) => t.id)).toEqual(
        expect.arrayContaining([pw.task.id, pw.subtask.id]),
      );
    }
  });
});

describe("updateTask isolation", () => {
  it("only project members edit; refused calls change no row and add no activity", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB]);
    const count = await projectActivityCounts(prisma, [pw.orgA, pw.orgB]);
    for (const actor of refused(pw)) {
      expect(await updateTask(actor, pw.task.id, 0, { title: "x" })).toEqual(
        await updateTask(actor, missingId(), 0, { title: "x" }),
      );
    }
    expect(await updateTask(endedOutsider(pw), pw.task.id, 0, { title: "x" })).toEqual(ENDED);
    expect(await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB])).toEqual(snapshot);
    expect(await projectActivityCounts(prisma, [pw.orgA, pw.orgB])).toEqual(count);
    expect(await updateTask(pw.actors.member, pw.task.id, 0, { title: "m" })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await updateTask(pw.actors.manager, pw.task.id, 1, { title: "g" })).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
  });
});

describe("setTaskDates isolation", () => {
  it("only project members set dates; refused calls change no row and add no activity", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const dates = { startDate: "2026-02-01", dueDate: "2026-02-10" };
    const snapshot = await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB]);
    const count = await projectActivityCounts(prisma, [pw.orgA, pw.orgB]);
    for (const actor of refused(pw)) {
      expect(await setTaskDates(actor, pw.task.id, 0, dates)).toEqual(
        await setTaskDates(actor, missingId(), 0, dates),
      );
    }
    expect(await setTaskDates(endedOutsider(pw), pw.task.id, 0, dates)).toEqual(ENDED);
    expect(await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB])).toEqual(snapshot);
    expect(await projectActivityCounts(prisma, [pw.orgA, pw.orgB])).toEqual(count);
    expect(await setTaskDates(pw.actors.member, pw.task.id, 0, dates)).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(
      await setTaskDates(pw.actors.manager, pw.task.id, 1, { dueDate: "2026-03-01" }),
    ).toMatchObject({ ok: true, changed: true });
  });
});

describe("setTaskStatus isolation", () => {
  it("only project members move the status; refused calls change no row and add no activity", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB]);
    const count = await projectActivityCounts(prisma, [pw.orgA, pw.orgB]);
    for (const actor of refused(pw)) {
      expect(await setTaskStatus(actor, pw.task.id, 0, "DONE")).toEqual(
        await setTaskStatus(actor, missingId(), 0, "DONE"),
      );
    }
    expect(await setTaskStatus(endedOutsider(pw), pw.task.id, 0, "DONE")).toEqual(ENDED);
    expect(await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB])).toEqual(snapshot);
    expect(await projectActivityCounts(prisma, [pw.orgA, pw.orgB])).toEqual(count);
    expect(await setTaskStatus(pw.actors.member, pw.task.id, 0, "IN_PROGRESS")).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(await setTaskStatus(pw.actors.manager, pw.task.id, 1, "DONE")).toMatchObject({
      ok: true,
      changed: true,
    });
  });
});

describe("setTaskParent isolation", () => {
  it("only project members reparent; refused calls change no row and add no activity", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB]);
    const count = await projectActivityCounts(prisma, [pw.orgA, pw.orgB]);
    for (const actor of refused(pw)) {
      expect(await setTaskParent(actor, pw.subtask.id, 0, null)).toEqual(
        await setTaskParent(actor, missingId(), 0, null),
      );
    }
    expect(await setTaskParent(endedOutsider(pw), pw.subtask.id, 0, null)).toEqual(ENDED);
    expect(await projectTableSnapshotAll(prisma, [pw.orgA, pw.orgB])).toEqual(snapshot);
    expect(await projectActivityCounts(prisma, [pw.orgA, pw.orgB])).toEqual(count);
    expect(await setTaskParent(pw.actors.member, pw.subtask.id, 0, null)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await setTaskParent(pw.actors.manager, pw.subtask.id, 1, pw.task.id)).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
  });
});

describe("resolveTaskKey isolation", () => {
  it("active and ALIAS keys resolve only for readers; the rest get the missing-key result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    // missingId() has no key form (KEY class): a well-formed key that exists nowhere stands in.
    const nowhere = "NOWHERE-1";
    expect(missingId()).not.toBe(nowhere);
    for (const actor of refused(pw)) {
      expect(await resolveTaskKey(actor, pw.task.key)).toEqual(
        await resolveTaskKey(actor, nowhere),
      );
    }
    expect(await resolveTaskKey(endedOutsider(pw), pw.task.key)).toEqual(ENDED);

    // The state a move leaves: the old key an ALIAS, a new ACTIVE key for the same task.
    const oldKey = pw.task.key;
    let newKey = "";
    await prisma.$transaction(async (raw) => {
      const tx = raw as unknown as ProjectDb;
      expect(await aliasTaskKeyInTx(tx, pw.orgA, oldKey)).toBe(1);
      newKey = await issueTaskKeyInTx(tx, {
        orgId: pw.orgA,
        projectId: pw.project.id,
        taskId: pw.task.id,
        prefix: "MOVED",
        number: 1,
      });
      await tx.task.updateMany({
        where: { id: pw.task.id, organizationId: pw.orgA },
        data: { key: newKey },
      });
    });
    const found = { ok: true, taskId: pw.task.id, key: newKey, projectId: pw.project.id };
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      expect(await resolveTaskKey(actor, oldKey)).toEqual({ ...found, isAlias: true });
      expect(await resolveTaskKey(actor, newKey)).toEqual({ ...found, isAlias: false });
    }
    for (const actor of [pw.actors.teamMember, pw.actors.nonMember, pw.actors.orgAdmin]) {
      const missing = await resolveTaskKey(actor, nowhere);
      expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(await resolveTaskKey(actor, oldKey)).toEqual(missing);
      expect(await resolveTaskKey(actor, newKey)).toEqual(missing);
    }
    const outsider = pw.actors.outsider;
    expect(await resolveTaskKey(outsider, oldKey)).toEqual(await resolveTaskKey(outsider, nowhere));
    expect(await resolveTaskKey(outsider, newKey)).toEqual(await resolveTaskKey(outsider, nowhere));
    expect(await resolveTaskKey(endedOutsider(pw), oldKey)).toEqual(ENDED);
    expect(await resolveTaskKey(endedOutsider(pw), newKey)).toEqual(ENDED);
  });
});
