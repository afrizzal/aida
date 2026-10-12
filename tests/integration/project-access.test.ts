// Phase 14 access policy (contract section 2; D-04 as amended by K69, K59, review C3): the matrix
// of requireProject and requireTask for every level and every section 17 actor on a private and a
// non-private project, and the parent lock of review C3 in both orders, bound to backend PIDs
// with raw interactive transactions and waitForBlockedBy. Unmocked; no timed waits.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  isEligibleAssignee,
  type ProjectLock,
  requireProject,
  requireTask,
} from "@/lib/projects/access";
import type { AccessLevel, ProjectActor } from "@/lib/projects/contract";
import { type ProjectDb, ProjectRefusal } from "@/lib/projects/service";
import { backendPid, type Deferred, deferred, waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  type PrivacyWorld,
  removeOrgMember,
  seedPrivacyWorld,
  seedTask,
} from "../support/project-fixtures";
import { assertNoDeadlock, createObserverClient, settleAll } from "../support/project-race";

const TX = { maxWait: 10_000, timeout: 30_000 } as const;

let observer: PrismaClient;
let closeObserver: () => Promise<void>;
const held: Deferred<void>[] = [];
const racePids: { race: string; holder: number; waiter: number }[] = [];

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-access PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  for (const d of held.splice(0)) d.resolve();
});

function hold(): Deferred<void> {
  const d = deferred<void>();
  held.push(d);
  return d;
}

/** "OK" or the refusal code of a policy call run inside a transaction. */
async function outcome(fn: (tx: ProjectDb) => Promise<unknown>): Promise<string> {
  try {
    await prisma.$transaction((tx) => fn(tx as unknown as ProjectDb), TX);
    return "OK";
  } catch (err) {
    if (err instanceof ProjectRefusal) return err.code;
    throw err;
  }
}

const PROJECT_LEVELS: AccessLevel[] = ["READ", "CONTENT", "MANAGE", "MANAGE_ARCHIVED"];
const TASK_LEVELS: AccessLevel[] = ["READ", "CONTENT", "CONTENT_ARCHIVED_TASK"];
const LOCKS: ProjectLock[] = ["none", "share", "update"];

async function projectMatrix(w: PrivacyWorld, actor: ProjectActor): Promise<string[]> {
  const out: string[] = [];
  for (const level of PROJECT_LEVELS) {
    for (const lock of LOCKS) {
      out.push(await outcome((tx) => requireProject(tx, actor, w.project.id, { lock, level })));
    }
  }
  return [...new Set(out.map((o, i) => `${PROJECT_LEVELS[Math.floor(i / 3)]}:${o}`))];
}

async function taskMatrix(w: PrivacyWorld, actor: ProjectActor): Promise<string[]> {
  const out: string[] = [];
  for (const level of TASK_LEVELS) {
    for (const taskId of [w.task.id, w.subtask.id]) {
      out.push(
        `${level}:${await outcome((tx) =>
          requireTask(tx, actor, taskId, {
            lock: level === "READ" ? "none" : "share",
            level,
            taskLock: level === "READ" ? undefined : "update",
          }),
        )}`,
      );
    }
  }
  return [...new Set(out)];
}

const ALL_OK = ["READ:OK", "CONTENT:OK", "MANAGE:OK", "MANAGE_ARCHIVED:OK"];
const READ_WRITE = ["READ:OK", "CONTENT:OK", "MANAGE:NOT_ALLOWED", "MANAGE_ARCHIVED:NOT_ALLOWED"];
const HIDDEN = PROJECT_LEVELS.map((l) => `${l}:NOT_FOUND`);
const TASK_OK = TASK_LEVELS.map((l) => `${l}:OK`);
const TASK_HIDDEN = TASK_LEVELS.map((l) => `${l}:NOT_FOUND`);

describe("access matrix", () => {
  it("private project: manager and member by role, teamMember, nonMember, orgAdmin and outsider NOT_FOUND", async () => {
    const w = await seedPrivacyWorld(prisma);
    const a = w.actors;
    expect(await projectMatrix(w, a.manager)).toEqual(ALL_OK);
    expect(await projectMatrix(w, a.member)).toEqual(READ_WRITE);
    for (const actor of [a.teamMember, a.nonMember, a.orgAdmin, a.outsider]) {
      expect(await projectMatrix(w, actor)).toEqual(HIDDEN);
      expect(await taskMatrix(w, actor)).toEqual(TASK_HIDDEN);
    }
    expect(await taskMatrix(w, a.manager)).toEqual(TASK_OK);
    expect(await taskMatrix(w, a.member)).toEqual(TASK_OK);
    const outsiderInA = actorOf(w.users.outsider, w.orgA);
    expect(await projectMatrix(w, outsiderInA)).toEqual(
      PROJECT_LEVELS.map((l) => `${l}:MEMBERSHIP_ENDED`),
    );
    expect(await isEligibleAssignee(prisma, w.orgA, w.project.id, w.users.teamMember)).toBe(false);
    expect(await isEligibleAssignee(prisma, w.orgA, w.project.id, w.users.member)).toBe(true);
    expect(await isEligibleAssignee(prisma, w.orgA, w.project.id, w.users.outsider)).toBe(false);
  });

  it("non-private project: teamMember and nonMember read and write content, orgAdmin also manages", async () => {
    const w = await seedPrivacyWorld(prisma, { isPrivate: false });
    const a = w.actors;
    expect(await projectMatrix(w, a.manager)).toEqual(ALL_OK);
    expect(await projectMatrix(w, a.member)).toEqual(READ_WRITE);
    expect(await projectMatrix(w, a.teamMember)).toEqual(READ_WRITE);
    expect(await projectMatrix(w, a.nonMember)).toEqual(READ_WRITE);
    expect(await projectMatrix(w, a.orgAdmin)).toEqual(ALL_OK);
    expect(await projectMatrix(w, a.outsider)).toEqual(HIDDEN);
    for (const actor of [a.teamMember, a.nonMember, a.orgAdmin]) {
      expect(await taskMatrix(w, actor)).toEqual(TASK_OK);
    }
    expect(await isEligibleAssignee(prisma, w.orgA, w.project.id, w.users.teamMember)).toBe(true);
  });

  it("a removed organization member gets MEMBERSHIP_ENDED while their ProjectMember row remains", async () => {
    const w = await seedPrivacyWorld(prisma);
    await removeOrgMember(prisma, w.orgA, w.users.member);
    expect(
      await prisma.projectMember.count({
        where: { organizationId: w.orgA, projectId: w.project.id, userId: w.users.member },
      }),
    ).toBe(1);
    expect(await projectMatrix(w, w.actors.member)).toEqual(
      PROJECT_LEVELS.map((l) => `${l}:MEMBERSHIP_ENDED`),
    );
    expect(await taskMatrix(w, w.actors.member)).toEqual(
      TASK_LEVELS.map((l) => `${l}:MEMBERSHIP_ENDED`),
    );
    expect(await isEligibleAssignee(prisma, w.orgA, w.project.id, w.users.member)).toBe(false);
  });

  it("archive states: CONTENT is ARCHIVED on an archived project, task or parent; CONTENT_ARCHIVED_TASK allows the task itself", async () => {
    const w = await seedPrivacyWorld(prisma);
    const manager = w.actors.manager;
    const content = (taskId: string, level: AccessLevel = "CONTENT") =>
      outcome((tx) =>
        requireTask(tx, manager, taskId, { lock: "share", level, taskLock: "update" }),
      );
    const archivedTask = await seedTask(prisma, w.orgA, w.project.id, { archivedAt: new Date() });
    expect(await content(archivedTask.id)).toBe("ARCHIVED");
    expect(await content(archivedTask.id, "CONTENT_ARCHIVED_TASK")).toBe("OK");
    await prisma.task.updateMany({
      where: { id: w.task.id, organizationId: w.orgA },
      data: { archivedAt: new Date() },
    });
    expect(await content(w.subtask.id)).toBe("ARCHIVED");
    expect(await content(w.subtask.id, "CONTENT_ARCHIVED_TASK")).toBe("ARCHIVED");
    expect(
      await outcome((tx) =>
        requireTask(tx, manager, w.subtask.id, { lock: "none", level: "READ" }),
      ),
    ).toBe("OK");
    await prisma.project.updateMany({
      where: { id: w.project.id, organizationId: w.orgA },
      data: { archivedAt: new Date() },
    });
    const live = await seedTask(prisma, w.orgA, w.project.id);
    expect(await content(live.id)).toBe("ARCHIVED");
    expect(
      await outcome((tx) =>
        requireProject(tx, manager, w.project.id, { lock: "update", level: "MANAGE" }),
      ),
    ).toBe("ARCHIVED");
    expect(
      await outcome((tx) =>
        requireProject(tx, manager, w.project.id, { lock: "update", level: "MANAGE_ARCHIVED" }),
      ),
    ).toBe("OK");
  });
});

describe("parent lock (review C3)", () => {
  it("parent archive first: the subtask write waits and then refuses with ARCHIVED", async () => {
    const w = await seedPrivacyWorld(prisma);
    const t1Pid = deferred<number>();
    const t2Pid = deferred<number>();
    const gate = hold();
    const archive = prisma.$transaction(async (tx) => {
      t1Pid.resolve(await backendPid(tx));
      await tx.$executeRaw`
        UPDATE "Task" SET "archivedAt" = now()
        WHERE "id" = ${w.task.id} AND "organizationId" = ${w.orgA}`;
      await gate.promise;
    }, TX);
    const holder = await t1Pid.promise;
    const write = prisma.$transaction(async (tx) => {
      t2Pid.resolve(await backendPid(tx));
      return requireTask(tx as unknown as ProjectDb, w.actors.member, w.subtask.id, {
        lock: "share",
        level: "CONTENT",
        taskLock: "update",
      });
    }, TX);
    const waiter = await t2Pid.promise;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "parent archive first", holder, waiter });
    gate.resolve();
    const results = await settleAll<unknown>([archive, write]);
    assertNoDeadlock(results);
    expect(results[0]?.status).toBe("fulfilled");
    const refused = results[1];
    expect(refused?.status).toBe("rejected");
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(ProjectRefusal);
    expect((refused as PromiseRejectedResult).reason.code).toBe("ARCHIVED");
  });

  it("subtask write first: the parent archive waits for it and then completes", async () => {
    const w = await seedPrivacyWorld(prisma);
    const t1Pid = deferred<number>();
    const t2Pid = deferred<number>();
    const gate = hold();
    const write = prisma.$transaction(async (tx) => {
      const access = await requireTask(tx as unknown as ProjectDb, w.actors.member, w.subtask.id, {
        lock: "share",
        level: "CONTENT",
        taskLock: "update",
      });
      t2Pid.resolve(await backendPid(tx));
      await gate.promise;
      return access.task.id;
    }, TX);
    const holder = await t2Pid.promise;
    const archive = prisma.$transaction(async (tx) => {
      t1Pid.resolve(await backendPid(tx));
      await tx.$executeRaw`
        UPDATE "Task" SET "archivedAt" = now()
        WHERE "id" = ${w.task.id} AND "organizationId" = ${w.orgA}`;
    }, TX);
    const waiter = await t1Pid.promise;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "subtask write first", holder, waiter });
    gate.resolve();
    const results = await settleAll<unknown>([write, archive]);
    assertNoDeadlock(results);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const parent = await prisma.task.findFirstOrThrow({
      where: { id: w.task.id, organizationId: w.orgA },
    });
    expect(parent.archivedAt).not.toBeNull();
  });
});
