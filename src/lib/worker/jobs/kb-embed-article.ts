// Worker job: chunks + batch-embeds a KB article and writes its KbChunk vector rows
// (auto-enqueued after createKbArticle()/updateKbArticle() commit, or by 05-05's re-embed-all
// admin action via enqueueReembed()). Registered by src/lib/worker/index.ts (mirrors
// ai-triage.ts's split between handler file and registration).
//
// Concurrency (Phase 12.2, reviews R2-1, P6 and R3-1). The queue has no singleton policy, so two
// jobs for one article can run at once (an edit or re-embed-all while a job runs, and the
// proposal path's "Retry indexing"). Every write of this job happens in a transaction that first
// locks the article row (lockArticleForJob: SELECT ... FOR UPDATE on id and organizationId), then
// re-reads what the job's work depends on.
//
// Protected:
//   - Two jobs for one article never leave two sets of chunks: the article row lock serializes
//     the swap (delete, inserts and COMPLETED run in one transaction under that lock).
//   - A job whose text is no longer the article's text never swaps and never writes a status
//     (a newer job owns the article).
//   - A job whose vectors came from a model other than the one configured when it holds the
//     article lock never swaps and never writes a status, so after a model change followed by
//     re-embed-all an old-model job cannot overwrite the new vectors or write COMPLETED with the
//     old model id.
//   - FAILED is written only on a PENDING article that still has the job's text and model
//     (markFailedIfCurrent, the job's only FAILED writer), so a failing job never overturns
//     COMPLETED.
//
// Not protected:
//   - The Setting rows are not locked, so a model change that commits after the job's model check
//     and before its commit still lets that swap store the old model's vectors, tagged with the
//     old model id. Retrieval filters chunks by the configured model (src/lib/rag/retrieve.ts), so
//     they are not used, and the job that re-embed-all sends after the change replaces them.
//   - A model change without re-embed-all leaves an article whose job skipped at its status
//     (normally PENDING) until re-embed-all or Retry indexing sends a job under the new model.
//
// Lock order: the article row, then its chunks (the same order as every other writer of KbChunk).
// No unique index on KbChunk (articleId, position) is added: the row lock serializes the swap,
// and the phase's only migration is plan 12.2-01's. The manual KB path and re-embed-all run this
// same job and gain the same protection. No log line carries article text.
//
// Worker-bundleable (esbuild) — every import below is relative to src/lib/worker/jobs/, exactly
// like ai-triage.ts's `import { prisma } from "../../db"`.
import { randomBytes } from "node:crypto";
import { prisma } from "../../db";
import { chunkMarkdown, type MarkdownChunk } from "../../rag/chunk-markdown";
import { embed } from "../../rag/embed";
import { embeddingModelId, resolveEmbeddingProvider, type SettingDb } from "../../rag/settings";
import { toVectorLiteral } from "../../rag/vector-literal";
import { scopedDb } from "../../scoped-db";

/** Any transaction client that runs tagged raw SQL (the hooks record its backend PID). */
export interface KbEmbedTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/** Test seam of the embed job (reviews R2-1, P6, R3-1). Production code never sets it. */
export interface KbEmbedArticleObserver {
  /** Awaited after the embed call returned, before the swap transaction opens (no tx open). */
  afterEmbed?(): Promise<void> | void;
  /** Awaited as the first statement of the swap transaction, before the article row lock. */
  onSwapStart?(tx: KbEmbedTx): Promise<void> | void;
  /** Awaited right after the swap transaction's row lock and re-read, before any write. */
  afterArticleLock?(tx: KbEmbedTx): Promise<void> | void;
  /** Awaited as the first statement of markFailedIfCurrent's transaction, before its row lock. */
  onFailStart?(tx: KbEmbedTx): Promise<void> | void;
}

let kbEmbedArticleObserver: KbEmbedArticleObserver | null = null;

/**
 * Test seam only (shape of setOutboundSendObserverForTests): lets a race test hold a job at a
 * defined point and record its transaction's PID. null clears it. Production never sets it, so
 * with no observer an unchanged article is embedded exactly as before.
 */
export function setKbEmbedArticleObserverForTests(observer: KbEmbedArticleObserver | null): void {
  kbEmbedArticleObserver = observer;
}

type ScopedDb = ReturnType<typeof scopedDb>;

interface JobArticle {
  id: string;
  organizationId: string;
}

interface LockedArticle {
  bodyMarkdown: string;
  embeddingStatus: string;
}

/**
 * Locks the article row for this job's transaction and returns the columns the job re-checks,
 * or null when the row no longer exists. Raw SQL carries explicit id and organizationId terms
 * (scopedDb does not intercept $queryRaw).
 */
async function lockArticleForJob(
  tx: KbEmbedTx,
  organizationId: string,
  articleId: string,
): Promise<LockedArticle | null> {
  const rows = await tx.$queryRaw<LockedArticle[]>`
    SELECT "bodyMarkdown", "embeddingStatus"::text AS "embeddingStatus"
    FROM "KbArticle"
    WHERE "id" = ${articleId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * The embedding model id configured now (`provider:model`), or null when nothing is configured.
 * The provider's error text is never logged. On a scoped transaction client it reads only this
 * organization's settings (the scopedDb query extension applies inside its $transaction).
 */
async function configuredModelId(client: SettingDb): Promise<string | null> {
  try {
    return embeddingModelId(await resolveEmbeddingProvider(client));
  } catch {
    return null;
  }
}

/**
 * The job's only FAILED writer (review R3-1). Writes FAILED only when the row still exists, is
 * PENDING, still holds the text the job read and the configured model is still `model` (null at
 * the configuration gate). Otherwise another job completed or failed the article, a newer text
 * owns it, or the model changed (review P6), and nothing is written.
 */
async function markFailedIfCurrent(
  db: ScopedDb,
  article: JobArticle,
  readText: string,
  model: string | null,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (kbEmbedArticleObserver?.onFailStart) await kbEmbedArticleObserver.onFailStart(tx);
    const locked = await lockArticleForJob(tx, article.organizationId, article.id);
    if (!locked) return;
    if (locked.embeddingStatus !== "PENDING") return;
    if (locked.bodyMarkdown !== readText) return;
    if ((await configuredModelId(tx)) !== model) return;
    // The scoped transaction client adds the organizationId term.
    await tx.kbArticle.updateMany({
      where: { id: article.id, bodyMarkdown: readText, embeddingStatus: "PENDING" },
      data: { embeddingStatus: "FAILED" },
    });
  });
}

/**
 * The locked chunk swap (review R2-1), used by the zero-chunk path and the embedded path: under
 * the article row lock, skip every write when the row is gone, its text is not the text the job
 * chunked, or the configured model is not the model of the vectors (review P6); otherwise delete
 * the chunks, insert the new ones and set COMPLETED, all in this one transaction.
 */
async function swapChunks(
  db: ScopedDb,
  article: JobArticle,
  readText: string,
  model: string,
  chunks: MarkdownChunk[],
  embeddings: number[][],
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (kbEmbedArticleObserver?.onSwapStart) await kbEmbedArticleObserver.onSwapStart(tx);
    const locked = await lockArticleForJob(tx, article.organizationId, article.id);
    if (kbEmbedArticleObserver?.afterArticleLock) {
      await kbEmbedArticleObserver.afterArticleLock(tx);
    }
    if (!locked) return;
    if (locked.bodyMarkdown !== readText) return; // a newer job owns the article (R2-1)
    if ((await configuredModelId(tx)) !== model) return; // the model changed (P6)

    await tx.kbChunk.deleteMany({ where: { articleId: article.id } });

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const id = randomBytes(16).toString("hex");
      await tx.$executeRaw`
        INSERT INTO "KbChunk"
          ("id", "organizationId", "articleId", "position", "headingPath", "content", "embeddingModel", "embedding", "createdAt")
        VALUES
          (${id}, ${article.organizationId}, ${article.id}, ${i}, ${chunk.headingPath}, ${chunk.content}, ${model},
           ${toVectorLiteral(embeddings[i])}::vector, now())
      `;
    }

    await tx.kbArticle.update({
      where: { id: article.id },
      data: { embeddingStatus: "COMPLETED", embeddingModel: model },
    });
  });
}

export async function kbEmbedArticleHandler(data: { articleId: string }): Promise<void> {
  const article = await prisma.kbArticle.findUnique({ where: { id: data.articleId } });
  if (!article) return;

  const db = scopedDb(article.organizationId);
  const job: JobArticle = { id: article.id, organizationId: article.organizationId };
  // The text this job chunks and embeds; every write is checked against it under the row lock.
  const readText = article.bodyMarkdown;

  // Config gate: KB embedding is NOT gated on the `aiEnabled` chat toggle — embedding
  // infrastructure is independent of the chat kill switch. A missing/incomplete embedding
  // provider config is an operator problem, not a retryable transient error, so this marks
  // FAILED (when still current) and returns (no throw -> no pg-boss retry).
  // The job's model (review P6): the configured model id now, then the model embed() reports.
  let jobModel: string | null = await configuredModelId(db);
  if (jobModel === null) {
    await markFailedIfCurrent(db, job, readText, null);
    return;
  }

  try {
    const chunks = chunkMarkdown(readText);

    if (chunks.length === 0) {
      await swapChunks(db, job, readText, jobModel, [], []);
      return;
    }

    // ONE batched embed call for all of this article's chunks (Pitfall 7) — never per-chunk.
    const { embeddings, embeddingModel } = await embed(
      db,
      chunks.map((c) => c.content),
    );
    jobModel = embeddingModel; // the model that produced the vectors

    if (kbEmbedArticleObserver?.afterEmbed) await kbEmbedArticleObserver.afterEmbed();

    await swapChunks(db, job, readText, jobModel, chunks, embeddings);
  } catch (err) {
    try {
      await markFailedIfCurrent(db, job, readText, jobModel);
    } catch {
      // The original error is the one pg-boss must see; a failed status write never replaces it.
    }
    throw err; // pg-boss retries — mirrors ai-triage/email-outbound-send
  }
}
