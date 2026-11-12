// Phase 10, plan 10-05 (AIDA-42; D-02, D-03, D-04, D-06, C2, V-23, V-26): the invitation service
// on a real Postgres through Testcontainers, unmocked. Create, revoke and accept run under the
// organization lock; accept and the activation of the requesting session are one transaction.
// Races force their order with the lock-wait helpers (each run's backend PID recorded through the
// service's own hook, then waitForBlockedBy on exactly that PID), never with sleeps.
//
// Built on better-auth 1.7.20 (D-01 as updated by V-01): a later Better Auth upgrade reruns this
// suite.
import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { saveBrandingSettings } from "@/lib/branding/settings";
import { saveEmailSettings } from "@/lib/channels/email/settings";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { INVALID_INVITATION_MESSAGE, InvitationError } from "@/lib/workspace-members/errors";
import {
  type AcceptInvitationHooks,
  acceptInvitation,
  type CreateInvitationSuccess,
  createInvitation,
  FORMER_MEMBER_LABEL,
  getInvitationView,
  listPendingInvitations,
  revokeInvitation,
  type SessionRef,
} from "@/lib/workspace-members/invitations";
import {
  INVITATION_EMAIL_SUBJECT,
  invitationEmailBody,
} from "@/lib/workspace-members/invite-email";
import { createInviteToken, hashInviteToken } from "@/lib/workspace-members/invite-token";
import { changeMemberRole, deactivateMember } from "@/lib/workspace-members/member-admin";
import { type FakeSmtpMode, type FakeSmtpServer, startFakeSmtp } from "../support/fake-smtp";
import { type MemberRole, seedOrgWithMembers } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";
import { assertNoDeadlock, createObserverClient, settleAll } from "../support/project-race";

const BASE_URL = "http://invite.example.test:3100";
let savedAuthUrl: string | undefined;

beforeAll(() => {
  savedAuthUrl = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = `${BASE_URL}/`;
});

afterAll(() => {
  if (savedAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = savedAuthUrl;
});

async function seed(roles: readonly MemberRole[]) {
  const { orgId, users } = await seedOrgWithMembers(prisma, roles);
  return { orgId, ids: users.map((u) => u.id) };
}

/** A user with no membership, with the given email (unique by default). */
async function addUser(email = `invitee-${randomUUID()}@example.test`) {
  const now = new Date();
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: `Invitee ${id.slice(0, 6)}`,
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id, email };
}

/** A live session row of userId; returns its id and token. */
async function addSession(
  userId: string,
  {
    activeOrganizationId = null,
    expiresAt,
  }: { activeOrganizationId?: string | null; expiresAt?: Date } = {},
) {
  const now = new Date();
  const id = randomUUID();
  const token = `tok-${randomUUID()}`;
  await prisma.session.create({
    data: {
      id,
      token,
      userId,
      activeOrganizationId,
      expiresAt: expiresAt ?? new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id, token };
}

function created(result: Awaited<ReturnType<typeof createInvitation>>): CreateInvitationSuccess {
  if (!result.ok) throw new Error(`createInvitation refused: ${result.error}`);
  return result;
}

/** The copyable link of a result that was not emailed (smtp_off or send_failed, D-06). */
function linkOf(result: CreateInvitationSuccess): string {
  if (result.delivery === "sent") throw new Error("the invitation was emailed; no link returned");
  return result.link;
}

/** The token at the end of an invitation link. */
function tokenFromLink(link: string): string {
  const match = /\/invite\/([A-Za-z0-9_-]+)$/.exec(link);
  if (!match?.[1]) throw new Error("no token in link");
  return match[1];
}

function memberRows(orgId: string, userId: string) {
  return prisma.member.findMany({
    where: { organizationId: orgId, userId },
    select: { id: true, role: true },
    orderBy: { id: "asc" },
  });
}

function memberAudit(orgId: string) {
  return prisma.memberAuditEvent.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function sessionOrg(sessionId: string) {
  return (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } }))
    .activeOrganizationId;
}

describe("tracer: create an invitation and accept it into one membership and an activated session", () => {
  it("an owner invites an admin; the invitee accepts with session { id }: one admin row, the session active in the organization, both audit rows", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    const invitee = await addUser();
    const session = await addSession(invitee.id);

    const invite = created(
      await createInvitation({
        orgId,
        actorUserId: owner,
        email: `  ${invitee.email.toUpperCase()} `,
        role: "admin",
      }),
    );
    expect(invite.email).toBe(invitee.email);
    // No email settings: the copyable link comes back to the inviter (D-06).
    expect(invite.delivery).toBe("smtp_off");
    const link = linkOf(invite);
    expect(link).toMatch(
      new RegExp(`^${BASE_URL.replace(/[.]/g, "\\.")}/invite/[A-Za-z0-9_-]{43}$`),
    );
    const token = tokenFromLink(link);

    // Only the hash is stored; the row carries the D-04 shape.
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invite.invitationId } });
    expect(row).toMatchObject({
      organizationId: orgId,
      email: invitee.email,
      role: "admin",
      status: "pending",
      inviterId: owner,
      tokenHash: hashInviteToken(token),
    });
    expect(row.tokenHash).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(7 * 86_400_000);

    const accepted = await acceptInvitation({
      token,
      userId: invitee.id,
      userEmail: invitee.email,
      session: { id: session.id },
    });
    expect(accepted).toEqual({ ok: true, orgId, role: "admin", retried: false });

    expect((await memberRows(orgId, invitee.id)).map((r) => r.role)).toEqual(["admin"]);
    expect(await sessionOrg(session.id)).toBe(orgId);
    expect(
      (await prisma.invitation.findUniqueOrThrow({ where: { id: invite.invitationId } })).status,
    ).toBe("accepted");

    const audit = await memberAudit(orgId);
    expect(audit.map((a) => a.action)).toEqual(["INVITATION_CREATED", "INVITATION_ACCEPTED"]);
    expect(audit[0]).toMatchObject({
      actorUserId: owner,
      invitationId: invite.invitationId,
      newRole: "admin",
    });
    expect(audit[1]).toMatchObject({
      actorUserId: invitee.id,
      targetUserId: invitee.id,
      invitationId: invite.invitationId,
      newRole: "admin",
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2: every rejection rule, the expiry boundary, session gone, the retry path and the
// forced-order races (C2, R2-2, R2-4, V-16, V-23, V-26).
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const INVALID = { ok: false, error: "INVALID_INVITATION" } as const;
const SESSION_GONE = { ok: false, error: "SESSION_GONE" } as const;

/** Creates an invitation (refusal throws) and returns it with the token from its link. */
async function invite(
  orgId: string,
  actorUserId: string,
  email: string,
  role: string,
  now?: Date,
): Promise<CreateInvitationSuccess & { link: string; linkToken: string }> {
  const result = created(await createInvitation({ orgId, actorUserId, email, role }, now));
  const link = linkOf(result);
  return { ...result, link, linkToken: tokenFromLink(link) };
}

/** Runs acceptInvitation and also returns the internal refusal reason (tests only). */
async function acceptWithReason(
  token: string,
  user: { id: string; email: string },
  session: SessionRef,
  { hooks = {}, now }: { hooks?: AcceptInvitationHooks; now?: Date } = {},
) {
  let reason: string | undefined;
  const result = await acceptInvitation(
    { token, userId: user.id, userEmail: user.email, session },
    {
      ...hooks,
      onRefusal(r) {
        reason = r;
      },
    },
    now,
  );
  return { result, reason };
}

async function invitationStatus(invitationId: string) {
  return (await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } })).status;
}

async function acceptedAuditCount(orgId: string) {
  return prisma.memberAuditEvent.count({
    where: { organizationId: orgId, action: "INVITATION_ACCEPTED" },
  });
}

async function emailOf(userId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;
}

/** A pending invitation inserted directly (bypassing createInvitation's duplicate checks). */
async function insertInvitation(
  orgId: string,
  inviterId: string,
  email: string,
  role = "member",
): Promise<{ invitationId: string; token: string }> {
  const token = createInviteToken();
  const invitationId = randomUUID();
  const now = new Date();
  await prisma.invitation.create({
    data: {
      id: invitationId,
      organizationId: orgId,
      email,
      role,
      status: "pending",
      tokenHash: hashInviteToken(token),
      expiresAt: new Date(now.getTime() + 7 * DAY_MS),
      createdAt: now,
      inviterId,
    },
  });
  return { invitationId, token };
}

describe("createInvitation: role ceilings, input and duplicates (D-03, V-26)", () => {
  it("an admin invites member and admin but not owner (ROLE_ABOVE_OWN); an owner invites owner", async () => {
    const { orgId, ids } = await seed(["owner", "admin"]);
    const [owner, admin] = ids;
    const fresh = () => `inv-${randomUUID()}@example.test`;

    expect(
      await createInvitation({ orgId, actorUserId: admin, email: fresh(), role: "owner" }),
    ).toEqual({ ok: false, error: "ROLE_ABOVE_OWN" });
    expect(
      (await createInvitation({ orgId, actorUserId: admin, email: fresh(), role: "admin" })).ok,
    ).toBe(true);
    expect(
      (await createInvitation({ orgId, actorUserId: admin, email: fresh(), role: "member" })).ok,
    ).toBe(true);
    const ownerInvite = await invite(orgId, owner, fresh(), "owner");
    expect(ownerInvite.role).toBe("owner");
  });

  it("a member or a non-member inviting anyone is NOT_ALLOWED and nothing is written", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [, member] = ids;
    const outsider = await addUser();
    for (const actorUserId of [member, outsider.id]) {
      for (const role of ["member", "admin", "owner"]) {
        expect(
          await createInvitation({
            orgId,
            actorUserId,
            email: `x-${randomUUID()}@example.test`,
            role,
          }),
        ).toEqual({ ok: false, error: "NOT_ALLOWED" });
      }
    }
    expect(await prisma.invitation.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await memberAudit(orgId)).toEqual([]);
  });

  it("an owner with a mixed owner and admin row inviting owner is ROLE_ABOVE_OWN (V-26 (2)); admin is allowed", async () => {
    const { orgId, ids } = await seed(["owner", "owner"]);
    const [, mixed] = ids;
    await prisma.member.create({
      data: {
        id: `z-dup-${randomUUID()}`,
        organizationId: orgId,
        userId: mixed,
        role: "admin",
        createdAt: new Date(),
      },
    });
    expect(
      await createInvitation({
        orgId,
        actorUserId: mixed,
        email: `x-${randomUUID()}@example.test`,
        role: "owner",
      }),
    ).toEqual({ ok: false, error: "ROLE_ABOVE_OWN" });
    expect(
      (
        await createInvitation({
          orgId,
          actorUserId: mixed,
          email: `x-${randomUUID()}@example.test`,
          role: "admin",
        })
      ).ok,
    ).toBe(true);
  });

  it("rejects an unknown role (INVALID_ROLE) and a malformed address (INVALID_EMAIL) before any write", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    for (const role of ["viewer", "Owner", "", "member,admin"]) {
      expect(
        await createInvitation({ orgId, actorUserId: owner, email: "ok@example.test", role }),
      ).toEqual({ ok: false, error: "INVALID_ROLE" });
    }
    for (const email of [
      "",
      "   ",
      "no-at-sign",
      "a@b@c.test",
      "@example.test",
      "a@",
      "a b@c.test",
    ]) {
      expect(await createInvitation({ orgId, actorUserId: owner, email, role: "member" })).toEqual({
        ok: false,
        error: "INVALID_EMAIL",
      });
    }
    expect(await prisma.invitation.count({ where: { organizationId: orgId } })).toBe(0);
  });

  // K163 (b-WR-4): the address is checked with the rule Better Auth's sign-up applies to the same
  // address later (z.email() of the installed zod 4), and it must be exactly one address. A
  // single-label domain, a non-ASCII local part and address-list syntax that nodemailer would read
  // as other or extra recipients are refused before any write; an ordinary address with a plus
  // tag and a subdomain is accepted.
  it("K163: refuses what Better Auth's sign-up would refuse and address-list syntax (INVALID_EMAIL), before any write", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    for (const email of [
      "it@intranet",
      "ops@corp.local1",
      "ünïcode@example.test",
      "a,b@example.test",
      "a@example.test,b@example.test",
      "<other@example.test>x",
      "Name <a@example.test>",
      "a;b@example.test",
      '"quoted"@example.test',
      "a@[192.0.2.1]",
    ]) {
      expect(
        await createInvitation({ orgId, actorUserId: owner, email, role: "member" }),
        email,
      ).toEqual({ ok: false, error: "INVALID_EMAIL" });
    }
    expect(await prisma.invitation.count({ where: { organizationId: orgId } })).toBe(0);

    const accepted = await createInvitation({
      orgId,
      actorUserId: owner,
      email: `First.Last+tag-${randomUUID().slice(0, 8)}@sub.example.test`,
      role: "member",
    });
    expect(accepted.ok).toBe(true);
  });

  it("refuses a current member's address (ALREADY_MEMBER) and a second unexpired pending one (PENDING_EXISTS); an expired one does not block", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    const memberEmail = await emailOf(member);
    expect(
      await createInvitation({
        orgId,
        actorUserId: owner,
        email: ` ${memberEmail.toUpperCase()}`,
        role: "admin",
      }),
    ).toEqual({ ok: false, error: "ALREADY_MEMBER" });

    const email = `dup-${randomUUID()}@example.test`;
    await invite(orgId, owner, email, "member");
    expect(
      await createInvitation({
        orgId,
        actorUserId: owner,
        email: email.toUpperCase(),
        role: "member",
      }),
    ).toEqual({ ok: false, error: "PENDING_EXISTS" });

    const stale = `stale-${randomUUID()}@example.test`;
    await invite(orgId, owner, stale, "member", new Date(Date.now() - 8 * DAY_MS));
    expect(
      (await createInvitation({ orgId, actorUserId: owner, email: stale, role: "member" })).ok,
    ).toBe(true);
  });

  it("INVITE_CONFIG when BETTER_AUTH_URL is missing, not http(s) or not a bare origin (K165); nothing is written", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const before = process.env.BETTER_AUTH_URL;
    try {
      for (const value of [
        undefined,
        "ftp://example.test",
        // K165 (a-WR-2, b-IN-4): a path is never kept in a link, and /api/auth is no exception.
        `${BASE_URL}/aida`,
        `${BASE_URL}/api/auth`,
      ]) {
        if (value === undefined) delete process.env.BETTER_AUTH_URL;
        else process.env.BETTER_AUTH_URL = value;
        expect(
          await createInvitation({
            orgId,
            actorUserId: ids[0],
            email: "cfg@example.test",
            role: "member",
          }),
        ).toEqual({ ok: false, error: "INVITE_CONFIG" });
      }
    } finally {
      process.env.BETTER_AUTH_URL = before;
    }
    expect(await prisma.invitation.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await memberAudit(orgId)).toEqual([]);
  });
});

describe("acceptInvitation: every refusal is one generic INVALID_INVITATION (D-03, T-10-19)", () => {
  it("accepted by another user, revoked, expired at expiresAt and unknown tokens all fail identically", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    const reasons: Record<string, string | undefined> = {};

    // Accepted by another user.
    const first = await addUser();
    const used = await invite(orgId, owner, first.email, "member");
    expect(
      (await acceptWithReason(used.linkToken, first, await addSession(first.id))).result.ok,
    ).toBe(true);
    const other = await addUser();
    const otherSession = await addSession(other.id);
    let r = await acceptWithReason(used.linkToken, other, otherSession);
    expect(r.result).toEqual(INVALID);
    reasons.used = r.reason;

    // Revoked.
    const revokedUser = await addUser();
    const revoked = await invite(orgId, owner, revokedUser.email, "member");
    expect(
      await revokeInvitation({ orgId, actorUserId: owner, invitationId: revoked.invitationId }),
    ).toEqual({ ok: true });
    r = await acceptWithReason(revoked.linkToken, revokedUser, await addSession(revokedUser.id));
    expect(r.result).toEqual(INVALID);
    reasons.revoked = r.reason;

    // Expired: now equal to expiresAt.
    const lateUser = await addUser();
    const t0 = new Date(Date.now() - 60_000);
    const late = await invite(orgId, owner, lateUser.email, "member", t0);
    r = await acceptWithReason(late.linkToken, lateUser, await addSession(lateUser.id), {
      now: late.expiresAt,
    });
    expect(r.result).toEqual(INVALID);
    reasons.expired = r.reason;

    // Unknown: a well-formed token nobody issued, and a malformed one.
    const stranger = await addUser();
    const strangerSession = await addSession(stranger.id);
    r = await acceptWithReason(createInviteToken(), stranger, strangerSession);
    expect(r.result).toEqual(INVALID);
    reasons.unknown = r.reason;
    r = await acceptWithReason("../../etc/passwd", stranger, strangerSession);
    expect(r.result).toEqual(INVALID);

    expect(reasons).toEqual({
      used: "used",
      revoked: "not-pending",
      expired: "expired",
      unknown: "unknown",
    });
    // One user-facing text for every reason.
    for (const reason of Object.values(reasons)) {
      expect(new InvitationError("INVALID_INVITATION", reason).message).toBe(
        INVALID_INVITATION_MESSAGE,
      );
    }
    for (const u of [other, revokedUser, lateUser, stranger]) {
      expect(await memberRows(orgId, u.id)).toEqual([]);
    }
    expect(await invitationStatus(late.invitationId)).toBe("pending");
  });

  it("one millisecond before expiresAt is still accepted (edge AIDA-42)", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const user = await addUser();
    const t0 = new Date(Date.now() - 60_000);
    const inv = await invite(orgId, ids[0], user.email, "member", t0);
    // The injected now is ~7 days ahead; the session must outlive it.
    const session = await addSession(user.id, { expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    const { result } = await acceptWithReason(inv.linkToken, user, session, {
      now: new Date(inv.expiresAt.getTime() - 1),
    });
    expect(result).toEqual({ ok: true, orgId, role: "member", retried: false });
    expect(await memberRows(orgId, user.id)).toHaveLength(1);
  });

  it("a different address fails; the same address in another case with surrounding spaces succeeds", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    const local = `Mixed.${randomUUID()}`;
    const user = await addUser(`${local}@Example.test`);
    const inv = await invite(orgId, owner, `  ${local.toUpperCase()}@EXAMPLE.TEST `, "member");

    const wrong = await addUser();
    const r = await acceptWithReason(inv.linkToken, wrong, await addSession(wrong.id));
    expect(r.result).toEqual(INVALID);
    expect(r.reason).toBe("email-mismatch");
    // The caller's email must match too: a session claiming the invited address for another user.
    const r2 = await acceptWithReason(
      inv.linkToken,
      { id: wrong.id, email: inv.email },
      await addSession(wrong.id),
    );
    expect(r2.result).toEqual(INVALID);
    expect(await invitationStatus(inv.invitationId)).toBe("pending");

    const session = await addSession(user.id);
    const ok = await acceptWithReason(
      inv.linkToken,
      { id: user.id, email: `  ${user.email.toLowerCase()}  ` },
      session,
    );
    expect(ok.result).toMatchObject({ ok: true, orgId });
    expect(await memberRows(orgId, user.id)).toHaveLength(1);
  });

  it("a user who already holds a member row here is refused and nothing changes", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    const { invitationId, token } = await insertInvitation(
      orgId,
      owner,
      await emailOf(member),
      "admin",
    );
    const session = await addSession(member);
    const r = await acceptWithReason(token, { id: member, email: await emailOf(member) }, session);
    expect(r.result).toEqual(INVALID);
    expect(r.reason).toBe("already-member");
    expect((await memberRows(orgId, member)).map((m) => m.role)).toEqual(["member"]);
    expect(await invitationStatus(invitationId)).toBe("pending");
    expect(await acceptedAuditCount(orgId)).toBe(0);
    expect(await sessionOrg(session.id)).toBeNull();
  });

  it("the inviter's current rights decide at accept: a demoted inviter or a mixed-row owner inviter fails (V-26)", async () => {
    const { orgId, ids } = await seed(["owner", "owner", "admin"]);
    const [, ownerInviter, adminInviter] = ids;

    // An admin's invitation, then the admin loses admin rights by a direct row write (bypassing
    // the service, which would also revoke the invitation): the lock-time re-read refuses.
    const u1 = await addUser();
    const inv1 = await invite(orgId, adminInviter, u1.email, "member");
    await prisma.member.updateMany({
      where: { organizationId: orgId, userId: adminInviter },
      data: { role: "member" },
    });
    const r1 = await acceptWithReason(inv1.linkToken, u1, await addSession(u1.id));
    expect(r1.result).toEqual(INVALID);
    expect(r1.reason).toBe("inviter");

    // An owner's owner invitation, then the owner gains a second, admin row: no longer an owner.
    const u2 = await addUser();
    const inv2 = await invite(orgId, ownerInviter, u2.email, "owner");
    await prisma.member.create({
      data: {
        id: `z-dup-${randomUUID()}`,
        organizationId: orgId,
        userId: ownerInviter,
        role: "admin",
        createdAt: new Date(),
      },
    });
    const r2 = await acceptWithReason(inv2.linkToken, u2, await addSession(u2.id));
    expect(r2.result).toEqual(INVALID);
    expect(r2.reason).toBe("inviter");
    expect(await memberRows(orgId, u1.id)).toEqual([]);
    expect(await memberRows(orgId, u2.id)).toEqual([]);
  });
});

describe("acceptInvitation: session gone rolls the whole accept back (V-23)", () => {
  async function setup() {
    const { orgId, ids } = await seed(["owner"]);
    const user = await addUser();
    const inv = await invite(orgId, ids[0], user.email, "member");
    return { orgId, user, inv };
  }

  async function expectNothingAccepted(orgId: string, userId: string, invitationId: string) {
    expect(await memberRows(orgId, userId)).toEqual([]);
    expect(await acceptedAuditCount(orgId)).toBe(0);
    expect(await invitationStatus(invitationId)).toBe("pending");
  }

  it("the id of a deleted session: SESSION_GONE, nothing accepted, acceptable afterwards with a live session", async () => {
    const { orgId, user, inv } = await setup();
    const gone = await addSession(user.id);
    await prisma.session.delete({ where: { id: gone.id } });
    const r = await acceptWithReason(inv.linkToken, user, { id: gone.id });
    expect(r.result).toEqual(SESSION_GONE);
    await expectNothingAccepted(orgId, user.id, inv.invitationId);

    const live = await addSession(user.id);
    expect((await acceptWithReason(inv.linkToken, user, { id: live.id })).result).toMatchObject({
      ok: true,
      orgId,
    });
    expect(await sessionOrg(live.id)).toBe(orgId);
  });

  it("another user's session: SESSION_GONE, and that session is not touched", async () => {
    const { orgId, user, inv } = await setup();
    const other = await addUser();
    const foreign = await addSession(other.id);
    const r = await acceptWithReason(inv.linkToken, user, { id: foreign.id });
    expect(r.result).toEqual(SESSION_GONE);
    await expectNothingAccepted(orgId, user.id, inv.invitationId);
    expect(await sessionOrg(foreign.id)).toBeNull();
    // By token as well.
    const r2 = await acceptWithReason(inv.linkToken, user, { token: foreign.token });
    expect(r2.result).toEqual(SESSION_GONE);
    await expectNothingAccepted(orgId, user.id, inv.invitationId);
  });

  it("an expired session: SESSION_GONE; a live session named by its token is activated", async () => {
    const { orgId, user, inv } = await setup();
    const expired = await addSession(user.id, { expiresAt: new Date(Date.now() - 1000) });
    const r = await acceptWithReason(inv.linkToken, user, { id: expired.id });
    expect(r.result).toEqual(SESSION_GONE);
    await expectNothingAccepted(orgId, user.id, inv.invitationId);
    expect(await sessionOrg(expired.id)).toBeNull();

    const live = await addSession(user.id);
    expect((await acceptWithReason(inv.linkToken, user, { token: live.token })).result).toEqual({
      ok: true,
      orgId,
      role: "member",
      retried: false,
    });
    expect(await sessionOrg(live.id)).toBe(orgId);
  });
});

describe("acceptInvitation: the retry path (V-23)", () => {
  it("a second accept by the same user returns retried true, inserts nothing and activates the session again", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const user = await addUser();
    const inv = await invite(orgId, ids[0], user.email, "admin");
    const session = await addSession(user.id);
    expect((await acceptWithReason(inv.linkToken, user, session)).result).toEqual({
      ok: true,
      orgId,
      role: "admin",
      retried: false,
    });
    // The response was lost and the session moved elsewhere in between.
    await prisma.session.update({
      where: { id: session.id },
      data: { activeOrganizationId: null },
    });
    const second = await addSession(user.id);

    expect((await acceptWithReason(inv.linkToken, user, session)).result).toEqual({
      ok: true,
      orgId,
      role: "admin",
      retried: true,
    });
    expect(await sessionOrg(session.id)).toBe(orgId);
    expect((await acceptWithReason(inv.linkToken, user, { id: second.id })).result).toMatchObject({
      retried: true,
    });
    expect(await sessionOrg(second.id)).toBe(orgId);
    expect(await memberRows(orgId, user.id)).toHaveLength(1);
    expect(await acceptedAuditCount(orgId)).toBe(1);
  });

  it("after the member is deactivated, a retry is INVALID_INVITATION and inserts nothing", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    const user = await addUser();
    const inv = await invite(orgId, owner, user.email, "member");
    const session = await addSession(user.id);
    expect((await acceptWithReason(inv.linkToken, user, session)).result.ok).toBe(true);
    expect(
      await deactivateMember({ orgId, actorUserId: owner, targetUserId: user.id }),
    ).toMatchObject({ ok: true });
    expect(await sessionOrg(session.id)).toBeNull();

    const r = await acceptWithReason(inv.linkToken, user, session);
    expect(r.result).toEqual(INVALID);
    expect(r.reason).toBe("member-gone");
    expect(await memberRows(orgId, user.id)).toEqual([]);
    expect(await sessionOrg(session.id)).toBeNull();
    expect(await acceptedAuditCount(orgId)).toBe(1);
  });

  // b-IN-5: the email says the link "works once and expires"; the retry path (a response lost
  // after commit) is bounded by the same expiry, so an accepted link is not a permanent
  // "switch organization" handle for its acceptor.
  it("b-IN-5: after the invitation's expiry, a retry by the acceptor is INVALID_INVITATION and does not move the session", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const user = await addUser();
    const inv = await invite(orgId, ids[0], user.email, "member");
    const session = await addSession(user.id);
    expect((await acceptWithReason(inv.linkToken, user, session)).result.ok).toBe(true);
    await prisma.session.update({
      where: { id: session.id },
      data: { activeOrganizationId: null },
    });
    await prisma.invitation.update({
      where: { id: inv.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const r = await acceptWithReason(inv.linkToken, user, session);
    expect(r.result).toEqual(INVALID);
    expect(r.reason).toBe("expired");
    expect(await sessionOrg(session.id)).toBeNull();
    expect(await memberRows(orgId, user.id)).toHaveLength(1);
    expect(await acceptedAuditCount(orgId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Forced-order races (V-16, V-23, V-25). The holder records its backend PID from inside its own
// transaction in a service hook and parks there on a deferred; the waiter records its PID in
// beforeLock; waitForBlockedBy proves that exact PID is blocked by the holder's PID before the
// holder is released. Every race asserts the result its check order produces and the final
// database state, and ends with assertNoDeadlock.
// ---------------------------------------------------------------------------------------------

const observer = createObserverClient();
afterAll(async () => {
  await observer.close();
});

type Tx = Prisma.TransactionClient;

function holdPoint() {
  const pid = deferred<number>();
  const gate = deferred<void>();
  return {
    pid: pid.promise,
    release: () => gate.resolve(),
    hook: async (tx: Tx) => {
      pid.resolve(await backendPid(tx));
      await gate.promise;
    },
  };
}

function pidPoint() {
  const pid = deferred<number>();
  return {
    pid: pid.promise,
    hook: async (tx: Tx) => {
      pid.resolve(await backendPid(tx));
    },
  };
}

async function forcedOrder<H, W>(
  startHolder: (hook: (tx: Tx) => Promise<void>) => Promise<H>,
  startWaiter: (hook: (tx: Tx) => Promise<void>) => Promise<W>,
  proveBlocked: (holderPid: number, waiterPid: number) => Promise<void>,
): Promise<[PromiseSettledResult<H>, PromiseSettledResult<W>]> {
  const hold = holdPoint();
  const wait = pidPoint();
  const holder = startHolder(hold.hook);
  holder.catch(() => {});
  let waiter: Promise<W> | undefined;
  try {
    const holderPid = await hold.pid;
    waiter = startWaiter(wait.hook);
    waiter.catch(() => {});
    const waiterPid = await wait.pid;
    await proveBlocked(holderPid, waiterPid);
  } finally {
    hold.release();
  }
  const results = (await settleAll<unknown>([holder, waiter ?? Promise.resolve()])) as [
    PromiseSettledResult<H>,
    PromiseSettledResult<W>,
  ];
  assertNoDeadlock(results);
  return results;
}

function settledValue<T>(r: PromiseSettledResult<T>): T {
  if (r.status !== "fulfilled") throw r.reason;
  return r.value;
}

describe("races: the accept waits on the organization lock and re-checks under it (C2)", () => {
  it("inviter demoted while the accept waits (changeMemberRole parked in afterLock): INVALID_INVITATION, no member row", async () => {
    const { orgId, ids } = await seed(["owner", "admin"]);
    const [owner, admin] = ids;
    const user = await addUser();
    const inv = await invite(orgId, admin, user.email, "member");
    const session = await addSession(user.id);
    let reason: string | undefined;

    const [demote, accept] = await forcedOrder(
      (hook) =>
        changeMemberRole(
          { orgId, actorUserId: owner, targetUserId: admin, newRole: "member" },
          { afterLock: hook },
        ),
      (hook) =>
        acceptInvitation(
          { token: inv.linkToken, userId: user.id, userEmail: user.email, session },
          {
            beforeLock: hook,
            onRefusal: (r) => {
              reason = r;
            },
          },
        ),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(demote)).toMatchObject({ ok: true });
    expect(settledValue(accept)).toEqual(INVALID);
    // The demotion lowered the inviter's rights, so it also revoked the invitation (10-03).
    expect(reason).toBe("not-pending");
    expect(await invitationStatus(inv.invitationId)).toBe("canceled");
    expect(await memberRows(orgId, user.id)).toEqual([]);
    expect(await sessionOrg(session.id)).toBeNull();
    expect(await acceptedAuditCount(orgId)).toBe(0);
  });

  it("inviter deactivated while the accept waits (deactivateMember parked in afterDelete): INVALID_INVITATION, no member row", async () => {
    const { orgId, ids } = await seed(["owner", "admin"]);
    const [owner, admin] = ids;
    const user = await addUser();
    const inv = await invite(orgId, admin, user.email, "member");
    const session = await addSession(user.id);

    const [deactivate, accept] = await forcedOrder(
      (hook) =>
        deactivateMember({ orgId, actorUserId: owner, targetUserId: admin }, { afterDelete: hook }),
      (hook) =>
        acceptInvitation(
          { token: inv.linkToken, userId: user.id, userEmail: user.email, session },
          { beforeLock: hook },
        ),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(deactivate)).toMatchObject({ ok: true, invitationsRevoked: 1 });
    expect(settledValue(accept)).toEqual(INVALID);
    expect(await invitationStatus(inv.invitationId)).toBe("canceled");
    expect(await memberRows(orgId, user.id)).toEqual([]);
    expect(await acceptedAuditCount(orgId)).toBe(0);
  });

  it("invitation revoked while the accept waits (revokeInvitation parked in afterLock): INVALID_INVITATION, no member row", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    const user = await addUser();
    const inv = await invite(orgId, owner, user.email, "member");
    const session = await addSession(user.id);

    const [revoke, accept] = await forcedOrder(
      (hook) =>
        revokeInvitation(
          { orgId, actorUserId: owner, invitationId: inv.invitationId },
          { afterLock: hook },
        ),
      (hook) =>
        acceptInvitation(
          { token: inv.linkToken, userId: user.id, userEmail: user.email, session },
          { beforeLock: hook },
        ),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(revoke)).toEqual({ ok: true });
    expect(settledValue(accept)).toEqual(INVALID);
    expect(await invitationStatus(inv.invitationId)).toBe("canceled");
    expect(await memberRows(orgId, user.id)).toEqual([]);
    expect(await sessionOrg(session.id)).toBeNull();
  });
});

describe("races: accept against deactivation of the new member, both commit orders (V-23, D-07, D-10)", () => {
  async function acceptFirst(otherMembership: boolean) {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    const user = await addUser();
    let otherOrgId: string | null = null;
    if (otherMembership) {
      const other = await seedOrgWithMembers(prisma, []);
      otherOrgId = other.orgId;
      await prisma.member.create({
        data: {
          id: randomUUID(),
          organizationId: other.orgId,
          userId: user.id,
          role: "member",
          createdAt: new Date(Date.now() - DAY_MS),
        },
      });
    }
    const inv = await invite(orgId, owner, user.email, "member");
    const session = await addSession(user.id, { activeOrganizationId: otherOrgId });

    const [accept, deactivate] = await forcedOrder(
      (hook) =>
        acceptInvitation(
          { token: inv.linkToken, userId: user.id, userEmail: user.email, session },
          { afterLock: hook },
        ),
      (hook) =>
        deactivateMember(
          { orgId, actorUserId: owner, targetUserId: user.id },
          { beforeLock: hook },
        ),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(accept)).toEqual({ ok: true, orgId, role: "member", retried: false });
    expect(settledValue(deactivate)).toMatchObject({ ok: true, sessionsCleared: 1 });

    expect(await memberRows(orgId, user.id)).toEqual([]);
    // K178 (amends D-07): never moved to the other organization, with or without one.
    expect(await sessionOrg(session.id)).toBeNull();
    if (otherOrgId !== null) expect(await memberRows(otherOrgId, user.id)).toHaveLength(1);
    const actions = (await memberAudit(orgId)).map((a) => a.action);
    expect(actions).toEqual(["INVITATION_CREATED", "INVITATION_ACCEPTED", "MEMBER_DEACTIVATED"]);
    expect(await invitationStatus(inv.invitationId)).toBe("accepted");
  }

  it("accept first (parked in afterLock), deactivation proven blocked: the activated session is set to null", async () => {
    await acceptFirst(false);
  });

  it("accept first, variant with another membership: the session is still set to null, never to the other organization (K178)", async () => {
    await acceptFirst(true);
  });

  it("deactivation first (parked in afterDelete): the second invitation is canceled (D-10) and the waiting accept fails", async () => {
    const { orgId, ids } = await seed(["owner", "member"]);
    const [owner, member] = ids;
    const memberEmail = await emailOf(member);
    const second = await insertInvitation(orgId, owner, memberEmail, "admin");
    const session = await addSession(member, { activeOrganizationId: orgId });
    let reason: string | undefined;

    const [deactivate, accept] = await forcedOrder(
      (hook) =>
        deactivateMember(
          { orgId, actorUserId: owner, targetUserId: member },
          { afterDelete: hook },
        ),
      (hook) =>
        acceptInvitation(
          { token: second.token, userId: member, userEmail: memberEmail, session },
          {
            beforeLock: hook,
            onRefusal: (r) => {
              reason = r;
            },
          },
        ),
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    expect(settledValue(deactivate)).toMatchObject({ ok: true, invitationsRevoked: 1 });
    expect(settledValue(accept)).toEqual(INVALID);
    expect(reason).toBe("not-pending");
    expect(await invitationStatus(second.invitationId)).toBe("canceled");
    expect(await memberRows(orgId, member)).toEqual([]);
    expect(await sessionOrg(session.id)).toBeNull();
    expect(await acceptedAuditCount(orgId)).toBe(0);
  });
});

describe("races: two parallel accepts by the same user (V-23)", () => {
  it("both ok, one member row and exactly one retried result, five times on fresh invitations", async () => {
    const { orgId, ids } = await seed(["owner"]);
    for (let i = 0; i < 5; i++) {
      const user = await addUser();
      const inv = await invite(orgId, ids[0], user.email, "member");
      const session = await addSession(user.id);
      const call = () =>
        acceptInvitation({ token: inv.linkToken, userId: user.id, userEmail: user.email, session });
      const results = await settleAll([call(), call()]);
      assertNoDeadlock(results);
      const values = results.map((r) => settledValue(r));
      expect(values.every((v) => v.ok)).toBe(true);
      expect(values.filter((v) => v.ok && v.retried)).toHaveLength(1);
      expect(await memberRows(orgId, user.id)).toHaveLength(1);
      expect(await sessionOrg(session.id)).toBe(orgId);
    }
    expect(await acceptedAuditCount(orgId)).toBe(5);
  });
});

describe("organization isolation", () => {
  it("org B's token joins only org B; listPendingInvitations(A) never shows B's; revoke with A's id for B's invitation fails", async () => {
    const a = await seed(["owner"]);
    const b = await seed(["owner"]);
    const userB = await addUser();
    const userA = await addUser();
    const invA = await invite(a.orgId, a.ids[0], userA.email, "member");
    const invB = await invite(b.orgId, b.ids[0], userB.email, "admin");
    const invB2 = await invite(b.orgId, b.ids[0], `b2-${randomUUID()}@example.test`, "member");

    const listA = await listPendingInvitations(a.orgId);
    expect(listA.map((p) => p.invitationId)).toEqual([invA.invitationId]);

    expect(
      await revokeInvitation({
        orgId: a.orgId,
        actorUserId: a.ids[0],
        invitationId: invB2.invitationId,
      }),
    ).toEqual({ ok: false, error: "NOT_PENDING" });
    expect(await invitationStatus(invB2.invitationId)).toBe("pending");
    // B's owner is not an admin of A either.
    expect(
      await revokeInvitation({
        orgId: a.orgId,
        actorUserId: b.ids[0],
        invitationId: invA.invitationId,
      }),
    ).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await invitationStatus(invA.invitationId)).toBe("pending");

    const session = await addSession(userB.id, { activeOrganizationId: null });
    expect((await acceptWithReason(invB.linkToken, userB, session)).result).toEqual({
      ok: true,
      orgId: b.orgId,
      role: "admin",
      retried: false,
    });
    expect(await memberRows(b.orgId, userB.id)).toHaveLength(1);
    expect(await memberRows(a.orgId, userB.id)).toEqual([]);
    expect(await sessionOrg(session.id)).toBe(b.orgId);
    expect(await memberAudit(a.orgId)).toHaveLength(1); // A's own INVITATION_CREATED only
  });
});

describe("reads: getInvitationView and listPendingInvitations", () => {
  it("the view of a valid token: branding name else organization name, role, email, accountExists; invalid otherwise", async () => {
    const { orgId, ids } = await seed(["owner"]);
    const [owner] = ids;
    const known = await addUser();
    const inv = await invite(orgId, owner, known.email, "admin");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

    expect(await getInvitationView(inv.linkToken)).toEqual({
      state: "valid",
      workspaceName: org.name,
      role: "admin",
      email: known.email,
      accountExists: true,
      expiresAt: inv.expiresAt,
    });
    await saveBrandingSettings(scopedDb(orgId), orgId, { workspaceName: "Acme Support" });
    const unknownEmail = `nobody-${randomUUID()}@example.test`;
    const inv2 = await invite(orgId, owner, unknownEmail, "member");
    expect(await getInvitationView(inv2.linkToken)).toMatchObject({
      state: "valid",
      workspaceName: "Acme Support",
      accountExists: false,
      email: unknownEmail,
    });

    expect(await getInvitationView(inv.linkToken, inv.expiresAt)).toEqual({ state: "invalid" });
    expect(await getInvitationView(createInviteToken())).toEqual({ state: "invalid" });
    expect(await getInvitationView("short")).toEqual({ state: "invalid" });
    await revokeInvitation({ orgId, actorUserId: owner, invitationId: inv2.invitationId });
    expect(await getInvitationView(inv2.linkToken)).toEqual({ state: "invalid" });
    await acceptWithReason(inv.linkToken, known, await addSession(known.id));
    expect(await getInvitationView(inv.linkToken)).toEqual({ state: "invalid" });
  });

  it("lists pending unexpired invitations with the inviter's name, or 'a former member' when the inviter left", async () => {
    const { orgId, ids } = await seed(["owner", "admin"]);
    const [owner, admin] = ids;
    await prisma.user.update({ where: { id: admin }, data: { name: "Ada Admin" } });
    const t = Date.now();
    const p1 = await invite(
      orgId,
      admin,
      `p1-${randomUUID()}@example.test`,
      "member",
      new Date(t - 2000),
    );
    const p2 = await invite(
      orgId,
      owner,
      `p2-${randomUUID()}@example.test`,
      "admin",
      new Date(t - 1000),
    );
    await invite(
      orgId,
      owner,
      `old-${randomUUID()}@example.test`,
      "member",
      new Date(t - 8 * DAY_MS),
    );
    const gone = await invite(orgId, owner, `gone-${randomUUID()}@example.test`, "member");
    await revokeInvitation({ orgId, actorUserId: owner, invitationId: gone.invitationId });

    let list = await listPendingInvitations(orgId);
    expect(list.map((p) => p.invitationId)).toEqual([p2.invitationId, p1.invitationId]);
    expect(list[1]).toMatchObject({ email: p1.email, role: "member", invitedBy: "Ada Admin" });

    // The inviter's member row disappears without the service (so the invitation stays pending).
    await prisma.member.deleteMany({ where: { organizationId: orgId, userId: admin } });
    list = await listPendingInvitations(orgId);
    expect(list.find((p) => p.invitationId === p1.invitationId)?.invitedBy).toBe(
      FORMER_MEMBER_LABEL,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Task 3: the invitation email through the fake SMTP and the copy-link fallback (V-15, D-06,
// R2-5). The organization's email settings point at a loopback server on a plain TCP socket;
// nothing leaves the machine.
// ---------------------------------------------------------------------------------------------

describe("the invitation email through the fake SMTP (V-15, D-06, R2-5)", () => {
  let smtp: FakeSmtpServer;

  beforeAll(async () => {
    smtp = await startFakeSmtp();
  });

  afterAll(async () => {
    await smtp.stop();
  });

  beforeEach(() => {
    smtp.reset();
  });

  async function orgWithSmtp({ enabled = true }: { enabled?: boolean } = {}) {
    const { orgId, ids } = await seed(["owner"]);
    await prisma.user.update({ where: { id: ids[0] }, data: { name: "Olive Owner" } });
    await saveEmailSettings(scopedDb(orgId), orgId, {
      enabled,
      fromAddress: "support@example.test",
      smtpHost: "127.0.0.1",
      smtpPort: smtp.port,
      smtpSecure: false,
      smtpUser: "fake-user",
      smtpPassword: "fake-password",
    });
    await saveBrandingSettings(scopedDb(orgId), orgId, { workspaceName: "Acme Help" });
    return { orgId, owner: ids[0] };
  }

  /** The decoded subject and text of a captured message. */
  async function parse(raw: string) {
    const mail = await simpleParser(raw);
    return { subject: mail.subject ?? "", text: mail.text ?? "" };
  }

  it("sends one message to the invited address with the UI-SPEC subject and body; its link is valid and accepts; no link is returned", async () => {
    const { orgId, owner } = await orgWithSmtp();
    const user = await addUser();
    const result = created(
      await createInvitation({ orgId, actorUserId: owner, email: user.email, role: "admin" }),
    );
    expect(result.delivery).toBe("sent");
    expect(result).not.toHaveProperty("link");
    expect(result).not.toHaveProperty("token");

    expect(smtp.messages).toHaveLength(1);
    const [message] = smtp.messages;
    expect(message?.recipients).toEqual([user.email]);
    expect(message?.from).toBe("support@example.test");

    const { subject, text } = await parse(message?.raw ?? "");
    expect(subject).toBe(INVITATION_EMAIL_SUBJECT);
    expect(subject).toBe("You've been invited to an AIDA workspace");
    const match = new RegExp(`${BASE_URL.replace(/[.]/g, "\\.")}/invite/([A-Za-z0-9_-]{43})`).exec(
      text,
    );
    expect(match?.[1]).toBeDefined();
    const token = match?.[1] ?? "";
    expect(text.trim()).toBe(
      invitationEmailBody({
        inviterName: "Olive Owner",
        workspaceName: "Acme Help",
        role: "admin",
        link: `${BASE_URL}/invite/${token}`,
        expiresAt: result.expiresAt,
      }),
    );
    expect(text).toContain("Olive Owner invited you to join Acme Help on AIDA as admin.");
    expect(text).toContain("If you did not expect this, ignore this email.");

    expect(await getInvitationView(token)).toMatchObject({ state: "valid", role: "admin" });
    const session = await addSession(user.id);
    expect((await acceptWithReason(token, user, session)).result).toEqual({
      ok: true,
      orgId,
      role: "admin",
      retried: false,
    });
    expect(await sessionOrg(session.id)).toBe(orgId);
  });

  it("email disabled or not configured: nothing is sent and the link is returned (smtp_off)", async () => {
    const { orgId, owner } = await orgWithSmtp({ enabled: false });
    const result = created(
      await createInvitation({
        orgId,
        actorUserId: owner,
        email: `off-${randomUUID()}@example.test`,
        role: "member",
      }),
    );
    expect(result.delivery).toBe("smtp_off");
    expect(linkOf(result)).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

    const bare = await seed(["owner"]);
    const bareResult = created(
      await createInvitation({
        orgId: bare.orgId,
        actorUserId: bare.ids[0],
        email: `bare-${randomUUID()}@example.test`,
        role: "member",
      }),
    );
    expect(bareResult.delivery).toBe("smtp_off");
    expect(smtp.received).toEqual([]);
  });

  for (const mode of ["reject-data", "reject-data-command", "reject-rcpt"] as FakeSmtpMode[]) {
    it(`${mode}: send_failed with the link; the invitation stays pending and acceptable`, async () => {
      const { orgId, owner } = await orgWithSmtp();
      smtp.setMode(mode);
      const user = await addUser();
      const result = created(
        await createInvitation({ orgId, actorUserId: owner, email: user.email, role: "member" }),
      );
      expect(result.delivery).toBe("send_failed");
      expect(smtp.messages).toEqual([]);
      // Only reject-data reads the whole message before refusing it.
      expect(smtp.received).toHaveLength(mode === "reject-data" ? 1 : 0);
      const token = tokenFromLink(linkOf(result));
      expect(await invitationStatus(result.invitationId)).toBe("pending");
      expect(await getInvitationView(token)).toMatchObject({ state: "valid" });
      const session = await addSession(user.id);
      expect((await acceptWithReason(token, user, session)).result).toMatchObject({ ok: true });
    });
  }

  it("drop-on-data: send_failed within the transport timeout, the link returned", async () => {
    const { orgId, owner } = await orgWithSmtp();
    smtp.setMode("drop-on-data");
    const started = Date.now();
    const result = created(
      await createInvitation({
        orgId,
        actorUserId: owner,
        email: `drop-${randomUUID()}@example.test`,
        role: "member",
      }),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.delivery).toBe("send_failed");
    expect(linkOf(result)).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(smtp.received).toEqual([]);
  });

  it("drop-after-data-end: the server read the whole message but never answered; send_failed with the link", async () => {
    const { orgId, owner } = await orgWithSmtp();
    smtp.setMode("drop-after-data-end");
    const email = `ambiguous-${randomUUID()}@example.test`;
    const result = created(
      await createInvitation({ orgId, actorUserId: owner, email, role: "member" }),
    );
    expect(result.delivery).toBe("send_failed");
    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0]).toMatchObject({ recipients: [email], accepted: false });
    expect(smtp.messages).toEqual([]);
    expect(linkOf(result)).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  });

  it("delay-ms: a slow but answering server still delivers (sent)", async () => {
    const { orgId, owner } = await orgWithSmtp();
    smtp.setMode("delay-ms", { delayMs: 30 });
    const result = created(
      await createInvitation({
        orgId,
        actorUserId: owner,
        email: `slow-${randomUUID()}@example.test`,
        role: "member",
      }),
    );
    expect(result.delivery).toBe("sent");
    expect(smtp.messages).toHaveLength(1);
  });
});
