"use server";

import { revalidatePath } from "next/cache";
import type { TicketPriority } from "@/generated/prisma/client";
import { getScopedDb } from "@/lib/session";
import { createTicket } from "@/lib/tickets/create-ticket";

interface NewTicketInput {
  subject: string;
  priority: TicketPriority;
  body: string;
  contactEmail: string;
  contactName?: string;
}

/**
 * Server Action backing the agent "New Ticket" flow. Delegates to createTicket() — the
 * ONE code path that creates tickets (also used by the public web form) — never a
 * second ticket-creation call site.
 */
export async function createTicketAction(input: NewTicketInput): Promise<{ id: string }> {
  const { orgId, session } = await getScopedDb();

  const ticket = await createTicket(orgId, {
    subject: input.subject,
    priority: input.priority,
    body: input.body,
    contact: { email: input.contactEmail, name: input.contactName || null },
    direction: "OUTBOUND",
    authorUserId: session.user.id,
  });

  revalidatePath("/tickets");
  return { id: ticket.id };
}
