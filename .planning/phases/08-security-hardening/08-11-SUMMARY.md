---
phase: 08-security-hardening
plan: 11
subsystem: security
status: complete
tags: [rate-limit, advisory-lock, retry-after, AIDA-30, F-12]
requires: ["08-10"]
provides:
  - "src/lib/rate-limit/check-rate-limit.ts: consumeRateLimit, RATE_LIMIT_MAX_WINDOW_MS, checkRateLimit (delegates)"
  - "src/lib/rate-limit/public-limits.ts: PUBLIC_RATE_LIMITS (intake, csat, followUp, statusAttachment), rateLimitedResponse"
  - "scope status-attachment"
affects: ["08-14", "08-22", "08-24"]
key-files:
  created: [src/lib/rate-limit/public-limits.ts, tests/integration/rate-limit-atomic.test.ts, tests/integration/public-route-limits.test.ts]
  modified: [src/lib/rate-limit/check-rate-limit.ts, src/app/api/public/intake/route.ts, "src/app/api/public/status/[token]/csat/route.ts", "src/app/api/public/status/[token]/follow-up/route.ts", "src/app/api/public/status/[token]/attachments/[id]/route.ts"]
decisions:
  - "The limiter serializes per scope and IP hash with pg_advisory_xact_lock(hashtext(scope:ipHash)) inside an interactive transaction (maxWait and timeout 5000 ms)"
  - "Windows above 48 hours and max below 1 throw, so the 48-hour cleanup job bounds the table"
metrics:
  completed: 2026-11-11
  tasks: 2
  files: 8
estimate:
  tokens: 85000
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
plan_head_before: 431e9b4
---

# Phase 8 Plan 11: Atomic Limiter and Limit-First Public Routes Summary

`consumeRateLimit` now counts and inserts in one transaction, behind a transaction-scoped advisory lock on scope plus IP hash. In the test, 20 parallel calls with max 5 let exactly 5 through and left exactly 5 rows. All four public routes now call the limiter as their first work. Status attachments are limited to 120 per minute per identity (a hypothesis, D-21). Every 429 carries an integer `Retry-After`.

`actuals.tokens` is a rough chars/4 estimate of the plan diff.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 470ca22 | fix(08-11): atomic rate limiter and throttled status attachments (D-21, D-23) |
| 2 | bb223a6 | fix(08-11): rate-limit public routes before parsing and token lookup (D-22) |

## Test results

Docker health ran before each task's Docker steps, each command on its own: `colima status` exit 0 and `docker info` exit 0, both times. The runs used `AIDA_TEST_RUN_ID=mwc5mkc5-816e7dff466cc123` and `DOCKER_HOST` from the docker context.

| Command | Exit | Result |
|---------|------|--------|
| `pnpm test:integration rate-limit-atomic + public-route-limits` (Task 1 RED) | 1 | 4 failed, 1 passed (the checkRateLimit compat case) |
| same (Task 1 GREEN) | 0 | 2 files, 5 passed (atomic: 4) |
| `pnpm exec vitest run tests/unit/rate-limit-pepper.test.ts` | 0 | 2 passed |
| `pnpm test:integration tests/integration/public-route-limits.test.ts` (Task 2 RED) | 1 | 3 failed (csat, follow-up, intake order), 2 passed (attachment, token-not-logged) |
| `pnpm test:integration public-route-limits + rate-limit-atomic` (Task 2 GREEN) | 0 | 2 files, 9 passed (public-route-limits: 5) |
| `pnpm typecheck` (after each task) | 0 | clean |
| `pnpm lint` (Task 1, first run) | 1 | format-only on the two new test files; fixed with `biome format --write` |
| `pnpm lint` (after each task) | 0 | clean (the one older warning in container-config.test.ts remains) |
| `pnpm test:e2e public-intake + public-status + uat-gaps` (run 1) | 1 | **failed** in the Playwright global setup: `tests/e2e/global-setup.ts:165` `waitForURL(/\/login/)` timed out after 30 s on `/setup`; no spec ran |
| same (run 2) | 1 | **failed**, same place |

Retry-After values: the tests assert an integer from 1 to the window (60 s for the attachment route, 3600 s for the POST routes). The `console.info` lines carrying the exact numbers did not appear in the captured log, so no exact value is claimed here.

After the runs, `docker ps -a --filter label=aida.test=1` listed no containers.

## E2E failure (open, cause not proven)

The E2E failure happens before any spec runs. The `/setup` form submit never reaches `/login`. No source file on that path calls the limiter: `grep -rln "checkRateLimit\|consumeRateLimit" src` lists only the four public routes and the limiter itself. The web server log shows no error. So this plan probably did not cause it, but that is not proven, and nothing here records the E2E row as passed. The uat-gaps check that the sixth intake gets a 429 is therefore not run. Plan 08-10 did not run E2E, so the last green E2E run before this plan is not known here. Next step for the orchestrator: run the same command at `431e9b4` (before this plan), or look at the `/setup` page state in the Playwright trace.

## Deviations from Plan

1. **Attachment lookup name.** This route never calls `prisma.ticket.findUnique`. It calls `loadStatusAttachment(token, id)`. The limiter is placed before that call (line 19 against line 28), which meets the intent of the key link.
2. **Validation is stricter than planned:** `max` and `windowMs` must also be integers.
3. **Test reset.** `public-route-limits.test.ts` deletes the four public scopes' `RateLimitHit` rows in `beforeAll`.
4. **Lint fix.** Format-only fixes on the new test files (Rule 3).

## Review Dispositions Ledger applied

- C12: ordering only. The scope strings `public-intake`, `status-csat` and `status-follow-up` are unchanged, and `status-attachment` is new.
- R2-2: the Docker health rule ran before both tasks' Docker steps. Both checks were healthy, so nothing was blocked.

## Threat model check

T-08-47 is covered by the 20-parallel test. T-08-48, T-08-49 and T-08-50 are covered by the limiter-first order tests and the line-order greps. T-08-51 is covered by the console-spy test. T-08-52 is covered by the window cap test. This plan added no new security surface.

## Manual items

- Tune the 120/minute attachment limit from real traffic (D-21).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: the three created files, and commits 470ca22 and bb223a6
- `git rev-list --count 431e9b4..HEAD` = 2 before the docs commit
