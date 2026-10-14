// Phase 14 project file cleanup (contract section 12, K66, C10, C12), on a real Postgres through
// Testcontainers. The worker handler and the sweep are called directly; pg-boss is not started.
// UPLOADS_DIR is set to a fresh temporary directory before the dynamic imports that read it
// (local-file-storage.ts reads it when the module loads).
//
// The sweep is the one cross-organization reader of ProjectFileCleanup, so this file owns the
// table: every case starts from an empty table.
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FileStorage } from "@/lib/attachments/file-storage";
import { prisma } from "@/lib/db";
import { enqueueFileCleanupInTx } from "@/lib/projects/file-cleanup";
import { seedOrgWithMembers } from "../support/project-fixtures";

let dir = "";
let previousUploadsDir: string | undefined;
let storage: FileStorage;
let handler: typeof import("@/lib/worker/jobs/project-file-cleanup").projectFileCleanupHandler;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aida-project-cleanup-"));
  previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  storage = (await import("@/lib/attachments/local-file-storage")).localFileStorage;
  handler = (await import("@/lib/worker/jobs/project-file-cleanup")).projectFileCleanupHandler;
});

afterAll(async () => {
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM "ProjectFileCleanup"`;
});

async function fileExists(orgId: string, key: string): Promise<boolean> {
  try {
    await stat(path.join(dir, orgId, key));
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return false;
    throw err;
  }
}

async function newOrg(): Promise<string> {
  return (await seedOrgWithMembers(prisma, ["owner"])).orgId;
}

let keySeq = 0;
function newKey(ext = "txt"): string {
  keySeq += 1;
  return `${Date.now().toString(16)}${keySeq.toString(16).padStart(6, "0")}.${ext}`;
}

describe("project file cleanup tracer", () => {
  it("a cleanup row written in a committed transaction is swept by the worker handler, deleting the file and the row", async () => {
    const orgA = await newOrg();
    const key = newKey("pdf");
    await storage.save({ orgId: orgA, key, data: Buffer.from("tracer file") });
    expect(await fileExists(orgA, key)).toBe(true);

    const inserted = await prisma.$transaction((tx) => enqueueFileCleanupInTx(tx, orgA, [key]));
    expect(inserted).toBe(1);

    const summary = await handler([]);
    expect(summary).toEqual({ deleted: 1, missing: 0, failed: 0 });
    expect(await fileExists(orgA, key)).toBe(false);
    expect(await prisma.projectFileCleanup.count({ where: { organizationId: orgA } })).toBe(0);
  });

  it("enqueueFileCleanupInTx called twice for the same key leaves one row", async () => {
    const orgA = await newOrg();
    const key = newKey();
    const first = await prisma.$transaction((tx) => enqueueFileCleanupInTx(tx, orgA, [key]));
    const second = await prisma.$transaction((tx) => enqueueFileCleanupInTx(tx, orgA, [key, key]));
    expect(first).toBe(1);
    expect(second).toBe(0);
    const rows = await prisma.projectFileCleanup.findMany({
      where: { organizationId: orgA },
      select: { storageKey: true, attempts: true },
    });
    expect(rows).toEqual([{ storageKey: key, attempts: 0 }]);
  });
});
