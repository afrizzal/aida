// Phase 14 code review fixes, batch F1: lock-order races (contract section 3; reviews a-WR-01,
// b-IN-02, a-WR-02, a-WR-03) on a real Postgres through Testcontainers. Every race records the
// holder's and the waiter's backend PIDs and waits for exactly that waiter to be blocked by that
// holder (waitForBlockedBy on the one-connection observer client). No timed waits; every promise
// settles and none rejects with 40P01.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addTaskComment } from "@/lib/projects/comments";
import { moveTask } from "@/lib/projects/move";
import type { ProjectDb } from "@/lib/projects/service";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  seedOrgWithMembers,
  seedProject,
  seedTask,
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

