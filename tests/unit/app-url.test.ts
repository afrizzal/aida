// Phase 10, plan 10-05 (D-06, V-15, threat T-10-20): the app base URL and origin come from
// BETTER_AUTH_URL only, never from a request header.
import { describe, expect, it } from "vitest";
import {
  AppUrlError,
  assertAppUrlAtStart,
  getAppBaseUrl,
  getAppOrigin,
  getTrustedAppOrigins,
} from "@/lib/app-url";

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

  // K165 (a-WR-2, b-IN-4): Better Auth takes any path of BETTER_AUTH_URL as its own base path, so
  // no path-bearing value works (sign-in breaks, or links point into /api/auth). The value must be
  // the bare origin; anything else is refused, never kept in a link.
  it("refuses a path, including /api/auth, with reason not_origin; the base URL is the origin only", () => {
    for (const value of [
      "https://example.test/aida",
      "https://example.test/aida/",
      "https://example.test/api/auth",
      "https://example.test//",
    ]) {
      expect(
        reasonOf(() => getAppBaseUrl({ BETTER_AUTH_URL: value })),
        value,
      ).toBe("not_origin");
      expect(
        reasonOf(() => getAppOrigin({ BETTER_AUTH_URL: value })),
        value,
      ).toBe("not_origin");
      expect(
        reasonOf(() => getTrustedAppOrigins({ BETTER_AUTH_URL: value })),
        value,
      ).toBe("not_origin");
    }
  });

  it("refuses a query string, a fragment and credentials", () => {
    for (const value of [
      "https://example.test?x=1",
      "https://example.test/#frag",
      "https://user:secret@example.test",
    ]) {
      expect(
        reasonOf(() => getAppBaseUrl({ BETTER_AUTH_URL: value })),
        value,
      ).toBe("not_origin");
    }
  });

  it("the not_origin message says what is expected and never carries the value", () => {
    let message = "";
    try {
      getAppBaseUrl({ BETTER_AUTH_URL: "https://secret-host.example.test/secret-path" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("BETTER_AUTH_URL");
    expect(message).toContain("origin");
    expect(message).not.toContain("secret");
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

  it("adds each listed bare origin once, as an origin (a trailing slash is still bare)", () => {
    expect(
      getTrustedAppOrigins({
        BETTER_AUTH_URL: "http://localhost",
        BETTER_AUTH_TRUSTED_ORIGINS:
          " http://localhost, https://localhost/ ,https://help.example.test:8443",
      }),
    ).toEqual(["http://localhost", "https://localhost", "https://help.example.test:8443"]);
  });

  // K182 (Codex diff round 1, LOW): an entry that carries a path, a query, a fragment or
  // credentials is not a bare origin (the K165 rule for BETTER_AUTH_URL), so it is ignored for the
  // accept check instead of being reduced to its origin and trusted fully.
  it("ignores an entry with a path, a query, a fragment or credentials (K182)", () => {
    expect(
      getTrustedAppOrigins({
        BETTER_AUTH_URL: "https://help.example.test",
        BETTER_AUTH_TRUSTED_ORIGINS: [
          "https://path.example.test/x",
          "https://deep.example.test/a/b/",
          "https://query.example.test/?a=1",
          "https://emptyquery.example.test?",
          "https://fragment.example.test/#top",
          "https://emptyfragment.example.test#",
          "https://user:pw@creds.example.test",
          "https://user@user.example.test",
          "https://ok.example.test/",
        ].join(","),
      }),
    ).toEqual(["https://help.example.test", "https://ok.example.test"]);
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

// K165: the start-up check the app (src/instrumentation.ts) and the worker (src/lib/worker/index.ts)
// both run before they serve. A value that is set must be a bare http(s) origin; an unset value is
// left to the existing paths (invitations answer INVITE_CONFIG, the digest pass refuses).
// Run decision K185 (Codex diff round 2): the URL parser normalises dot segments, so "/a/.." or
// "/%2e" became the path "/" and passed as bare. The rule now also reads the raw text: after the
// scheme and the authority only one optional trailing "/" may follow.
describe("the bare-origin rule reads the raw text (K185)", () => {
  const DOT_SEGMENTS = [
    "/a/..",
    "/a/../",
    "/%2e",
    "/%2E",
    "/%2e%2e",
    "/.",
    "/./",
    "/..",
    "\\a\\..",
  ];

  it.each(
    DOT_SEGMENTS,
  )("BETTER_AUTH_URL with %s is refused (not_origin) by every reader", (suffix) => {
    const value = `https://help.example.test${suffix}`;
    // The parser alone would call it bare: the normalised path is "/".
    expect(new URL(value).pathname).toBe("/");
    expect(reasonOf(() => getAppBaseUrl({ BETTER_AUTH_URL: value }))).toBe("not_origin");
    expect(reasonOf(() => getAppOrigin({ BETTER_AUTH_URL: value }))).toBe("not_origin");
    expect(reasonOf(() => getTrustedAppOrigins({ BETTER_AUTH_URL: value }))).toBe("not_origin");
    expect(reasonOf(() => assertAppUrlAtStart({ BETTER_AUTH_URL: value }))).toBe("not_origin");
  });

  it("a trusted-origin entry with a dot segment is ignored; bare entries, with a port or one trailing slash, stay", () => {
    expect(
      getTrustedAppOrigins({
        BETTER_AUTH_URL: "https://help.example.test",
        BETTER_AUTH_TRUSTED_ORIGINS: [
          ...DOT_SEGMENTS.map((suffix, i) => `https://dot${i}.example.test${suffix}`),
          "https://port.example.test:8443",
          "HTTPS://Upper.Example.test/",
        ].join(","),
      }),
    ).toEqual([
      "https://help.example.test",
      "https://port.example.test:8443",
      "https://upper.example.test",
    ]);
  });

  it("a bare BETTER_AUTH_URL still passes, with an optional single trailing slash", () => {
    expect(getAppBaseUrl({ BETTER_AUTH_URL: "https://help.example.test/" })).toBe(
      "https://help.example.test",
    );
    expect(getAppBaseUrl({ BETTER_AUTH_URL: "http://[::1]:3100" })).toBe("http://[::1]:3100");
  });
});

describe("assertAppUrlAtStart", () => {
  it("passes for a bare origin, with or without a trailing slash, and for an unset value", () => {
    for (const env of [
      { BETTER_AUTH_URL: "http://localhost" },
      { BETTER_AUTH_URL: "https://help.example.test/" },
      { BETTER_AUTH_URL: "http://localhost:3100" },
      {},
      { BETTER_AUTH_URL: "  " },
    ]) {
      expect(() => assertAppUrlAtStart(env), JSON.stringify(env)).not.toThrow();
    }
  });

  it("throws AppUrlError for a set value that is not a bare http(s) origin", () => {
    expect(
      reasonOf(() => assertAppUrlAtStart({ BETTER_AUTH_URL: "https://example.test/aida" })),
    ).toBe("not_origin");
    expect(reasonOf(() => assertAppUrlAtStart({ BETTER_AUTH_URL: "not a url" }))).toBe("invalid");
    expect(reasonOf(() => assertAppUrlAtStart({ BETTER_AUTH_URL: "ftp://example.test" }))).toBe(
      "scheme",
    );
  });
});
