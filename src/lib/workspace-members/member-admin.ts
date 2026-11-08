// The team administration service (Phase 10, AIDA-43): list the members of an organization and
// change a member's role. The Team page (plan 10-10) is a thin layer over it; every
// authorization rule lives here.
//
// Lock protocol (D-09 as amended 2026-11-08, V-25). A role change runs in ONE transaction whose
// first statement is lockOrganization (org-lock.ts, FOR NO KEY UPDATE on the organization row),
// so role changes, deactivations and invitation accepts of one organization serialise. Then, in
// this order (the forced-order races of tests/integration/team-member-admin.test.ts rely on it):
//   1. the actor's rights, re-read under the lock (readMemberRights): not isAdmin → NOT_ALLOWED
//      (an actor removed or demoted by a change that committed first lands here);
//   2. the target's rights: no member row → NOT_A_MEMBER;
//   3. actor equals target → SELF_CHANGE (nobody changes their own role or removes themselves);
//   4. the target has ANY `owner` row and the actor is not an owner → NOT_ALLOWED (V-26 (3));
//   5. the new role is `owner` and the actor is not an owner → NOT_ALLOWED;
//   6. assertOwnerFloor on countOwners (distinct users ALL of whose rows are `owner`, V-26 (2)):
//      a second guard, LAST_OWNER when the change would leave no owner;
//   7. the write on EVERY member row of the target in this organization (V-26 (5)), the
//      revocation of the target's pending invitations when the change lowers their rights, and
//      one MemberAuditEvent row per change (D-12).
//
// The invariant (O-10 default): the organization keeps at least one owner, who holds every admin
// right. Only an owner may reduce the owner count (step 4), and nobody acts on themselves (step 3),
// so an actor able to remove an owner is an owner other than the target: the floor never bites in
// a race, the loser of a race fails at step 1. There is no floor on plain admins (D-09 amended).
//
// Duplicate member rows (O-4 default, V-06, V-26): with no unique key on (organizationId, userId)
// every rule reads all rows of the user. A user whose rows mix `owner` and `admin` is not an
// owner (fail-closed: such an install has no owner by count and cannot change owner roles until
// its duplicates are resolved), and an unknown role string is never admin and never owner.
//
// `member` and `invitation` are Better Auth models outside DOMAIN_MODELS, so every query writes
// the organization term itself. A MemberAdminError thrown inside the transaction rolls it back and
// is RETURNED as { ok: false, error }; any other error rolls back and is rethrown.
//
// Relative imports only and no framework import.
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../db";
import { MemberAdminError, type MemberAdminFailure } from "./errors";
import { recordMemberAudit } from "./member-audit";
import {
  countOwners,
  isMemberRole,
  type MemberRights,
  type MemberRole,
  readMemberRights,
} from "./member-rights";
import { lockOrganization, type OrgLockHooks } from "./org-lock";

type Tx = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** Higher means more rights. Used to decide whether a role change lowers the target's rights. */
const ROLE_RANK: Readonly<Record<MemberRole, number>> = { member: 1, admin: 2, owner: 3 };

/** Test seams of changeMemberRole (the 10-01 lock seam, passed straight through). */
export type MemberAdminHooks = OrgLockHooks<Tx>;

/**
 * The conservative role of a user from their rights over every row: `owner` only when every row
 * is `owner`, `admin` only when every row is `owner` or `admin`, else `member` (an unknown role
 * string reads as `member`, never as admin or owner).
 */
export function conservativeRole(rights: Pick<MemberRights, "isOwner" | "isAdmin">): MemberRole {
  if (rights.isOwner) return "owner";
  if (rights.isAdmin) return "admin";
  return "member";
}

export interface OwnerFloorInput {
  /** countOwners before the change. */
  ownersBefore: number;
  /** The target counts as an owner now (every row `owner`). */
  targetIsOwner: boolean;
  /** The target counts as an owner after the change (the new role is `owner`). */
  targetStaysOwner: boolean;
}

/**
 * The owner floor (D-09 amended): throws LAST_OWNER when the change removes an owner and would
 * leave the organization with none. A change that removes no owner never trips it, even in an
 * organization whose owner count is already zero (duplicate mixed rows, O-4): such a change cannot
 * make the count worse. Returns the owner count after the change. Pure: no database.
 */
export function assertOwnerFloor({
  ownersBefore,
  targetIsOwner,
  targetStaysOwner,
}: OwnerFloorInput): number {
  const removesOwner = targetIsOwner && !targetStaysOwner;
  const addsOwner = !targetIsOwner && targetStaysOwner;
  const ownersAfter = ownersBefore - (removesOwner ? 1 : 0) + (addsOwner ? 1 : 0);
  if (removesOwner && ownersAfter < 1) throw new MemberAdminError("LAST_OWNER");
  return ownersAfter;
}

/**
 * The number of distinct users of orgId with admin rights who are not owners: every row is
 * `owner` or `admin` and not every row is `owner` (the deciding-row rule, V-26 (1)). With
 * countOwners it is the "counts owners and admins" of D-09. One statement, explicit organization
 * term.
 */
async function countPlainAdmins(tx: Tx, orgId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ admins: number }[]>`
    SELECT count(*)::int AS "admins"
    FROM (
      SELECT "userId"
      FROM "member"
      WHERE "organizationId" = ${orgId}
      GROUP BY "userId"
      HAVING bool_and("role" IN ('owner', 'admin')) AND NOT bool_and("role" = 'owner')
    ) AS "plainAdmin"
  `;
  return Number(rows[0]?.admins ?? 0);
}

/** Trimmed and lower-cased, the comparison form of an email address. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Cancels the pending invitations of orgId that `inviterId` sent and, when `email` is given, those
 * addressed to that email (trimmed, case-insensitive; D-10), with one INVITATION_REVOKED row each.
 * Runs inside the caller's locked transaction. Returns the number revoked.
 */
async function revokePendingInvitations(
  tx: Tx,
  orgId: string,
  actorUserId: string,
  { inviterId, email }: { inviterId: string; email?: string | null },
): Promise<number> {
  const wantedEmail = email ? normaliseEmail(email) : "";
  const candidates = await tx.invitation.findMany({
    where: {
      organizationId: orgId,
      status: "pending",
      OR: [
        { inviterId },
        ...(wantedEmail
          ? [{ email: { contains: wantedEmail, mode: "insensitive" as const } }]
          : []),
      ],
    },
    select: { id: true, email: true, inviterId: true },
    orderBy: { id: "asc" },
  });
  const ids = candidates
    .filter(
      (c) =>
        c.inviterId === inviterId ||
        (wantedEmail !== "" && normaliseEmail(c.email) === wantedEmail),
    )
    .map((c) => c.id);
  if (ids.length === 0) return 0;

  const revoked = await tx.invitation.updateManyAndReturn({
    where: { id: { in: ids }, organizationId: orgId, status: "pending" },
    data: { status: "canceled" },
    select: { id: true },
  });
  const revokedIds = revoked.map((r) => r.id).sort();
  for (const invitationId of revokedIds) {
    await recordMemberAudit(tx, orgId, {
      actorUserId,
      action: "INVITATION_REVOKED",
      invitationId,
    });
  }
  return revokedIds.length;
}

/**
 * Steps 1 to 5 of the header for both writers: the actor and target rights under the lock and
 * the role rules that do not depend on the new role. Returns both rights.
 */
async function checkActorAndTarget(
  tx: Tx,
  orgId: string,
  actorUserId: string,
  targetUserId: string,
): Promise<{ actor: MemberRights; target: MemberRights }> {
  const actor = await readMemberRights(tx, orgId, actorUserId);
  if (!actor.isAdmin) throw new MemberAdminError("NOT_ALLOWED");
  const target = await readMemberRights(tx, orgId, targetUserId);
  if (!target.isMember) throw new MemberAdminError("NOT_A_MEMBER");
  if (actorUserId === targetUserId) throw new MemberAdminError("SELF_CHANGE");
  if (target.hasOwnerRow && !actor.isOwner) throw new MemberAdminError("NOT_ALLOWED");
  return { actor, target };
}

/** Runs body in one transaction and maps a MemberAdminError to { ok: false, error }. */
async function runMemberAdmin<T>(body: (tx: Tx) => Promise<T>): Promise<T | MemberAdminFailure> {
  try {
    return await prisma.$transaction(body, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof MemberAdminError) return { ok: false, error: err.code };
    throw err;
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export interface ChangeMemberRoleInput {
  orgId: string;
  actorUserId: string;
  targetUserId: string;
  /** Untrusted: anything outside owner, admin and member is INVALID_ROLE. */
  newRole: string;
}

/** owners and admins are counted after the change (admins: plain admins, not owners). */
export type MemberAdminSuccess = { ok: true; owners: number; admins: number };

/**
 * Changes the role of targetUserId in orgId to newRole on every member row of the target, under
 * the organization lock, with the rules of the header. Writes one ROLE_CHANGED row (old
 * conservative role, new role). When every row already holds newRole nothing is written and no
 * audit row is added. When the change lowers the target's rights, the pending invitations the
 * target sent in this organization are canceled with one INVITATION_REVOKED row each.
 */
export async function changeMemberRole(
  { orgId, actorUserId, targetUserId, newRole }: ChangeMemberRoleInput,
  hooks?: MemberAdminHooks,
): Promise<MemberAdminSuccess | MemberAdminFailure> {
  if (!isMemberRole(newRole)) return { ok: false, error: "INVALID_ROLE" };
  if (!isNonEmptyString(orgId) || !isNonEmptyString(actorUserId)) {
    return { ok: false, error: "NOT_ALLOWED" };
  }
  if (!isNonEmptyString(targetUserId)) return { ok: false, error: "NOT_A_MEMBER" };

  return runMemberAdmin(async (tx) => {
    await lockOrganization(tx, orgId, hooks);
    const { actor, target } = await checkActorAndTarget(tx, orgId, actorUserId, targetUserId);
    if (newRole === "owner" && !actor.isOwner) throw new MemberAdminError("NOT_ALLOWED");
    assertOwnerFloor({
      ownersBefore: await countOwners(tx, orgId),
      targetIsOwner: target.isOwner,
      targetStaysOwner: newRole === "owner",
    });

    const oldRole = conservativeRole(target);
    // Every row of the target that does not hold newRole yet; afterwards every row holds it.
    const { count } = await tx.member.updateMany({
      where: { organizationId: orgId, userId: targetUserId, role: { not: newRole } },
      data: { role: newRole },
    });
    if (count > 0) {
      if (ROLE_RANK[newRole] < ROLE_RANK[oldRole]) {
        await revokePendingInvitations(tx, orgId, actorUserId, { inviterId: targetUserId });
      }
      await recordMemberAudit(tx, orgId, {
        actorUserId,
        action: "ROLE_CHANGED",
        targetUserId,
        oldRole,
        newRole,
      });
    }
    return {
      ok: true as const,
      owners: await countOwners(tx, orgId),
      admins: await countPlainAdmins(tx, orgId),
    };
  });
}

/** One entry of the Team page's member list: one per distinct user. */
export interface MemberListEntry {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  /** The conservative role over every row of the user (see conservativeRole). */
  role: MemberRole;
  /** The earliest createdAt of the user's member rows in the organization. */
  joinedAt: Date;
}

/**
 * Every member of orgId, one entry per distinct user with the conservative role, ordered owners,
 * admins, members, then by name case-insensitively, then by userId. The caller gates access
 * (requirePageAccess or getScopedDb); this reads with the explicit organization term.
 */
export async function listMembers(orgId: string): Promise<MemberListEntry[]> {
  if (!isNonEmptyString(orgId)) return [];
  const rows = await prisma.member.findMany({
    where: { organizationId: orgId },
    select: {
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { name: true, email: true, image: true } },
    },
    orderBy: { id: "asc" },
  });

  const byUser = new Map<
    string,
    { roles: string[]; joinedAt: Date; name: string; email: string; image: string | null }
  >();
  for (const row of rows) {
    const entry = byUser.get(row.userId);
    if (entry) {
      entry.roles.push(row.role);
      if (row.createdAt < entry.joinedAt) entry.joinedAt = row.createdAt;
    } else {
      byUser.set(row.userId, {
        roles: [row.role],
        joinedAt: row.createdAt,
        name: row.user.name,
        email: row.user.email,
        image: row.user.image,
      });
    }
  }

  const list: MemberListEntry[] = [...byUser].map(([userId, e]) => ({
    userId,
    name: e.name,
    email: e.email,
    image: e.image,
    role: conservativeRole({
      isOwner: e.roles.every((r) => r === "owner"),
      isAdmin: e.roles.every((r) => r === "owner" || r === "admin"),
    }),
    joinedAt: e.joinedAt,
  }));

  list.sort((a, b) => {
    const byRole = ROLE_RANK[b.role] - ROLE_RANK[a.role];
    if (byRole !== 0) return byRole;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  return list;
}
