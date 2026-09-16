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
