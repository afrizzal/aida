import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/scoped-db";

/**
 * Retrieves the current Better Auth session from request headers.
 * Returns null when the request is unauthenticated.
 *
 * Use in Server Components and Server Actions.
 */
export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
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
 * Bridges the authenticated session to a tenant-scoped Prisma client.
 *
 * Reads `session.activeOrganizationId` and returns a `scopedDb` bound to that org.
 * Throws if no active organization is set (use authClient.organization.setActive first).
 *
 * Returns: `{ db, session, orgId }` — `db` is the org-scoped client ready for domain queries.
 *
 * Usage in a Server Component or Server Action:
 *   const { db, orgId } = await getScopedDb();
 *   const settings = await db.setting.findMany();
 */
export async function getScopedDb() {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization on session — cannot scope queries");
  return { db: scopedDb(orgId), session, orgId };
}
