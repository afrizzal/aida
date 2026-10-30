---
phase: 08-security-hardening
plan: 20
subsystem: security
status: complete
tags: [health, probe, caddy, compose, AIDA-30, review-C2, D-20]
requires: ["08-09", "08-12", "08-13", "08-18"]
provides:
  - "src/app/api/health/probe/route.ts: GET /api/health/probe (exports dynamic, GET)"
  - "Caddyfile: @healthprobe path /api/health/probe* + respond @healthprobe 404 before reverse_proxy"
  - "both compose app healthchecks on http://127.0.0.1:3000/api/health/probe"
affects: ["08-21", "08-22", "08-24", "08-15"]
tech-stack:
  added: []
  patterns: ["protection by topology (path refused at the proxy), never by a client header"]
key-files:
  created: [src/app/api/health/probe/route.ts, tests/unit/health-probe.test.ts, tests/unit/health-probe-wiring.test.ts]
  modified: [Caddyfile, docker-compose.yml, docker-compose.egress-test.yml, docs/OPERATIONS.md, website/src/content/docs/operations/upgrading-and-logs.md]
decisions:
  - "The probe GET takes no request argument, so no header can reach its answer"
  - "Docs: the old 'the container healthcheck sends 6' throttle text was corrected, since the healthcheck no longer calls /api/health"
metrics:
  duration: ~15 min
  completed: 2026-11-11
estimate:
  tokens: 60000
actuals:
  tokens: 4500
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 8d6d90e87096a21c1ae988ee597a2a038e9a1b82
---

# Phase 8 Plan 20: Container Health Probe Refused by Caddy Summary

The container healthcheck now calls `GET /api/health/probe`. The route answers `{status:"ok"}` (200) or `{status:"error"}` (503) from the shared 3-second single-flight `readHealthSnapshot()`. It has no throttle and reads no header. Caddy refuses the path with 404 before `reverse_proxy`, so public traffic cannot reach it or starve it. `/api/health` keeps D-20 unchanged.

`actuals.tokens` is chars/4 over the plan diff (17,913 chars).

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 0632faa | feat(08-20): unthrottled container probe on the cached health snapshot (review C2, D-20) |
| 2 | 6ed2d64 | fix(08-20): container healthcheck on the probe path, which Caddy refuses (review C2) |
| 3 | a8a0999 | docs(08-20): document the container probe and its Caddy refusal (review C2) |

## Red and green runs

| Run | Exit | Result |
|---|---|---|
| T1 RED `vitest run tests/unit/health-probe.test.ts` | 1 | cannot find `@/app/api/health/probe/route`, no tests |
| T1 GREEN `vitest run health-probe + health` | 0 | 2 files, 16 passed (probe: 5) |
| T2 RED `vitest run tests/unit/health-probe-wiring.test.ts` | 1 | 3 failed, 1 passed (route file exists) |
| T2 GREEN `vitest run wiring + body-limit-lockstep + container-config` | 0 | 3 files, 22 passed (wiring: 4) |
| T3 docs check (plan verify script) | 0 | `probe docs ok` |
| `pnpm typecheck` (T1 and final) | 0 | clean |
| `pnpm lint` (T1) | 0 | 1 pre-existing warning (container-config.test.ts:145) |
| `pnpm lint` (T2, first) | 1 | format only in health-probe-wiring.test.ts; `biome format --write`, rerun exit 0 |
| `DOCKER_HOST=<dead socket> pnpm test` (final) | 0 | 70 files, 1116 passed |

**Observed `findUnique` calls in the C2 flood test: 6** over six 10-second intervals (bound 21). The flood sends 100 shared-bucket, 100 loopback (`X-Forwarded-For: 127.0.0.1`) and 100 probe GETs per interval. All 600 flood probes and all 6 final probes answered 200. Both flooded `/api/health` buckets answered 429. In the `TRUSTED_PROXY_HOPS=3` case the first 120 of 200 shared GETs got 200 and the rest got 429, and all six probes got 200.

## Compose renders (no daemon)

| Command | Exit | Result |
|---|---|---|
| `docker compose -p aida-test-config-check -f docker-compose.yml --env-file /dev/null config --quiet` | 0 | 7 expected unset-variable warnings; app healthcheck `wget -qO- http://127.0.0.1:3000/api/health/probe`, interval 10s, timeout 5s, retries 5, start_period 1m30s |
| same for `docker-compose.egress-test.yml`, plain | 1 | required `AIDA_TEST_RUN_ID` missing (the file requires it) |
| same with `AIDA_TEST_RUN_ID=mwc6mlj6-51c2da39a9d8c64a` and a `mktemp -d` `AIDA_TEST_DNS_LOG_DIR` (08-09's method) | 0 | app healthcheck on the probe; the temp dir was removed with `rmdir` |

## Acceptance greps

- `grep -E "^export "` on the route shows only `export const dynamic` and `export async function GET()`. The non-comment `prisma|rate-limit` count is 0.
- In the Caddyfile, `respond @healthprobe 404` is on line 19 and `reverse_proxy app:3000` on line 20.
- `127.0.0.1:3000/api/health/probe` appears once in each compose file.

## Docs statement-to-proof list

| Statement | Proof |
|---|---|
| The container healthcheck calls `http://127.0.0.1:3000/api/health/probe` | both compose files; wiring test; rendered config |
| The probe answers `{"status":"ok"}` 200 or `{"status":"error"}` 503 | route.ts; probe tests "D-20: answers 200/503" |
| The probe uses the same 3-second cache | route calls `readHealthSnapshot()`; `HEALTH_CACHE_TTL_MS = 3000`; flood test read bound |
| The probe has no rate limit | route has no rate-limit import (grep 0); flood test with 600 probes all 200 |
| Caddy refuses the probe with 404 | Caddyfile `@healthprobe` and `respond`; wiring test. Real-Caddy proof: 08-22 (Phase 8.1), not run here |
| No public traffic can make the container unhealthy | Caddy refusal plus the flood and misconfiguration tests (unit, in-process); real HTTP: 08-21 |
| Monitors use the throttled `/api/health` with 429 and `Retry-After` | route.ts and health.test.ts (08-12), unchanged |
| Direct `app:3000` access reads the binary DB status, the trust boundary | route body is only `{status}`; header test; OPERATIONS.md "Client IP and reverse proxies" (08-18) |
| The healthcheck no longer counts against the `/api/health` limits | compose healthchecks target the probe only (wiring test) |

## Deviations from Plan

1. **[Rule 1, docs accuracy]** The existing throttle text in both docs said "the container healthcheck sends/uses 6" of the shared bucket. After this plan that was false, so both lines were corrected. Only the text changed; no code changed.
2. **[Rule 3]** `docker-compose.egress-test.yml` does not render with `--env-file /dev/null` alone, because it requires `AIDA_TEST_RUN_ID`. It was rendered with the run id and a temporary DNS log dir, as 08-09 did.
3. The probe test calls `GET` through a cast that passes a `Request`, so the header test sends real headers to a GET that ignores them.
4. Lint format fix (Rule 3).

## Review Dispositions Ledger applied

- C2: implemented as the probe path refused by Caddy (Tasks 1 to 3). `/api/health` is unchanged.
- C7 and R2-7 (docs part): the trust boundary and the binary DB status are documented, and the docs check passes.
- R2-7 (other parts): left to 08-22 Task 2 and 08-21 Task 2 (Phase 8.1).
- R2-2: not applicable. `config` needs no daemon, and no other Docker command ran.
- Deferred alternative ("serve the cache instead of 429"): not implemented.

## Not run here

- The real-Caddy refusal (17-path corpus) is 08-22 and the real-HTTP bound is 08-21, both Phase 8.1: **not run**.
- The compose stack was not started and no image was built.

## Threat model check

T-08-81, 82, 83 and 85 are mitigated and tested. T-08-84 has its matcher in place, but its proof is 08-22, not run. T-08-108 is accepted and documented. No new surface beyond the plan.

## Known Stubs

None.

## Manual items

None.

## Self-Check: PASSED

- FOUND: src/app/api/health/probe/route.ts, tests/unit/health-probe.test.ts, tests/unit/health-probe-wiring.test.ts
- FOUND: commits 0632faa, 6ed2d64, a8a0999; `git rev-list --count 8d6d90e..HEAD` = 3 before the docs commit
