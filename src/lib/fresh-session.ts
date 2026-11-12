// The one Better Auth session read of AIDA (Phase 10, V-23, V-05, D-08).
//
// A cookie cache would keep a signed copy of the session object, its activeOrganizationId
// included, in a second cookie. That copy is never the source of truth for the session or its
// organization: a session row deleted after sign-in (sign-out elsewhere) or an
// activeOrganizationId changed in the database (deactivation setting it to null, D-07 as amended
// by K178; invitation accept, V-23) must be seen on the next request. So the cache is off (src/lib/auth.ts, R10-1) and every
// read also passes disableCookieCache, which makes Better Auth skip any cached-data cookie (a
// browser may still hold one from before) and look the session token up in the database.
//
// A read of a valid session sets no cookie (R10-1): Next.js re-renders the route of a server
// action that sets one, which would drop the page's client state after a refused action. With
// the cache on, Better Auth ends this read by rewriting the cache cookie; the R10-1 case in
// tests/integration/membership-gate.test.ts fails then.
//
// This is the only getSession call under src (the membership inventory, Rule C, enforces it):
// getCurrentSession in session.ts, and through it requireSession, getScopedDb, getSessionActor and
// the authz gates, plus the palette and picker routes, all read through here.
//
// Relative imports only and no next/* import, so a route handler can pass its request headers and
// an integration test can call it without a Next request scope.
import { auth } from "./auth";

/** The session for these request headers, read from the database (never the cookie cache). */
export async function readFreshSession(requestHeaders: Headers) {
  return auth.api.getSession({ headers: requestHeaders, query: { disableCookieCache: true } });
}
