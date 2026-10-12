// Phase 14 schema proofs (D-01, D-03, D-05, D-09, D-10, K61, K67, AIDA-64 to AIDA-71, AIDA-101,
// AIDA-102, AIDA-105): the projects tables, their database-enforced tenancy, the subtask and
// append-only triggers, the CHECKs and the catalog. Unmocked, on the shared Testcontainers database.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

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
