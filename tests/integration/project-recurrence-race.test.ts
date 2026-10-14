// Phase 14 recurrence races (contract sections 3 and 7, SC7, C17) on a real Postgres through
// Testcontainers. Every race records the holder's and the waiter's backend PIDs and waits for
// exactly that waiter to be blocked by that holder (waitForBlockedBy on the one-connection
// observer client). No timed waits; every promise settles and none rejects with 40P01.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { setTaskStatus } from "@/lib/projects/tasks";
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
  console.info(`project-recurrence-race PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
});

async function raceWorld() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const manager = org.users[1]?.id as string;
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    managerUserIds: [manager],
  });
  const recurrence = { rule: "DAILY" as const, anchor: "2026-03-01", timeZone: "UTC" };
  const a = await seedTask(prisma, org.orgId, project.id, { dueDate: "2026-03-10", recurrence });
  const b = await seedTask(prisma, org.orgId, project.id, { dueDate: "2026-03-20", recurrence });
  return { orgId: org.orgId, manager: actorOf(manager, org.orgId), project, a, b };
}

function successorsOf(orgId: string, predecessorId: string) {
  return prisma.task.findMany({
    where: { organizationId: orgId, recurrencePredecessorId: predecessorId },
    select: { id: true, key: true, dueDate: true },
  });
}

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" ? r.value : String((r.reason as Error)?.message ?? r.reason);

function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { message?: unknown; meta?: unknown; cause?: unknown };
    parts.push(String(e.message ?? ""));
    if (e.meta) parts.push(JSON.stringify(e.meta));
    current = e.cause;
  }
  return parts.join(" ");
}

describe("recurrence exactly once under concurrent completion", () => {
  it("two completions of one task with the same version: the second waits, gets CONFLICT, one successor", async () => {
    const w = await raceWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("setTaskStatus");
    const first = setTaskStatus(w.manager, w.a.id, 0, "DONE", { now: NOW });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("setTaskStatus");
    const second = setTaskStatus(w.manager, w.a.id, 0, "DONE", { now: NOW });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "completion vs completion", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(outcome(results[0] as PromiseSettledResult<unknown>)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(outcome(results[1] as PromiseSettledResult<unknown>)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    const successors = await successorsOf(w.orgId, w.a.id);
    expect(successors).toHaveLength(1);
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: w.orgId, verb: "TASK_RECURRED" },
      }),
    ).toBe(1);
  });

  it("two recurring tasks of one project completed together: the second waits on the project row", async () => {
    const w = await raceWorld();
    race = createServiceRace();
    const holderPid = race.holdAt("setTaskStatus");
    const first = setTaskStatus(w.manager, w.a.id, 0, "DONE", { now: NOW });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("setTaskStatus");
    const second = setTaskStatus(w.manager, w.b.id, 0, "DONE", { now: NOW });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "completion vs completion (two tasks)", holder, waiter });
    race.release();
    const results = await settleAll<unknown>([first, second]);
    assertNoDeadlock(results);
    expect(results.map(outcome)).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: true, changed: true, version: 1 },
    ]);
    const [ofA] = await successorsOf(w.orgId, w.a.id);
    const [ofB] = await successorsOf(w.orgId, w.b.id);
    expect(ofA && ofB).toBeTruthy();
    expect(ofA?.key).not.toBe(ofB?.key);
    expect([ofA?.key, ofB?.key].sort()).toEqual(
      [`${w.project.keyPrefix}-3`, `${w.project.keyPrefix}-4`].sort(),
    );
  });

  it("a direct SQL insert of a second successor fails on Task_recurrence_predecessor_key", async () => {
    const w = await raceWorld();
    expect(await setTaskStatus(w.manager, w.a.id, 0, "DONE", { now: NOW })).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(await successorsOf(w.orgId, w.a.id)).toHaveLength(1);
    let failure: unknown = null;
    try {
      await prisma.$executeRaw`
        INSERT INTO "Task" ("id", "organizationId", "projectId", "number", "key", "title",
                            "rank", "recurrencePredecessorId", "updatedAt")
        VALUES (${`dup-${w.a.id}`}, ${w.orgId}, ${w.project.id}, 900,
                ${`${w.project.keyPrefix}-900`}, 'Duplicate', 1024, ${w.a.id}, now())`;
    } catch (err) {
      failure = err;
    }
    expect(failure).not.toBeNull();
    expect(errorText(failure)).toContain("Task_recurrence_predecessor_key");
    expect(await successorsOf(w.orgId, w.a.id)).toHaveLength(1);
  });
});
