/**
 * Review a-IN-a4 (D-14, K125): every proxy exit takes its static security headers from the one
 * helper, securityHeadersFor(), so a header added there later reaches every exit, the K125
 * malformed-path 400 included. The helper is wrapped here with an extra sentinel header; an exit
 * that copies its own header set instead of calling the helper misses the sentinel. vi.mock is
 * hoisted above the imports, so the proxy module binds the wrapped helper.
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

const SENTINEL = "x-aida-helper-sentinel";

vi.mock("@/lib/security/csp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/csp")>();
  return {
    ...actual,
    securityHeadersFor: (pathname: string) => ({
      ...actual.securityHeadersFor(pathname),
      [SENTINEL]: "1",
    }),
  };
});

describe("proxy — a-IN-a4 one security-header helper for every exit", () => {
  it("forward, blocked sign-up, 401, redirect and the K125 400 all carry the helper's headers", () => {
    const exits = {
      forward: proxy(new NextRequest("http://localhost/login")),
      blocked: proxy(new NextRequest("http://localhost/api/auth/sign-up/email")),
      unauthorized: proxy(new NextRequest("http://localhost/api/tickets")),
      redirect: proxy(new NextRequest("http://localhost/tickets")),
      malformed: proxy(new NextRequest("http://localhost/tickets/%E0%A4%A")),
    };
    expect(exits.malformed.status).toBe(400);
    for (const [name, response] of Object.entries(exits)) {
      expect(response.headers.get(SENTINEL), name).toBe("1");
      expect(response.headers.get("x-content-type-options"), name).toBe("nosniff");
      expect(response.headers.get("x-frame-options"), name).toBe("DENY");
    }
  });

  it("the K125 400 keeps no-referrer and its static deny-all CSP on a non-status path", () => {
    for (const path of ["/tickets/%E0%A4%A", "/login%2", "/status/%FF"]) {
      const response = proxy(new NextRequest(`http://localhost${path}`));
      expect(response.status, path).toBe(400);
      expect(response.headers.get("referrer-policy"), path).toBe("no-referrer");
      expect(response.headers.get("content-security-policy"), path).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(response.headers.get("content-type"), path).toBe("text/plain; charset=utf-8");
    }
  });
});
