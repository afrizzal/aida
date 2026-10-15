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

// ---------------------------------------------------------------------------------------------
// Mappings, refusals and privacy across the move (Task 2)

async function keyRows(orgId: string, taskIds: readonly string[]) {
  return prisma.taskKey.findMany({
    where: { organizationId: orgId, taskId: { in: [...taskIds] } },
    orderBy: { normalizedKey: "asc" },
    select: { normalizedKey: true, kind: true },
  });
}

describe("moveTask mappings", () => {
  it("maps labels and milestone by name, keeps comments, attachments and favorites, aliases every key", async () => {
    const w = await world();
    const bug = await seedLabel(prisma, w.orgId, w.source.id, { name: "Bug" });
    const ui = await seedLabel(prisma, w.orgId, w.source.id, { name: "UI" });
    const beta = await seedMilestone(prisma, w.orgId, w.source.id, { name: "Beta" });
    const targetBug = await seedLabel(prisma, w.orgId, w.target.id, { name: "bug" });
    const targetBeta = await seedMilestone(prisma, w.orgId, w.target.id, { name: "beta" });
    const root = await seedTask(prisma, w.orgId, w.source.id, {
      createdByUserId: w.mover.userId,
      assigneeUserId: w.other.userId,
      milestoneId: beta.id,
      labelIds: [bug.id, ui.id],
    });
    const late = await seedTask(prisma, w.orgId, w.source.id, {
      parentId: root.id,
      rank: 2048,
      labelIds: [ui.id],
    });
    const early = await seedTask(prisma, w.orgId, w.source.id, {
      parentId: root.id,
      rank: 1024,
      milestoneId: beta.id,
    });
    const comment = await seedComment(prisma, w.orgId, root.id, { authorUserId: w.other.userId });
    const attachment = await seedAttachment(prisma, w.orgId, root.id, {
      uploadedByUserId: w.other.userId,
    });
    await prisma.taskFavorite.create({
      data: { organizationId: w.orgId, userId: w.other.userId, taskId: root.id },
    });

    const result = await moveTask(w.mover, root.id, w.target.id, 0);
    expect(result).toEqual({
      ok: true,
      taskId: root.id,
      key: "WEB-1",
      projectId: w.target.id,
      version: 1,
      subtaskCount: 2,
    });
    const tasks = await prisma.task.findMany({
      where: { organizationId: w.orgId, id: { in: [root.id, early.id, late.id] } },
      select: { id: true, projectId: true, key: true, milestoneId: true, assigneeUserId: true },
    });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get(root.id)).toEqual({
      id: root.id,
      projectId: w.target.id,
      key: "WEB-1",
      milestoneId: targetBeta.id,
      assigneeUserId: w.other.userId,
    });
    expect(byId.get(early.id)).toMatchObject({ key: "WEB-2", milestoneId: targetBeta.id });
    expect(byId.get(late.id)).toMatchObject({ key: "WEB-3", milestoneId: null });
    const links = await prisma.taskLabel.findMany({
      where: { organizationId: w.orgId, taskId: { in: [root.id, early.id, late.id] } },
      select: { taskId: true, labelId: true, projectId: true },
    });
    expect(links).toEqual([{ taskId: root.id, labelId: targetBug.id, projectId: w.target.id }]);
    expect(
      await prisma.taskComment.findFirst({ where: { id: comment.id }, select: { taskId: true } }),
    ).toEqual({ taskId: root.id });
    expect(
      await prisma.taskAttachment.findFirst({
        where: { id: attachment.id },
        select: { taskId: true },
      }),
    ).toEqual({ taskId: root.id });
    expect(
      await prisma.taskFavorite.count({ where: { organizationId: w.orgId, taskId: root.id } }),
    ).toBe(1);
    expect(await keyRows(w.orgId, [root.id, early.id, late.id])).toEqual([
      { normalizedKey: "OPS-1", kind: "ALIAS" },
      { normalizedKey: "OPS-2", kind: "ALIAS" },
      { normalizedKey: "OPS-3", kind: "ALIAS" },
      { normalizedKey: "WEB-1", kind: "ACTIVE" },
      { normalizedKey: "WEB-2", kind: "ACTIVE" },
      { normalizedKey: "WEB-3", kind: "ACTIVE" },
    ]);
    for (const [oldKey, task, newKey] of [
      ["OPS-1", root, "WEB-1"],
      ["OPS-2", late, "WEB-3"],
      ["OPS-3", early, "WEB-2"],
    ] as const) {
      expect(await resolveTaskKey(w.mover, oldKey)).toEqual({
        ok: true,
        taskId: task.id,
        key: newKey,
        projectId: w.target.id,
        isAlias: true,
      });
    }
    const rows = await movedRows(w.orgId);
    expect(rows.map((r) => [r.before, r.after])).toEqual([
      [
        {
          projectId: w.source.id,
          taskKey: "OPS-1",
          milestoneId: beta.id,
          labelNames: ["Bug", "UI"],
          assigneeUserId: w.other.userId,
        },
        {
          projectId: w.target.id,
          taskKey: "WEB-1",
          milestoneId: targetBeta.id,
          labelNames: ["bug"],
          assigneeUserId: w.other.userId,
          subtaskCount: 2,
        },
      ],
    ]);
  });

  it("clears an assignee who is not eligible in a private target, keeps an eligible one and the recurrence", async () => {
    const w = await world({ targetPrivate: true });
    const recurrence = { rule: "WEEKLY", anchor: "2026-11-02", timeZone: "Asia/Jakarta" } as const;
    const lost = await seedTask(prisma, w.orgId, w.source.id, {
      assigneeUserId: w.other.userId,
      dueDate: "2026-11-02",
      recurrence: recurrence,
    });
    const kept = await seedTask(prisma, w.orgId, w.source.id, { assigneeUserId: w.mover.userId });
    expect((await moveTask(w.mover, lost.id, w.target.id, 0)).ok).toBe(true);
    expect((await moveTask(w.mover, kept.id, w.target.id, 0)).ok).toBe(true);
    const rows = await prisma.task.findMany({
      where: { organizationId: w.orgId, id: { in: [lost.id, kept.id] } },
      select: {
        id: true,
        assigneeUserId: true,
        recurrenceRule: true,
        recurrenceAnchor: true,
        recurrenceTimeZone: true,
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(lost.id)).toEqual({
      id: lost.id,
      assigneeUserId: null,
      recurrenceRule: "WEEKLY",
      recurrenceAnchor: new Date("2026-11-02T00:00:00.000Z"),
      recurrenceTimeZone: "Asia/Jakarta",
    });
    expect(byId.get(kept.id)?.assigneeUserId).toBe(w.mover.userId);
    const moved = await movedRows(w.orgId);
    expect(moved.map((r) => (r.after as { assigneeUserId: unknown }).assigneeUserId)).toEqual([
      null,
      w.mover.userId,
    ]);
    expect(moved.map((r) => (r.before as { assigneeUserId: unknown }).assigneeUserId)).toEqual([
      w.other.userId,
      w.mover.userId,
    ]);
  });
});

describe("moveTask refusals", () => {
  it("refuses SUBTASK_MOVE, INVALID_INPUT, ARCHIVED, NOT_FOUND and CONFLICT and changes nothing", async () => {
    const w = await world();
    const archived = await seedProject(prisma, w.orgId, {
      createdByUserId: w.mover.userId,
      archivedAt: new Date(),
      managerUserIds: [w.mover.userId],
    });
    const hidden = await seedProject(prisma, w.orgId, {
      createdByUserId: w.mover.userId,
      isPrivate: true,
      managerUserIds: [w.mover.userId],
    });
    const root = await seedTask(prisma, w.orgId, w.source.id, {});
    const sub = await seedTask(prisma, w.orgId, w.source.id, { parentId: root.id });
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await moveTask(w.mover, sub.id, w.target.id, 0)).toEqual({
      ok: false,
      code: "SUBTASK_MOVE",
    });
    expect(await moveTask(w.mover, root.id, w.source.id, 0)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "targetProjectId",
    });
    expect(await moveTask(w.mover, root.id, archived.id, 0)).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    const hiddenResult = await moveTask(w.other, root.id, hidden.id, 0);
    expect(hiddenResult).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(hiddenResult).toEqual(await moveTask(w.other, root.id, missingId(), 0));
    expect(await moveTask(w.mover, root.id, w.target.id, 3)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
  });

  it("an old key and the task are NOT_FOUND for a former reader after a move into a private project", async () => {
    const w = await world({ targetPrivate: true });
    const t = await seedTask(prisma, w.orgId, w.source.id, {});
    expect((await getTask(w.nonMember, t.id)).ok).toBe(true);
    expect((await resolveTaskKey(w.nonMember, "OPS-1")).ok).toBe(true);
    expect((await moveTask(w.mover, t.id, w.target.id, 0)).ok).toBe(true);
    const task = await getTask(w.nonMember, t.id);
    expect(task).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(task).toEqual(await getTask(w.nonMember, missingId()));
    const key = await resolveTaskKey(w.nonMember, "ops-1");
    expect(key).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(key).toEqual(await resolveTaskKey(w.nonMember, "ZZQ-999"));
    expect((await resolveTaskKey(w.mover, "OPS-1")).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Move redaction from both sides (review C1, R2-1, R3-1; contract sections 5 and 17)

/** Two private projects with distinct secret values; M reads both, X only S, Y only T. */
async function secretWorld() {
  const org = await seedOrgWithMembers(prisma, [
    "owner",
    "member",
    "member",
    "member",
    "member",
    "member",
  ]);
  const [, m, x, y, us, ut] = org.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const s = await seedProject(prisma, org.orgId, {
    createdByUserId: m,
    name: "S-secret-name",
    keyPrefix: "SSEC",
    isPrivate: true,
    managerUserIds: [m],
    memberUserIds: [x, us],
  });
  const t = await seedProject(prisma, org.orgId, {
    createdByUserId: m,
    name: "T-secret-name",
    keyPrefix: "TSEC",
    isPrivate: true,
    managerUserIds: [m],
    memberUserIds: [y, ut],
  });
  const sMilestone = await seedMilestone(prisma, org.orgId, s.id, { name: "s-milestone" });
  const tMilestone = await seedMilestone(prisma, org.orgId, t.id, { name: "t-milestone" });
  const sShared = await seedLabel(prisma, org.orgId, s.id, { name: "shared" });
  const sOnly = await seedLabel(prisma, org.orgId, s.id, { name: "s-only-label" });
  const tShared = await seedLabel(prisma, org.orgId, t.id, { name: "shared" });
  return {
    orgId: org.orgId,
    s,
    t,
    sMilestone,
    tMilestone,
    sShared,
    sOnly,
    tShared,
    users: { m, x, y, us, ut },
    M: actorOf(m, org.orgId),
    X: actorOf(x, org.orgId),
    Y: actorOf(y, org.orgId),
  };
}

type SecretWorld = Awaited<ReturnType<typeof secretWorld>>;

/** SSEC-1: labels shared and s-only-label, milestone s-milestone, assignee US. */
async function seedSourceTask(w: SecretWorld) {
  return seedTask(prisma, w.orgId, w.s.id, {
    title: "s-secret-task",
    assigneeUserId: w.users.us,
    milestoneId: w.sMilestone.id,
    labelIds: [w.sShared.id, w.sOnly.id],
  });
}

/** The stored row of one move: its id, createdAt and batchId (the ids the move created). */
async function storedMove(orgId: string, taskId: string) {
  const row = await prisma.projectActivity.findFirstOrThrow({
    where: { organizationId: orgId, verb: "TASK_MOVED", taskId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, createdAt: true, batchId: true },
  });
  return { id: row.id, createdAt: row.createdAt, batchId: row.batchId as string };
}

/** The redacted projection of contract section 5 for one TASK_MOVED row, every key written out. */
function redactedMove(
  stored: { id: string; createdAt: Date },
  m: string,
  sides: {
    projectId: string | null;
    relatedProjectId: string | null;
    before: unknown;
    after: unknown;
  },
) {
  return {
    id: stored.id,
    projectId: sides.projectId,
    relatedProjectId: sides.relatedProjectId,
    taskId: null,
    teamId: null,
    actorUserId: m,
    verb: "TASK_MOVED",
    entityType: "TASK",
    entityId: null,
    before: sides.before,
    after: sides.after,
    batchId: null,
    createdAt: stored.createdAt,
    redacted: true,
  };
}

function expectFeedKeys(page: unknown) {
  const rows = (page as { rows: Record<string, unknown>[] }).rows;
  for (const row of rows) expect(Object.keys(row)).toEqual([...ACTIVITY_FEED_ROW_KEYS]);
}

function expectAbsent(value: unknown, secrets: readonly string[]) {
  const text = JSON.stringify(value);
  for (const secret of secrets) expect(text.includes(secret), secret).toBe(false);
}

describe("moveTask redaction", () => {
  it("move redaction: source reader", async () => {
    const w = await secretWorld();
    const task = await seedSourceTask(w);
    expect((await moveTask(w.M, task.id, w.t.id, 0)).ok).toBe(true);
    const stored = await storedMove(w.orgId, task.id);
    const page = await listProjectActivity(w.X, w.s.id);
    const row = redactedMove(stored, w.users.m, {
      projectId: null,
      relatedProjectId: w.s.id,
      before: {
        projectId: w.s.id,
        taskKey: "SSEC-1",
        milestoneId: w.sMilestone.id,
        labelNames: ["s-only-label", "shared"],
        assigneeUserId: w.users.us,
      },
      after: REDACTED_SIDE,
    });
    expect(page).toEqual({ ok: true, rows: [row], hasMore: false, nextCursor: null });
    expectFeedKeys(page);
    expectAbsent(page, [
      w.t.id,
      "T-secret-name",
      "TSEC",
      "TSEC-1",
      w.tMilestone.id,
      w.users.ut,
      stored.batchId,
    ]);
    expectAbsent(page.ok ? page.rows[0] : null, [task.id, stored.batchId]);
    expect(await listTaskActivity(w.X, task.id)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("move redaction: target reader", async () => {
    const w = await secretWorld();
    const task = await seedSourceTask(w);
    expect((await moveTask(w.M, task.id, w.t.id, 0)).ok).toBe(true);
    const stored = await storedMove(w.orgId, task.id);
    const row = redactedMove(stored, w.users.m, {
      projectId: w.t.id,
      relatedProjectId: null,
      before: REDACTED_SIDE,
      after: {
        projectId: w.t.id,
        taskKey: "TSEC-1",
        milestoneId: null,
        labelNames: ["shared"],
        assigneeUserId: null,
        subtaskCount: 0,
      },
    });
    const page = await listProjectActivity(w.Y, w.t.id);
    expect(page).toEqual({ ok: true, rows: [row], hasMore: false, nextCursor: null });
    expectFeedKeys(page);
    const secrets = [w.s.id, "S-secret-name", "SSEC", "s-only-label", w.sMilestone.id, w.users.us];
    expectAbsent(page, secrets);
    const history = await listTaskActivity(w.Y, task.id);
    expect(history).toEqual({ ok: true, rows: [row], hasMore: false, nextCursor: null });
    expectAbsent(history, secrets);
  });

  it("move redaction: reverse direction", async () => {
    const w = await secretWorld();
    const sTask = await seedSourceTask(w);
    const tTask = await seedTask(prisma, w.orgId, w.t.id, {
      title: "t-secret-task",
      assigneeUserId: w.users.ut,
      milestoneId: w.tMilestone.id,
      labelIds: [w.tShared.id],
    });
    expect((await moveTask(w.M, sTask.id, w.t.id, 0)).ok).toBe(true);
    expect((await moveTask(w.M, tTask.id, w.s.id, 0)).ok).toBe(true);
    const first = await storedMove(w.orgId, sTask.id);
    const second = await storedMove(w.orgId, tTask.id);
    const sSideFirst = {
      projectId: w.s.id,
      taskKey: "SSEC-1",
      milestoneId: w.sMilestone.id,
      labelNames: ["s-only-label", "shared"],
      assigneeUserId: w.users.us,
    };
    const tSideFirst = {
      projectId: w.t.id,
      taskKey: "TSEC-2",
      milestoneId: null,
      labelNames: ["shared"],
      assigneeUserId: null,
      subtaskCount: 0,
    };
    const tSideSecond = {
      projectId: w.t.id,
      taskKey: "TSEC-1",
      milestoneId: w.tMilestone.id,
      labelNames: ["shared"],
      assigneeUserId: w.users.ut,
    };
    const sSideSecond = {
      projectId: w.s.id,
      taskKey: "SSEC-2",
      milestoneId: null,
      labelNames: ["shared"],
      assigneeUserId: null,
      subtaskCount: 0,
    };

    // Y is the source reader of the second move (T to S) and the target reader of the first.
    const yPage = await listProjectActivity(w.Y, w.t.id);
    expect(yPage).toEqual({
      ok: true,
      rows: [
        redactedMove(second, w.users.m, {
          projectId: null,
          relatedProjectId: w.t.id,
          before: tSideSecond,
          after: REDACTED_SIDE,
        }),
        redactedMove(first, w.users.m, {
          projectId: w.t.id,
          relatedProjectId: null,
          before: REDACTED_SIDE,
          after: tSideFirst,
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
    expectFeedKeys(yPage);
    expectAbsent(yPage, [
      w.s.id,
      "S-secret-name",
      "SSEC",
      "s-only-label",
      w.sMilestone.id,
      w.users.us,
      first.batchId,
      second.batchId,
    ]);
    expectAbsent(yPage.ok ? yPage.rows[0] : null, [tTask.id, second.batchId]);

    // X is the target reader of the second move and the source reader of the first.
    const xPage = await listProjectActivity(w.X, w.s.id);
    expect(xPage).toEqual({
      ok: true,
      rows: [
        redactedMove(second, w.users.m, {
          projectId: w.s.id,
          relatedProjectId: null,
          before: REDACTED_SIDE,
          after: sSideSecond,
        }),
        redactedMove(first, w.users.m, {
          projectId: null,
          relatedProjectId: w.s.id,
          before: sSideFirst,
          after: REDACTED_SIDE,
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
    expectFeedKeys(xPage);
    expectAbsent(xPage, [
      w.t.id,
      "T-secret-name",
      "TSEC",
      w.tMilestone.id,
      w.users.ut,
      first.batchId,
      second.batchId,
    ]);
    expectAbsent(xPage.ok ? xPage.rows[1] : null, [sTask.id, first.batchId]);

    // M reads both projects: every row as stored, redacted false.
    const full = (
      stored: typeof first,
      taskId: string,
      from: string,
      to: string,
      b: object,
      a: object,
    ) => ({
      id: stored.id,
      projectId: to,
      relatedProjectId: from,
      taskId,
      teamId: null,
      actorUserId: w.users.m,
      verb: "TASK_MOVED",
      entityType: "TASK",
      entityId: taskId,
      before: b,
      after: a,
      batchId: stored.batchId,
      createdAt: stored.createdAt,
      redacted: false,
    });
    const expectedFull = [
      full(second, tTask.id, w.t.id, w.s.id, tSideSecond, sSideSecond),
      full(first, sTask.id, w.s.id, w.t.id, sSideFirst, tSideFirst),
    ];
    for (const projectId of [w.s.id, w.t.id]) {
      expect(await listProjectActivity(w.M, projectId)).toEqual({
        ok: true,
        rows: expectedFull,
        hasMore: false,
        nextCursor: null,
      });
    }
  });

  it("move redaction: source history kept", async () => {
    const w = await secretWorld();
    const created = await createTask(w.M, w.s.id, {
      title: "s-history-task",
      assigneeUserId: w.users.us,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await updateTask(w.M, created.taskId, 0, { title: "s-history-task renamed" })).ok).toBe(
      true,
    );
    const r0 = await listProjectActivity(w.X, w.s.id);
    expect(r0.ok).toBe(true);
    if (!r0.ok) return;
    expect(r0.rows.map((r) => r.verb)).toEqual(["TASK_UPDATED", "TASK_CREATED"]);
    expect(r0.rows.map((r) => r.taskId)).toEqual([created.taskId, created.taskId]);
    expect((await moveTask(w.M, created.taskId, w.t.id, 1)).ok).toBe(true);
    const stored = await storedMove(w.orgId, created.taskId);
    const movedRow = redactedMove(stored, w.users.m, {
      projectId: null,
      relatedProjectId: w.s.id,
      before: {
        projectId: w.s.id,
        taskKey: "SSEC-1",
        milestoneId: null,
        labelNames: [],
        assigneeUserId: w.users.us,
      },
      after: REDACTED_SIDE,
    });
    const page = await listProjectActivity(w.X, w.s.id);
    expect(page).toEqual({
      ok: true,
      rows: [movedRow, ...r0.rows],
      hasMore: false,
      nextCursor: null,
    });
    expectFeedKeys(page);
    expectAbsent(movedRow, [created.taskId, w.t.id, "TSEC-1", stored.batchId]);
    expectAbsent(page, [
      w.t.id,
      "T-secret-name",
      "TSEC",
      "TSEC-1",
      w.tMilestone.id,
      w.users.ut,
      stored.batchId,
    ]);
    const history = await listTaskActivity(w.Y, created.taskId);
    expect(history).toEqual({
      ok: true,
      rows: [
        redactedMove(stored, w.users.m, {
          projectId: w.t.id,
          relatedProjectId: null,
          before: REDACTED_SIDE,
          after: {
            projectId: w.t.id,
            taskKey: "TSEC-1",
            milestoneId: null,
            labelNames: [],
            assigneeUserId: null,
            subtaskCount: 0,
          },
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("move redaction: after a project is deleted", async () => {
    const w = await secretWorld();
    const task = await seedSourceTask(w);
    expect((await moveTask(w.M, task.id, w.t.id, 0)).ok).toBe(true);
    const stored = await storedMove(w.orgId, task.id);
    await hardDeleteProjectRowsForTest(prisma, w.orgId, w.s.id);
    expect(await listProjectActivity(w.M, w.t.id)).toEqual({
      ok: true,
      rows: [
        redactedMove(stored, w.users.m, {
          projectId: w.t.id,
          relatedProjectId: null,
          before: REDACTED_SIDE,
          after: {
            projectId: w.t.id,
            taskKey: "TSEC-1",
            milestoneId: null,
            labelNames: ["shared"],
            assigneeUserId: null,
            subtaskCount: 0,
          },
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
    const missing = await listProjectActivity(w.M, missingId());
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await listProjectActivity(w.M, w.s.id)).toEqual(missing);
    expect(await listProjectActivity(w.X, w.s.id)).toEqual(missing);

    // A fresh world: the target is removed instead.
    const v = await secretWorld();
    const other = await seedSourceTask(v);
    expect((await moveTask(v.M, other.id, v.t.id, 0)).ok).toBe(true);
    const storedV = await storedMove(v.orgId, other.id);
    await hardDeleteProjectRowsForTest(prisma, v.orgId, v.t.id);
    expect(await listProjectActivity(v.M, v.s.id)).toEqual({
      ok: true,
      rows: [
        redactedMove(storedV, v.users.m, {
          projectId: null,
          relatedProjectId: v.s.id,
          before: {
            projectId: v.s.id,
            taskKey: "SSEC-1",
            milestoneId: v.sMilestone.id,
            labelNames: ["s-only-label", "shared"],
            assigneeUserId: v.users.us,
          },
          after: REDACTED_SIDE,
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Races (contract section 3)

describe("moveTask races", () => {
  it("two opposite moves (A to B and B to A) serialize on the project rows with no 40P01", async () => {
    const w = await world();
    const t1 = await seedTask(prisma, w.orgId, w.source.id, {});
    const t2 = await seedTask(prisma, w.orgId, w.target.id, {});
    const [a, b] = await raceInOrder(
      "opposite moves",
      "moveTask",
      () => moveTask(w.mover, t1.id, w.target.id, 0),
      "moveTask",
      () => moveTask(w.mover, t2.id, w.source.id, 0),
    );
    expect(a).toEqual({
      ok: true,
      taskId: t1.id,
      key: "WEB-2",
      projectId: w.target.id,
      version: 1,
      subtaskCount: 0,
    });
    expect(b).toEqual({
      ok: true,
      taskId: t2.id,
      key: "OPS-2",
      projectId: w.source.id,
      version: 1,
      subtaskCount: 0,
    });
  });

  it("an edit holding the source makes the move wait; the move carries the edit", async () => {
    const w = await world();
    const t = await seedTask(prisma, w.orgId, w.source.id, { title: "before edit" });
    const [edit, move] = await raceInOrder(
      "update then move",
      "updateTask",
      () => updateTask(w.mover, t.id, 0, { title: "after edit" }),
      "moveTask",
      // The move names the version the held edit produces (1): it runs after the edit commits.
      () => moveTask(w.mover, t.id, w.target.id, 1),
    );
    expect(edit).toEqual({ ok: true, changed: true, version: 1 });
    expect(move).toMatchObject({ ok: true, key: "WEB-1", version: 2 });
    const row = await prisma.task.findFirst({
      where: { id: t.id, organizationId: w.orgId },
      select: { title: true, projectId: true, version: true },
    });
    expect(row).toEqual({ title: "after edit", projectId: w.target.id, version: 2 });
  });

  it("a move holding both projects makes an edit wait; the edit with the old version is CONFLICT", async () => {
    const w = await world();
    const t = await seedTask(prisma, w.orgId, w.source.id, { title: "unchanged" });
    const [move, edit] = await raceInOrder(
      "move then update",
      "moveTask",
      () => moveTask(w.mover, t.id, w.target.id, 0),
      "updateTask",
      () => updateTask(w.mover, t.id, 0, { title: "lost edit" }),
    );
    expect(move).toMatchObject({ ok: true, key: "WEB-1", version: 1 });
    expect(edit).toEqual({ ok: false, code: "CONFLICT" });
    const row = await prisma.task.findFirst({
      where: { id: t.id, organizationId: w.orgId },
      select: { title: true, version: true },
    });
    expect(row).toEqual({ title: "unchanged", version: 1 });
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: w.orgId, taskId: t.id, verb: "TASK_UPDATED" },
      }),
    ).toBe(0);
  });
});
