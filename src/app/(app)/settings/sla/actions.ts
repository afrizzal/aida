"use server";

import { revalidatePath } from "next/cache";
import type { TicketPriority } from "@/generated/prisma/client";
import { requireOrgAdminScope } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getSessionActor } from "@/lib/session";
import { type AutoCloseSaveResult, saveAutoCloseDays } from "@/lib/tickets/auto-close-settings";

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
  const { db, orgId } = await requireOrgAdminScope();

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

/**
 * Saves the auto-close days setting (Phase 11, AIDA-51, D-15). saveAutoCloseDays checks the
 * actor's membership (MEMBERSHIP_ENDED, D-01) and role (owners and admins, NOT_ALLOWED) and
 * validates the value (INVALID); the result is returned unchanged. The page is revalidated only
 * after a successful save.
 */
export async function saveAutoCloseSetting(raw: unknown): Promise<AutoCloseSaveResult> {
  const actor = await getSessionActor();
  const result = await saveAutoCloseDays(prisma, actor, raw);
  if (result.ok) revalidatePath("/settings/sla");
  return result;
}
