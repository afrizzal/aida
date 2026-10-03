// Phase 12.2, plan 12.2-05: the KB proposal review service (AIDA-18, D-01, D-06, D-11, D-13,
// D-15, D-16; reviews C1, C2, C5, C7, R2-2, R2-3, R3-2 and P8; run decisions K50 and K51), on a
// real Postgres through Testcontainers. Real organizations, members, tickets and proposals; only
// the app-side pg-boss client is replaced by a recording double (no job is really queued) and the
// embedding adapter is mocked (deterministic vectors, never a real provider). No LLM is called.
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the embedding SDK boundary exactly as tests/integration/kb-embed.test.ts does: the real
// embed dispatch runs, only the OpenAI adapter's network call is replaced. Deterministic
// 768-length vectors; no real provider and no real key.
vi.mock("@/lib/rag/providers/openai-embed", () => ({
  embedOpenAi: vi.fn(async ({ input }: { input: string[] }) =>
    input.map(() => Array(768).fill(0.01)),
  ),
}));

// The recording double. `observe` reads through a separate client inside send, so a send issued
// before the transaction committed would not see the article or the new proposal row.
const bossEnv = vi.hoisted(() => ({
  sends: [] as { queue: string; payload: unknown; seen: unknown }[],
  failSend: false,
  observe: null as null | ((queue: string, payload: unknown) => Promise<unknown>),
}));

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (queue: string, payload: unknown) => {
      const seen = bossEnv.observe ? await bossEnv.observe(queue, payload) : null;
      bossEnv.sends.push({ queue, payload, seen });
      if (bossEnv.failSend) throw new Error("boss send failed (test double)");
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
import {
  containsSourceMarker,
  containsTicketLink,
  isTicketPageUrl,
  renderedBodyLinksToTicket,
} from "@/lib/kb/proposal-schema";
import { renderMarkdown } from "@/lib/markdown/render";
import { findActiveMembership, shareLockActiveMembership } from "@/lib/membership";
import { saveEmbeddingSettings } from "@/lib/rag/settings";
import { scopedDb } from "@/lib/scoped-db";
import { kbEmbedArticleHandler } from "@/lib/worker/jobs/kb-embed-article";
import {
  type SeedProposalOptions,
  seedOrgWithMembers,
  seedProposal,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";
import { backendPid } from "../support/lock-wait";

let observerPool: pg.Pool;
let observer: PrismaClient;

beforeAll(() => {
  observerPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  observer = new PrismaClient({ adapter: new PrismaPg(observerPool) });
  bossEnv.observe = async (queue, payload) => {
    if (queue === "kb-embed-article") {
      const articleId = (payload as { articleId?: unknown }).articleId;
      if (typeof articleId !== "string") return null;
      const row = await observer.kbArticle.findUnique({
        where: { id: articleId },
        select: { embeddingStatus: true },
      });
      return row?.embeddingStatus ?? null;
    }
    const proposalId = (payload as { proposalId?: unknown }).proposalId;
    if (typeof proposalId !== "string") return null;
    const row = await observer.kbProposal.findUnique({
      where: { id: proposalId },
      select: { generationEpoch: true },
    });
    return row?.generationEpoch ?? null;
  };
});

afterAll(async () => {
  bossEnv.observe = null;
  await observer.$disconnect();
  await observerPool.end();
});

beforeEach(() => {
  bossEnv.sends = [];
  bossEnv.failSend = false;
});

afterEach(() => {
  setProposalReviewObserverForTests(null);
});

/** Sends recorded on one queue (ticket creation may enqueue other jobs). */
function sendsOn(queue: string) {
  return bossEnv.sends.filter((s) => s.queue === queue);
}

/** An organization with an owner, an admin and a plain member. */
async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
  return {
    orgId,
    owner: { userId: users[0].id, orgId },
    admin: { userId: users[1].id, orgId },
    member: { userId: users[2].id, orgId },
    users,
  };
}

/** Every href and src value of an HTML string. */
function urlAttributes(html: string): string[] {
  return [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
}

describe("publishProposal: tracer (D-06, D-15, review C1, K51)", () => {
  it("an owner publishes a draft: exactly one article, linked back, embedding enqueued after commit", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const title = "Reset a forgotten password";
    const bodyMarkdown =
      "## Steps\n\nOpen **Settings** and choose Reset. See [the guide](https://docs.example.com/guide).\n\n![diagram](/images/reset.png)";
    const citedLabel = `CITED-LABEL-${orgId.slice(0, 8)}`;
    const proposal = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [ticket.id],
      title,
      bodyMarkdown,
      version: 2,
      citedSections: [[citedLabel]],
    });
    bossEnv.sends = [];

    const result = await publishProposal(owner, { proposalId: proposal.id, expectedVersion: 2 });

    expect(result).toEqual({ ok: true, articleId: expect.any(String), indexingQueued: true });
    if (!result.ok) throw new Error("unreachable");

    const row = await prisma.kbProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.status).toBe("PUBLISHED");
    expect(row.publishedArticleId).toBe(result.articleId);
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.publishedByUserId).toBe(owner.userId);
    expect(row.version).toBe(3);

    const articles = await prisma.kbArticle.findMany({ where: { organizationId: orgId } });
    expect(articles).toHaveLength(1);
    const [article] = articles;
    expect(article.id).toBe(result.articleId);
    expect(article.title).toBe(title);
    expect(article.bodyMarkdown).toBe(bodyMarkdown);
    expect(article.embeddingStatus).toBe("PENDING");
    expect(article.bodyHtml).toBe(renderMarkdown(bodyMarkdown));
    expect(article.slug).toBe("reset-a-forgotten-password");

    // One send, after commit: the separate client already saw the article inside send.
    const embeds = sendsOn("kb-embed-article");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].payload).toEqual({ articleId: result.articleId });
    expect(embeds[0].seen).toBe("PENDING");

    // K51 (review R2-2) and P8: no marker, no ticket link, no ticket URL in the stored HTML.
    expect(containsSourceMarker(article.title)).toBe(false);
    expect(containsSourceMarker(article.bodyMarkdown)).toBe(false);
    expect(containsTicketLink(article.title)).toBe(false);
    expect(containsTicketLink(article.bodyMarkdown)).toBe(false);
    expect(renderedBodyLinksToTicket(article.bodyMarkdown)).toBe(false);
    const urls = urlAttributes(article.bodyHtml);
    expect(urls.length).toBeGreaterThanOrEqual(2); // the href and the img src are checked
    for (const url of urls) {
      expect(isTicketPageUrl(url)).toBe(false);
      expect(new URL(url, "https://aida.invalid/").pathname.startsWith("/tickets/")).toBe(false);
    }

    // Citations are never copied (D-11): no cited label and no source ticket id in the article.
    for (const text of [article.title, article.bodyMarkdown, article.bodyHtml]) {
      expect(text).not.toContain(citedLabel);
      expect(text).not.toContain(ticket.id);
    }
  });
});

// --- Shared helpers for Task 2 -------------------------------------------------------------------

const MINUTE = 60_000;

/** Seeds one proposal with one resolved source ticket in the organization. */
async function seedOne(
  orgId: string,
  options: Omit<SeedProposalOptions, "ticketIds">,
): Promise<{ id: string; publishedArticleId: string | null; ticketId: string }> {
  const ticket = await seedResolvedTicket(orgId);
  const seeded = await seedProposal(orgId, { ...options, ticketIds: [ticket.id] });
  return { ...seeded, ticketId: ticket.id };
}

/** The columns a review action may change, for "nothing changed" assertions. */
async function proposalState(id: string) {
  return prisma.kbProposal.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      version: true,
      title: true,
      bodyMarkdown: true,
      generationEpoch: true,
      generationQueuedAt: true,
      generationClaimedAt: true,
      lastEditedByUserId: true,
      lastEditedAt: true,
      rejectedByUserId: true,
      rejectedAt: true,
      publishedArticleId: true,
      publishedAt: true,
      publishedByUserId: true,
    },
  });
}

async function articleCount(orgId: string): Promise<number> {
  return prisma.kbArticle.count({ where: { organizationId: orgId } });
}

async function setArticleStatus(articleId: string, status: "PENDING" | "COMPLETED" | "FAILED") {
  await prisma.kbArticle.update({ where: { id: articleId }, data: { embeddingStatus: status } });
}

async function articleStatus(articleId: string) {
  const row = await prisma.kbArticle.findUniqueOrThrow({
    where: { id: articleId },
    select: { embeddingStatus: true },
  });
  return row.embeddingStatus;
}

const VALID = { title: "Reset a password", bodyMarkdown: "Open Settings and choose Reset." };

/** Saves a DRAFT with the given fields and asserts the refusal, with nothing changed or stripped. */
async function expectSaveRefused(
  fields: { title: string; bodyMarkdown: string },
  expected: { code: string; field: string },
) {
  const { orgId, owner } = await seedOrg();
  const p = await seedOne(orgId, { status: "DRAFT", version: 1 });
  const before = await proposalState(p.id);
  const result = await saveProposalDraft(owner, {
    proposalId: p.id,
    expectedVersion: 1,
    ...fields,
  });
  expect(result).toEqual({ ok: false, ...expected });
  expect(await proposalState(p.id)).toEqual(before);
  expect(await articleCount(orgId)).toBe(0);
}

/** Publishes a DRAFT seeded with the given stored fields and asserts the refusal. */
async function expectPublishRefused(
  stored: { title?: string; bodyMarkdown?: string },
  expected: { code: string; field: string },
) {
  const { orgId, owner } = await seedOrg();
  const p = await seedOne(orgId, { status: "DRAFT", version: 4, ...stored });
  const before = await proposalState(p.id);
  bossEnv.sends = [];
  const result = await publishProposal(owner, { proposalId: p.id, expectedVersion: 4 });
  expect(result).toEqual({ ok: false, ...expected });
  expect(await proposalState(p.id)).toEqual(before);
  expect(await articleCount(orgId)).toBe(0);
  expect(sendsOn("kb-embed-article")).toEqual([]);
}

// --- Save -----------------------------------------------------------------------------------------

describe("saveProposalDraft (D-11, D-15, D-16)", () => {
  it("saves title and body at the current version; version, editor and time set; still DRAFT; no article", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 3 });
    const now = new Date("2026-11-09T08:00:00.000Z");
    const result = await saveProposalDraft(
      owner,
      { proposalId: p.id, expectedVersion: 3, ...VALID },
      { now },
    );
    expect(result).toEqual({ ok: true, version: 4 });
    const row = await proposalState(p.id);
    expect(row).toMatchObject({
      status: "DRAFT",
      version: 4,
      title: VALID.title,
      bodyMarkdown: VALID.bodyMarkdown,
      lastEditedByUserId: owner.userId,
      lastEditedAt: now,
      publishedArticleId: null,
    });
    expect(await articleCount(orgId)).toBe(0);
    expect(sendsOn("kb-embed-article")).toEqual([]);
  });

  it("a 2-code-point title is TITLE_TOO_SHORT on title", async () => {
    await expectSaveRefused(
      { title: "ab", bodyMarkdown: VALID.bodyMarkdown },
      { code: "TITLE_TOO_SHORT", field: "title" },
    );
  });

  it("a 121-code-point title is TITLE_TOO_LONG on title", async () => {
    await expectSaveRefused(
      { title: "\u{1F600}".repeat(121), bodyMarkdown: VALID.bodyMarkdown },
      { code: "TITLE_TOO_LONG", field: "title" },
    );
  });

  it("an empty body is BODY_REQUIRED on bodyMarkdown", async () => {
    await expectSaveRefused(
      { title: VALID.title, bodyMarkdown: "   " },
      { code: "BODY_REQUIRED", field: "bodyMarkdown" },
    );
  });

  it("a body with [T1] is CITATION_MARKER on bodyMarkdown", async () => {
    await expectSaveRefused(
      { title: VALID.title, bodyMarkdown: "Reset it as shown [T1]." },
      { code: "CITATION_MARKER", field: "bodyMarkdown" },
    );
  });

  it("review C7: a title with [T1] is CITATION_MARKER on title", async () => {
    await expectSaveRefused(
      { title: "Reset guide [T1]", bodyMarkdown: VALID.bodyMarkdown },
      { code: "CITATION_MARKER", field: "title" },
    );
  });

  it("review C7: a relative ticket link in the body is TICKET_LINK on bodyMarkdown", async () => {
    await expectSaveRefused(
      { title: VALID.title, bodyMarkdown: "See [guide](/tickets/abc) for details." },
      { code: "TICKET_LINK", field: "bodyMarkdown" },
    );
  });

  it("review C7: an absolute ticket URL in the body is TICKET_LINK on bodyMarkdown", async () => {
    await expectSaveRefused(
      { title: VALID.title, bodyMarkdown: "See https://help.example.com/tickets/abc for details." },
      { code: "TICKET_LINK", field: "bodyMarkdown" },
    );
  });

  it("K51 (review R2-2): a ticket URL in the title is TICKET_LINK on title", async () => {
    await expectSaveRefused(
      {
        title: "Reset guide https://help.example.com/tickets/abc",
        bodyMarkdown: VALID.bodyMarkdown,
      },
      { code: "TICKET_LINK", field: "title" },
    );
  });

  it("K51 (review R2-2): a percent-encoded ticket path in the body is TICKET_LINK on bodyMarkdown", async () => {
    await expectSaveRefused(
      { title: VALID.title, bodyMarkdown: "[guide](/%74ickets/abc)" },
      { code: "TICKET_LINK", field: "bodyMarkdown" },
    );
  });

  it("review C7: a body that mentions 'ticket #123' in prose saves", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 0 });
    const body = "This came up in ticket #123 and was fixed by a restart.";
    const result = await saveProposalDraft(owner, {
      proposalId: p.id,
      expectedVersion: 0,
      title: VALID.title,
      bodyMarkdown: body,
    });
    expect(result).toEqual({ ok: true, version: 1 });
    expect((await proposalState(p.id)).bodyMarkdown).toBe(body);
  });

  it("a stale version on a DRAFT is CONFLICT and changes nothing", async () => {
    const { orgId, admin } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 5 });
    const before = await proposalState(p.id);
    const result = await saveProposalDraft(admin, {
      proposalId: p.id,
      expectedVersion: 4,
      ...VALID,
    });
    expect(result).toEqual({ ok: false, code: "CONFLICT" });
    expect(await proposalState(p.id)).toEqual(before);
  });

  it("save on a REJECTED, PUBLISHED, FAILED or GENERATING proposal is NOT_DRAFT", async () => {
    const { orgId, owner } = await seedOrg();
    for (const status of ["REJECTED", "PUBLISHED", "FAILED", "GENERATING"] as const) {
      const p = await seedOne(orgId, { status, version: 2 });
      const before = await proposalState(p.id);
      const result = await saveProposalDraft(owner, {
        proposalId: p.id,
        expectedVersion: 2,
        ...VALID,
      });
      expect(result, status).toEqual({ ok: false, code: "NOT_DRAFT" });
      expect(await proposalState(p.id)).toEqual(before);
    }
  });
});

// --- Reject ---------------------------------------------------------------------------------------

describe("rejectProposal (D-16)", () => {
  it("rejects at the current version; the row is kept and can never be published", async () => {
    const { orgId, admin, owner } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 2 });
    const now = new Date("2026-11-09T09:00:00.000Z");
    const result = await rejectProposal(admin, { proposalId: p.id, expectedVersion: 2 }, { now });
    expect(result).toEqual({ ok: true });
    expect(await proposalState(p.id)).toMatchObject({
      status: "REJECTED",
      version: 3,
      rejectedByUserId: admin.userId,
      rejectedAt: now,
    });

    const publish = await publishProposal(owner, { proposalId: p.id, expectedVersion: 3 });
    expect(publish).toEqual({ ok: false, code: "NOT_DRAFT" });
    expect(await articleCount(orgId)).toBe(0);
    expect((await proposalState(p.id)).status).toBe("REJECTED");
  });

  it("reject at a stale version is CONFLICT; reject of a PUBLISHED proposal is NOT_DRAFT", async () => {
    const { orgId, owner } = await seedOrg();
    const draft = await seedOne(orgId, { status: "DRAFT", version: 2 });
    expect(await rejectProposal(owner, { proposalId: draft.id, expectedVersion: 1 })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    const published = await seedOne(orgId, { status: "PUBLISHED", version: 2 });
    expect(await rejectProposal(owner, { proposalId: published.id, expectedVersion: 2 })).toEqual({
      ok: false,
      code: "NOT_DRAFT",
    });
    expect((await proposalState(draft.id)).status).toBe("DRAFT");
  });
});

// --- Publish refusals (reviews C7, R2-2, P8; K51) -------------------------------------------------

describe("publishProposal refuses stored references (review C7, K51)", () => {
  it("a stored body with [T2] is CITATION_MARKER on bodyMarkdown", async () => {
    await expectPublishRefused(
      { bodyMarkdown: "As described in [T2], restart the agent." },
      { code: "CITATION_MARKER", field: "bodyMarkdown" },
    );
  });

  it("a stored title with [T1] is CITATION_MARKER on title", async () => {
    await expectPublishRefused(
      { title: "Restart guide [T1]" },
      { code: "CITATION_MARKER", field: "title" },
    );
  });

  it("a stored body with a relative ticket link is TICKET_LINK on bodyMarkdown", async () => {
    await expectPublishRefused(
      { bodyMarkdown: "See [guide](/tickets/abc)." },
      { code: "TICKET_LINK", field: "bodyMarkdown" },
    );
  });

  it("K51: a stored title with a bare ticket path is TICKET_LINK on title", async () => {
    await expectPublishRefused(
      { title: "Reset guide /tickets/abc" },
      { code: "TICKET_LINK", field: "title" },
    );
  });

  it("K51: a stored body with a backslash-escaped ticket destination is TICKET_LINK on bodyMarkdown (rendered href)", async () => {
    await expectPublishRefused(
      { bodyMarkdown: String.raw`[guide](\/tickets\/abc)` },
      { code: "TICKET_LINK", field: "bodyMarkdown" },
    );
  });

  it("K51: a DRAFT whose body says 'Same cause as ticket #123.' saves and publishes", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 0 });
    const body = "Same cause as ticket #123.";
    expect(
      await saveProposalDraft(owner, {
        proposalId: p.id,
        expectedVersion: 0,
        title: VALID.title,
        bodyMarkdown: body,
      }),
    ).toEqual({ ok: true, version: 1 });
    const result = await publishProposal(owner, { proposalId: p.id, expectedVersion: 1 });
    expect(result).toMatchObject({ ok: true, indexingQueued: true });
    const article = await prisma.kbArticle.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(article.bodyMarkdown).toBe(body);
  });
});

// --- NOT_FOUND and authorization (D-01) -----------------------------------------------------------

describe("every action: NOT_FOUND, MEMBERSHIP_ENDED and NOT_ALLOWED (D-01)", () => {
  const STUCK_NOW = new Date("2026-11-09T12:00:00.000Z");

  /** Runs the five actions for one proposal id with the given actor. */
  async function allFive(actor: { userId: string; orgId: string }, proposalId: string) {
    return {
      save: await saveProposalDraft(actor, { proposalId, expectedVersion: 1, ...VALID }),
      reject: await rejectProposal(actor, { proposalId, expectedVersion: 1 }),
      publish: await publishProposal(actor, { proposalId, expectedVersion: 1 }),
      restart: await restartProposalGeneration(
        actor,
        { proposalId, expectedVersion: 1 },
        { now: STUCK_NOW },
      ),
      retry: await retryProposalIndexing(actor, { proposalId }),
    };
  }

  function expectAll(results: Record<string, unknown>, code: string) {
    for (const [action, result] of Object.entries(results)) {
      expect(result, action).toEqual({ ok: false, code });
    }
  }

  it("a missing id is NOT_FOUND for save, reject, publish, restart and retry indexing", async () => {
    const { orgId, owner } = await seedOrg();
    expectAll(await allFive(owner, "no-such-proposal"), "NOT_FOUND");
    expect(await articleCount(orgId)).toBe(0);
    expect(bossEnv.sends).toEqual([]);
  });

  it("another organization's proposal id is NOT_FOUND for all five, and that proposal is unchanged", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const ids = [
      (await seedOne(b.orgId, { status: "DRAFT", version: 1 })).id,
      (
        await seedOne(b.orgId, {
          status: "GENERATING",
          version: 1,
          generationQueuedAt: new Date(STUCK_NOW.getTime() - 30 * MINUTE),
        })
      ).id,
      (await seedOne(b.orgId, { status: "PUBLISHED", version: 1 })).id,
    ];
    bossEnv.sends = [];
    for (const id of ids) {
      const before = await proposalState(id);
      expectAll(await allFive(a.owner, id), "NOT_FOUND");
      expect(await proposalState(id)).toEqual(before);
    }
    expect(await articleCount(a.orgId)).toBe(0);
    expect(await articleCount(b.orgId)).toBe(1); // only the seeded published one
    expect(bossEnv.sends).toEqual([]);
  });

  it("a deleted member row is MEMBERSHIP_ENDED for all five, before any read; nothing changes", async () => {
    const { orgId, admin, users } = await seedOrg();
    const draft = await seedOne(orgId, { status: "DRAFT", version: 1 });
    const stuck = await seedOne(orgId, {
      status: "GENERATING",
      version: 1,
      generationQueuedAt: new Date(STUCK_NOW.getTime() - 30 * MINUTE),
    });
    const published = await seedOne(orgId, { status: "PUBLISHED", version: 1 });
    await setArticleStatus(published.publishedArticleId as string, "FAILED");
    await prisma.member.delete({ where: { id: users[1].memberId } });
    bossEnv.sends = [];
    for (const p of [draft, stuck, published]) {
      const before = await proposalState(p.id);
      expectAll(await allFive(admin, p.id), "MEMBERSHIP_ENDED");
      expect(await proposalState(p.id)).toEqual(before);
    }
    // The same code for an id that does not exist: nothing about the proposal was read first.
    expectAll(await allFive(admin, "no-such-proposal"), "MEMBERSHIP_ENDED");
    expect(await articleCount(orgId)).toBe(1);
    expect(await articleStatus(published.publishedArticleId as string)).toBe("FAILED");
    expect(bossEnv.sends).toEqual([]);
  });

  it("a plain member is NOT_ALLOWED for all five, before any read; nothing changes", async () => {
    const { orgId, member } = await seedOrg();
    const draft = await seedOne(orgId, { status: "DRAFT", version: 1 });
    const stuck = await seedOne(orgId, {
      status: "GENERATING",
      version: 1,
      generationQueuedAt: new Date(STUCK_NOW.getTime() - 30 * MINUTE),
    });
    const published = await seedOne(orgId, { status: "PUBLISHED", version: 1 });
    await setArticleStatus(published.publishedArticleId as string, "FAILED");
    bossEnv.sends = [];
    for (const p of [draft, stuck, published]) {
      const before = await proposalState(p.id);
      expectAll(await allFive(member, p.id), "NOT_ALLOWED");
      expect(await proposalState(p.id)).toEqual(before);
    }
    expectAll(await allFive(member, "no-such-proposal"), "NOT_ALLOWED");
    expect(await articleCount(orgId)).toBe(1);
    expect(await articleStatus(published.publishedArticleId as string)).toBe("FAILED");
    expect(bossEnv.sends).toEqual([]);
  });

  it("review C1: shareLockActiveMembership returns what findActiveMembership returns", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const locked = (userId: string, orgId: string) =>
      prisma.$transaction((tx) => shareLockActiveMembership(tx, userId, orgId));

    const own = await locked(a.owner.userId, a.orgId);
    expect(own).toEqual({ id: a.users[0].memberId, role: "owner" });
    expect(own).toEqual(await findActiveMembership(prisma, a.owner.userId, a.orgId));

    // A member of another organization only.
    expect(await locked(b.owner.userId, a.orgId)).toBeNull();
    expect(await findActiveMembership(prisma, b.owner.userId, a.orgId)).toBeNull();

    // After the row was deleted.
    await prisma.member.delete({ where: { id: a.users[2].memberId } });
    expect(await locked(a.member.userId, a.orgId)).toBeNull();
    expect(await findActiveMembership(prisma, a.member.userId, a.orgId)).toBeNull();

    // Empty arguments.
    expect(await locked("", a.orgId)).toBeNull();
    expect(await locked(a.owner.userId, "")).toBeNull();
  });
});

// --- Restart (D-13, reviews C5 and R2-3) ----------------------------------------------------------

describe("restartProposalGeneration (D-13, reviews C5 and R2-3)", () => {
  const T0 = new Date("2026-11-09T10:00:00.000Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);

  async function seedGenerating(
    orgId: string,
    queuedAgoMs: number,
    extra: { createdAt?: Date } = {},
  ) {
    return seedOne(orgId, {
      status: "GENERATING",
      version: 1,
      generationEpoch: 1,
      generationClaimedAt: null,
      generationQueuedAt: new Date(T0.getTime() - queuedAgoMs),
      ...extra,
    });
  }

  it("9:59 after queueing is NOT_STUCK; at 10:00 it restarts with a new epoch and one send after commit", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedGenerating(orgId, 10 * MINUTE);
    bossEnv.sends = [];

    const early = await restartProposalGeneration(
      owner,
      { proposalId: p.id, expectedVersion: 1 },
      { now: at(-1000) },
    );
    expect(early).toEqual({ ok: false, code: "NOT_STUCK" });
    expect(sendsOn("kb-proposal-generate")).toEqual([]);

    const result = await restartProposalGeneration(
      owner,
      { proposalId: p.id, expectedVersion: 1 },
      { now: T0 },
    );
    expect(result).toEqual({ ok: true, queued: true });
    const row = await proposalState(p.id);
    expect(row).toMatchObject({
      status: "GENERATING",
      generationClaimedAt: null,
      generationQueuedAt: T0,
      version: 2,
      generationEpoch: 2,
    });
    const sends = sendsOn("kb-proposal-generate");
    expect(sends).toHaveLength(1);
    expect(sends[0].payload).toStrictEqual({ proposalId: p.id, epoch: 2 });
    expect(sends[0].seen).toBe(2); // the separate client saw the new epoch: sent after commit
  });

  it("a restart right after a restart is NOT_STUCK; 10 minutes after the first it is allowed again", async () => {
    const { orgId, admin } = await seedOrg();
    const p = await seedGenerating(orgId, 20 * MINUTE);
    expect(
      await restartProposalGeneration(admin, { proposalId: p.id, expectedVersion: 1 }, { now: T0 }),
    ).toEqual({ ok: true, queued: true });
    expect(
      await restartProposalGeneration(
        admin,
        { proposalId: p.id, expectedVersion: 2 },
        { now: at(1000) },
      ),
    ).toEqual({ ok: false, code: "NOT_STUCK" });
    expect(
      await restartProposalGeneration(
        admin,
        { proposalId: p.id, expectedVersion: 2 },
        { now: at(10 * MINUTE) },
      ),
    ).toEqual({ ok: true, queued: true });
    expect(await proposalState(p.id)).toMatchObject({
      version: 3,
      generationEpoch: 3,
      generationQueuedAt: at(10 * MINUTE),
    });
    expect(sendsOn("kb-proposal-generate").map((s) => s.payload)).toStrictEqual([
      { proposalId: p.id, epoch: 2 },
      { proposalId: p.id, epoch: 3 },
    ]);
  });

  it("the creation time is never used: created 30 minutes ago, queued 1 minute ago is NOT_STUCK", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedGenerating(orgId, MINUTE, {
      createdAt: new Date(T0.getTime() - 30 * MINUTE),
    });
    const before = await proposalState(p.id);
    expect(
      await restartProposalGeneration(owner, { proposalId: p.id, expectedVersion: 1 }, { now: T0 }),
    ).toEqual({ ok: false, code: "NOT_STUCK" });
    expect(await proposalState(p.id)).toEqual(before);
  });

  it("a stale version is CONFLICT; a DRAFT is NOT_STUCK", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedGenerating(orgId, 30 * MINUTE);
    const before = await proposalState(p.id);
    expect(
      await restartProposalGeneration(owner, { proposalId: p.id, expectedVersion: 0 }, { now: T0 }),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await proposalState(p.id)).toEqual(before);
    const draft = await seedOne(orgId, { status: "DRAFT", version: 1 });
    expect(
      await restartProposalGeneration(
        owner,
        { proposalId: draft.id, expectedVersion: 1 },
        { now: T0 },
      ),
    ).toEqual({ ok: false, code: "NOT_STUCK" });
    expect(sendsOn("kb-proposal-generate")).toEqual([]);
  });

  it("a failing send returns queued false with the restart recorded; 10 minutes later it restarts again with the next epoch", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedGenerating(orgId, 15 * MINUTE);
    bossEnv.failSend = true;
    expect(
      await restartProposalGeneration(owner, { proposalId: p.id, expectedVersion: 1 }, { now: T0 }),
    ).toEqual({ ok: true, queued: false });
    expect(await proposalState(p.id)).toMatchObject({
      generationQueuedAt: T0,
      version: 2,
      generationEpoch: 2,
      generationClaimedAt: null,
    });

    bossEnv.failSend = false;
    bossEnv.sends = [];
    expect(
      await restartProposalGeneration(
        owner,
        { proposalId: p.id, expectedVersion: 2 },
        { now: at(10 * MINUTE) },
      ),
    ).toEqual({ ok: true, queued: true });
    expect(await proposalState(p.id)).toMatchObject({ version: 3, generationEpoch: 3 });
    expect(sendsOn("kb-proposal-generate").map((s) => s.payload)).toStrictEqual([
      { proposalId: p.id, epoch: 3 },
    ]);
  });
});

// --- Retry indexing (reviews C2 and R3-2) ---------------------------------------------------------

describe("retryProposalIndexing (reviews C2 and R3-2)", () => {
  async function seedPublished(orgId: string, status: "PENDING" | "COMPLETED" | "FAILED") {
    const p = await seedOne(orgId, { status: "PUBLISHED", version: 1 });
    const articleId = p.publishedArticleId as string;
    await setArticleStatus(articleId, status);
    bossEnv.sends = [];
    return { proposalId: p.id, articleId };
  }

  it("a FAILED article is claimed PENDING and one job is sent after commit; no new article", async () => {
    const { orgId, owner } = await seedOrg();
    const { proposalId, articleId } = await seedPublished(orgId, "FAILED");
    expect(await retryProposalIndexing(owner, { proposalId })).toEqual({ ok: true, queued: true });
    expect(await articleStatus(articleId)).toBe("PENDING");
    const sends = sendsOn("kb-embed-article");
    expect(sends.map((s) => s.payload)).toStrictEqual([{ articleId }]);
    expect(sends[0].seen).toBe("PENDING");
    expect(await articleCount(orgId)).toBe(1);
  });

  it("a PENDING article (never queued) is claimed and one job is sent; no new article", async () => {
    const { orgId, admin } = await seedOrg();
    const { proposalId, articleId } = await seedPublished(orgId, "PENDING");
    expect(await retryProposalIndexing(admin, { proposalId })).toEqual({ ok: true, queued: true });
    expect(await articleStatus(articleId)).toBe("PENDING");
    expect(sendsOn("kb-embed-article").map((s) => s.payload)).toStrictEqual([{ articleId }]);
    expect(await articleCount(orgId)).toBe(1);
  });

  it("a COMPLETED article is NOT_RETRYABLE and nothing is sent", async () => {
    const { orgId, owner } = await seedOrg();
    const { proposalId, articleId } = await seedPublished(orgId, "COMPLETED");
    expect(await retryProposalIndexing(owner, { proposalId })).toEqual({
      ok: false,
      code: "NOT_RETRYABLE",
    });
    expect(await articleStatus(articleId)).toBe("COMPLETED");
    expect(sendsOn("kb-embed-article")).toEqual([]);
  });

  it("a DRAFT proposal (no published article) is NOT_RETRYABLE", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 1 });
    bossEnv.sends = [];
    expect(await retryProposalIndexing(owner, { proposalId: p.id })).toEqual({
      ok: false,
      code: "NOT_RETRYABLE",
    });
    expect(sendsOn("kb-embed-article")).toEqual([]);
    expect(await articleCount(orgId)).toBe(0);
  });

  it("review R3-2: a job that completed before the claim makes the retry NOT_RETRYABLE; the article stays COMPLETED", async () => {
    const { orgId, owner } = await seedOrg();
    await saveEmbeddingSettings(scopedDb(orgId), orgId, {
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "sk-test-DUMMYEMBEDKEY0000000000",
    });
    const { proposalId, articleId } = await seedPublished(orgId, "PENDING");
    await kbEmbedArticleHandler({ articleId });
    expect(await articleStatus(articleId)).toBe("COMPLETED");
    const chunks = await prisma.kbChunk.count({ where: { articleId } });
    expect(chunks).toBeGreaterThan(0);

    expect(await retryProposalIndexing(owner, { proposalId })).toEqual({
      ok: false,
      code: "NOT_RETRYABLE",
    });
    expect(await articleStatus(articleId)).toBe("COMPLETED");
    expect(await prisma.kbChunk.count({ where: { articleId } })).toBe(chunks);
    expect(sendsOn("kb-embed-article")).toEqual([]);
  });

  it("review R3-2: a retry whose send throws returns queued false with the article PENDING; the next retry sends", async () => {
    const { orgId, owner } = await seedOrg();
    const { proposalId, articleId } = await seedPublished(orgId, "FAILED");
    bossEnv.failSend = true;
    expect(await retryProposalIndexing(owner, { proposalId })).toEqual({ ok: true, queued: false });
    expect(await articleStatus(articleId)).toBe("PENDING");
    expect(await articleCount(orgId)).toBe(1);

    bossEnv.failSend = false;
    bossEnv.sends = [];
    expect(await retryProposalIndexing(owner, { proposalId })).toEqual({ ok: true, queued: true });
    expect(sendsOn("kb-embed-article").map((s) => s.payload)).toStrictEqual([{ articleId }]);
    expect(await articleCount(orgId)).toBe(1);
  });

  it("review C2: a publish whose send throws is ok with indexingQueued false; retry recovers it; still one article", async () => {
    const { orgId, owner } = await seedOrg();
    const p = await seedOne(orgId, { status: "DRAFT", version: 0 });
    bossEnv.sends = [];
    bossEnv.failSend = true;
    const published = await publishProposal(owner, { proposalId: p.id, expectedVersion: 0 });
    expect(published).toEqual({ ok: true, articleId: expect.any(String), indexingQueued: false });
    if (!published.ok) throw new Error("unreachable");
    expect((await proposalState(p.id)).status).toBe("PUBLISHED");
    expect(await articleCount(orgId)).toBe(1);
    expect(await articleStatus(published.articleId)).toBe("PENDING");

    bossEnv.failSend = false;
    bossEnv.sends = [];
    expect(await retryProposalIndexing(owner, { proposalId: p.id })).toEqual({
      ok: true,
      queued: true,
    });
    expect(sendsOn("kb-embed-article").map((s) => s.payload)).toStrictEqual([
      { articleId: published.articleId },
    ]);
    expect(await articleCount(orgId)).toBe(1);
  });
});

// --- Observer seams ---------------------------------------------------------------------------------

describe("setProposalReviewObserverForTests: hook order on one transaction", () => {
  it("save, reject and restart call onTransactionStart then afterProposalUpdate; retry calls onTransactionStart; publish calls all four in order", async () => {
    const { orgId, owner } = await seedOrg();
    const T = new Date("2026-11-09T11:00:00.000Z");
    const toSave = await seedOne(orgId, { status: "DRAFT", version: 0 });
    const toReject = await seedOne(orgId, { status: "DRAFT", version: 0 });
    const toRestart = await seedOne(orgId, {
      status: "GENERATING",
      version: 0,
      generationQueuedAt: new Date(T.getTime() - 20 * MINUTE),
    });
    const toPublish = await seedOne(orgId, { status: "DRAFT", version: 0 });
    const toRetry = await seedOne(orgId, { status: "PUBLISHED", version: 0 });

    let calls: { hook: string; pid: number }[] = [];
    let watched = "";
    const versions: { inTx: number; outside: number }[] = [];
    setProposalReviewObserverForTests({
      onTransactionStart: async (tx) => {
        calls.push({ hook: "onTransactionStart", pid: await backendPid(tx) });
      },
      afterMembershipLock: async (tx) => {
        calls.push({ hook: "afterMembershipLock", pid: await backendPid(tx) });
      },
      afterProposalUpdate: async (tx) => {
        calls.push({ hook: "afterProposalUpdate", pid: await backendPid(tx) });
        const [inTx] = await tx.$queryRaw<{ version: number }[]>`
          SELECT "version" FROM "KbProposal" WHERE "id" = ${watched} AND "organizationId" = ${orgId}
        `;
        const outside = await observer.kbProposal.findUniqueOrThrow({
          where: { id: watched },
          select: { version: true },
        });
        versions.push({ inTx: Number(inTx.version), outside: outside.version });
      },
      afterArticleInsert: async (tx) => {
        calls.push({ hook: "afterArticleInsert", pid: await backendPid(tx) });
      },
    });

    const run = async (id: string, action: () => Promise<{ ok: boolean }>) => {
      calls = [];
      watched = id;
      const result = await action();
      expect(result.ok).toBe(true);
      const pids = new Set(calls.map((c) => c.pid));
      expect(pids.size).toBe(1); // every hook got the same transaction
      return calls.map((c) => c.hook);
    };

    expect(
      await run(toSave.id, () =>
        saveProposalDraft(owner, { proposalId: toSave.id, expectedVersion: 0, ...VALID }),
      ),
    ).toEqual(["onTransactionStart", "afterProposalUpdate"]);
    expect(
      await run(toReject.id, () =>
        rejectProposal(owner, { proposalId: toReject.id, expectedVersion: 0 }),
      ),
    ).toEqual(["onTransactionStart", "afterProposalUpdate"]);
    expect(
      await run(toRestart.id, () =>
        restartProposalGeneration(
          owner,
          { proposalId: toRestart.id, expectedVersion: 0 },
          { now: T },
        ),
      ),
    ).toEqual(["onTransactionStart", "afterProposalUpdate"]);
    expect(
      await run(toRetry.id, () => retryProposalIndexing(owner, { proposalId: toRetry.id })),
    ).toEqual(["onTransactionStart"]);
    expect(
      await run(toPublish.id, () =>
        publishProposal(owner, { proposalId: toPublish.id, expectedVersion: 0 }),
      ),
    ).toEqual([
      "onTransactionStart",
      "afterMembershipLock",
      "afterProposalUpdate",
      "afterArticleInsert",
    ]);

    // afterProposalUpdate ran after the version changed inside the transaction, before commit.
    expect(versions).toEqual([
      { inTx: 1, outside: 0 },
      { inTx: 1, outside: 0 },
      { inTx: 1, outside: 0 },
      { inTx: 1, outside: 0 },
    ]);
  });
});
