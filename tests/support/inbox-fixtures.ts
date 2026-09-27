// Test-only seed helpers shared by every Phase 11 integration test. Better Auth's
// organization, user and member models have no @default() on id or createdAt, so every row
// carries explicit values. Each call creates fresh, uniquely named rows so cases stay
// independent.
import { randomUUID } from "node:crypto";
import type { PrismaClient, TicketPriority } from "../../src/generated/prisma/client";
import { prisma as globalPrisma } from "../../src/lib/db";
import { createTicket } from "../../src/lib/tickets/create-ticket";
import {
  type LegacyStatusKey,
  readLegacyStateIds,
  readStateGroups,
} from "../../src/lib/tickets/ticket-states";

export type { LegacyStatusKey };

/**
 * The id of the organization's active state with the given legacy key (one of the five migrated
 * or default states). Throws when that state is soft-deleted.
 */
export async function stateIdFor(orgId: string, key: LegacyStatusKey): Promise<string> {
  const ids = await readLegacyStateIds(globalPrisma, orgId);
  const id = ids[key];
  if (!id) throw new Error(`stateIdFor: no active ${key} state in organization ${orgId}`);
  return id;
}

export interface StateOverrides {
  /** The legacy key of one of the five migrated states (NEW, OPEN, PENDING, RESOLVED, CLOSED). */
  status?: LegacyStatusKey;
  /** A state id of the same organization; wins over status. */
  stateId?: string;
  /** Explicit pause start; when absent it follows the pause invariant below. */
  slaPausedAt?: Date | null;
}

/**
 * Turns state overrides into update data on the pause invariant (D-16): slaPausedAt is set
 * exactly while the ticket is in a PENDING-group state. With an explicit slaPausedAt override that
 * value is written as given. Returns an empty object when no state override is present.
 */
export async function stateUpdateData(
  orgId: string,
  overrides: StateOverrides,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  let stateId = overrides.stateId;
  if (stateId === undefined && overrides.status !== undefined) {
    stateId = await stateIdFor(orgId, overrides.status);
  }
  if (stateId !== undefined) {
    data.stateId = stateId;
    if (overrides.slaPausedAt === undefined) {
      const groups = await readStateGroups(globalPrisma, orgId, [stateId]);
      data.slaPausedAt = groups.get(stateId) === "PENDING" ? now : null;
    }
  }
  if (overrides.slaPausedAt !== undefined) data.slaPausedAt = overrides.slaPausedAt;
  return data;
}

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

export interface SeedTicketOverrides extends StateOverrides {
  resolvedAt?: Date | null;
  assigneeId?: string | null;
  priority?: TicketPriority;
}

/**
 * Creates a ticket through the real createTicket path (unique subject and contact email), then
 * applies the overrides with a direct update on the global client. A status override is the
 * legacy key of one of the five migrated states and is written as that state's id, with
 * slaPausedAt following the pause invariant (see stateUpdateData).
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
  const data: Record<string, unknown> = await stateUpdateData(orgId, overrides);
  if (overrides.resolvedAt !== undefined) data.resolvedAt = overrides.resolvedAt;
  if (overrides.assigneeId !== undefined) data.assigneeId = overrides.assigneeId;
  if (Object.keys(data).length > 0) {
    await globalPrisma.ticket.update({ where: { id: created.id }, data });
  }
  return { id: created.id, number: created.number };
}
