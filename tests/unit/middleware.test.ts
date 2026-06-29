/**
 * AIDA-10: server-side auth-gate contract
 * Verifies edge middleware enforces authentication on (app) routes
 * without importing Prisma (Edge-safe).
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

describe("middleware — AIDA-10 auth gate", () => {
  it("A: redirects unauthenticated request on protected route to /login", async () => {
    const request = new NextRequest("http://localhost/tickets");
    const response = middleware(request);
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location.endsWith("/login")).toBe(true);
  });

  it("B: passes through /login without redirect", async () => {
    const request = new NextRequest("http://localhost/login");
    const response = middleware(request);
    // passthrough = not a redirect (status is not 3xx)
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("C: passes through /api/health without redirect", async () => {
    const request = new NextRequest("http://localhost/api/health");
    const response = middleware(request);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("D: passes through /setup without redirect", async () => {
    const request = new NextRequest("http://localhost/setup");
    const response = middleware(request);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("E: passes through /api/auth/callback without redirect", async () => {
    const request = new NextRequest("http://localhost/api/auth/callback");
    const response = middleware(request);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });
});
