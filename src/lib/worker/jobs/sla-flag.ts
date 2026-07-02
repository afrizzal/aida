import { prisma } from "../../db";

// One-directional (sets only). Flags CLEARED by Server Actions on first-response/resolve — plan 09.
export async function slaFlagHandler(_data?: unknown): Promise<void> {
  const now = new Date();

  // Pass 1: breach (implies at-risk) — monotonic, one-directional
  await prisma.$executeRaw`
    UPDATE "Ticket"
    SET "isBreached" = true, "isAtRisk" = true
    WHERE "isBreached" = false
      AND status NOT IN ('RESOLVED', 'CLOSED')
      AND (
        ("firstRespondedAt" IS NULL AND "firstResponseDueAt" < ${now})
        OR ("resolvedAt" IS NULL AND "resolutionDueAt" < ${now})
      )
  `;

  // Pass 2: at-risk — proportional threshold (due within 20% of the original target duration)
  await prisma.$executeRaw`
    UPDATE "Ticket"
    SET "isAtRisk" = true
    WHERE "isAtRisk" = false
      AND status NOT IN ('RESOLVED', 'CLOSED')
      AND (
        ("firstRespondedAt" IS NULL AND "firstResponseDueAt" > ${now}
          AND "firstResponseDueAt" - ${now} <= ("firstResponseTargetMinutes" * 0.2) * interval '1 minute')
        OR ("resolvedAt" IS NULL AND "resolutionDueAt" > ${now}
          AND "resolutionDueAt" - ${now} <= ("resolutionTargetMinutes" * 0.2) * interval '1 minute')
      )
  `;
}
