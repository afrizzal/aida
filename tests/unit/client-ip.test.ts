import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_IP_HEADER,
  canonicalizeIp,
  getClientIp,
  getRateLimitIdentity,
  MAX_TRUSTED_PROXY_HOPS,
  rateLimitKeyForIp,
  readTrustedProxyHops,
  resetClientIpLogStateForTests,
  SHARED_CLIENT_BUCKET,
} from "../../src/lib/rate-limit/client-ip";

/**
 * AIDA-29 (D-16, D-17, F-07): the client identity is read from the right of X-Forwarded-For.
 * Behind the shipped Caddy the rightmost entry is the TCP peer; anything a client sends lands to
 * its left and is never trusted. Addresses come from the documentation ranges only.
 */

function req(xff?: string): Request {
  const headers = new Headers();
  if (xff !== undefined) headers.set("x-forwarded-for", xff);
  return new Request("http://localhost/x", { headers });
}

function withHops<T>(hops: string | undefined, fn: () => T): T {
  const saved = process.env.TRUSTED_PROXY_HOPS;
  if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = hops;
  try {
    return fn();
  } finally {
    if (saved !== undefined) process.env.TRUSTED_PROXY_HOPS = saved;
    else delete process.env.TRUSTED_PROXY_HOPS;
  }
}

beforeEach(() => resetClientIpLogStateForTests());
afterEach(() => vi.restoreAllMocks());

describe("client-ip constants", () => {
  it("exports the values plan 08-18 documents", () => {
    expect(SHARED_CLIENT_BUCKET).toBe("shared:no-client-ip");
    expect(CLIENT_IP_HEADER).toBe("x-aida-client-ip");
    expect(MAX_TRUSTED_PROXY_HOPS).toBe(10);
  });
});

describe("getClientIp — shipped topology (D-16)", () => {
  it("returns the single entry Caddy writes from the TCP peer", () => {
    expect(withHops(undefined, () => getClientIp(req("203.0.113.5")))).toBe("203.0.113.5");
  });

  it("ordering: a spoofed leftmost entry never becomes the identity (hops 0)", () => {
    expect(withHops("0", () => getClientIp(req("198.51.100.66, 203.0.113.5")))).toBe("203.0.113.5");
  });

  it("loopback is an identity like any other, never exempt", () => {
    expect(withHops(undefined, () => getClientIp(req("127.0.0.1")))).toBe("127.0.0.1");
  });
});

describe("getClientIp — TRUSTED_PROXY_HOPS (D-17)", () => {
  it("hops 1 picks the entry left of the trusted proxy; a one-entry chain fails closed", () => {
    withHops("1", () => {
      expect(getClientIp(req("198.51.100.66, 203.0.113.5, 192.0.2.10"))).toBe("203.0.113.5");
      expect(getClientIp(req("203.0.113.5, 192.0.2.10"))).toBe("203.0.113.5");
      expect(getClientIp(req("192.0.2.10"))).toBe(SHARED_CLIENT_BUCKET);
    });
  });

  it("hops 10 is accepted", () => {
    const chain = Array.from({ length: 11 }, (_, i) => `192.0.2.${i + 1}`).join(", ");
    expect(withHops("10", () => readTrustedProxyHops())).toBe(10);
    expect(withHops("10", () => getClientIp(req(chain)))).toBe("192.0.2.1");
  });

  it.each([
    "11",
    "-1",
    "1.5",
    "abc",
  ])("invalid hops %s: every request uses the shared bucket, one error line without an address", (value) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    withHops(value, () => {
      expect(readTrustedProxyHops()).toBeNull();
      expect(getClientIp(req("203.0.113.5"))).toBe(SHARED_CLIENT_BUCKET);
      expect(getClientIp(req("198.51.100.7"))).toBe(SHARED_CLIENT_BUCKET);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("TRUSTED_PROXY_HOPS");
    expect(logged).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(logged).not.toContain("203.0.113.5");
  });

  it("C8 hops too low: hops 0 behind a CDN keys on the proxy address, never the client value", () => {
    expect(withHops("0", () => getClientIp(req("203.0.113.5, 198.51.100.200")))).toBe(
      "198.51.100.200",
    );
  });

  it("C8 hops too high: hops 2 on a two-entry chain fails closed", () => {
    expect(withHops("2", () => getClientIp(req("203.0.113.5, 198.51.100.200")))).toBe(
      SHARED_CLIENT_BUCKET,
    );
  });

  it("C8 malformed entry inside the trusted part fails closed", () => {
    expect(withHops("1", () => getClientIp(req("203.0.113.5, not-an-ip")))).toBe(
      SHARED_CLIENT_BUCKET,
    );
    expect(withHops("2", () => getClientIp(req("198.51.100.1, 203.0.113.5, bad, 192.0.2.1")))).toBe(
      SHARED_CLIENT_BUCKET,
    );
  });

  it("C8 left entries ignored: client-controlled junk left of the index cannot pick the shared bucket", () => {
    expect(withHops("1", () => getClientIp(req("not-an-ip, , 203.0.113.5, 192.0.2.10")))).toBe(
      "203.0.113.5",
    );
  });

  it("adjacency: duplicate adjacent entries resolve by position", () => {
    expect(withHops("0", () => getClientIp(req("203.0.113.5, 203.0.113.5")))).toBe("203.0.113.5");
    expect(withHops("1", () => getClientIp(req("203.0.113.5, 203.0.113.5")))).toBe("203.0.113.5");
  });
});

// Review b-WR-b4: a valid hop count above 0 that meets a chain too short for it, or a malformed
// entry in the trusted part, is the sign of a misconfiguration (for example TRUSTED_PROXY_HOPS
// set while the Caddyfile still overwrites X-Forwarded-For). It logs one line per process,
// naming the setting and no address; hops 0 never logs.
describe("getClientIp — short or malformed trusted chain logs once (b-WR-b4)", () => {
  const ADDRESS = /\d+\.\d+\.\d+\.\d+|[0-9a-f]*:[0-9a-f]*:/i;

  it("hops 1 on a one-entry chain: one line naming TRUSTED_PROXY_HOPS and no address, however many requests", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    withHops("1", () => {
      for (const ip of ["203.0.113.5", "198.51.100.7", "2001:db8::1"]) {
        expect(getClientIp(req(ip))).toBe(SHARED_CLIENT_BUCKET);
      }
      expect(getClientIp(req())).toBe(SHARED_CLIENT_BUCKET);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("TRUSTED_PROXY_HOPS");
    expect(logged).toContain("header_up X-Forwarded-For");
    expect(logged).not.toMatch(ADDRESS);
  });

  it("hops 1 with a malformed trusted entry logs the same single line, and a later short chain adds none", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    withHops("1", () => {
      expect(getClientIp(req("203.0.113.5, not-an-ip"))).toBe(SHARED_CLIENT_BUCKET);
      expect(getClientIp(req("192.0.2.10"))).toBe(SHARED_CLIENT_BUCKET);
    });
    withHops("2", () => {
      expect(getClientIp(req("203.0.113.5, 198.51.100.200"))).toBe(SHARED_CLIENT_BUCKET);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].map(String).join(" ")).toContain("TRUSTED_PROXY_HOPS");
  });

  it("a well-formed chain long enough for the hop count logs nothing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    withHops("1", () => {
      expect(getClientIp(req("203.0.113.5, 192.0.2.10"))).toBe("203.0.113.5");
      expect(getClientIp(req("not-an-ip, 203.0.113.5, 192.0.2.10"))).toBe("203.0.113.5");
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["malformed rightmost", "not-an-ip"],
    ["empty rightmost", "203.0.113.5, "],
    ["port", "203.0.113.5:443"],
  ])("hops 0 never logs: %s header", (_label, value) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const hops of ["0", undefined, ""]) {
      expect(withHops(hops, () => getClientIp(req(value)))).toBe(SHARED_CLIENT_BUCKET);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("getClientIp — empty and malformed headers fail closed (D-16)", () => {
  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["only commas", ", ,"],
  ])("%s header -> shared bucket", (_label, value) => {
    expect(withHops(undefined, () => getClientIp(req(value)))).toBe(SHARED_CLIENT_BUCKET);
  });

  it("an empty entry left of the selected index is ignored", () => {
    expect(withHops("0", () => getClientIp(req("203.0.113.5, , 203.0.113.6")))).toBe("203.0.113.6");
  });

  it("an empty rightmost entry fails closed", () => {
    expect(withHops("0", () => getClientIp(req("203.0.113.5, ")))).toBe(SHARED_CLIENT_BUCKET);
  });

  it.each([
    "203.0.113.5:443",
    "fe80::1%eth0",
    "not-an-ip",
    "01.2.3.4",
    "localhost",
  ])("invalid entry %s -> shared bucket", (value) => {
    expect(withHops(undefined, () => getClientIp(req(value)))).toBe(SHARED_CLIENT_BUCKET);
  });
});

describe("canonicalizeIp and rate-limit keys (precision)", () => {
  it("IPv6 spellings canonicalize to one string", () => {
    for (const value of ["2001:DB8::1", "2001:db8:0:0:0:0:0:1", "[2001:db8::1]"]) {
      expect(canonicalizeIp(value)).toBe("2001:db8::1");
    }
    expect(getClientIp(req("[2001:DB8::1]"))).toBe("2001:db8::1");
  });

  it("IPv4-mapped IPv6 becomes dotted IPv4", () => {
    expect(canonicalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(canonicalizeIp("::FFFF:cb00:7107")).toBe("203.0.113.7");
  });

  it("rejects ports, zone indexes and names", () => {
    for (const value of ["[2001:db8::1]:443", "fe80::1%eth0", "localhost", ""]) {
      expect(canonicalizeIp(value)).toBeNull();
    }
  });

  it("collapses IPv6 to its /64 and keeps IPv4 and the shared bucket whole", () => {
    const a = rateLimitKeyForIp("2001:db8:abcd:12::1");
    expect(a).toBe("2001:0db8:abcd:0012::/64");
    expect(rateLimitKeyForIp("2001:db8:abcd:12:ffff::9")).toBe(a);
    expect(rateLimitKeyForIp("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(rateLimitKeyForIp("203.0.113.5")).toBe("203.0.113.5");
    expect(rateLimitKeyForIp(SHARED_CLIENT_BUCKET)).toBe(SHARED_CLIENT_BUCKET);
  });

  it("getRateLimitIdentity = rateLimitKeyForIp(getClientIp)", () => {
    expect(getRateLimitIdentity(req("198.51.100.66, 2001:db8:abcd:12::77"))).toBe(
      "2001:0db8:abcd:0012::/64",
    );
    expect(getRateLimitIdentity(req())).toBe(SHARED_CLIENT_BUCKET);
  });
});

describe("Caddy contract (D-16)", () => {
  it("the Caddyfile writes X-Forwarded-For from the TCP peer inside reverse_proxy", () => {
    const caddyfile = readFileSync(path.join(__dirname, "../../Caddyfile"), "utf8");
    const block = /reverse_proxy app:3000 \{([\s\S]*?)\n {2}\}/.exec(caddyfile)?.[1] ?? "";
    expect(block).toMatch(/^\s*header_up X-Forwarded-For \{remote_host\}\s*$/m);
  });

  it("b-IN-b1: Caddy strips a client-sent x-aida-client-ip inside reverse_proxy (second fence behind src/proxy.ts)", () => {
    const caddyfile = readFileSync(path.join(__dirname, "../../Caddyfile"), "utf8");
    const block = /reverse_proxy app:3000 \{([\s\S]*?)\n {2}\}/.exec(caddyfile)?.[1] ?? "";
    const strip = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("#"))
      .find((line) => /^header_up\s+-/i.test(line));
    expect(strip?.toLowerCase()).toBe(`header_up -${CLIENT_IP_HEADER}`);
  });
});
