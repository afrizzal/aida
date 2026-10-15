// Phase 14 code review fixes, batch F1: lock-order races (contract section 3; reviews a-WR-01,
// b-IN-02, a-WR-02, a-WR-03) on a real Postgres through Testcontainers. Every race records the
// holder's and the waiter's backend PIDs and waits for exactly that waiter to be blocked by that
// holder (waitForBlockedBy on the one-connection observer client). No timed waits; every promise
// settles and none rejects with 40P01.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addTaskComment } from "@/lib/projects/comments";
import { deleteProject } from "@/lib/projects/delete";
import { moveTask } from "@/lib/projects/move";
import { changeProjectKeyPrefix, createProject } from "@/lib/projects/projects";
import type { ProjectDb } from "@/lib/projects/service";
import { deleteTeam } from "@/lib/projects/teams";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
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
const releases: (() => void)[] = [];
const racePids: { race: string; holder: number; waiter: number }[] = [];

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-review-race PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
  for (const release of releases.splice(0)) release();
});

/** A raw interactive transaction that runs `first`, reports its PID and parks until released. */
function parkedTransaction(first: (tx: ProjectDb) => Promise<unknown>) {
  const pid = deferred<number>();
  const gate = deferred<void>();
  releases.push(() => gate.resolve());
  const done = prisma.$transaction(
    async (raw) => {
      const tx = raw as unknown as ProjectDb;
      const own = await backendPid(tx);
      await first(tx);
      pid.resolve(own);
      await gate.promise;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  done.catch(() => undefined);
  return { pid: pid.promise, release: () => gate.resolve(), done };
}

describe("a-WR-01, b-IN-02: requireTask never locks a second project", () => {
  it("a comment on a task that a committed move took to another project is CONFLICT, and nothing is written", async () => {
    const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const managerId = org.users[1]?.id as string;
    const manager = actorOf(managerId, org.orgId);
    const a = await seedProject(prisma, org.orgId, {
      createdByUserId: managerId,
      managerUserIds: [managerId],
    });
    const b = await seedProject(prisma, org.orgId, {
      createdByUserId: managerId,
      managerUserIds: [managerId],
    });
    const task = await seedTask(prisma, org.orgId, a.id, { title: "Moving" });
    race = createServiceRace();

    const held = race.holdAt("moveTask");
    const move = moveTask(manager, task.id, b.id, 0);
    const holder = await held;
    const waiterPid = race.nextStartPid("addTaskComment");
    const comment = addTaskComment(manager, task.id, { body: "late" });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "comment vs move", holder, waiter });
    race.release();

    const results = await settleAll<unknown>([move, comment]);
    assertNoDeadlock(results);
    const [moved, commented] = results.map((r) => (r.status === "fulfilled" ? r.value : r));
    expect(moved).toMatchObject({ ok: true });
    expect(commented).toEqual({ ok: false, code: "CONFLICT" });
    expect(await prisma.taskComment.count({ where: { organizationId: org.orgId } })).toBe(0);
  });
});

describe("a-WR-02: createProject and changeProjectKeyPrefix take the prefix rows in one order", () => {
  it("a create holding its new Project row and a prefix change to the same prefix never deadlock: the create wins, the change is PREFIX_TAKEN", async () => {
    const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
    const creatorId = org.users[1]?.id as string;
    const changerId = org.users[2]?.id as string;
    const q = await seedProject(prisma, org.orgId, {
      createdByUserId: changerId,
      managerUserIds: [changerId],
    });
    race = createServiceRace();

    // The blocker holds the creator's user row FOR UPDATE, so the create stops at the foreign
    // key check of its Project insert, after the row's unique index entries are written.
    const blocker = parkedTransaction(
      (tx) => tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${creatorId} FOR UPDATE`,
    );
    const blockerPid = await blocker.pid;
    const createPid = race.nextStartPid("createProject");
    const create = createProject(actorOf(creatorId, org.orgId), { name: "Foo", keyPrefix: "FOO" });
    const creator = await createPid;
    await waitForBlockedBy(observer, blockerPid, [creator]);

    const changePid = race.nextStartPid("changeProjectKeyPrefix");
    const change = changeProjectKeyPrefix(actorOf(changerId, org.orgId), q.id, 0, "FOO");
    const changer = await changePid;
    await waitForBlockedBy(observer, creator, [changer]);
    racePids.push({ race: "prefix: user blocker vs create", holder: blockerPid, waiter: creator });
    racePids.push({ race: "prefix: create vs change", holder: creator, waiter: changer });
    blocker.release();

    const results = await settleAll<unknown>([create, change, blocker.done]);
    assertNoDeadlock(results);
    const [created, changed] = results.map((r) => (r.status === "fulfilled" ? r.value : r));
    expect(created).toMatchObject({ ok: true, keyPrefix: "FOO" });
    expect(changed).toEqual({ ok: false, code: "PREFIX_TAKEN" });
    const reservation = await prisma.projectKeyPrefix.findFirst({
      where: { organizationId: org.orgId, prefix: "FOO" },
      select: { projectId: true },
    });
    expect(reservation?.projectId).toBe((created as { projectId: string }).projectId);
    expect(
      await prisma.project.findFirst({
        where: { id: q.id, organizationId: org.orgId },
        select: { keyPrefix: true, version: true },
      }),
    ).toEqual({ keyPrefix: q.keyPrefix, version: 0 });
  });
});

describe("a-WR-03: deleteTeam locks the linked projects before it reads the links", () => {
  it("a project delete committed while deleteTeam waits for the project lock leaves deleteTeam successful", async () => {
    const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const admin = actorOf(org.users[0]?.id as string, org.orgId);
    const managerId = org.users[1]?.id as string;
    const p = await seedProject(prisma, org.orgId, {
      createdByUserId: managerId,
      managerUserIds: [managerId],
      name: "Doomed",
    });
    const kept = await seedProject(prisma, org.orgId, {
      createdByUserId: managerId,
      managerUserIds: [managerId],
    });
    const team = await seedTeam(prisma, org.orgId, { projectIds: [p.id, kept.id] });
    race = createServiceRace();

    const held = race.holdAt("deleteProject");
    const del = deleteProject(actorOf(managerId, org.orgId), p.id, { confirmName: "Doomed" });
    const holder = await held;
    const waiterPid = race.nextStartPid("deleteTeam");
    const teamDelete = deleteTeam(admin, team.id);
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "deleteTeam vs deleteProject", holder, waiter });
    race.release();

    const results = await settleAll<unknown>([del, teamDelete]);
    assertNoDeadlock(results);
    const [deleted, teamDeleted] = results.map((r) => (r.status === "fulfilled" ? r.value : r));
    expect(deleted).toMatchObject({ ok: true });
    expect(teamDeleted).toEqual({ ok: true });
    expect(await prisma.team.count({ where: { organizationId: org.orgId } })).toBe(0);
    const unassigned = await prisma.projectActivity.findMany({
      where: { organizationId: org.orgId, verb: "TEAM_UNASSIGNED" },
      select: { projectId: true },
    });
    // Only the link deleteTeam removed itself is recorded.
    expect(unassigned).toEqual([{ projectId: kept.id }]);
  });
});
