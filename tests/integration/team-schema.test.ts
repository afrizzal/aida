// Phase 10 team schema (plan 10-01) on a real Postgres through Testcontainers, unmocked:
// MemberAuditEvent's single writer, its database-level append-only trigger and its organization
// isolation through scopedDb (D-12, D-28, V-14); organization isolation of the other five models
// (D-28); the unique keys of Notification, invitation.tokenHash and MessageMention (D-04, D-14,
// D-20); and the strength of the organization row lock (V-25): a second locker of the same
// organization waits, a foreign-key insert that points at that organization does not.
//
// Better Auth's organization, user and member models have no @default() on id or createdAt, so
// every seeded row carries explicit values. Each case seeds fresh organizations.
//
// Lock proofs follow V-16: backendPid and waitForBlockedBy from tests/support/lock-wait.ts (on
// pg_blocking_pids), createObserverClient, settleAll and assertNoDeadlock from
// tests/support/project-race.ts. Never a sleep as proof.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { recordTicketAudit } from "@/lib/tickets/ticket-audit";
import { recordMemberAudit } from "@/lib/workspace-members/member-audit";
import { lockOrganization } from "@/lib/workspace-members/org-lock";
import { seedTicket } from "../support/inbox-fixtures";
import { backendPid, type Deferred, deferred, waitForBlockedBy } from "../support/lock-wait";
import { assertNoDeadlock, createObserverClient, settleAll } from "../support/project-race";

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** Unique violation from Postgres (23505) as surfaced by Prisma (P2002) or the pg adapter. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: unknown };
  const text = `${String(e?.code ?? "")} ${String(e?.message ?? err)} ${JSON.stringify(e?.meta ?? {})}`;
  return /P2002|23505/.test(text);
}

async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected a unique violation, the write succeeded").not.toBeNull();
  expect(isUniqueViolation(err), String((err as Error)?.message ?? err)).toBe(true);
}

async function seedOrg(label: string): Promise<{ id: string }> {
  const id = randomUUID();
  await prisma.organization.create({
    data: {
      id,
      name: `Team schema ${label}`,
      slug: `team-schema-${label}-${id}`,
      createdAt: new Date(),
    },
  });
  return { id };
}

async function seedUser(label: string): Promise<{ id: string }> {
  const id = randomUUID();
  const now = new Date();
  await prisma.user.create({
    data: {
      id,
      name: `Team schema ${label}`,
      email: `team-schema-${label}-${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id };
}

describe("MemberAuditEvent (D-12, V-14)", () => {
  it("recordMemberAudit writes exactly one row with the given ids, action and roles", async () => {
    const org = await seedOrg("audit-write");
    const actor = await seedUser("audit-actor");
    const target = await seedUser("audit-target");

    const { id } = await recordMemberAudit(prisma, org.id, {
      actorUserId: actor.id,
      action: "ROLE_CHANGED",
      targetUserId: target.id,
      oldRole: "member",
      newRole: "admin",
    });

    const rows = await prisma.memberAuditEvent.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      organizationId: org.id,
      actorUserId: actor.id,
      targetUserId: target.id,
      invitationId: null,
      action: "ROLE_CHANGED",
      oldRole: "member",
      newRole: "admin",
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("holds ids, an action, roles and a timestamp only: no email, token or free-text column", async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'MemberAuditEvent'
      ORDER BY column_name
    `;
    expect(columns.map((c) => c.column_name)).toEqual(
      [
        "action",
        "actorUserId",
        "createdAt",
        "id",
        "invitationId",
        "newRole",
        "oldRole",
        "organizationId",
        "targetUserId",
      ].sort(),
    );
  });

  it("rejects a raw UPDATE and a raw DELETE at the database level with the trigger's message", async () => {
    const org = await seedOrg("audit-immutable");
    const actor = await seedUser("audit-immutable-actor");
    const { id } = await recordMemberAudit(prisma, org.id, {
      actorUserId: actor.id,
      action: "INVITATION_CREATED",
      invitationId: randomUUID(),
      newRole: "member",
    });

    await expect(
      prisma.$executeRaw`UPDATE "MemberAuditEvent" SET "newRole" = 'owner' WHERE id = ${id}`,
    ).rejects.toThrow(/MemberAuditEvent is append-only: UPDATE is not permitted/);
    await expect(
      prisma.$executeRaw`DELETE FROM "MemberAuditEvent" WHERE id = ${id}`,
    ).rejects.toThrow(/MemberAuditEvent is append-only: DELETE is not permitted/);
    await expect(
      prisma.memberAuditEvent.update({ where: { id }, data: { newRole: "owner" } }),
    ).rejects.toThrow(/append-only/);

    const still = await prisma.memberAuditEvent.findUnique({ where: { id } });
    expect(still?.newRole).toBe("member");
  });

  it("is invisible and immutable through another organization's scopedDb", async () => {
    const orgA = await seedOrg("audit-iso-a");
    const orgB = await seedOrg("audit-iso-b");
    const actor = await seedUser("audit-iso-actor");
    const { id } = await recordMemberAudit(prisma, orgA.id, {
      actorUserId: actor.id,
      action: "MEMBER_DEACTIVATED",
      targetUserId: randomUUID(),
      oldRole: "member",
    });

    const dbB = scopedDb(orgB.id);
    expect(await dbB.memberAuditEvent.findMany()).toEqual([]);
    expect(await dbB.memberAuditEvent.findFirst({ where: { id } })).toBeNull();
    expect(await dbB.memberAuditEvent.count()).toBe(0);
    const updated = await dbB.memberAuditEvent.updateMany({
      where: { id },
      data: { oldRole: "owner" },
    });
    expect(updated.count).toBe(0);
    const deleted = await dbB.memberAuditEvent.deleteMany({ where: { id } });
    expect(deleted.count).toBe(0);

    const dbA = scopedDb(orgA.id);
    const own = await dbA.memberAuditEvent.findMany();
    expect(own.map((r) => r.id)).toEqual([id]);
    expect(own[0]?.oldRole).toBe("member");
  });

  it("keeps the audit row when the actor's user account is removed (no user relation)", async () => {
    const org = await seedOrg("audit-user-gone");
    const actor = await seedUser("audit-user-gone-actor");
    const { id } = await recordMemberAudit(prisma, org.id, {
      actorUserId: actor.id,
      action: "INVITATION_REVOKED",
      invitationId: randomUUID(),
    });

    await prisma.user.delete({ where: { id: actor.id } });

    const still = await prisma.memberAuditEvent.findUnique({ where: { id } });
    expect(still?.actorUserId).toBe(actor.id);
  });
});

/** A fresh pair of organizations and one user, for one isolation case. */
async function seedPair(label: string) {
  const orgA = await seedOrg(`${label}-a`);
  const orgB = await seedOrg(`${label}-b`);
  const user = await seedUser(`${label}-user`);
  return { orgA, orgB, user };
}

/** Every read through orgB's client sees nothing, and every write changes nothing. */
async function expectInvisibleAndImmutable(ops: {
  findMany: () => Promise<unknown[]>;
  findFirst: () => Promise<unknown>;
  count: () => Promise<number>;
  updateMany: () => Promise<{ count: number }>;
  deleteMany: () => Promise<{ count: number }>;
}): Promise<void> {
  expect(await ops.findMany()).toEqual([]);
  expect(await ops.findFirst()).toBeNull();
  expect(await ops.count()).toBe(0);
  expect((await ops.updateMany()).count).toBe(0);
  expect((await ops.deleteMany()).count).toBe(0);
}

async function seedInternalMessage(orgId: string): Promise<{ id: string }> {
  const ticket = await seedTicket(orgId);
  return prisma.message.create({
    data: {
      organizationId: orgId,
      ticketId: ticket.id,
      direction: "OUTBOUND",
      visibility: "INTERNAL",
      bodyMarkdown: "Internal note",
      bodyHtml: "<p>Internal note</p>",
    },
    select: { id: true },
  });
}

describe("organization isolation of the notification and mention models (D-28)", () => {
  it("Notification of org A is invisible and immutable through scopedDb(orgB)", async () => {
    const { orgA, orgB, user } = await seedPair("iso-notification");
    const row = await prisma.notification.create({
      data: {
        organizationId: orgA.id,
        recipientUserId: user.id,
        type: "ASSIGNED",
        eventKey: `assign:${randomUUID()}`,
        entityType: "ticket",
        entityId: randomUUID(),
      },
    });
    const dbB = scopedDb(orgB.id);
    await expectInvisibleAndImmutable({
      findMany: () => dbB.notification.findMany(),
      findFirst: () => dbB.notification.findFirst({ where: { id: row.id } }),
      count: () => dbB.notification.count(),
      updateMany: () =>
        dbB.notification.updateMany({ where: { id: row.id }, data: { readAt: new Date() } }),
      deleteMany: () => dbB.notification.deleteMany({ where: { id: row.id } }),
    });
    const still = await prisma.notification.findUnique({ where: { id: row.id } });
    expect(still?.readAt).toBeNull();
    expect((await scopedDb(orgA.id).notification.findMany()).map((r) => r.id)).toEqual([row.id]);
  });

  it("NotificationPreference of org A is invisible and immutable through scopedDb(orgB)", async () => {
    const { orgA, orgB, user } = await seedPair("iso-preference");
    const row = await prisma.notificationPreference.create({
      data: { organizationId: orgA.id, userId: user.id, type: "MENTION", inApp: false },
    });
    const dbB = scopedDb(orgB.id);
    await expectInvisibleAndImmutable({
      findMany: () => dbB.notificationPreference.findMany(),
      findFirst: () => dbB.notificationPreference.findFirst({ where: { id: row.id } }),
      count: () => dbB.notificationPreference.count(),
      updateMany: () =>
        dbB.notificationPreference.updateMany({ where: { id: row.id }, data: { inApp: true } }),
      deleteMany: () => dbB.notificationPreference.deleteMany({ where: { id: row.id } }),
    });
    const still = await prisma.notificationPreference.findUnique({ where: { id: row.id } });
    expect(still?.inApp).toBe(false);
    expect(still?.digest).toBe(true);
  });

  it("NotificationSetting of org A is invisible and immutable through scopedDb(orgB)", async () => {
    const { orgA, orgB, user } = await seedPair("iso-setting");
    const row = await prisma.notificationSetting.create({
      data: { organizationId: orgA.id, userId: user.id, unassignedTickets: false },
    });
    const dbB = scopedDb(orgB.id);
    await expectInvisibleAndImmutable({
      findMany: () => dbB.notificationSetting.findMany(),
      findFirst: () => dbB.notificationSetting.findFirst({ where: { id: row.id } }),
      count: () => dbB.notificationSetting.count(),
      updateMany: () =>
        dbB.notificationSetting.updateMany({
          where: { id: row.id },
          data: { unassignedTickets: true },
        }),
      deleteMany: () => dbB.notificationSetting.deleteMany({ where: { id: row.id } }),
    });
    const still = await prisma.notificationSetting.findUnique({ where: { id: row.id } });
    expect(still?.unassignedTickets).toBe(false);
  });

  it("NotificationDigest of org A is invisible and immutable through scopedDb(orgB)", async () => {
    const { orgA, orgB, user } = await seedPair("iso-digest");
    const row = await prisma.notificationDigest.create({
      data: {
        organizationId: orgA.id,
        recipientUserId: user.id,
        notificationIds: [randomUUID()],
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(row.status).toBe("CLAIMED");
    const dbB = scopedDb(orgB.id);
    await expectInvisibleAndImmutable({
      findMany: () => dbB.notificationDigest.findMany(),
      findFirst: () => dbB.notificationDigest.findFirst({ where: { id: row.id } }),
      count: () => dbB.notificationDigest.count(),
      updateMany: () =>
        dbB.notificationDigest.updateMany({ where: { id: row.id }, data: { status: "SENT" } }),
      deleteMany: () => dbB.notificationDigest.deleteMany({ where: { id: row.id } }),
    });
    const still = await prisma.notificationDigest.findUnique({ where: { id: row.id } });
    expect(still?.status).toBe("CLAIMED");
  });

  it("MessageMention of org A is invisible and immutable through scopedDb(orgB)", async () => {
    const { orgA, orgB, user } = await seedPair("iso-mention");
    const message = await seedInternalMessage(orgA.id);
    const row = await prisma.messageMention.create({
      data: { organizationId: orgA.id, messageId: message.id, mentionedUserId: user.id },
    });
    const dbB = scopedDb(orgB.id);
    await expectInvisibleAndImmutable({
      findMany: () => dbB.messageMention.findMany(),
      findFirst: () => dbB.messageMention.findFirst({ where: { id: row.id } }),
      count: () => dbB.messageMention.count(),
      updateMany: () =>
        dbB.messageMention.updateMany({ where: { id: row.id }, data: { createdAt: new Date(0) } }),
      deleteMany: () => dbB.messageMention.deleteMany({ where: { id: row.id } }),
    });
    const still = await prisma.messageMention.findUnique({ where: { id: row.id } });
    expect(still?.createdAt.getTime()).toBe(row.createdAt.getTime());
  });
});

describe("unique keys (D-04, D-14, D-20)", () => {
  async function notificationFixture(label: string) {
    const org = await seedOrg(label);
    const recipient = await seedUser(`${label}-recipient`);
    const other = await seedUser(`${label}-other`);
    const base = {
      organizationId: org.id,
      recipientUserId: recipient.id,
      type: "CUSTOMER_REPLY" as const,
      eventKey: `message:${randomUUID()}`,
      entityType: "ticket",
      entityId: randomUUID(),
    };
    return { org, recipient, other, base };
  }

  it("two Notifications with the same organization, recipient, type and eventKey raise a unique violation", async () => {
    const { org, base } = await notificationFixture("uniq-notification");
    await prisma.notification.create({ data: base });
    await expectUniqueViolation(prisma.notification.create({ data: base }));
    expect(await prisma.notification.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("the same eventKey with another type or another recipient succeeds", async () => {
    const { org, other, base } = await notificationFixture("uniq-notification-ok");
    await prisma.notification.create({ data: base });
    await prisma.notification.create({ data: { ...base, type: "MENTION" } });
    await prisma.notification.create({ data: { ...base, recipientUserId: other.id } });
    expect(await prisma.notification.count({ where: { organizationId: org.id } })).toBe(3);
  });

  it("unassignedFallback defaults to false and readAt, archivedAt and digestedAt to null", async () => {
    const { base } = await notificationFixture("notification-defaults");
    const row = await prisma.notification.create({ data: base });
    expect(row.unassignedFallback).toBe(false);
    expect(row.readAt).toBeNull();
    expect(row.archivedAt).toBeNull();
    expect(row.digestedAt).toBeNull();
    const fallback = await prisma.notification.create({
      data: { ...base, eventKey: `${base.eventKey}:fallback`, unassignedFallback: true },
    });
    expect(fallback.unassignedFallback).toBe(true);
  });

  it("a missing NotificationSetting row has no default row; a created one defaults unassignedTickets to true", async () => {
    const org = await seedOrg("setting-default");
    const user = await seedUser("setting-default-user");
    expect(await prisma.notificationSetting.count({ where: { organizationId: org.id } })).toBe(0);
    const row = await prisma.notificationSetting.create({
      data: { organizationId: org.id, userId: user.id },
    });
    expect(row.unassignedTickets).toBe(true);
    await expectUniqueViolation(
      prisma.notificationSetting.create({ data: { organizationId: org.id, userId: user.id } }),
    );
  });

  async function createInvitation(orgId: string, inviterId: string, tokenHash: string | null) {
    return prisma.invitation.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        email: `invitee-${randomUUID()}@example.test`,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
        createdAt: new Date(),
        inviterId,
        tokenHash,
      },
    });
  }

  it("two invitations with the same tokenHash raise a unique violation", async () => {
    const org = await seedOrg("uniq-token");
    const inviter = await seedUser("uniq-token-inviter");
    const tokenHash = randomUUID().replaceAll("-", "").repeat(2);
    await createInvitation(org.id, inviter.id, tokenHash);
    await expectUniqueViolation(createInvitation(org.id, inviter.id, tokenHash));
  });

  it("two invitations with a null tokenHash are allowed", async () => {
    const org = await seedOrg("null-token");
    const inviter = await seedUser("null-token-inviter");
    await createInvitation(org.id, inviter.id, null);
    await createInvitation(org.id, inviter.id, null);
    expect(
      await prisma.invitation.count({ where: { organizationId: org.id, tokenHash: null } }),
    ).toBe(2);
  });

  it("two MessageMention rows for one message and one user raise a unique violation", async () => {
    const org = await seedOrg("uniq-mention");
    const user = await seedUser("uniq-mention-user");
    const message = await seedInternalMessage(org.id);
    const data = { organizationId: org.id, messageId: message.id, mentionedUserId: user.id };
    await prisma.messageMention.create({ data });
    await expectUniqueViolation(prisma.messageMention.create({ data }));
  });
});

describe("lockOrganization strength (V-25)", () => {
  let observer: ReturnType<typeof createObserverClient>;
  const held: Deferred<void>[] = [];

  beforeAll(() => {
    observer = createObserverClient();
  });

  afterAll(async () => {
    await observer.close();
  });

  afterEach(() => {
    for (const d of held.splice(0)) d.resolve();
  });

  it("the integration pool allows the holder, waiter, inserter and other-organization connections at once", () => {
    // src/lib/db.ts sizes the shared pool from DB_POOL_MAX, default 10; the observer has its own.
    expect(Number(process.env.DB_POOL_MAX) || 10).toBeGreaterThanOrEqual(4);
  });

  it("returns whether the organization row exists", async () => {
    const org = await seedOrg("lock-exists");
    expect(await prisma.$transaction((tx) => lockOrganization(tx, org.id), TX_OPTIONS)).toBe(true);
    expect(await prisma.$transaction((tx) => lockOrganization(tx, randomUUID()), TX_OPTIONS)).toBe(
      false,
    );
  });

  it("a second locker of the same organization waits for the holder, while a TicketAuditEvent insert for that organization and a lock of another organization do not", async () => {
    const orgA = await seedOrg("lock-a");
    const orgB = await seedOrg("lock-b");
    const ticket = await seedTicket(orgA.id);
    const events: string[] = [];

    const release = deferred<void>();
    held.push(release);
    const holderPid = deferred<number>();
    const holder = prisma.$transaction(async (tx) => {
      expect(await lockOrganization(tx, orgA.id)).toBe(true);
      holderPid.resolve(await backendPid(tx));
      await release.promise;
      events.push("holder-releasing");
    }, TX_OPTIONS);

    const holderBackend = await holderPid.promise;

    const waiterPid = deferred<number>();
    const waiter = prisma.$transaction(async (tx) => {
      const found = await lockOrganization(tx, orgA.id, {
        beforeLock: async (t) => {
          waiterPid.resolve(await backendPid(t));
        },
        afterLock: () => {
          events.push("waiter-locked");
        },
      });
      expect(found).toBe(true);
    }, TX_OPTIONS);

    const waiterBackend = await waiterPid.promise;
    // The proof that the second locker is blocked by the holder comes first.
    await waitForBlockedBy(observer.client, holderBackend, [waiterBackend]);
    expect(events).toEqual([]);

    // A foreign-key insert into a table pointing at the locked organization row takes FOR KEY
    // SHARE on it, which FOR NO KEY UPDATE does not block: it commits while the holder holds.
    let insertDone = false;
    const insert = prisma
      .$transaction(
        (tx) =>
          recordTicketAudit(tx, orgA.id, {
            ticketId: ticket.id,
            actorType: "SYSTEM",
            actorUserId: null,
            action: "AUTO_CLOSED",
            before: { status: "RESOLVED" },
            after: { status: "CLOSED" },
          }),
        TX_OPTIONS,
      )
      .then((row) => {
        insertDone = true;
        events.push("insert-committed");
        return row;
      });
    // The holder is released only after this await, so an insert that waited on the lock would
    // never resolve here: the deadline turns that into a failure instead of a hang.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("the TicketAuditEvent insert waited on the organization lock")),
        10_000,
      );
    });
    try {
      await Promise.race([insert, deadline]);
    } finally {
      clearTimeout(timer);
    }
    expect(insertDone).toBe(true);

    // A lock of another organization is not blocked either.
    expect(await prisma.$transaction((tx) => lockOrganization(tx, orgB.id), TX_OPTIONS)).toBe(true);
    events.push("org-b-locked");

    // The waiter is still blocked by the holder after both of those committed.
    await waitForBlockedBy(observer.client, holderBackend, [waiterBackend]);
    expect(events).toEqual(["insert-committed", "org-b-locked"]);

    release.resolve();
    const results = await settleAll<unknown>([holder, waiter, insert]);
    assertNoDeadlock(results);
    for (const result of results) expect(result.status).toBe("fulfilled");
    expect(events).toEqual([
      "insert-committed",
      "org-b-locked",
      "holder-releasing",
      "waiter-locked",
    ]);
    expect(
      await prisma.ticketAuditEvent.count({
        where: { organizationId: orgA.id, ticketId: ticket.id, action: "AUTO_CLOSED" },
      }),
    ).toBe(1);
  });
});
