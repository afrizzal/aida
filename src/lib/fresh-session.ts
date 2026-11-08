// The one Better Auth session read of AIDA (Phase 10, V-23, V-05, D-08).
//
// The cookie cache (src/lib/auth.ts, 300 s) keeps a signed copy of the session object, its
// activeOrganizationId included, in a second cookie. That copy is never the source of truth for
// the session or its organization: a session row deleted after sign-in (sign-out elsewhere,
// deactivation moving or deleting sessions, D-07) or an activeOrganizationId changed in the
// database (invitation accept, V-23) must be seen on the next request, not five minutes later.
// So every session read passes disableCookieCache, which makes Better Auth skip the cached-data
// cookie and look the session token up in the database.
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
