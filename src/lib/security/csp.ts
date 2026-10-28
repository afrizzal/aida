// Content-Security-Policy and static security headers (D-11 to D-14, AIDA-28, F-15).
//
// src/proxy.ts calls createNonce() once per request, builds the policy with buildCsp() and sets
// it on both the forwarded request (Next.js reads the nonce from the request CSP header and
// stamps it on its framework scripts, page bundles and generated inline tags) and the response.
// Without a CSP an injected script runs freely; the nonce plus 'strict-dynamic' blocks any
// inline script that lacks the per-response nonce, and connect-src 'self' keeps fetch/XHR on
// the same origin.
//
// Why the style directives look the way they do:
// - `style-src-attr 'unsafe-inline'`: Radix positions popovers and menus through `style`
//   attributes, and a nonce can only cover elements, never attributes.
// - `style-src 'self' 'unsafe-inline'` is only the CSP2 fallback. CSP3 browsers use the more
//   specific style-src-elem (nonce, no 'unsafe-inline') and style-src-attr instead.
// - `'unsafe-eval'` is appended to script-src in development only (React debugging tooling);
//   the production policy never carries it. Neither script-src nor style-src-elem ever gets
//   'unsafe-inline'.
//
// This module holds no per-request state: the nonce is created inside each proxy call and
// passed in. Web Crypto and btoa only, no project imports, so it bundles for any runtime.

export const CSP_NONCE_HEADER = "x-nonce";

/** Paths whose URL carries a status token, so the token must never leak through `Referer` (D-14). */
export const NO_REFERRER_PATH_PREFIXES = ["/status", "/api/public/status"] as const;

/** Base64 of 16 cryptographically random bytes (24 characters including padding). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The D-11 policy, directives in a fixed order, joined with "; ". Deterministic for a given input. */
export function buildCsp(nonce: string, opts: { isDev: boolean }): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (opts.isDev) scriptSrc.push("'unsafe-eval'");

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["style-src-elem", ["'self'", `'nonce-${nonce}'`]],
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/**
 * Headers set on every proxy response, redirects and JSON errors included (D-14).
 * X-Frame-Options backs up frame-ancestors 'none' for browsers without CSP2 (Claude's discretion).
 */
export function securityHeadersFor(pathname: string): Record<string, string> {
  const noReferrer = NO_REFERRER_PATH_PREFIXES.some((p) => pathname.startsWith(p));
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": noReferrer ? "no-referrer" : "strict-origin-when-cross-origin",
  };
}
