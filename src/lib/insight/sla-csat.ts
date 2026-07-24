// SLA breach/at-risk/avg-duration + CSAT avg/distribution/count, computed entirely in org-scoped
// SQL. Counts use scopedDb's auto-scoped count() (safe — count IS in WHERE_SCOPED_OPERATIONS);
// duration averages and the CSAT join use raw SQL with an explicit organizationId filter
// (scopedDb does not intercept $queryRaw — 06-RESEARCH.md Pitfall 1). At-risk-only excludes
// breached tickets (breach implies at-risk — Pitfall 4): breachRate uses isBreached alone.

import { prisma } from "../db";
import type { scopedDb } from "../scoped-db";
import type { SlaCsatSummary } from "./types";

type CountDb = Pick<ReturnType<typeof scopedDb>, "ticket">;

interface DurationRow {
  avgSeconds: number | null;
}

async function avgDurationSeconds(
  orgId: string,
  start: Date,
  end: Date,
  column: "firstRespondedAt" | "resolvedAt",
): Promise<number | null> {
  // Column name is a fixed literal (never user input) — write the two variants explicitly to
  // keep the SQL fully parameterized rather than reaching for Prisma.raw for a column name.
  if (column === "firstRespondedAt") {
    const [row] = await prisma.$queryRaw<DurationRow[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("firstRespondedAt" - "createdAt")))::float AS "avgSeconds"
      FROM "Ticket"
      WHERE "organizationId" = ${orgId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
        AND "firstRespondedAt" IS NOT NULL;
    `;
    return row?.avgSeconds ?? null;
  }
  const [row] = await prisma.$queryRaw<DurationRow[]>`
    SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")))::float AS "avgSeconds"
    FROM "Ticket"
    WHERE "organizationId" = ${orgId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
      AND "resolvedAt" IS NOT NULL;
  `;
  return row?.avgSeconds ?? null;
}

interface CsatAggRow {
  responseCount: number;
  averageScore: number | null;
}
interface CsatDistRow {
  score: number;
  count: number;
}

export async function computeSlaCsat(
  db: CountDb,
  orgId: string,
  start: Date,
  end: Date,
): Promise<SlaCsatSummary> {
  // SLA counts — count() IS auto-scoped by scopedDb, safe to use db here (Pitfall 4 semantics).
  const [total, breached, atRiskOnly] = await Promise.all([
    db.ticket.count({ where: { createdAt: { gte: start, lt: end } } }),
    db.ticket.count({ where: { createdAt: { gte: start, lt: end }, isBreached: true } }),
    db.ticket.count({
      where: { createdAt: { gte: start, lt: end }, isAtRisk: true, isBreached: false },
    }),
  ]);

  const [avgFirstResponseSeconds, avgResolutionSeconds] = await Promise.all([
    avgDurationSeconds(orgId, start, end, "firstRespondedAt"),
    avgDurationSeconds(orgId, start, end, "resolvedAt"),
  ]);

  // CSAT — CsatResponse has no period column of its own; filter by its ticket's createdAt.
  const [agg] = await prisma.$queryRaw<CsatAggRow[]>`
    SELECT COUNT(*)::int AS "responseCount", AVG(cr.score)::float AS "averageScore"
    FROM "CsatResponse" cr
    JOIN "Ticket" t ON t.id = cr."ticketId"
    WHERE cr."organizationId" = ${orgId} AND t."createdAt" >= ${start} AND t."createdAt" < ${end};
  `;
  const distRows = await prisma.$queryRaw<CsatDistRow[]>`
    SELECT cr.score AS score, COUNT(*)::int AS count
    FROM "CsatResponse" cr
    JOIN "Ticket" t ON t.id = cr."ticketId"
    WHERE cr."organizationId" = ${orgId} AND t."createdAt" >= ${start} AND t."createdAt" < ${end}
    GROUP BY cr.score;
  `;
  // Densify 1..5 so the UI always renders five bar rows.
  const distMap = new Map(distRows.map((r) => [r.score, r.count]));
  const distribution = [1, 2, 3, 4, 5].map((score) => ({ score, count: distMap.get(score) ?? 0 }));

  return {
    sla: {
      total,
      breached,
      atRiskOnly,
      breachRate: total > 0 ? breached / total : 0,
      avgFirstResponseSeconds,
      avgResolutionSeconds,
    },
    csat: {
      responseCount: agg?.responseCount ?? 0,
      averageScore: (agg?.responseCount ?? 0) > 0 ? (agg?.averageScore ?? null) : null,
      distribution,
    },
  };
}
