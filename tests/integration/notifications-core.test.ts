// The notification core of Phase 10 (plan 10-04, AIDA-44) on a real Postgres through
// Testcontainers, with no mock of Prisma or the database (D-15, D-28): writes inside the caller's
// transaction, reads scoped to organization and recipient, the unassigned-ticket fallback (V-28),
// preferences and the per-person opt-out (D-22), read state (D-19), and the digest data access of
// store.ts (D-23, C10). Each case seeds fresh organizations.
//
// Race proofs follow V-16: backendPid and waitForBlockedBy from tests/support/lock-wait.ts,
// createObserverClient, settleAll and assertNoDeadlock from tests/support/project-race.ts.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { emitForTicket, emitNotifications } from "@/lib/notifications/emit";
import {
  enabledInAppRecipients,
  getPreferences,
  getUnassignedSetting,
  setPreference,
  setUnassignedSetting,
} from "@/lib/notifications/preferences";
import { unassignedFallbackRecipients } from "@/lib/notifications/recipients";
import {
  archive,
  claimDigestCandidates,
  countUnread,
  insertNotifications,
  listRecent,
  markAllRead,
  markRead,
  readDigestRows,
  stampDigested,
} from "@/lib/notifications/store";
import {
  NOTIFICATION_TYPES,
  type NotificationItem,
  type NotificationTypeName,
} from "@/lib/notifications/types";
import { scopedDb } from "@/lib/scoped-db";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";
import { deferred } from "../support/lock-wait";

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** One ticket notification item. */
function item(
  recipientUserId: string,
  type: NotificationTypeName,
  eventKey: string,
  extra: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    recipientUserId,
    type,
    eventKey,
    entityType: "ticket",
    entityId: extra.entityId ?? `ticket-${eventKey}`,
    ...extra,
  };
}

/** Writes rows straight through the store inside one global-client transaction. */
async function insertRows(orgId: string, rows: NotificationItem[]): Promise<number> {
  return prisma.$transaction((tx) => insertNotifications(tx, orgId, rows), TX_OPTIONS);
}

/** Inserts one row and stamps an explicit createdAt, so ordering cases do not depend on ids. */
async function insertAt(orgId: string, row: NotificationItem, createdAt: Date): Promise<string> {
  await insertRows(orgId, [row]);
  const stored = await prisma.notification.findFirstOrThrow({
    where: {
      organizationId: orgId,
      recipientUserId: row.recipientUserId,
      type: row.type,
      eventKey: row.eventKey,
    },
    select: { id: true },
  });
  await prisma.notification.update({ where: { id: stored.id }, data: { createdAt } });
  return stored.id;
}

/** Adds one more member row for an existing user (duplicate rows stay legal while O-4 is open). */
async function addMemberRow(orgId: string, userId: string, role: string): Promise<void> {
  await prisma.member.create({
    data: { id: randomUUID(), organizationId: orgId, userId, role, createdAt: new Date() },
  });
}

async function rowsOf(orgId: string) {
  return prisma.notification.findMany({
    where: { organizationId: orgId },
    orderBy: [{ recipientUserId: "asc" }, { eventKey: "asc" }],
  });
}

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

describe("emitForTicket: assignee or the unassigned fallback (V-28, owner item 11)", () => {
  it("with an assignee notifies only the assignee, without the fallback marker", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
    const [owner, admin, assignee] = users;
    const ticket = await seedTicket(orgId, { assigneeId: assignee.id });

    const n = await prisma.$transaction(
      (tx) =>
        emitForTicket(tx, orgId, {
          assigneeId: assignee.id,
          type: "CUSTOMER_REPLY",
          eventKey: "message:m-assigned",
          entityId: ticket.id,
        }),
      TX_OPTIONS,
    );
    expect(n).toBe(1);
    const rows = await rowsOf(orgId);
    expect(rows.map((r) => r.recipientUserId)).toEqual([assignee.id]);
    expect(rows[0]).toMatchObject({ unassignedFallback: false, entityType: "ticket" });
    expect(await countUnread(orgId, owner.id)).toBe(0);
    expect(await countUnread(orgId, admin.id)).toBe(0);
  });

  it("unassigned: every owner and admin minus the actor and minus opted-out users, marked as fallback", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, [
      "owner",
      "admin",
      "admin",
      "admin",
      "member",
    ]);
    const [owner, actor, optedOut, admin, member] = users;
    await setUnassignedSetting(orgId, optedOut.id, false);
    const ticket = await seedTicket(orgId);

    const n = await prisma.$transaction(
      (tx) =>
        emitForTicket(tx, orgId, {
          assigneeId: null,
          type: "SLA_BREACHED",
          eventKey: "sla-breached:t:2026-11-13T00:00:00.000Z",
          entityId: ticket.id,
          actorUserId: actor.id,
        }),
      TX_OPTIONS,
    );
    expect(n).toBe(2);
    const rows = await rowsOf(orgId);
    expect(rows.map((r) => r.recipientUserId).sort()).toEqual([owner.id, admin.id].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        type: "SLA_BREACHED",
        eventKey: "sla-breached:t:2026-11-13T00:00:00.000Z",
        entityId: ticket.id,
        unassignedFallback: true,
        actorUserId: actor.id,
      });
    }
    expect(rows.some((r) => r.recipientUserId === member.id)).toBe(false);
  });

  it("deciding-row rule: an owner-plus-member user and an unknown role are excluded; two admin rows give one row", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "admin", "admin"]);
    const [mixed, doubled, unknownRole, plainAdmin] = users;
    await addMemberRow(orgId, mixed.id, "member");
    await addMemberRow(orgId, doubled.id, "admin");
    await prisma.member.updateMany({
      where: { organizationId: orgId, userId: unknownRole.id },
      data: { role: "member,admin" },
    });

    const recipients = await prisma.$transaction((tx) => unassignedFallbackRecipients(tx, orgId));
    expect([...recipients].sort()).toEqual([doubled.id, plainAdmin.id].sort());

    const n = await prisma.$transaction((tx) =>
      emitForTicket(tx, orgId, {
        assigneeId: null,
        type: "CUSTOMER_REPLY",
        eventKey: "message:m-dup",
        entityId: "ticket-dup",
      }),
    );
    expect(n).toBe(2);
    const rows = await rowsOf(orgId);
    expect(rows.filter((r) => r.recipientUserId === doubled.id)).toHaveLength(1);
    expect(rows.some((r) => r.recipientUserId === mixed.id)).toBe(false);
    expect(rows.some((r) => r.recipientUserId === unknownRole.id)).toBe(false);
  });

  it("the same fallback event emitted twice leaves one row per recipient", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin"]);
    const event = {
      assigneeId: null,
      type: "CUSTOMER_REPLY" as const,
      eventKey: "message:m-twice",
      entityId: "ticket-twice",
    };
    expect(await prisma.$transaction((tx) => emitForTicket(tx, orgId, event))).toBe(2);
    expect(await prisma.$transaction((tx) => emitForTicket(tx, orgId, event))).toBe(0);
    const rows = await rowsOf(orgId);
    expect(rows.map((r) => r.recipientUserId).sort()).toEqual(users.map((u) => u.id).sort());
  });

  it("fallback rows follow only the unassigned switch, not the per-type in-app switch (flagged assumption)", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
    const [owner] = users;
    await setPreference(orgId, owner.id, "SLA_AT_RISK", { inApp: false });
    const n = await prisma.$transaction((tx) =>
      emitForTicket(tx, orgId, {
        assigneeId: null,
        type: "SLA_AT_RISK",
        eventKey: "sla-at-risk:t:x",
        entityId: "ticket-x",
      }),
    );
    expect(n).toBe(1);
    await setUnassignedSetting(orgId, owner.id, false);
    const m = await prisma.$transaction((tx) =>
      emitForTicket(tx, orgId, {
        assigneeId: null,
        type: "SLA_AT_RISK",
        eventKey: "sla-at-risk:t:y",
        entityId: "ticket-y",
      }),
    );
    expect(m).toBe(0);
  });
});

describe("preferences and the unassigned opt-out (D-22, V-28)", () => {
  it("getPreferences returns all five types, in-app and digest on, when no row exists", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const prefs = await getPreferences(orgId, users[0].id);
    expect(prefs).toEqual(NOTIFICATION_TYPES.map((type) => ({ type, inApp: true, digest: true })));
  });

  it("setPreference stores one row per (org, user, type) and a second call updates it", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [x, y] = users;
    await setPreference(orgId, x.id, "MENTION", { inApp: false });
    await setPreference(orgId, x.id, "MENTION", { digest: false });
    const stored = await prisma.notificationPreference.findMany({
      where: { organizationId: orgId },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: x.id, type: "MENTION", inApp: false, digest: false });
    await setPreference(orgId, x.id, "MENTION", { inApp: true });
    const prefs = await getPreferences(orgId, x.id);
    expect(prefs.find((p) => p.type === "MENTION")).toEqual({
      type: "MENTION",
      inApp: true,
      digest: false,
    });
    expect(prefs.filter((p) => p.type !== "MENTION").every((p) => p.inApp && p.digest)).toBe(true);
    expect((await getPreferences(orgId, y.id)).every((p) => p.inApp && p.digest)).toBe(true);
  });

  it("getUnassignedSetting is on without a row; setUnassignedSetting stores false and then true", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
    const [admin] = users;
    expect(await getUnassignedSetting(orgId, admin.id)).toBe(true);
    await setUnassignedSetting(orgId, admin.id, false);
    expect(await getUnassignedSetting(orgId, admin.id)).toBe(false);
    await setUnassignedSetting(orgId, admin.id, true);
    expect(await getUnassignedSetting(orgId, admin.id)).toBe(true);
    expect(await prisma.notificationSetting.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("enabledInAppRecipients drops only users whose in-app switch of that type is off", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member", "member"]);
    const [on, off, otherTypeOff] = users;
    await setPreference(orgId, off.id, "ASSIGNED", { inApp: false });
    await setPreference(orgId, otherTypeOff.id, "MENTION", { inApp: false });
    await setPreference(orgId, on.id, "ASSIGNED", { digest: false });
    const ids = users.map((u) => u.id);
    const enabled = await prisma.$transaction((tx) =>
      enabledInAppRecipients(tx, orgId, ids, "ASSIGNED"),
    );
    expect([...enabled].sort()).toEqual([on.id, otherTypeOff.id].sort());
  });
});

describe("read state (D-19)", () => {
  it("markRead sets readAt once and refuses another member's or another organization's id", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const other = await seedOrgWithMembers(prisma, ["member"]);
    const [x, y] = users;
    const id = await insertAt(orgId, item(x.id, "MENTION", "k1"), new Date());

    expect(await markRead(orgId, y.id, id)).toBe(false);
    expect(await markRead(other.orgId, x.id, id)).toBe(false);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt).toBeNull();

    expect(await markRead(orgId, x.id, id)).toBe(true);
    const first = (await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt;
    expect(first).not.toBeNull();
    expect(await markRead(orgId, x.id, id)).toBe(false);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt).toEqual(first);
    expect(await countUnread(orgId, x.id)).toBe(0);
  });

  it("markAllRead marks only this member's unread rows in this organization", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [x, y] = users;
    const otherOrg = await seedOrgWithMembers(prisma, []);
    await addMemberRow(otherOrg.orgId, x.id, "member");
    await insertRows(orgId, [item(x.id, "MENTION", "a"), item(x.id, "ASSIGNED", "b")]);
    await insertRows(orgId, [item(y.id, "MENTION", "a")]);
    await insertRows(otherOrg.orgId, [item(x.id, "MENTION", "a")]);

    expect(await markAllRead(orgId, x.id)).toBe(2);
    expect(await countUnread(orgId, x.id)).toBe(0);
    expect(await countUnread(orgId, y.id)).toBe(1);
    expect(await countUnread(otherOrg.orgId, x.id)).toBe(1);
    expect(await markAllRead(orgId, x.id)).toBe(0);
  });

  it("archive removes the row from the list and the count, and read state persists", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [x, y] = users;
    const readId = await insertAt(orgId, item(x.id, "MENTION", "r"), new Date());
    const unreadId = await insertAt(orgId, item(x.id, "ASSIGNED", "u"), new Date());
    await markRead(orgId, x.id, readId);
    expect(await countUnread(orgId, x.id)).toBe(1);

    expect(await archive(orgId, y.id, unreadId)).toBe(false);
    expect(await archive(orgId, x.id, unreadId)).toBe(true);
    expect(await archive(orgId, x.id, unreadId)).toBe(false);
    expect(await countUnread(orgId, x.id)).toBe(0);
    expect((await listRecent(orgId, x.id)).map((r) => r.id)).toEqual([readId]);

    expect(await archive(orgId, x.id, readId)).toBe(true);
    const archived = await prisma.notification.findUniqueOrThrow({ where: { id: readId } });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.readAt).not.toBeNull();
    expect(await listRecent(orgId, x.id)).toEqual([]);
  });
});

describe("digest data access (D-23, C10)", () => {
  it("claimDigestCandidates returns only this recipient's eligible rows of those types, oldest first", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "admin"]);
    const [x, y] = users;
    const t0 = Date.parse("2026-11-01T00:00:00.000Z");
    const at = (minutes: number) => new Date(t0 + minutes * 60_000);
    const newest = await insertAt(orgId, item(x.id, "MENTION", "newest"), at(30));
    const oldest = await insertAt(orgId, item(x.id, "ASSIGNED", "oldest"), at(10));
    const fallback = await insertAt(
      orgId,
      item(x.id, "CUSTOMER_REPLY", "fallback", { unassignedFallback: true }),
      at(20),
    );
    const read = await insertAt(orgId, item(x.id, "MENTION", "read"), at(1));
    const archivedRow = await insertAt(orgId, item(x.id, "MENTION", "archived"), at(2));
    const digested = await insertAt(orgId, item(x.id, "MENTION", "digested"), at(3));
    await insertAt(orgId, item(x.id, "SLA_BREACHED", "other-type"), at(4));
    await insertAt(orgId, item(y.id, "MENTION", "other-recipient"), at(5));
    await markRead(orgId, x.id, read);
    await archive(orgId, x.id, archivedRow);
    await prisma.notification.update({ where: { id: digested }, data: { digestedAt: at(6) } });

    const types: NotificationTypeName[] = ["ASSIGNED", "CUSTOMER_REPLY", "MENTION"];
    const withFallback = await prisma.$transaction((tx) =>
      claimDigestCandidates(tx, orgId, x.id, types, true),
    );
    expect(withFallback.map((r) => r.id)).toEqual([oldest, fallback, newest]);
    expect(withFallback[1]).toEqual({
      id: fallback,
      type: "CUSTOMER_REPLY",
      entityId: "ticket-fallback",
      unassignedFallback: true,
    });

    const withoutFallback = await prisma.$transaction((tx) =>
      claimDigestCandidates(tx, orgId, x.id, types, false),
    );
    expect(withoutFallback.map((r) => r.id)).toEqual([oldest, newest]);
    expect(
      await prisma.$transaction((tx) => claimDigestCandidates(tx, orgId, x.id, [], true)),
    ).toEqual([]);
  });

  it("claimDigestCandidates skips rows another open transaction has claimed", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const [x] = users;
    const assigned = await insertAt(orgId, item(x.id, "ASSIGNED", "a"), new Date(1_000));
    const mention = await insertAt(orgId, item(x.id, "MENTION", "m"), new Date(2_000));

    const claimed = deferred<string[]>();
    const release = deferred<void>();
    const holder = prisma.$transaction(async (tx) => {
      const rows = await claimDigestCandidates(tx, orgId, x.id, ["ASSIGNED"], true);
      claimed.resolve(rows.map((r) => r.id));
      await release.promise;
    }, TX_OPTIONS);
    try {
      expect(await claimed.promise).toEqual([assigned]);
      const second = await prisma.$transaction(
        (tx) => claimDigestCandidates(tx, orgId, x.id, ["ASSIGNED", "MENTION"], true),
        TX_OPTIONS,
      );
      expect(second.map((r) => r.id)).toEqual([mention]);
    } finally {
      release.resolve();
      await holder;
    }
    const after = await prisma.$transaction((tx) =>
      claimDigestCandidates(tx, orgId, x.id, ["ASSIGNED", "MENTION"], true),
    );
    expect(after.map((r) => r.id)).toEqual([assigned, mention]);
  });

  it("readDigestRows and stampDigested touch only this recipient's still-eligible rows", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [x, y] = users;
    const a = await insertAt(orgId, item(x.id, "ASSIGNED", "a"), new Date(1_000));
    const b = await insertAt(orgId, item(x.id, "MENTION", "b"), new Date(2_000));
    const c = await insertAt(orgId, item(x.id, "MENTION", "c"), new Date(3_000));
    const yRow = await insertAt(orgId, item(y.id, "MENTION", "y"), new Date(4_000));
    await markRead(orgId, x.id, c);

    const read = await prisma.$transaction((tx) =>
      readDigestRows(tx, orgId, x.id, [a, b, c, yRow]),
    );
    expect(read.map((r) => r.id)).toEqual([a, b]);
    expect(read[0]).toMatchObject({
      type: "ASSIGNED",
      entityType: "ticket",
      unassignedFallback: false,
    });

    const now = new Date("2026-11-13T08:00:00.000Z");
    const stamped = await prisma.$transaction((tx) =>
      stampDigested(tx, orgId, x.id, [a, b, yRow], now),
    );
    expect(stamped).toBe(2);
    const rows = await prisma.notification.findMany({ where: { id: { in: [a, b, c, yRow] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)?.digestedAt).toEqual(now);
    expect(byId.get(b)?.digestedAt).toEqual(now);
    expect(byId.get(c)?.digestedAt).toBeNull();
    expect(byId.get(yRow)?.digestedAt).toBeNull();
    expect(await prisma.$transaction((tx) => stampDigested(tx, orgId, x.id, [a, b], now))).toBe(0);
    expect(await prisma.$transaction((tx) => readDigestRows(tx, orgId, x.id, [a, b]))).toEqual([]);
  });
});
