// Phase 12.2 D-05 proof (AIDA-18, T-12.2-02): no existing KB reader can see a proposal. A
// proposal lives only in KbProposal and KbProposalSource; it never gets a KbArticle row, KbChunk
// rows or an embedding before the explicit publish action.
//
// Readers covered (from `grep -rnE 'kbArticle|kbChunk|"KbArticle"|"KbChunk"' src`, generated
// client excluded; see the 12.2-01 SUMMARY): src/lib/rag/retrieve.ts (RAG retrieval),
// src/lib/insight/kb-gap.ts (Insight KB-gap reader), src/lib/insight/run-insight.ts (Insight chunk
// count), src/app/(app)/kb/page.tsx (KB list), src/app/(app)/kb/[id]/page.tsx (article loader),
// src/lib/worker/jobs/kb-embed-article.ts (kbEmbedArticleHandler), src/app/(app)/settings/page.tsx
// (article count), src/app/(app)/settings/actions.ts (re-embed-all id list),
// src/lib/tickets/ticket-detail-data.ts (draftable article count), src/lib/demo/seed-demo-data.ts
// (article lookup by organization) and src/lib/kb/create-article.ts (slug lookup and the update
// by id of updateKbArticle and enqueueReembed). Exported functions are called; a server page,
// server action or non-exported helper is covered by running the same query it runs.
//
// Only the embedding adapter is mocked (as in tests/integration/draft-generation.test.ts), never a
// reader. The proposals are seeded with seedProposal directly: the services come in later plans,
// and the point is that the readers cannot see the KbProposal table at all.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const FIXED_VECTOR = Array(768).fill(0.01);

vi.mock("@/lib/rag/providers/openai-embed", () => ({
  embedOpenAi: vi.fn(async ({ input }: { input: string[] }) => input.map(() => FIXED_VECTOR)),
}));

import { prisma } from "@/lib/db";
import { nearestKbChunk } from "@/lib/insight/kb-gap";
import { embed } from "@/lib/rag/embed";
import { retrieveRelevantChunks } from "@/lib/rag/retrieve";
import { saveEmbeddingSettings } from "@/lib/rag/settings";
import { scopedDb } from "@/lib/scoped-db";
import { kbEmbedArticleHandler } from "@/lib/worker/jobs/kb-embed-article";
import {
  seedOrgWithMembers,
  seedProposal,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";

const EMBEDDING_MODEL = "openai:text-embedding-3-small";

interface Seeded {
  orgId: string;
  marker: string;
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
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
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
  const ticket = await seedResolvedTicket(orgId);
  const proposalIds: string[] = [];
  for (const status of ["DRAFT", "REJECTED", "FAILED"] as const) {
    const created = await seedProposal(orgId, {
      status,
      ticketIds: [ticket.id],
      title: `Proposal ${marker}`.slice(0, 120),
      bodyMarkdown: `## Steps\nThe fix is ${marker}.\n\n## Notes\n${marker} again.`,
    });
    proposalIds.push(created.id);
  }
  return { orgId, marker, articleId: article.id, proposalIds };
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

  it("the Insight KB-gap reader (src/lib/insight/kb-gap.ts) and the Insight chunk count (run-insight.ts) see only the article", async () => {
    const seeded = await seed();
    const db = scopedDb(seeded.orgId);
    const query = await embed(db, [seeded.marker]);
    const nearest = await nearestKbChunk(seeded.orgId, query.embeddings[0], EMBEDDING_MODEL);
    expect(nearest?.articleId).toBe(seeded.articleId);
    expect(leaks(nearest, seeded)).toBe(false);

    // run-insight.ts line 151: the zero-KB shortcut's chunk count, the same query.
    const kbChunkCount = await db.kbChunk.count({ where: { embeddingModel: EMBEDDING_MODEL } });
    const articleChunks = await prisma.kbChunk.count({ where: { articleId: seeded.articleId } });
    expect(kbChunkCount).toBe(articleChunks);
  });

  it("the KB list query (src/app/(app)/kb/page.tsx) lists only the article", async () => {
    const seeded = await seed();
    const db = scopedDb(seeded.orgId);
    const articles = await db.kbArticle.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, slug: true, embeddingStatus: true, updatedAt: true },
    });
    expect(articles.map((a) => a.id)).toEqual([seeded.articleId]);
    expect(leaks(articles, seeded)).toBe(false);
  });

  it("the article loader (src/app/(app)/kb/[id]/page.tsx) finds nothing for each proposal id", async () => {
    const seeded = await seed();
    const db = scopedDb(seeded.orgId);
    for (const id of seeded.proposalIds) {
      expect(await db.kbArticle.findFirst({ where: { id } })).toBeNull();
    }
    const real = await db.kbArticle.findFirst({ where: { id: seeded.articleId } });
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

  it("the settings, re-embed-all, ticket-detail and demo-seed article queries see only the article", async () => {
    const seeded = await seed();
    const db = scopedDb(seeded.orgId);
    // src/app/(app)/settings/page.tsx: the article count.
    expect(await db.kbArticle.count()).toBe(1);
    // src/app/(app)/settings/actions.ts reembedAllKb: the id list it re-enqueues.
    expect(await db.kbArticle.findMany({ select: { id: true } })).toEqual([
      { id: seeded.articleId },
    ]);
    // src/lib/tickets/ticket-detail-data.ts findRelated: the draftable article count.
    expect(await db.kbArticle.count({ where: { embeddingStatus: "COMPLETED" } })).toBe(1);
    // src/lib/demo/seed-demo-data.ts: the article lookup by organization.
    const demoRows = await prisma.kbArticle.findMany({ where: { organizationId: seeded.orgId } });
    expect(demoRows.map((a) => a.id)).toEqual([seeded.articleId]);
    expect(leaks(demoRows, seeded)).toBe(false);
  });

  it("create-article.ts lookups by slug and by id (uniqueSlug, updateKbArticle, enqueueReembed) never reach a proposal", async () => {
    const seeded = await seed();
    const db = scopedDb(seeded.orgId);
    // uniqueSlug: a slug made from the proposal title is free.
    const slug = `proposal-${seeded.marker}`;
    expect(await db.kbArticle.findFirst({ where: { slug } })).toBeNull();
    // updateKbArticle and enqueueReembed update the article by id: a proposal id matches nothing.
    for (const id of seeded.proposalIds) {
      const updated = await db.kbArticle.updateMany({
        where: { id },
        data: { embeddingStatus: "PENDING" },
      });
      expect(updated.count).toBe(0);
    }
    expect(await prisma.kbArticle.count({ where: { organizationId: seeded.orgId } })).toBe(1);
  });
});
