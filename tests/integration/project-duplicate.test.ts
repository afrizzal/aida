// Phase 14 duplicateTask and duplicateProject (contract sections 1, 3, 5, 8, 11 and 17; D-13;
// reviews C1, C6, R2-1 and R3-2; AIDA-103, AIDA-104, AIDA-68) on a real Postgres through
// Testcontainers. No mocks. Races record the holder's and the waiter's backend PIDs and wait for
// exactly that waiter to be blocked by that holder (waitForBlockedBy on the one-connection
// observer client), never a sleep; every settled promise is checked for 40P01. Recurrence columns
// are seeded only through seedTask's recurrence option.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { listProjectActivity } from "@/lib/projects/activity";
import { ACTIVITY_FEED_ROW_KEYS, RANK_MAX, REDACTED_SIDE } from "@/lib/projects/contract";
import { deleteTask } from "@/lib/projects/delete";
import { duplicateProject, duplicateTask } from "@/lib/projects/duplicate";
import { setTaskLabels } from "@/lib/projects/labels";
import { listProjectTasks } from "@/lib/projects/tasks";
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
  seedTeam,
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
  console.info(`project-duplicate PIDs: ${JSON.stringify(racePids)}`);
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

/** One organization: owner, manager D, member E; project P (non-private unless asked). */
async function world(opts: { isPrivate?: boolean; keyPrefix?: string } = {}) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
  const [owner, d, e, other] = org.users.map((u) => u.id) as [string, string, string, string];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: d,
    keyPrefix: opts.keyPrefix ?? "DUP",
    isPrivate: opts.isPrivate ?? false,
    managerUserIds: [d],
    memberUserIds: [e],
  });
  return {
    orgId: org.orgId,
    project,
    users: { owner, d, e, other },
    D: actorOf(d, org.orgId),
    E: actorOf(e, org.orgId),
  };
}

async function todoOrder(actor: { userId: string; orgId: string }, projectId: string) {
  const page = await listProjectTasks(actor, projectId, { status: "TODO", parentId: null });
  if (!page.ok) throw new Error(`listProjectTasks: ${page.code}`);
  return page.tasks.map((t) => t.title);
}

// ---------------------------------------------------------------------------------------------
// duplicateTask

describe("duplicateTask", () => {
  it("copies a task and its non-archived subtasks without comments, attachments or recurrence", async () => {
    const w = await world();
    const label = await seedLabel(prisma, w.orgId, w.project.id, { name: "Bug" });
    const milestone = await seedMilestone(prisma, w.orgId, w.project.id, { name: "Beta" });
    const source = await seedTask(prisma, w.orgId, w.project.id, {
      title: "source",
      assigneeUserId: w.users.e,
      milestoneId: milestone.id,
      labelIds: [label.id],
      dueDate: "2026-12-01",
      recurrence: { rule: "WEEKLY", anchor: "2026-12-01", timeZone: "UTC" },
    });
    await seedTask(prisma, w.orgId, w.project.id, { title: "next" });
    const kept = await seedTask(prisma, w.orgId, w.project.id, {
      title: "kept sub",
      parentId: source.id,
      labelIds: [label.id],
    });
    await seedTask(prisma, w.orgId, w.project.id, {
      title: "archived sub",
      parentId: source.id,
      archivedAt: new Date(),
    });
    await seedComment(prisma, w.orgId, source.id, { authorUserId: w.users.e });
    await seedAttachment(prisma, w.orgId, source.id, { uploadedByUserId: w.users.e });

    const result = await duplicateTask(w.E, source.id);
    expect(result).toMatchObject({ ok: true, key: "DUP-5", subtaskCount: 1 });
    if (!result.ok) return;
    const copy = await prisma.task.findFirstOrThrow({
      where: { id: result.taskId, organizationId: w.orgId },
      include: { labels: true, comments: true, attachments: true },
    });
    expect(copy).toMatchObject({
      title: "source",
      parentId: null,
      assigneeUserId: w.users.e,
      milestoneId: milestone.id,
      dueDate: new Date("2026-12-01T00:00:00.000Z"),
      recurrenceRule: null,
      recurrenceAnchor: null,
      recurrenceTimeZone: null,
      comments: [],
      attachments: [],
    });
    expect(copy.labels.map((l) => l.labelId)).toEqual([label.id]);
    const subs = await prisma.task.findMany({
      where: { organizationId: w.orgId, parentId: result.taskId },
      select: { title: true, key: true, rank: true },
    });
    expect(subs).toEqual([{ title: "kept sub", key: "DUP-6", rank: 1024 }]);
    expect(await todoOrder(w.E, w.project.id)).toEqual(["source", "source", "next"]);
    const rows = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, verb: "TASK_DUPLICATED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
    expect(rows.map((r) => [r.relatedProjectId, r.before, r.after])).toEqual(
      expect.arrayContaining([
        [
          null,
          { projectId: w.project.id, taskId: source.id, taskKey: source.key },
          { projectId: w.project.id, taskKey: "DUP-5" },
        ],
        [
          null,
          { projectId: w.project.id, taskId: kept.id, taskKey: kept.key },
          { projectId: w.project.id, taskKey: "DUP-6" },
        ],
      ]),
    );
  });

  it("placement: adjacent ranks rebalance the group and put the copy right after its source", async () => {
    const w = await world();
    const a = await seedTask(prisma, w.orgId, w.project.id, { title: "A", rank: 1024 });
    await seedTask(prisma, w.orgId, w.project.id, { title: "B", rank: 1025 });
    await seedTask(prisma, w.orgId, w.project.id, { title: "C", rank: 2048 });
    expect((await duplicateTask(w.D, a.id)).ok).toBe(true);
    expect(await todoOrder(w.D, w.project.id)).toEqual(["A", "A", "B", "C"]);
  });

  it("placement: a tie with the next task still puts the copy between them", async () => {
    const w = await world();
    const one = await seedTask(prisma, w.orgId, w.project.id, { title: "T1", rank: 1024 });
    const two = await seedTask(prisma, w.orgId, w.project.id, { title: "T2", rank: 1024 });
    const [first, second] = one.id < two.id ? [one, two] : [two, one];
    const titles = { [one.id]: "T1", [two.id]: "T2" };
    expect((await duplicateTask(w.D, first.id)).ok).toBe(true);
    const order = await todoOrder(w.D, w.project.id);
    expect(order).toEqual([titles[first.id], titles[first.id], titles[second.id]]);
  });

  it("placement: the last task at RANK_MAX gets its copy after it through a rebalance", async () => {
    const w = await world();
    await seedTask(prisma, w.orgId, w.project.id, { title: "A", rank: 1024 });
    const last = await seedTask(prisma, w.orgId, w.project.id, { title: "Z", rank: RANK_MAX });
    const result = await duplicateTask(w.D, last.id);
    expect(result.ok).toBe(true);
    expect(await todoOrder(w.D, w.project.id)).toEqual(["A", "Z", "Z"]);
    const ranks = await prisma.task.findMany({
      where: { organizationId: w.orgId, projectId: w.project.id },
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      select: { rank: true },
    });
    expect(ranks.map((r) => r.rank)).toEqual([1024, 2048, 3072]);
  });

  it("placement: a free gap changes no other task's rank", async () => {
    const w = await world();
    const a = await seedTask(prisma, w.orgId, w.project.id, { title: "A", rank: 1024 });
    await seedTask(prisma, w.orgId, w.project.id, { title: "B", rank: 2048 });
    const result = await duplicateTask(w.D, a.id);
    expect(result.ok).toBe(true);
    const rows = await prisma.task.findMany({
      where: { organizationId: w.orgId, projectId: w.project.id },
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      select: { title: true, rank: true },
    });
    expect(rows).toEqual([
      { title: "A", rank: 1024 },
      { title: "A", rank: 1536 },
      { title: "B", rank: 2048 },
    ]);
  });

  it("two duplicates of one source serialize on the project row with no 40P01", async () => {
    const w = await world();
    const a = await seedTask(prisma, w.orgId, w.project.id, { title: "A", rank: 1024 });
    await seedTask(prisma, w.orgId, w.project.id, { title: "B", rank: 2048 });
    const [first, second] = await raceInOrder(
      "two duplicates of one source",
      "duplicateTask",
      () => duplicateTask(w.D, a.id),
      "duplicateTask",
      () => duplicateTask(w.E, a.id),
    );
    expect(first).toMatchObject({ ok: true, key: "DUP-3" });
    expect(second).toMatchObject({ ok: true, key: "DUP-4" });
    const page = await listProjectTasks(w.D, w.project.id, { status: "TODO", parentId: null });
    expect(page.ok && page.tasks.map((t) => t.key)).toEqual(["DUP-1", "DUP-4", "DUP-3", "DUP-2"]);
  });
});

// ---------------------------------------------------------------------------------------------
// duplicateProject

describe("duplicateProject", () => {
  it("includeTasks: false copies metadata, labels and milestones with the duplicating user as only member", async () => {
    const w = await world({ isPrivate: true });
    await prisma.project.update({
      where: { id: w.project.id },
      data: {
        descriptionMarkdown: "About the source",
        color: "teal",
        icon: "rocket",
        status: "ACTIVE",
        dueDate: new Date("2027-01-15T00:00:00.000Z"),
      },
    });
    await seedLabel(prisma, w.orgId, w.project.id, { name: "Bug", color: "red" });
    await seedMilestone(prisma, w.orgId, w.project.id, { name: "Beta", date: "2027-01-10" });
    await seedTask(prisma, w.orgId, w.project.id, {});
    const result = await duplicateProject(w.E, w.project.id, {
      name: "Copy",
      keyPrefix: "cpy",
      includeTasks: false,
    });
    expect(result).toMatchObject({ ok: true, keyPrefix: "CPY", taskCount: 0 });
    if (!result.ok) return;
    const copy = await prisma.project.findFirstOrThrow({
      where: { id: result.projectId, organizationId: w.orgId },
      include: {
        members: { select: { userId: true, role: true } },
        labels: { select: { name: true, color: true } },
        milestones: { select: { name: true, date: true } },
      },
    });
    expect(copy).toMatchObject({
      name: "Copy",
      keyPrefix: "CPY",
      descriptionMarkdown: "About the source",
      color: "teal",
      icon: "rocket",
      status: "ACTIVE",
      dueDate: new Date("2027-01-15T00:00:00.000Z"),
      isPrivate: true,
      members: [{ userId: w.users.e, role: "MANAGER" }],
      labels: [{ name: "Bug", color: "red" }],
      milestones: [{ name: "Beta", date: new Date("2027-01-10T00:00:00.000Z") }],
    });
    expect(
      await prisma.task.count({ where: { organizationId: w.orgId, projectId: copy.id } }),
    ).toBe(0);
    const rows = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, projectId: copy.id },
    });
    expect(rows.map((r) => [r.verb, r.relatedProjectId, r.before, r.after])).toEqual([
      [
        "PROJECT_DUPLICATED",
        w.project.id,
        { projectId: w.project.id },
        { projectId: copy.id, taskCount: 0, labelCount: 1, milestoneCount: 1 },
      ],
    ]);
  });

  it("includeTasks: true copies every non-archived task and subtask with mapped labels and milestones", async () => {
    const w = await world({ isPrivate: true });
    const label = await seedLabel(prisma, w.orgId, w.project.id, { name: "Bug" });
    const milestone = await seedMilestone(prisma, w.orgId, w.project.id, { name: "Beta" });
    await seedTeam(prisma, w.orgId, { projectIds: [w.project.id] });
    const t1 = await seedTask(prisma, w.orgId, w.project.id, {
      title: "t1",
      rank: 2048,
      assigneeUserId: w.users.e,
    });
    const t2 = await seedTask(prisma, w.orgId, w.project.id, {
      title: "t2",
      rank: 1024,
      assigneeUserId: w.users.d,
      labelIds: [label.id],
      milestoneId: milestone.id,
      startDate: "2026-12-01",
      dueDate: "2026-12-05",
      recurrence: { rule: "DAILY", anchor: "2026-12-05", timeZone: "UTC" },
    });
    await seedTask(prisma, w.orgId, w.project.id, { title: "t3", status: "BACKLOG", rank: 9000 });
    await seedTask(prisma, w.orgId, w.project.id, { title: "t4", archivedAt: new Date() });
    await seedTask(prisma, w.orgId, w.project.id, { title: "s1", parentId: t2.id, rank: 2048 });
    await seedTask(prisma, w.orgId, w.project.id, { title: "s2", parentId: t2.id, rank: 1024 });
    await seedTask(prisma, w.orgId, w.project.id, {
      title: "s3",
      parentId: t2.id,
      archivedAt: new Date(),
    });
    await prisma.task.update({
      where: { id: t2.id },
      data: { priority: "HIGH", estimateMinutes: 90, descriptionMarkdown: "t2 body" },
    });
    await seedComment(prisma, w.orgId, t1.id, { authorUserId: w.users.e });
    await prisma.taskFavorite.create({
      data: { organizationId: w.orgId, userId: w.users.d, taskId: t1.id },
    });

    const result = await duplicateProject(w.D, w.project.id, {
      name: "Copy",
      keyPrefix: "CPY",
      includeTasks: true,
    });
    expect(result).toMatchObject({ ok: true, taskCount: 5 });
    if (!result.ok) return;
    const copyLabel = await prisma.projectLabel.findFirstOrThrow({
      where: { organizationId: w.orgId, projectId: result.projectId },
    });
    const copyMilestone = await prisma.projectMilestone.findFirstOrThrow({
      where: { organizationId: w.orgId, projectId: result.projectId },
    });
    const tasks = await prisma.task.findMany({
      where: { organizationId: w.orgId, projectId: result.projectId },
      orderBy: { number: "asc" },
      include: { labels: true, comments: true, favorites: true },
    });
    const parentKey = (id: string | null) => tasks.find((t) => t.id === id)?.key ?? null;
    expect(
      tasks.map((t) => ({
        key: t.key,
        title: t.title,
        parent: parentKey(t.parentId),
        status: t.status,
        rank: t.rank,
        assignee: t.assigneeUserId,
        labels: t.labels.map((l) => l.labelId),
        milestone: t.milestoneId,
      })),
    ).toEqual([
      {
        key: "CPY-1",
        title: "t3",
        parent: null,
        status: "BACKLOG",
        rank: 9000,
        assignee: null,
        labels: [],
        milestone: null,
      },
      {
        key: "CPY-2",
        title: "t2",
        parent: null,
        status: "TODO",
        rank: 1024,
        assignee: w.users.d,
        labels: [copyLabel.id],
        milestone: copyMilestone.id,
      },
      {
        key: "CPY-3",
        title: "s2",
        parent: "CPY-2",
        status: "TODO",
        rank: 1024,
        assignee: null,
        labels: [],
        milestone: null,
      },
      {
        key: "CPY-4",
        title: "s1",
        parent: "CPY-2",
        status: "TODO",
        rank: 2048,
        assignee: null,
        labels: [],
        milestone: null,
      },
      {
        key: "CPY-5",
        title: "t1",
        parent: null,
        status: "TODO",
        rank: 2048,
        assignee: null,
        labels: [],
        milestone: null,
      },
    ]);
    expect(tasks[1]).toMatchObject({
      priority: "HIGH",
      estimateMinutes: 90,
      descriptionMarkdown: "t2 body",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      dueDate: new Date("2026-12-05T00:00:00.000Z"),
      recurrenceRule: null,
    });
    expect(tasks.every((t) => t.comments.length === 0 && t.favorites.length === 0)).toBe(true);
    expect(
      await prisma.projectMember.findMany({
        where: { organizationId: w.orgId, projectId: result.projectId },
        select: { userId: true, role: true },
      }),
    ).toEqual([{ userId: w.users.d, role: "MANAGER" }]);
    expect(
      await prisma.projectTeam.count({
        where: { organizationId: w.orgId, projectId: result.projectId },
      }),
    ).toBe(0);
    const rows = await prisma.projectActivity.findMany({
      where: { organizationId: w.orgId, projectId: result.projectId },
    });
    expect(rows.filter((r) => r.verb === "TASK_DUPLICATED")).toHaveLength(5);
    expect(rows.filter((r) => r.verb === "PROJECT_DUPLICATED")).toHaveLength(1);
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
    expect(rows.every((r) => r.relatedProjectId === w.project.id)).toBe(true);
  });

  it("refuses PREFIX_TAKEN and PREFIX_INVALID without a write; an archived source can be duplicated", async () => {
    const w = await world();
    const taken = await seedProject(prisma, w.orgId, { createdByUserId: w.users.d });
    await prisma.projectKeyPrefix.create({
      data: { organizationId: w.orgId, prefix: "RSV", projectId: missingId() },
    });
    const before = await projectTableSnapshot(prisma, w.orgId);
    for (const keyPrefix of [taken.keyPrefix, "RSV", "DUP"]) {
      expect(
        await duplicateProject(w.D, w.project.id, { name: "Copy", keyPrefix, includeTasks: true }),
      ).toEqual({ ok: false, code: "PREFIX_TAKEN" });
    }
    expect(
      await duplicateProject(w.D, w.project.id, {
        name: "Copy",
        keyPrefix: "1AB",
        includeTasks: true,
      }),
    ).toEqual({ ok: false, code: "PREFIX_INVALID" });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    await prisma.project.update({ where: { id: w.project.id }, data: { archivedAt: new Date() } });
    const archived = await duplicateProject(w.D, w.project.id, {
      name: "From archive",
      keyPrefix: "ARC",
      includeTasks: false,
    });
    expect(archived).toMatchObject({ ok: true, keyPrefix: "ARC" });
  });
});

// ---------------------------------------------------------------------------------------------
// duplicateProject against a label edit and a task delete, both orders (review R3-2)

async function sourceWorld() {
  const w = await world({ isPrivate: true, keyPrefix: "SSEC" });
  const bug = await seedLabel(prisma, w.orgId, w.project.id, { name: "Bug" });
  const ui = await seedLabel(prisma, w.orgId, w.project.id, { name: "UI" });
  const beta = await seedMilestone(prisma, w.orgId, w.project.id, { name: "Beta" });
  const a = await seedTask(prisma, w.orgId, w.project.id, {
    title: "task-a",
    labelIds: [bug.id],
    milestoneId: beta.id,
    createdByUserId: w.users.d,
  });
  const b = await seedTask(prisma, w.orgId, w.project.id, {
    title: "task-b",
    createdByUserId: w.users.d,
  });
  return { ...w, bug, ui, beta, a, b };
}

type SourceWorld = Awaited<ReturnType<typeof sourceWorld>>;

const duplicateOf = (w: SourceWorld) => () =>
  duplicateProject(w.D, w.project.id, { name: "Copy", keyPrefix: "CPY", includeTasks: true });

/** The copy as read back: labels, milestones, tasks in key order, and its activity. */
async function readCopy(orgId: string, copyId: string) {
  const labels = await prisma.projectLabel.findMany({
    where: { organizationId: orgId, projectId: copyId },
    select: { id: true, name: true },
  });
  const milestones = await prisma.projectMilestone.findMany({
    where: { organizationId: orgId, projectId: copyId },
    select: { id: true, name: true },
  });
  const labelName = new Map(labels.map((l) => [l.id, l.name]));
  const milestoneName = new Map(milestones.map((m) => [m.id, m.name]));
  const tasks = await prisma.task.findMany({
    where: { organizationId: orgId, projectId: copyId },
    orderBy: { number: "asc" },
    include: { labels: true },
  });
  const rows = await prisma.projectActivity.findMany({
    where: { organizationId: orgId, projectId: copyId },
  });
  return {
    labels: labels.map((l) => l.name).sort(),
    milestones: milestones.map((m) => m.name).sort(),
    tasks: tasks.map((t) => ({
      key: t.key,
      title: t.title,
      labels: t.labels.map((l) => labelName.get(l.labelId)).sort(),
      milestone: t.milestoneId ? (milestoneName.get(t.milestoneId) ?? "?") : null,
    })),
    projectAfter: rows.find((r) => r.verb === "PROJECT_DUPLICATED")?.after,
    taskRows: rows.filter((r) => r.verb === "TASK_DUPLICATED").length,
  };
}

function expectedCopy(copyId: string, taskALabels: string[], withB: boolean) {
  const tasks = [{ key: "CPY-1", title: "task-a", labels: taskALabels, milestone: "Beta" }];
  if (withB) tasks.push({ key: "CPY-2", title: "task-b", labels: [], milestone: null as never });
  return {
    labels: ["Bug", "UI"],
    milestones: ["Beta"],
    tasks,
    projectAfter: { projectId: copyId, taskCount: tasks.length, labelCount: 2, milestoneCount: 1 },
    taskRows: tasks.length,
  };
}

async function labelNamesOf(orgId: string, taskId: string) {
  const links = await prisma.taskLabel.findMany({
    where: { organizationId: orgId, taskId },
    include: { label: { select: { name: true } } },
  });
  return links.map((l) => l.label.name).sort();
}

describe("duplicateProject races", () => {
  it("duplicateProject: setTaskLabels, duplicate first", async () => {
    const w = await sourceWorld();
    const [dup, edit] = await raceInOrder(
      "duplicateProject: setTaskLabels, duplicate first",
      "duplicateProject",
      duplicateOf(w),
      "setTaskLabels",
      () => setTaskLabels(w.E, w.a.id, 0, [w.ui.id]),
    );
    expect(dup).toMatchObject({ ok: true, taskCount: 2 });
    expect(edit).toMatchObject({ ok: true, changed: true });
    const copyId = (dup as { projectId: string }).projectId;
    expect(await readCopy(w.orgId, copyId)).toEqual(expectedCopy(copyId, ["Bug"], true));
    expect(await labelNamesOf(w.orgId, w.a.id)).toEqual(["UI"]);
  });

  it("duplicateProject: setTaskLabels, edit first", async () => {
    const w = await sourceWorld();
    const [edit, dup] = await raceInOrder(
      "duplicateProject: setTaskLabels, edit first",
      "setTaskLabels",
      () => setTaskLabels(w.E, w.a.id, 0, [w.ui.id]),
      "duplicateProject",
      duplicateOf(w),
    );
    expect(edit).toMatchObject({ ok: true, changed: true });
    expect(dup).toMatchObject({ ok: true, taskCount: 2 });
    const copyId = (dup as { projectId: string }).projectId;
    expect(await readCopy(w.orgId, copyId)).toEqual(expectedCopy(copyId, ["UI"], true));
  });

  it("duplicateProject: deleteTask, duplicate first", async () => {
    const w = await sourceWorld();
    const [dup, del] = await raceInOrder(
      "duplicateProject: deleteTask, duplicate first",
      "duplicateProject",
      duplicateOf(w),
      "deleteTask",
      () => deleteTask(w.D, w.b.id, { confirm: true, expectedVersion: 0 }),
    );
    expect(dup).toMatchObject({ ok: true, taskCount: 2 });
    expect(del).toEqual({ ok: true, removedTaskCount: 1, cleanupQueued: 0 });
    const copyId = (dup as { projectId: string }).projectId;
    expect(await readCopy(w.orgId, copyId)).toEqual(expectedCopy(copyId, ["Bug"], true));
    expect(await prisma.task.count({ where: { organizationId: w.orgId, id: w.b.id } })).toBe(0);
  });

  it("duplicateProject: deleteTask, delete first", async () => {
    const w = await sourceWorld();
    const [del, dup] = await raceInOrder(
      "duplicateProject: deleteTask, delete first",
      "deleteTask",
      () => deleteTask(w.D, w.b.id, { confirm: true, expectedVersion: 0 }),
      "duplicateProject",
      duplicateOf(w),
    );
    expect(del).toEqual({ ok: true, removedTaskCount: 1, cleanupQueued: 0 });
    expect(dup).toMatchObject({ ok: true, taskCount: 1 });
    const copyId = (dup as { projectId: string }).projectId;
    expect(await readCopy(w.orgId, copyId)).toEqual(expectedCopy(copyId, ["Bug"], false));
  });
});

// ---------------------------------------------------------------------------------------------
// Duplicate redaction from both sides (review C1 and R2-1; contract sections 5 and 17)

/** Private S with two tasks; D duplicates it into private C; X reads C only, Z reads S only. */
async function duplicateWorld() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
  const [, d, x, z] = org.users.map((u) => u.id) as [string, string, string, string];
  const s = await seedProject(prisma, org.orgId, {
    createdByUserId: d,
    name: "S-secret-name",
    keyPrefix: "SSEC",
    isPrivate: true,
    managerUserIds: [d],
    memberUserIds: [z],
  });
  const s1 = await seedTask(prisma, org.orgId, s.id, { title: "first", rank: 1024 });
  const s2 = await seedTask(prisma, org.orgId, s.id, { title: "second", rank: 2048 });
  const D = actorOf(d, org.orgId);
  const result = await duplicateProject(D, s.id, {
    name: "C-secret-name",
    keyPrefix: "CSEC",
    includeTasks: true,
  });
  if (!result.ok) throw new Error(`duplicateProject: ${result.code}`);
  const c = result.projectId;
  await prisma.projectMember.create({
    data: { organizationId: org.orgId, projectId: c, userId: x, role: "MEMBER" },
  });
  const copies = await prisma.task.findMany({
    where: { organizationId: org.orgId, projectId: c },
    orderBy: { number: "asc" },
    select: { id: true, key: true },
  });
  const stored = await prisma.projectActivity.findMany({
    where: { organizationId: org.orgId, projectId: c },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, createdAt: true, verb: true, taskId: true, batchId: true },
  });
  return {
    orgId: org.orgId,
    s: s.id,
    c,
    sources: [s1, s2],
    copies,
    stored,
    users: { d, x, z },
    D,
    X: actorOf(x, org.orgId),
    Z: actorOf(z, org.orgId),
  };
}

type DuplicateWorld = Awaited<ReturnType<typeof duplicateWorld>>;

/** The redacted projection of every duplicate row, every key written out, in feed order. */
function redactedDuplicates(w: DuplicateWorld, hidden: "source" | "copy") {
  return w.stored.map((row) => {
    const isProject = row.verb === "PROJECT_DUPLICATED";
    const index = w.copies.findIndex((t) => t.id === row.taskId);
    const source = w.sources[index];
    const copy = w.copies[index];
    const before = isProject
      ? { projectId: w.s }
      : { projectId: w.s, taskId: source?.id, taskKey: source?.key };
    const after = isProject
      ? { projectId: w.c, taskCount: 2, labelCount: 0, milestoneCount: 0 }
      : { projectId: w.c, taskKey: copy?.key };
    return {
      id: row.id,
      projectId: hidden === "copy" ? null : w.c,
      relatedProjectId: hidden === "source" ? null : w.s,
      taskId: null,
      teamId: null,
      actorUserId: w.users.d,
      verb: isProject ? "PROJECT_DUPLICATED" : "TASK_DUPLICATED",
      entityType: isProject ? "PROJECT" : "TASK",
      entityId: null,
      before: hidden === "source" ? REDACTED_SIDE : before,
      after: hidden === "copy" ? REDACTED_SIDE : after,
      batchId: null,
      createdAt: row.createdAt,
      redacted: true,
    };
  });
}

function expectFeedKeys(page: unknown) {
  for (const row of (page as { rows: Record<string, unknown>[] }).rows) {
    expect(Object.keys(row)).toEqual([...ACTIVITY_FEED_ROW_KEYS]);
  }
}

function expectAbsent(value: unknown, secrets: readonly string[]) {
  const text = JSON.stringify(value);
  for (const secret of secrets) expect(text.includes(secret), secret).toBe(false);
}

describe("duplicate redaction", () => {
  it("duplicate redaction: copy reader", async () => {
    const w = await duplicateWorld();
    expect(w.stored.map((r) => r.verb).sort()).toEqual([
      "PROJECT_DUPLICATED",
      "TASK_DUPLICATED",
      "TASK_DUPLICATED",
    ]);
    const page = await listProjectActivity(w.X, w.c);
    expect(page).toEqual({
      ok: true,
      rows: redactedDuplicates(w, "source"),
      hasMore: false,
      nextCursor: null,
    });
    expectFeedKeys(page);
    expectAbsent(page, [
      w.s,
      "S-secret-name",
      "SSEC",
      ...w.sources.map((t) => t.key),
      ...w.sources.map((t) => t.id),
      w.stored[0]?.batchId as string,
    ]);
  });

  it("duplicate redaction: source reader", async () => {
    const w = await duplicateWorld();
    const page = await listProjectActivity(w.Z, w.s);
    expect(page).toEqual({
      ok: true,
      rows: redactedDuplicates(w, "copy"),
      hasMore: false,
      nextCursor: null,
    });
    expectFeedKeys(page);
    expectAbsent(page, [
      w.c,
      "C-secret-name",
      "CSEC",
      ...w.copies.map((t) => t.key),
      ...w.copies.map((t) => t.id),
      w.stored[0]?.batchId as string,
    ]);
  });

  it("duplicate redaction: after a project is deleted", async () => {
    const w = await duplicateWorld();
    await hardDeleteProjectRowsForTest(prisma, w.orgId, w.s);
    expect(await listProjectActivity(w.D, w.c)).toEqual({
      ok: true,
      rows: redactedDuplicates(w, "source"),
      hasMore: false,
      nextCursor: null,
    });
    const missing = await listProjectActivity(w.D, missingId());
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await listProjectActivity(w.D, w.s)).toEqual(missing);
    expect(await listProjectActivity(w.Z, w.s)).toEqual(missing);

    const v = await duplicateWorld();
    await hardDeleteProjectRowsForTest(prisma, v.orgId, v.c);
    expect(await listProjectActivity(v.D, v.s)).toEqual({
      ok: true,
      rows: redactedDuplicates(v, "copy"),
      hasMore: false,
      nextCursor: null,
    });
  });
});
