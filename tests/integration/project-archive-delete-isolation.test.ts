// Phase 14 isolation of the archive, favorite and delete operations (contract section 17, reviews
// P2, C2 and C5; AIDA-71). Each section 17 actor calls each operation on a private project with the
// expectation of its Isolation class. TARGET: manager and member get their level's result (member
// NOT_ALLOWED on the MANAGE operations and on deleteTask of a task it did not create); teamMember
// (team only, K69), nonMember, orgAdmin and outsider get a result deep-equal to the call with
// missingId(). LIST (listFavorites): the private project and its tasks never appear for those four,
// even when a favorite row of theirs exists. The outsider with organization A gets
// MEMBERSHIP_ENDED everywhere; every refused write leaves projectTableSnapshot and the
// ProjectActivity count unchanged. Unmocked; every case seeds fresh organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { archiveProject, archiveTask, restoreProject, restoreTask } from "@/lib/projects/archive";
import type { ProjectActor } from "@/lib/projects/contract";
import { deleteProject, deleteTask } from "@/lib/projects/delete";
import {
  favoriteProject,
  favoriteTask,
  listFavorites,
  unfavoriteProject,
  unfavoriteTask,
} from "@/lib/projects/favorites";
import {
  actorOf,
  missingId,
  type PrivacyWorld,
  type ProjectTableSnapshot,
  projectActivityCounts,
  projectTableSnapshotAll,
  seedPrivacyWorld,
} from "../support/project-fixtures";

type Call = (actor: ProjectActor, id: string) => Promise<unknown>;
type Snapshot = () => Promise<ProjectTableSnapshot[]>;

const refusedActors = (w: PrivacyWorld) => [
  w.actors.teamMember,
  w.actors.nonMember,
  w.actors.orgAdmin,
  w.actors.outsider,
];
const outsiderInA = (w: PrivacyWorld) => actorOf(w.users.outsider, w.orgA);

/** Runs one refused write and checks that organization A changed nowhere. */
async function refusedWrite(
  w: PrivacyWorld,
  snapshot: Snapshot,
  run: () => Promise<unknown>,
): Promise<unknown> {
  const before = await snapshot();
  const count = await projectActivityCounts(prisma, [w.orgA, w.orgB]);
  const result = await run();
  expect(await snapshot()).toEqual(before);
  expect(await projectActivityCounts(prisma, [w.orgA, w.orgB])).toEqual(count);
  return result;
}

/**
 * TARGET write: the member (when memberCode is given) and every refused actor change nothing; the
 * refused actors' result is NOT_FOUND, deep-equal to the same call with a missing id; the outsider
 * with organization A gets MEMBERSHIP_ENDED.
 */
async function expectRefusedWrites(
  w: PrivacyWorld,
  snapshot: Snapshot,
  call: Call,
  targetId: string,
  memberCode: "NOT_ALLOWED" | null,
): Promise<void> {
  if (memberCode) {
    expect(await refusedWrite(w, snapshot, () => call(w.actors.member, targetId))).toEqual({
      ok: false,
      code: memberCode,
    });
  }
  for (const actor of refusedActors(w)) {
    const result = await refusedWrite(w, snapshot, () => call(actor, targetId));
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(result).toEqual(await refusedWrite(w, snapshot, () => call(actor, missingId())));
  }
  expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), targetId))).toEqual({
    ok: false,
    code: "MEMBERSHIP_ENDED",
  });
}

async function markArchived(w: PrivacyWorld, what: "project" | "task"): Promise<void> {
  if (what === "project") {
    await prisma.project.updateMany({
      where: { id: w.project.id, organizationId: w.orgA },
      data: { archivedAt: new Date() },
    });
  } else {
    await prisma.task.updateMany({
      where: { id: w.task.id, organizationId: w.orgA },
      data: { archivedAt: new Date() },
    });
  }
}

describe("archiveProject (TARGET)", () => {
  it("member NOT_ALLOWED, refused actors equal a missing id, nothing changes; the manager archives", async () => {
    const w = await seedPrivacyWorld(prisma);
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => archiveProject(actor, id, 0);
    await expectRefusedWrites(w, snapshot, call, w.project.id, "NOT_ALLOWED");
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.project.id)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
  });
});

describe("restoreProject (TARGET)", () => {
  it("member NOT_ALLOWED, refused actors equal a missing id, nothing changes; the manager restores", async () => {
    const w = await seedPrivacyWorld(prisma);
    await markArchived(w, "project");
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => restoreProject(actor, id);
    await expectRefusedWrites(w, snapshot, call, w.project.id, "NOT_ALLOWED");
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.project.id)).toMatchObject({ ok: true, changed: true });
  });
});

describe("archiveTask (TARGET)", () => {
  it("refused actors equal a missing id and change nothing; manager and member archive", async () => {
    const w = await seedPrivacyWorld(prisma);
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => archiveTask(actor, id, 0);
    await expectRefusedWrites(w, snapshot, call, w.task.id, null);
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.subtask.id)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await call(w.actors.member, w.task.id)).toEqual({ ok: true, changed: true, version: 1 });
  });
});

describe("restoreTask (TARGET)", () => {
  it("refused actors equal a missing id and change nothing; member and manager restore", async () => {
    const w = await seedPrivacyWorld(prisma);
    await markArchived(w, "task");
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => restoreTask(actor, id);
    await expectRefusedWrites(w, snapshot, call, w.task.id, null);
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.member, w.task.id)).toEqual({ ok: true, changed: true, version: 1 });
    expect(await call(w.actors.manager, w.task.id)).toEqual({ ok: true, changed: false });
  });
});

describe("favoriteProject (TARGET)", () => {
  it("refused actors equal a missing id and change nothing; manager and member favorite", async () => {
    const w = await seedPrivacyWorld(prisma);
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => favoriteProject(actor, id);
    await expectRefusedWrites(w, snapshot, call, w.project.id, null);
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.project.id)).toEqual({ ok: true, changed: true });
    expect(await call(w.actors.member, w.project.id)).toEqual({ ok: true, changed: true });
  });
});

describe("unfavoriteProject (TARGET)", () => {
  it("refused actors equal a missing id and change nothing, even with a favorite row of theirs; manager and member unfavorite", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const userId of [w.users.manager, w.users.member, w.users.nonMember]) {
      await prisma.projectFavorite.create({
        data: { organizationId: w.orgA, userId, projectId: w.project.id },
      });
    }
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => unfavoriteProject(actor, id);
    await expectRefusedWrites(w, snapshot, call, w.project.id, null);
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.project.id)).toEqual({ ok: true, changed: true });
    expect(await call(w.actors.member, w.project.id)).toEqual({ ok: true, changed: true });
  });
});

describe("favoriteTask (TARGET)", () => {
  it("refused actors equal a missing id and change nothing; manager and member favorite", async () => {
    const w = await seedPrivacyWorld(prisma);
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => favoriteTask(actor, id);
    await expectRefusedWrites(w, snapshot, call, w.task.id, null);
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.task.id)).toEqual({ ok: true, changed: true });
    expect(await call(w.actors.member, w.subtask.id)).toEqual({ ok: true, changed: true });
  });
});

describe("unfavoriteTask (TARGET)", () => {
  it("refused actors equal a missing id and change nothing, even with a favorite row of theirs; manager and member unfavorite", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const userId of [w.users.manager, w.users.member, w.users.nonMember]) {
      await prisma.taskFavorite.create({
        data: { organizationId: w.orgA, userId, taskId: w.task.id },
      });
    }
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => unfavoriteTask(actor, id);
    await expectRefusedWrites(w, snapshot, call, w.task.id, null);
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.task.id)).toEqual({ ok: true, changed: true });
    expect(await call(w.actors.member, w.task.id)).toEqual({ ok: true, changed: true });
  });
});

describe("listFavorites (LIST)", () => {
  it("the private project and its tasks appear for manager and member only, even when refused actors hold favorite rows; the outsider with organization A gets MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    const inA = [
      w.users.manager,
      w.users.member,
      w.users.teamMember,
      w.users.nonMember,
      w.users.orgAdmin,
    ];
    for (const userId of inA) {
      await prisma.projectFavorite.create({
        data: { organizationId: w.orgA, userId, projectId: w.project.id },
      });
      await prisma.taskFavorite.create({
        data: { organizationId: w.orgA, userId, taskId: w.task.id },
      });
      await prisma.taskFavorite.create({
        data: { organizationId: w.orgA, userId, taskId: w.subtask.id },
      });
    }
    const listed = async (actor: ProjectActor) => {
      const r = await listFavorites(actor, { includeArchived: true });
      if (!r.ok) throw new Error(r.code);
      return JSON.stringify(r);
    };
    for (const actor of [w.actors.manager, w.actors.member]) {
      const text = await listed(actor);
      expect(text).toContain(w.project.id);
      expect(text).toContain(w.task.id);
      expect(text).toContain(w.subtask.id);
    }
    for (const actor of refusedActors(w)) {
      const r = await listFavorites(actor, { includeArchived: true });
      expect(r).toEqual({
        ok: true,
        projects: [],
        tasks: [],
        hasMoreProjects: false,
        hasMoreTasks: false,
        nextProjectsCursor: null,
        nextTasksCursor: null,
      });
      const text = JSON.stringify(r);
      for (const id of [w.project.id, w.task.id, w.subtask.id]) {
        expect(text).not.toContain(id);
      }
    }
    expect(await listFavorites(outsiderInA(w))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
  });
});

describe("deleteTask (TARGET)", () => {
  it("member (not the creator) NOT_ALLOWED, refused actors equal a missing id, nothing changes; the manager deletes", async () => {
    const w = await seedPrivacyWorld(prisma);
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => deleteTask(actor, id, { confirm: true, expectedVersion: 0 });
    await expectRefusedWrites(w, snapshot, call, w.task.id, "NOT_ALLOWED");
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.task.id)).toEqual({
      ok: true,
      removedTaskCount: 2,
      cleanupQueued: 1,
    });
  });
});

describe("deleteProject (TARGET)", () => {
  it("member NOT_ALLOWED, refused actors equal a missing id, nothing changes; the manager deletes", async () => {
    const w = await seedPrivacyWorld(prisma);
    const name = `Project ${w.project.keyPrefix}`;
    const snapshot = () => projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
    const call: Call = (actor, id) => deleteProject(actor, id, { confirmName: name });
    await expectRefusedWrites(w, snapshot, call, w.project.id, "NOT_ALLOWED");
    expect(await refusedWrite(w, snapshot, () => call(outsiderInA(w), missingId()))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await call(w.actors.manager, w.project.id)).toEqual({
      ok: true,
      removedTaskCount: 2,
      cleanupQueued: 1,
    });
  });
});
