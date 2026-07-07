import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

describe("AuditEvent append-only", () => {
  it("allows INSERT but rejects UPDATE and DELETE at the DB level", async () => {
    const org = await prisma.organization.create({
      data: { id: randomUUID(), name: "Audit Org", slug: `audit-${randomUUID()}`, createdAt: new Date() },
    });
    const event = await prisma.auditEvent.create({
      data: {
        organizationId: org.id,
        actionType: "TRIAGE",
        provider: "openai",
        model: "gpt-5.4-mini",
        input: "redacted input",
        output: JSON.stringify({ category: "OTHER" }),
      },
    });

    expect(event.id).toBeTruthy();

    await expect(
      prisma.auditEvent.update({ where: { id: event.id }, data: { output: "tampered" } }),
    ).rejects.toThrow();
    await expect(
      prisma.auditEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow();
  });
});
