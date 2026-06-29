---
phase: 01-foundation
plan: "04"
subsystem: worker
tags: [pg-boss, worker, healthcheck, tdd, vitest]

# Dependency graph
requires:
  - phase: 01-foundation/01-02
    provides: "prisma.systemSetting (SystemSetting model); bare prisma client at @/lib/db"
provides:
  - src/lib/worker/index.ts: "pg-boss worker entrypoint — start, work, schedule, graceful SIGTERM/SIGINT shutdown"
  - src/lib/worker/jobs/heartbeat.ts: "heartbeatHandler — upserts SystemSetting heartbeat:lastRunAt each run"
  - src/app/api/health/route.ts: "GET /api/health — 200 {status,db,worker.lastRunAt} | 503 {status,db}"
  - tests/unit/health.test.ts: "unit tests covering 200 healthy and 503 db-down paths"
affects: [07-docker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pg-boss 12.x: named import { PgBoss } from 'pg-boss' (no default export)"
    - "pg-boss 12.x work handler receives array: async ([job]: Job[]) => {} (array destructuring mandatory)"
    - "pg-boss schedule() is upsert-safe — calling on every worker start is idempotent"
    - "Worker files use relative imports only (../../db, ./jobs/heartbeat) — no @/ alias — for esbuild bundling"
    - "Health route uses @/ alias (Next.js webpack handles it); worker entrypoint uses relative (esbuild)"
    - "SystemSetting key: heartbeat:lastRunAt stores ISO-8601 timestamp of last worker run"
    - "GET /api/health reads heartbeat:lastRunAt from SystemSetting — dual-purpose: not throwaway code"
    - "Route: export const dynamic = 'force-dynamic' prevents stale cache on health endpoint"
    - "TDD pattern: vi.mock hoisting + static import for predictable mock behavior in Vitest"

key-files:
  created:
    - src/lib/worker/index.ts
    - src/lib/worker/jobs/heartbeat.ts
    - src/app/api/health/route.ts
    - tests/unit/health.test.ts
  modified: []

key-decisions:
  - "pg-boss 12.x exports PgBoss as a named export, not a default export — import { PgBoss } from 'pg-boss'"
  - "Work handler array destructuring typed as async ([job]: Job[]) => {} to satisfy TypeScript strict mode"
  - "Health route returns { status:'no heartbeat yet' } when SystemSetting row is absent (worker not yet run) vs 503 which means DB is down"
  - "TDD: wrote tests with static import (not dynamic await import) for reliable vi.mock hoisting behavior"
  - "Worker branch was 2 commits behind master — merged master to get Plans 01-02 source code before implementing Plan 04"

requirements-completed: [AIDA-21]

# Metrics
duration: ~17min
completed: "2026-06-29"
---

# Phase 01 Plan 04: pg-boss Worker + Healthcheck Summary

**pg-boss 12.x worker entrypoint with a recurring heartbeat job writing SystemSetting['heartbeat:lastRunAt'] and a `/api/health` Route Handler reporting DB + worker liveness (200/503), verified by two unit tests — full queue path proven, docker-compose healthcheck target ready.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 2
- **Files created:** 4

## Accomplishments

- `src/lib/worker/jobs/heartbeat.ts`: exports `heartbeatHandler` that upserts `SystemSetting` row with key `heartbeat:lastRunAt` = current ISO-8601 timestamp on every run
- `src/lib/worker/index.ts`: standalone pg-boss worker — `new PgBoss(connectionString)`, `boss.start()`, `boss.work("heartbeat", async ([job]: Job[]) => ...)` (array destructuring per v10+ API), `boss.schedule("heartbeat", "* * * * *", {})` (idempotent cron every minute), graceful `SIGTERM`/`SIGINT` shutdown via `boss.stop()`
- `src/app/api/health/route.ts`: `GET` route handler returning `{ status:"ok", db:"connected", worker:{lastRunAt} }` (200) when `systemSetting.findUnique` succeeds, or `{ status:"error", db:"unreachable" }` (503) when it throws; `export const dynamic = "force-dynamic"` prevents cache staleness
- `tests/unit/health.test.ts`: two unit tests — 200 healthy (mocked findUnique returns value) and 503 db-down (mocked findUnique throws) — both pass via Vitest with `vi.mock("@/lib/db")`

## Task Commits

1. **Task 1: pg-boss worker entrypoint + heartbeat job** — `071f1df` (feat)
2. **Task 2 RED: failing tests for GET /api/health** — `fa4548c` (test)
3. **Task 2 GREEN: /api/health route handler** — `63a4f46` (feat)

## Files Created

- `src/lib/worker/jobs/heartbeat.ts` — heartbeatHandler: upserts SystemSetting heartbeat:lastRunAt with current ISO timestamp; bare prisma client via relative import `../../db`
- `src/lib/worker/index.ts` — Worker entrypoint: PgBoss (named export, not default), boss.work("heartbeat") with array destructuring, boss.schedule for idempotent cron, SIGTERM/SIGINT graceful shutdown; relative imports only (no @/ alias) for esbuild bundling
- `src/app/api/health/route.ts` — GET /api/health: reads SystemSetting heartbeat:lastRunAt, returns 200 with worker.lastRunAt or { status: "no heartbeat yet" } if no row; 503 on DB error; force-dynamic to prevent caching
- `tests/unit/health.test.ts` — Unit tests: mocks @/lib/db with vi.mock; Test A: resolves with heartbeat value → asserts 200, status:"ok", db:"connected", worker.lastRunAt; Test B: rejects with Error → asserts 503, status:"error", db:"unreachable"

## pg-boss 12.x API Notes (for Plan 07)

The installed pg-boss 12.23.0 uses:
- **Named export:** `import { PgBoss } from "pg-boss"` — NOT a default export
- **Work handler signature:** `WorkHandler<ReqData>` receives `Job<ReqData>[]` (array) — use `async ([job]: Job[]) => {}`
- **schedule():** Returns `Promise<void>`; calling it on every worker start is idempotent (upsert-safe)
- **stop():** Returns `Promise<void>`; call on SIGTERM for graceful shutdown

## Health Response Shape (for Plan 07 docker-compose healthcheck)

```json
// 200 — healthy
{ "status": "ok", "db": "connected", "worker": { "lastRunAt": "2026-01-01T00:00:00.000Z" } }

// 200 — healthy DB, worker not yet run
{ "status": "ok", "db": "connected", "worker": { "status": "no heartbeat yet" } }

// 503 — DB unreachable
{ "status": "error", "db": "unreachable" }
```

**Recommended docker-compose healthcheck command:**
```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -sf http://localhost:3000/api/health | grep -q '\"status\":\"ok\"' || exit 1"]
  interval: 30s
  timeout: 5s
  retries: 3
```

## SystemSetting Key

| Key | Value format | Written by | Read by |
|-----|-------------|-----------|---------|
| `heartbeat:lastRunAt` | ISO-8601 timestamp string | `heartbeatHandler` (worker) | `GET /api/health` (Route Handler) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pg-boss 12.x has no default export — changed to named import**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `import PgBoss from "pg-boss"` → TS2613 "Module has no default export." pg-boss 12.x exports `PgBoss` as a named export only.
- **Fix:** Changed to `import { PgBoss } from "pg-boss"` and `import type { Job } from "pg-boss"` for array type annotation.
- **Files modified:** `src/lib/worker/index.ts`
- **Commit:** `071f1df`

**2. [Rule 1 - Bug] TypeScript strict mode requires explicit types in work handler**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `async ([job]) => {}` TS7031 "Binding element 'job' implicitly has an 'any' type" and `(err) => ...` TS7006 "Parameter 'err' implicitly has an 'any' type"
- **Fix:** Added `Job[]` type annotation: `async ([job]: Job[]) => {}` and typed error parameters as `Error` and `unknown`
- **Files modified:** `src/lib/worker/index.ts`
- **Commit:** `071f1df`

**3. [Rule 3 - Blocking] Generated Prisma client missing in worktree**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** TS2307 "Cannot find module '@/generated/prisma/client'" — the worktree was merged from master but `src/generated/prisma/` is gitignored and thus absent.
- **Fix:** Ran `DATABASE_URL="..." prisma generate` in the worktree to generate the client locally.
- **Files modified:** `src/generated/prisma/` (generated, gitignored)

**4. [Rule 3 - Blocking] Worktree branch was 2 commits behind master**
- **Found during:** Initial setup (before Task 1)
- **Issue:** Worktree branch `worktree-agent-ab3f29077bac63468` was at commit `bc44476` (initial scaffold only), missing all Plans 01-02 source code that Plan 04 depends on.
- **Fix:** `git merge master` fast-forwarded the worktree branch to `c36d5f2`, bringing in all Prisma schema, auth, DB client, and scaffold code.
- **Files modified:** Whole project structure (fast-forward merge)
- **Commit:** Resolved via fast-forward — no additional commit required

## Known Stubs

None. All files are fully wired:
- `heartbeatHandler` writes real data (SystemSetting upsert)
- `GET /api/health` reads real data (SystemSetting findUnique)
- Unit tests mock the DB layer and verify actual HTTP response shapes

The end-to-end path (worker process → actual pg-boss queue → real DB → health endpoint) is validated in Plan 07 under real `docker compose up`.

---

## Self-Check: PASSED

- `src/lib/worker/index.ts` — FOUND
- `src/lib/worker/jobs/heartbeat.ts` — FOUND
- `src/app/api/health/route.ts` — FOUND
- `tests/unit/health.test.ts` — FOUND
- Commit `071f1df` (feat worker) — FOUND in git log
- Commit `fa4548c` (test RED) — FOUND in git log
- Commit `63a4f46` (feat health route) — FOUND in git log

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
