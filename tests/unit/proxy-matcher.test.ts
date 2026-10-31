/**
 * Review a-WR-a1 (D-11, K125): the proxy matcher skips only the real static asset paths.
 *
 * Uses Next's own matcher test helper, so the check runs the same path-to-regexp conversion and
 * route matcher that the server uses (including the `_next/data` prefix and `.rsc` suffix it
 * adds), not a copy of the regex. A path that merely starts with an excluded string must still
 * run the proxy, because otherwise it renders HTML without the CSP, the D-14 headers and the
 * K125 guard.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "@/proxy";

type DoesMatch = (args: { config: { matcher?: string[] }; url: string }) => boolean;
let doesMatch: DoesMatch;

beforeAll(async () => {
  // Next's server modules expect the global that its node environment installs.
  const g = globalThis as { AsyncLocalStorage?: unknown };
  g.AsyncLocalStorage ??= AsyncLocalStorage;
  const helper = await import("next/experimental/testing/server");
  doesMatch = helper.unstable_doesMiddlewareMatch as DoesMatch;
});

const runsProxy = (path: string): boolean =>
  doesMatch({ config: { matcher: [...config.matcher] }, url: `http://localhost${path}` });

describe("proxy matcher (review a-WR-a1)", () => {
  it("skips the real build assets under /_next/static/", () => {
    for (const path of [
      "/_next/static/chunks/main-app.js",
      "/_next/static/css/app/layout.css",
      "/_next/static/media/font.woff2",
      "/_next/static/development/_buildManifest.js",
    ]) {
      expect(runsProxy(path), path).toBe(false);
    }
  });

  it("skips the image optimizer endpoint itself", () => {
    expect(runsProxy("/_next/image")).toBe(false);
    expect(runsProxy("/_next/image?url=%2Flogo.png&w=64&q=75")).toBe(false);
  });

  it("runs the proxy on paths that only start with an excluded string", () => {
    for (const path of [
      "/_next/staticX",
      "/_next/static",
      "/_next/image-foo",
      "/_next/image/x",
      "/favicon.ico/x",
      "/favicon.icoX",
      "/faviconXico",
      "/favicon.ico%E0%A4%A",
    ]) {
      expect(runsProxy(path), path).toBe(true);
    }
  });

  it("runs the proxy on /favicon.ico, because the app ships no favicon file", () => {
    expect(runsProxy("/favicon.ico")).toBe(true);
  });

  it("runs the proxy on app pages and API routes", () => {
    for (const path of [
      "/",
      "/login",
      "/tickets",
      "/tickets/abc",
      "/status/abc",
      "/api/health",
      "/tickets/_next/static/x",
    ]) {
      expect(runsProxy(path), path).toBe(true);
    }
  });
});
