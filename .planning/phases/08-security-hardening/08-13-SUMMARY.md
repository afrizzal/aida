---
phase: 08-security-hardening
plan: 13
subsystem: security
status: complete
tags: [body-limit, uploads, caddy, AIDA-30, F-12, D-24]
requires: ["08-10", "08-11"]
provides:
  - "src/lib/http/read-bounded-form-data.ts: readBoundedFormData, BoundedFormDataResult"
  - "src/lib/attachments/validate-uploads.ts: validateUploadFiles, storeValidatedUploads, removeStoredUploads, ValidatedUpload"
  - "constants MAX_REQUEST_BODY_BYTES, PROXY_BODY_LIMIT_BYTES"
affects: ["08-14", "08-22", "08-24"]
key-files:
  created: [src/lib/http/read-bounded-form-data.ts, src/lib/attachments/validate-uploads.ts, tests/unit/read-bounded-form-data.test.ts, tests/unit/body-limit-lockstep.test.ts, tests/integration/public-upload-caps.test.ts]
  modified: [src/lib/attachments/constants.ts, src/app/api/public/intake/route.ts, "src/app/api/public/status/[token]/follow-up/route.ts", next.config.ts, Caddyfile]
decisions:
  - "storeValidatedUploads reuses saveStagedFiles (staged-files.ts) for the save-or-delete-all semantics; removeStoredUploads ignores ENOENT and logs other refusals by key and code only, never throws"
  - "Content-Length is an early reject only when it is all digits and above the cap; anything else is counted from the stream"
metrics:
  completed: 2026-11-11
  tasks: 3
  files: 10
estimate:
  tokens: 95000
actuals:
  tokens: 9000
  tasks: 3
  commits: 3
plan_head_before: 37fa1428d457c10b80c42db4643b7cff1be8b39e
---

# Phase 8 Plan 13: Byte Caps on Received Bytes, Three-Layer Alignment, Cleanup on Failure Summary

Intake and follow-up now parse through `readBoundedFormData`, which counts the bytes it receives and cancels the stream past 31 MiB whatever the framing; Caddy and Next.js both sit at 32 MiB with a lockstep test; follow-up shares intake's 30 MiB combined cap; every file is validated before any is stored, and stored files are removed when a later step fails.

`actuals.tokens` is a rough chars/4 estimate of the plan diff (648 insertions, 117 deletions).

## Final limits (bytes)

| Constant | Value | Layer |
|---|---|---|
| `MAX_BYTES` | 10485760 (10 MiB) | per file |
| `MAX_TOTAL_REQUEST_BYTES` | 31457280 (30 MiB) | combined file bytes, intake and follow-up |
| `MAX_REQUEST_BODY_BYTES` | 32505856 (31 MiB) | route, raw body bytes counted as received |
| `PROXY_BODY_LIMIT_BYTES` | 33554432 (32 MiB) | Next.js `proxyClientMaxBodySize` (build prints 33554432) and Caddy `max_size 32MiB` |

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 23e2b71 | fix(08-13): enforce the intake body limit on bytes actually received (D-24) |
| 2 | fb9c21f | fix(08-13): align Caddy, Next.js and route body limits (D-24) |
| 3 | 968d536 | fix(08-13): validate before storing, clean up on failure, and cap follow-up uploads (D-24) |

## Red and green runs

Docker health (rule R2-2): `colima status` exit 0 and `docker info` exit 0 before Task 1's integration run and again before Task 3's E2E run.

| Task | Run | Result |
|---|---|---|
| 1 | RED `pnpm exec vitest run tests/unit/read-bounded-form-data.test.ts` | exit 1, the module did not exist yet (no tests collected) |
| 1 | GREEN same command | 7 passed |
| 1 | `pnpm test:integration tests/integration/public-upload-caps.test.ts` | exit 0, 1 passed (run only after the implementation; see Deviations) |
| 2 | RED `pnpm exec vitest run tests/unit/body-limit-lockstep.test.ts` | 2 failed, 1 passed |
| 2 | GREEN same command | 3 passed |
| 2 | `pnpm build` | exit 0 |
| 3 | RED `pnpm test:integration tests/integration/public-upload-caps.test.ts` | exit 1, 4 failed, 3 passed (the follow-up transaction cleanup already held through staged files) |
| 3 | GREEN `pnpm test:integration tests/integration/public-upload-caps.test.ts tests/integration/public-route-limits.test.ts` | exit 0, 12 passed (7 upload caps, 5 route limits) |
| 3 | `pnpm test:e2e tests/e2e/public-intake.spec.ts tests/e2e/public-status.spec.ts tests/e2e/attachments.spec.ts` | exit 0, 6 passed |
| all | `pnpm typecheck`, `pnpm lint` | exit 0 each; lint's 1 warning is pre-existing in tests/unit/container-config.test.ts |
| all | `pnpm exec vitest run tests/unit/staged-files.test.ts tests/unit/read-bounded-form-data.test.ts tests/unit/body-limit-lockstep.test.ts` | 17 passed |

## Acceptance checks

- `read-bounded-form-data.ts` has no `@/` or relative import.
- Neither route calls `request.formData()` or `localFileStorage.save`; in both, `validateUploadFiles(` precedes `storeValidatedUploads(` (intake lines 68 and 77, follow-up 79 and 86).
- `grep -n "max_size 32MiB" Caddyfile` finds line 12; `proxyClientMaxBodySize: PROXY_BODY_LIMIT_BYTES` is at next.config.ts line 17; the 08-10 `X-Forwarded-For {remote_host}` line is kept.

## Deviations from Plan

1. Task 1's integration case was not run red before the implementation; only the unit test was. The case would have failed at import (no `MAX_REQUEST_BODY_BYTES` export).
2. Follow-up previously used `saveStagedFiles` directly; it now goes through `storeValidatedUploads` and `removeStoredUploads`, keeping the same discard-on-no-commit behavior for the 404 and 409 paths.
3. The Docker health check for Task 3 ran before its E2E run, not before its first integration run (the RED run); both checks that ran were healthy.

## Known Stubs

None.

## Manual items

None for this plan. The large upload through real Caddy is plan 08-14's runtime proof (Phase 8.1); nothing here ran the compose stack.

## Self-Check: PASSED

All five created files exist; commits 23e2b71, fb9c21f and 968d536 are on `v2/run-loop`.
