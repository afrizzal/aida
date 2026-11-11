"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { membershipEnded, nullOnAccessDenied } from "@/lib/membership";
import { getSessionActor } from "@/lib/session";
import { type SnoozeErrorCode, snoozeTicket, wakeTicket } from "@/lib/tickets/snooze";

type SnoozeActionResult = { ok: true } | { ok: false; error: SnoozeErrorCode };

/**
 * Snoozes the ticket until the given UTC instant (AIDA-54, D-12). The control converts the
 * viewer's local choice to an ISO string; the service checks membership and every bound inside
 * its transaction. The list and the ticket page are revalidated only after success.
 */
export async function snoozeTicketAction(
  ticketId: string,
  untilIso: string,
): Promise<SnoozeActionResult> {
  const until = typeof untilIso === "string" ? new Date(untilIso) : new Date(Number.NaN);
  if (Number.isNaN(until.getTime())) return { ok: false, error: "INVALID" };
  const actor = await getSessionActor().catch(nullOnAccessDenied);
  if (!actor) return membershipEnded();
  const result = await snoozeTicket(prisma, actor, { ticketId, until });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/tickets");
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/** Wakes a snoozed ticket by hand (D-12), in any status. */
export async function wakeTicketAction(ticketId: string): Promise<SnoozeActionResult> {
  const actor = await getSessionActor().catch(nullOnAccessDenied);
  if (!actor) return membershipEnded();
  const result = await wakeTicket(prisma, actor, { ticketId });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/tickets");
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}
