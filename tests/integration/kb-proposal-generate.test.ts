// Phase 12.2, plan 12.2-07: the KB proposal generation job (AIDA-18; D-01, D-08 to D-14; reviews
// C5, C7, P1, R2-2, R2-3; run decisions K49 and K51), on a real Postgres through Testcontainers.
//
// Only the OpenAI ADAPTER is replaced (below complete(), above the SDK), by a controllable fake
// that captures the system and prompt it receives, so complete()'s real redaction and dispatch,
// the real prompt fencing and the real audit write all run. No real LLM or embedding API is
// called. The app-side pg-boss client is a recording double: the job payloads come from what the
// request (and Restart generation) really sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  calls: [] as { system: string; prompt: string; model: string }[],
  /** One-shot responders, used in order before `respond`. */
  queue: [] as ((params: { system: string; prompt: string; model: string }) => Promise<unknown>)[],
  respond: null as
    | null
    | ((params: { system: string; prompt: string; model: string }) => Promise<unknown>),
}));

vi.mock("@/lib/llm/providers/openai", () => ({
  completeOpenAi: vi.fn(async (params: { system: string; prompt: string; model: string }) => {
    fake.calls.push({ system: params.system, prompt: params.prompt, model: params.model });
    const next = fake.queue.shift() ?? fake.respond;
    if (!next) throw new Error("fake adapter: no response configured");
    return next(params);
  }),
}));

const bossEnv = vi.hoisted(() => ({
  sends: [] as { queue: string; payload: unknown }[],
}));

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (queue: string, payload: unknown) => {
      bossEnv.sends.push({ queue, payload });
      return "job-id";
    },
  }),
}));

import { prisma } from "@/lib/db";
import { setGenerateProposalObserverForTests } from "@/lib/kb/generate-proposal";
import { KB_PROPOSAL_GENERATE_QUEUE, type ProposalJobPayload } from "@/lib/kb/proposal-contract";
import { PROPOSAL_SYSTEM_PROMPT } from "@/lib/kb/proposal-prompt";
import { requestProposal } from "@/lib/kb/proposal-request";
import { saveLlmSettings } from "@/lib/llm/settings";
import { scopedDb } from "@/lib/scoped-db";
import { kbProposalGenerateHandler } from "@/lib/worker/jobs/kb-proposal-generate";
import {
  seedOrgWithMembers,
  seedPublicMessage,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";

const MODEL = "gpt-5.4-mini";
const NOW = new Date("2026-11-09T09:00:00.000Z");

beforeEach(() => {
  fake.calls = [];
  fake.queue = [];
  fake.respond = null;
  bossEnv.sends = [];
});

afterEach(() => {
  setGenerateProposalObserverForTests(null);
  vi.restoreAllMocks();
});

/** A valid model answer for two sources. */
function validOutput(tag = "") {
  return {
    title: `Clearing a stuck print queue${tag}`,
    bodyMarkdown: `## Cause\n\nThe spooler held a broken job.${tag}\n\n## Steps\n\nRestart the spooler service and resend the document.`,
    citations: [
      { source: "T1", section: "Cause" },
      { source: "T2", section: "Steps" },
      { source: "T2", section: "Cause" },
    ],
  };
}

/** An organization with an owner, an admin and a plain member, an OpenAI provider and AI on. */
async function seedOrg(options: { provider?: boolean; ai?: "true" | "false" } = {}) {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
  if (options.provider !== false) {
    await saveLlmSettings(scopedDb(orgId), orgId, {
      provider: "openai",
      model: MODEL,
      apiKey: "sk-test-DUMMYKEY0000000000000000",
    });
  }
  await prisma.setting.create({
    data: { organizationId: orgId, key: "aiEnabled", value: options.ai ?? "true" },
  });
  return {
    orgId,
    owner: { userId: users[0].id, orgId, memberId: users[0].memberId },
    admin: { userId: users[1].id, orgId, memberId: users[1].memberId },
  };
}

/** The ticket's actual largest PUBLIC seq, read straight from the table. */
async function largestPublicSeq(ticketId: string): Promise<bigint | null> {
  const agg = await prisma.message.aggregate({
    where: { ticketId, visibility: "PUBLIC" },
    _max: { seq: true },
  });
  return agg._max.seq;
}

/** Requests a proposal and returns its id and the payload the request really sent. */
async function request(
  actor: { userId: string; orgId: string },
  ticketIds: string[],
): Promise<{ proposalId: string; payload: ProposalJobPayload }> {
  const before = bossEnv.sends.length;
  const result = await requestProposal(actor, ticketIds, { now: () => NOW });
  if (!result.ok) throw new Error(`request refused: ${result.code}`);
  const sent = bossEnv.sends.slice(before).filter((s) => s.queue === KB_PROPOSAL_GENERATE_QUEUE);
  expect(sent).toHaveLength(1);
  return { proposalId: result.proposalId, payload: sent[0].payload as ProposalJobPayload };
}

async function readProposal(id: string) {
  return prisma.kbProposal.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      version: true,
      generationEpoch: true,
      generationClaimedAt: true,
      generationQueuedAt: true,
      title: true,
      bodyMarkdown: true,
      inputTruncated: true,
      generatedAt: true,
      failureCode: true,
      failedAt: true,
    },
  });
}

async function auditRows(proposalId: string) {
  return prisma.auditEvent.findMany({ where: { kbProposalId: proposalId } });
}

describe("generateProposal: tracer (D-10 to D-13)", () => {
  it("a requested proposal becomes a DRAFT through complete() with exactly one audit row", async () => {
    const { orgId, owner } = await seedOrg();
    const first = await seedResolvedTicket(orgId);
    const second = await seedResolvedTicket(orgId);
    await seedPublicMessage(orgId, first.id, "The printer queue stopped after the update.");
    await seedPublicMessage(orgId, second.id, "Restarting the spooler fixed it for us.");
    await seedPublicMessage(orgId, second.id, "Confirmed, all jobs printed again.");
    const subjects = await prisma.ticket.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { subject: true },
    });

    const { proposalId, payload } = await request(owner, [first.id, second.id]);
    expect(payload).toEqual({ proposalId, epoch: 1 });

    const output = validOutput();
    fake.respond = async () => output;
    await kbProposalGenerateHandler({ data: payload, retryCount: 0, retryLimit: 2 }, { now: NOW });

    const proposal = await readProposal(proposalId);
    expect(proposal.status).toBe("DRAFT");
    expect(proposal.title).toBe(output.title);
    expect(proposal.bodyMarkdown).toBe(output.bodyMarkdown);
    expect(proposal.inputTruncated).toBe(false);
    expect(proposal.generatedAt).toEqual(NOW);
    expect(proposal.failureCode).toBeNull();

    const sources = await prisma.kbProposalSource.findMany({
      where: { proposalId },
      orderBy: { position: "asc" },
      select: { ticketId: true, position: true, snapshotSeq: true, citedSections: true },
    });
    expect(sources.map((s) => s.ticketId)).toEqual([first.id, second.id]);
    expect(sources[0].snapshotSeq).toBe(await largestPublicSeq(first.id));
    expect(sources[1].snapshotSeq).toBe(await largestPublicSeq(second.id));
    expect(typeof sources[0].snapshotSeq).toBe("bigint");
    expect(sources[0].citedSections).toEqual(["Cause"]);
    expect(sources[1].citedSections).toEqual(["Steps", "Cause"]);

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.system).toBe(PROPOSAL_SYSTEM_PROMPT);
    for (const { subject } of subjects) {
      expect(call.system).not.toContain(subject);
      expect(call.prompt).toContain(subject);
    }
    expect(call.system).not.toContain("printer queue stopped");
    expect(call.prompt).toContain("printer queue stopped");

    const audits = await auditRows(proposalId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: orgId,
      actionType: "KB_PROPOSAL_GENERATED",
      ticketId: null,
      kbProposalId: proposalId,
      provider: "openai",
      model: MODEL,
      input: call.prompt,
      output: JSON.stringify(output),
    });
  });
});
