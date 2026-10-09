// Phase 12.2 D-05 proof (AIDA-18, T-12.2-02): no existing KB reader can see a proposal. A
// proposal lives only in KbProposal and KbProposalSource; it never gets a KbArticle row, KbChunk
// rows or an embedding before the explicit publish action.
//
// Readers covered (from `grep -rnE 'kbArticle|kbChunk|"KbArticle"|"KbChunk"' src`, generated
// client excluded; see the 12.2-01 SUMMARY), each by calling the code the product runs (review
// c-WR-04), never a copy of its query:
// - src/lib/rag/retrieve.ts retrieveRelevantChunks (RAG retrieval);
// - src/lib/insight/kb-gap.ts nearestKbChunk (Insight KB-gap reader);
// - src/lib/kb/article-reads.ts listKbArticles, findKbArticle and countKbArticles, the reads of
//   src/app/(app)/kb/page.tsx (KB list), src/app/(app)/kb/[id]/page.tsx (article loader) and
//   src/app/(app)/settings/page.tsx (article count);
// - src/lib/worker/jobs/kb-embed-article.ts kbEmbedArticleHandler;
// - src/app/(app)/settings/actions.ts reembedAllKb (the server action, with the real session and
//   authz modules over a session double);
// - src/lib/tickets/ticket-detail-data.ts loadTicketDetailData (the draftable article count);
// - src/lib/kb/create-article.ts createKbArticle (slug lookup), updateKbArticle and enqueueReembed.
// Not covered here: the Insight chunk count inside runInsight (run-insight.ts) and the article
// lookup inside seedDemoData (seed-demo-data.ts), which are not exported on their own. The Insight
// run is covered end to end by tests/e2e/kb-proposals.spec.ts ("absent from RAG and Insight").
//
// Doubles: the embedding adapter (as in tests/integration/draft-generation.test.ts), the request
// headers and Better Auth's session read (the session source of src/lib/session.ts), next/cache and
// the app's pg-boss client (a recording double, so nothing is really queued). No reader is mocked.
// The proposals are seeded with seedProposal directly: the point is that the readers cannot see
// the KbProposal table at all.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_VECTOR = Array(768).fill(0.01);

vi.mock("@/lib/rag/providers/openai-embed", () => ({
  embedOpenAi: vi.fn(async ({ input }: { input: string[] }) => input.map(() => FIXED_VECTOR)),
}));

/** The signed-in user and active organization the session double returns. */
const sessionEnv = vi.hoisted(() => ({
  actor: null as null | { userId: string; orgId: string },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        sessionEnv.actor
          ? {
              user: { id: sessionEnv.actor.userId },
              session: { activeOrganizationId: sessionEnv.actor.orgId },
            }
          : null,
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

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

import { reembedAllKb } from "@/app/(app)/settings/actions";
import { prisma } from "@/lib/db";
import { nearestKbChunk } from "@/lib/insight/kb-gap";
import { countKbArticles, findKbArticle, listKbArticles } from "@/lib/kb/article-reads";
import { createKbArticle, enqueueReembed, slugify, updateKbArticle } from "@/lib/kb/create-article";
import { embed } from "@/lib/rag/embed";
import { retrieveRelevantChunks } from "@/lib/rag/retrieve";
import { saveEmbeddingSettings } from "@/lib/rag/settings";
import { scopedDb } from "@/lib/scoped-db";
import { loadTicketDetailData } from "@/lib/tickets/ticket-detail-data";
import { kbEmbedArticleHandler } from "@/lib/worker/jobs/kb-embed-article";
import {
  seedOrgWithMembers,
  seedProposal,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";

beforeEach(() => {
  sessionEnv.actor = null;
  bossEnv.sends = [];
});

const EMBEDDING_MODEL = "openai:text-embedding-3-small";

interface Seeded {
  orgId: string;
  ownerId: string;
  ticketId: string;
  marker: string;
  title: string;
  articleId: string;
  proposalIds: string[];
}

/** True when the value, serialized, mentions the marker or any proposal id. */
function leaks(value: unknown, seeded: Seeded): boolean {
  const text = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return text.includes(seeded.marker) || seeded.proposalIds.some((id) => text.includes(id));
}

/**
 * One organization with embedding settings (fake key, mocked adapter), one published KbArticle
 * embedded through the real kb-embed-article handler, and a DRAFT, a REJECTED and a FAILED
 * proposal whose title and body carry the marker.
 */
async function seed(): Promise<Seeded> {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
  const db = scopedDb(orgId);
  await saveEmbeddingSettings(db, orgId, {
    provider: "openai",
    model: "text-embedding-3-small",
    apiKey: "sk-test-DUMMYEMBEDKEY0000000000",
  });

  const article = await prisma.kbArticle.create({
    data: {
      organizationId: orgId,
      title: "Refund policy",
      slug: `refund-policy-${randomUUID()}`,
      bodyMarkdown: "## Refunds\nWe refund within 30 days.\n\n## Shipping\nShips in 2 days.",
      bodyHtml: "<h2>Refunds</h2><p>We refund within 30 days.</p>",
    },
    select: { id: true },
  });
  await kbEmbedArticleHandler({ articleId: article.id });

  const marker = `zqxmarker${randomUUID().replaceAll("-", "")}`;
  const title = `Proposal ${marker}`.slice(0, 120);
  const ticket = await seedResolvedTicket(orgId);
  const proposalIds: string[] = [];
  for (const status of ["DRAFT", "REJECTED", "FAILED"] as const) {
    const created = await seedProposal(orgId, {
      status,
      ticketIds: [ticket.id],
      title,
      bodyMarkdown: `## Steps\nThe fix is ${marker}.\n\n## Notes\n${marker} again.`,
    });
    proposalIds.push(created.id);
  }
  return {
    orgId,
    ownerId: users[0].id,
    ticketId: ticket.id,
    marker,
    title,
    articleId: article.id,
    proposalIds,
  };
}

describe("D-05: no KB reader returns proposal text", () => {
  it("the seeded published article is embedded, and no KbChunk holds the marker", async () => {
    const seeded = await seed();
    const article = await prisma.kbArticle.findUniqueOrThrow({ where: { id: seeded.articleId } });
    expect(article.embeddingStatus).toBe("COMPLETED");
    const chunks = await prisma.kbChunk.findMany({
      where: { organizationId: seeded.orgId },
      select: { id: true, articleId: true, content: true, headingPath: true },
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.articleId === seeded.articleId)).toBe(true);
    expect(leaks(chunks, seeded)).toBe(false);
    const markerChunks = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "KbChunk" WHERE content LIKE ${`%${seeded.marker}%`}`;
    expect(markerChunks[0].n).toBe(0n);
    // A proposal is never a KbArticle row.
    expect(await prisma.kbArticle.count({ where: { id: { in: seeded.proposalIds } } })).toBe(0);
  });

  it("RAG retrieval (src/lib/rag/retrieve.ts) for a query equal to the marker returns only the article's chunks", async () => {
    const seeded = await seed();
    const db = scopedDb(seeded.orgId);
    const query = await embed(db, [seeded.marker]);
    expect(query.embeddingModel).toBe(EMBEDDING_MODEL);
    const results = await retrieveRelevantChunks(
      seeded.orgId,
      query.embeddings[0],
      query.embeddingModel,
      50,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.articleId === seeded.articleId)).toBe(true);
    expect(leaks(results, seeded)).toBe(false);
  });

  it("the Insight KB-gap reader (src/lib/insight/kb-gap.ts) sees only the article", async () => {
    const seeded = await seed();
    const db = scopedDb(seeded.orgId);
    const query = await embed(db, [seeded.marker]);
    const nearest = await nearestKbChunk(seeded.orgId, query.embeddings[0], EMBEDDING_MODEL);
    expect(nearest?.articleId).toBe(seeded.articleId);
    expect(leaks(nearest, seeded)).toBe(false);
  });

  it("listKbArticles, the /kb list read (src/app/(app)/kb/page.tsx), lists only the article", async () => {
    const seeded = await seed();
    const articles = await listKbArticles(scopedDb(seeded.orgId));
    expect(articles.map((a) => a.id)).toEqual([seeded.articleId]);
    expect(leaks(articles, seeded)).toBe(false);
  });

  it("findKbArticle, the /kb/[id] loader (src/app/(app)/kb/[id]/page.tsx), finds nothing for each proposal id", async () => {
    const seeded = await seed();
    const db = scopedDb(seeded.orgId);
    for (const id of seeded.proposalIds) {
      expect(await findKbArticle(db, id)).toBeNull();
    }
    const real = await findKbArticle(db, seeded.articleId);
    expect(real?.id).toBe(seeded.articleId);
    expect(leaks(real, seeded)).toBe(false);
  });

  it("kbEmbedArticleHandler (src/lib/worker/jobs/kb-embed-article.ts) called with a proposal id creates no KbChunk", async () => {
    const seeded = await seed();
    const before = await prisma.kbChunk.count({ where: { organizationId: seeded.orgId } });
    for (const id of seeded.proposalIds) {
      await kbEmbedArticleHandler({ articleId: id });
    }
    expect(await prisma.kbChunk.count({ where: { organizationId: seeded.orgId } })).toBe(before);
    expect(await prisma.kbChunk.count({ where: { articleId: { in: seeded.proposalIds } } })).toBe(
      0,
    );
    const markerChunks = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "KbChunk" WHERE content LIKE ${`%${seeded.marker}%`}`;
    expect(markerChunks[0].n).toBe(0n);
  });

  it("countKbArticles, the settings page count (src/app/(app)/settings/page.tsx), counts only the article", async () => {
    const seeded = await seed();
    expect(await countKbArticles(scopedDb(seeded.orgId))).toBe(1);
  });

  it("reembedAllKb (src/app/(app)/settings/actions.ts) re-enqueues only the article", async () => {
    const seeded = await seed();
    sessionEnv.actor = { userId: seeded.ownerId, orgId: seeded.orgId };
    expect(await reembedAllKb()).toEqual({ ok: true, count: 1 });
    expect(bossEnv.sends).toEqual([
      { queue: "kb-embed-article", payload: { articleId: seeded.articleId } },
    ]);
    expect(leaks(bossEnv.sends, seeded)).toBe(false);
  });

  it("loadTicketDetailData (src/lib/tickets/ticket-detail-data.ts) counts only the article as draftable", async () => {
    const seeded = await seed();
    const data = await loadTicketDetailData(
      prisma,
      { userId: seeded.ownerId, orgId: seeded.orgId },
      seeded.ticketId,
    );
    if (data.status !== "ok") throw new Error(`expected ok, got ${data.status}`);
    expect(data.draftableKbCount).toBe(1);
  });

  it("createKbArticle, updateKbArticle and enqueueReembed (src/lib/kb/create-article.ts) never reach a proposal", async () => {
    const seeded = await seed();
    // uniqueSlug: the slug of a proposal's title is free, so it is used without a suffix.
    const created = await createKbArticle(seeded.orgId, {
      title: seeded.title,
      bodyMarkdown: "## Steps\nA manual article with a proposal's title.",
    });
    const article = await prisma.kbArticle.findUniqueOrThrow({ where: { id: created.id } });
    expect(article.slug).toBe(slugify(seeded.title));
    expect(await prisma.kbArticle.count({ where: { organizationId: seeded.orgId } })).toBe(2);

    // updateKbArticle and enqueueReembed update the article by id: a proposal id matches no row.
    const sendsBefore = bossEnv.sends.length;
    for (const id of seeded.proposalIds) {
      await expect(
        updateKbArticle(seeded.orgId, id, { title: "Changed", bodyMarkdown: "Changed" }),
      ).rejects.toMatchObject({ code: "P2025" });
      await expect(enqueueReembed(seeded.orgId, id)).rejects.toMatchObject({ code: "P2025" });
    }
    expect(bossEnv.sends.slice(sendsBefore)).toEqual([]);
    const proposals = await prisma.kbProposal.findMany({
      where: { id: { in: seeded.proposalIds } },
      select: { title: true },
    });
    expect(proposals.map((p) => p.title)).toEqual(seeded.proposalIds.map(() => seeded.title));
    expect(await prisma.kbArticle.count({ where: { organizationId: seeded.orgId } })).toBe(2);
  });
});
