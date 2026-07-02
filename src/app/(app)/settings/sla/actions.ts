"use server";

import { revalidatePath } from "next/cache";
import type { TicketPriority } from "@/generated/prisma/client";
import { requireOrgAdmin } from "@/lib/authz";
import { getScopedDb } from "@/lib/session";

interface SlaTargetInput {
  priority: TicketPriority;
  firstResponseHours: number;
  resolutionHours: number;
}

/**
 * Persists per-priority SLA first-response/resolution targets (stored as minutes).
 * Admin-gated (SECURITY.md: server-side authz on every mutating settings action).
 * Uses findFirst + conditional create/update (not upsert) — scopedDb's upsert hook
 * injects organizationId into the top-level `where`, which Prisma rejects for a
 * compound-unique-but-not-single-field where clause on upsert.
 */
export async function saveSlaTargets(input: SlaTargetInput[]): Promise<{ ok: boolean }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();

  for (const { priority, firstResponseHours, resolutionHours } of input) {
    const firstResponseTargetMinutes = Math.round(firstResponseHours * 60);
    const resolutionTargetMinutes = Math.round(resolutionHours * 60);

    const existing = await db.slaPolicy.findFirst({ where: { priority } });

    if (existing) {
      await db.slaPolicy.update({
        where: { id: existing.id },
        data: { firstResponseTargetMinutes, resolutionTargetMinutes },
      });
    } else {
      await db.slaPolicy.create({
        data: {
          organizationId: orgId,
          priority,
          firstResponseTargetMinutes,
          resolutionTargetMinutes,
        },
      });
    }
  }

  revalidatePath("/settings/sla");
  return { ok: true };
}
