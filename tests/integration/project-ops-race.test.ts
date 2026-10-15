// Phase 14 ordering, bulk and duplicate races (contract sections 1, 3, 8 and 11; D-10; review C6)
// on a real Postgres through Testcontainers. Every race records the holder's and the waiter's
// backend PIDs and waits for exactly that waiter to be blocked by that holder (waitForBlockedBy on
// the one-connection observer client). No timer of any kind; every promise settles and none
// rejects with 40P01. Each lock rule that orders two writers is proven in both orders.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { bulkUpdateTasks } from "@/lib/projects/bulk";
import { duplicateTask } from "@/lib/projects/duplicate";
import { reorderTask } from "@/lib/projects/ordering";
import { listProjectTasks, setTaskStatus, updateTask } from "@/lib/projects/tasks";
import { waitForBlockedBy } from "../support/lock-wait";
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
const racePids: { race: string; holder: number; waiter: number }[] = [];
const NOW = new Date("2026-03-15T12:00:00Z");

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-ops-race PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
});

async function raceWorld() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const managerId = org.users[1]?.id as string;
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: managerId,
    managerUserIds: [managerId],
  });
  const second = await seedProject(prisma, org.orgId, {
    createdByUserId: managerId,
    managerUserIds: [managerId],
  });
  const a = await seedTask(prisma, org.orgId, project.id, { status: "TODO", rank: 1024 });
  const b = await seedTask(prisma, org.orgId, project.id, { status: "TODO", rank: 2048 });
  const c = await seedTask(prisma, org.orgId, project.id, { status: "TODO", rank: 3072 });
  const x = await seedTask(prisma, org.orgId, second.id, { status: "TODO" });
  return { orgId: org.orgId, manager: actorOf(managerId, org.orgId), project, second, a, b, c, x };
}

type RaceWorld = Awaited<ReturnType<typeof raceWorld>>;

async function todoOrder(w: RaceWorld): Promise<string[]> {
  const result = await listProjectTasks(w.manager, w.project.id, { status: "TODO" });
  if (!result.ok) throw new Error(`listProjectTasks refused: ${result.code}`);
  return result.tasks.map((t) => t.id);
}

const outcome = (r: PromiseSettledResult<unknown> | undefined) =>
  r?.status === "fulfilled" ? r.value : String((r?.reason as Error)?.message ?? r?.reason);

/** Holds `holderCall` after its lock, starts `waiterCall`, proves it blocked, then releases. */
async function runRace<A, B>(
  name: string,
  holderOp: string,
  holderCall: () => Promise<A>,
  waiterOp: string,
  waiterCall: () => Promise<B>,
): Promise<[unknown, unknown]> {
  race = createServiceRace();
  const holderPid = race.holdAt(holderOp);
  const first = holderCall();
  const holder = await holderPid;
  const waiterPid = race.nextStartPid(waiterOp);
  const second = waiterCall();
  const waiter = await waiterPid;
  await waitForBlockedBy(observer, holder, [waiter]);
  racePids.push({ race: name, holder, waiter });
  race.release();
  const results = await settleAll<unknown>([first, second]);
  assertNoDeadlock(results);
  return [outcome(results[0]), outcome(results[1])];
}

function verbsOf(w: RaceWorld) {
  return prisma.projectActivity.findMany({
    where: { organizationId: w.orgId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { verb: true, taskId: true, before: true, after: true },
  });
}

describe("reorderTask against reorderTask", () => {
  it("the second reorder waits on the project and both placements apply in order", async () => {
    const w = await raceWorld();
    const [first, second] = await runRace(
      "reorder vs reorder",
      "reorderTask",
      () => reorderTask(w.manager, w.c.id, { placeAfterTaskId: null }, { now: NOW }),
      "reorderTask",
      () => reorderTask(w.manager, w.b.id, { placeAfterTaskId: null }, { now: NOW }),
    );
    expect(first).toMatchObject({ ok: true, changed: true });
    expect(second).toMatchObject({ ok: true, changed: true });
    expect(await todoOrder(w)).toEqual([w.b.id, w.c.id, w.a.id]);
    const rows = await verbsOf(w);
    expect(rows.map((r) => [r.verb, r.taskId])).toEqual([
      ["TASK_REORDERED", w.c.id],
      ["TASK_REORDERED", w.b.id],
    ]);
  });
});

describe("bulkUpdateTasks against reorderTask", () => {
  it("bulk holds while a reorder in one of its projects waits; both succeed", async () => {
    const w = await raceWorld();
    const [bulk, reorder] = await runRace(
      "bulk vs reorder",
      "bulkUpdateTasks",
      () => bulkUpdateTasks(w.manager, [w.a.id, w.x.id], { priority: "HIGH" }, { now: NOW }),
      "reorderTask",
      () => reorderTask(w.manager, w.c.id, { placeAfterTaskId: null }, { now: NOW }),
    );
    expect(bulk).toMatchObject({ ok: true, changedCount: 2 });
    expect(reorder).toMatchObject({ ok: true, changed: true });
    expect(await todoOrder(w)).toEqual([w.c.id, w.a.id, w.b.id]);
    const a = await prisma.task.findFirstOrThrow({ where: { id: w.a.id } });
    expect(a.priority).toBe("HIGH");
  });

  it("a reorder holds while bulk waits on the project; both succeed", async () => {
    const w = await raceWorld();
    const [reorder, bulk] = await runRace(
      "reorder vs bulk",
      "reorderTask",
      () => reorderTask(w.manager, w.c.id, { placeAfterTaskId: null }, { now: NOW }),
      "bulkUpdateTasks",
      () => bulkUpdateTasks(w.manager, [w.a.id, w.x.id], { priority: "HIGH" }, { now: NOW }),
    );
    expect(reorder).toMatchObject({ ok: true, changed: true });
    expect(bulk).toMatchObject({ ok: true, changedCount: 2 });
    expect(await todoOrder(w)).toEqual([w.c.id, w.a.id, w.b.id]);
    const a = await prisma.task.findFirstOrThrow({ where: { id: w.a.id } });
    expect(a.priority).toBe("HIGH");
  });
});

describe("bulkUpdateTasks against updateTask", () => {
  it("an edit holds (project FOR SHARE) while bulk waits; both changes land and bulk follows the edit's version", async () => {
    const w = await raceWorld();
    const [edit, bulk] = await runRace(
      "edit vs bulk",
      "updateTask",
      () => updateTask(w.manager, w.a.id, 0, { title: "Edited title" }),
      "bulkUpdateTasks",
      () => bulkUpdateTasks(w.manager, [w.a.id], { priority: "HIGH" }, { now: NOW }),
    );
    expect(edit).toEqual({ ok: true, changed: true, version: 1 });
    expect(bulk).toMatchObject({ ok: true, changedCount: 1 });
    const a = await prisma.task.findFirstOrThrow({ where: { id: w.a.id } });
    expect([a.title, a.priority, a.version]).toEqual(["Edited title", "HIGH", 2]);
    const rows = await verbsOf(w);
    expect(rows.map((r) => [r.verb, r.after])).toEqual([
      ["TASK_UPDATED", { title: "Edited title" }],
      ["TASK_UPDATED", { priority: "HIGH" }],
    ]);
  });

  it("bulk holds while an edit with the old version waits; after release the edit is CONFLICT", async () => {
    const w = await raceWorld();
    const [bulk, edit] = await runRace(
      "bulk vs edit",
      "bulkUpdateTasks",
      () => bulkUpdateTasks(w.manager, [w.a.id], { priority: "HIGH" }, { now: NOW }),
      "updateTask",
      () => updateTask(w.manager, w.a.id, 0, { title: "Edited title" }),
    );
    expect(bulk).toMatchObject({ ok: true, changedCount: 1 });
    expect(edit).toEqual({ ok: false, code: "CONFLICT" });
    const a = await prisma.task.findFirstOrThrow({ where: { id: w.a.id } });
    expect([a.title, a.priority, a.version]).toEqual([`Task ${w.a.key}`, "HIGH", 1]);
  });
});

describe("bulkUpdateTasks against setTaskStatus on a recurring task", () => {
  it("bulk DONE holds while setTaskStatus DONE waits; exactly one successor", async () => {
    const w = await raceWorld();
    const recurrence = { rule: "DAILY" as const, anchor: "2026-03-01", timeZone: "UTC" };
    const r = await seedTask(prisma, w.orgId, w.project.id, { dueDate: "2026-03-10", recurrence });
    const [bulk, status] = await runRace(
      "bulk DONE vs setTaskStatus DONE",
      "bulkUpdateTasks",
      () => bulkUpdateTasks(w.manager, [r.id], { status: "DONE" }, { now: NOW }),
      "setTaskStatus",
      () => setTaskStatus(w.manager, r.id, 0, "DONE", { now: NOW }),
    );
    expect(bulk).toMatchObject({ ok: true, changedCount: 1 });
    expect(status).toEqual({ ok: false, code: "CONFLICT" });
    const successors = await prisma.task.findMany({
      where: { organizationId: w.orgId, recurrencePredecessorId: r.id },
      select: { id: true },
    });
    expect(successors).toHaveLength(1);
  });
});

describe("duplicateTask against reorderTask (review C6)", () => {
  it("duplicateTask: duplicate first", async () => {
    const w = await raceWorld();
    const [dup, reorder] = await runRace(
      "duplicate vs reorder",
      "duplicateTask",
      () => duplicateTask(w.manager, w.a.id),
      "reorderTask",
      () => reorderTask(w.manager, w.c.id, { placeAfterTaskId: w.a.id }, { now: NOW }),
    );
    expect(dup).toMatchObject({ ok: true, subtaskCount: 0 });
    expect(reorder).toMatchObject({ ok: true, changed: true });
    const copyId = (dup as { taskId: string }).taskId;
    expect(await todoOrder(w)).toEqual([w.a.id, w.c.id, copyId, w.b.id]);
    const rows = await verbsOf(w);
    expect(rows.map((r) => [r.verb, r.taskId])).toEqual([
      ["TASK_DUPLICATED", copyId],
      ["TASK_REORDERED", w.c.id],
    ]);
  });

  it("duplicateTask: reorder first", async () => {
    const w = await raceWorld();
    const [reorder, dup] = await runRace(
      "reorder vs duplicate",
      "reorderTask",
      () => reorderTask(w.manager, w.c.id, { placeAfterTaskId: w.a.id }, { now: NOW }),
      "duplicateTask",
      () => duplicateTask(w.manager, w.a.id),
    );
    expect(reorder).toMatchObject({ ok: true, changed: true });
    expect(dup).toMatchObject({ ok: true, subtaskCount: 0 });
    const copyId = (dup as { taskId: string }).taskId;
    expect(await todoOrder(w)).toEqual([w.a.id, copyId, w.c.id, w.b.id]);
    const rows = await verbsOf(w);
    expect(rows.map((r) => [r.verb, r.taskId])).toEqual([
      ["TASK_REORDERED", w.c.id],
      ["TASK_DUPLICATED", copyId],
    ]);
  });
});
