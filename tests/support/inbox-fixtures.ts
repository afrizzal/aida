// Test-only seed helpers shared by every Phase 11 integration test. Better Auth's
// organization, user and member models have no @default() on id or createdAt, so every row
// carries explicit values. Each call creates fresh, uniquely named rows so cases stay
// independent.
import { randomUUID } from "node:crypto";
import type { PrismaClient, TicketPriority, TicketStatus } from "../../src/generated/prisma/client";
import { prisma as globalPrisma } from "../../src/lib/db";
import { createTicket } from "../../src/lib/tickets/create-ticket";

export type MemberRole = "owner" | "admin" | "member";

export interface SeededMember {
  id: string;
  role: MemberRole;
  memberId: string;
}

/** Creates one organization plus one user and member row per role, in the given order. */
export async function seedOrgWithMembers(
  prisma: PrismaClient,
  roles: readonly MemberRole[],
): Promise<{ orgId: string; users: SeededMember[] }> {
  const now = new Date();
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, name: "Inbox Fixture Org", slug: `inbox-fx-${orgId}`, createdAt: now },
  });
  const users: SeededMember[] = [];
  for (const role of roles) {
    const id = randomUUID();
    const memberId = randomUUID();
    await prisma.user.create({
      data: {
        id,
        name: `Fixture ${role}`,
        email: `fx-${id}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.member.create({
      data: { id: memberId, organizationId: orgId, userId: id, role, createdAt: now },
    });
    users.push({ id, role, memberId });
  }
  return { orgId, users };
}

export interface SeedTicketOverrides {
  status?: TicketStatus;
  resolvedAt?: Date | null;
  assigneeId?: string | null;
  priority?: TicketPriority;
}

/**
 * Creates a ticket through the real createTicket path (unique subject and contact email), then
 * applies the overrides with a direct update on the global client.
 */
export async function seedTicket(
  orgId: string,
  overrides: SeedTicketOverrides = {},
): Promise<{ id: string; number: number }> {
  const tag = randomUUID();
  const created = await createTicket(orgId, {
    subject: `Fixture ticket ${tag}`,
    priority: overrides.priority ?? "NORMAL",
    body: "Fixture body",
    contact: { email: `fx-contact-${tag}@example.test` },
    direction: "INBOUND",
  });
  const data: Record<string, unknown> = {};
  if (overrides.status !== undefined) data.status = overrides.status;
  if (overrides.resolvedAt !== undefined) data.resolvedAt = overrides.resolvedAt;
  if (overrides.assigneeId !== undefined) data.assigneeId = overrides.assigneeId;
  if (Object.keys(data).length > 0) {
    await globalPrisma.ticket.update({ where: { id: created.id }, data });
  }
  return { id: created.id, number: created.number };
}
