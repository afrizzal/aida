// Phase 14 schema proofs (D-01, D-03, D-05, D-09, D-10, K61, K67, AIDA-64 to AIDA-71, AIDA-101,
// AIDA-102, AIDA-105): the projects tables, their database-enforced tenancy, the subtask and
// append-only triggers, the CHECKs and the catalog. Unmocked, on the shared Testcontainers database.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import {
  projectTableSnapshot,
  seedActivity,
  seedAttachment,
  seedComment,
  seedFileCleanup,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedPrivacyWorld,
  seedProject,
  seedTask,
  seedTeam,
} from "../support/project-fixtures";

// errorText and rejection: copied from tests/integration/kb-proposal-schema.test.ts (test files
// do not import each other).
/** Full text of a Prisma or pg adapter error, including meta and the cause chain. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; message?: string; meta?: unknown; cause?: unknown };
    parts.push(String(e.code ?? ""), String(e.message ?? current), JSON.stringify(e.meta ?? {}));
    current = e.cause;
  }
  return parts.join(" ");
}

/** Resolves with the error text when the promise rejects; fails the test when it resolves. */
async function rejection(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return errorText(err);
  }
  throw new Error("expected the operation to be rejected");
}

/** Inserts a project and its counter row with raw SQL; returns the project id. */
async function rawProject(orgId: string, keyPrefix: string): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "Project" ("id", "organizationId", "name", "keyPrefix", "updatedAt")
    VALUES (${id}, ${orgId}, ${`Project ${keyPrefix}`}, ${keyPrefix}, now())`;
  await prisma.$executeRaw`
    INSERT INTO "ProjectTaskCounter" ("projectId", "organizationId") VALUES (${id}, ${orgId})`;
  return id;
}

/** Inserts a task with raw SQL; returns its id. */
function rawTask(orgId: string, projectId: string, key: string, num: number, id = randomUUID()) {
  return prisma.$executeRaw`
    INSERT INTO "Task" ("id", "organizationId", "projectId", "number", "key", "title", "updatedAt")
    VALUES (${id}, ${orgId}, ${projectId}, ${num}, ${key}, 'Task', now())`;
}

describe("projects schema: tracer", () => {
  it("inserts a project with its counter and one task, readable through scopedDb", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const projectId = await rawProject(orgId, "TRC");
    const taskId = randomUUID();
    await rawTask(orgId, projectId, "TRC-1", 1, taskId);
    const db = scopedDb(orgId);
    const tasks = await db.task.findMany({ select: { id: true, key: true, projectId: true } });
    expect(tasks).toEqual([{ id: taskId, key: "TRC-1", projectId }]);
    expect(await db.projectTaskCounter.count()).toBe(1);
  });

  it("refuses a task of organization A in organization B's project (Task_organizationId_projectId_fkey)", async () => {
    const a = await seedOrgWithMembers(prisma, ["owner"]);
    const b = await seedOrgWithMembers(prisma, ["owner"]);
    const projectB = await rawProject(b.orgId, "BBB");
    const text = await rejection(rawTask(a.orgId, projectB, "BBB-1", 1));
    expect(text).toContain("Task_organizationId_projectId_fkey");
  });
});

// Captured from migration 20260701234808_ticket_search, copied from
// tests/integration/kb-proposal-schema.test.ts: this phase's migration must not have rewritten
// the generated FTS columns or their GIN indexes.
const TICKET_SEARCH_EXPR = `(setweight(to_tsvector('simple'::regconfig, COALESCE((number)::text, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(subject, ''::text)), 'B'::"char"))`;
const MESSAGE_SEARCH_EXPR = `to_tsvector('english'::regconfig, COALESCE("bodyMarkdown", ''::text))`;
const TICKET_SEARCH_INDEXDEF = `CREATE INDEX "Ticket_searchVector_idx" ON public."Ticket" USING gin ("searchVector")`;
const MESSAGE_SEARCH_INDEXDEF = `CREATE INDEX "Message_searchVector_idx" ON public."Message" USING gin ("searchVector")`;

const PHASE_14_TABLES = [
  "Project",
  "ProjectMember",
  "Team",
  "TeamMember",
  "ProjectTeam",
  "ProjectLabel",
  "ProjectMilestone",
  "Task",
  "TaskLabel",
  "TaskComment",
  "TaskAttachment",
  "ProjectFavorite",
  "TaskFavorite",
  "ProjectTaskCounter",
  "ProjectKeyPrefix",
  "TaskKey",
  "ProjectActivity",
  "ProjectFileCleanup",
] as const;

const COMPOSITE_FKS = [
  "ProjectFavorite_organizationId_projectId_fkey",
  "ProjectLabel_organizationId_projectId_fkey",
  "ProjectMember_organizationId_projectId_fkey",
  "ProjectMilestone_organizationId_projectId_fkey",
  "ProjectTaskCounter_organizationId_projectId_fkey",
  "ProjectTeam_organizationId_projectId_fkey",
  "ProjectTeam_organizationId_teamId_fkey",
  "TaskAttachment_organizationId_taskId_fkey",
  "TaskComment_organizationId_taskId_fkey",
  "TaskFavorite_organizationId_taskId_fkey",
  "TaskLabel_organizationId_projectId_labelId_fkey",
  "TaskLabel_organizationId_projectId_taskId_fkey",
  "Task_organizationId_projectId_fkey",
  "Task_organizationId_projectId_milestoneId_fkey",
  "Task_organizationId_projectId_parentId_fkey",
  "TeamMember_organizationId_teamId_fkey",
];

const NO_ID_TABLES = new Set(["TaskLabel", "ProjectTaskCounter"]);
const UPDATED_AT_TABLES = new Set([
  "Project",
  "Team",
  "ProjectLabel",
  "ProjectMilestone",
  "Task",
  "TaskComment",
  "TaskKey",
]);

/** Raw INSERT so the constraint name reaches the error text; adds id and updatedAt as needed. */
function insertRow(table: string, cols: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...cols };
  if (!NO_ID_TABLES.has(table) && row.id === undefined) row.id = randomUUID();
  if (UPDATED_AT_TABLES.has(table) && row.updatedAt === undefined) row.updatedAt = new Date();
  const names = Object.keys(row);
  const sql = `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names
    .map((_, i) => `$${i + 1}`)
    .join(", ")})`;
  return prisma.$executeRawUnsafe(sql, ...names.map((n) => row[n]));
}

async function refused(promise: PromiseLike<unknown>, name: string): Promise<void> {
  expect(await rejection(promise)).toContain(name);
}

type P = { id: string; keyPrefix: string };
const taskCols = (orgId: string, project: P, n: number, extra: Record<string, unknown> = {}) => ({
  organizationId: orgId,
  projectId: project.id,
  number: n,
  key: `${project.keyPrefix}-${n}`,
  title: "Task",
  ...extra,
});

/** Two organizations: A with projects a1 and a2, B with b1, each with a task, label and team. */
async function linkWorld() {
  const a = await seedOrgWithMembers(prisma, ["owner"]);
  const b = await seedOrgWithMembers(prisma, ["owner"]);
  const ua = a.users[0]?.id as string;
  const ub = b.users[0]?.id as string;
  const a1 = await seedProject(prisma, a.orgId, { createdByUserId: ua });
  const a2 = await seedProject(prisma, a.orgId, { createdByUserId: ua });
  const b1 = await seedProject(prisma, b.orgId, { createdByUserId: ub });
  return {
    orgA: a.orgId,
    orgB: b.orgId,
    ua,
    ub,
    a1,
    a2,
    b1,
    taskA1: await seedTask(prisma, a.orgId, a1.id),
    taskA2: await seedTask(prisma, a.orgId, a2.id),
    taskB1: await seedTask(prisma, b.orgId, b1.id),
    labelA1: await seedLabel(prisma, a.orgId, a1.id),
    labelA2: await seedLabel(prisma, a.orgId, a2.id),
    milestoneA2: await seedMilestone(prisma, a.orgId, a2.id),
    teamA: await seedTeam(prisma, a.orgId),
    teamB: await seedTeam(prisma, b.orgId),
  };
}

describe("projects schema: cross-project and cross-organization links are refused (D-01, AIDA-71)", () => {
  it("refuses a subtask whose parent is in another project (Task_organizationId_projectId_parentId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("Task", taskCols(w.orgA, w.a1, 50, { parentId: w.taskA2.id })),
      "Task_organizationId_projectId_parentId_fkey",
    );
  });

  it("refuses a task milestone of another project (Task_organizationId_projectId_milestoneId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("Task", taskCols(w.orgA, w.a1, 50, { milestoneId: w.milestoneA2.id })),
      "Task_organizationId_projectId_milestoneId_fkey",
    );
  });

  it("refuses a TaskLabel whose label is in another project (TaskLabel_organizationId_projectId_labelId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("TaskLabel", {
        organizationId: w.orgA,
        projectId: w.a1.id,
        taskId: w.taskA1.id,
        labelId: w.labelA2.id,
      }),
      "TaskLabel_organizationId_projectId_labelId_fkey",
    );
  });

  it("refuses a TaskLabel whose task is in another project (TaskLabel_organizationId_projectId_taskId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("TaskLabel", {
        organizationId: w.orgA,
        projectId: w.a2.id,
        taskId: w.taskA1.id,
        labelId: w.labelA2.id,
      }),
      "TaskLabel_organizationId_projectId_taskId_fkey",
    );
  });

  it("refuses a ProjectMember of the other organization's project (ProjectMember_organizationId_projectId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("ProjectMember", { organizationId: w.orgA, projectId: w.b1.id, userId: w.ua }),
      "ProjectMember_organizationId_projectId_fkey",
    );
  });

  it("refuses a TeamMember of the other organization's team (TeamMember_organizationId_teamId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("TeamMember", { organizationId: w.orgA, teamId: w.teamB.id, userId: w.ua }),
      "TeamMember_organizationId_teamId_fkey",
    );
  });

  it("refuses a ProjectTeam of the other organization's project (ProjectTeam_organizationId_projectId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("ProjectTeam", { organizationId: w.orgA, projectId: w.b1.id, teamId: w.teamA.id }),
      "ProjectTeam_organizationId_projectId_fkey",
    );
  });

  it("refuses a ProjectTeam of the other organization's team (ProjectTeam_organizationId_teamId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("ProjectTeam", { organizationId: w.orgA, projectId: w.a1.id, teamId: w.teamB.id }),
      "ProjectTeam_organizationId_teamId_fkey",
    );
  });

  it("refuses a ProjectFavorite of the other organization's project (ProjectFavorite_organizationId_projectId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("ProjectFavorite", { organizationId: w.orgA, projectId: w.b1.id, userId: w.ua }),
      "ProjectFavorite_organizationId_projectId_fkey",
    );
  });

  it("refuses a ProjectLabel of the other organization's project (ProjectLabel_organizationId_projectId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("ProjectLabel", { organizationId: w.orgA, projectId: w.b1.id, name: "x" }),
      "ProjectLabel_organizationId_projectId_fkey",
    );
  });

  it("refuses a ProjectMilestone of the other organization's project (ProjectMilestone_organizationId_projectId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      prisma.$executeRaw`
        INSERT INTO "ProjectMilestone" ("id", "organizationId", "projectId", "name", "date", "updatedAt")
        VALUES (${randomUUID()}, ${w.orgA}, ${w.b1.id}, 'x', '2026-03-01'::date, now())`,
      "ProjectMilestone_organizationId_projectId_fkey",
    );
  });

  it("refuses a ProjectTaskCounter of the other organization's project (ProjectTaskCounter_organizationId_projectId_fkey)", async () => {
    const w = await linkWorld();
    // b1 already has its counter (primary key projectId), so a fresh B project without one is used.
    const lone = randomUUID();
    await insertRow("Project", {
      id: lone,
      organizationId: w.orgB,
      name: "Lone",
      keyPrefix: "LONE",
    });
    await refused(
      insertRow("ProjectTaskCounter", { organizationId: w.orgA, projectId: lone }),
      "ProjectTaskCounter_organizationId_projectId_fkey",
    );
  });

  it("refuses a TaskComment on the other organization's task (TaskComment_organizationId_taskId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("TaskComment", { organizationId: w.orgA, taskId: w.taskB1.id, bodyMarkdown: "x" }),
      "TaskComment_organizationId_taskId_fkey",
    );
  });

  it("refuses a TaskAttachment on the other organization's task (TaskAttachment_organizationId_taskId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("TaskAttachment", {
        organizationId: w.orgA,
        taskId: w.taskB1.id,
        storageKey: "abc123.png",
        originalFilename: "a.png",
        mimeType: "image/png",
        sizeBytes: 10,
      }),
      "TaskAttachment_organizationId_taskId_fkey",
    );
  });

  it("refuses a TaskFavorite on the other organization's task (TaskFavorite_organizationId_taskId_fkey)", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("TaskFavorite", { organizationId: w.orgA, taskId: w.taskB1.id, userId: w.ua }),
      "TaskFavorite_organizationId_taskId_fkey",
    );
  });
});

describe("projects schema: one subtask level (D-03, K61)", () => {
  it("refuses a task that is its own parent (Task_no_self_parent_check)", async () => {
    const w = await linkWorld();
    await refused(
      prisma.$executeRaw`UPDATE "Task" SET "parentId" = "id" WHERE "id" = ${w.taskA1.id}`,
      "Task_no_self_parent_check",
    );
  });

  it("refuses a subtask of a subtask with 'Task subtask depth exceeded'", async () => {
    const w = await linkWorld();
    const sub = await seedTask(prisma, w.orgA, w.a1.id, { parentId: w.taskA1.id });
    await refused(
      insertRow("Task", taskCols(w.orgA, w.a1, 50, { parentId: sub.id })),
      "Task subtask depth exceeded",
    );
  });

  it("refuses a parent becoming a subtask with 'Task with subtasks cannot become a subtask'", async () => {
    const w = await linkWorld();
    await seedTask(prisma, w.orgA, w.a1.id, { parentId: w.taskA1.id });
    const other = await seedTask(prisma, w.orgA, w.a1.id);
    await refused(
      prisma.$executeRaw`UPDATE "Task" SET "parentId" = ${other.id} WHERE "id" = ${w.taskA1.id}`,
      "Task with subtasks cannot become a subtask",
    );
  });

  it("accepts a plain subtask of a top-level task", async () => {
    const w = await linkWorld();
    const sub = await seedTask(prisma, w.orgA, w.a1.id, { parentId: w.taskA1.id });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.parentId).toBe(w.taskA1.id);
  });
});

describe("projects schema: moving and deleting a task tree (C3, K67)", () => {
  async function tree() {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
    const userId = users[0]?.id as string;
    const src = await seedProject(prisma, orgId, { createdByUserId: userId });
    const dst = await seedProject(prisma, orgId, { createdByUserId: userId });
    const srcMilestone = await seedMilestone(prisma, orgId, src.id);
    const dstMilestone = await seedMilestone(prisma, orgId, dst.id);
    const parent = await seedTask(prisma, orgId, src.id, { milestoneId: srcMilestone.id });
    const sub = await seedTask(prisma, orgId, src.id, { parentId: parent.id });
    const comment = await seedComment(prisma, orgId, parent.id, { authorUserId: userId });
    const attachment = await seedAttachment(prisma, orgId, parent.id, { uploadedByUserId: userId });
    await insertRow("TaskFavorite", { organizationId: orgId, taskId: parent.id, userId });
    return { orgId, userId, src, dst, dstMilestone, parent, sub, comment, attachment };
  }

  const moveTree = (t: Awaited<ReturnType<typeof tree>>) => prisma.$executeRaw`
    UPDATE "Task" SET "projectId" = ${t.dst.id},
      "milestoneId" = CASE WHEN "id" = ${t.parent.id} THEN ${t.dstMilestone.id} ELSE NULL END
    WHERE "organizationId" = ${t.orgId} AND "id" IN (${t.parent.id}, ${t.sub.id})`;

  it("moves a parent and its subtasks in one UPDATE and keeps its comment, attachment and favorite", async () => {
    const t = await tree();
    expect(await moveTree(t)).toBe(2);
    const rows = await prisma.task.findMany({
      where: { id: { in: [t.parent.id, t.sub.id] } },
      select: { projectId: true, milestoneId: true, parentId: true },
      orderBy: { number: "asc" },
    });
    expect(rows).toEqual([
      { projectId: t.dst.id, milestoneId: t.dstMilestone.id, parentId: null },
      { projectId: t.dst.id, milestoneId: null, parentId: t.parent.id },
    ]);
    expect(await prisma.taskComment.count({ where: { taskId: t.parent.id } })).toBe(1);
    expect(await prisma.taskAttachment.count({ where: { taskId: t.parent.id } })).toBe(1);
    expect(await prisma.taskFavorite.count({ where: { taskId: t.parent.id } })).toBe(1);
  });

  it("refuses the same move while a TaskLabel row of the tree exists", async () => {
    const t = await tree();
    const label = await seedLabel(prisma, t.orgId, t.src.id);
    await insertRow("TaskLabel", {
      organizationId: t.orgId,
      projectId: t.src.id,
      taskId: t.sub.id,
      labelId: label.id,
    });
    await refused(moveTree(t), "TaskLabel_organizationId_projectId_taskId_fkey");
  });

  it("refuses moving the parent without its subtasks", async () => {
    const t = await tree();
    await refused(
      prisma.$executeRaw`UPDATE "Task" SET "projectId" = ${t.dst.id}, "milestoneId" = NULL WHERE "id" = ${t.parent.id}`,
      "Task_organizationId_projectId_parentId_fkey",
    );
  });

  it("refuses deleting a task that still has a comment (RESTRICT)", async () => {
    const t = await tree();
    await refused(
      prisma.$executeRaw`DELETE FROM "Task" WHERE "id" IN (${t.parent.id}, ${t.sub.id})`,
      "TaskComment_organizationId_taskId_fkey",
    );
  });

  it("deletes the tree in one statement after its leaves are removed", async () => {
    const t = await tree();
    await prisma.$executeRaw`DELETE FROM "TaskFavorite" WHERE "taskId" = ${t.parent.id}`;
    await prisma.$executeRaw`DELETE FROM "TaskComment" WHERE "taskId" = ${t.parent.id}`;
    await prisma.$executeRaw`DELETE FROM "TaskAttachment" WHERE "taskId" = ${t.parent.id}`;
    expect(
      await prisma.$executeRaw`DELETE FROM "Task" WHERE "id" IN (${t.parent.id}, ${t.sub.id})`,
    ).toBe(2);
  });
});

describe("projects schema: CHECKs (contract sections 6, 7 and 15)", () => {
  it("refuses a start date after the due date (Task_dates_check)", async () => {
    const w = await linkWorld();
    await refused(
      prisma.$executeRaw`
        INSERT INTO "Task" ("id", "organizationId", "projectId", "number", "key", "title", "startDate", "dueDate", "updatedAt")
        VALUES (${randomUUID()}, ${w.orgA}, ${w.a1.id}, 60, ${`${w.a1.keyPrefix}-60`}, 'T',
                '2026-03-02'::date, '2026-03-01'::date, now())`,
      "Task_dates_check",
    );
  });

  it("refuses a malformed prefix, key and number", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("Project", { organizationId: w.orgA, name: "X", keyPrefix: "1AB" }),
      "Project_key_prefix_check",
    );
    await refused(
      insertRow("ProjectKeyPrefix", { organizationId: w.orgA, prefix: "1AB", projectId: w.a1.id }),
      "ProjectKeyPrefix_prefix_check",
    );
    await refused(
      insertRow("Task", taskCols(w.orgA, w.a1, 61, { key: "ops-1" })),
      "Task_key_format_check",
    );
    await refused(
      insertRow("TaskKey", {
        organizationId: w.orgA,
        normalizedKey: "ops-1",
        taskId: w.taskA1.id,
        projectId: w.a1.id,
      }),
      "TaskKey_key_format_check",
    );
    await refused(
      insertRow("Task", { ...taskCols(w.orgA, w.a1, 0), key: `${w.a1.keyPrefix}-62` }),
      "Task_number_check",
    );
  });

  it("refuses an estimate of -1 and a title of 201 characters", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("Task", taskCols(w.orgA, w.a1, 63, { estimateMinutes: -1 })),
      "Task_estimate_check",
    );
    await refused(
      insertRow("Task", taskCols(w.orgA, w.a1, 64, { title: "a".repeat(201) })),
      "Task_title_length_check",
    );
  });

  it("accepts a title of 200 astral characters (code points, not UTF-16 units)", async () => {
    const w = await linkWorld();
    await insertRow("Task", taskCols(w.orgA, w.a1, 65, { title: "😀".repeat(200) }));
    const row = await prisma.task.findFirstOrThrow({
      where: { organizationId: w.orgA, projectId: w.a1.id, number: 65 },
    });
    expect([...row.title]).toHaveLength(200);
  });

  it("refuses a recurrence rule without anchor and a recurrence on a subtask", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("Task", taskCols(w.orgA, w.a1, 66, { recurrenceRule: "DAILY" })),
      "Task_recurrence_fields_check",
    );
    await refused(
      prisma.$executeRaw`
        INSERT INTO "Task" ("id", "organizationId", "projectId", "parentId", "number", "key", "title",
                            "recurrenceRule", "recurrenceAnchor", "recurrenceTimeZone", "updatedAt")
        VALUES (${randomUUID()}, ${w.orgA}, ${w.a1.id}, ${w.taskA1.id}, 67, ${`${w.a1.keyPrefix}-67`}, 'T',
                'DAILY'::"RecurrenceRule", '2026-03-01'::date, 'UTC', now())`,
      "Task_recurrence_top_level_check",
    );
  });

  it("refuses a storage key '../x.png', a counter of 1000000000 and a project color '#ff0000'", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("TaskAttachment", {
        organizationId: w.orgA,
        taskId: w.taskA1.id,
        storageKey: "../x.png",
        originalFilename: "x.png",
        mimeType: "image/png",
        sizeBytes: 10,
      }),
      "TaskAttachment_storage_key_check",
    );
    await refused(
      insertRow("ProjectFileCleanup", { organizationId: w.orgA, storageKey: "../x.png" }),
      "ProjectFileCleanup_storage_key_check",
    );
    await refused(
      prisma.$executeRaw`UPDATE "ProjectTaskCounter" SET "lastNumber" = 1000000000 WHERE "projectId" = ${w.a1.id}`,
      "ProjectTaskCounter_last_number_check",
    );
    await refused(
      insertRow("Project", {
        organizationId: w.orgA,
        name: "X",
        keyPrefix: "COLOR",
        color: "#ff0000",
      }),
      "Project_color_check",
    );
  });

  it("refuses an activity before value larger than 4096 bytes (ProjectActivity_before_size_check)", async () => {
    const w = await linkWorld();
    await refused(
      prisma.$executeRaw`
        INSERT INTO "ProjectActivity" ("id", "organizationId", "projectId", "actorUserId", "verb", "entityType", "entityId", "before", "batchId")
        VALUES (${randomUUID()}, ${w.orgA}, ${w.a1.id}, ${w.ua}, 'PROJECT_UPDATED'::"ProjectActivityVerb",
                'PROJECT'::"ProjectActivityEntity", ${w.a1.id}, ${JSON.stringify({ name: "x".repeat(4100) })}::jsonb, ${randomUUID()})`,
      "ProjectActivity_before_size_check",
    );
  });
});

describe("projects schema: uniqueness", () => {
  it("refuses a second label 'Bug' next to 'bug' in one project and allows it in another", async () => {
    const w = await linkWorld();
    await seedLabel(prisma, w.orgA, w.a1.id, { name: "bug" });
    await refused(
      insertRow("ProjectLabel", { organizationId: w.orgA, projectId: w.a1.id, name: "Bug" }),
      "ProjectLabel_project_lower_name_key",
    );
    await seedLabel(prisma, w.orgA, w.a2.id, { name: "Bug" });
  });

  it("refuses a second team 'Ops' next to 'ops' (Team_organizationId_lower_name_key)", async () => {
    const w = await linkWorld();
    await seedTeam(prisma, w.orgA, { name: "ops" });
    await refused(
      insertRow("Team", { organizationId: w.orgA, name: "Ops" }),
      "Team_organizationId_lower_name_key",
    );
  });

  it("refuses a second milestone with the same name in any case (ProjectMilestone_project_lower_name_key)", async () => {
    const w = await linkWorld();
    await seedMilestone(prisma, w.orgA, w.a1.id, { name: "Launch" });
    await refused(
      seedMilestone(prisma, w.orgA, w.a1.id, { name: "LAUNCH" }),
      "ProjectMilestone_project_lower_name_key",
    );
  });

  it("refuses a second successor of one predecessor (Task_recurrence_predecessor_key)", async () => {
    const w = await linkWorld();
    await insertRow("Task", taskCols(w.orgA, w.a1, 70, { recurrencePredecessorId: w.taskA1.id }));
    await refused(
      insertRow("Task", taskCols(w.orgA, w.a1, 71, { recurrencePredecessorId: w.taskA1.id })),
      "Task_recurrence_predecessor_key",
    );
  });

  it("refuses a second TaskKey and a second ProjectKeyPrefix with the same value", async () => {
    const w = await linkWorld();
    await refused(
      insertRow("TaskKey", {
        organizationId: w.orgA,
        normalizedKey: w.taskA1.key,
        taskId: w.taskA2.id,
        projectId: w.a2.id,
      }),
      "TaskKey_organizationId_normalizedKey_key",
    );
    await refused(
      insertRow("ProjectKeyPrefix", {
        organizationId: w.orgA,
        prefix: w.a1.keyPrefix,
        projectId: w.a2.id,
      }),
      "ProjectKeyPrefix_organizationId_prefix_key",
    );
  });
});

describe("projects schema: ProjectActivity (D-05)", () => {
  it("refuses UPDATE and DELETE with the append-only message", async () => {
    const w = await linkWorld();
    const row = await seedActivity(prisma, w.orgA, { projectId: w.a1.id });
    await refused(
      prisma.$executeRaw`UPDATE "ProjectActivity" SET "batchId" = 'x' WHERE "id" = ${row.id}`,
      "ProjectActivity is append-only: UPDATE is not permitted",
    );
    await refused(
      prisma.$executeRaw`DELETE FROM "ProjectActivity" WHERE "id" = ${row.id}`,
      "ProjectActivity is append-only: DELETE is not permitted",
    );
  });

  it("refuses a row with neither projectId nor teamId (ProjectActivity_scope_check)", async () => {
    const w = await linkWorld();
    await refused(seedActivity(prisma, w.orgA, { entityId: "x" }), "ProjectActivity_scope_check");
  });
});

describe("projects schema: calendar dates (D-10, C15)", () => {
  it("round-trips 2026-02-28 through Prisma and reads it as text through raw SQL", async () => {
    const w = await linkWorld();
    const instant = new Date("2026-02-28T00:00:00.000Z");
    await prisma.task.update({ where: { id: w.taskA1.id }, data: { dueDate: instant } });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: w.taskA1.id } });
    expect(row.dueDate?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    const raw = await prisma.$queryRaw<{ due: string }[]>`
      SELECT "dueDate"::text AS due FROM "Task" WHERE "id" = ${w.taskA1.id}`;
    expect(raw).toEqual([{ due: "2026-02-28" }]);
  });
});

/** A privacy world plus a project favorite, a task favorite, an activity row and a cleanup row. */
async function fullWorld() {
  const w = await seedPrivacyWorld(prisma);
  await insertRow("ProjectFavorite", {
    organizationId: w.orgA,
    projectId: w.project.id,
    userId: w.users.member,
  });
  await insertRow("TaskFavorite", {
    organizationId: w.orgA,
    taskId: w.task.id,
    userId: w.users.member,
  });
  await seedActivity(prisma, w.orgA, { projectId: w.project.id, actorUserId: w.users.manager });
  await seedFileCleanup(prisma, w.orgA, `${randomUUID().replace(/-/g, "")}.png`);
  return w;
}

type ScopedDelegate = {
  findMany(args?: unknown): Promise<unknown[]>;
  count(args?: unknown): Promise<number>;
  updateMany(args: unknown): Promise<{ count: number }>;
  deleteMany(args?: unknown): Promise<{ count: number }>;
};

describe("projects schema: scopedDb isolation (D-01, AIDA-64, AIDA-69, AIDA-105)", () => {
  it("scopedDb of another organization never sees or changes organization A's rows in the 18 models", async () => {
    const w = await fullWorld();
    const empty = await seedOrgWithMembers(prisma, ["owner"]);
    const before = await projectTableSnapshot(prisma, w.orgA);
    for (const model of PHASE_14_TABLES) {
      expect(before[model].length, `${model} has rows in A`).toBeGreaterThan(0);
    }
    const db = scopedDb(empty.orgId) as unknown as Record<string, ScopedDelegate>;
    for (const model of PHASE_14_TABLES) {
      const delegate = db[model.charAt(0).toLowerCase() + model.slice(1)] as ScopedDelegate;
      expect(await delegate.findMany(), model).toEqual([]);
      expect(await delegate.count(), model).toBe(0);
      const data = model === "ProjectTaskCounter" ? { lastNumber: 5 } : { createdAt: new Date(0) };
      expect(await delegate.updateMany({ where: {}, data }), model).toEqual({ count: 0 });
      if (model !== "ProjectActivity") {
        expect(await delegate.deleteMany({ where: {} }), model).toEqual({ count: 0 });
      }
    }
    expect(await projectTableSnapshot(prisma, w.orgA)).toEqual(before);
  });
});

describe("projects schema: projectTableSnapshot (review C4)", () => {
  it("returns the 18 tables ordered by primary key, repeats deep-equal and detects a change", async () => {
    const w = await fullWorld();
    const snap = await projectTableSnapshot(prisma, w.orgA);
    expect(Object.keys(snap).sort()).toEqual([...PHASE_14_TABLES].sort());
    expect(snap.ProjectTaskCounter.length).toBeGreaterThan(0);
    expect(snap.TaskLabel.length).toBeGreaterThan(0);
    expect(snap.ProjectActivity.length).toBeGreaterThan(0);
    const counters = snap.ProjectTaskCounter as { projectId: string }[];
    expect(counters.map((r) => r.projectId)).toEqual(counters.map((r) => r.projectId).sort());
    const labels = snap.TaskLabel as { taskId: string; labelId: string }[];
    const pairs = labels.map((r) => `${r.taskId} ${r.labelId}`);
    expect(pairs).toEqual([...pairs].sort());
    expect(await projectTableSnapshot(prisma, w.orgA)).toEqual(snap);
    for (const rows of Object.values(snap)) {
      for (const row of rows as { organizationId: string }[]) {
        expect(row.organizationId).toBe(w.orgA);
      }
    }
    await insertRow("TaskLabel", {
      organizationId: w.orgA,
      projectId: w.project.id,
      taskId: w.subtask.id,
      labelId: w.label.id,
    });
    expect(await projectTableSnapshot(prisma, w.orgA)).not.toEqual(snap);
  });
});

describe("projects schema: catalog", () => {
  it("has exactly the 16 composite foreign keys, all RESTRICT on update and delete (confupdtype, confdeltype)", async () => {
    const rows = await prisma.$queryRaw<{ conname: string; upd: string; del: string }[]>`
      SELECT con.conname, con.confupdtype::text AS upd, con.confdeltype::text AS del
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      WHERE con.contype = 'f' AND array_length(con.conkey, 1) > 1
        AND c.relname = ANY(${[...PHASE_14_TABLES]})
      ORDER BY con.conname`;
    expect(rows.map((r) => r.conname).sort()).toEqual([...COMPOSITE_FKS].sort());
    for (const row of rows)
      expect([row.conname, row.upd, row.del]).toEqual([row.conname, "r", "r"]);
  });

  it("gives ProjectActivity, TaskKey, ProjectKeyPrefix and ProjectFileCleanup no foreign key but organization", async () => {
    const rows = await prisma.$queryRaw<{ relname: string; conname: string; target: string }[]>`
      SELECT c.relname, con.conname, t.relname AS target
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_class t ON t.oid = con.confrelid
      WHERE con.contype = 'f'
        AND c.relname IN ('ProjectActivity', 'TaskKey', 'ProjectKeyPrefix', 'ProjectFileCleanup')
      ORDER BY c.relname`;
    expect(rows).toEqual([
      {
        relname: "ProjectActivity",
        conname: "ProjectActivity_organizationId_fkey",
        target: "organization",
      },
      {
        relname: "ProjectFileCleanup",
        conname: "ProjectFileCleanup_organizationId_fkey",
        target: "organization",
      },
      {
        relname: "ProjectKeyPrefix",
        conname: "ProjectKeyPrefix_organizationId_fkey",
        target: "organization",
      },
      { relname: "TaskKey", conname: "TaskKey_organizationId_fkey", target: "organization" },
    ]);
  });

  it("has the two Phase 14 triggers enabled and the recurrence partial index", async () => {
    const triggers = await prisma.$queryRaw<
      { tgname: string; relname: string; tgenabled: string }[]
    >`
      SELECT t.tgname, c.relname, t.tgenabled::text AS tgenabled
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname IN ('aida_task_subtask_depth', 'aida_project_activity_no_update_delete')
      ORDER BY t.tgname`;
    expect(triggers).toEqual([
      {
        tgname: "aida_project_activity_no_update_delete",
        relname: "ProjectActivity",
        tgenabled: "O",
      },
      { tgname: "aida_task_subtask_depth", relname: "Task", tgenabled: "O" },
    ]);
    const idx = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'Task_recurrence_predecessor_key'`;
    expect(idx[0]?.indexdef).toContain("WHERE");
  });

  it("keeps every earlier hand-written trigger, including aida_kb_proposal_status_fence", async () => {
    const rows = await prisma.$queryRaw<{ tgname: string; tgenabled: string }[]>`
      SELECT t.tgname, t.tgenabled::text AS tgenabled FROM pg_trigger t
      WHERE t.tgname IN ('aida_audit_event_no_update_delete', 'aida_ticket_audit_event_no_update_delete',
                         'aida_organization_ticket_states', 'aida_ticket_state_group_fixed',
                         'aida_kb_proposal_status_fence')
      ORDER BY t.tgname`;
    expect(rows).toEqual([
      { tgname: "aida_audit_event_no_update_delete", tgenabled: "O" },
      { tgname: "aida_kb_proposal_status_fence", tgenabled: "O" },
      { tgname: "aida_organization_ticket_states", tgenabled: "O" },
      { tgname: "aida_ticket_audit_event_no_update_delete", tgenabled: "O" },
      { tgname: "aida_ticket_state_group_fixed", tgenabled: "O" },
    ]);
  });

  it("keeps the generated searchVector columns and their GIN indexes unchanged", async () => {
    const columns = await prisma.$queryRaw<
      { relname: string; attgenerated: string; expr: string }[]
    >`
      SELECT c.relname, a.attgenerated::text AS attgenerated, pg_get_expr(d.adbin, d.adrelid) AS expr
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attname = 'searchVector' AND c.relname IN ('Ticket', 'Message') AND NOT a.attisdropped
      ORDER BY c.relname`;
    expect(columns).toEqual([
      { relname: "Message", attgenerated: "s", expr: MESSAGE_SEARCH_EXPR },
      { relname: "Ticket", attgenerated: "s", expr: TICKET_SEARCH_EXPR },
    ]);
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('Ticket_searchVector_idx', 'Message_searchVector_idx')
      ORDER BY indexname`;
    expect(indexes).toEqual([
      { indexname: "Message_searchVector_idx", indexdef: MESSAGE_SEARCH_INDEXDEF },
      { indexname: "Ticket_searchVector_idx", indexdef: TICKET_SEARCH_INDEXDEF },
    ]);
  });

  it("keeps the earlier hand-written indexes and CHECKs, Phase 12.1 and 12.2 included", async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('SavedView_private_name_key', 'SavedView_shared_name_key',
                          'TicketRelation_pair_key', 'TicketRelation_one_parent_key',
                          'TicketState_active_name_key', 'TicketState_legacy_status_key')
      ORDER BY indexname`;
    expect(indexes.map((r) => r.indexname)).toEqual([
      "SavedView_private_name_key",
      "SavedView_shared_name_key",
      "TicketRelation_one_parent_key",
      "TicketRelation_pair_key",
      "TicketState_active_name_key",
      "TicketState_legacy_status_key",
    ]);
    const checks = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND conname IN ('SavedView_name_length_check', 'TicketAuditEvent_actor_check',
                                          'TicketRelation_no_self_check', 'Ticket_merge_fields_check',
                                          'Ticket_sla_paused_ms_check', 'KbProposal_version_check',
                                          'KbProposal_status_fields_check', 'KbProposalSource_position_check')
      ORDER BY conname`;
    expect(checks.map((r) => r.conname)).toEqual([
      "KbProposalSource_position_check",
      "KbProposal_status_fields_check",
      "KbProposal_version_check",
      "SavedView_name_length_check",
      "TicketAuditEvent_actor_check",
      "TicketRelation_no_self_check",
      "Ticket_merge_fields_check",
      "Ticket_sla_paused_ms_check",
    ]);
    const fk = await prisma.$queryRaw<{ upd: string; del: string }[]>`
      SELECT confupdtype::text AS upd, confdeltype::text AS del
      FROM pg_constraint WHERE conname = 'Ticket_organizationId_stateId_fkey'`;
    expect(fk).toEqual([{ upd: "r", del: "r" }]);
  });
});
