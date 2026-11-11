"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { membershipEnded, nullOnAccessDenied } from "@/lib/membership";
import { getSessionActor } from "@/lib/session";
import { type MergeErrorCode, mergeTickets } from "@/lib/tickets/merge";
import type { RelationLabel } from "@/lib/tickets/relation-pairs";

type MergeActionResult = { ok: true; targetId: string } | { ok: false; error: MergeErrorCode };

/**
 * Merges the source ticket into the target (AIDA-53). The dialog is a convenience: the service
 * checks membership and every D-07 rule inside its transaction. Both ticket pages and the list
 * are revalidated only after success.
 *
 * reviewedLinkLabel is the link the confirm step named (its label from the source's side, or
 * null for none). The service compares it with the current link under its row locks and
 * refuses with LINK_CHANGED when they differ (Codex diff round 2, R2-1). Any other value,
 * including a missing one, never equals a current link, so it is refused the same way.
 */
export async function mergeTicketAction(
  sourceTicketId: string,
  targetTicketId: string,
  reviewedLinkLabel: RelationLabel | null,
): Promise<MergeActionResult> {
  const actor = await getSessionActor().catch(nullOnAccessDenied);
  if (!actor) return membershipEnded();
  const result = await mergeTickets(prisma, actor, {
    sourceTicketId,
    targetTicketId,
    reviewedLinkLabel,
  });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/tickets/${result.sourceTicketId}`);
  revalidatePath(`/tickets/${result.targetTicketId}`);
  revalidatePath("/tickets");
  return { ok: true, targetId: result.targetTicketId };
}
