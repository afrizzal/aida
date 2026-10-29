---
phase: 08-security-hardening
plan: 10
subsystem: security
status: complete
tags: [client-ip, rate-limit, x-forwarded-for, caddy, better-auth, AIDA-29, F-07]
requires: ["08-02", "08-07", "08-09"]
provides:
  - "src/lib/rate-limit/client-ip.ts: getClientIp, getRateLimitIdentity, rateLimitKeyForIp, canonicalizeIp, readTrustedProxyHops, SHARED_CLIENT_BUCKET, CLIENT_IP_HEADER, MAX_TRUSTED_PROXY_HOPS, resetClientIpLogStateForTests"
  - "Caddyfile: header_up X-Forwarded-For {remote_host}"
  - "proxy-written x-aida-client-ip; Better Auth advanced.ipAddress.ipAddressHeaders"
affects: ["08-11", "08-12", "08-13", "08-18", "08-21", "08-22"]
tech-stack:
  added: []
  patterns: ["identity read from the right of X-Forwarded-For, fail closed into one shared bucket", "proxy as the only writer of an internal identity header"]
key-files:
  created: [src/lib/rate-limit/client-ip.ts, tests/unit/client-ip.test.ts, tests/integration/auth-ip-source.test.ts]
  modified: [Caddyfile, src/app/api/public/intake/route.ts, "src/app/api/public/status/[token]/csat/route.ts", "src/app/api/public/status/[token]/follow-up/route.ts", src/proxy.ts, tests/unit/proxy.test.ts, src/lib/auth.ts]
decisions:
  - "Client identity is the X-Forwarded-For entry TRUSTED_PROXY_HOPS places from the right (default 0, max 10); entries left of it are never parsed"
  - "Zone indexes are rejected explicitly because node:net isIP accepts fe80::1%eth0"
  - "Better Auth reads only x-aida-client-ip (option name ipAddressHeaders confirmed in installed @better-auth/core 1.7.20)"
metrics:
  duration: "about 5m measured from the ledger start (reading time excluded)"
  completed: 2026-11-11
  tasks: 3
  files: 10
estimate:
  tokens: 75000
actuals:
  tokens: 6400
  tasks: 3
  commits: 3
plan_head_before: b09b2a0604a7bb6422d9002eac0bf7448cc7742e
---

# Phase 8 Plan 10: Trusted-Proxy-Aware Client IP Summary

One helper, `src/lib/rate-limit/client-ip.ts`, now decides the client identity. It reads X-Forwarded-For from the right, canonicalizes the address, and sends anything malformed into one shared bucket. Caddy writes the header from the TCP peer. All three public POST routes key their limiter on the helper. The proxy overwrites `x-aida-client-ip` on every forwarded request, and Better Auth reads only that header. Tests show that a spoofed leftmost entry never becomes the identity, and that Better Auth stores the proxy-written IP and ignores a raw X-Forwarded-For.

`actuals.tokens` is chars/4 over the plan diff (25,688 chars).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | ff70f94 | feat(08-10): one trusted-proxy-aware client-IP helper; Caddy sets X-Forwarded-For from the peer (D-16, D-17) |
| 2 | f4c66f6 | feat(08-10): all public routes and Better Auth key on the helper's client identity (D-16, D-18) |
| 3 | 4a0a1d0 | test(08-10): Better Auth records the session IP from the helper header only (D-18) |

## Names and values for plan 08-18

- `SHARED_CLIENT_BUCKET = "shared:no-client-ip"`
- `CLIENT_IP_HEADER = "x-aida-client-ip"`
- `MAX_TRUSTED_PROXY_HOPS = 10`. `TRUSTED_PROXY_HOPS` is read on every call as `process.env.TRUSTED_PROXY_HOPS || "0"` and must match `^(?:[0-9]|10)$`. Any other value (for example `11`, `-1`, `1.5`, `abc`, `010`) sends every request to the shared bucket and logs one line per process: `TRUSTED_PROXY_HOPS must be an integer from 0 to 10; every request now uses the shared client bucket.`
- Caddyfile line, inside `reverse_proxy app:3000 { ... }`: `header_up X-Forwarded-For {remote_host}`, with a comment that points to docs/OPERATIONS.md "Client IP and reverse proxies". Plan 08-18 writes that section.
- Rate-limit keys: IPv4 stays whole. IPv6 becomes the first four zero-padded groups plus `::/64`, for example `2001:0db8:abcd:0012::/64`. The shared bucket stays as it is.
- Better Auth: `advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } }` in src/lib/auth.ts. The installed `@better-auth/core@1.7.20` `dist/utils/ip.mjs` line 206 reads `options.advanced?.ipAddress?.ipAddressHeaders || DEFAULT_IP_HEADERS`, so the option name is unchanged. When the helper yields the shared bucket, the header value is not an IP. Better Auth then applies its own fallback, recorded in 08-02: `127.0.0.1` in dev and test, and a shared per-path bucket in production.

## Better Auth call path

The server-side `auth.api.signInEmail({ body, headers })` recorded `session.ipAddress` from the passed headers. The `auth.handler(new Request(...))` fallback was not needed.

## Platform fact for plan 08-21 (review C7)

`grep -n "x-forwarded-for" node_modules/next/dist/server/base-server.js` at the installed next **16.4.6** (after 08-01's upgrade) prints:

```
604:            req.headers['x-forwarded-for'] ??= originalRequest == null ? void 0 : (_originalRequest_socket1 = originalRequest.socket) == null ? void 0 : _originalRequest_socket1.remoteAddress;
```

Line 604 is inside `handleRequestImpl`, which starts at line 566. The middleware call, `handleCatchallMiddlewareRequest` at line 1017, comes later in the same request handling. So the upgraded version still fills a missing X-Forwarded-For with the TCP peer before the proxy runs. Over real HTTP, the helper's missing-header branch is reached only by in-process callers and unit tests. No code was changed for this.

## Log review (acceptance)

`grep -nE "console\.(log|info|warn|error)" src/lib/rate-limit/client-ip.ts` finds one call, at line 65. Its only argument is the fixed string above, so no variable and no address is logged. A unit test asserts that the logged text contains `TRUSTED_PROXY_HOPS`, no dotted address, and not the request's address.

## Test results

Docker health before Task 3's Docker step: `colima status` exit 0, `docker info` exit 0, run as separate commands. The integration run used `AIDA_TEST_RUN_ID=mwc5c9c8-9990fc370b520b4e` and `DOCKER_HOST` from the docker context.

| Command | Exit | Result |
|---------|------|--------|
| `pnpm exec vitest run tests/unit/client-ip.test.ts` (RED, before the module existed) | 1 | file fails to import, no tests |
| `pnpm exec vitest run tests/unit/client-ip.test.ts tests/unit/rate-limit-pepper.test.ts` | 0 | 2 files, 34 passed (client-ip: 32) |
| `pnpm exec vitest run tests/unit/proxy.test.ts` (RED, after adding P to R) | 1 | 3 failed, 20 passed |
| `pnpm exec vitest run tests/unit/proxy.test.ts tests/unit/client-ip.test.ts` | 0 | 55 passed (proxy: 23) |
| no-inline-xff check (`split(",")[0]` under src/app) | 0 | `no-inline-xff` |
| `pnpm test` | 0 | 65 files, 1084 passed |
| `pnpm typecheck` (after each task) | 0 | clean |
| `pnpm lint` (after each task) | 0 | clean, 1 warning that predates this plan (tests/unit/container-config.test.ts:145) |
| `pnpm test:integration tests/integration/auth-ip-source.test.ts` (run 1) | 1 | 3 passed, 1 unhandled error (see Deviations) |
| `pnpm test:integration tests/integration/auth-ip-source.test.ts` (run 2) | 0 | 1 file, 3 passed |

After the run, `docker ps -a --filter label=aida.test=1` listed no containers.

## Deviations from Plan

**1. [Rule 1 - Bug] Zone index accepted by `isIP`**
- **Found during:** Task 1. Node's `isIP("fe80::1%eth0")` returns 6.
- **Fix:** `canonicalizeIp` rejects any value containing `%` before it calls `isIP`. The behaviour case `fe80::1%eth0` is covered by a test.
- **Commit:** ff70f94.

**2. [Rule 1 - Test teardown] Integration teardown raced the pool**
- **Found during:** Task 3, run 1. The test called `prisma.$disconnect()` before `db.drop()`. The drop's forced termination then hit a pg client that was still ending, and the termination (`57P01`) surfaced as an unhandled error, even though all 3 tests passed.
- **Fix:** the explicit disconnect was removed, so the teardown matches tests/integration/auth-bootstrap.test.ts. Run 2 exited 0 with no errors. Test code only.
- **Commit:** 4a0a1d0.

**3. Test naming.** The proxy cases are titled `P (D-18)`, `Q (D-18)` and `R (D-18)` in their own describe block, because 08-08's K125 block already uses P to T.

**4. Extra cases beyond the behavior list:** a constants test, `::FFFF:cb00:7107` mapping, `[2001:db8::1]:443` rejection, a `getRateLimitIdentity` test, and the Caddy contract test, which reads the Caddyfile.

## Review Dispositions Ledger applied

- C8 (accepted part): four unit tests whose titles contain `C8` cover hops too low, hops too high, a malformed entry inside the trusted part, and left entries being ignored. C8 (rejected part): entries left of the index are never parsed, and a test pins this.
- C7: the integration test's header comment states its limit. The Next.js platform fact is recorded above for 08-21.
- C9: no raw IP is logged, and the limiter receives only the identity key, which it stores as a peppered hash. `session.ipAddress` keeps its v1 behaviour, now holding the trusted identity.
- C12, K22: ordering and pointer only, no action here.
- R2-2: the Docker health rule was applied before Task 3. Both checks were healthy, so nothing was blocked.

## Threat model check

- T-08-41: mitigated by rightmost-entry reads in the helper and the Caddy header.
- T-08-42: mitigated by the proxy overwrite (unit P, Q, R) and the Better Auth header source (integration).
- T-08-43: mitigated by the fail-closed shared bucket. Loopback is not exempt (unit test).
- T-08-44: mitigated by the hop-count tests (C8).
- T-08-45: mitigated by the /64 key (unit test).
- T-08-46: mitigated by the single log line, which carries no address.

No security surface outside the threat model was added.

## Not run here

- Real-HTTP proof against `next start` and the real-Caddy spoofing proof belong to plans 08-21 and 08-22, now deferred to Phase 8.1. Neither is claimed here. No compose stack was started and no Caddy container was touched. The Caddyfile change is a file change only.
- No E2E spec was changed.

## Known Stubs

None.

## Manual items

None for this plan.

## Self-Check: PASSED

- FOUND: src/lib/rate-limit/client-ip.ts, tests/unit/client-ip.test.ts, tests/integration/auth-ip-source.test.ts
- FOUND: commits ff70f94, f4c66f6, 4a0a1d0
- `git rev-list --count b09b2a0..HEAD` = 3 before the docs commit
