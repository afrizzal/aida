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

  it("I (D-12): client-sent x-nonce and CSP request headers are overwritten", async () => {
    const request = new NextRequest("http://localhost/login", {
      headers: { "x-nonce": "attacker", "content-security-policy": "default-src *" },
    });
    const response = proxy(request);
    const csp = response.headers.get("content-security-policy") ?? "";
    const forwardedNonce = response.headers.get("x-middleware-request-x-nonce");
    expect(forwardedNonce).not.toBe("attacker");
    expect(forwardedNonce).toBe(cspNonce(csp));
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(csp).not.toContain("default-src *");
  });

  it("J (D-12): an empty client x-nonce still yields a server nonce of at least 22 characters", async () => {
    const request = new NextRequest("http://localhost/login", { headers: { "x-nonce": "" } });
    const response = proxy(request);
    const nonce = response.headers.get("x-middleware-request-x-nonce") ?? "";
    expect(nonce.length).toBeGreaterThanOrEqual(22);
    expect(cspNonce(response.headers.get("content-security-policy") ?? "")).toBe(nonce);
  });

  it("K (D-11): authenticated request to /tickets gets the CSP and security headers", async () => {
    const request = new NextRequest("http://localhost/tickets", {
      headers: { cookie: "better-auth.session_token=abc" },
    });
    const response = proxy(request);
    expect(response.status).not.toBe(307);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("'strict-dynamic'");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(cspNonce(csp));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("L (D-11): 50 sequential calls produce 50 distinct nonces", async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const response = proxy(new NextRequest("http://localhost/login"));
      nonces.add(response.headers.get("x-middleware-request-x-nonce") ?? "");
    }
    expect(nonces.size).toBe(50);
    expect(nonces.has("")).toBe(false);
  });

  it("M (D-14): referrer policy is no-referrer on status paths, strict-origin elsewhere", async () => {
    for (const path of ["/status/abc", "/api/public/status/abc/csat"]) {
      const response = proxy(new NextRequest(`http://localhost${path}`));
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    const login = proxy(new NextRequest("http://localhost/login"));
    expect(login.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    const tickets = proxy(
      new NextRequest("http://localhost/tickets", {
        headers: { cookie: "better-auth.session_token=abc" },
      }),
    );
    expect(tickets.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("N (D-14): redirect, 401 JSON and blocked sign-up 403 carry nosniff and DENY", async () => {
    const redirect = proxy(new NextRequest("http://localhost/tickets"));
    const unauthorized = proxy(new NextRequest("http://localhost/api/tickets/x/messages"));
    const blocked = proxy(new NextRequest("http://localhost/api/auth/sign-up/email"));
    expect(redirect.status).toBe(307);
    expect(unauthorized.status).toBe(401);
    expect(blocked.status).toBe(403);
    for (const response of [redirect, unauthorized, blocked]) {
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    }
  });

  it("O: the blocked sign-up route returns 403 before any public-prefix handling", async () => {
    const response = proxy(new NextRequest("http://localhost/api/auth/sign-up/email"));
    expect(response.status).toBe(403);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});

// K125 (plan 08-08 fix 1): a path whose percent-encoding cannot be decoded is answered by the
// proxy itself, first, with a plain-text 400 under a static deny-all CSP. Next.js would otherwise
// render its HTML error page with framework scripts and drop the proxy's response headers.
const STRICT_ERROR_CSP = "default-src 'none'; frame-ancestors 'none'";

async function expectMalformedPathRejection(response: Response): Promise<void> {
  expect(response.status).toBe(400);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("content-security-policy")).toBe(STRICT_ERROR_CSP);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-middleware-next")).toBeNull();
  expect(response.headers.get("x-middleware-request-x-nonce")).toBeNull();
  const body = await response.text();
  expect(body).toBe("Bad Request: malformed percent-encoding in the URL path.\n");
  expect(body).not.toContain("<");
}

describe("proxy — K125 malformed path encoding guard", () => {
  it("P: incomplete percent escapes are rejected with a plain-text 400 and the strict CSP", async () => {
    for (const path of ["/status/%E0%A4%A", "/status/%", "/request/%A", "/login%2", "/%"]) {
      await expectMalformedPathRejection(proxy(new NextRequest(`http://localhost${path}`)));
    }
  });

  it("Q: invalid UTF-8 byte sequences are rejected with a plain-text 400 and the strict CSP", async () => {
    for (const path of ["/status/%FF", "/request/%C3%28", "/status/%ED%A0%80", "/%C0%AF"]) {
      await expectMalformedPathRejection(proxy(new NextRequest(`http://localhost${path}`)));
    }
  });

  it("R: the guard runs before the blocked sign-up, public prefix and redirect branches", async () => {
    // Blocked route: would be 403 JSON; public prefix: would forward; protected: would redirect.
    for (const path of ["/api/auth/sign-up/%FF", "/api/public/intake%E0", "/tickets/%E0%A4%A"]) {
      await expectMalformedPathRejection(proxy(new NextRequest(`http://localhost${path}`)));
    }
    const authed = proxy(
      new NextRequest("http://localhost/tickets/%FF", {
        headers: { cookie: "better-auth.session_token=abc" },
      }),
    );
    await expectMalformedPathRejection(authed);
  });

  it("S: a valid escaped path still reaches normal behaviour with the nonce CSP", async () => {
    for (const path of ["/status/abc%20def", "/request/%E0%A4%A4", "/status/%25E0"]) {
      const response = proxy(new NextRequest(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("'strict-dynamic'");
      expect(response.headers.get("x-middleware-request-x-nonce")).toBe(cspNonce(csp));
    }
    const redirect = proxy(new NextRequest("http://localhost/tickets/caf%C3%A9"));
    expect(redirect.status).toBe(307);
  });

  it("T: a malformed query alone does not trigger the guard", async () => {
    const status = proxy(new NextRequest("http://localhost/status/abc?x=%E0%A4%A&y=%"));
    expect(status.status).toBe(200);
    expect(status.headers.get("x-middleware-next")).toBe("1");
    expect(status.headers.get("content-security-policy") ?? "").toContain("'strict-dynamic'");
    const redirect = proxy(new NextRequest("http://localhost/tickets?q=%FF"));
    expect(redirect.status).toBe(307);
    const unauthorized = proxy(new NextRequest("http://localhost/api/tickets?q=%"));
    expect(unauthorized.status).toBe(401);
  });
});
