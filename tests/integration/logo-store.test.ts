// Phase 9 plan 09-05 (AIDA-34, D-07, U-11): the logo store on a real Postgres through
// Testcontainers. UPLOADS_DIR is set to a fresh temporary uploads directory before the dynamic
// imports that read it (local-file-storage.ts reads it when the module loads).
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { testUploadsDir } from "../support/file-fence-fixtures";
import { pngBytes } from "../support/logo-images";
import { seedOrgWithMembers } from "../support/project-fixtures";

let dir = "";
let previousUploadsDir: string | undefined;
let store: typeof import("@/lib/branding/logo-store");

beforeAll(async () => {
  dir = await testUploadsDir("aida-logo-store-");
  previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  store = await import("@/lib/branding/logo-store");
});

afterAll(async () => {
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
  await rm(dir, { recursive: true, force: true });
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

async function logoRow(orgId: string): Promise<Record<string, unknown> | null> {
  const row = await prisma.setting.findFirst({
    where: { organizationId: orgId, key: "branding:logo" },
    select: { value: true },
  });
  return row ? (JSON.parse(row.value) as Record<string, unknown>) : null;
}

async function queueKeys(orgId: string): Promise<string[]> {
  const rows = await prisma.projectFileCleanup.findMany({
    where: { organizationId: orgId },
    select: { storageKey: true },
    orderBy: { storageKey: "asc" },
  });
  return rows.map((r) => r.storageKey);
}

describe("logo store tracer", () => {
  it("replace with no logo set stores the file under the organization and writes branding:logo", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const bytes = pngBytes(64, 32);

    const result = await store.replaceLogo({ orgId, bytes });

    expect(result).toEqual({ ok: true, replaced: false, version: expect.any(String) });
    if (!result.ok) throw new Error("unreachable");
    expect(result.version).toMatch(/^[0-9a-f]{12}$/);
    const setting = await logoRow(orgId);
    expect(setting).toEqual({
      storageKey: expect.stringMatching(/^[0-9a-f]{32}\.png$/),
      mimeType: "image/png",
      version: result.version,
    });
    const key = setting?.storageKey as string;
    expect(await fileExists(orgId, key)).toBe(true);
    expect(Buffer.compare(await readFile(path.join(dir, orgId, key)), bytes)).toBe(0);
    expect(await queueKeys(orgId)).toEqual([]);

    const served = await store.readCurrentLogo({ orgId, version: result.version });
    expect(served?.mimeType).toBe("image/png");
    expect(served && Buffer.compare(served.bytes, bytes)).toBe(0);
  });
});
