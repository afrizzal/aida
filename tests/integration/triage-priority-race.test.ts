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
import { getSlaTargets } from "@/lib/tickets/sla";
import { runTriage } from "@/lib/triage/run-triage";
import {
  type LegacyStatusKey,
  seedOrgWithMembers,
  seedTicket,
  stateIdFor,
} from "../support/inbox-fixtures";

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

// Codex diff critique D1 (Phase 12.1, D-16): the deadlines triage writes count the closed pauses
// (slaPausedMs) exactly as a priority change does; an open pause is added when it closes.
describe("runTriage counts SLA pauses in the deadlines it writes", () => {
  const MIN = 60_000;
  const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

  async function moveTo(
    actor: { userId: string; orgId: string },
    ticketId: string,
    key: LegacyStatusKey,
    when: Date,
  ): Promise<void> {
    const stateId = await stateIdFor(actor.orgId, key);
    const result = await runTicketMutation(
      { actor, ticketIds: [ticketId], op: { kind: "state", stateId }, mode: "single" },
      { clock: () => when },
    );
    expect(result).toMatchObject({ ok: true, count: 1 });
  }

  function readSla(id: string) {
    return prisma.ticket.findUniqueOrThrow({
      where: { id },
      select: {
        createdAt: true,
        priority: true,
        slaPausedAt: true,
        slaPausedMs: true,
        firstResponseDueAt: true,
        resolutionDueAt: true,
      },
    });
  }

  it("after a closed pause the deadlines start at createdAt plus slaPausedMs", async () => {
    const { orgId, actor, ticketId } = await seedTriageCase();
    const { createdAt } = await readSla(ticketId);
    await moveTo(actor, ticketId, "PENDING", at(createdAt, 5 * MIN));
    await moveTo(actor, ticketId, "OPEN", at(createdAt, 65 * MIN));
    expect((await readSla(ticketId)).slaPausedMs).toBe(BigInt(60 * MIN));
    duringModelCall = null;
    modelPriority = "URGENT";

    await runTriage(ticketId);

    const targets = await getSlaTargets(scopedDb(orgId), "URGENT");
    const after = await readSla(ticketId);
    expect(after.priority).toBe("URGENT");
    expect(after.firstResponseDueAt.getTime()).toBe(
      createdAt.getTime() + 60 * MIN + targets.firstResponseMinutes * MIN,
    );
    expect(after.resolutionDueAt.getTime()).toBe(
      createdAt.getTime() + 60 * MIN + targets.resolutionMinutes * MIN,
    );
  });

  it("during an open pause the closed pauses count now and the open one when it closes", async () => {
    const { orgId, actor, ticketId } = await seedTriageCase();
    const { createdAt } = await readSla(ticketId);
    await moveTo(actor, ticketId, "PENDING", at(createdAt, 5 * MIN));
    await moveTo(actor, ticketId, "OPEN", at(createdAt, 25 * MIN));
    const pauseAt = at(createdAt, 40 * MIN);
    await moveTo(actor, ticketId, "PENDING", pauseAt);
    duringModelCall = null;
    modelPriority = "URGENT";

    await runTriage(ticketId);

    const targets = await getSlaTargets(scopedDb(orgId), "URGENT");
    const paused = await readSla(ticketId);
    expect(paused.priority).toBe("URGENT");
    expect(paused.slaPausedAt?.getTime()).toBe(pauseAt.getTime());
    expect(paused.slaPausedMs).toBe(BigInt(20 * MIN));
    expect(paused.firstResponseDueAt.getTime()).toBe(
      createdAt.getTime() + 20 * MIN + targets.firstResponseMinutes * MIN,
    );
    expect(paused.resolutionDueAt.getTime()).toBe(
      createdAt.getTime() + 20 * MIN + targets.resolutionMinutes * MIN,
    );

    await moveTo(actor, ticketId, "OPEN", at(pauseAt, 30 * MIN));
    const resumed = await readSla(ticketId);
    expect(resumed.slaPausedAt).toBeNull();
    expect(resumed.firstResponseDueAt.getTime()).toBe(
      createdAt.getTime() + 50 * MIN + targets.firstResponseMinutes * MIN,
    );
    expect(resumed.resolutionDueAt.getTime()).toBe(
      createdAt.getTime() + 50 * MIN + targets.resolutionMinutes * MIN,
    );
  });
});
