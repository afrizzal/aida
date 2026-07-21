import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Mock the embedding SDK boundary — src/lib/rag/embed.ts's real dispatch/dimension-guard logic
// still runs, only the OpenAI adapter's actual network call is replaced. Deterministic 768-length
// vectors, one per input chunk (no live OpenAI key needed).
vi.mock("@/lib/rag/providers/openai-embed", () => ({
  embedOpenAi: vi.fn(async ({ input }: { input: string[] }) =>
    input.map(() => Array(768).fill(0.01)),
  ),
}));

import { prisma } from "@/lib/db";
import { createKbArticle } from "@/lib/kb/create-article";
import { saveEmbeddingSettings } from "@/lib/rag/settings";
import { scopedDb } from "@/lib/scoped-db";
import { kbEmbedArticleHandler } from "@/lib/worker/jobs/kb-embed-article";

describe("kb-embed-article pipeline: save -> chunk -> embed -> store (AIDA-15)", () => {
  it("embeds a saved KB article into org-scoped 768-dim KbChunk rows and is idempotent on re-embed", async () => {
    const org = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: "KB Embed Org",
        slug: `kb-embed-${randomUUID()}`,
        createdAt: new Date(),
      },
    });

    const db = scopedDb(org.id);
    await saveEmbeddingSettings(db, org.id, {
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "sk-test-DUMMYEMBEDKEY0000000000",
    });

    const { id: articleId } = await createKbArticle(org.id, {
      title: "Refund policy",
      bodyMarkdown: "## Refunds\nWe refund within 30 days.\n\n## Shipping\nShips in 2 days.",
    });

    // Invoke the handler directly (don't rely on a live worker loop picking up the enqueued job).
    await kbEmbedArticleHandler({ articleId });

    const article = await prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
    expect(article.embeddingStatus).toBe("COMPLETED");
    expect(article.embeddingModel).toBe("openai:text-embedding-3-small");

    const chunkCount = await prisma.kbChunk.count({ where: { articleId } });
    expect(chunkCount).toBeGreaterThanOrEqual(2);

    const rows = await prisma.$queryRaw<{ dims: number; organizationId: string }[]>`
      SELECT vector_dims(embedding) AS dims, "organizationId"
      FROM "KbChunk"
      WHERE "articleId" = ${articleId}
    `;
    expect(rows.length).toBe(chunkCount);
    for (const row of rows) {
      expect(row.dims).toBe(768);
      expect(row.organizationId).toBe(org.id);
    }

    // Re-embed idempotency: old chunks must be deleted before the new ones are inserted, so a
    // second run never doubles the chunk count.
    await kbEmbedArticleHandler({ articleId });
    const chunkCountAfterReembed = await prisma.kbChunk.count({ where: { articleId } });
    expect(chunkCountAfterReembed).toBe(chunkCount);
  });
});
