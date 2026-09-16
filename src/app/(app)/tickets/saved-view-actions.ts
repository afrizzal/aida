"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  createSavedView,
  type SavedViewInput,
  type SavedViewWriteResult,
} from "@/lib/saved-views/service";
import { getSessionActor } from "@/lib/session";

// Saved-view server actions (AIDA-47). Input is untrusted: the service validates names,
// visibility and filters itself and decides every permission against the database. The
// sidebar lives in the (app) layout, so the whole layout is revalidated, and only after the
// service returned ok.

/** Creates a view owned by the session user in the active organization. */
export async function createSavedViewAction(input: SavedViewInput): Promise<SavedViewWriteResult> {
  const actor = await getSessionActor();
  const result = await createSavedView(prisma, actor, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
