// Single source of truth for the shapes persisted into InsightRun's Json? columns.
// The orchestrator (run-insight.ts) writes these; the /insights UI casts raw Prisma
// JsonValue back to them on read (Prisma type-erases Json columns — Pitfall 5).
// No imports: keep this dependency-free so both worker-bundled and app code can use it.

/** Stored verbatim in InsightRun.params for reproducibility (same data + same params => identical run). */
export interface InsightRunParams {
  clusterSimilarityThreshold: number;
  minClusterSize: number;
  gapThreshold: number;
  excerptCharLimit: number;
  embedBatchSize: number;
  maxClustersRendered: number;
}

/** One cited ticket link (rendered as /tickets/{ticketId}). */
export interface TicketCitation {
  ticketId: string;
  number: number;
  subject: string;
}

/** A reported recurring-issue cluster (size >= minClusterSize), with its AI label + cited members. */
export interface StoredCluster {
  index: number;
  label: string;
  description: string;
  size: number;
  citations: TicketCitation[];
}

/** The nearest existing KB article to a cluster centroid (null when the org has zero embedded KB chunks). */
export interface NearestArticle {
  articleId: string;
  title: string;
  slug: string;
  score: number; // coverage = 1 - cosineDistance
}

/** A detected KB gap: a reported cluster whose best KB coverage < gapThreshold (or no KB at all). */
export interface StoredKbGap {
  clusterIndex: number;
  label: string;
  size: number;
  coverage: number | null; // null => org has zero embedded KB chunks
  nearestArticle: NearestArticle | null;
  citations: TicketCitation[];
}

/** One row of a volume-driver breakdown with delta vs the previous equal-length period. */
export interface VolumeDriverRow {
  key: string; // category name / tag name / company name
  count: number;
  previousCount: number;
  delta: number; // count - previousCount
}

export interface VolumeDrivers {
  byCategory: VolumeDriverRow[];
  byTag: VolumeDriverRow[];
  byCompany: VolumeDriverRow[];
}

export interface SlaCsatSummary {
  sla: {
    total: number;
    breached: number;
    atRiskOnly: number; // isAtRisk && !isBreached (Pitfall 4)
    breachRate: number; // breached / total, 0 when total === 0
    avgFirstResponseSeconds: number | null;
    avgResolutionSeconds: number | null;
  };
  csat: {
    responseCount: number;
    averageScore: number | null; // null when responseCount === 0
    distribution: { score: number; count: number }[]; // scores 1..5, always length 5
  };
}

/** The single AI-written narrative sentence-set (null when AI is off). */
export interface StoredNarrative {
  summary: string;
}
