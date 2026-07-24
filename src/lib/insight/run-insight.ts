// Composes every Wave-2 insight module into one idempotent recompute (LOCKED per 06-CONTEXT.md
// "Job & trigger": re-entrant on pg-boss retry — recompute every section and overwrite the row).
// Relative imports only (no `@/`) — worker-bundleable via esbuild, mirroring kb-embed-article.ts.
import { Prisma } from "../../generated/prisma/client";
import { recordAuditEvent } from "../audit/record-audit-event";
import { prisma } from "../db";
import { complete } from "../llm/complete";
import { getLlmSettings, isProviderConfigured } from "../llm/settings";
import { embeddingModelId, isEmbeddingConfigured, resolveEmbeddingProvider } from "../rag/settings";
import { scopedDb } from "../scoped-db";
import { leaderCluster } from "./cluster";
import {
  CLUSTER_LABEL_SYSTEM_PROMPT,
  ClusterLabelsResultSchema,
  type ClusterLabelsResult,
  buildClusterLabelPrompt,
} from "./cluster-label-prompt";
import { buildTicketExcerpt } from "./excerpt";
import { nearestKbChunk, scoreGap } from "./kb-gap";
import {
  INSIGHT_NARRATIVE_SYSTEM_PROMPT,
  InsightNarrativeSchema,
  type InsightNarrative,
  buildNarrativePrompt,
} from "./narrative-prompt";
import { computeSlaCsat } from "./sla-csat";
import {
  type PeriodTicket,
  readCachedEmbeddings,
  readPeriodTickets,
  writeNewEmbeddings,
} from "./ticket-embeddings";
import type {
  InsightRunParams,
  NearestArticle,
  StoredCluster,
  StoredKbGap,
  StoredNarrative,
  TicketCitation,
} from "./types";
import { computeVolumeDrivers, periodMath } from "./volume-drivers";

const MAX_CITATIONS = 10; // per cluster/gap, for display
const EXAMPLES_PER_CLUSTER = 3; // representative excerpts sent to the labeling LLM

// nullable Json write helper: Prisma rejects a bare `null` for a Json? column; use DbNull.
function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as unknown as Prisma.InputJsonValue);
}

/**
 * Full recompute of one InsightRun (idempotent on pg-boss retry — Pitfall 3: recompute every
 * section, overwrite the row; the TicketEmbedding cache's ON CONFLICT makes re-embedding cheap).
 * Never partial-resumes. Called by insightRunHandler after it marks the row RUNNING.
 */
export async function runInsight(insightRunId: string): Promise<void> {
  const run = await prisma.insightRun.findUnique({ where: { id: insightRunId } });
  if (!run) return;

  const orgId = run.organizationId;
  const db = scopedDb(orgId);
  const params = run.params as unknown as InsightRunParams;
  const { periodStart, periodEnd } = run;
  const { previousPeriodStart, previousPeriodEnd } = periodMath(run.periodDays, periodEnd);

  // ---- Always-on SQL sections (AIDA-13: computed even when AI is off) ----
  const volumeDrivers = await computeVolumeDrivers(
    orgId,
    periodStart,
    periodEnd,
    previousPeriodStart,
    previousPeriodEnd,
  );
  const slaCsat = await computeSlaCsat(db, orgId, periodStart, periodEnd);

  // ---- AI gates (Pitfall 6: re-check at execution time, not enqueue time) ----
  const aiSetting = await db.setting.findFirst({ where: { key: "aiEnabled" } });
  const aiEnabled = aiSetting?.value === "true";
  const llmConfigured = isProviderConfigured(await getLlmSettings(db));
  const embeddingConfigured = await isEmbeddingConfigured(db);
  const canCluster = aiEnabled && llmConfigured && embeddingConfigured;
  const canNarrate = aiEnabled && llmConfigured;

  // ---- Period tickets loaded once (count + citations + excerpts) ----
  const periodTickets = await readPeriodTickets(orgId, periodStart, periodEnd);
  const ticketCount = periodTickets.length;
  const ticketById = new Map<string, PeriodTicket>(periodTickets.map((t) => [t.ticketId, t]));

  let clusters: StoredCluster[] | null = null;
  let kbGaps: StoredKbGap[] | null = null;
  let narrative: StoredNarrative | null = null;
  let embeddingModel: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;

  if (canCluster) {
    const resolved = await resolveEmbeddingProvider(db);
    embeddingModel = embeddingModelId(resolved);

    // Embed only the period tickets missing a cached vector (idempotent on retry).
    const cachedBefore = await readCachedEmbeddings(orgId, embeddingModel, periodStart, periodEnd);
    const cachedIds = new Set(cachedBefore.map((c) => c.id));
    const missing = periodTickets
      .filter((t) => !cachedIds.has(t.ticketId))
      .map((t) => ({
        ticketId: t.ticketId,
        text: buildTicketExcerpt(t.subject, t.firstBody, params.excerptCharLimit),
      }));
    if (missing.length > 0) {
      await writeNewEmbeddings(db, orgId, embeddingModel, missing, params.embedBatchSize);
    }

    // Cluster the full, now-complete, ordered vector set.
    const items = await readCachedEmbeddings(orgId, embeddingModel, periodStart, periodEnd);
    const rawClusters = leaderCluster(items, params.clusterSimilarityThreshold);
    const reported = rawClusters
      .filter((c) => c.memberIds.length >= params.minClusterSize)
      .slice(0, params.maxClustersRendered);

    if (reported.length > 0) {
      // Fenced example excerpts for labeling — first N members per cluster.
      const labelInput = reported.map((c) => ({
        index: c.index,
        exampleExcerpts: c.memberIds.slice(0, EXAMPLES_PER_CLUSTER).map((id) => {
          const t = ticketById.get(id);
          return t ? buildTicketExcerpt(t.subject, t.firstBody, params.excerptCharLimit) : "";
        }),
      }));

      const labelRes = await complete<ClusterLabelsResult>(db, {
        system: CLUSTER_LABEL_SYSTEM_PROMPT,
        prompt: buildClusterLabelPrompt(labelInput),
        schema: ClusterLabelsResultSchema,
        schemaName: "ClusterLabelsResult",
        maxOutputTokens: 2048,
      });
      provider = labelRes.provider;
      model = labelRes.model;
      await recordAuditEvent(db, {
        actionType: "INSIGHT_CLUSTER_LABELS",
        ticketId: null,
        provider: labelRes.provider,
        model: labelRes.model,
        input: labelRes.redactedPrompt,
        output: JSON.stringify(labelRes.output),
      });

      const labelByIndex = new Map(labelRes.output.clusters.map((l) => [l.clusterIndex, l]));

      // Zero-KB shortcut: no chunks org-wide => every reported cluster is a gap (LOCKED).
      const kbChunkCount = await db.kbChunk.count({ where: { embeddingModel } });

      clusters = [];
      kbGaps = [];
      for (const c of reported) {
        const label = labelByIndex.get(c.index);
        const citations: TicketCitation[] = c.memberIds
          .map((id) => ticketById.get(id))
          .filter((t): t is PeriodTicket => !!t)
          .slice(0, MAX_CITATIONS)
          .map((t) => ({ ticketId: t.ticketId, number: t.number, subject: t.subject }));

        clusters.push({
          index: c.index,
          label: label?.label ?? "Unlabeled cluster",
          description: label?.description ?? "",
          size: c.memberIds.length,
          citations,
        });

        let coverage: number | null;
        let nearestArticle: NearestArticle | null;
        let isGap: boolean;
        if (kbChunkCount === 0) {
          coverage = null;
          nearestArticle = null;
          isGap = true;
        } else {
          const nearest = await nearestKbChunk(orgId, c.centroid, embeddingModel);
          const scored = scoreGap(nearest, params.gapThreshold);
          coverage = scored.coverage;
          isGap = scored.isGap;
          nearestArticle = nearest
            ? { articleId: nearest.articleId, title: nearest.title, slug: nearest.slug, score: 1 - nearest.distance }
            : null;
        }
        if (isGap) {
          kbGaps.push({
            clusterIndex: c.index,
            label: label?.label ?? "Unlabeled cluster",
            size: c.memberIds.length,
            coverage,
            nearestArticle,
            citations,
          });
        }
      }
    } else {
      clusters = [];
      kbGaps = [];
    }
  }

  if (canNarrate) {
    const narrRes = await complete<InsightNarrative>(db, {
      system: INSIGHT_NARRATIVE_SYSTEM_PROMPT,
      prompt: buildNarrativePrompt(volumeDrivers, slaCsat),
      schema: InsightNarrativeSchema,
      schemaName: "InsightNarrative",
      maxOutputTokens: 512,
    });
    provider = provider ?? narrRes.provider;
    model = model ?? narrRes.model;
    narrative = { summary: narrRes.output.summary };
    await recordAuditEvent(db, {
      actionType: "INSIGHT_SUMMARY",
      ticketId: null,
      provider: narrRes.provider,
      model: narrRes.model,
      input: narrRes.redactedPrompt,
      output: JSON.stringify(narrRes.output),
    });
  }

  // ---- Persist all sections in one write (Pitfall 5: reader casts back). ----
  await prisma.insightRun.update({
    where: { id: insightRunId },
    data: {
      volumeDrivers: jsonOrNull(volumeDrivers),
      slaCsat: jsonOrNull(slaCsat),
      clusters: jsonOrNull(clusters),
      kbGaps: jsonOrNull(kbGaps),
      narrative: jsonOrNull(narrative),
      ticketCount,
      embeddingModel,
      provider,
      model,
    },
  });
}
