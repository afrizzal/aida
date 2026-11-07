import { prisma } from "@/lib/db";
import { findConservativeMembership, isAdminRole } from "@/lib/membership";
import { scopedDb } from "@/lib/scoped-db";
import { requireSession } from "@/lib/session";

type Session = Awaited<ReturnType<typeof requireSession>>;

/** The active organization and the caller's role in it, both from ONE session read. */
export type ActiveOrgAccess = {
  session: Session;
  /** null when the session has no active organization. */
  orgId: string | null;
  /** The member row's role in exactly `orgId`; null without an organization or a member row. */
  role: string | null;
};

/**
 * Reads the session once and looks up the caller's role in that session's active organization
 * (K141, Phase 9 review c-CR-01). Every gate that authorizes a write must take the organization
 * it writes to and the role it checks from this one result: two separate session reads (for
 * example getScopedDb() and getOrgRole()) can see different active organizations when an
 * organization/set-active commits between them, so the role could come from organization A while
 * the write goes to organization B.
 *
 * The role is the conservative read (K151, Codex diff critique round 1, finding 4): the member table
 * has no unique key on (organizationId, userId), so a user can hold an admin row and a plain member
 * row in one organization. findConservativeMembership reads every row in id order and returns an
 * admin role only when EVERY row is owner or admin; a single unordered row could be either.
 *
 * Redirects to /login without a session (requireSession). Uses bare `prisma` (never scopedDb):
 * Better Auth's `member` model has no organizationId allowlist entry in scopedDb (see
 * src/lib/scoped-db.ts).
 */
export async function getActiveOrgAccess(): Promise<ActiveOrgAccess> {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId ?? null;
  if (!orgId) return { session, orgId: null, role: null };
  const member = await findConservativeMembership(prisma, session.user.id, orgId);
  return { session, orgId, role: member?.role ?? null };
}

/**
 * Returns the current user's Better Auth org role ("owner" | "admin" | "member") for the
 * active organization, or null if there is no active organization or no membership row.
 * For display only; a write is authorized through requireOrgAdminScope (or getActiveOrgAccess),
 * never by combining this with a separate getScopedDb() read.
 */
export async function getOrgRole(): Promise<string | null> {
  return (await getActiveOrgAccess()).role;
}

/**
 * Server-side admin gate for a write (K141). Reads the session once, throws unless the caller's
 * role in the active organization includes "owner" or "admin" (isAdminRole, the one rule for every
 * admin check), and returns the scoped client for exactly that organization. Every mutating
 * Settings Server Action calls this first and writes only through the returned `db`/`orgId`
 * (SECURITY.md: server-side authz on every mutating route, not just hidden UI).
 */
export async function requireOrgAdminScope(): Promise<{
  db: ReturnType<typeof scopedDb>;
  session: Session;
  orgId: string;
  role: string;
}> {
  const { session, orgId, role } = await getActiveOrgAccess();
  if (!orgId || !role || !isAdminRole(role)) throw new Error("Forbidden: admin role required");
  return { db: scopedDb(orgId), session, orgId, role };
}

/**
 * Admin gate that returns only the role. Kept for callers that write nothing; a write must use
 * requireOrgAdminScope so the role and the organization come from the same session read.
 */
export async function requireOrgAdmin(): Promise<string> {
  return (await requireOrgAdminScope()).role;
}
