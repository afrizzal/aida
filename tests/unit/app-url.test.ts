// Phase 10, plan 10-05 (D-06, V-15, threat T-10-20): the app base URL and origin come from
// BETTER_AUTH_URL only, never from a request header.
import { describe, expect, it } from "vitest";
import { AppUrlError, getAppBaseUrl, getAppOrigin } from "@/lib/app-url";

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppUrlError);
    return (err as AppUrlError).reason;
  }
  return undefined;
}

describe("getAppBaseUrl and getAppOrigin", () => {
  it("returns the origin for a plain valid URL", () => {
    const env = { BETTER_AUTH_URL: "https://help.example.test" };
    expect(getAppBaseUrl(env)).toBe("https://help.example.test");
    expect(getAppOrigin(env)).toBe("https://help.example.test");
  });

  it("drops a trailing slash and keeps an explicit port", () => {
    const env = { BETTER_AUTH_URL: "http://localhost:3100/" };
    expect(getAppBaseUrl(env)).toBe("http://localhost:3100");
    expect(getAppOrigin(env)).toBe("http://localhost:3100");
  });

  it("keeps a path prefix without its trailing slash; the origin has no path", () => {
    const env = { BETTER_AUTH_URL: "https://example.test/aida/" };
    expect(getAppBaseUrl(env)).toBe("https://example.test/aida");
    expect(getAppOrigin(env)).toBe("https://example.test");
  });

  it("drops a query string and a fragment", () => {
    const env = { BETTER_AUTH_URL: "https://example.test/aida?x=1#frag" };
    expect(getAppBaseUrl(env)).toBe("https://example.test/aida");
  });

  it("throws missing for an absent or blank variable", () => {
    expect(reasonOf(() => getAppBaseUrl({}))).toBe("missing");
    expect(reasonOf(() => getAppBaseUrl({ BETTER_AUTH_URL: "   " }))).toBe("missing");
    expect(reasonOf(() => getAppOrigin({}))).toBe("missing");
  });

  it("throws invalid for a value that does not parse", () => {
    expect(reasonOf(() => getAppBaseUrl({ BETTER_AUTH_URL: "not a url" }))).toBe("invalid");
  });

  it("throws scheme for a non-http scheme", () => {
    for (const value of ["ftp://example.test", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(
        reasonOf(() => getAppBaseUrl({ BETTER_AUTH_URL: value })),
        value,
      ).toBe("scheme");
      expect(
        reasonOf(() => getAppOrigin({ BETTER_AUTH_URL: value })),
        value,
      ).toBe("scheme");
    }
  });

  it("never puts the configured value into the error message", () => {
    let message = "";
    try {
      getAppBaseUrl({ BETTER_AUTH_URL: "ftp://secret-host.example.test" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("secret-host");
  });

  it("reads process.env by default", () => {
    const before = process.env.BETTER_AUTH_URL;
    try {
      process.env.BETTER_AUTH_URL = "https://default.example.test/";
      expect(getAppBaseUrl()).toBe("https://default.example.test");
      expect(getAppOrigin()).toBe("https://default.example.test");
    } finally {
      if (before === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = before;
    }
  });
});
