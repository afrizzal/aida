// Org-scoped + embeddingModel-filtered raw-SQL top-1 KNN lookup of the nearest KbChunk to a
// cluster centroid (mirrors src/lib/rag/retrieve.ts's exact query shape with topK reduced to 1).
// Relative imports only — worker-bundleable (this module is called from the insight-run job).
import { prisma } from "../db";
import { toVectorLiteral } from "../rag/vector-literal";

export interface NearestKbMatch {
  chunkId: string;
  articleId: string;
  title: string;
  slug: string;
  distance: number; // pgvector cosine distance: 0 = identical, up to 2 = opposite
}

export async function nearestKbChunk(
  orgId: string,
  centroid: number[],
  embeddingModel: string,
): Promise<NearestKbMatch | null> {
  const vec = toVectorLiteral(centroid);
  const rows = await prisma.$queryRaw<NearestKbMatch[]>`
    SELECT c.id AS "chunkId", c."articleId", a.title, a.slug,
           (c.embedding <=> ${vec}::vector) AS distance
    FROM "KbChunk" c
    JOIN "KbArticle" a ON a.id = c."articleId"
    WHERE c."organizationId" = ${orgId}
      AND c."embeddingModel" = ${embeddingModel}
    ORDER BY c.embedding <=> ${vec}::vector
    LIMIT 1;
  `;
  return rows[0] ?? null;
}

/** coverage = 1 - bestDistance. null nearest (zero KB chunks org-wide) => always a gap. */
export function scoreGap(
  nearest: NearestKbMatch | null,
  gapThreshold: number,
): { coverage: number | null; isGap: boolean } {
  if (!nearest) return { coverage: null, isGap: true };
  const coverage = 1 - nearest.distance;
  return { coverage, isGap: coverage < gapThreshold };
}
