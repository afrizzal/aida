// Worker job: chunks + batch-embeds a KB article and writes its KbChunk vector rows
// (auto-enqueued after createKbArticle()/updateKbArticle() commit, or by 05-05's re-embed-all
// admin action via enqueueReembed()). Registered by src/lib/worker/index.ts (mirrors
// ai-triage.ts's split between handler file and registration).
//
// Worker-bundleable (esbuild) — every import below is relative to src/lib/worker/jobs/, exactly
// like ai-triage.ts's `import { prisma } from "../../db"`.
import { randomBytes } from "node:crypto";
import { prisma } from "../../db";
import { chunkMarkdown } from "../../rag/chunk-markdown";
import { embed } from "../../rag/embed";
import { embeddingModelId, isEmbeddingConfigured, resolveEmbeddingProvider } from "../../rag/settings";
import { toVectorLiteral } from "../../rag/vector-literal";
import { scopedDb } from "../../scoped-db";

export async function kbEmbedArticleHandler(data: { articleId: string }): Promise<void> {
  const article = await prisma.kbArticle.findUnique({ where: { id: data.articleId } });
  if (!article) return;

  const db = scopedDb(article.organizationId);

  // Config gate: KB embedding is NOT gated on the `aiEnabled` chat toggle — embedding
  // infrastructure is independent of the chat kill switch. A missing/incomplete embedding
  // provider config is an operator problem, not a retryable transient error, so this sets
  // FAILED and returns (no throw -> no pg-boss retry).
  if (!(await isEmbeddingConfigured(db))) {
    await db.kbArticle.update({ where: { id: article.id }, data: { embeddingStatus: "FAILED" } });
    return;
  }

  try {
    const chunks = chunkMarkdown(article.bodyMarkdown);

    if (chunks.length === 0) {
      const resolved = await resolveEmbeddingProvider(db);
      await db.kbChunk.deleteMany({ where: { articleId: article.id } });
      await db.kbArticle.update({
        where: { id: article.id },
        data: { embeddingStatus: "COMPLETED", embeddingModel: embeddingModelId(resolved) },
      });
      return;
    }

    // ONE batched embed call for all of this article's chunks (Pitfall 7) — never per-chunk.
    const { embeddings, embeddingModel } = await embed(
      db,
      chunks.map((c) => c.content),
    );

    // Atomic chunk swap: delete + all inserts are all-or-nothing on ONE connection (the
    // transaction callback's `tx` client), never the bare prisma/scopedDb `db` client directly
    // for these two steps — a half-applied swap would leave stale or duplicate chunks.
    await db.$transaction(async (tx) => {
      await tx.kbChunk.deleteMany({ where: { articleId: article.id } });

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const id = randomBytes(16).toString("hex");
        await tx.$executeRaw`
          INSERT INTO "KbChunk"
            ("id", "organizationId", "articleId", "position", "headingPath", "content", "embeddingModel", "embedding", "createdAt")
          VALUES
            (${id}, ${article.organizationId}, ${article.id}, ${i}, ${chunk.headingPath}, ${chunk.content}, ${embeddingModel},
             ${toVectorLiteral(embeddings[i])}::vector, now())
        `;
      }
    });

    await db.kbArticle.update({
      where: { id: article.id },
      data: { embeddingStatus: "COMPLETED", embeddingModel },
    });
  } catch (err) {
    await db.kbArticle.update({ where: { id: article.id }, data: { embeddingStatus: "FAILED" } });
    throw err; // pg-boss retries — mirrors ai-triage/email-outbound-send
  }
}
