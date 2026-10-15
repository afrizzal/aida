// Phase 14 moveTask (contract sections 1, 3, 5, 6, 11 and 17; D-13, K67, C3; reviews C1, R2-1 and
// R3-1; AIDA-103, AIDA-68, AIDA-71) on a real Postgres through Testcontainers. No mocks. Races
// record the holder's and the waiter's backend PIDs and wait for exactly that waiter to be blocked
// by that holder (waitForBlockedBy on the one-connection observer client), never a sleep; every
// settled promise is checked for 40P01. Recurrence columns are seeded only through seedTask's
// recurrence option.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { listProjectActivity, listTaskActivity } from "@/lib/projects/activity";
import { ACTIVITY_FEED_ROW_KEYS, REDACTED_SIDE } from "@/lib/projects/contract";
import { resolveTaskKey } from "@/lib/projects/keys";
import { moveTask } from "@/lib/projects/move";
import { createTask, getTask, updateTask } from "@/lib/projects/tasks";
import { waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  missingId,
  projectTableSnapshot,
  seedAttachment,
  seedComment,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
} from "../support/project-fixtures";
import { hardDeleteProjectRowsForTest } from "../support/project-hard-delete";
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

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-move PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
});

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" ? r.value : r.reason;

/** Holds `first` at afterLock of holdOp, proves second (waitOp) blocked by its PID, settles both. */
async function raceInOrder(
  name: string,
  holdOp: string,
  first: () => Promise<unknown>,
  waitOp: string,
  second: () => Promise<unknown>,
): Promise<[unknown, unknown]> {
  race = createServiceRace();
  const holderPid = race.holdAt(holdOp);
  const a = first();
  const holder = await holderPid;
  const waiterPid = race.nextStartPid(waitOp);
  const b = second();
  const waiter = await waiterPid;
  await waitForBlockedBy(observer, holder, [waiter]);
  racePids.push({ race: name, holder, waiter });
  race.release();
  const results = await settleAll<unknown>([a, b]);
  assertNoDeadlock(results);
  return [
    outcome(results[0] as PromiseSettledResult<unknown>),
    outcome(results[1] as PromiseSettledResult<unknown>),
  ];
}

/** One organization: owner, mover M (member of both projects), and two more members. */
async function world(opts: { sourcePrivate?: boolean; targetPrivate?: boolean } = {}) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
  const [owner, mover, other, outsiderOfTarget] = org.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
  ];
  const source = await seedProject(prisma, org.orgId, {
    createdByUserId: mover,
    keyPrefix: "OPS",
    isPrivate: opts.sourcePrivate ?? false,
    managerUserIds: [mover],
    memberUserIds: [other],
  });
  const target = await seedProject(prisma, org.orgId, {
    createdByUserId: mover,
    keyPrefix: "WEB",
    isPrivate: opts.targetPrivate ?? false,
    managerUserIds: [mover],
  });
  return {
    orgId: org.orgId,
    source,
    target,
    owner: actorOf(owner, org.orgId),
    mover: actorOf(mover, org.orgId),
    other: actorOf(other, org.orgId),
    nonMember: actorOf(outsiderOfTarget, org.orgId),
  };
}

async function movedRows(orgId: string) {
  return prisma.projectActivity.findMany({
    where: { organizationId: orgId, verb: "TASK_MOVED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

describe("moveTask tracer", () => {
  it("moves a task to another project with a new key; the old key resolves as an alias", async () => {
    const w = await world();
    await seedTask(prisma, w.orgId, w.source.id, { createdByUserId: w.mover.userId });
    await seedTask(prisma, w.orgId, w.source.id, { createdByUserId: w.mover.userId });
    const t = await seedTask(prisma, w.orgId, w.source.id, { createdByUserId: w.mover.userId });
    expect(t.key).toBe("OPS-3");

    const result = await moveTask(w.mover, t.id, w.target.id, 0);
    expect(result).toEqual({
      ok: true,
      taskId: t.id,
      key: "WEB-1",
      projectId: w.target.id,
      version: 1,
      subtaskCount: 0,
    });
    const task = await getTask(w.mover, t.id);
    expect(task.ok && task.task.projectId).toBe(w.target.id);
    expect(task.ok && task.task.key).toBe("WEB-1");
    expect(await resolveTaskKey(w.mover, "ops-3")).toEqual({
      ok: true,
      taskId: t.id,
      key: "WEB-1",
      projectId: w.target.id,
      isAlias: true,
    });
    const keys = await prisma.taskKey.findMany({
      where: { organizationId: w.orgId, taskId: t.id },
      orderBy: { normalizedKey: "asc" },
      select: { normalizedKey: true, kind: true },
    });
    expect(keys).toEqual([
      { normalizedKey: "OPS-3", kind: "ALIAS" },
      { normalizedKey: "WEB-1", kind: "ACTIVE" },
    ]);

    const rows = await movedRows(w.orgId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.projectId).toBe(w.target.id);
    expect(row?.relatedProjectId).toBe(w.source.id);
    expect(row?.taskId).toBe(t.id);
    expect(row?.before).toEqual({
      projectId: w.source.id,
      taskKey: "OPS-3",
      milestoneId: null,
      labelNames: [],
      assigneeUserId: null,
    });
    expect(row?.after).toEqual({
      projectId: w.target.id,
      taskKey: "WEB-1",
      milestoneId: null,
      labelNames: [],
      assigneeUserId: null,
      subtaskCount: 0,
    });
    for (const projectId of [w.source.id, w.target.id]) {
      const feed = await listProjectActivity(w.mover, projectId);
      expect(feed.ok).toBe(true);
      if (!feed.ok) continue;
      const moved = feed.rows.filter((r) => r.verb === "TASK_MOVED");
      expect(moved.map((r) => r.id)).toEqual([row?.id]);
      expect(moved[0]?.redacted).toBe(false);
    }
  });
});
