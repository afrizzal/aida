import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { findConservativeMembership } from "@/lib/membership";
import { scopedDb } from "@/lib/scoped-db";
import { getCurrentSession } from "@/lib/session";

/**
 * The one page helper of the membership gate (Phase 10, V-27, D-08, AIDA-43). A framework file
 * beside session.ts, because src/lib/membership.ts stays framework-free for the worker.
 *
 * Reads the session once, fresh (getCurrentSession, never the cookie cache, V-23), then the user's
 * member rows in the active organization with the conservative read. Redirects to /login without
 * a session and to /no-access when the session has no active organization (a deactivation sets
 * it to null, D-07 as amended by K178) or the user holds no member row in it. Returns
 * `{ session, orgId, role, db }`, with `db` scoped to exactly `orgId`.
 *
 * Call it FIRST in a layout, a page or a server component that reads tenant data itself, and
 * OUTSIDE any try: redirect() works by throwing, and a catch would swallow it. The (app) layout and
 * its page render in parallel (C6), so the layout's call does not protect the page; each needs its
 * own. A redirect is not authorization: server actions and API routes check membership through
 * getScopedDb or their own service and answer 403.
 */
export async function requirePageAccess() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) redirect("/no-access");
  // Better Auth's member model is outside DOMAIN_MODELS: bare prisma, explicit organization term.
  const member = await findConservativeMembership(prisma, session.user.id, orgId);
  if (!member) redirect("/no-access");
  return { session, orgId, role: member.role, db: scopedDb(orgId) };
}
