// Client identity for rate limits and Better Auth (D-16, D-17, D-18, AIDA-29, F-07).
//
// Supported topology: `app` is reachable only through the shipped Caddy, and Caddy overwrites
// X-Forwarded-For with the TCP peer (`header_up X-Forwarded-For {remote_host}` in the Caddyfile)
// on every request. Exposing app:3000 directly, or adding a proxy in front of Caddy without
// setting TRUSTED_PROXY_HOPS, is unsupported (docs/OPERATIONS.md, "Client IP and reverse proxies").
//
// Why the rightmost entry: every proxy appends the address it saw, so the right end of the chain
// is written by the proxies we run and the left end by whoever sent the request. With
// TRUSTED_PROXY_HOPS = N (an operator CDN in front of Caddy) the identity is the entry N places
// from the right. Entries left of that index are client-controlled and are never parsed: failing
// closed on them would let any client move itself into the shared bucket on purpose (review C8).
//
// Fail closed: a missing or malformed header, an invalid entry at or right of the selected index,
// a chain too short for the hop count, or an invalid TRUSTED_PROXY_HOPS all yield one shared
// bucket with a bounded limit. Nothing is ever treated as loopback or exempt, and the header is
// never trusted when the setting is invalid.
//
// Privacy: no address is ever logged. The only log lines are two configuration messages, each at
// most once per process and naming the setting, never an address: an invalid TRUSTED_PROXY_HOPS,
// and a valid count above 0 that meets a chain too short for it or a malformed trusted entry
// (review b-WR-b4; the usual cause is setting TRUSTED_PROXY_HOPS while the Caddyfile still
// overwrites X-Forwarded-For). The limiter stores only a peppered hash of the key.
//
// node:net only, no internal project imports: read by the proxy, the routes and Better Auth.
import { isIP } from "node:net";

export const SHARED_CLIENT_BUCKET = "shared:no-client-ip";
// Written by src/proxy.ts on every forwarded request, overwriting any client value; Better Auth
// reads only this header (D-18).
export const CLIENT_IP_HEADER = "x-aida-client-ip";
export const MAX_TRUSTED_PROXY_HOPS = 10;

const HOPS_PATTERN = /^(?:[0-9]|10)$/;
let invalidHopsLogged = false;
let shortChainLogged = false;

// Hops 0 never calls this: with hops 0 a malformed or missing header is the client's own doing,
// not a configuration error. Once per process, so a flood cannot fill the log.
function logShortChainOnce(hops: number): void {
  if (shortChainLogged) return;
  shortChainLogged = true;
  console.error(
    `TRUSTED_PROXY_HOPS is ${hops}, but a request arrived whose X-Forwarded-For has fewer valid trusted entries than that; such requests use the shared client bucket. If you set TRUSTED_PROXY_HOPS, also remove the Caddyfile line "header_up X-Forwarded-For {remote_host}" (docs/OPERATIONS.md, "Client IP and reverse proxies"). This message is logged once per process.`,
  );
}

// Read per call with `||`: compose injects an unset variable as the empty string.
export function readTrustedProxyHops(): number | null {
  const raw = process.env.TRUSTED_PROXY_HOPS || "0";
  if (!HOPS_PATTERN.test(raw)) return null;
  const hops = Number(raw);
  return hops <= MAX_TRUSTED_PROXY_HOPS ? hops : null;
}

export function canonicalizeIp(value: string): string | null {
  let v = value.trim();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  // Zone indexes (fe80::1%eth0) are accepted by isIP but are not a client identity.
  if (!v || v.includes("%")) return null;
  const family = isIP(v);
  if (family === 4) return v;
  if (family !== 6) return null;
  const hostname = new URL(`http://[${v}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(hostname);
  if (mapped) {
    const hi = Number.parseInt(mapped[1], 16);
    const lo = Number.parseInt(mapped[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return hostname;
}

export function getClientIp(request: Request): string {
  const hops = readTrustedProxyHops();
  if (hops === null) {
    if (!invalidHopsLogged) {
      invalidHopsLogged = true;
      console.error(
        "TRUSTED_PROXY_HOPS must be an integer from 0 to 10; every request now uses the shared client bucket.",
      );
    }
    return SHARED_CLIENT_BUCKET;
  }

  const header = request.headers.get("x-forwarded-for");
  if (header === null) {
    if (hops > 0) logShortChainOnce(hops);
    return SHARED_CLIENT_BUCKET;
  }
  const entries = header.split(",").map((entry) => entry.trim());
  const index = entries.length - 1 - hops;
  if (index < 0) {
    if (hops > 0) logShortChainOnce(hops);
    return SHARED_CLIENT_BUCKET;
  }

  // The trusted part of the chain: the selected entry and every proxy entry right of it.
  let selected: string | null = null;
  for (let i = index; i < entries.length; i++) {
    const canonical = canonicalizeIp(entries[i]);
    if (canonical === null) {
      if (hops > 0) logShortChainOnce(hops);
      return SHARED_CLIENT_BUCKET;
    }
    if (i === index) selected = canonical;
  }
  return selected ?? SHARED_CLIENT_BUCKET;
}

function expandIpv6(ip: string): string[] {
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, undefined];
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const zeros =
    tail === undefined ? [] : Array(8 - headGroups.length - tailGroups.length).fill("0");
  return [...headGroups, ...zeros, ...tailGroups];
}

// IPv6 collapses to its /64, matching Better Auth's default `ipv6Subnet` of 64, so rotating
// addresses inside one allocation does not buy a fresh quota (T-08-45). IPv4 and the shared
// bucket stay whole.
export function rateLimitKeyForIp(ip: string): string {
  const canonical = canonicalizeIp(ip);
  if (canonical === null || isIP(canonical) !== 6) return canonical ?? ip;
  const groups = expandIpv6(canonical)
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"));
  return `${groups.join(":")}::/64`;
}

export function getRateLimitIdentity(request: Request): string {
  return rateLimitKeyForIp(getClientIp(request));
}

export function resetClientIpLogStateForTests(): void {
  invalidHopsLogged = false;
  shortChainLogged = false;
}
