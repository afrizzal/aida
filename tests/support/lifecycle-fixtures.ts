// Test-only seed helpers shared by every Phase 12 integration test. Relative imports only.
// Each call creates fresh, uniquely named rows so cases stay independent.
import { randomUUID } from "node:crypto";
import type {
  MessageDirection,
  MessageVisibility,
  PrismaClient,
  TicketRelationType,
  TicketStatus,
} from "../../src/generated/prisma/client";
import { prisma as globalPrisma } from "../../src/lib/db";
import { createTicket } from "../../src/lib/tickets/create-ticket";

export { seedOrgWithMembers, seedTicket } from "./inbox-fixtures";

export interface SeedContactTicketOptions {
  /** Two tickets seeded with the same email share one Contact row. */
  contactEmail: string;
  status?: TicketStatus;
  createdAt?: Date;
}

/**
 * Creates a ticket through the real createTicket path (as seedTicket in inbox-fixtures does),
 * but for a given contact email, so two tickets can share one contact. Overrides are applied
 * with a direct update on the global client.
 */
export async function seedContactTicket(
  orgId: string,
  options: SeedContactTicketOptions,
): Promise<{ id: string; number: number; contactId: string }> {
  const tag = randomUUID();
  const created = await createTicket(orgId, {
    subject: `Lifecycle fixture ${tag}`,
    priority: "NORMAL",
    body: "Fixture body",
    contact: { email: options.contactEmail },
    direction: "INBOUND",
  });
  const data: Record<string, unknown> = {};
  if (options.status !== undefined) data.status = options.status;
  if (options.createdAt !== undefined) data.createdAt = options.createdAt;
  if (Object.keys(data).length > 0) {
    await globalPrisma.ticket.update({ where: { id: created.id }, data });
  }
  const row = await globalPrisma.ticket.findUniqueOrThrow({
    where: { id: created.id },
    select: { contactId: true },
  });
  return { id: created.id, number: created.number, contactId: row.contactId };
}

export interface SeedMessageOptions {
  visibility: MessageVisibility;
  direction: MessageDirection;
  createdAt?: Date;
  mergedFromTicketId?: string | null;
  withAttachment?: boolean;
}

export interface SeededMessage {
  id: string;
  ticketId: string;
  seq: bigint;
  createdAt: Date;
  attachmentId: string | null;
}

/** Inserts one message (and optionally one attachment row) on the ticket. seq comes from the database. */
export async function seedMessage(
  prisma: PrismaClient,
  ticketId: string,
  options: SeedMessageOptions,
): Promise<SeededMessage> {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { organizationId: true },
  });
  const message = await prisma.message.create({
    data: {
      organizationId: ticket.organizationId,
      ticketId,
      direction: options.direction,
      visibility: options.visibility,
      bodyMarkdown: "Fixture message",
      bodyHtml: "<p>Fixture message</p>",
      mergedFromTicketId: options.mergedFromTicketId ?? null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
    select: { id: true, ticketId: true, seq: true, createdAt: true },
  });
  let attachmentId: string | null = null;
  if (options.withAttachment) {
    const attachment = await prisma.attachment.create({
      data: {
        organizationId: ticket.organizationId,
        messageId: message.id,
        storageKey: `fixture/${randomUUID()}`,
        originalFilename: "fixture.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
      },
      select: { id: true },
    });
    attachmentId = attachment.id;
  }
  return { ...message, attachmentId };
}

export interface SeedRelationOptions {
  type: TicketRelationType;
  fromTicketId: string;
  toTicketId: string;
  createdById: string;
}

/** Inserts one TicketRelation row directly (no service rules beyond the database's own). */
export async function seedRelation(
  prisma: PrismaClient,
  orgId: string,
  options: SeedRelationOptions,
): Promise<{ id: string }> {
  return prisma.ticketRelation.create({
    data: { organizationId: orgId, ...options },
    select: { id: true },
  });
}
