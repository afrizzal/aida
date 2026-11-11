"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { membershipEnded, nullOnAccessDenied } from "@/lib/membership";
import {
  createSavedView,
  deleteSavedView,
  type SavedViewDeleteResult,
  type SavedViewInput,
  type SavedViewWriteResult,
  updateSavedView,
} from "@/lib/saved-views/service";
import { getSessionActor } from "@/lib/session";

// Saved-view server actions (AIDA-47). Input is untrusted: the service validates names,
// visibility and filters itself and decides every permission against the database. The
// sidebar lives in the (app) layout, so the whole layout is revalidated, and only after the
// service returned ok.

/** Creates a view owned by the session user in the active organization. */
export async function createSavedViewAction(input: SavedViewInput): Promise<SavedViewWriteResult> {
  const actor = await getSessionActor().catch(nullOnAccessDenied);
  if (!actor) return membershipEnded();
  const result = await createSavedView(prisma, actor, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Edits a view the session user may edit (D-04); only its owner changes visibility. */
export async function updateSavedViewAction(
  id: string,
  input: SavedViewInput,
): Promise<SavedViewWriteResult> {
  const actor = await getSessionActor().catch(nullOnAccessDenied);
  if (!actor) return membershipEnded();
  const result = await updateSavedView(prisma, actor, id, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Deletes a view the session user may edit (D-04). */
export async function deleteSavedViewAction(id: string): Promise<SavedViewDeleteResult> {
  const actor = await getSessionActor().catch(nullOnAccessDenied);
  if (!actor) return membershipEnded();
  const result = await deleteSavedView(prisma, actor, id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
