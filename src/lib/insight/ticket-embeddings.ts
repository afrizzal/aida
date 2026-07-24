import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import { embed } from "../rag/embed";
import type { SettingDb } from "../rag/settings";
import { toVectorLiteral } from "../rag/vector-literal";

export interface PeriodTicket {
  ticketId: string;
  number: number;
  subject: string;
  firstBody: string | null; // first PUBLIC INBOUND message body, or null
}

/**
 * All tickets created in [start, end) for this org, each with its first PUBLIC INBOUND
 * message body (for excerpt building) and number/subject (for citations). Ordered
 * createdAt ASC, id ASC — the exact order leaderCluster requires. Explicit organizationId
 * filter (scopedDb does NOT intercept $queryRaw).
 */
export async function readPeriodTickets(
  orgId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<PeriodTicket[]> {
  return prisma.$queryRaw<PeriodTicket[]>`
    SELECT t.id AS "ticketId", t.number, t.subject,
      (SELECT m."bodyMarkdown" FROM "Message" m
         WHERE m."ticketId" = t.id AND m.direction = 'INBOUND' AND m.visibility = 'PUBLIC'
         ORDER BY m."createdAt" ASC LIMIT 1) AS "firstBody"
    FROM "Ticket" t
    WHERE t."organizationId" = ${orgId}
      AND t."createdAt" >= ${periodStart}
      AND t."createdAt" < ${periodEnd}
    ORDER BY t."createdAt" ASC, t.id ASC;
  `;
}

interface TicketEmbeddingRow {
  ticketId: string;
  embedding: string; // pgvector text form "[0.1,0.2,...]"
}

/**
 * Cached embeddings for period tickets, joined to Ticket for the period filter + sort key.
 * Returns createdAt ASC, id ASC ordered rows (leaderCluster precondition). embedding::text
 * is valid JSON-array syntax, so JSON.parse is a safe dependency-free parser.
 */
export async function readCachedEmbeddings(
  orgId: string,
  embeddingModel: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ id: string; embedding: number[] }[]> {
  const rows = await prisma.$queryRaw<TicketEmbeddingRow[]>`
    SELECT te."ticketId", te.embedding::text AS embedding
    FROM "TicketEmbedding" te
    JOIN "Ticket" t ON t.id = te."ticketId"
    WHERE te."organizationId" = ${orgId}
      AND te."embeddingModel" = ${embeddingModel}
      AND t."createdAt" >= ${periodStart}
      AND t."createdAt" < ${periodEnd}
    ORDER BY t."createdAt" ASC, t.id ASC;
  `;
  return rows.map((r) => ({ id: r.ticketId, embedding: JSON.parse(r.embedding) as number[] }));
}

/**
 * Embeds the given {ticketId, text} rows in batches of batchSize and inserts a
 * TicketEmbedding cache row per ticket. ON CONFLICT ("ticketId","embeddingModel") DO NOTHING
 * makes this idempotent on pg-boss retry (Pitfall 3 — a prior attempt's rows are kept, only
 * genuinely-missing vectors are paid for). Uses the embeddingModel embed() actually returns
 * per batch (asserted equal to the passed one). Looped single-row insert inside a transaction
 * — the proven kb-embed-article.ts pattern.
 */
export async function writeNewEmbeddings(
  db: SettingDb,
  orgId: string,
  embeddingModel: string,
  rows: { ticketId: string; text: string }[],
  batchSize: number,
): Promise<void> {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const { embeddings, embeddingModel: got } = await embed(
      db,
      batch.map((r) => r.text),
    );
    if (got !== embeddingModel) {
      throw new Error(`Embedding model drift: expected ${embeddingModel}, got ${got}`);
    }
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < batch.length; i++) {
        const id = randomBytes(16).toString("hex");
        await tx.$executeRaw`
          INSERT INTO "TicketEmbedding" ("id", "organizationId", "ticketId", "embeddingModel", "embedding", "createdAt")
          VALUES (${id}, ${orgId}, ${batch[i].ticketId}, ${embeddingModel}, ${toVectorLiteral(embeddings[i])}::vector, now())
          ON CONFLICT ("ticketId", "embeddingModel") DO NOTHING;
        `;
      }
    });
  }
}
