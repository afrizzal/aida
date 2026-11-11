"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { membershipEnded, nullOnAccessDenied } from "@/lib/membership";
import { getSessionActor } from "@/lib/session";
import {
  type AgentTicketInput,
  type AgentTicketResult,
  createAgentTicket,
} from "@/lib/tickets/create-agent-ticket";

/**
 * Server Action backing the agent "New Ticket" flow. Delegates to createAgentTicket(), which
 * checks the actor's member row before any write (D-01, Codex diff critique round 2 E1) and then
 * calls createTicket() — the ONE code path that creates tickets (also used by the public web
 * form) — never a second ticket-creation call site. A removed member gets
 * `{ ok: false, error: "MEMBERSHIP_ENDED" }`, which the dialog shows.
 */
export async function createTicketAction(input: AgentTicketInput): Promise<AgentTicketResult> {
  const actor = await getSessionActor().catch(nullOnAccessDenied);
  if (!actor) return membershipEnded();
  const result = await createAgentTicket(prisma, actor, input);
  if (result.ok) revalidatePath("/tickets");
  return result;
}
