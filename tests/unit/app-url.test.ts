// Phase 10, plan 10-05 (D-06, V-15, threat T-10-20): the app base URL and origin come from
// BETTER_AUTH_URL only, never from a request header.
import { describe, expect, it } from "vitest";
import { AppUrlError, getAppBaseUrl, getAppOrigin, getTrustedAppOrigins } from "@/lib/app-url";

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

// K159 (b-WR-1): the invitation accept route compares the Origin header for exact equality with
// one of these origins: the origin of BETTER_AUTH_URL, plus each origin listed in
// BETTER_AUTH_TRUSTED_ORIGINS (the list Better Auth already trusts for its own CSRF checks). The
// shipped default serves https://localhost while BETTER_AUTH_URL is http://localhost, so both
// schemes are listed there.
describe("getTrustedAppOrigins", () => {
  it("is the configured origin alone when no trusted origins are set", () => {
    expect(getTrustedAppOrigins({ BETTER_AUTH_URL: "http://localhost:3100/" })).toEqual([
      "http://localhost:3100",
    ]);
  });

  it("adds each listed origin once, as an origin (no path, no trailing slash)", () => {
    expect(
      getTrustedAppOrigins({
        BETTER_AUTH_URL: "http://localhost",
        BETTER_AUTH_TRUSTED_ORIGINS:
          " http://localhost, https://localhost/ ,https://help.example.test/x",
      }),
    ).toEqual(["http://localhost", "https://localhost", "https://help.example.test"]);
  });

  it("skips entries that are not exact http(s) origins: wildcards, other schemes, garbage, null", () => {
    expect(
      getTrustedAppOrigins({
        BETTER_AUTH_URL: "https://help.example.test",
        BETTER_AUTH_TRUSTED_ORIGINS:
          "https://*.example.test,*,ftp://files.example.test,not a url,null,,chrome-extension://abc",
      }),
    ).toEqual(["https://help.example.test"]);
  });

  it("throws like getAppOrigin when BETTER_AUTH_URL is missing or invalid", () => {
    expect(
      reasonOf(() =>
        getTrustedAppOrigins({ BETTER_AUTH_TRUSTED_ORIGINS: "https://a.example.test" }),
      ),
    ).toBe("missing");
    expect(reasonOf(() => getTrustedAppOrigins({ BETTER_AUTH_URL: "not a url" }))).toBe("invalid");
  });
});
