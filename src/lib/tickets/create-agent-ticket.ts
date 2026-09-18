// The agent "New Ticket" flow behind createTicketAction (tickets/new-ticket-action.ts). Kept out
// of the server action so a test can run it against a real Postgres.
//
// Codex diff critique round 2, E1 (run-loop K31): Phase 11's palette "Create ticket" opens the
// new-ticket dialog, so the actor's member row is checked with findActiveMembership (D-01)
// BEFORE any write. A removed member whose session still carries the organization gets the
// defined MEMBERSHIP_ENDED refusal and no ticket, contact, counter or message row is written.
// The ticket itself is still created by createTicket, the one ticket-creation path.
import type { TicketPriority } from "@/generated/prisma/client";
import { findActiveMembership, type MembershipClient } from "@/lib/membership";
import { createTicket } from "@/lib/tickets/create-ticket";

export interface AgentTicketActor {
  userId: string;
  orgId: string;
}

export interface AgentTicketInput {
  subject: string;
  priority: TicketPriority;
  body: string;
  contactEmail: string;
  contactName?: string;
}

export type AgentTicketResult = { ok: true; id: string } | { ok: false; error: "MEMBERSHIP_ENDED" };

export async function createAgentTicket(
  client: MembershipClient,
  actor: AgentTicketActor,
  input: AgentTicketInput,
): Promise<AgentTicketResult> {
  if (!(await findActiveMembership(client, actor.userId, actor.orgId))) {
    return { ok: false, error: "MEMBERSHIP_ENDED" };
  }

  const ticket = await createTicket(actor.orgId, {
    subject: input.subject,
    priority: input.priority,
    body: input.body,
    contact: { email: input.contactEmail, name: input.contactName || null },
    direction: "OUTBOUND",
    authorUserId: actor.userId,
  });
  return { ok: true, id: ticket.id };
}
