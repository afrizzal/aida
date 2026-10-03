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
 * Only publishProposal (src/lib/kb/proposal-review.ts) uses it, as its transaction's first
 * statement. findActiveMembership above is unchanged and stays the plain read of every other path.
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
    LIMIT 1
    FOR SHARE
  `;
  const row = rows[0];
  return row ? { id: row.id, role: row.role } : null;
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
