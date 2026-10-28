/**
 * AIDA-10: server-side auth-gate contract
 * AIDA-28 (D-11 to D-14): nonce CSP and security headers on proxy exits
 * Verifies the proxy enforces authentication on (app) routes. Proxy runs on the
 * Node.js runtime in Next 16; this test still imports no Prisma.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

function cspNonce(csp: string): string | undefined {
  return /'nonce-([^']+)'/.exec(csp)?.[1];
}

describe("proxy — AIDA-10 auth gate", () => {
  it("A: redirects unauthenticated request on protected route to /login", async () => {
    const request = new NextRequest("http://localhost/tickets");
    const response = proxy(request);
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location.endsWith("/login")).toBe(true);
  });

  it("B: passes through /login without redirect", async () => {
    const request = new NextRequest("http://localhost/login");
    const response = proxy(request);
    // passthrough = not a redirect (status is not 3xx)
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("C: passes through /api/health without redirect", async () => {
    const request = new NextRequest("http://localhost/api/health");
    const response = proxy(request);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("D: passes through /setup without redirect", async () => {
    const request = new NextRequest("http://localhost/setup");
    const response = proxy(request);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("E: passes through /api/auth/callback without redirect", async () => {
    const request = new NextRequest("http://localhost/api/auth/callback");
    const response = proxy(request);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("F (07-09 GAP 1 fix): blocks anonymous self-registration with 403 JSON", async () => {
    const request = new NextRequest("http://localhost/api/auth/sign-up/email");
    const response = proxy(request);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/self-registration is disabled/i);
  });

  it("G (07-09 GAP 1 fix): other /api/auth/* routes still pass through unaffected", async () => {
    const request = new NextRequest("http://localhost/api/auth/sign-in/email");
    const response = proxy(request);
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("H (D-11): CSP with nonce on /login", async () => {
    const response = proxy(new NextRequest("http://localhost/login"));
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("'strict-dynamic'");
    const nonce = cspNonce(csp);
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });
});
