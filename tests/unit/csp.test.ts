/**
 * AIDA-28 (D-11 to D-14, F-15): CSP builder, nonce factory and static security headers.
 * Pure module, no Prisma, no project imports.
 */
import { describe, expect, it } from "vitest";
import {
  buildCsp,
  CSP_NONCE_HEADER,
  createNonce,
  NO_REFERRER_PATH_PREFIXES,
  SAME_ORIGIN_REFERRER_PATH_PREFIXES,
  securityHeadersFor,
} from "../../src/lib/security/csp";

const PROD_POLICY_ABC =
  "default-src 'self'; " +
  "script-src 'self' 'nonce-abc' 'strict-dynamic'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "style-src-elem 'self' 'nonce-abc' 'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY=' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; " +
  "style-src-attr 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'none'";

function directive(policy: string, name: string): string | undefined {
  return policy
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `))
    ?.slice(name.length)
    .trim();
}

describe("buildCsp (D-11)", () => {
  it("A: production policy is exactly the locked D-11 string", () => {
    expect(buildCsp("abc", { isDev: false })).toBe(PROD_POLICY_ABC);
  });

  it("B: development policy differs only by 'unsafe-eval' appended to script-src", () => {
    const dev = buildCsp("abc", { isDev: true });
    expect(dev).toBe(
      PROD_POLICY_ABC.replace(
        "script-src 'self' 'nonce-abc' 'strict-dynamic';",
        "script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval';",
      ),
    );
    expect(dev).not.toBe(PROD_POLICY_ABC);
  });

  it("C: production policy has no 'unsafe-eval'; script-src and style-src-elem have no 'unsafe-inline'", () => {
    const prod = buildCsp("abc", { isDev: false });
    expect(prod).not.toContain("'unsafe-eval'");
    expect(directive(prod, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(prod, "style-src-elem")).not.toContain("'unsafe-inline'");
  });

  it("D (ordering edge): deterministic, same input gives the identical string", () => {
    expect(buildCsp("xyz", { isDev: false })).toBe(buildCsp("xyz", { isDev: false }));
    expect(buildCsp("xyz", { isDev: true })).toBe(buildCsp("xyz", { isDev: true }));
    const names = buildCsp("xyz", { isDev: false })
      .split("; ")
      .map((d) => d.split(" ")[0]);
    expect(names).toEqual([
      "default-src",
      "script-src",
      "style-src",
      "style-src-elem",
      "style-src-attr",
      "img-src",
      "font-src",
      "connect-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
    ]);
  });
});

describe("createNonce (D-11)", () => {
  it("E: returns base64 of 16 random bytes (24 chars with padding)", () => {
    const nonce = createNonce();
    expect(nonce).toHaveLength(24);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("F (adjacency edge): 1000 calls yield 1000 distinct nonces", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(createNonce());
    expect(seen.size).toBe(1000);
  });
});

describe("securityHeadersFor (D-14)", () => {
  it("G: exports the nonce header name, the no-referrer prefixes and the same-origin prefixes", () => {
    expect(CSP_NONCE_HEADER).toBe("x-nonce");
    expect(NO_REFERRER_PATH_PREFIXES).toEqual(["/status", "/api/public/status"]);
    // K159 (amends D-04): /invite carries an invitation token in its path, and its card posts a
    // form to its own origin, so it gets same-origin: no Referer to any other origin, and the
    // browser sends the real Origin on the card's own post.
    expect(SAME_ORIGIN_REFERRER_PATH_PREFIXES).toEqual(["/invite"]);
  });

  it("H: /status and /api/public/status paths get no-referrer", () => {
    for (const path of ["/status", "/status/abc", "/api/public/status/abc/csat"]) {
      expect(securityHeadersFor(path)).toEqual({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      });
    }
  });

  it("H2 (K159): /invite paths get same-origin, never a policy that sends the path elsewhere", () => {
    for (const path of ["/invite/abc", "/invite/abc/accept"]) {
      expect(securityHeadersFor(path)).toEqual({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "same-origin",
      });
    }
  });

  it("I: other paths get strict-origin-when-cross-origin", () => {
    for (const path of ["/", "/login", "/tickets", "/api/public/request", "/api/public/requests"]) {
      expect(securityHeadersFor(path)["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    }
  });
});
