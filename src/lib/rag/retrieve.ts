// Org-scoped + embeddingModel-filtered raw-SQL KNN retrieval over KbChunk (mirrors
// src/lib/tickets/search.ts's explicit-organizationId raw-SQL discipline exactly — scopedDb does
// NOT intercept $queryRaw, so this filter is mandatory, not optional).
//
// App-side only (imports @/lib/db) — this module is called from the generateDraftReply Server
// Action, never from the worker.
import { prisma } from "@/lib/db";
import { toVectorLiteral } from "./vector-literal";

export interface RetrievedChunk {
  id: string;
  articleId: string;
  content: string;
  headingPath: string | null;
  title: string;
  slug: string;
  distance: number;
}

export async function retrieveRelevantChunks(
  orgId: string,
  queryEmbedding: number[],
  embeddingModel: string,
  topK = 5,
): Promise<RetrievedChunk[]> {
  const vec = toVectorLiteral(queryEmbedding);
  return prisma.$queryRaw<RetrievedChunk[]>`
    SELECT c.id, c."articleId", c.content, c."headingPath", a.title, a.slug,
           (c.embedding <=> ${vec}::vector) AS distance
    FROM "KbChunk" c
    JOIN "KbArticle" a ON a.id = c."articleId"
    WHERE c."organizationId" = ${orgId}
      AND c."embeddingModel" = ${embeddingModel}
    ORDER BY c.embedding <=> ${vec}::vector
    LIMIT ${topK};
  `;
}
