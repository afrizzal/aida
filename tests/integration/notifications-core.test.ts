// The notification core of Phase 10 (plan 10-04, AIDA-44) on a real Postgres through
// Testcontainers, with no mock of Prisma or the database (D-15, D-28): writes inside the caller's
// transaction, reads scoped to organization and recipient, the unassigned-ticket fallback (V-28),
// preferences and the per-person opt-out (D-22), read state (D-19), and the digest data access of
// store.ts (D-23, C10). Each case seeds fresh organizations.
//
// Race proofs follow V-16: backendPid and waitForBlockedBy from tests/support/lock-wait.ts,
// createObserverClient, settleAll and assertNoDeadlock from tests/support/project-race.ts.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { emitNotifications } from "@/lib/notifications/emit";
import { countUnread, listRecent } from "@/lib/notifications/store";
import { scopedDb } from "@/lib/scoped-db";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

describe("tracer: emit inside a transaction, then count and list (plan 10-04 Task 1)", () => {
  it("an ASSIGNED item emitted inside a scopedDb transaction is counted and listed with its ticket number", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [actor, assignee] = users;
    const ticket = await seedTicket(orgId, { assigneeId: assignee.id });

    const inserted = await scopedDb(orgId).$transaction(
      (tx) =>
        emitNotifications(tx, orgId, [
          {
            recipientUserId: assignee.id,
            actorUserId: actor.id,
            type: "ASSIGNED",
            eventKey: `assigned:${ticket.id}:tracer`,
            entityType: "ticket",
            entityId: ticket.id,
          },
        ]),
      TX_OPTIONS,
    );
    expect(inserted).toBe(1);

    expect(await countUnread(orgId, assignee.id)).toBe(1);
    expect(await countUnread(orgId, actor.id)).toBe(0);

    const list = await listRecent(orgId, assignee.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "ASSIGNED",
      actorUserId: actor.id,
      entityType: "ticket",
      entityId: ticket.id,
      unassignedFallback: false,
      readAt: null,
      ticketNumber: ticket.number,
    });
    expect(list[0].ticketSubject).toMatch(/^Fixture ticket /);

    // The stored row holds ids, a type and an event key only (AIDA-44 privacy prohibition).
    const stored = await prisma.notification.findMany({ where: { organizationId: orgId } });
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(
      [
        "actorUserId",
        "archivedAt",
        "createdAt",
        "digestedAt",
        "entityId",
        "entityType",
        "eventKey",
        "id",
        "organizationId",
        "readAt",
        "recipientUserId",
        "type",
        "unassignedFallback",
      ].sort(),
    );
  });
});
