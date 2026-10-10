// Phase 12.2, Codex diff critique round 2 (R2D-2): the two "Propose KB article…" entry points, the
// ticket page's menu item (src/app/(app)/tickets/[id]/page.tsx) and the inbox bulk bar
// (src/app/(app)/tickets/ticket-list-panel.tsx), read the actor's role with the conservative
// membership rule of run decision K59: admin only when EVERY member row of the user in the
// organization is owner or admin. The member table has no unique key on (organizationId, userId)
// until owner item 12.2-o4, so one user can hold an admin row and a plain member row.
//
// Both server components are called as the product runs them, on a real Postgres through
// Testcontainers, and the isAdmin and aiEnabled props they hand to TicketMetaHeader and
// BulkActionBar are read from the returned element tree. Doubles: the request headers and Better
// Auth's session read (the session source of src/lib/session.ts), as in
// kb-proposal-reader-isolation.test.ts. The server still decides on every request; these flags
// only hide or explain the entry.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The signed-in user and active organization the session double returns. */
const sessionEnv = vi.hoisted(() => ({
  actor: null as null | { userId: string; orgId: string },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        sessionEnv.actor
          ? {
              user: { id: sessionEnv.actor.userId },
              session: { activeOrganizationId: sessionEnv.actor.orgId },
            }
          : null,
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import TicketDetailPage from "@/app/(app)/tickets/[id]/page";
import { BulkActionBar } from "@/app/(app)/tickets/bulk-action-bar";
import { TicketListPanel } from "@/app/(app)/tickets/ticket-list-panel";
import { TicketMetaHeader } from "@/components/tickets/ticket-meta-header";
import { prisma } from "@/lib/db";
import { seedOrgWithMembers, seedResolvedTicket } from "../support/kb-proposal-fixtures";

beforeEach(() => {
  sessionEnv.actor = null;
});

type Order = "admin row first" | "member row first";
const ORDERS: readonly Order[] = ["admin row first", "member row first"];

/**
 * An organization with AI on, an owner, one resolved ticket and one user who holds TWO member
 * rows: `firstRole` inserted by the fixture, then `secondRole` with an id that sorts after the
 * fixture's random UUID. The signed-in actor is that user.
 */
async function seedTwoRows(firstRole: "admin" | "member", secondRole: "admin" | "member") {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", firstRole]);
  const user = users[1];
  await prisma.member.create({
    data: {
      id: `z-r2d2-${user.memberId}`,
      organizationId: orgId,
      userId: user.id,
      role: secondRole,
      createdAt: new Date(),
    },
  });
  await prisma.setting.create({ data: { organizationId: orgId, key: "aiEnabled", value: "true" } });
  const ticket = await seedResolvedTicket(orgId);
  sessionEnv.actor = { userId: user.id, orgId };
  return { orgId, ticketId: ticket.id };
}

function seedMixed(order: Order) {
  return order === "admin row first"
    ? seedTwoRows("admin", "member")
    : seedTwoRows("member", "admin");
}

/** Every element of `type` in a returned element tree (children and element-valued props). */
function findElements(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isValidElement(value)) return;
    const element = value as ReactElement<Record<string, unknown>>;
    if (element.type === type) found.push(element);
    for (const prop of Object.values(element.props)) visit(prop);
  };
  visit(node);
  return found;
}

async function bulkBarFlags() {
  const tree = await TicketListPanel({ searchParams: {} });
  const bars = findElements(tree, BulkActionBar);
  expect(bars).toHaveLength(1);
  return { isAdmin: bars[0].props.isAdmin, aiEnabled: bars[0].props.aiEnabled };
}

async function ticketPageFlags(ticketId: string) {
  const tree = await TicketDetailPage({
    params: Promise.resolve({ id: ticketId }),
    searchParams: Promise.resolve({}),
  });
  const headers = findElements(tree, TicketMetaHeader);
  expect(headers).toHaveLength(1);
  return { isAdmin: headers[0].props.isAdmin, aiEnabled: headers[0].props.aiEnabled };
}

describe("R2D-2: the Propose KB article entry flags use the conservative membership read (K59)", () => {
  for (const order of ORDERS) {
    it(`inbox bulk bar: an admin row and a member row (${order}) is not admin`, async () => {
      await seedMixed(order);
      expect(await bulkBarFlags()).toEqual({ isAdmin: false, aiEnabled: false });
    });

    it(`ticket page menu: an admin row and a member row (${order}) is not admin`, async () => {
      const { ticketId } = await seedMixed(order);
      expect(await ticketPageFlags(ticketId)).toEqual({ isAdmin: false, aiEnabled: false });
    });
  }

  it("two admin rows: both entry points show the entry, with AI on", async () => {
    const { ticketId } = await seedTwoRows("admin", "admin");
    expect(await bulkBarFlags()).toEqual({ isAdmin: true, aiEnabled: true });
    expect(await ticketPageFlags(ticketId)).toEqual({ isAdmin: true, aiEnabled: true });
  });

  it("a role change on one row is seen on the next render", async () => {
    const { orgId, ticketId } = await seedTwoRows("admin", "admin");
    const actor = sessionEnv.actor;
    if (!actor) throw new Error("no actor");
    const [row] = await prisma.member.findMany({
      where: { organizationId: orgId, userId: actor.userId },
      orderBy: { id: "asc" },
      take: 1,
    });
    await prisma.member.update({ where: { id: row.id }, data: { role: "member" } });
    expect(await bulkBarFlags()).toEqual({ isAdmin: false, aiEnabled: false });
    expect(await ticketPageFlags(ticketId)).toEqual({ isAdmin: false, aiEnabled: false });
    await prisma.member.update({ where: { id: row.id }, data: { role: "admin" } });
    expect(await bulkBarFlags()).toEqual({ isAdmin: true, aiEnabled: true });
    expect(await ticketPageFlags(ticketId)).toEqual({ isAdmin: true, aiEnabled: true });
  });
});
