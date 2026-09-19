"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionActor } from "@/lib/session";
import { addRelation, type RelationErrorCode, removeRelation } from "@/lib/tickets/relations";

type RelationActionResult = { ok: true } | { ok: false; error: RelationErrorCode };

/**
 * Links this ticket to another one with one of the LINK_CHOICES labels (AIDA-52). The service
 * checks membership and both tickets inside its transaction; both ticket pages are revalidated
 * only after success.
 */
export async function addRelationAction(
  ticketId: string,
  otherTicketId: string,
  choice: string,
): Promise<RelationActionResult> {
  const actor = await getSessionActor();
  const result = await addRelation(prisma, actor, { ticketId, otherTicketId, choice });
  if (!result.ok) return { ok: false, error: result.error };
  for (const id of result.ticketIds) revalidatePath(`/tickets/${id}`);
  return { ok: true };
}

/** Removes one relation seen from this ticket; both ticket pages are revalidated after success. */
export async function removeRelationAction(
  ticketId: string,
  relationId: string,
): Promise<RelationActionResult> {
  const actor = await getSessionActor();
  const result = await removeRelation(prisma, actor, { ticketId, relationId });
  if (!result.ok) return { ok: false, error: result.error };
  for (const id of result.ticketIds) revalidatePath(`/tickets/${id}`);
  return { ok: true };
}
