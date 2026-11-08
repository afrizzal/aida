// Membership rights with duplicate member rows (Phase 10, V-26). Better Auth's member table has
// no unique key on (organizationId, userId) while owner item O-4 (12.2-o4) is open, so one user
// can hold several rows with different roles in one organization. Every Phase 10 rights check
// reads ALL rows of the user in the organization and applies these rules:
//
//   (1) isAdmin: the deciding row of findConservativeMembership (../membership): admin only when
//       EVERY row is owner or admin.
//   (2) isOwner: every row is `owner` (and there is at least one). Owner rights (grant or remove
//       `owner`, act on an owner) and the owner floor use this; the deciding row cannot, because a
//       user with an `owner` and an `admin` row reads as either, by id. countOwners counts
//       distinct users all of whose rows are `owner`.
//   (3) hasOwnerRow: ANY row is `owner`. Target protection reads this way: a target with any
//       owner row is treated as an owner, so an admin can never change or deactivate it.
//   (4) A role string outside MEMBER_ROLES fails closed: never admin, never owner.
//
// The roles stay exactly owner, admin and member (D-13, owner item 12: "10-O-3: tidak").
//
// Relative imports only and no framework import: the worker may bundle it.
import {
  type ActiveMembership,
  type ConservativeMembershipClient,
  findConservativeMembership,
  isAdminRole,
  type MembershipLockClient,
} from "../membership";

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

const MEMBER_ROLE_SET: ReadonlySet<string> = new Set(MEMBER_ROLES);

/** True only for exactly "owner", "admin" or "member". */
export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && MEMBER_ROLE_SET.has(value);
}

export interface MemberRights {
  /** At least one member row exists (whatever its role). */
  isMember: boolean;
  /** Rule (1) and (4). */
  isAdmin: boolean;
  /** Rule (2) and (4). */
  isOwner: boolean;
  /** Rule (3). */
  hasOwnerRow: boolean;
  rowCount: number;
  /** Every member row id of the user in the organization, in id order. */
  rowIds: string[];
}

/**
 * Reads every member row of userId in orgId, in id order (one query, explicit organization term,
 * through findConservativeMembership), and returns the rights of V-26. Works on the global client,
 * a scopedDb client and an interactive transaction client. Empty ids read as no row.
 */
export async function readMemberRights(
  client: ConservativeMembershipClient,
  orgId: string,
  userId: string,
): Promise<MemberRights> {
  let rows: ActiveMembership[] = [];
  // Capture the rows findConservativeMembership reads, so its deciding-row rule decides isAdmin
  // from the same single read the other flags use.
  const capturing: ConservativeMembershipClient = {
    member: {
      async findMany(args) {
        rows = [...(await client.member.findMany(args))];
        return rows;
      },
    },
  };
  const deciding = await findConservativeMembership(capturing, userId, orgId);

  const rowCount = rows.length;
  const allKnown = rows.every((row) => isMemberRole(row.role));
  const isAdmin = rowCount > 0 && allKnown && deciding !== null && isAdminRole(deciding.role);
  const isOwner = rowCount > 0 && rows.every((row) => row.role === "owner");
  const hasOwnerRow = rows.some((row) => row.role === "owner");

  return {
    isMember: rowCount > 0,
    isAdmin,
    isOwner,
    hasOwnerRow,
    rowCount,
    rowIds: rows.map((row) => row.id),
  };
}

/**
 * The number of distinct users of orgId all of whose member rows are `owner` (V-26 (2)): the
 * owner floor. A user with an owner row and any other row (including an unknown role) does not
 * count. One statement, explicit organization term.
 */
export async function countOwners(client: MembershipLockClient, orgId: string): Promise<number> {
  if (!orgId) return 0;
  const rows = await client.$queryRaw<{ owners: number }[]>`
    SELECT count(*)::int AS "owners"
    FROM (
      SELECT "userId"
      FROM "member"
      WHERE "organizationId" = ${orgId}
      GROUP BY "userId"
      HAVING bool_and("role" = 'owner')
    ) AS "allOwner"
  `;
  return Number(rows[0]?.owners ?? 0);
}
