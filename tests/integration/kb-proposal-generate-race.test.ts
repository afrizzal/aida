// Phase 12.2, plan 12.2-07: concurrent and superseded generation jobs for one KB proposal (D-13;
// reviews C5 and R2-3), on a real Postgres through Testcontainers. Only the OpenAI ADAPTER is a
// controllable fake (complete()'s real redaction and dispatch run) and the app-side pg-boss
// client is a recording double, so the epoch-2 payload is the one Restart generation really sent.
//
// The claim race records each job's backend PID itself, inside the job's own claim transaction,
// through setGenerateProposalObserverForTests (afterClaim for the holder, beforeClaim for the
// waiter), and waits for exactly that waiter PID to be blocked by the holder PID
// (waitForBlockedBy on a separate observer client). Held provider calls wait on deferreds the test
// controls. The arrival-order cases are sequential: each call is awaited before the next, so their
// order is fixed by the test, not by timing. The stuck threshold uses an injected clock. No timed
// waits. Every promise settles and none rejects with a deadlock (40P01).
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  calls: 0,
  /** One-shot responders, used in order before `respond`. */
  queue: [] as (() => Promise<unknown>)[],
  respond: null as null | (() => Promise<unknown>),
}));

vi.mock("@/lib/llm/providers/openai", () => ({
  completeOpenAi: vi.fn(async () => {
    fake.calls += 1;
    const next = fake.queue.shift() ?? fake.respond;
    if (!next) throw new Error("fake adapter: no response configured");
    return next();
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

import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  type GenerateProposalResult,
  generateProposal,
  KbProposalRetryError,
  setGenerateProposalObserverForTests,
} from "@/lib/kb/generate-proposal";
import { KB_PROPOSAL_GENERATE_QUEUE, type ProposalJobPayload } from "@/lib/kb/proposal-contract";
import { requestProposal } from "@/lib/kb/proposal-request";
import { restartProposalGeneration } from "@/lib/kb/proposal-review";
import { saveLlmSettings } from "@/lib/llm/settings";
import { scopedDb } from "@/lib/scoped-db";
import { kbProposalGenerateHandler } from "@/lib/worker/jobs/kb-proposal-generate";
import {
  seedOrgWithMembers,
  seedPublicMessage,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";
import { backendPid, type Deferred, deferred, waitForBlockedBy } from "../support/lock-wait";

const MINUTE = 60_000;
const NOW = new Date("2026-11-09T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
const FIRST_ATTEMPT = { retryCount: 0, retryLimit: 2 } as const;

let observerPool: pg.Pool;
let observer: PrismaClient;

// The PIDs of the claim race, printed once at the end (the plan's SUMMARY lists them).
const racePids: { race: string; holder: number; waiter: number }[] = [];

// Every deferred a case holds a run on; afterEach releases them all so nothing stays open.
const held: Deferred<void>[] = [];
function hold(): Deferred<void> {
  const d = deferred<void>();
  held.push(d);
  return d;
}

beforeAll(() => {
  observerPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  observer = new PrismaClient({ adapter: new PrismaPg(observerPool) });
});

afterAll(async () => {
  console.info(`kb-proposal-generate-race PIDs: ${JSON.stringify(racePids)}`);
  await observer.$disconnect();
  await observerPool.end();
});

beforeEach(() => {
  fake.calls = 0;
  fake.queue = [];
  fake.respond = null;
  bossEnv.sends = [];
});

afterEach(() => {
  setGenerateProposalObserverForTests(null);
  for (const d of held.splice(0)) d.resolve();
});

/** Waits for every promise to settle and asserts that none ended in a deadlock (40P01). */
async function settleAll<T>(promises: Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  const results = await Promise.allSettled(promises);
  for (const result of results) {
    if (result.status === "rejected") {
      const err = result.reason as { code?: unknown; message?: unknown };
      expect(String(err?.code ?? "")).not.toContain("40P01");
      expect(String(err?.message ?? "")).not.toContain("40P01");
    }
  }
  return results;
}

/** The fulfilled values, failing the case when any promise rejected. */
function values<T>(results: PromiseSettledResult<T>[]): T[] {
  return results.map((r) => {
    if (r.status === "rejected") throw r.reason;
    return r.value;
  });
}

/** A valid one-source answer whose body carries `tag`. */
function answer(tag: string) {
  return {
    title: `Clearing a stuck print queue ${tag}`,
    bodyMarkdown: `## Steps\n\nRestart the spooler service (${tag}).`,
    citations: [{ source: "T1", section: "Steps" }],
  };
}

const respondOk = (tag: string) => async () => answer(tag);
const respond503 = async (): Promise<unknown> => {
  throw { status: 503 };
};

/** An organization with an owner, an OpenAI provider, AI on and one requested proposal. */
async function setupProposal() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin"]);
  await saveLlmSettings(scopedDb(orgId), orgId, {
    provider: "openai",
    model: "gpt-5.4-mini",
    apiKey: "sk-test-DUMMYKEY0000000000000000",
  });
  await prisma.setting.create({ data: { organizationId: orgId, key: "aiEnabled", value: "true" } });
  const ticket = await seedResolvedTicket(orgId);
  await seedPublicMessage(orgId, ticket.id, "Restarting the spooler fixed the queue.");
  const owner = { userId: users[0].id, orgId };
  const admin = { userId: users[1].id, orgId };
  const result = await requestProposal(owner, [ticket.id], { now: () => NOW });
  if (!result.ok) throw new Error(`request refused: ${result.code}`);
  const payload = lastPayload();
  expect(payload).toEqual({ proposalId: result.proposalId, epoch: 1 });
  return { orgId, admin, proposalId: result.proposalId, payload };
}

/** The last kb-proposal-generate payload the boss double recorded. */
function lastPayload(): ProposalJobPayload {
  const sends = bossEnv.sends.filter((s) => s.queue === KB_PROPOSAL_GENERATE_QUEUE);
  const last = sends.at(-1);
  if (!last) throw new Error("no kb-proposal-generate send recorded");
  return last.payload as ProposalJobPayload;
}

function readRow(id: string) {
  return prisma.kbProposal.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      version: true,
      generationEpoch: true,
      generationClaimedAt: true,
      generationQueuedAt: true,
      bodyMarkdown: true,
      failureCode: true,
    },
  });
}

function auditCount(proposalId: string) {
  return prisma.auditEvent.count({ where: { kbProposalId: proposalId } });
}

function run(
  proposalId: string,
  epoch: number,
  now: Date,
  attempt: { retryCount: number; retryLimit: number } = FIRST_ATTEMPT,
): Promise<GenerateProposalResult> {
  return generateProposal(proposalId, { epoch, attempt, now });
}

describe("two jobs claim one proposal at once (D-13)", () => {
  it("one claim and one provider call; the second claim waits behind the first and loses", async () => {
    const { proposalId } = await setupProposal();
    fake.respond = respondOk("A");

    const aHeld = hold();
    const aPidD = deferred<number>();
    const bPidD = deferred<number>();
    let beforeClaimCalls = 0;
    setGenerateProposalObserverForTests({
      beforeClaim: async (tx) => {
        beforeClaimCalls += 1;
        if (beforeClaimCalls === 2) bPidD.resolve(await backendPid(tx));
      },
      afterClaim: async (tx) => {
        aPidD.resolve(await backendPid(tx));
        await aHeld.promise;
      },
    });

    const jobA = run(proposalId, 1, NOW);
    const aPid = await aPidD.promise;

    // A's claim transaction is still open: another connection reads the pre-claim row.
    const seen = await observer.kbProposal.findUniqueOrThrow({
      where: { id: proposalId },
      select: { version: true, generationClaimedAt: true },
    });
    expect(seen).toEqual({ version: 0, generationClaimedAt: null });

    const jobB = run(proposalId, 1, NOW);
    const bPid = await bPidD.promise;
    await waitForBlockedBy(observer, aPid, [bPid]);
    racePids.push({ race: "two jobs, one claim", holder: aPid, waiter: bPid });
    aHeld.resolve();

    const [resultA, resultB] = values(await settleAll([jobA, jobB]));
    expect(resultA).toEqual({ outcome: "DRAFT" });
    expect(resultB).toEqual({ outcome: "SKIPPED", reason: "CLAIM_LOST" });
    expect(fake.calls).toBe(1);
    expect(await auditCount(proposalId)).toBe(1);
    const row = await readRow(proposalId);
    expect(row.status).toBe("DRAFT");
    expect(row.bodyMarkdown).toContain("(A)");
  });
});

describe("a job superseded by Restart generation (D-13, review R2-3)", () => {
  /**
   * Job A (epoch 1) claims at NOW and its provider call is held; Restart generation 10 minutes
   * later moves the epoch to 2; job B (the restart's payload) claims and stores DRAFT. Returns A's
   * pending result and a function that releases A's call.
   */
  async function supersede(aResponse: () => Promise<unknown>) {
    const setup = await setupProposal();
    const aEntered = deferred<void>();
    const aRelease = hold();
    fake.queue = [
      async () => {
        aEntered.resolve();
        await aRelease.promise;
        return aResponse();
      },
      respondOk("B"),
    ];

    const jobA = run(setup.proposalId, 1, NOW);
    await aEntered.promise;

    const claimed = await readRow(setup.proposalId);
    expect(claimed.generationClaimedAt).toEqual(NOW);
    const restart = await restartProposalGeneration(
      setup.admin,
      { proposalId: setup.proposalId, expectedVersion: claimed.version },
      { now: at(10) },
    );
    expect(restart).toEqual({ ok: true, queued: true });
    const restarted = await readRow(setup.proposalId);
    expect(restarted.generationEpoch).toBe(2);
    expect(restarted.generationClaimedAt).toBeNull();

    const payloadB = lastPayload();
    expect(payloadB).toEqual({ proposalId: setup.proposalId, epoch: 2 });
    await kbProposalGenerateHandler(
      { data: payloadB, retryCount: 0, retryLimit: 2 },
      { now: at(10) },
    );
    const afterB = await readRow(setup.proposalId);
    expect(afterB.status).toBe("DRAFT");
    expect(afterB.bodyMarkdown).toContain("(B)");

    return { ...setup, jobA, releaseA: () => aRelease.resolve(), afterB };
  }

  it("A finishes its call but cannot store; B's DRAFT stays and both calls are audited", async () => {
    const { proposalId, jobA, releaseA, afterB } = await supersede(respondOk("A"));

    releaseA();
    const [resultA] = values(await settleAll([jobA]));

    expect(resultA).toEqual({ outcome: "DISCARDED" });
    expect(await readRow(proposalId)).toEqual(afterB);
    expect(fake.calls).toBe(2);
    expect(await auditCount(proposalId)).toBe(2);
  });

  it("A's invalid answer cannot write FAILED over B's DRAFT", async () => {
    const { proposalId, jobA, releaseA, afterB } = await supersede(async () => ({
      ...answer("A"),
      title: "Printer queue fix [T1]",
    }));

    releaseA();
    const [resultA] = values(await settleAll([jobA]));

    expect(resultA).toEqual({ outcome: "DISCARDED" });
    const row = await readRow(proposalId);
    expect(row).toEqual(afterB);
    expect(row.failureCode).toBeNull();
    expect(await auditCount(proposalId)).toBe(2);
  });

  it("A's transient failure cannot release B's generation and asks for no retry", async () => {
    const { proposalId, jobA, releaseA, afterB } = await supersede(respond503);

    releaseA();
    const [resultA] = values(await settleAll([jobA]));

    expect(resultA).toEqual({ outcome: "DISCARDED" });
    expect(await readRow(proposalId)).toEqual(afterB);
    expect(await auditCount(proposalId)).toBe(1);
  });
});

describe("an old pg-boss retry after a restart, both arrival orders (review R2-3)", () => {
  /** The epoch-1 job releases its lease on a 503, then Restart generation moves the epoch to 2. */
  async function releasedThenRestarted() {
    const setup = await setupProposal();
    fake.respond = respond503;
    await expect(
      kbProposalGenerateHandler(
        { data: setup.payload, retryCount: 0, retryLimit: 2 },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(KbProposalRetryError);
    const released = await readRow(setup.proposalId);
    expect(released.generationClaimedAt).toBeNull();
    expect(released.generationQueuedAt).toEqual(NOW);

    const restart = await restartProposalGeneration(
      setup.admin,
      { proposalId: setup.proposalId, expectedVersion: released.version },
      { now: at(10) },
    );
    expect(restart).toEqual({ ok: true, queued: true });
    const payloadB = lastPayload();
    expect(payloadB).toEqual({ proposalId: setup.proposalId, epoch: 2 });
    return { ...setup, payloadB };
  }

  it("old retry first: the epoch-1 last attempt makes no call and no write; epoch 2 stores DRAFT", async () => {
    const { proposalId, payloadB } = await releasedThenRestarted();
    fake.respond = respond503;
    const callsBefore = fake.calls;
    const before = await readRow(proposalId);

    const stale = await run(proposalId, 1, at(11), { retryCount: 2, retryLimit: 2 });

    expect(stale).toEqual({ outcome: "SKIPPED", reason: "STALE_EPOCH" });
    expect(fake.calls).toBe(callsBefore);
    expect(await readRow(proposalId)).toEqual(before);

    fake.respond = respondOk("epoch 2");
    await kbProposalGenerateHandler(
      { data: payloadB, retryCount: 0, retryLimit: 2 },
      { now: at(12) },
    );
    const row = await readRow(proposalId);
    expect(row.status).toBe("DRAFT");
    expect(row.bodyMarkdown).toContain("(epoch 2)");
    expect(row.generationEpoch).toBe(2);
  });

  it("new job first: epoch 2 releases on a 503, the old last attempt is a no-op, the epoch-2 retry stores DRAFT", async () => {
    const { proposalId, payloadB } = await releasedThenRestarted();

    fake.respond = respond503;
    await expect(
      kbProposalGenerateHandler({ data: payloadB, retryCount: 0, retryLimit: 2 }, { now: at(11) }),
    ).rejects.toBeInstanceOf(KbProposalRetryError);
    const releasedB = await readRow(proposalId);
    expect(releasedB.status).toBe("GENERATING");
    expect(releasedB.generationEpoch).toBe(2);
    expect(releasedB.generationClaimedAt).toBeNull();
    expect(releasedB.generationQueuedAt).toEqual(at(11));

    const callsBefore = fake.calls;
    const stale = await run(proposalId, 1, at(12), { retryCount: 2, retryLimit: 2 });
    expect(stale).toEqual({ outcome: "SKIPPED", reason: "STALE_EPOCH" });
    expect(fake.calls).toBe(callsBefore);
    expect(await readRow(proposalId)).toEqual(releasedB);

    fake.respond = respondOk("epoch 2 retry");
    await kbProposalGenerateHandler(
      { data: payloadB, retryCount: 1, retryLimit: 2 },
      { now: at(13) },
    );
    const row = await readRow(proposalId);
    expect(row.status).toBe("DRAFT");
    expect(row.failureCode).toBeNull();
    expect(row.bodyMarkdown).toContain("(epoch 2 retry)");
  });
});

describe("lease expiry (D-13, injected clock)", () => {
  async function leftGenerating(claimedMinutesAgo: number) {
    const setup = await setupProposal();
    // A worker that claimed and died: the lease is set, nothing else happened.
    await prisma.kbProposal.update({
      where: { id: setup.proposalId },
      data: { generationClaimedAt: at(-claimedMinutesAgo), version: { increment: 1 } },
    });
    return setup;
  }

  it("a lease 11 minutes old is claimed and completed by a new job", async () => {
    const { proposalId, payload } = await leftGenerating(11);
    fake.respond = respondOk("recovered");

    await kbProposalGenerateHandler({ data: payload, retryCount: 0, retryLimit: 2 }, { now: NOW });

    expect(fake.calls).toBe(1);
    const row = await readRow(proposalId);
    expect(row.status).toBe("DRAFT");
    expect(row.bodyMarkdown).toContain("(recovered)");
    expect(row.generationClaimedAt).toEqual(NOW);
  });

  it("a lease 9 minutes old is left alone: no provider call and no write", async () => {
    const { proposalId } = await leftGenerating(9);
    fake.respond = respondOk("too early");
    const before = await readRow(proposalId);

    const result = await run(proposalId, 1, NOW);

    expect(result).toEqual({ outcome: "SKIPPED", reason: "LEASE_HELD" });
    expect(fake.calls).toBe(0);
    expect(await readRow(proposalId)).toEqual(before);
  });
});
