// Deterministic, LLM-free SQL analytics: top categories/tags/companies with a delta vs the
// previous equal-length period. Every raw query below carries an explicit organizationId
// filter — scopedDb's groupBy/$queryRaw are NOT auto-scoped (06-RESEARCH.md Pitfall 1), and the
// tag/company queries JOIN across relations that Prisma groupBy cannot express anyway.

import { prisma } from "../db";
import type { VolumeDriverRow, VolumeDrivers } from "./types";

export function periodMath(periodDays: number, now: Date = new Date()) {
  const periodEnd = now;
  const periodStart = new Date(periodEnd.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const previousPeriodEnd = periodStart;
  const previousPeriodStart = new Date(
    previousPeriodEnd.getTime() - periodDays * 24 * 60 * 60 * 1000,
  );
  return { periodStart, periodEnd, previousPeriodStart, previousPeriodEnd };
}

interface KeyCountRow {
  key: string;
  count: number;
}

async function categoryCounts(orgId: string, start: Date, end: Date): Promise<KeyCountRow[]> {
  return prisma.$queryRaw<KeyCountRow[]>`
    SELECT COALESCE("triageCategory"::text, 'UNTRIAGED') AS key, COUNT(*)::int AS count
    FROM "Ticket"
    WHERE "organizationId" = ${orgId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
    GROUP BY "triageCategory"
    ORDER BY count DESC;
  `;
}

async function tagCounts(
  orgId: string,
  start: Date,
  end: Date,
  limit = 10,
): Promise<KeyCountRow[]> {
  return prisma.$queryRaw<KeyCountRow[]>`
    SELECT t.name AS key, COUNT(*)::int AS count
    FROM "TicketTag" tt
    JOIN "Tag" t ON t.id = tt."tagId"
    JOIN "Ticket" tk ON tk.id = tt."ticketId"
    WHERE tk."organizationId" = ${orgId} AND tk."createdAt" >= ${start} AND tk."createdAt" < ${end}
    GROUP BY t.name
    ORDER BY count DESC
    LIMIT ${limit};
  `;
}

async function companyCounts(
  orgId: string,
  start: Date,
  end: Date,
  limit = 10,
): Promise<KeyCountRow[]> {
  return prisma.$queryRaw<KeyCountRow[]>`
    SELECT COALESCE(c.company, 'Unknown') AS key, COUNT(*)::int AS count
    FROM "Ticket" tk
    JOIN "Contact" c ON c.id = tk."contactId"
    WHERE tk."organizationId" = ${orgId} AND tk."createdAt" >= ${start} AND tk."createdAt" < ${end}
    GROUP BY COALESCE(c.company, 'Unknown')
    ORDER BY count DESC
    LIMIT ${limit};
  `;
}

/** Pure zip: join current + previous KeyCountRow lists by key, compute delta, keep current-desc order. */
export function zipDelta(current: KeyCountRow[], previous: KeyCountRow[]): VolumeDriverRow[] {
  const prevMap = new Map(previous.map((r) => [r.key, r.count]));
  return current.map((r) => {
    const previousCount = prevMap.get(r.key) ?? 0;
    return { key: r.key, count: r.count, previousCount, delta: r.count - previousCount };
  });
}

export async function computeVolumeDrivers(
  orgId: string,
  periodStart: Date,
  periodEnd: Date,
  previousPeriodStart: Date,
  previousPeriodEnd: Date,
): Promise<VolumeDrivers> {
  const [catCur, catPrev, tagCur, tagPrev, coCur, coPrev] = await Promise.all([
    categoryCounts(orgId, periodStart, periodEnd),
    categoryCounts(orgId, previousPeriodStart, previousPeriodEnd),
    tagCounts(orgId, periodStart, periodEnd),
    tagCounts(orgId, previousPeriodStart, previousPeriodEnd),
    companyCounts(orgId, periodStart, periodEnd),
    companyCounts(orgId, previousPeriodStart, previousPeriodEnd),
  ]);
  return {
    byCategory: zipDelta(catCur, catPrev),
    byTag: zipDelta(tagCur, tagPrev),
    byCompany: zipDelta(coCur, coPrev),
  };
}
