"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/authz";
import { getScopedDb } from "@/lib/session";

/**
 * Renames a tag globally within the workspace. Admin-gated.
 */
export async function renameTag(id: string, name: string): Promise<{ ok: boolean }> {
  await requireOrgAdmin();
  const { db } = await getScopedDb();

  const trimmed = name.trim();
  if (!trimmed) return { ok: false };

  await db.tag.update({ where: { id }, data: { name: trimmed } });

  revalidatePath("/settings/tags");
  return { ok: true };
}

/**
 * Deletes a tag globally. TicketTag rows cascade via schema onDelete: Cascade, so this
 * removes the tag from every ticket that had it. Admin-gated.
 */
export async function deleteTag(id: string): Promise<{ ok: boolean }> {
  await requireOrgAdmin();
  const { db } = await getScopedDb();

  await db.tag.delete({ where: { id } });

  revalidatePath("/settings/tags");
  return { ok: true };
}
