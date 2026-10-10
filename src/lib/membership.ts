// Active-membership check for every new Phase 11 server path (D-01): the ticket mutation
// service, the saved-view actions, the palette search endpoint and the auto-close settings
// action. Same name and signature as parked Phase 10 planned, so Phase 10 extends it
// (member deactivation) when it returns. In this phase "active" means the member row exists.
//
// Relative imports only and no framework import: the worker and plain services call it.

export interface ActiveMembership {
  id: string;
  role: string;
}

/**
 * The client findActiveMembership needs. Typed structurally so the global prisma client, a
 * scopedDb client and an interactive transaction client all fit. `member` is a Better Auth
 * model outside DOMAIN_MODELS, so the organization predicate is always written explicitly.
 */
export interface MembershipClient {
  member: {
    findFirst(args: {
      where: { userId: string; organizationId: string };
      select: { id: true; role: true };
    }): PromiseLike<ActiveMembership | null>;
  };
}

/** Returns the member row's id and role, or null when the user is not a member of orgId. */
export async function findActiveMembership(
  client: MembershipClient,
  userId: string,
  orgId: string,
): Promise<ActiveMembership | null> {
  if (!userId || !orgId) return null;
  const row = await client.member.findFirst({
    where: { userId, organizationId: orgId },
    select: { id: true, role: true },
  });
  return row ? { id: row.id, role: row.role } : null;
}

/**
 * The client findConservativeMembership needs: every member row of the user in the organization,
 * in id order. Typed structurally like MembershipClient, so the global prisma client, a scopedDb
 * client and an interactive transaction client all fit.
 */
export interface ConservativeMembershipClient {
  member: {
    findMany(args: {
      where: { userId: string; organizationId: string };
      select: { id: true; role: true };
      orderBy: { id: "asc" };
    }): PromiseLike<ActiveMembership[]>;
  };
}

/**
 * The deciding row of a user's member rows in one organization, given in id order: the first row
 * whose role is not an admin role, or else the first row; null when there is none. isAdminRole on
 * the result is therefore true only when EVERY row is owner or admin (review a-WR-03).
 */
function decidingRow(rows: readonly ActiveMembership[]): ActiveMembership | null {
  const row = rows.find((candidate) => !isAdminRole(candidate.role)) ?? rows[0];
  return row ? { id: row.id, role: row.role } : null;
}

/**
 * The conservative membership read of every new Phase 12.2 path (run decision K59, Codex diff
 * critique D1): the KB proposal loaders, the request, save, reject, restart, retry indexing, the
 * generation job's requester check and the /kb page's Proposals link. The member table has no
 * unique key on (organizationId, userId) until owner item 12.2-o4 adds one, so a user can hold
 * an admin row and a plain member row in the same organization, and findActiveMembership's
 * single unordered row could be either. This reads ALL rows of the user in the organization,
 * ordered by id, and returns the deciding row (decidingRow): admin only when every row is owner
 * or admin, the rule publish applies under its lock (shareLockActiveMembership). null when there
 * is no row. Read on every call, so a role change on any row is seen by the next one.
 *
 * findActiveMembership above is unchanged and stays the read of the paths of earlier phases.
 */
export async function findConservativeMembership(
  client: ConservativeMembershipClient,
  userId: string,
  orgId: string,
): Promise<ActiveMembership | null> {
  if (!userId || !orgId) return null;
  const rows = await client.member.findMany({
    where: { userId, organizationId: orgId },
    select: { id: true, role: true },
    orderBy: { id: "asc" },
  });
  return decidingRow(rows);
}

/**
 * The client shareLockActiveMembership needs: any client that runs a tagged raw query (the
 * StateQueryClient shape of tickets/ticket-states.ts), in practice an interactive transaction.
 */
export interface MembershipLockClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/**
 * Like findActiveMembership (same result: the member row's id and role, or null), but locks the
 * row FOR SHARE for the rest of the caller's transaction (Phase 12.2, review C1). A role change
 * (UPDATE member SET role) or a member delete must wait for a publish that already authorized
 * against the row, and a publish that waited behind a committed demotion or delete sees the new
 * role or no row (READ COMMITTED re-reads the locked row). Better Auth's table is "member"
 * (columns id, organizationId, userId, role), outside DOMAIN_MODELS, so both the user and the
 * organization terms are explicit.
 *
 * Review a-WR-03: the member table has no unique key on (organizationId, userId), so a user can
 * hold more than one row in an organization. Every such row is locked FOR SHARE, in id order (one
 * statement, so two publishes lock in the same order), and the result is the deciding row: the
 * first row, by id, whose role is not an admin role, or else the first row. isAdminRole on the
 * result is therefore true only when EVERY row of the user in the organization is owner or admin,
 * and a demotion or a delete of any of those rows waits for the publish. null when there is no
 * row.
 *
 * Only publishProposal (src/lib/kb/proposal-review.ts) uses it, as its transaction's first
 * statement. findActiveMembership above is unchanged and stays the plain read of the paths of earlier
 * phases; the other new 12.2 paths use findConservativeMembership (run decision K59).
 */
export async function shareLockActiveMembership(
  client: MembershipLockClient,
  userId: string,
  orgId: string,
): Promise<ActiveMembership | null> {
  if (!userId || !orgId) return null;
  const rows = await client.$queryRaw<ActiveMembership[]>`
    SELECT "id", "role"
    FROM "member"
    WHERE "userId" = ${userId} AND "organizationId" = ${orgId}
    ORDER BY "id"
    FOR SHARE
  `;
  return decidingRow(rows);
}

const ADMIN_ROLES = new Set(["owner", "admin"]);

/**
 * The one owner/admin rule (review IN-05). Every admin check (settings pages and actions,
 * auto-close, shared saved views) goes through here. The role must be exactly "owner" or
 * "admin": AIDA never assigns combined roles, so a comma-separated value such as "member,admin"
 * is refused. This keeps the v1 gate in requireOrgAdmin unchanged (the conservative reading for
 * an authorization rule); role management belongs to Phase 10.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return ADMIN_ROLES.has(role);
}
