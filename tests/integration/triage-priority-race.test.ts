// Review IN-01 (Phase 11): AI triage must not overwrite a priority an agent chose while the LLM
// call ran, also when the choice re-applies the current priority. Since Phase 11 that choice is
// a no-op on the ticket row (D-08: one audit row, before equal to after, updatedAt unchanged), so
// the updatedAt token alone no longer sees it. Real Postgres through Testcontainers; only the
// provider adapter is replaced (no network, no real LLM).
import { describe, expect, it, vi } from "vitest";

/** Runs inside the fake provider call, i.e. while triage waits for the model. */
let duringModelCall: (() => Promise<void>) | null = null;
let modelPriority: "LOW" | "NORMAL" | "HIGH" | "URGENT" = "URGENT";

vi.mock("@/lib/llm/providers/openai", () => ({
  completeOpenAi: vi.fn(async () => {
    if (duringModelCall) await duringModelCall();
    return { category: "BILLING", priority: modelPriority, sentiment: "NEUTRAL", language: "en" };
  }),
}));

import { prisma } from "@/lib/db";
import { saveLlmSettings } from "@/lib/llm/settings";
import { scopedDb } from "@/lib/scoped-db";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { runTriage } from "@/lib/triage/run-triage";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

async function seedTriageCase() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  await saveLlmSettings(scopedDb(orgId), orgId, {
    provider: "openai",
    model: "gpt-5.4-mini",
    apiKey: "sk-test-DUMMYKEY0000000000000000",
  });
  const ticket = await seedTicket(orgId, { priority: "NORMAL" });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { triageStatus: "PENDING" } });
  return { orgId, actor: { userId: users[0].id, orgId }, ticketId: ticket.id };
}

function ticketTriage(id: string) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { priority: true, triageStatus: true, triageCategory: true },
  });
}

describe("runTriage respects an agent's priority chosen during the model call", () => {
  it("control: with no agent action the model's priority is applied", async () => {
    const { ticketId } = await seedTriageCase();
    duringModelCall = null;
    modelPriority = "URGENT";

    await runTriage(ticketId);

    expect(await ticketTriage(ticketId)).toEqual({
      priority: "URGENT",
      triageStatus: "COMPLETED",
      triageCategory: "BILLING",
    });
  });

  it("an agent who re-applies the current priority (a no-op write) keeps it", async () => {
    const { actor, ticketId } = await seedTriageCase();
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    modelPriority = "URGENT";
    duringModelCall = async () => {
      const result = await runTicketMutation({
        actor,
        ticketIds: [ticketId],
        op: { kind: "priority", priority: "NORMAL" },
        mode: "single",
      });
      expect(result).toEqual({ ok: true, count: 1, batchId: null });
      // D-08 holds: the no-op wrote nothing to the ticket row.
      const during = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(during.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    };

    try {
      await runTriage(ticketId);
    } finally {
      duringModelCall = null;
    }

    expect(await ticketTriage(ticketId)).toEqual({
      priority: "NORMAL",
      triageStatus: "COMPLETED",
      triageCategory: "BILLING",
    });
  });

  it("an agent who changes the priority keeps the new value", async () => {
    const { actor, ticketId } = await seedTriageCase();
    modelPriority = "URGENT";
    duringModelCall = async () => {
      await runTicketMutation({
        actor,
        ticketIds: [ticketId],
        op: { kind: "priority", priority: "LOW" },
        mode: "single",
      });
    };

    try {
      await runTriage(ticketId);
    } finally {
      duringModelCall = null;
    }

    expect(await ticketTriage(ticketId)).toEqual({
      priority: "LOW",
      triageStatus: "COMPLETED",
      triageCategory: "BILLING",
    });
  });
});
