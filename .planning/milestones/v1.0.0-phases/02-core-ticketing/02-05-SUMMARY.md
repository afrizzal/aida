---
phase: 02-core-ticketing
plan: 05
subsystem: worker
tags: [pg-boss, prisma, sla, rate-limiting, postgres, crypto]

# Dependency graph
requires:
  - phase: 02-core-ticketing (plan 01)
    provides: Ticket model with firstResponseDueAt/resolutionDueAt/isAtRisk/isBreached fields, RateLimitHit model, TicketCounter pattern
affects: [02-06, 02-07, 02-08, 02-09, 02-10, 02-11, 02-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recurring worker job with set-based SQL UPDATEs (no per-row loop) for SLA flag computation"
    - "Postgres-backed rate limiting (check-then-insert on a hit-counter table) instead of in-memory/Redis limiter"
    - "One-directional flag-setting job paired with application-side flag-clearing (documented, deferred to plan 09)"

key-files:
  created:
    - src/lib/worker/jobs/sla-flag.ts
    - src/lib/rate-limit/check-rate-limit.ts
    - src/lib/worker/jobs/rate-limit-cleanup.ts
  modified:
    - src/lib/worker/index.ts

key-decisions:
  - "SLA flags are set only by the worker job; clearing on first-response/resolve happens in Server Actions (plan 09) — avoids read-modify-write races between the 5-min job and live ticket updates."
  - "RateLimitHit is not tenant-scoped (bare prisma, not scopedDb) — rate limiting happens before org context resolves for public intake."
  - "check-rate-limit.ts uses @/lib/db (Next.js webpack) while worker jobs use relative ../../db imports (esbuild worker bundle) — two different bundling contexts for the same underlying prisma singleton."

patterns-established:
  - "Recurring worker job registration: createQueue -> work -> schedule (cron), mirrored 1:1 for every new scheduled job (heartbeat, sla-flag, rate-limit-cleanup)."

requirements-completed: [AIDA-06, AIDA-08]

# Metrics
duration: 25min
completed: 2026-07-02
---

# Phase 02 Plan 05: SLA-Flag Job + Postgres Rate Limiter Summary

**Recurring pg-boss job stamps SLA breach/at-risk flags via two set-based UPDATEs, plus a Postgres-backed per-IP rate limiter (sha256-hashed IP, rolling window) with a daily cleanup job — both wired into the existing single worker process.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-02T (worktree sync + install/generate included)
- **Completed:** 2026-07-02
- **Tasks:** 3 completed
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- `slaFlagHandler` computes overdue (breach) and proportionally-at-risk (within 20% of target duration) open tickets in two set-based `$executeRaw` UPDATEs — no per-ticket loop, RESOLVED/CLOSED always excluded.
- `checkRateLimit(scope, ip)` gives public-facing Route Handlers a Postgres-backed, restart-safe rate limiter (sha256(ip + pepper), rolling window count-then-insert against `RateLimitHit`).
- `rateLimitCleanupHandler` prunes `RateLimitHit` rows older than 48h so the table doesn't grow unbounded.
- Both jobs wired into `src/lib/worker/index.ts` alongside the existing heartbeat job (`sla-flag` every 5 min, `rate-limit-cleanup` daily at 03:00), following the identical createQueue/work/schedule pattern.

## Task Commits

Each task was committed atomically:

1. **Task 1: SLA-flag job (breach + proportional at-risk)** - `72da7e6` (feat)
2. **Task 2: Postgres rate-limit lib + daily cleanup job** - `e901d86` (feat)
3. **Task 3: Wire sla-flag + rate-limit-cleanup queues into the worker** - `fe9d39f` (feat)

**Deviation fix:** `8cdd5ea` (fix) — biome formatter compliance for the new rate-limit lib.

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/lib/worker/jobs/sla-flag.ts` - `slaFlagHandler()`: two set-based UPDATE passes (breach, then proportional 20% at-risk); one-directional, comments note clearing happens in plan 09 Server Actions.
- `src/lib/rate-limit/check-rate-limit.ts` - `checkRateLimit(scope, ip, opts?)`: sha256-hashes IP with a pepper, counts `RateLimitHit` rows in a rolling window, rejects at `max` (default 5/hour), else inserts a hit row.
- `src/lib/worker/jobs/rate-limit-cleanup.ts` - `rateLimitCleanupHandler()`: deletes `RateLimitHit` rows older than 48h.
- `src/lib/worker/index.ts` - Added imports + createQueue/work/schedule wiring for `sla-flag` (every 5 min) and `rate-limit-cleanup` (daily 03:00), alongside existing heartbeat wiring (unchanged).

## Decisions Made
- Kept the plan's exact SQL (from `02-RESEARCH.md`) verbatim in `sla-flag.ts` rather than reformulating, per the plan's explicit instruction to match the researched statements exactly.
- Used a plain `_jobs: Job[]` parameter (rather than destructuring `[job]`) for the `rate-limit-cleanup` handler since it takes no job-data argument — avoids an unused-variable warning while keeping the pg-boss v12 array-destructure convention visible for future maintainers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Style/lint] biome formatter wanted the `hashIp` method chain broken across multiple lines**
- **Found during:** Task 2 (post-task biome check, run proactively as part of CLAUDE.md's quality-gate discipline)
- **Issue:** `createHash("sha256").update(ip + PEPPER).digest("hex")` as a single-line 3-call chain violates the project's biome formatter rule for member-chain wrapping.
- **Fix:** Broke the chain across three lines (`.update(...)` / `.digest(...)` each on their own line).
- **Files modified:** `src/lib/rate-limit/check-rate-limit.ts`
- **Commit:** `8cdd5ea`

**Total deviations:** 1 auto-fixed (Rule 1, style). **Impact on plan:** cosmetic only; no behavior change, no scope creep.

### Also discovered but explicitly out of scope (logged, not fixed)

Two pre-existing issues were surfaced by running `biome check` against files this plan touches, but both predate this plan's changes and are logged in `.planning/phases/02-core-ticketing/deferred-items.md` rather than fixed here (SCOPE BOUNDARY):
- Repo-wide CRLF-vs-LF formatter mismatch caused by `core.autocrlf=true` on this Windows checkout (reproduced identically on untouched files `src/lib/db.ts` and `src/lib/worker/jobs/heartbeat.ts` — not caused by this plan).
- `src/lib/worker/index.ts` import-order (`organizeImports`) violation between `PgBoss`/`Job` imports — confirmed present in the commit *before* this plan's Task 3 edit (inherited from Phase 1).

## Issues Encountered

**Worktree was behind master.** Per the orchestrator's note, this worktree branch was still at the pre-Wave-1 commit (missing 02-01 schema/scopedDb and 02-02 deps/tokens/renderMarkdown). Fast-forwarded (`git merge master --ff-only`) to `6871bd6` before starting, then ran `pnpm install` and (`volta run --node 22`) `pnpm prisma generate` with a placeholder `DATABASE_URL` to regenerate the Prisma client (Node 20 default lacks the >=22 engine `prisma.config.ts` expects to load cleanly; no live DB connection is required for `generate`, only a resolvable `DATABASE_URL` env var per Phase-1's known Prisma-config pitfall).

## User Setup Required

None - no external service configuration required. (Optional: `RATE_LIMIT_PEPPER` env var can be set for production to avoid using the default pepper string; not required for local dev/self-host defaults.)

## Next Phase Readiness

- `slaFlagHandler`, `checkRateLimit`, and `rateLimitCleanupHandler` are ready to be consumed: plan 09 (Server Actions) must clear `isAtRisk`/`isBreached` on first-response/resolve; the public intake Route Handler (plan 08/AIDA-08 work) should call `checkRateLimit("public-intake", ip)` before creating a ticket.
- No blockers for subsequent Wave 2/3 plans in this phase.

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created files and commit hashes verified present on disk / in git history.
