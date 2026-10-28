import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { buildCsp, CSP_NONCE_HEADER, createNonce, securityHeadersFor } from "./lib/security/csp";

const PUBLIC_PREFIXES = [
  "/login",
  "/setup",
  "/api/auth",
  "/api/health",
  "/request",
  "/status",
  "/api/public",
];

// FIX 1 (07-09, GAP 1): Better Auth's emailAndPassword provider has no sign-up gate
// (src/lib/auth.ts sets only `enabled: true`), so POST /api/auth/sign-up/email is reachable
// by anyone on every deployment. Because every first-run gate (src/lib/bootstrap.ts,
// src/app/(auth)/setup/{page,actions}.ts, src/app/(auth)/login/page.tsx) keys off the same
// global `prisma.user.count()`, one anonymous request before the operator finishes /setup
// permanently becomes the sole user: /setup then redirects to /login forever, completeSetup
// refuses, and organization({ allowUserToCreateOrganization: false }) means the attacker
// cannot self-serve an org either. Recovery would need a manual `DELETE FROM "user"` — there
// is no in-product path. `disableSignUp: true` was considered and rejected: it would also
// disable the three server-side, in-process auth.api.signUpEmail() callers that legitimately
// bootstrap the product — src/app/(auth)/setup/actions.ts, src/lib/bootstrap.ts, and
// src/lib/demo/identities.ts. Those calls go straight to Better Auth's internal handler and
// never traverse this proxy, so blocking only the HTTP route below closes the anonymous path
// while leaving every legitimate bootstrap path intact. This check MUST run before the
// PUBLIC_PREFIXES allow-list below, because "/api/auth" is itself a public prefix and would
// otherwise short-circuit past it.
const BLOCKED_PUBLIC_ROUTES = ["/api/auth/sign-up"];

// CSP (D-11, D-12, AIDA-28, F-15): every request that passes through gets a fresh nonce and the
// nonce policy from src/lib/security/csp.ts. Next.js reads the nonce from the *request*
// Content-Security-Policy header during rendering and stamps it on its framework scripts, page
// bundles and generated inline tags; the root layout reads `x-nonce` and hands it to next-themes.
// Both request headers are overwritten here, never merged, because a client could otherwise send
// its own `x-nonce` or a permissive policy and have the app trust it (D-12). The nonce is created
// inside this call, never at module level, so two requests can never share one.
function forwardWithSecurityHeaders(request: NextRequest, pathname: string) {
  const nonce = createNonce();
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return withSecurityHeaders(response, pathname);
}

// D-14: every exit, the JSON errors and the redirect included, carries nosniff, X-Frame-Options
// and the referrer policy. One helper so the exits cannot drift. JSON and redirect bodies carry
// no HTML, so they get no CSP.
function withSecurityHeaders(response: NextResponse, pathname: string) {
  for (const [name, value] of Object.entries(securityHeadersFor(pathname))) {
    response.headers.set(name, value);
  }
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (BLOCKED_PUBLIC_ROUTES.some((p) => pathname.startsWith(p))) {
    return withSecurityHeaders(
      NextResponse.json(
        {
          error:
            "Public self-registration is disabled. Ask an administrator to invite you, or complete /setup if this is a fresh install.",
        },
        { status: 403 },
      ),
      pathname,
    );
  }

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return forwardWithSecurityHeaders(request, pathname);
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    // API callers need a machine-readable 401 — a redirect lands them on the login page's HTML with a 200.
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json({ error: "unauthorized" }, { status: 401 }),
        pathname,
      );
    }
    return withSecurityHeaders(NextResponse.redirect(new URL("/login", request.url)), pathname);
  }
  return forwardWithSecurityHeaders(request, pathname);
}

// Matcher exclusions (D-11, review C13, R2-9): the proxy skips `_next/static` (immutable build
// JS and CSS chunks), `_next/image` (the image optimizer, unused: src/ has no next/image import)
// and `favicon.ico` (a static icon). None of them returns HTML, so none needs a CSP. Every other
// path, including 404 pages, errors returned by routes and any route added later, runs this
// proxy and gets the CSP and security headers. Responses Next.js produces before the proxy runs
// (for example the 400 for a malformed percent-encoded path) never reach it; plan 08-08 records
// that boundary. Never place a future HTML route under an excluded prefix.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
