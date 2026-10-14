// Phase 14 task races (contract sections 3 and 4, review C3, C17) on a real Postgres through
// Testcontainers. Every race records the holder's and the waiter's backend PIDs and waits for
// exactly that waiter to be blocked by that holder (waitForBlockedBy on the one-connection
// observer client). No timed waits; every promise settles and none rejects with 40P01.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resolveTaskKey } from "@/lib/projects/keys";
import { changeProjectKeyPrefix } from "@/lib/projects/projects";
import type { ProjectDb } from "@/lib/projects/service";
import {
  createTask,
  lockTaskTreeInTx,
  setTaskParent,
  setTaskStatus,
  updateTask,
} from "@/lib/projects/tasks";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";
import { actorOf, seedOrgWithMembers, seedProject, seedTask } from "../support/project-fixtures";
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
const TX = { maxWait: 10_000, timeout: 30_000 };

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-tasks-race PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
  for (const release of releases.splice(0)) release();
});

async function raceWorld(keyPrefix = "OPS") {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const manager = org.users[1]?.id as string;
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    keyPrefix,
    managerUserIds: [manager],
  });
  const a = await seedTask(prisma, org.orgId, project.id, { title: "A" });
  const c = await seedTask(prisma, org.orgId, project.id, { title: "C" });
  return { orgId: org.orgId, manager: actorOf(manager, org.orgId), project, a, c };
}

type RaceWorld = Awaited<ReturnType<typeof raceWorld>>;

/** A raw subtask insert under parentId (the trigger takes the parent FOR SHARE). */
function insertSubtask(tx: ProjectDb, w: RaceWorld, parentId: string, taskNumber: number) {
  return tx.$executeRaw`
    INSERT INTO "Task" ("id", "organizationId", "projectId", "parentId", "number", "key",
                        "title", "rank", "updatedAt")
    VALUES (${`raw-${w.project.id}-${taskNumber}`}, ${w.orgId}, ${w.project.id}, ${parentId},
            ${taskNumber}, ${`${w.project.keyPrefix}-${taskNumber}`}, 'B', 1024, now())`;
}

function reparent(tx: ProjectDb, w: RaceWorld, taskId: string, parentId: string) {
  return tx.$executeRaw`
    UPDATE "Task" SET "parentId" = ${parentId}, "updatedAt" = now()
    WHERE "id" = ${taskId} AND "organizationId" = ${w.orgId}`;
}

/** Starts a raw interactive transaction that runs `first`, reports its PID and parks. */
function parkedTransaction(first: (tx: ProjectDb) => Promise<unknown>) {
  const pid = deferred<number>();
  const gate = deferred<void>();
  releases.push(() => gate.resolve());
  const done = prisma.$transaction(async (raw) => {
    const tx = raw as unknown as ProjectDb;
    const own = await backendPid(tx);
    await first(tx);
    pid.resolve(own);
    await gate.promise;
  }, TX);
  done.catch(() => undefined);
  return { pid: pid.promise, release: () => gate.resolve(), done };
}

/** Starts a raw interactive transaction that reports its PID and then runs `work`. */
function waitingTransaction<T>(work: (tx: ProjectDb) => Promise<T>) {
  const pid = deferred<number>();
  const done = prisma.$transaction(async (raw) => {
    const tx = raw as unknown as ProjectDb;
    pid.resolve(await backendPid(tx));
    return work(tx);
  }, TX);
  return { pid: pid.promise, done };
}

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" ? r.value : String((r.reason as Error)?.message ?? r.reason);

describe("subtask trigger lock protocol (raw SQL)", () => {
  it("order 1: an insert under A holds A FOR SHARE, so making A a subtask waits and then fails", async () => {
    const w = await raceWorld();
    const t1 = parkedTransaction((tx) => insertSubtask(tx, w, w.a.id, 900));
    const holder = await t1.pid;
    const t2 = waitingTransaction((tx) => reparent(tx, w, w.a.id, w.c.id));
    const waiter = await t2.pid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "trigger order 1", holder, waiter });
    t1.release();
    const results = await settleAll<unknown>([t1.done, t2.done]);
    assertNoDeadlock(results);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect(outcome(results[1] as PromiseSettledResult<unknown>)).toContain(
      "Task with subtasks cannot become a subtask",
    );
  });

  it("order 2: making A a subtask holds A, so an insert under A waits and then fails", async () => {
    const w = await raceWorld();
    const t2 = parkedTransaction((tx) => reparent(tx, w, w.a.id, w.c.id));
    const holder = await t2.pid;
    const t1 = waitingTransaction((tx) => insertSubtask(tx, w, w.a.id, 900));
    const waiter = await t1.pid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "trigger order 2", holder, waiter });
    t2.release();
    const results = await settleAll<unknown>([t2.done, t1.done]);
    assertNoDeadlock(results);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect(outcome(results[1] as PromiseSettledResult<unknown>)).toContain(
      "Task subtask depth exceeded",
    );
  });
});

describe("service races", () => {
  it("setTaskParent held after its locks: createTask under A waits and gets SUBTASK_DEPTH", async () => {
    const w = await raceWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("setTaskParent");
    const first = setTaskParent(w.manager, w.a.id, 0, w.c.id);
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("createTask");
    const second = createTask(w.manager, w.project.id, { title: "B", parentId: w.a.id });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "setTaskParent vs createTask", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map(outcome)).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: false, code: "SUBTASK_DEPTH" },
    ]);
  });

  it("createTask under A held after its locks: setTaskParent of A waits and gets SUBTASK_DEPTH", async () => {
    const w = await raceWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("createTask");
    const first = createTask(w.manager, w.project.id, { title: "B", parentId: w.a.id });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("setTaskParent");
    const second = setTaskParent(w.manager, w.a.id, 0, w.c.id);
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "createTask vs setTaskParent", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map(outcome)).toEqual([
      { ok: true, taskId: expect.any(String), key: "OPS-3", number: 3, version: 0 },
      { ok: false, code: "SUBTASK_DEPTH" },
    ]);
  });

  it("changeProjectKeyPrefix held first: the waiting createTask uses the new prefix", async () => {
    const w = await raceWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("changeProjectKeyPrefix");
    const first = changeProjectKeyPrefix(w.manager, w.project.id, 0, "NEW");
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("createTask");
    const second = createTask(w.manager, w.project.id, { title: "After" });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "changeProjectKeyPrefix vs createTask", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map(outcome)).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: true, taskId: expect.any(String), key: "NEW-3", number: 3, version: 0 },
    ]);
    expect(await resolveTaskKey(w.manager, w.a.key)).toMatchObject({ ok: true, taskId: w.a.id });
  });

  it("createTask held first: the waiting prefix change leaves the task its old prefix, which still resolves", async () => {
    const w = await raceWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("createTask");
    const first = createTask(w.manager, w.project.id, { title: "Before" });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("changeProjectKeyPrefix");
    const second = changeProjectKeyPrefix(w.manager, w.project.id, 0, "NEW");
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "createTask vs changeProjectKeyPrefix", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    const created = outcome(results[0] as PromiseSettledResult<unknown>) as { taskId: string };
    expect(results.map(outcome)).toEqual([
      { ok: true, taskId: expect.any(String), key: "OPS-3", number: 3, version: 0 },
      { ok: true, changed: true, version: 1 },
    ]);
    expect(await resolveTaskKey(w.manager, "OPS-3")).toEqual({
      ok: true,
      taskId: created.taskId,
      key: "OPS-3",
      projectId: w.project.id,
      isAlias: false,
    });
    expect(await createTask(w.manager, w.project.id, { title: "Next" })).toMatchObject({
      ok: true,
      key: "NEW-4",
    });
  });

  it("two updateTask calls with the same version serialize and the second gets CONFLICT", async () => {
    const w = await raceWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("updateTask");
    const first = updateTask(w.manager, w.a.id, 0, { title: "First writer" });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("updateTask");
    const second = updateTask(w.manager, w.a.id, 0, { title: "Second writer" });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "updateTask x2", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map(outcome)).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: false, code: "CONFLICT" },
    ]);
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: w.orgId, verb: "TASK_UPDATED" },
      }),
    ).toBe(1);
  });

  it("setTaskStatus holds the project FOR UPDATE: a createTask in the same project waits for it", async () => {
    const w = await raceWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("setTaskStatus");
    const first = setTaskStatus(w.manager, w.a.id, 0, "IN_PROGRESS");
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("createTask");
    const second = createTask(w.manager, w.project.id, { title: "Waits" });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "setTaskStatus vs createTask", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map(outcome)).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: true, taskId: expect.any(String), key: "OPS-3", number: 3, version: 0 },
    ]);
  });
});

describe("tree lock (review C3)", () => {
  it("lockTaskTreeInTx waits for the root and includes a subtask committed meanwhile", async () => {
    const w = await raceWorld();
    const proceed = deferred<void>();
    releases.push(() => proceed.resolve());
    const holderPid = deferred<number>();
    const t1 = prisma.$transaction(async (raw) => {
      const tx = raw as unknown as ProjectDb;
      await tx.$queryRaw`SELECT "id" FROM "Task"
        WHERE "id" = ${w.a.id} AND "organizationId" = ${w.orgId} FOR SHARE`;
      holderPid.resolve(await backendPid(tx));
      await proceed.promise;
      await insertSubtask(tx, w, w.a.id, 901);
    }, TX);
    const holder = await holderPid.promise;
    const t2 = waitingTransaction((tx) => lockTaskTreeInTx(tx, w.orgId, w.a.id, "update"));
    const waiter = await t2.pid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "tree lock vs subtask insert", holder, waiter });
    proceed.resolve();
    const results = await settleAll<unknown>([t1, t2.done]);
    assertNoDeadlock(results);
    expect(results[0]?.status).toBe("fulfilled");
    const tree = outcome(results[1] as PromiseSettledResult<unknown>) as Awaited<
      ReturnType<typeof lockTaskTreeInTx>
    >;
    expect(tree?.root.id).toBe(w.a.id);
    expect(tree?.subtasks.map((s) => s.id)).toEqual([`raw-${w.project.id}-901`]);
  });
});
