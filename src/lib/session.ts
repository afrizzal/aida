import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readFreshSession } from "@/lib/fresh-session";
import { AccessDeniedError, findConservativeMembership } from "@/lib/membership";
import { scopedDb } from "@/lib/scoped-db";

/**
 * Retrieves the current Better Auth session from request headers.
 * Returns null when the request is unauthenticated.
 *
 * Every read is fresh (Phase 10, V-23): it goes through readFreshSession (src/lib/fresh-session.ts),
 * so a cookie cache is never the source of truth for the session or its active organization (the
 * cache is off, src/lib/auth.ts, R10-1). Use in Server Components and Server Actions.
 */
export async function getCurrentSession() {
  return readFreshSession(await headers());
}

/**
 * Retrieves the current session, redirecting to /login if unauthenticated.
 * Use in protected Server Components and Server Actions.
 */
export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Bridges the authenticated session to a tenant-scoped Prisma client, behind the membership gate
 * (Phase 10, D-08, AIDA-43).
 *
 * Reads the session once (K141; redirects to /login without one), then re-reads the user's member
 * rows in the session's active organization from the database on every call with the conservative
 * read (findConservativeMembership: every row in id order, admin only when every row is owner or
 * admin). Throws AccessDeniedError (status 403, code MEMBERSHIP_ENDED) when no organization is
 * active or the user holds no member row in it, so a removed member never gets a tenant client,
 * whatever the cookie holds. A server action catches it with nullOnAccessDenied (K164).
 *
 * Returns: `{ db, session, orgId, role }`. `db` is the org-scoped client ready for domain queries
 * and `role` is the conservative role in exactly `orgId`.
 *
 * Usage in a Server Action or route handler:
 *   const { db, orgId } = await getScopedDb();
 *   const settings = await db.setting.findMany();
 * A page calls requirePageAccess (src/lib/page-access.ts) instead, which redirects to /no-access.
 */
export async function getScopedDb() {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new AccessDeniedError("No active organization on session");
  // Better Auth's member model is outside DOMAIN_MODELS: bare prisma, explicit organization term.
  const member = await findConservativeMembership(prisma, session.user.id, orgId);
  if (!member) throw new AccessDeniedError();
  return { db: scopedDb(orgId), session, orgId, role: member.role };
}

/**
 * The acting user and organization for a Phase 11 server action or route (D-01).
 *
 * Reads the session once (fresh, like getCurrentSession; same redirect when unauthenticated) and
 * its `activeOrganizationId`, and returns `{ userId, orgId }`. Throws AccessDeniedError (status
 * 403, code MEMBERSHIP_ENDED) when no organization is active, as getScopedDb does (K164, review
 * a-WR-1): a deactivation sets the removed member's sessions on that organization to null (D-07
 * as amended by K178), and every caller catches this with nullOnAccessDenied and returns its typed
 * MEMBERSHIP_ENDED refusal. It does NOT check membership, by contract: every caller passes the actor to
 * a service that checks the member row itself inside its own read or transaction (for example
 * runTicketMutation through findActiveMembership, src/lib/membership.ts). The membership
 * inventory (tests/unit/membership-inventory.test.ts, Rule A) accepts it as a gate only when the
 * entry also calls such a service.
 */
export async function getSessionActor(): Promise<{ userId: string; orgId: string }> {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new AccessDeniedError("No active organization on session");
  return { userId: session.user.id, orgId };
}
