import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";

// Helper to seed a test organization. Better Auth's organization model has no @default()
// on `id` or `createdAt` — BA manages them internally, so we provide them here for tests.
function makeOrgData(name: string, slug: string) {
  return { id: randomUUID(), name, slug, createdAt: new Date() };
}

describe("AIDA-11: workspace isolation", () => {
  it("scopedDb read isolation: orgA never sees orgB rows and vice-versa", async () => {
    // Seed two organizations
    const orgA = await prisma.organization.create({ data: makeOrgData("Org Isolation A", "ws-isolation-read-a") });
    const orgB = await prisma.organization.create({ data: makeOrgData("Org Isolation B", "ws-isolation-read-b") });

    // Seed a Setting in each org via the bare client (explicit organizationId)
    await prisma.setting.create({
      data: { key: "isolation-key", value: "value-a", organizationId: orgA.id },
    });
    await prisma.setting.create({
      data: { key: "isolation-key", value: "value-b", organizationId: orgB.id },
    });

    const dbA = scopedDb(orgA.id);
    const dbB = scopedDb(orgB.id);

    const aResults = await dbA.setting.findMany();
    const bResults = await dbB.setting.findMany();

    // orgA's scoped client returns only orgA rows
    expect(aResults.length).toBeGreaterThan(0);
    expect(aResults.every((r) => r.organizationId === orgA.id)).toBe(true);

    // orgB's scoped client returns only orgB rows
    expect(bResults.length).toBeGreaterThan(0);
    expect(bResults.every((r) => r.organizationId === orgB.id)).toBe(true);

    // Cross-tenant exclusion — orgA results never contain orgB data and vice-versa
    expect(aResults.some((r) => r.organizationId === orgB.id)).toBe(false);
    expect(bResults.some((r) => r.organizationId === orgA.id)).toBe(false);
  });

  it("scopedDb create auto-injects organizationId without explicit field", async () => {
    const org = await prisma.organization.create({ data: makeOrgData("Org Auto Inject", "ws-isolation-auto-inject") });

    const db = scopedDb(org.id);

    // Setting.organizationId is required by the Prisma schema, but scopedDb's create
    // extension injects it at runtime. This test verifies that injection behavior —
    // organizationId is intentionally omitted so the extension must add it.
    // biome-ignore lint/suspicious/noExplicitAny: intentional omission to test auto-injection
    const setting = await (db.setting.create as (a: { data: Record<string, unknown> }) => Promise<{ organizationId: string }>)({
      data: { key: "auto-injected", value: "yes" },
    });

    expect(setting.organizationId).toBe(org.id);
  });
});
