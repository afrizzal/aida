import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";

/**
 * Returns the current user's Better Auth org role ("owner" | "admin" | "member") for the
 * active organization, or null if there is no active organization or no membership row.
 * Uses bare `prisma` (never scopedDb) — Better Auth's `member` model has no organizationId
 * allowlist entry in scopedDb (see src/lib/scoped-db.ts).
 */
export async function getOrgRole(): Promise<string | null> {
  const s = await requireSession();
  const orgId = s.session.activeOrganizationId;
  if (!orgId) return null;
  const m = await prisma.member.findFirst({ where: { userId: s.user.id, organizationId: orgId } });
  return m?.role ?? null;
}

/**
 * Server-side admin gate. Throws unless the current user's role in the active organization
 * is "owner" or "admin". Every mutating Settings Server Action must call this first
 * (SECURITY.md: server-side authz on every mutating route, not just hidden UI).
 */
export async function requireOrgAdmin(): Promise<string> {
  const role = await getOrgRole();
  if (role !== "owner" && role !== "admin") throw new Error("Forbidden: admin role required");
  return role;
}
