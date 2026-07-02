import type { TicketPriority } from "@/generated/prisma/client";
import type { scopedDb } from "@/lib/scoped-db";

export type SlaTargets = {
  firstResponseMinutes: number;
  resolutionMinutes: number;
};

// Illustrative-but-final seeded defaults (D-14): 24/7 wall-clock minutes.
// URGENT 1h/8h, HIGH 4h/24h, NORMAL 8h/48h, LOW 24h/72h (first-response/resolution).
export const DEFAULT_SLA_TARGETS: Record<TicketPriority, SlaTargets> = {
  URGENT: { firstResponseMinutes: 60, resolutionMinutes: 480 },
  HIGH: { firstResponseMinutes: 240, resolutionMinutes: 1440 },
  NORMAL: { firstResponseMinutes: 480, resolutionMinutes: 2880 },
  LOW: { firstResponseMinutes: 1440, resolutionMinutes: 4320 },
};

// Narrowed to just the delegate this module needs so both a full scopedDb()
// client and an in-flight interactive-$transaction `tx` client (which lacks
// $connect/$disconnect/$extends/$transaction) satisfy this type structurally.
type SlaDb = Pick<ReturnType<typeof scopedDb>, "slaPolicy">;

/**
 * Reads the org's admin-configured SlaPolicy for `priority` (scopedDb auto-scopes org);
 * falls back to DEFAULT_SLA_TARGETS when no policy row exists yet.
 */
export async function getSlaTargets(db: SlaDb, priority: TicketPriority): Promise<SlaTargets> {
  const policy = await db.slaPolicy.findFirst({ where: { priority } });
  if (policy) {
    return {
      firstResponseMinutes: policy.firstResponseTargetMinutes,
      resolutionMinutes: policy.resolutionTargetMinutes,
    };
  }
  return DEFAULT_SLA_TARGETS[priority];
}

/**
 * Computes absolute due timestamps from a starting instant + duration minutes.
 * 24/7 calendar-clock math (D-13) — business-hours calendars can replace this
 * function's internals later without any schema change.
 */
export function computeDueTimestamps(
  from: Date,
  firstResponseMinutes: number,
  resolutionMinutes: number,
): { firstResponseDueAt: Date; resolutionDueAt: Date } {
  return {
    firstResponseDueAt: new Date(from.getTime() + firstResponseMinutes * 60_000),
    resolutionDueAt: new Date(from.getTime() + resolutionMinutes * 60_000),
  };
}
