// K168 (review c-WR-03, AIDA-44 "MUST NOT return or change another member's notifications"): the
// bell's route and its three server actions, called for real on a real Postgres through
// Testcontainers with a real Better Auth sign-in. Member Y holds the ids of member X's notification
// in the same organization, of member Z's notification in another organization where Y is also a
// member, and of Y's own notification in that other organization. None of them is listed, counted,
// marked read or archived for Y, whatever the request adds. With the member row gone, the route
// answers 403 `membership_ended` and the actions return `membership_ended`, and nothing changes.
//
// Only the Next request scope is replaced: `next/headers` returns Y's cookies. Every case asserts
// a working call before the refusal.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
  const previous = process.env.BETTER_AUTH_SECRET;
  // Read once when src/lib/auth.ts loads.
  process.env.BETTER_AUTH_SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  return { previous, requestHeaders: new Headers() };
});

vi.mock("next/headers", () => ({
  headers: async () => env.requestHeaders,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  archiveNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(app)/notification-actions";
import { GET as notificationsGet } from "@/app/api/notifications/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { insertNotifications } from "@/lib/notifications/store";
import { type NotificationTypeName, TICKET_ENTITY } from "@/lib/notifications/types";
import { seedTicket } from "../support/inbox-fixtures";

afterAll(() => {
  if (env.previous === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = env.previous;
});

beforeEach(() => {
  env.requestHeaders = new Headers();
});

async function createOrg(label: string): Promise<string> {
  const id = randomUUID();
  await prisma.organization.create({
    data: { id, name: `K168 ${label}`, slug: `k168-${label}-${id}`, createdAt: new Date() },
  });
  return id;
}

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await prisma.user.create({
    data: {
      id,
      name: `K168 ${label}`,
      email: `k168-${label}-${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

async function addMember(orgId: string, userId: string, role: "owner" | "admin" | "member") {
  await prisma.member.create({
    data: { id: randomUUID(), organizationId: orgId, userId, role, createdAt: new Date() },
  });
}

async function notify(
  orgId: string,
  recipientUserId: string,
  ticketId: string,
  type: NotificationTypeName = "ASSIGNED",
): Promise<string> {
  const eventKey = `k168:${randomUUID()}`;
  await insertNotifications(prisma, orgId, [
    { recipientUserId, type, eventKey, entityType: TICKET_ENTITY, entityId: ticketId },
  ]);
  const row = await prisma.notification.findFirstOrThrow({
    where: { organizationId: orgId, recipientUserId, eventKey },
    select: { id: true },
  });
  return row.id;
}

interface World {
  orgA: string;
  orgB: string;
  x: string;
  y: string;
  z: string;
  cookie: string;
  ticketA: { id: string; number: number };
  ticketB: { id: string; number: number };
  /** Y's own rows in org A, the active organization. */
  own: [string, string];
  /** X's row in org A. */
  nX: string;
  /** Y's own row in org B, not the active organization. */
  nYB: string;
  /** Z's row in org B. */
  nZ: string;
}

/**
 * Org A: owner X and member Y. Org B: owner Z, and Y as a member too. Y signs in for real while A
 * is Y's only organization, so the session names A; Y joins B afterwards.
 */
async function world(): Promise<World> {
  const orgA = await createOrg("a");
  const orgB = await createOrg("b");
  const x = await createUser("x");
  const z = await createUser("z");
  await addMember(orgA, x, "owner");
  await addMember(orgB, z, "owner");

  const email = `k168-y-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const signUp = await auth.api.signUpEmail({ body: { name: "K168 Y", email, password } });
  const y = signUp.user.id;
  await addMember(orgA, y, "member");
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  await addMember(orgB, y, "member");
  const session = await prisma.session.findFirstOrThrow({
    where: { token: response.token },
    select: { activeOrganizationId: true },
  });
  expect(session.activeOrganizationId).toBe(orgA);

  const ticketA = await seedTicket(orgA);
  const ticketB = await seedTicket(orgB);
  const own: [string, string] = [
    await notify(orgA, y, ticketA.id),
    await notify(orgA, y, ticketA.id, "CUSTOMER_REPLY"),
  ];
  const nX = await notify(orgA, x, ticketA.id);
  const nYB = await notify(orgB, y, ticketB.id);
  const nZ = await notify(orgB, z, ticketB.id);
  return { orgA, orgB, x, y, z, cookie, ticketA, ticketB, own, nX, nYB, nZ };
}

function asY(w: World): void {
  env.requestHeaders = new Headers({ cookie: w.cookie, "next-action": "k168" });
}

function bell(query: string): Promise<Response> {
  return notificationsGet(new Request(`http://localhost/api/notifications?${query}`));
}

async function states(ids: readonly string[]) {
  const rows = await prisma.notification.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, readAt: true, archivedAt: true },
  });
  return new Map(
    rows.map((r) => [r.id, { read: r.readAt !== null, archived: r.archivedAt !== null }]),
  );
}

const UNTOUCHED = { read: false, archived: false };

describe("the bell route and actions never read or change another member's notifications (K168, AIDA-44)", () => {
  it("GET view=list and view=count return Y's rows in the active organization only, whatever the query adds", async () => {
    const w = await world();
    asY(w);
    const foreign = `user=${w.x}&recipientUserId=${w.x}&userId=${w.z}&organizationId=${w.orgB}&orgId=${w.orgB}`;

    for (const query of ["view=list", `view=list&${foreign}`]) {
      const list = await bell(query);
      expect(list.status).toBe(200);
      const body = (await list.json()) as { items: { id: string; ticketId: string | null }[] };
      expect(body.items.map((i) => i.id).sort()).toEqual([...w.own].sort());
      expect(body.items.every((i) => i.ticketId === w.ticketA.id)).toBe(true);
      const text = JSON.stringify(body);
      for (const id of [w.nX, w.nYB, w.nZ, w.ticketB.id]) expect(text).not.toContain(id);
    }
    for (const query of ["view=count", `view=count&${foreign}`]) {
      const count = await bell(query);
      expect(count.status).toBe(200);
      expect(await count.json()).toEqual({ count: 2 });
    }
  });

  it("markNotificationReadAction and archiveNotificationAction change Y's own row and nothing for X's, Z's or Y's row in the other organization", async () => {
    const w = await world();
    asY(w);
    const others = [w.nX, w.nYB, w.nZ];

    // Presence: Y's own row in the active organization.
    expect(await markNotificationReadAction(w.own[0])).toEqual({ ok: true, changed: true });
    expect(await archiveNotificationAction(w.own[1])).toEqual({ ok: true, changed: true });
    const mine = await states(w.own);
    expect(mine.get(w.own[0])).toEqual({ read: true, archived: false });
    expect(mine.get(w.own[1])).toEqual({ read: false, archived: true });

    for (const id of others) {
      expect(await markNotificationReadAction(id)).toEqual({ ok: true, changed: false });
      expect(await archiveNotificationAction(id)).toEqual({ ok: true, changed: false });
    }
    const after = await states(others);
    expect(after.size).toBe(3);
    for (const id of others) expect(after.get(id)).toEqual(UNTOUCHED);
  });

  it("markAllNotificationsReadAction marks Y's rows in the active organization only", async () => {
    const w = await world();
    asY(w);
    expect(await markAllNotificationsReadAction()).toEqual({ ok: true, count: 2 });
    const mine = await states(w.own);
    for (const id of w.own) expect(mine.get(id)).toEqual({ read: true, archived: false });
    const others = await states([w.nX, w.nYB, w.nZ]);
    expect(others.size).toBe(3);
    for (const state of others.values()) expect(state).toEqual(UNTOUCHED);
    // Nothing left to mark.
    expect(await markAllNotificationsReadAction()).toEqual({ ok: true, count: 0 });
  });

  it("without a member row in the active organization: the route answers 403 membership_ended, the actions return membership_ended, and nothing changes", async () => {
    const w = await world();
    asY(w);
    // Presence: a working read first.
    expect((await bell("view=count")).status).toBe(200);

    await prisma.member.deleteMany({ where: { organizationId: w.orgA, userId: w.y } });
    const all = [...w.own, w.nX, w.nYB, w.nZ];
    const before = await states(all);

    for (const query of ["view=list", "view=count", `view=list&user=${w.x}`]) {
      const res = await bell(query);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "membership_ended" });
    }
    const ended = { ok: false, error: "membership_ended" };
    for (const id of all) {
      expect(await markNotificationReadAction(id)).toEqual(ended);
      expect(await archiveNotificationAction(id)).toEqual(ended);
    }
    expect(await markAllNotificationsReadAction()).toEqual(ended);
    expect(await states(all)).toEqual(before);
  });

  it("without a session: the route answers 401 and reads nothing", async () => {
    const w = await world();
    env.requestHeaders = new Headers();
    const res = await bell("view=list");
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain(w.own[0]);
  });
});
