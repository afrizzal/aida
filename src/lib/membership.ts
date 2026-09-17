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
