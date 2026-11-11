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

/**
 * Paths whose URL carries a status token (D-14), so the token must never leak through `Referer`.
 * Their pages post no form that needs an Origin.
 */
export const NO_REFERRER_PATH_PREFIXES = ["/status", "/api/public/status"] as const;

/**
 * Paths whose URL carries an invitation token (plan 10-15 V-04) and whose page posts a form to its
 * own origin (K159, amends D-04). `same-origin` sends a Referer only to AIDA itself, which already
 * has the token, and never to another origin; and under it the browser sends the page's real
 * Origin on the card's own post, so the accept route can require an exact Origin match. Under
 * `no-referrer` the browser sends that post with `Origin: null`.
 */
export const SAME_ORIGIN_REFERRER_PATH_PREFIXES = ["/invite"] as const;

/**
 * sonner 2.0.7 injects one static <style> at module load (`__insertCSS` in dist/index.mjs) and
 * offers no nonce option, so the strict style-src-elem blocked it (plan 08-08 E2E). Its CSS is a
 * fixed string, so a hash allows exactly that text and nothing else. The element is appended to
 * <head> empty before its text node, hence the empty-string hash as well. Proven need only
 * (D-11); tests/unit/csp-style-hashes.test.ts recomputes the hash from the installed sonner, so a
 * version bump that changes the CSS fails loudly instead of silently breaking toasts.
 */
export const SONNER_STYLE_HASH = "'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY='";
export const EMPTY_STYLE_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

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
    ["style-src-elem", ["'self'", `'nonce-${nonce}'`, SONNER_STYLE_HASH, EMPTY_STYLE_HASH]],
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
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": referrerPolicyFor(pathname),
  };
}

function referrerPolicyFor(pathname: string): string {
  if (NO_REFERRER_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return "no-referrer";
  if (SAME_ORIGIN_REFERRER_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return "same-origin";
  return "strict-origin-when-cross-origin";
}
