// Phase 10, plan 10-05 (AIDA-42; D-02, D-03, D-04, D-06, C2, V-23, V-26): the invitation service
// on a real Postgres through Testcontainers, unmocked. Create, revoke and accept run under the
// organization lock; accept and the activation of the requesting session are one transaction.
// Races force their order with the lock-wait helpers (each run's backend PID recorded through the
// service's own hook, then waitForBlockedBy on exactly that PID), never with sleeps.
//
// Built on better-auth 1.7.20 (D-01 as updated by V-01): a later Better Auth upgrade reruns this
// suite.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  acceptInvitation,
  type CreateInvitationSuccess,
  createInvitation,
} from "@/lib/workspace-members/invitations";
import { hashInviteToken } from "@/lib/workspace-members/invite-token";
import { type MemberRole, seedOrgWithMembers } from "../support/inbox-fixtures";

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
    expect(invite.link).toBe(`${BASE_URL}/invite/${invite.token}`);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Only the hash is stored; the row carries the D-04 shape.
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invite.invitationId } });
    expect(row).toMatchObject({
      organizationId: orgId,
      email: invitee.email,
      role: "admin",
      status: "pending",
      inviterId: owner,
      tokenHash: hashInviteToken(invite.token),
    });
    expect(row.tokenHash).not.toContain(invite.token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(7 * 86_400_000);

    const accepted = await acceptInvitation({
      token: tokenFromLink(invite.link),
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
