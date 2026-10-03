// Phase 12.2, plan 12.2-05: concurrent review actions on one proposal (D-06, D-16; reviews C1,
// C5, R2-3 and R3-2), on a real Postgres through Testcontainers. The queue is a recording double
// and the embedding adapter is mocked (deterministic 768-length vectors, never a real provider).
//
// Every race records each run's backend PID itself: inside the review service's own transaction
// through setProposalReviewObserverForTests (onTransactionStart for the waiter; afterMembershipLock,
// afterProposalUpdate or afterArticleInsert for the holder), inside the embed job's swap
// transaction through setKbEmbedArticleObserverForTests (afterArticleLock), or inside the test's
// own demotion or delete transaction. It then waits for exactly that waiter PID to be blocked by
// the holder PID it must queue behind (waitForBlockedBy on a separate observer client). No timed
// waits. Every promise settles and none rejects with a deadlock (40P01).
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the embedding SDK boundary exactly as tests/integration/kb-embed.test.ts does.
vi.mock("@/lib/rag/providers/openai-embed", () => ({
  embedOpenAi: vi.fn(async ({ input }: { input: string[] }) =>
    input.map(() => Array(768).fill(0.01)),
  ),
}));

const queue = vi.hoisted(() => ({
  sends: [] as { name: string; data: unknown }[],
}));

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (name: string, data: unknown) => {
      queue.sends.push({ name, data });
      return "job-id";
    },
  }),
}));

import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  publishProposal,
  rejectProposal,
  restartProposalGeneration,
  retryProposalIndexing,
  saveProposalDraft,
  setProposalReviewObserverForTests,
} from "@/lib/kb/proposal-review";
import { saveEmbeddingSettings } from "@/lib/rag/settings";
import { scopedDb } from "@/lib/scoped-db";
import {
  kbEmbedArticleHandler,
  setKbEmbedArticleObserverForTests,
} from "@/lib/worker/jobs/kb-embed-article";
import {
  type SeedProposalOptions,
  seedOrgWithMembers,
  seedProposal,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";
import { backendPid, type Deferred, deferred, waitForBlockedBy } from "../support/lock-wait";

const MINUTE = 60_000;
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

// The observer client that watches the waits, and a separate client for the test's own
// demotion and delete transactions (review C1). Each has its own one-connection pool.
let observerPool: pg.Pool;
let observer: PrismaClient;
let otherPool: pg.Pool;
let other: PrismaClient;

// The PIDs of every race, printed once at the end (the plan's SUMMARY lists them).
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
  otherPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  other = new PrismaClient({ adapter: new PrismaPg(otherPool) });
});

afterAll(async () => {
  console.info(`kb-proposal-publish-race PIDs: ${JSON.stringify(racePids)}`);
  await observer.$disconnect();
  await observerPool.end();
  await other.$disconnect();
  await otherPool.end();
});

beforeEach(() => {
  queue.sends.length = 0;
});

afterEach(() => {
  setProposalReviewObserverForTests(null);
  setKbEmbedArticleObserverForTests(null);
  for (const d of held.splice(0)) d.resolve();
});

/** Waits until `waiter` is blocked by `holder` and records the pair. */
async function expectBlocked(race: string, holder: number, waiter: number): Promise<void> {
  await waitForBlockedBy(observer, holder, [waiter]);
  racePids.push({ race, holder, waiter });
}

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

async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
  return {
    orgId,
    owner: { userId: users[0].id, orgId },
    admin: { userId: users[1].id, orgId, memberId: users[1].memberId },
  };
}

async function seedOne(orgId: string, options: Omit<SeedProposalOptions, "ticketIds">) {
  const ticket = await seedResolvedTicket(orgId);
  const seeded = await seedProposal(orgId, { ...options, ticketIds: [ticket.id] });
  queue.sends.length = 0;
  return seeded;
}

async function proposalRow(id: string) {
  return prisma.kbProposal.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      version: true,
      title: true,
      bodyMarkdown: true,
      generationEpoch: true,
      publishedArticleId: true,
    },
  });
}

function sendsOn(name: string) {
  return queue.sends.filter((s) => s.name === name);
}

/**
 * Holds the first run that reaches `holdAt` (it records its PID there) and records the PID of the
 * first run that starts a transaction after that (the waiter). Counts the waiter's transaction
 * starts (a slug retry starts a second one).
 */
function holdFirstAt(holdAt: "afterMembershipLock" | "afterProposalUpdate" | "afterArticleInsert") {
  const holderPid = deferred<number>();
  const waiterPid = deferred<number>();
  const release = hold();
  let holding = false;
  const state = { waiterStarts: 0 };
  setProposalReviewObserverForTests({
    onTransactionStart: async (tx) => {
      if (!holding) return;
      state.waiterStarts += 1;
      if (state.waiterStarts === 1) waiterPid.resolve(await backendPid(tx));
    },
    [holdAt]: async (tx: Parameters<typeof backendPid>[0]) => {
      if (holding) return;
      holding = true;
      holderPid.resolve(await backendPid(tx));
      await release.promise;
    },
  });
  return { holderPid: holderPid.promise, waiterPid: waiterPid.promise, release, state };
}

describe("publish races (D-06, D-16)", () => {
  it("two publishes of one DRAFT at one version: one article, the loser NOT_DRAFT, one embed send", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 3 });
    const race = holdFirstAt("afterProposalUpdate");

    const a = publishProposal(owner, { proposalId: p.id, expectedVersion: 3 });
    const aPid = await race.holderPid;
    const b = publishProposal(owner, { proposalId: p.id, expectedVersion: 3 });
    await expectBlocked("two publishes", aPid, await race.waiterPid);
    race.release.resolve();

    const [ra, rb] = values(await settleAll([a, b]));
    expect(ra).toMatchObject({ ok: true, indexingQueued: true });
    expect(rb).toEqual({ ok: false, code: "NOT_DRAFT" });
    if (!ra.ok) throw new Error("unreachable");
    const articles = await prisma.kbArticle.findMany({ where: { organizationId: orgId } });
    expect(articles.map((x) => x.id)).toEqual([ra.articleId]);
    expect(await proposalRow(p.id)).toMatchObject({
      status: "PUBLISHED",
      version: 4,
      publishedArticleId: ra.articleId,
    });
    expect(sendsOn("kb-embed-article").map((s) => s.data)).toStrictEqual([
      { articleId: ra.articleId },
    ]);
  });

  it("publish first, reject second: the reject waits, then NOT_DRAFT; PUBLISHED with one article", async () => {
    const { orgId, owner, admin } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 1 });
    const race = holdFirstAt("afterProposalUpdate");

    const publish = publishProposal(owner, { proposalId: p.id, expectedVersion: 1 });
    const publishPid = await race.holderPid;
    const reject = rejectProposal(admin, { proposalId: p.id, expectedVersion: 1 });
    await expectBlocked("publish then reject", publishPid, await race.waiterPid);
    race.release.resolve();

    const [rp, rr] = values(await settleAll<{ ok: boolean }>([publish, reject]));
    expect(rp).toMatchObject({ ok: true });
    expect(rr).toEqual({ ok: false, code: "NOT_DRAFT" });
    expect((await proposalRow(p.id)).status).toBe("PUBLISHED");
    expect(await prisma.kbArticle.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("reject first, publish second: the publish waits, then NOT_DRAFT; REJECTED and no article", async () => {
    const { orgId, owner, admin } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 1 });
    const race = holdFirstAt("afterProposalUpdate");

    const reject = rejectProposal(admin, { proposalId: p.id, expectedVersion: 1 });
    const rejectPid = await race.holderPid;
    const publish = publishProposal(owner, { proposalId: p.id, expectedVersion: 1 });
    await expectBlocked("reject then publish", rejectPid, await race.waiterPid);
    race.release.resolve();

    const [rr, rp] = values(await settleAll<{ ok: boolean }>([reject, publish]));
    expect(rr).toEqual({ ok: true });
    expect(rp).toEqual({ ok: false, code: "NOT_DRAFT" });
    expect(await proposalRow(p.id)).toMatchObject({ status: "REJECTED", version: 2 });
    expect(await prisma.kbArticle.count({ where: { organizationId: orgId } })).toBe(0);
    expect(sendsOn("kb-embed-article")).toEqual([]);
  });

  it("two saves at one version: the second waits, then CONFLICT; the first save's body and version", async () => {
    const { orgId, owner, admin } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 2 });
    const race = holdFirstAt("afterProposalUpdate");

    const a = saveProposalDraft(owner, {
      proposalId: p.id,
      expectedVersion: 2,
      title: "First title",
      bodyMarkdown: "First body.",
    });
    const aPid = await race.holderPid;
    const b = saveProposalDraft(admin, {
      proposalId: p.id,
      expectedVersion: 2,
      title: "Second title",
      bodyMarkdown: "Second body.",
    });
    await expectBlocked("two saves", aPid, await race.waiterPid);
    race.release.resolve();

    const [ra, rb] = values(await settleAll<{ ok: boolean }>([a, b]));
    expect(ra).toEqual({ ok: true, version: 3 });
    expect(rb).toEqual({ ok: false, code: "CONFLICT" });
    expect(await proposalRow(p.id)).toMatchObject({
      status: "DRAFT",
      version: 3,
      title: "First title",
      bodyMarkdown: "First body.",
    });
  });

  it("slug collision: two proposals with one title both publish with distinct slugs after one retry", async () => {
    const { orgId, owner } = await seedOrg();
    const title = "Printer offline after update";
    const pa = await seedOne(orgId, { status: "DRAFT", version: 0, title });
    const pb = await seedOne(orgId, { status: "DRAFT", version: 0, title });
    const race = holdFirstAt("afterArticleInsert");

    const a = publishProposal(owner, { proposalId: pa.id, expectedVersion: 0 });
    const aPid = await race.holderPid;
    const b = publishProposal(owner, { proposalId: pb.id, expectedVersion: 0 });
    // B's insert of the same slug waits on A's uncommitted entry in the unique index.
    await expectBlocked("slug collision", aPid, await race.waiterPid);
    race.release.resolve();

    const [ra, rb] = values(await settleAll([a, b]));
    expect(ra).toMatchObject({ ok: true, indexingQueued: true });
    expect(rb).toMatchObject({ ok: true, indexingQueued: true });
    if (!ra.ok || !rb.ok) throw new Error("unreachable");
    const slugs = await prisma.kbArticle.findMany({
      where: { organizationId: orgId },
      select: { id: true, slug: true },
      orderBy: { slug: "asc" },
    });
    expect(slugs).toEqual([
      { id: ra.articleId, slug: "printer-offline-after-update" },
      { id: rb.articleId, slug: "printer-offline-after-update-2" },
    ]);
    expect(race.state.waiterStarts).toBe(2); // B's transaction ran twice: one retry
    expect((await proposalRow(pa.id)).status).toBe("PUBLISHED");
    expect((await proposalRow(pb.id)).status).toBe("PUBLISHED");
  });
});

describe("publish against a demotion or a member delete (review C1)", () => {
  type MemberChange = "demote" | "delete";

  /** Runs the change on the test's own client, holding the transaction until `release`. */
  function changeMember(
    change: MemberChange,
    member: { memberId: string; orgId: string },
    opts: { pid: Deferred<number>; applied?: Deferred<void>; release?: Deferred<void> },
  ): Promise<void> {
    return other.$transaction(async (tx) => {
      opts.pid.resolve(await backendPid(tx));
      if (change === "demote") {
        await tx.$executeRaw`
          UPDATE "member" SET "role" = 'member'
          WHERE "id" = ${member.memberId} AND "organizationId" = ${member.orgId}
        `;
      } else {
        await tx.$executeRaw`
          DELETE FROM "member"
          WHERE "id" = ${member.memberId} AND "organizationId" = ${member.orgId}
        `;
      }
      opts.applied?.resolve();
      if (opts.release) await opts.release.promise;
    }, TX_OPTIONS);
  }

  async function memberRole(memberId: string): Promise<string | null> {
    const row = await prisma.member.findUnique({ where: { id: memberId }, select: { role: true } });
    return row?.role ?? null;
  }

  /** Publish holds after its member-row lock; the change waits behind it; publish wins. */
  async function publishFirst(change: MemberChange) {
    const { orgId, admin } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 1 });
    const race = holdFirstAt("afterMembershipLock");

    const publish = publishProposal(admin, { proposalId: p.id, expectedVersion: 1 });
    const publishPid = await race.holderPid;
    const changerPid = deferred<number>();
    const changing = changeMember(change, admin, { pid: changerPid });
    await expectBlocked(`publish then ${change}`, publishPid, await changerPid.promise);
    race.release.resolve();

    const [rp] = values(await settleAll<unknown>([publish, changing]));
    expect(rp).toMatchObject({ ok: true, indexingQueued: true });
    expect(await prisma.kbArticle.count({ where: { organizationId: orgId } })).toBe(1);
    expect((await proposalRow(p.id)).status).toBe("PUBLISHED");
    expect(await memberRole(admin.memberId)).toBe(change === "demote" ? "member" : null);
  }

  /** The change holds uncommitted first; publish waits behind it and is refused with `code`. */
  async function changeFirst(change: MemberChange, code: "NOT_ALLOWED" | "MEMBERSHIP_ENDED") {
    const { orgId, admin } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 2 });
    const changerPid = deferred<number>();
    const applied = deferred<void>();
    const releaseChange = hold();
    const changing = changeMember(change, admin, {
      pid: changerPid,
      applied,
      release: releaseChange,
    });
    await applied.promise;

    const publishPid = deferred<number>();
    setProposalReviewObserverForTests({
      onTransactionStart: async (tx) => publishPid.resolve(await backendPid(tx)),
    });
    const publish = publishProposal(admin, { proposalId: p.id, expectedVersion: 2 });
    await expectBlocked(
      `${change} then publish`,
      await changerPid.promise,
      await publishPid.promise,
    );
    releaseChange.resolve();

    const [, rp] = values(await settleAll<unknown>([changing, publish]));
    expect(rp).toEqual({ ok: false, code });
    expect(await prisma.kbArticle.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await proposalRow(p.id)).toMatchObject({
      status: "DRAFT",
      version: 2,
      publishedArticleId: null,
    });
    expect(sendsOn("kb-embed-article")).toEqual([]);
    expect(await memberRole(admin.memberId)).toBe(change === "demote" ? "member" : null);
  }

  it("publish first: a demotion (UPDATE member SET role = 'member') waits behind the publish; publish ok with one article, then the demotion commits", async () => {
    await publishFirst("demote");
  });

  it("publish first: a delete of the actor's member row waits behind the publish; publish ok with one article, then the delete commits", async () => {
    await publishFirst("delete");
  });

  it("a held demotion first: the publish waits behind it, then NOT_ALLOWED; no article, still DRAFT at its version", async () => {
    await changeFirst("demote", "NOT_ALLOWED");
  });

  it("a held member delete first: the publish waits behind it, then MEMBERSHIP_ENDED; no article, still DRAFT at its version", async () => {
    await changeFirst("delete", "MEMBERSHIP_ENDED");
  });
});

describe("restart race (reviews C5 and R2-3)", () => {
  it("two restarts at one version: one ok, one CONFLICT; version and epoch incremented once; one send with that epoch", async () => {
    const { orgId, owner, admin } = await seedOrg();
    const now = new Date("2026-11-09T14:00:00.000Z");
    const p = await seedOne(orgId, {
      status: "GENERATING",
      version: 4,
      generationEpoch: 3,
      generationClaimedAt: null,
      generationQueuedAt: new Date(now.getTime() - 15 * MINUTE),
    });
    const race = holdFirstAt("afterProposalUpdate");

    const a = restartProposalGeneration(owner, { proposalId: p.id, expectedVersion: 4 }, { now });
    const aPid = await race.holderPid;
    const b = restartProposalGeneration(admin, { proposalId: p.id, expectedVersion: 4 }, { now });
    await expectBlocked("two restarts", aPid, await race.waiterPid);
    race.release.resolve();

    const [ra, rb] = values(await settleAll([a, b]));
    expect(ra).toEqual({ ok: true, queued: true });
    expect(rb).toEqual({ ok: false, code: "CONFLICT" });
    expect(await proposalRow(p.id)).toMatchObject({
      status: "GENERATING",
      version: 5,
      generationEpoch: 4,
    });
    expect(sendsOn("kb-proposal-generate").map((s) => s.data)).toStrictEqual([
      { proposalId: p.id, epoch: 4 },
    ]);
  });
});

describe("retry indexing against a completing embed job (review R3-2)", () => {
  it("the retry's claim waits behind the job's article row lock; after COMPLETED commits it is NOT_RETRYABLE and sends nothing", async () => {
    const { orgId, owner } = await seedOrg();
    await saveEmbeddingSettings(scopedDb(orgId), orgId, {
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "sk-test-DUMMYEMBEDKEY0000000000",
    });
    const p = await seedOne(orgId, {
      status: "PUBLISHED",
      version: 1,
      bodyMarkdown: "## Steps\nRestart the agent.\n\n## Check\nOpen the status page.",
    });
    const articleId = p.publishedArticleId as string;
    expect(
      (await prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } })).embeddingStatus,
    ).toBe("PENDING");

    const jobPid = deferred<number>();
    const releaseJob = hold();
    setKbEmbedArticleObserverForTests({
      afterArticleLock: async (tx) => {
        jobPid.resolve(await backendPid(tx));
        await releaseJob.promise;
      },
    });
    const job = kbEmbedArticleHandler({ articleId });
    const holder = await jobPid.promise;

    const retryPid = deferred<number>();
    setProposalReviewObserverForTests({
      onTransactionStart: async (tx) => retryPid.resolve(await backendPid(tx)),
    });
    const retry = retryProposalIndexing(owner, { proposalId: p.id });
    await expectBlocked("embed job then retry claim", holder, await retryPid.promise);
    releaseJob.resolve();

    const [, rr] = values(await settleAll<unknown>([job, retry]));
    expect(rr).toEqual({ ok: false, code: "NOT_RETRYABLE" });
    expect(sendsOn("kb-embed-article")).toEqual([]);
    const article = await prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
    expect(article.embeddingStatus).toBe("COMPLETED");
    expect(article.embeddingModel).toBe("openai:text-embedding-3-small");
    const chunks = await prisma.kbChunk.findMany({
      where: { articleId },
      select: { position: true, embeddingModel: true },
      orderBy: { position: "asc" },
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.embeddingModel).toBe("openai:text-embedding-3-small");
  });
});
