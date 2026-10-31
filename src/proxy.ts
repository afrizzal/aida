import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { CLIENT_IP_HEADER, getClientIp } from "./lib/rate-limit/client-ip";
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
//
// Client identity (D-18, AIDA-29): the same overwrite applies to `x-aida-client-ip`. The proxy is
// its only writer: it is set from getClientIp() on every forwarded request, replacing anything a
// client sent, and Better Auth reads only this header (src/lib/auth.ts,
// advanced.ipAddress.ipAddressHeaders), so its limiter keys on the same identity as the routes.
function forwardWithSecurityHeaders(request: NextRequest, pathname: string) {
  const nonce = createNonce();
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set(CLIENT_IP_HEADER, getClientIp(request));

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

// K125 (plan 08-08, AIDA-28): a path whose percent-encoding cannot be decoded (an incomplete
// escape such as `%E0%A4%A`, or bytes that are not valid UTF-8) makes Next.js render its HTML 400
// page with framework scripts and without this proxy's response headers, so that page would carry
// no CSP. The proxy answers such a path itself, first, before every other branch: plain text, no
// HTML, no script, under a static deny-all policy. Only the path is checked, never the query, and
// the decoded value is thrown away; routing keeps using the raw pathname.
const MALFORMED_PATH_CSP = "default-src 'none'; frame-ancestors 'none'";
const MALFORMED_PATH_BODY = "Bad Request: malformed percent-encoding in the URL path.\n";

function hasMalformedPathEncoding(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}

function malformedPathResponse() {
  return new NextResponse(MALFORMED_PATH_BODY, {
    status: 400,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Security-Policy": MALFORMED_PATH_CSP,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (hasMalformedPathEncoding(pathname)) return malformedPathResponse();

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

// Matcher exclusions (D-11, review C13, R2-9, a-WR-a1): the proxy skips only two anchored paths.
// - `/_next/static/` with its trailing slash: the immutable build JS, CSS and media files.
// - exactly `/_next/image`: the image optimizer endpoint (unused: src/ has no next/image import),
//   which answers with an image or a plain-text error.
// Anything that merely starts with those strings, such as `/_next/staticX` or `/_next/image-foo`,
// runs the proxy, because Next.js renders the app's HTML not-found page for it. There is no
// favicon exclusion: the app ships no favicon file (public/ holds only .gitkeep, and src/app has
// no favicon or icon file), so `/favicon.ico` is an ordinary path that gets the proxy's
// redirect or not-found page with the CSP. Every other path, including 404 pages, errors
// returned by routes and any route added later, runs this proxy and gets the CSP, the security
// headers and the K125 guard above. tests/unit/proxy-matcher.test.ts checks the matcher with
// Next's own matcher helper. Never place a future HTML route under an excluded path.
export const config = { matcher: ["/((?!_next/static/|_next/image$).*)"] };
