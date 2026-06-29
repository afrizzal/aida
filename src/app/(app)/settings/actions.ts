"use server";

import { revalidatePath } from "next/cache";
import { getScopedDb } from "@/lib/session";

/**
 * Persists the aiEnabled toggle to the org-scoped Setting table via scopedDb.
 * Uses findFirst + conditional create/update to avoid Prisma upsert where-clause
 * constraints with compound unique indexes — scopedDb injects organizationId on all
 * domain model operations, so the Setting is always tenant-scoped. (D-15, D-18)
 */
export async function setAiEnabled(enabled: boolean): Promise<{ ok: boolean }> {
  const { db, orgId } = await getScopedDb();

  const existing = await db.setting.findFirst({ where: { key: "aiEnabled" } });

  if (existing) {
    await db.setting.update({
      where: { id: existing.id },
      data: { value: String(enabled) },
    });
  } else {
    // Include organizationId explicitly — scopedDb also injects it at runtime,
    // but TypeScript requires it here since the Setting schema mandates the field.
    await db.setting.create({
      data: { organizationId: orgId, key: "aiEnabled", value: String(enabled) },
    });
  }

  revalidatePath("/settings");
  return { ok: true };
}
