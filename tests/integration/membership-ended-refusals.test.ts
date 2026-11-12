// K164 (review a-WR-1) on a real Postgres through Testcontainers, with a real Better Auth sign-in
// and the real deactivation service. deactivateMember sets the removed member's sessions on that
// organization to null (D-07 as amended by K178, also for a member of another organization): the
// open session is still signed in but names no organization. Every server action and route of a representative set then answers the typed
// MEMBERSHIP_ENDED refusal (403 in the routes; the attachment keeps its missing-attachment 404),
// changes nothing in the database and revalidates nothing, so the page keeps its client state
// (R10-1). The same holds when the session still names the organization but the member row is
// gone. Pages are not covered here: requirePageAccess keeps redirecting to /no-access
// (membership-gate.test.ts).
//
// Only the Next request scope is replaced: `next/headers` returns the member's cookies and
// `next/cache`'s revalidatePath is recorded. Each case asserts a working call before the refusal.
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

import { revalidatePath } from "next/cache";
import { saveContactNotes } from "@/app/(app)/contacts/[id]/actions";
import { requestProposalAction } from "@/app/(app)/kb/proposals/actions";
import { markAllNotificationsReadAction } from "@/app/(app)/notification-actions";
import { setAiEnabled } from "@/app/(app)/settings/actions";
import { saveAutoCloseSetting } from "@/app/(app)/settings/sla/actions";
import { createStatusAction } from "@/app/(app)/settings/statuses/actions";
import { renameTag } from "@/app/(app)/settings/tags/actions";
import { changeRoleAction, inviteMemberAction } from "@/app/(app)/settings/team/actions";
import {
  addTag,
  assignTicket,
  changePriority,
  changeState,
  setTriageCategory,
} from "@/app/(app)/tickets/[id]/actions";
import { snoozeTicketAction } from "@/app/(app)/tickets/[id]/snooze-actions";
import { bulkUpdateTickets } from "@/app/(app)/tickets/bulk-actions";
import { createTicketAction } from "@/app/(app)/tickets/new-ticket-action";
import { createSavedViewAction } from "@/app/(app)/tickets/saved-view-actions";
import { GET as attachmentGet } from "@/app/api/attachments/[id]/route";
import { GET as mentionableGet } from "@/app/api/members/mentionable/route";
import { GET as notificationsGet } from "@/app/api/notifications/route";
import { POST as messagesPost } from "@/app/api/tickets/[id]/messages/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deactivateMember } from "@/lib/workspace-members/member-admin";
import { seedTicket } from "../support/inbox-fixtures";

afterAll(() => {
  if (env.previous === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = env.previous;
});

beforeEach(() => {
  env.requestHeaders = new Headers();
  vi.mocked(revalidatePath).mockClear();
});

const ENDED = { ok: false, error: "MEMBERSHIP_ENDED" };

type Role = "owner" | "admin" | "member";

interface Install {
  orgId: string;
  ownerId: string;
  memberId: string;
  cookie: string;
  token: string;
  ticketId: string;
  contactId: string;
}

/**
 * One organization (the only one the member belongs to, as on a fresh install), its owner, and a
 * member with `role` who signed in for real, so their session names the organization. One ticket.
 */
async function install(role: Role): Promise<Install> {
  const orgId = randomUUID();
  const now = new Date();
  await prisma.organization.create({
    data: { id: orgId, name: "K164 Org", slug: `k164-${orgId}`, createdAt: now },
  });
  const ownerId = randomUUID();
  await prisma.user.create({
    data: {
      id: ownerId,
      name: "K164 Owner",
      email: `k164-owner-${ownerId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      userId: ownerId,
      role: "owner",
      createdAt: now,
    },
  });

  const email = `k164-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const signUp = await auth.api.signUpEmail({ body: { name: "K164 Member", email, password } });
  const memberId = signUp.user.id;
  await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      userId: memberId,
      role,
      createdAt: new Date(),
    },
  });
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const ticket = await seedTicket(orgId);
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { contactId: true },
  });
  return {
    orgId,
    ownerId,
    memberId,
    cookie,
    token: response.token,
    ticketId: ticket.id,
    contactId: row.contactId,
  };
}

function asMember(s: Install): void {
  env.requestHeaders = new Headers({ cookie: s.cookie, "next-action": "k164" });
}

/** Everything the representative actions could have written, for a before/after comparison. */
async function snapshot(s: Install) {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: s.ticketId } });
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: s.contactId } });
  return {
    ticket: {
      priority: ticket.priority,
      assigneeId: ticket.assigneeId,
      stateId: ticket.stateId,
      triageCategory: ticket.triageCategory,
      snoozedUntil: ticket.snoozedUntil,
    },
    notes: contact.notes,
    tickets: await prisma.ticket.count({ where: { organizationId: s.orgId } }),
    audit: await prisma.ticketAuditEvent.count({ where: { organizationId: s.orgId } }),
    tags: await prisma.tag.count({ where: { organizationId: s.orgId } }),
    views: await prisma.savedView.count({ where: { organizationId: s.orgId } }),
    states: await prisma.ticketState.count({ where: { organizationId: s.orgId } }),
    settings: await prisma.setting.count({ where: { organizationId: s.orgId } }),
    proposals: await prisma.kbProposal.count({ where: { organizationId: s.orgId } }),
    messages: await prisma.message.count({ where: { organizationId: s.orgId } }),
    members: await prisma.member.findMany({
      where: { organizationId: s.orgId },
      select: { userId: true, role: true },
      orderBy: { userId: "asc" },
    }),
  };
}

/** The representative server actions, each with the refusal it must return. */
function representativeActions(s: Install): [string, () => Promise<unknown>, unknown][] {
  return [
    ["assignTicket", () => assignTicket(s.ticketId, s.ownerId), ENDED],
    ["changeState", () => changeState(s.ticketId, randomUUID()), ENDED],
    ["changePriority", () => changePriority(s.ticketId, "URGENT"), ENDED],
    ["addTag", () => addTag(s.ticketId, "k164-tag"), ENDED],
    ["setTriageCategory", () => setTriageCategory(s.ticketId, "BILLING"), ENDED],
    [
      "bulkUpdateTickets",
      () =>
        bulkUpdateTickets({ ticketIds: [s.ticketId], op: { kind: "priority", priority: "LOW" } }),
      ENDED,
    ],
    [
      "snoozeTicketAction",
      () => snoozeTicketAction(s.ticketId, new Date(Date.now() + 86_400_000).toISOString()),
      ENDED,
    ],
    [
      "createSavedViewAction",
      () =>
        createSavedViewAction({ name: "K164 view", visibility: "PRIVATE", filters: {} } as never),
      ENDED,
    ],
    [
      "createTicketAction",
      () =>
        createTicketAction({
          subject: "K164 new",
          priority: "NORMAL",
          body: "Body",
          contactEmail: "k164-new@example.test",
        }),
      ENDED,
    ],
    ["saveContactNotes", () => saveContactNotes(s.contactId, "K164 notes"), ENDED],
    ["createStatusAction", () => createStatusAction({ name: "K164", group: "OPEN" }), ENDED],
    ["saveAutoCloseSetting", () => saveAutoCloseSetting(7), ENDED],
    ["setAiEnabled", () => setAiEnabled(false), ENDED],
    ["renameTag", () => renameTag(randomUUID(), "renamed"), ENDED],
    [
      "changeRoleAction",
      () => changeRoleAction(s.ownerId, "member"),
      { ok: false, error: "membership_ended" },
    ],
    [
      "requestProposalAction",
      () => requestProposalAction([s.ticketId]),
      { ok: false, code: "MEMBERSHIP_ENDED" },
    ],
    [
      "markAllNotificationsReadAction",
      () => markAllNotificationsReadAction(),
      { ok: false, error: "membership_ended" },
    ],
  ];
}

function messagesRequest(): Request {
  const form = new FormData();
  form.set("mode", "internal");
  form.set("body", "K164 note");
  return new Request("http://localhost/api/tickets/x/messages", { method: "POST", body: form });
}

async function expectRoutesRefuse(s: Install): Promise<void> {
  const count = await notificationsGet(
    new Request("http://localhost/api/notifications?view=count"),
  );
  expect(count.status).toBe(403);
  expect(await count.json()).toEqual({ error: "membership_ended" });
  const mentionable = await mentionableGet();
  expect(mentionable.status).toBe(403);
  const posted = await messagesPost(messagesRequest(), {
    params: Promise.resolve({ id: s.ticketId }),
  });
  expect(posted.status).toBe(403);
  const file = await attachmentGet(new Request("http://localhost/api/attachments/x"), {
    params: Promise.resolve({ id: randomUUID() }),
  });
  expect(file.status).toBe(404);
}

describe("K164: a deactivation in a one-organization install leaves the session's organization null", () => {
  it("every representative action answers MEMBERSHIP_ENDED, writes nothing and revalidates nothing; the routes answer 403", async () => {
    const s = await install("admin");

    // Presence: while a member, the same session changes the ticket and reads the bell.
    asMember(s);
    expect(await changePriority(s.ticketId, "HIGH")).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalled();
    expect(
      (await notificationsGet(new Request("http://localhost/api/notifications?view=count"))).status,
    ).toBe(200);

    expect(
      await deactivateMember({ orgId: s.orgId, actorUserId: s.ownerId, targetUserId: s.memberId }),
    ).toMatchObject({ ok: true });
    const session = await prisma.session.findUniqueOrThrow({ where: { token: s.token } });
    expect(session.activeOrganizationId).toBeNull();

    const before = await snapshot(s);
    vi.mocked(revalidatePath).mockClear();
    for (const [label, call, expected] of representativeActions(s)) {
      asMember(s);
      await expect(call(), label).resolves.toEqual(expected);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    asMember(s);
    await expectRoutesRefuse(s);
    expect(await snapshot(s)).toEqual(before);
  });
});

describe("K164: the session still names the organization but the member row is gone", () => {
  it("the same actions answer MEMBERSHIP_ENDED, write nothing and revalidate nothing; the routes answer 403", async () => {
    const s = await install("admin");
    asMember(s);
    expect(await setTriageCategory(s.ticketId, "BILLING")).toEqual({ ok: true });

    await prisma.member.deleteMany({ where: { organizationId: s.orgId, userId: s.memberId } });
    const session = await prisma.session.findUniqueOrThrow({ where: { token: s.token } });
    expect(session.activeOrganizationId).toBe(s.orgId);

    const before = await snapshot(s);
    vi.mocked(revalidatePath).mockClear();
    for (const [label, call, expected] of representativeActions(s)) {
      asMember(s);
      const result = await call();
      // Team and notification actions use their own lower-case keys; the team service itself
      // answers a non-member with not_allowed (unchanged), which is no thrown error either.
      if (label === "changeRoleAction") {
        expect(result, label).toMatchObject({ ok: false });
        continue;
      }
      expect(result, label).toEqual(expected);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    asMember(s);
    await expectRoutesRefuse(s);
    expect(await snapshot(s)).toEqual(before);
  });
});

// K178 (Codex diff round 1, HIGH; amends D-07): a member of organizations A and B is removed from
// A while a tab of A is still open. Deactivation no longer moves the session to B: it sets the
// session's active organization to null, so the stale tab's next server action is the typed
// MEMBERSHIP_ENDED refusal and writes nothing in A or in B. The person reaches B again only by
// signing in again (or by accepting an invitation, the user-initiated switch of V-23).
describe("K178: a member of A and B removed from A; a stale tab of A writes nothing in B", () => {
  it("the session is not switched to B; setAiEnabled and inviteMemberAction answer MEMBERSHIP_ENDED and write nothing in A or B", async () => {
    const savedUrl = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = "http://k178.example.test";
    try {
      const s = await install("admin");
      // The session was created while A was the member's only membership, so it names A.
      const orgB = randomUUID();
      await prisma.organization.create({
        data: { id: orgB, name: "K178 Org B", slug: `k178-${orgB}`, createdAt: new Date() },
      });
      await prisma.member.create({
        data: {
          id: randomUUID(),
          organizationId: orgB,
          userId: s.memberId,
          role: "admin",
          createdAt: new Date(),
        },
      });
      const named = await prisma.session.findUniqueOrThrow({ where: { token: s.token } });
      expect(named.activeOrganizationId).toBe(s.orgId);

      // Presence: while a member of A, the same session changes A's AI switch and invites into A.
      asMember(s);
      expect(await setAiEnabled(false)).toEqual({ ok: true });
      asMember(s);
      const invitedInA = await inviteMemberAction(`k178-a-${randomUUID()}@example.test`, "member");
      expect(invitedInA).toMatchObject({ ok: true });
      const inA = async () => ({
        settings: await prisma.setting.findMany({
          where: { organizationId: s.orgId },
          select: { key: true, value: true },
          orderBy: { key: "asc" },
        }),
        invitations: await prisma.invitation.count({ where: { organizationId: s.orgId } }),
      });
      const inB = async () => ({
        settings: await prisma.setting.count({ where: { organizationId: orgB } }),
        invitations: await prisma.invitation.count({ where: { organizationId: orgB } }),
        audit: await prisma.memberAuditEvent.count({ where: { organizationId: orgB } }),
      });
      expect(await inB()).toEqual({ settings: 0, invitations: 0, audit: 0 });

      const beforeA = await inA();
      const removed = await deactivateMember({
        orgId: s.orgId,
        actorUserId: s.ownerId,
        targetUserId: s.memberId,
      });
      expect(removed).toMatchObject({ ok: true });
      vi.mocked(revalidatePath).mockClear();

      // The stale tab of A: the same two actions, as they were meant for A.
      asMember(s);
      const aiResult = await setAiEnabled(true);
      asMember(s);
      const inviteResult = await inviteMemberAction(
        `k178-b-${randomUUID()}@example.test`,
        "member",
      );

      // Nothing was written in B (the harm the old move to B allowed), nor in A.
      expect(await inB()).toEqual({ settings: 0, invitations: 0, audit: 0 });
      expect(await inA()).toEqual(beforeA);
      expect(aiResult).toEqual(ENDED);
      expect(inviteResult).toEqual({ ok: false, error: "membership_ended" });
      expect(revalidatePath).not.toHaveBeenCalled();
      // Not switched to B: the session names no organization, and B's membership stays.
      const after = await prisma.session.findUniqueOrThrow({ where: { token: s.token } });
      expect(after.activeOrganizationId).toBeNull();
      expect(
        await prisma.member.count({ where: { organizationId: orgB, userId: s.memberId } }),
      ).toBe(1);
      expect(removed).toMatchObject({ ok: true, sessionsCleared: 1 });
    } finally {
      if (savedUrl === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = savedUrl;
    }
  });
});
