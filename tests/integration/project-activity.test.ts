// Phase 14 activity (contract section 5; D-05, C8, AIDA-68; reviews C1, C2, C5, R2-1 and R3-3):
// the single writer's bounds, the three feeds, the redaction of two-project rows from both sides
// and after a project is gone, the team feed's hidden private link, and the complete page
// sequences of two worlds that differ only by rows the reader cannot read. Unmocked, on the
// shared Testcontainers database; every case seeds fresh organizations and fixed createdAt values.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  type ActivityFeedRow,
  type ActivityPage,
  encodeActivityCursor,
  listProjectActivity,
  listTaskActivity,
  listTeamActivity,
  recordProjectActivity,
  redactActivityRow,
} from "@/lib/projects/activity";
import { type ProjectResult, REDACTED_SIDE } from "@/lib/projects/contract";
import type { ProjectDb } from "@/lib/projects/service";
import {
  actorOf,
  missingId,
  seedActivity,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
} from "../support/project-fixtures";
import { hardDeleteProjectRowsForTest } from "../support/project-hard-delete";

const at = (seconds: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));

async function orgWith(count: number) {
  const org = await seedOrgWithMembers(prisma, ["owner", ...Array(count).fill("member")]);
  return { orgId: org.orgId, users: org.users.map((u) => u.id) };
}

function page(result: ProjectResult<ActivityPage>): ActivityPage {
  if (!result.ok) throw new Error(`feed refused: ${result.code}`);
  return result;
}

async function record(orgId: string, before: Record<string, unknown> | null) {
  return prisma.$transaction((tx) =>
    recordProjectActivity(tx as unknown as ProjectDb, {
      orgId,
      projectId: null,
      teamId: randomUUID(),
      actorUserId: randomUUID(),
      verb: "TEAM_UPDATED",
      entityType: "TEAM",
      entityId: randomUUID(),
      before: before as never,
      after: null,
      batchId: randomUUID(),
    }),
  );
}

describe("recordProjectActivity bounds", () => {
  it("refuses 17 keys, description and body keys, a non-camelCase key and a value over 4096 bytes, and cuts long strings", async () => {
    const { orgId } = await orgWith(0);
    const seventeen = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
    await expect(record(orgId, seventeen)).rejects.toThrow(/more than 16 keys/);
    await expect(record(orgId, { description: "x" })).rejects.toThrow(/refused/);
    await expect(record(orgId, { body: "x" })).rejects.toThrow(/refused/);
    await expect(record(orgId, { Bad_key: 1 })).rejects.toThrow(/camelCase/);
    const big = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`k${i}`, "é".repeat(150)]),
    );
    await expect(record(orgId, big)).rejects.toThrow(/4096 bytes/);
    expect(await prisma.projectActivity.count({ where: { organizationId: orgId } })).toBe(0);
    const long = "a".repeat(300);
    const { id } = await record(orgId, { name: long });
    const row = await prisma.projectActivity.findFirstOrThrow({
      where: { id, organizationId: orgId },
    });
    expect(row.before).toEqual({ name: "a".repeat(200) });
  });
});

describe("listProjectActivity and listTaskActivity", () => {
  it("returns rows newest first with id as tie-breaker, filters by verbs and actor, and includes related rows", async () => {
    const { orgId, users } = await orgWith(3);
    const [, manager, other, stranger] = users as [string, string, string, string];
    const p = await seedProject(prisma, orgId, { createdByUserId: manager });
    const o = await seedProject(prisma, orgId, { createdByUserId: manager });
    const r1 = await seedActivity(prisma, orgId, {
      projectId: p.id,
      actorUserId: other,
      createdAt: at(10),
    });
    const r2 = await seedActivity(prisma, orgId, {
      projectId: p.id,
      actorUserId: manager,
      verb: "PROJECT_STATUS_CHANGED",
      createdAt: at(20),
    });
    const r3 = await seedActivity(prisma, orgId, {
      projectId: p.id,
      actorUserId: manager,
      createdAt: at(20),
    });
    const r4 = await seedActivity(prisma, orgId, {
      projectId: o.id,
      relatedProjectId: p.id,
      verb: "TASK_MOVED",
      entityType: "TASK",
      actorUserId: manager,
      before: { projectId: p.id },
      after: { projectId: o.id },
      createdAt: at(30),
    });
    const tie = await prisma.projectActivity.findMany({
      where: { organizationId: orgId, id: { in: [r2.id, r3.id] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const all = page(await listProjectActivity(actorOf(stranger, orgId), p.id));
    expect(all.rows.map((r) => r.id)).toEqual([r4.id, ...tie.map((t) => t.id), r1.id]);
    expect(all.rows[0]).toMatchObject({ relatedProjectId: p.id, redacted: false });
    expect(Object.keys(all.rows[0] as object)).toEqual([
      "id",
      "projectId",
      "relatedProjectId",
      "taskId",
      "teamId",
      "actorUserId",
      "verb",
      "entityType",
      "entityId",
      "before",
      "after",
      "batchId",
      "createdAt",
      "redacted",
    ]);
    const updated = page(
      await listProjectActivity(actorOf(stranger, orgId), p.id, { verbs: ["PROJECT_UPDATED"] }),
    );
    expect(updated.rows.map((r) => r.id).sort()).toEqual([r1.id, r3.id].sort());
    const byOther = page(
      await listProjectActivity(actorOf(stranger, orgId), p.id, { actorUserId: other }),
    );
    expect(byOther.rows.map((r) => r.id)).toEqual([r1.id]);
  });

  it("a reader without access to the project or task gets NOT_FOUND, deep-equal to a missing id", async () => {
    const { orgId, users } = await orgWith(2);
    const [, manager, nonMember] = users as [string, string, string];
    const p = await seedProject(prisma, orgId, {
      createdByUserId: manager,
      isPrivate: true,
      managerUserIds: [manager],
    });
    const task = await seedTask(prisma, orgId, p.id);
    const reader = actorOf(nonMember, orgId);
    const missing = await listProjectActivity(reader, missingId());
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await listProjectActivity(reader, p.id)).toEqual(missing);
    expect(await listTaskActivity(reader, task.id)).toEqual(
      await listTaskActivity(reader, missingId()),
    );
    expect(await listTaskActivity(reader, task.id)).toEqual(missing);
  });
});

// ---------------------------------------------------------------------------------------------
// Redaction (review C1 and R2-1)

async function redactionWorld() {
  const { orgId, users } = await orgWith(8);
  const [, mover, readerS, readerT, readerBoth, readerC, assigneeS, assigneeT, outsiderOfAll] =
    users as [string, string, string, string, string, string, string, string, string];
  const s = await seedProject(prisma, orgId, {
    createdByUserId: mover,
    name: "S-secret-name",
    keyPrefix: "SSEC",
    isPrivate: true,
    managerUserIds: [mover],
    memberUserIds: [readerS, readerBoth, assigneeS],
  });
  const t = await seedProject(prisma, orgId, {
    createdByUserId: mover,
    name: "T-secret-name",
    keyPrefix: "TSEC",
    isPrivate: true,
    managerUserIds: [mover],
    memberUserIds: [readerT, readerBoth, assigneeT],
  });
  const c = await seedProject(prisma, orgId, {
    createdByUserId: mover,
    name: "C-copy-name",
    keyPrefix: "CCPY",
    isPrivate: true,
    managerUserIds: [mover],
    memberUserIds: [readerC],
  });
  const milestoneS = await seedMilestone(prisma, orgId, s.id, { name: "S milestone" });
  const milestoneT = await seedMilestone(prisma, orgId, t.id, { name: "T milestone" });
  const labelS = await seedLabel(prisma, orgId, s.id, { name: "s-only-label" });
  const labelT = await seedLabel(prisma, orgId, t.id, { name: "t-only-label" });
  const sourceTask = await seedTask(prisma, orgId, s.id, { labelIds: [labelS.id] });
  const moved = await seedTask(prisma, orgId, t.id, {
    assigneeUserId: assigneeT,
    milestoneId: milestoneT.id,
    labelIds: [labelT.id],
  });
  const copyTask = await seedTask(prisma, orgId, c.id);
  return {
    orgId,
    mover,
    readers: {
      s: actorOf(readerS, orgId),
      t: actorOf(readerT, orgId),
      both: actorOf(readerBoth, orgId),
      c: actorOf(readerC, orgId),
      none: actorOf(outsiderOfAll, orgId),
    },
    s,
    t,
    c,
    milestoneS,
    milestoneT,
    assigneeS,
    assigneeT,
    sourceTask,
    moved,
    copyTask,
  };
}

type World = Awaited<ReturnType<typeof redactionWorld>>;

async function seedMoveRow(w: World) {
  const batchId = randomUUID();
  const before = {
    projectId: w.s.id,
    taskKey: "SSEC-1",
    milestoneId: w.milestoneS.id,
    labelNames: ["s-only-label"],
    assigneeUserId: w.assigneeS,
  };
  const after = {
    projectId: w.t.id,
    taskKey: "TSEC-1",
    milestoneId: w.milestoneT.id,
    labelNames: ["t-only-label"],
    assigneeUserId: w.assigneeT,
    subtaskCount: 1,
  };
  const { id } = await seedActivity(prisma, w.orgId, {
    projectId: w.t.id,
    relatedProjectId: w.s.id,
    taskId: w.moved.id,
    teamId: null,
    actorUserId: w.mover,
    verb: "TASK_MOVED",
    entityType: "TASK",
    entityId: w.moved.id,
    before,
    after,
    batchId,
    createdAt: at(5),
  });
  const stored = {
    id,
    projectId: w.t.id,
    relatedProjectId: w.s.id,
    taskId: w.moved.id,
    teamId: null,
    actorUserId: w.mover,
    verb: "TASK_MOVED" as const,
    entityType: "TASK" as const,
    entityId: w.moved.id,
    before,
    after,
    batchId,
    createdAt: at(5),
  };
  return { stored, batchId };
}

const sSecrets = (w: World) => [
  w.s.id,
  "S-secret-name",
  "SSEC",
  "SSEC-1",
  w.milestoneS.id,
  "s-only-label",
  w.assigneeS,
];
const tSecrets = (w: World) => [
  w.t.id,
  "T-secret-name",
  "TSEC",
  "TSEC-1",
  w.milestoneT.id,
  "t-only-label",
  w.assigneeT,
];

function expectAbsent(value: unknown, secrets: readonly string[]): void {
  const text = JSON.stringify(value);
  for (const secret of secrets) expect(text).not.toContain(secret);
}

function single(rows: ActivityFeedRow[]): ProjectResult<ActivityPage> {
  return { ok: true, rows, hasMore: false, nextCursor: null };
}

describe("redaction of two-project rows", () => {
  it("redaction: source reader", async () => {
    const w = await redactionWorld();
    const { stored, batchId } = await seedMoveRow(w);
    const result = await listProjectActivity(w.readers.s, w.s.id);
    expect(result).toEqual(
      single([
        {
          id: stored.id,
          projectId: null,
          relatedProjectId: w.s.id,
          taskId: null,
          teamId: null,
          actorUserId: w.mover,
          verb: "TASK_MOVED",
          entityType: "TASK",
          entityId: null,
          before: stored.before,
          after: REDACTED_SIDE,
          batchId: null,
          createdAt: at(5),
          redacted: true,
        },
      ]),
    );
    expectAbsent(result, [...tSecrets(w), w.moved.id, batchId]);
  });

  it("redaction: target reader", async () => {
    const w = await redactionWorld();
    const { stored } = await seedMoveRow(w);
    const result = await listProjectActivity(w.readers.t, w.t.id);
    expect(result).toEqual(
      single([
        {
          id: stored.id,
          projectId: w.t.id,
          relatedProjectId: null,
          taskId: null,
          teamId: null,
          actorUserId: w.mover,
          verb: "TASK_MOVED",
          entityType: "TASK",
          entityId: null,
          before: REDACTED_SIDE,
          after: stored.after,
          batchId: null,
          createdAt: at(5),
          redacted: true,
        },
      ]),
    );
    expectAbsent(result, sSecrets(w));
  });

  it("redaction: reader of both", async () => {
    const w = await redactionWorld();
    const { stored } = await seedMoveRow(w);
    const expected = single([{ ...stored, redacted: false }]);
    expect(await listProjectActivity(w.readers.both, w.s.id)).toEqual(expected);
    expect(await listProjectActivity(w.readers.both, w.t.id)).toEqual(expected);
  });

  async function seedDuplicateRows(w: World) {
    const projectRow = await seedActivity(prisma, w.orgId, {
      projectId: w.c.id,
      relatedProjectId: w.s.id,
      actorUserId: w.mover,
      verb: "PROJECT_DUPLICATED",
      entityType: "PROJECT",
      entityId: w.c.id,
      before: { projectId: w.s.id },
      after: { projectId: w.c.id, taskCount: 1, labelCount: 1, milestoneCount: 1 },
      createdAt: at(6),
    });
    const taskRow = await seedActivity(prisma, w.orgId, {
      projectId: w.c.id,
      relatedProjectId: w.s.id,
      taskId: w.copyTask.id,
      actorUserId: w.mover,
      verb: "TASK_DUPLICATED",
      entityType: "TASK",
      entityId: w.copyTask.id,
      before: { projectId: w.s.id, taskId: w.sourceTask.id, taskKey: "SSEC-1" },
      after: { projectId: w.c.id, taskKey: w.copyTask.key },
      createdAt: at(7),
    });
    return { projectRow, taskRow };
  }

  it("redaction: duplicate rows, copy reader", async () => {
    const w = await redactionWorld();
    const { projectRow, taskRow } = await seedDuplicateRows(w);
    const result = await listProjectActivity(w.readers.c, w.c.id);
    const base = {
      relatedProjectId: null,
      taskId: null,
      teamId: null,
      actorUserId: w.mover,
      entityId: null,
      before: REDACTED_SIDE,
      batchId: null,
      redacted: true,
    };
    expect(result).toEqual(
      single([
        {
          ...base,
          id: taskRow.id,
          projectId: w.c.id,
          verb: "TASK_DUPLICATED",
          entityType: "TASK",
          after: { projectId: w.c.id, taskKey: w.copyTask.key },
          createdAt: at(7),
        },
        {
          ...base,
          id: projectRow.id,
          projectId: w.c.id,
          verb: "PROJECT_DUPLICATED",
          entityType: "PROJECT",
          after: { projectId: w.c.id, taskCount: 1, labelCount: 1, milestoneCount: 1 },
          createdAt: at(6),
        },
      ]),
    );
    expectAbsent(result, [w.s.id, "S-secret-name", "SSEC", w.sourceTask.id, "SSEC-1"]);
  });

  it("redaction: duplicate rows, source reader", async () => {
    const w = await redactionWorld();
    const { projectRow, taskRow } = await seedDuplicateRows(w);
    const result = await listProjectActivity(w.readers.s, w.s.id);
    const base = {
      projectId: null,
      relatedProjectId: w.s.id,
      taskId: null,
      teamId: null,
      actorUserId: w.mover,
      entityId: null,
      after: REDACTED_SIDE,
      batchId: null,
      redacted: true,
    };
    expect(result).toEqual(
      single([
        {
          ...base,
          id: taskRow.id,
          verb: "TASK_DUPLICATED",
          entityType: "TASK",
          before: { projectId: w.s.id, taskId: w.sourceTask.id, taskKey: "SSEC-1" },
          createdAt: at(7),
        },
        {
          ...base,
          id: projectRow.id,
          verb: "PROJECT_DUPLICATED",
          entityType: "PROJECT",
          before: { projectId: w.s.id },
          createdAt: at(6),
        },
      ]),
    );
    expectAbsent(result, [w.c.id, "C-copy-name", "CCPY", w.copyTask.key, w.copyTask.id]);
  });

  it("redaction: after the source project is deleted", async () => {
    const w = await redactionWorld();
    const { stored } = await seedMoveRow(w);
    await hardDeleteProjectRowsForTest(prisma, w.orgId, w.s.id);
    expect(await listProjectActivity(w.readers.both, w.t.id)).toEqual(
      single([
        {
          id: stored.id,
          projectId: w.t.id,
          relatedProjectId: null,
          taskId: null,
          teamId: null,
          actorUserId: w.mover,
          verb: "TASK_MOVED",
          entityType: "TASK",
          entityId: null,
          before: REDACTED_SIDE,
          after: stored.after,
          batchId: null,
          createdAt: at(5),
          redacted: true,
        },
      ]),
    );
    const gone = await listProjectActivity(w.readers.both, w.s.id);
    expect(gone).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(gone).toEqual(await listProjectActivity(w.readers.both, missingId()));
  });

  it("redaction: after the target project is deleted", async () => {
    const w = await redactionWorld();
    const { stored } = await seedMoveRow(w);
    await hardDeleteProjectRowsForTest(prisma, w.orgId, w.t.id);
    expect(await listProjectActivity(w.readers.both, w.s.id)).toEqual(
      single([
        {
          id: stored.id,
          projectId: null,
          relatedProjectId: w.s.id,
          taskId: null,
          teamId: null,
          actorUserId: w.mover,
          verb: "TASK_MOVED",
          entityType: "TASK",
          entityId: null,
          before: stored.before,
          after: REDACTED_SIDE,
          batchId: null,
          createdAt: at(5),
          redacted: true,
        },
      ]),
    );
    const gone = await listProjectActivity(w.readers.both, w.t.id);
    expect(gone).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(gone).toEqual(await listProjectActivity(w.readers.both, missingId()));
  });

  it("redactActivityRow: both sides and a deleted project", () => {
    const S = "proj_s";
    const T = "proj_t";
    const row = {
      id: "row_1",
      projectId: T,
      relatedProjectId: S,
      taskId: "task_1",
      teamId: null,
      actorUserId: "user_1",
      verb: "TASK_MOVED" as const,
      entityType: "TASK" as const,
      entityId: "task_1",
      before: { projectId: S, taskKey: "SSEC-1" },
      after: { projectId: T, taskKey: "TSEC-1", subtaskCount: 0 },
      batchId: "batch_1",
      createdAt: at(1),
    };
    const copy = structuredClone(row);
    const nulled = { taskId: null, teamId: null, entityId: null, batchId: null };
    const sourceSide = {
      ...row,
      ...nulled,
      projectId: null,
      after: REDACTED_SIDE,
      redacted: true,
    };
    const targetSide = {
      ...row,
      ...nulled,
      relatedProjectId: null,
      before: REDACTED_SIDE,
      redacted: true,
    };
    expect(redactActivityRow(row, new Set([S]))).toEqual(sourceSide);
    expect(redactActivityRow(row, new Set([T]))).toEqual(targetSide);
    expect(redactActivityRow(row, new Set([S, T]))).toEqual({ ...row, redacted: false });
    // S removed: a deleted project is never in the readable set.
    expect(redactActivityRow(row, new Set([T]))).toEqual(targetSide);
    const singleRow = { ...row, projectId: S, relatedProjectId: null, before: null, after: null };
    expect(redactActivityRow(singleRow, new Set([S]))).toEqual({ ...singleRow, redacted: false });
    expect(row).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------------------------
// The team feed (review C2 and C5) and feed pages (review R3-3)

async function teamWorld() {
  const { orgId, users } = await orgWith(4);
  const [orgAdmin, manager, nonMember, m1, m2] = users as [string, string, string, string, string];
  const p = await seedProject(prisma, orgId, {
    createdByUserId: manager,
    isPrivate: true,
    managerUserIds: [manager],
  });
  const teamA = await seedTeam(prisma, orgId, { memberUserIds: [m1, m2] });
  const teamB = await seedTeam(prisma, orgId, { memberUserIds: [m1, m2] });
  return {
    orgId,
    p,
    teamA,
    teamB,
    m1,
    manager: actorOf(manager, orgId),
    nonMember: actorOf(nonMember, orgId),
    orgAdmin: actorOf(orgAdmin, orgId),
    actorId: manager,
  };
}

type TeamWorld = Awaited<ReturnType<typeof teamWorld>>;

async function seedTeamOwnRows(w: TeamWorld, team: { id: string; name: string }) {
  await seedActivity(prisma, w.orgId, {
    teamId: team.id,
    actorUserId: w.actorId,
    verb: "TEAM_CREATED",
    entityType: "TEAM",
    entityId: team.id,
    after: { name: team.name },
    createdAt: at(10),
  });
  await seedActivity(prisma, w.orgId, {
    teamId: team.id,
    actorUserId: w.actorId,
    verb: "TEAM_MEMBER_ADDED",
    entityType: "TEAM_MEMBER",
    entityId: w.m1,
    after: { userId: w.m1 },
    createdAt: at(20),
  });
}

async function seedHiddenLinkRows(w: TeamWorld, createdAt: Date[] = [at(30), at(31)]) {
  await seedActivity(prisma, w.orgId, {
    projectId: w.p.id,
    teamId: w.teamA.id,
    actorUserId: w.actorId,
    verb: "TEAM_ASSIGNED",
    entityType: "PROJECT_TEAM",
    entityId: randomUUID(),
    after: { teamId: w.teamA.id },
    createdAt: createdAt[0],
  });
  await seedActivity(prisma, w.orgId, {
    projectId: w.p.id,
    teamId: w.teamA.id,
    actorUserId: w.actorId,
    verb: "MEMBER_ADDED",
    entityType: "PROJECT_MEMBER",
    entityId: randomUUID(),
    after: { userId: w.m1, role: "MEMBER", teamId: w.teamA.id },
    createdAt: createdAt[1],
  });
}

/** Replaces the world-specific ids of a feed result by placeholders (contract section 17). */
function normalizeFeed(
  result: ProjectResult<ActivityPage>,
  team: { id: string; name: string },
): unknown {
  const text = JSON.stringify(page(result).rows)
    .split(team.id)
    .join("TEAM")
    .split(team.name)
    .join("TEAM_NAME");
  const rows = JSON.parse(text) as Record<string, unknown>[];
  return rows.map((row, i) => ({ ...row, id: `row:${i}`, createdAt: "at", batchId: "batch" }));
}

describe("listTeamActivity", () => {
  it("returns the team's own rows to organization members and leaves out rows naming a private project they cannot read", async () => {
    const w = await teamWorld();
    await seedTeamOwnRows(w, w.teamA);
    await seedHiddenLinkRows(w);
    for (const reader of [w.nonMember, w.orgAdmin]) {
      const feed = page(await listTeamActivity(reader, w.teamA.id));
      expect(feed.rows.map((r) => r.verb)).toEqual(["TEAM_MEMBER_ADDED", "TEAM_CREATED"]);
      expect(JSON.stringify(feed)).not.toContain(w.p.id);
    }
    const managerFeed = page(await listTeamActivity(w.manager, w.teamA.id));
    expect(managerFeed.rows.map((r) => r.verb)).toEqual([
      "MEMBER_ADDED",
      "TEAM_ASSIGNED",
      "TEAM_MEMBER_ADDED",
      "TEAM_CREATED",
    ]);
  });

  it("hidden private link: two teams that differ only by rows naming a private project give equal feeds", async () => {
    const w = await teamWorld();
    await seedTeamOwnRows(w, w.teamA);
    await seedTeamOwnRows(w, w.teamB);
    await seedHiddenLinkRows(w);
    for (const reader of [w.nonMember, w.orgAdmin]) {
      const a = normalizeFeed(await listTeamActivity(reader, w.teamA.id), w.teamA);
      const b = normalizeFeed(await listTeamActivity(reader, w.teamB.id), w.teamB);
      expect(a).toEqual(b);
      expect(a).toHaveLength(2);
    }
  });

  it("a team id of another organization is NOT_FOUND, deep-equal to a missing id", async () => {
    const w = await teamWorld();
    const other = await orgWith(0);
    const outsider = actorOf(other.users[0] as string, other.orgId);
    const missing = await listTeamActivity(outsider, missingId());
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await listTeamActivity(outsider, w.teamA.id)).toEqual(missing);
  });
});

type Normalized = { rows: unknown[]; hasMore: boolean; nextCursor: string | null }[];

/** Pages a feed with limit 2 until hasMore is false and normalizes the whole sequence. */
async function pageThrough(
  fetchPage: (cursor: string | null) => Promise<ProjectResult<ActivityPage>>,
  worldId: string,
): Promise<Normalized> {
  const pages: ActivityPage[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const current = page(await fetchPage(cursor));
    pages.push(current);
    const last = current.rows[current.rows.length - 1];
    if (current.hasMore) {
      expect(last).toBeDefined();
      expect(current.nextCursor).toBe(encodeActivityCursor(last as ActivityFeedRow));
    } else {
      expect(current.nextCursor).toBeNull();
      break;
    }
    cursor = current.nextCursor;
  }
  const rowIds = new Map<string, string>();
  const batchIds = new Map<string, string>();
  const ph = (id: string) => {
    if (!rowIds.has(id)) rowIds.set(id, `row:${rowIds.size}`);
    return rowIds.get(id) as string;
  };
  const batch = (id: string | null) => {
    if (id === null) return null;
    if (!batchIds.has(id)) batchIds.set(id, `batch:${batchIds.size}`);
    return batchIds.get(id);
  };
  const swap = (v: string | null) => (v === worldId ? "world" : v);
  return pages.map((p) => {
    const rows = p.rows.map((r) => ({
      ...r,
      id: ph(r.id),
      teamId: swap(r.teamId),
      taskId: swap(r.taskId),
      entityId: swap(r.entityId),
      batchId: batch(r.batchId),
    }));
    const last = p.rows[p.rows.length - 1];
    return {
      rows,
      hasMore: p.hasMore,
      nextCursor: p.nextCursor && last ? `cursor:${ph(last.id)}` : null,
    };
  });
}

// Five readable rows at 90, 80, 70, 60 and 50 seconds; hidden rows at 100 (before the first
// readable row), 75, 74 and 73 (a run of three between pages of limit 2) and 40 and 30 (after the
// last readable row).
const READABLE_TIMES = [90, 80, 70, 60, 50];
const HIDDEN_TIMES = [100, 75, 74, 73, 40, 30];

function expectThreePages(seq: Normalized): void {
  expect(seq.map((p) => p.rows.length)).toEqual([2, 2, 1]);
  expect(seq.map((p) => p.hasMore)).toEqual([true, true, false]);
}

describe("feed pages", () => {
  it("team feed pages: hidden private rows", async () => {
    const w = await teamWorld();
    const verbs = [
      "TEAM_CREATED",
      "TEAM_MEMBER_ADDED",
      "TEAM_MEMBER_ADDED",
      "TEAM_MEMBER_ADDED",
      "TEAM_UPDATED",
    ] as const;
    for (const team of [w.teamA, w.teamB]) {
      for (const [i, verb] of verbs.entries()) {
        await seedActivity(prisma, w.orgId, {
          teamId: team.id,
          actorUserId: w.actorId,
          verb,
          entityType: verb === "TEAM_MEMBER_ADDED" ? "TEAM_MEMBER" : "TEAM",
          entityId: verb === "TEAM_MEMBER_ADDED" ? w.m1 : team.id,
          createdAt: at(READABLE_TIMES[i] as number),
        });
      }
    }
    for (const [i, seconds] of HIDDEN_TIMES.entries()) {
      await seedActivity(prisma, w.orgId, {
        projectId: w.p.id,
        teamId: w.teamA.id,
        actorUserId: w.actorId,
        verb: i % 2 === 0 ? "TEAM_ASSIGNED" : "MEMBER_ADDED",
        entityType: i % 2 === 0 ? "PROJECT_TEAM" : "PROJECT_MEMBER",
        entityId: randomUUID(),
        createdAt: at(seconds),
      });
    }
    const a = await pageThrough(
      (cursor) => listTeamActivity(w.nonMember, w.teamA.id, { limit: 2, cursor }),
      w.teamA.id,
    );
    const b = await pageThrough(
      (cursor) => listTeamActivity(w.nonMember, w.teamB.id, { limit: 2, cursor }),
      w.teamB.id,
    );
    expect(a).toEqual(b);
    expectThreePages(a);
    expect(JSON.stringify(a)).not.toContain(w.p.id);
  });

  it("task history pages: hidden rows", async () => {
    const { orgId, users } = await orgWith(2);
    const [, manager, nonMember] = users as [string, string, string];
    const q = await seedProject(prisma, orgId, { createdByUserId: manager });
    const p = await seedProject(prisma, orgId, {
      createdByUserId: manager,
      isPrivate: true,
      managerUserIds: [manager],
    });
    const taskA = await seedTask(prisma, orgId, q.id);
    const taskB = await seedTask(prisma, orgId, q.id);
    for (const task of [taskA, taskB]) {
      for (const seconds of READABLE_TIMES) {
        await seedActivity(prisma, orgId, {
          projectId: q.id,
          taskId: task.id,
          actorUserId: manager,
          verb: "TASK_UPDATED",
          entityType: "TASK",
          entityId: task.id,
          createdAt: at(seconds),
        });
      }
    }
    for (const seconds of HIDDEN_TIMES) {
      await seedActivity(prisma, orgId, {
        projectId: p.id,
        taskId: taskA.id,
        actorUserId: manager,
        verb: "TASK_UPDATED",
        entityType: "TASK",
        entityId: taskA.id,
        createdAt: at(seconds),
      });
    }
    const reader = actorOf(nonMember, orgId);
    const a = await pageThrough(
      (cursor) => listTaskActivity(reader, taskA.id, { limit: 2, cursor }),
      taskA.id,
    );
    const b = await pageThrough(
      (cursor) => listTaskActivity(reader, taskB.id, { limit: 2, cursor }),
      taskB.id,
    );
    expect(a).toEqual(b);
    expectThreePages(a);
    expect(JSON.stringify(a)).not.toContain(p.id);
  });
});
