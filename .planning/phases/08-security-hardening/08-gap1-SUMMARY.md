---
phase: 08-security-hardening
plan: gap1
subsystem: tests/integration
tags: [rate-limit, test-isolation, gap-fix]
status: complete
requires: [08-10, 08-11]
key-files:
  modified:
    - tests/integration/public-state-label.test.ts
    - tests/integration/merge-reply-race.test.ts
    - tests/integration/status-read-snapshot.test.ts
decisions:
  - "Isolate rate-limit state with a unique valid client identity per request (random IPv6 /64), not by deleting limiter rows"
plan_head_before: 10d51a9
actuals:
  tasks: 1
  commits: 1
completed: 2026-11-11
---

# Phase 08 Plan gap1: Integration rate-limit isolation Summary

The 13 integration tests that Part A rate limits broke now pass again. Each public-route request now sends a valid, unique client IP, and the snapshot test sets the pepper. No product code or limit value changed.

## Root causes

- `public-state-label.test.ts` (7) and `merge-reply-race.test.ts` (4): the tests sent `X-Forwarded-For: public-state-label-<uuid>` / `race-<uuid>`. Those values are not IP addresses. Since 08-10, `getClientIp` maps any non-IP value to `SHARED_CLIENT_BUCKET`, so every request shared one `status-csat` / `status-follow-up` bucket (5 per hour) and later requests got `429 rate_limited`. The production code fails closed as designed, so this is not a product bug.
- `status-read-snapshot.test.ts` (2): since 08-11 the attachment route calls the limiter, which hashes the identity with `RATE_LIMIT_PEPPER`. This file never set the pepper.

## Fix

- A `uniqueClientIp()` helper in both files returns `fd00:<48 random bits>::1`. The limiter keys IPv6 addresses by /64, so each request gets its own bucket.
- `status-read-snapshot.test.ts` sets `RATE_LIMIT_PEPPER` in its existing `vi.hoisted` block, the same way the other files do.

## Verification

| Command | Exit | Result |
|---|---|---|
| pnpm test:integration (the 3 files) | 0 | 3 files, 37 tests passed |
| pnpm test:integration (full) | 0 | 101 files, 1327 tests passed |
| pnpm test | 0 | 71 files, 1156 tests passed |
| pnpm typecheck | 0 | clean |
| pnpm lint | 0 | 600 files, 1 warning (this change did not add it) |

## Commits

- c403af7 test(08-gap1): give public-route tests valid per-request client IPs and the rate-limit pepper

## Deviations from Plan

None. The fix is in the tests only.

## Self-Check: PASSED
