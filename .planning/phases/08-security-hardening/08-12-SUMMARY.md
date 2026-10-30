---
phase: 08-security-hardening
plan: 12
subsystem: security
status: complete
tags: [health, throttle, cache, single-flight, AIDA-30, F-12, D-20]
requires: ["08-10", "08-11", "08-18"]
provides:
  - "src/lib/rate-limit/memory-throttle.ts: createMemoryThrottle"
  - "src/lib/health/health-check.ts: HEALTH_THROTTLE, HEALTH_CACHE_TTL_MS, checkHealthThrottle, readHealthSnapshot, resetHealthStateForTests; store key Symbol.for(\"aida.health.state\")"
affects: ["08-20", "08-21", "08-14", "08-24"]
tech-stack:
  added: []
  patterns: ["process-global state on globalThis under a registered symbol", "single-flight cached read"]
key-files:
  created: [src/lib/rate-limit/memory-throttle.ts, src/lib/health/health-check.ts, tests/unit/memory-throttle.test.ts]
  modified: [src/app/api/health/route.ts, tests/unit/health.test.ts, docs/OPERATIONS.md, website/src/content/docs/operations/upgrading-and-logs.md]
decisions:
  - "/api/health limits: 60/min per identity, 120/min shared no-identity bucket, maxKeys 10000 (tunable)"
  - "The shared bucket is its own throttle instance with maxKeys 1, since it only ever holds one key"
  - "worker.lastRunAt stays in the anonymous response (no tenant data, cached, used by the runbook)"
metrics:
  completed: 2026-11-11
  tasks: 2
  files: 7
estimate:
  tokens: 65000
actuals:
  tokens: 5200
  tasks: 2
  commits: 2
plan_head_before: 325f0f2c54f1b32aff18b7ebbe2dfd6afc54318a
---

# Phase 8 Plan 12: /api/health Throttle and Cache Summary

`/api/health` now throttles in memory before any DB work: 60 requests a minute per identity from `getRateLimitIdentity`, and 120 a minute for the shared no-identity bucket. Loopback is not exempt. The DB read is cached for 3 seconds (503 included), with single-flight. The throttles, the cache and the in-flight read all live in one store on `globalThis` under `Symbol.for("aida.health.state")`. `readHealthSnapshot()` is the only health path to the database, ready for 08-20's probe.

`actuals.tokens` is chars/4 over the plan diff (20,695 chars).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | b77cbfc | fix(08-12): in-memory per-identity throttle on /api/health that keeps the healthcheck green (D-20) |
| 2 | 235f633 | fix(08-12): cache /api/health for 3 s with single-flight and document the throttle (D-20) |

## Test results

| Command | Exit | Result |
|---------|------|--------|
| vitest memory-throttle + health (Task 1 RED) | 1 | both files fail to import, no tests |
| same (Task 1 GREEN) | 0 | 2 files, 11 passed (health: 7) |
| same (Task 2 RED) | 1 | 4 failed (cache, DB down/up, concurrency, R2-7), 11 passed |
| same (Task 2 GREEN, after format) | 0 | 2 files, 15 passed (health: 11, memory-throttle: 4) |
| health docs node check | 0 | `health docs ok` |
| `pnpm test` | 0 | 66 files, 1097 passed |
| `pnpm typecheck` (each task) | 0 | clean |
| `pnpm lint` (Task 1) | 0 | 1 older warning (tests/unit/container-config.test.ts:145) |
| `pnpm lint` (Task 2, first run) | 1 | format-only in health.test.ts; fixed with `biome format --write`, rerun exit 0 |

Acceptance greps: the route exports only `dynamic` and `GET`. memory-throttle.ts has 0 import lines. `HEALTH_CACHE_TTL_MS = 3000` is at line 18, the store key at line 32, and `^(let|var) ` count is 0.

## Documentation changes

- docs/OPERATIONS.md `## Health checks`: a new `### Cache and throttle` subsection after the 08-18 pointer sentence, which is kept. It covers the 3-second cache and its lag, 60/min per address, 120/min shared (the healthcheck uses 6), no loopback exemption, keys never logged, 429 `{"error":"rate_limited"}` with `Retry-After`, the `worker.lastRunAt` choice, and the limits being tunable.
- website upgrading-and-logs.md: one paragraph with the same facts.

## Deviations from Plan

1. Extra tests beyond the behavior list: loopback throttled, and a console spy showing that the throttle key is never logged (prohibition, verification: test).
2. The R2-7 test also imports `@/lib/db` after `vi.resetModules()` and counts calls on either mock instance, so it holds whether or not Vitest re-runs the mock factory.
3. Lint format fix (Rule 3).

## Review Dispositions Ledger applied

- C2: the public throttle is unchanged from D-20, and `readHealthSnapshot()` is the single DB path for 08-20. No probe route is added here.
- C12: wave 8 ordering.
- R2-7: the store lives on `globalThis`, and the re-import test passes. The production-build measurement is 08-21 (Phase 8.1).
- R2-2: not applicable, since no Docker step ran.

## Threat model check

T-08-53, T-08-54 and T-08-55 are mitigated and tested. T-08-56 is accepted and documented. T-08-105 is mitigated with the unit re-import test. No new surface was added.

## Not run here

Runtime proof under a real flood and with the compose healthcheck belongs to 08-14 (Phase 8.1). The compose stack was not started, and no E2E or integration run was needed.

## Known Stubs

None.

## Manual items

- Tune the 60/120 per-minute health limits from real monitoring traffic.

## Self-Check: PASSED

- FOUND: the three created files, plus commits b77cbfc and 235f633
- `git rev-list --count 325f0f2..HEAD` = 2 before the docs commit
