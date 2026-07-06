"use server";

import { revalidatePath } from "next/cache";
import type { CustomFieldType, TicketPriority, TicketStatus } from "@/generated/prisma/client";
import { getBoss } from "@/lib/queue/boss-client";
import { getScopedDb } from "@/lib/session";
import { computeDueTimestamps, getSlaTargets } from "@/lib/tickets/sla";

const TERMINAL_STATUSES: readonly TicketStatus[] = ["RESOLVED", "CLOSED"];

/**
 * Moves a ticket to a new status. Resolving/closing stamps `resolvedAt` and clears the
 * at-risk/breach flags in the SAME write (the sla-flag worker job is one-directional —
 * it only ever sets these flags, never clears them). Reopening (moving off a terminal
 * status) clears `resolvedAt` so the resolution SLA clock resumes.
 */
export async function changeStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  await db.ticket.update({
    where: { id: ticketId },
    data: TERMINAL_STATUSES.includes(status)
      ? { status, resolvedAt: new Date(), isAtRisk: false, isBreached: false }
      : { status, resolvedAt: null },
  });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/**
 * Changes priority and recomputes SLA due timestamps from the ticket's original
 * createdAt. CRITICAL (Pitfall 5): a priority change moves the due timestamps — a
 * downgrade pushes them into the future — and the SLA-flag job never clears flags, only
 * sets them. This same write MUST also reset isAtRisk/isBreached, otherwise a ticket
 * flagged at-risk/breached under the old (higher) priority keeps showing a stale
 * "At risk"/"Overdue" chip even though its new due date is safely in the future.
 */
export async function changePriority(
  ticketId: string,
  priority: TicketPriority,
): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  const ticket = await db.ticket.findFirst({ where: { id: ticketId } });
  if (!ticket) return { ok: false };

  const targets = await getSlaTargets(db, priority);
  const { firstResponseDueAt, resolutionDueAt } = computeDueTimestamps(
    ticket.createdAt,
    targets.firstResponseMinutes,
    targets.resolutionMinutes,
  );

  await db.ticket.update({
    where: { id: ticketId },
    data: {
      priority,
      firstResponseTargetMinutes: targets.firstResponseMinutes,
      resolutionTargetMinutes: targets.resolutionMinutes,
      firstResponseDueAt,
      resolutionDueAt,
      isAtRisk: false,
      isBreached: false,
    },
  });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/**
 * Re-enqueues a FAILED outbound public reply's SMTP send (D-21 "Retry" affordance). Verifies
 * the message exists in this org before touching it (scopedDb-scoped findFirst).
 */
export async function retryOutboundSend(messageId: string): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  const message = await db.message.findFirst({ where: { id: messageId } });
  if (!message) return { ok: false };

  await db.message.update({ where: { id: messageId }, data: { deliveryStatus: "QUEUED" } });

  const boss = await getBoss();
  await boss.send("email-outbound-send", { messageId });

  revalidatePath(`/tickets/${message.ticketId}`);
  return { ok: true };
}

/** Assigns (or unassigns, when `assigneeId` is null) a ticket to a workspace member. */
export async function assignTicket(
  ticketId: string,
  assigneeId: string | null,
): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  await db.ticket.update({ where: { id: ticketId }, data: { assigneeId } });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/**
 * Finds-or-creates a Tag by name, then links it via a nested write scoped through the
 * parent Ticket (TicketTag is a pure join table, intentionally excluded from scopedDb's
 * DOMAIN_MODELS — see src/lib/scoped-db.ts).
 */
export async function addTag(ticketId: string, name: string): Promise<{ ok: boolean }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false };

  const { db, orgId } = await getScopedDb();

  let tag = await db.tag.findFirst({ where: { name: trimmed } });
  if (!tag) {
    tag = await db.tag.create({ data: { organizationId: orgId, name: trimmed } });
  }

  await db.ticket.update({
    where: { id: ticketId },
    data: { tags: { create: { tagId: tag.id } } },
  });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

export async function removeTag(ticketId: string, tagId: string): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  await db.ticket.update({
    where: { id: ticketId },
    data: { tags: { delete: { ticketId_tagId: { ticketId, tagId } } } },
  });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
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
