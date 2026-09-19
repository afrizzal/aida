"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionActor } from "@/lib/session";
import { type MergeErrorCode, mergeTickets } from "@/lib/tickets/merge";

type MergeActionResult = { ok: true; targetId: string } | { ok: false; error: MergeErrorCode };

/**
 * Merges the source ticket into the target (AIDA-53). The dialog is a convenience: the service
 * checks membership and every D-07 rule inside its transaction. Both ticket pages and the list
 * are revalidated only after success.
 */
export async function mergeTicketAction(
  sourceTicketId: string,
  targetTicketId: string,
): Promise<MergeActionResult> {
  const actor = await getSessionActor();
  const result = await mergeTickets(prisma, actor, { sourceTicketId, targetTicketId });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/tickets/${result.sourceTicketId}`);
  revalidatePath(`/tickets/${result.targetTicketId}`);
  revalidatePath("/tickets");
  return { ok: true, targetId: result.targetTicketId };
}
