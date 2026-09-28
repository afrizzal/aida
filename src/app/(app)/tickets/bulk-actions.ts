"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { getSessionActor } from "@/lib/session";
import { runTicketMutation, type TicketMutationResult } from "@/lib/tickets/mutations";

// Ticket, user and tag ids are cuid or uuid strings; the bound only refuses absurd input early.
const id = z.string().min(1).max(128);

// The five bulk operations (D-10). addTagByName is not accepted: bulk adds existing
// organization tags only (UI-SPEC Assumption 5).
const bulkOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assign"), assigneeId: id.nullable() }),
  // A state of the actor's organization (Phase 12.1): the service share-locks it and refuses a
  // missing, soft-deleted or foreign state with STATE_NOT_FOUND. The old status payload fails
  // this schema and returns INVALID.
  z.object({ kind: z.literal("state"), stateId: id }),
  z.object({ kind: z.literal("priority"), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]) }),
  z.object({ kind: z.literal("addTag"), tagId: id }),
  z.object({ kind: z.literal("removeTag"), tagId: id }),
]);

const bulkInputSchema = z.object({ ticketIds: z.array(id), op: bulkOpSchema });

export type BulkUpdateInput = z.infer<typeof bulkInputSchema>;

/**
 * Applies one operation to the selected tickets (AIDA-48): at most 100 unique ids, all or
 * nothing, one TicketAuditEvent per ticket sharing one batchId. Input is untrusted and parsed
 * with zod; the service checks the actor's membership, that every ticket belongs to the
 * organization, the assignee and the tag. The inbox is revalidated only after success, and the
 * service result is returned unchanged so the bulk bar maps each error code to its copy.
 */
export async function bulkUpdateTickets(input: BulkUpdateInput): Promise<TicketMutationResult> {
  const parsed = bulkInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };

  const actor = await getSessionActor();
  const result = await runTicketMutation({
    actor,
    ticketIds: parsed.data.ticketIds,
    op: parsed.data.op,
    mode: "bulk",
  });

  if (result.ok) revalidatePath("/tickets", "layout");
  return result;
}
