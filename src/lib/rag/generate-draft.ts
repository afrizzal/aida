// generateDraftReply(orgId, ticketId) — the draft orchestrator: embed the retrieval query,
// retrieve org-scoped KB chunks, apply a CODE-LEVEL groundedness gate (Success Criterion 4 —
// never a fabricated citation), and only when relevant content exists, call the existing
// complete() port and record a DRAFT_GENERATED audit event. Mirrors src/lib/triage/run-triage.ts's
// load-then-scopedDb + complete() + recordAuditEvent orchestration shape.
//
// Relative imports for the lib pieces (scopedDb/recordAuditEvent), mirroring run-triage.ts.
import { recordAuditEvent } from "../audit/record-audit-event";
import { complete } from "../llm/complete";
import { scopedDb } from "../scoped-db";
import {
  buildDraftUserPrompt,
  buildRetrievalQueryText,
  DRAFT_SYSTEM_PROMPT,
  NO_RELEVANT_CONTENT_MESSAGE,
} from "./draft-prompt";
import { type DraftResult, DraftResultSchema } from "./draft-schema";
import { embed } from "./embed";
import { retrieveRelevantChunks } from "./retrieve";

// Tunable constant (mirrors POISON_THRESHOLD's "named, tunable, no migration needed" pattern).
// pgvector cosine distance: 0 = identical, 2 = opposite. Chunks beyond this are excluded from
// "relevant" — if NONE survive, the groundedness gate below skips the LLM call entirely.
const MAX_COSINE_DISTANCE = 0.5;

export interface ResolvedCitation {
  marker: string;
  chunkId: string;
  articleId: string;
  title: string;
  slug: string;
  headingPath: string | null;
}

export interface GenerateDraftResult extends DraftResult {
  retrievedCount: number;
  citationsResolved: ResolvedCitation[];
}

export async function generateDraftReply(
  orgId: string,
  ticketId: string,
): Promise<GenerateDraftResult> {
  const db = scopedDb(orgId);

  const ticket = await db.ticket.findFirst({ where: { id: ticketId } });
  if (!ticket) throw new Error("Ticket not found");

  const latestInbound = await db.message.findFirst({
    where: { ticketId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
  });

  const queryText = buildRetrievalQueryText(ticket, latestInbound ?? undefined);
  const { embeddings, embeddingModel } = await embed(db, [queryText]);
  const chunks = await retrieveRelevantChunks(orgId, embeddings[0], embeddingModel, 5);
  const relevant = chunks.filter((c) => c.distance <= MAX_COSINE_DISTANCE);

  // GROUNDEDNESS GATE (Success Criterion 4): a code-level guarantee, not just a prompted LLM
  // self-report. Zero relevant chunks -> deterministic "no relevant content" result, NO LLM call,
  // NO fabricated citation. The audit trail stays complete even on this skip-the-LLM path.
  if (relevant.length === 0) {
    const zeroResult: DraftResult = {
      grounded: false,
      draftMarkdown: NO_RELEVANT_CONTENT_MESSAGE,
      citations: [],
    };

    await recordAuditEvent(db, {
      actionType: "DRAFT_GENERATED",
      ticketId,
      provider: "none",
      model: "none",
      input: "no relevant KB content retrieved for this query", // short, non-sensitive marker
      output: JSON.stringify(zeroResult),
    });

    return { ...zeroResult, retrievedCount: chunks.length, citationsResolved: [] };
  }

  const { output, redactedPrompt, provider, model } = await complete<DraftResult>(db, {
    system: DRAFT_SYSTEM_PROMPT,
    prompt: buildDraftUserPrompt(queryText, relevant),
    schema: DraftResultSchema,
    schemaName: "DraftResult",
    maxOutputTokens: 3072,
  });

  // Resolve each returned citation's chunkId against the retrieved set — drop any citation
  // referencing a chunkId the model wasn't actually given (it must not cite a source outside
  // what was provided).
  const relevantById = new Map(relevant.map((c) => [c.id, c]));
  const citationsResolved: ResolvedCitation[] = output.citations.flatMap((citation) => {
    const chunk = relevantById.get(citation.chunkId);
    if (!chunk) return [];
    return [
      {
        marker: citation.marker,
        chunkId: citation.chunkId,
        articleId: chunk.articleId,
        title: chunk.title,
        slug: chunk.slug,
        headingPath: chunk.headingPath,
      },
    ];
  });

  await recordAuditEvent(db, {
    actionType: "DRAFT_GENERATED",
    ticketId,
    provider,
    model,
    input: redactedPrompt, // D-13 — the REDACTED prompt, never raw ticket text
    output: JSON.stringify(output),
  });

  return { ...output, retrievedCount: chunks.length, citationsResolved };
}
