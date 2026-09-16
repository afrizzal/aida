"use server";

import { revalidatePath } from "next/cache";
import type {
  CustomFieldType,
  TicketPriority,
  TicketStatus,
  TriageCategory,
  TriageSentiment,
} from "@/generated/prisma/client";
import { getBoss } from "@/lib/queue/boss-client";
import type { GenerateDraftResult } from "@/lib/rag/generate-draft";
import { generateDraftReply as runGenerateDraft } from "@/lib/rag/generate-draft";
import { getScopedDb, getSessionActor } from "@/lib/session";
import {
  runTicketMutation,
  type TicketMutationErrorCode,
  type TicketMutationResult,
} from "@/lib/tickets/mutations";

type MutationActionResult = { ok: boolean; error?: TicketMutationErrorCode };

/**
 * The shared tail of the five single-ticket wrappers (D-02): each wrapper calls
 * runTicketMutation with mode single, and this revalidates the ticket page only after the
 * service returned success, never inside its transaction (D-08).
 */
function afterSingle(ticketId: string, result: TicketMutationResult): MutationActionResult {
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/**
 * Moves a ticket to a new status through the one ticket mutation service (D-02, D-08), which
 * checks the actor's membership, stamps or clears `resolvedAt` and the SLA flags exactly as
 * before, and writes one TicketAuditEvent. The page is revalidated only after success.
 */
export async function changeStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<MutationActionResult> {
  const actor = await getSessionActor();
  const result = await runTicketMutation({
    actor,
    ticketIds: [ticketId],
    op: { kind: "status", status },
    mode: "single",
  });
  return afterSingle(ticketId, result);
}

/**
 * Changes priority through the one ticket mutation service (D-02, D-08). The service writes the
 * same seven fields as before (priority, both SLA target minutes from the organization's policy
 * or the defaults, both due timestamps recomputed from createdAt, and cleared isAtRisk and
 * isBreached, Pitfall 5) and one TicketAuditEvent. Re-applying the current priority is a no-op.
 */
export async function changePriority(
  ticketId: string,
  priority: TicketPriority,
): Promise<MutationActionResult> {
  const actor = await getSessionActor();
  const result = await runTicketMutation({
    actor,
    ticketIds: [ticketId],
    op: { kind: "priority", priority },
    mode: "single",
  });
  return afterSingle(ticketId, result);
}

/**
 * Re-enqueues a FAILED outbound public reply's SMTP send (D-21 "Retry" affordance). Verifies
 * the message exists in this org before touching it (scopedDb-scoped findFirst).
 */
export async function retryOutboundSend(messageId: string): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  const message = await db.message.findFirst({ where: { id: messageId } });
  if (!message) return { ok: false };

  try {
    await db.message.update({ where: { id: messageId }, data: { deliveryStatus: "QUEUED" } });

    const boss = await getBoss();
    await boss.send("email-outbound-send", { messageId });
  } catch {
    return { ok: false };
  }

  revalidatePath(`/tickets/${message.ticketId}`);
  return { ok: true };
}

/**
 * Manually re-runs AI triage on a ticket (D-06). Sets triageStatus back to PENDING and
 * re-enqueues the ai-triage job — the worker's aiTriageHandler re-checks the aiEnabled kill
 * switch before ever calling the LLM, so this is safe to call even if AI has since been
 * disabled (it will simply no-op in the worker).
 */
export async function rerunTriage(ticketId: string): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  const ticket = await db.ticket.findFirst({ where: { id: ticketId } });
  if (!ticket) return { ok: false };

  try {
    await db.ticket.update({ where: { id: ticketId }, data: { triageStatus: "PENDING" } });

    const boss = await getBoss();
    await boss.send("ai-triage", { ticketId });
  } catch {
    return { ok: false };
  }

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/**
 * Generates a grounded, cited draft reply for a ticket (AIDA-16). Any agent may draft — this is
 * advisory copilot output only, gated by the human-approval send flow (no requireOrgAdmin).
 * Returns `{ ok: false }` on any error (e.g. no embedding provider configured) rather than
 * throwing, so the UI can show a soft failure state instead of crashing.
 */
export async function generateDraftReply(
  ticketId: string,
): Promise<{ ok: boolean; draft?: GenerateDraftResult }> {
  const { orgId } = await getScopedDb();

  try {
    const draft = await runGenerateDraft(orgId, ticketId);
    return { ok: true, draft };
  } catch {
    return { ok: false };
  }
}

/**
 * Agent override for the AI-populated triage category (AIDA-14/D-09). A pure field write —
 * category/sentiment/language never affect SLA due timestamps, only priority does (handled by
 * the existing changePriority above), so no SLA recompute happens here.
 */
export async function setTriageCategory(
  ticketId: string,
  category: TriageCategory,
): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  await db.ticket.update({ where: { id: ticketId }, data: { triageCategory: category } });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/** Agent override for the AI-populated triage sentiment (AIDA-14/D-09). Plain field write. */
export async function setTriageSentiment(
  ticketId: string,
  sentiment: TriageSentiment,
): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  await db.ticket.update({ where: { id: ticketId }, data: { triageSentiment: sentiment } });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/**
 * Agent override for the AI-populated triage language (AIDA-14/D-09). Language is ISO 639-1
 * free text; normalised to a 2-char lowercase code, empty input clears it (null).
 */
export async function setTriageLanguage(
  ticketId: string,
  language: string,
): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  const code = language.trim().toLowerCase().slice(0, 2);
  await db.ticket.update({ where: { id: ticketId }, data: { triageLanguage: code || null } });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/**
 * Assigns (or unassigns, when `assigneeId` is null) a ticket through the one ticket mutation
 * service. The assignee must be a member of the organization (D-02), checked inside the
 * service's transaction; otherwise the result is MEMBER_NOT_ACTIVE and nothing changes.
 */
export async function assignTicket(
  ticketId: string,
  assigneeId: string | null,
): Promise<MutationActionResult> {
  const actor = await getSessionActor();
  const result = await runTicketMutation({
    actor,
    ticketIds: [ticketId],
    op: { kind: "assign", assigneeId },
    mode: "single",
  });
  return afterSingle(ticketId, result);
}

/**
 * Adds a tag by name. The service finds or creates the tag inside its own transaction, after
 * the actor's membership check and before the ticket lock (Codex review C1), so a refused
 * request never leaves a new tag behind. This wrapper only forwards the raw name.
 */
export async function addTag(ticketId: string, name: string): Promise<MutationActionResult> {
  const actor = await getSessionActor();
  const result = await runTicketMutation({
    actor,
    ticketIds: [ticketId],
    op: { kind: "addTagByName", name },
    mode: "single",
  });
  return afterSingle(ticketId, result);
}

export async function removeTag(ticketId: string, tagId: string): Promise<MutationActionResult> {
  const actor = await getSessionActor();
  const result = await runTicketMutation({
    actor,
    ticketIds: [ticketId],
    op: { kind: "removeTag", tagId },
    mode: "single",
  });
  return afterSingle(ticketId, result);
}

type CustomFieldWriteValue = string | number | boolean | null;

interface CustomFieldWriteData {
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
}

function buildCustomFieldWriteData(
  type: CustomFieldType,
  value: CustomFieldWriteValue,
): CustomFieldWriteData {
  const data: CustomFieldWriteData = {
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
  };

  switch (type) {
    case "TEXT":
    case "SELECT":
      data.valueText = typeof value === "string" ? value : null;
      break;
    case "NUMBER":
      data.valueNumber = typeof value === "number" ? value : null;
      break;
    case "CHECKBOX":
      data.valueBoolean = typeof value === "boolean" ? value : null;
      break;
    case "DATE":
      data.valueDate = typeof value === "string" && value ? new Date(value) : null;
      break;
  }

  return data;
}

/**
 * Upserts a ticket's CustomFieldValue for a given definition, writing only the typed
 * column matching the definition's type. Uses findFirst + conditional create/update
 * (not upsert) — scopedDb's upsert hook injects organizationId into the top-level
 * `where`, which Prisma rejects for a compound-unique-but-not-single-field where clause.
 */
export async function setCustomFieldValue(
  ticketId: string,
  definitionId: string,
  value: CustomFieldWriteValue,
): Promise<{ ok: boolean }> {
  const { db, orgId } = await getScopedDb();

  const definition = await db.customFieldDefinition.findFirst({ where: { id: definitionId } });
  if (!definition) return { ok: false };

  const data = buildCustomFieldWriteData(definition.type, value);

  const existing = await db.customFieldValue.findFirst({
    where: { ticketId, customFieldDefinitionId: definitionId },
  });

  if (existing) {
    await db.customFieldValue.update({ where: { id: existing.id }, data });
  } else {
    await db.customFieldValue.create({
      data: { organizationId: orgId, ticketId, customFieldDefinitionId: definitionId, ...data },
    });
  }

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}
