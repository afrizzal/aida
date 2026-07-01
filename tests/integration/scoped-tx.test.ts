import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";

// Helper to seed a test organization. Better Auth's organization model has no @default()
// on `id` or `createdAt` — BA manages them internally, so we provide them here for tests.
function makeOrgData(name: string, slug: string) {
  return { id: randomUUID(), name, slug, createdAt: new Date() };
}

describe("Wave-0 smoke test: scopedDb organizationId injection inside $transaction", () => {
  it("injects organizationId into a Setting created inside an interactive $transaction", async () => {
    const org = await prisma.organization.create({
      data: makeOrgData("Org Tx Smoke", "tx-smoke-setting"),
    });

    const db = scopedDb(org.id);

    // organizationId is intentionally omitted from `data` — this asserts the scopedDb
    // create hook fires even inside an interactive $transaction callback.
    const setting = await db.$transaction((tx) =>
      // biome-ignore lint/suspicious/noExplicitAny: intentional omission to test auto-injection inside $transaction
      (tx.setting.create as (a: { data: Record<string, unknown> }) => Promise<{ organizationId: string }>)({
        data: { key: "tx-smoke", value: "1" },
      }),
    );

    expect(setting.organizationId).toBe(org.id);
  });

  it("injects organizationId into a TicketCounter upserted inside the same interactive $transaction", async () => {
    const org = await prisma.organization.create({
      data: makeOrgData("Org Tx Smoke 2", "tx-smoke-counter"),
    });

    const db = scopedDb(org.id);

    const counter = await db.$transaction(async (tx) => {
      // Also proves a Setting create + a TicketCounter upsert can share one interactive
      // transaction (the exact shape create-ticket.ts will use in plan 03).
      await (
        tx.setting.create as (a: { data: Record<string, unknown> }) => Promise<{ organizationId: string }>
      )({
        data: { key: "tx-smoke-2", value: "1" },
      });

      // organizationId is the @id here, so `where: { organizationId }` is a valid unique
      // target — scopedDb re-injecting the same value into `where` is a harmless no-op.
      return tx.ticketCounter.upsert({
        where: { organizationId: org.id },
        create: { lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
    });

    expect(counter.organizationId).toBe(org.id);
  });
});
