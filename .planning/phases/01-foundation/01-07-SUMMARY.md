---
phase: 01-foundation
plan: "07"
subsystem: infra
tags: [docker, docker-compose, caddy, nextjs-standalone, esbuild, pg-boss, prisma, pgvector, pnpm]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Next.js app shell, Prisma schema+migrations, pg-boss worker, /api/health endpoint"
provides:
  - "Multi-stage Dockerfile: deps → builder → runner (one image for app+worker)"
  - "docker-compose.yml: db (pgvector:pg16) + migrate + app + worker + caddy, healthchecks, named volumes"
  - "Caddyfile: {$DOMAIN:localhost} reverse proxy with auto-HTTPS for real domains"
  - "docker compose up brings whole stack up from clean clone, applies migrations, passes healthcheck"
affects: [deployment, readme, onboarding, self-host]

# Tech tracking
tech-stack:
  added: [caddy:2, pgvector/pgvector:pg16, esbuild (bundling), node:22-alpine]
  patterns:
    - "One image two services: runner stage CMD=app, compose overrides command for worker"
    - "Multi-stage build: deps (frozen install), builder (generate+build+bundle), runner (minimal)"
    - "esbuild ESM bundle for worker: --format=esm required by Prisma 7 generated client (import.meta.url)"
    - "Externalize @prisma/client from esbuild + copy from pnpm virtual store (resolves symlinks)"
    - "pg-boss v12 explicit queue creation before work()/schedule()"
    - "Healthcheck uses 127.0.0.1 not localhost (Alpine IPv6 resolution)"

key-files:
  created:
    - Dockerfile
    - .dockerignore
    - docker-compose.yml
    - Caddyfile
    - public/.gitkeep
  modified:
    - src/lib/db.ts (DB_POOL_MAX env var)
    - src/lib/worker/index.ts (createQueue before work/schedule)
    - src/app/(auth)/login/page.tsx (force-dynamic)
    - src/app/(auth)/setup/page.tsx (force-dynamic)
    - package.json (better-call@1.3.7 override)
    - pnpm-lock.yaml (regenerated)
    - .env.example (BETTER_AUTH_URL guidance + DB_POOL_MAX docs)

key-decisions:
  - "D-09: One shared runner image — docker-compose CMD override distinguishes app from worker"
  - "D-10: esbuild ESM bundle for worker (not CJS) — Prisma 7 generated client uses import.meta.url"
  - "D-11: pgvector/pgvector:pg16 with named postgres_data volume"
  - "D-12: Caddy as reverse proxy — auto-HTTPS for real domains, local CA for localhost"
  - "D-13: node:22-alpine base with corepack/pnpm"
  - "esbuild externals: @prisma/client stays external (CJS runtime uses require('node:path') which esbuild __require2 cannot resolve in ESM bundles); copied from pnpm virtual store with -rL to get client-runtime-utils alongside"

patterns-established:
  - "Alpine healthcheck: use 127.0.0.1 not localhost (::1 vs 0.0.0.0 binding)"
  - "pnpm symlinks in Docker COPY: cp -rL from virtual store entry to /tmp before COPY --from"
  - "DATABASE_URL build arg with placeholder value for prisma generate (avoids module-load throw)"
  - "pg-boss v12 pattern: createQueue() → work() → schedule() in that order"

requirements-completed: [AIDA-21]

# Metrics
duration: 180min
completed: 2026-06-29
---

# Phase 01 Plan 07: One-Command Self-Host (AIDA-21) Summary

**Multi-stage Dockerfile (Node 22-alpine, pnpm, Next.js standalone + esbuild ESM worker bundle) wired with docker-compose (db/migrate/app/worker/caddy) and Caddyfile, delivering `docker compose up` one-command self-host with auto-migrations, healthchecks, named volumes, and pg-boss worker heartbeat confirmed via /api/health.**

## Performance

- **Duration:** ~180 min (including 7 deviation fixes discovered during end-to-end validation)
- **Started:** 2026-06-29T03:00:00Z
- **Completed:** 2026-06-29T05:00:00Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- `docker compose up` from clean clone: db healthy → migrate no-op → app (healthy) → worker started → caddy serving — all in ~45s
- `/api/health` returns `{"status":"ok","db":"connected","worker":{"lastRunAt":"..."}}` through Caddy
- `docker compose down && up` (no `-v`): migrate is no-op ("No pending migrations to apply"), data persists
- Worker heartbeat confirmed: pg-boss queue created, job scheduled every minute, lastRunAt populated in health response
- Connection pool sizing: `app.DB_POOL_MAX=10` + `worker.DB_POOL_MAX=5` = 15 < Postgres default 100

## Task Commits

1. **Task 1: Dockerfile + .dockerignore** - `304b593` (feat)
2. **Task 2: docker-compose.yml + Caddyfile + pool sizing** - `145471d` (feat)
3. **Task 3: end-to-end validation + all deviation fixes** - `8194d33` (feat)

**Plan metadata:** (this SUMMARY commit)

## Files Created/Modified

- `Dockerfile` — 4-stage multi-stage build (base, deps, builder, runner); builder runs prisma generate + next build + esbuild; runner copies standalone + dist + prisma + @prisma scope from pnpm virtual store
- `.dockerignore` — excludes node_modules, .next, .git, .planning, dist, .env files, src/generated
- `docker-compose.yml` — 5 services: db (pgvector:pg16), migrate (builder target, restart:no), app (512m, healthcheck 127.0.0.1), worker (1g), caddy (ports 80/443 + named volumes)
- `Caddyfile` — `{$DOMAIN:localhost}` block with reverse_proxy + encode zstd gzip
- `src/lib/db.ts` — added `max: Number(process.env.DB_POOL_MAX) || 10` to pg.Pool
- `src/lib/worker/index.ts` — added `boss.createQueue("heartbeat")` before work()/schedule()
- `src/app/(auth)/login/page.tsx` — added `export const dynamic = "force-dynamic"`
- `src/app/(auth)/setup/page.tsx` — added `export const dynamic = "force-dynamic"`
- `package.json` — added `pnpm.overrides: { "better-call": "1.3.7" }` to fix kAPIErrorHeaderSymbol error
- `pnpm-lock.yaml` — regenerated to resolve better-call@1.3.7 for better-auth/core
- `.env.example` — added BETTER_AUTH_URL Docker URL guidance + DB_POOL_MAX section
- `public/.gitkeep` — placeholder so COPY --from=builder /app/public does not fail

## Decisions Made

- **ESM over CJS for worker bundle**: Prisma 7's generated `client.ts` executes `globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))` at module load. In CJS output (`--format=cjs`), esbuild sets `import.meta` to `{}` making `import.meta.url` undefined → crash. ESM output preserves `import.meta.url` natively.
- **@prisma/client externalized, not bundled**: The `@prisma/client/runtime/client.js` (CJS) does `require('node:path')`. In an ESM bundle, esbuild wraps CJS code in a `__require2` shim that can't resolve Node.js built-in modules → `Dynamic require of "node:path" is not supported`. Keeping it external means Node.js's native CJS loader handles `require('node:path')` correctly.
- **pnpm virtual store copy pattern**: `cp -rL "${PRISMA_STORE}/node_modules/@prisma" /tmp/prisma-scope` — copies from the SPECIFIC pnpm virtual store entry for `@prisma/client` (not top-level `node_modules/@prisma/`) to get BOTH `@prisma/client` AND `@prisma/client-runtime-utils` (transitive dep only in virtual store). The `-rL` dereferences all symlinks so the runner has plain files without needing `.pnpm/` virtual store.
- **Healthcheck uses 127.0.0.1**: Alpine Linux resolves `localhost` to `::1` (IPv6) but Next.js standalone listens on `0.0.0.0` (IPv4 only). Using `localhost` in the healthcheck gets "Connection refused".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prisma generate fails: DATABASE_URL throws at module load**
- **Found during:** Task 1 (Dockerfile builder stage)
- **Issue:** `prisma.config.ts` calls `env("DATABASE_URL")` at module load time. Even `prisma generate` (no DB connection needed) fails if DATABASE_URL is unset in the build environment.
- **Fix:** Added `ARG DATABASE_URL=postgresql://placeholder:...` + `ENV DATABASE_URL=${DATABASE_URL}` before `RUN pnpm prisma generate` in builder stage.
- **Files modified:** `Dockerfile`
- **Verification:** `docker compose build` succeeds with prisma generate output visible.
- **Committed in:** `304b593` (Task 1 commit)

**2. [Rule 1 - Bug] pnpm build fails: kAPIErrorHeaderSymbol not exported**
- **Found during:** Task 3 (end-to-end validation — `pnpm build` in Docker)
- **Issue:** `better-auth@1.6.22` requires `better-call@1.3.7` (added `kAPIErrorHeaderSymbol`) but pnpm lockfile had `better-call@1.1.8`. Turbopack's strict ESM static analysis catches the missing export during production build (`next build`) — `next dev` was never affected.
- **Fix:** Added `"pnpm": { "overrides": { "better-call": "1.3.7" } }` to `package.json`, ran `pnpm install` to regenerate lockfile.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm build` succeeds locally; build step passes in Docker.
- **Committed in:** `8194d33` (Task 3 commit)

**3. [Rule 1 - Bug] Static prerender of /setup and /login fails during build**
- **Found during:** Task 3 (next build in Docker)
- **Issue:** `/setup/page.tsx` and `/login/page.tsx` call `prisma.user.count()` at the top level without calling `headers()` or `cookies()`, so Next.js attempts static prerendering during build. The DB call fails because there's no DB during build.
- **Fix:** Added `export const dynamic = "force-dynamic"` to both pages.
- **Files modified:** `src/app/(auth)/setup/page.tsx`, `src/app/(auth)/login/page.tsx`
- **Verification:** `pnpm build` succeeds; pages are server-rendered at request time.
- **Committed in:** `8194d33` (Task 3 commit)

**4. [Rule 1 - Bug] COPY --from=builder /app/public fails (directory does not exist)**
- **Found during:** Task 3 (docker compose build — runner stage)
- **Issue:** No `public/` directory exists in the AIDA project root. The `COPY --from=builder /app/public ./public` step fails.
- **Fix:** Created `public/.gitkeep` placeholder.
- **Files modified:** `public/.gitkeep` (created)
- **Verification:** Docker build runner stage succeeds.
- **Committed in:** `8194d33` (Task 3 commit)

**5. [Rule 1 - Bug] Worker crashes: import.meta.url undefined in CJS esbuild output**
- **Found during:** Task 3 (docker compose up — worker container)
- **Issue:** esbuild CJS output sets `import.meta = {}` so `import.meta.url` is undefined. Prisma 7 generated client runs `fileURLToPath(import.meta.url)` at module load → `ERR_INVALID_ARG_TYPE`.
- **Fix:** Changed esbuild `--format=cjs` to `--format=esm`, output file from `dist/worker.cjs` to `dist/worker.mjs`. ESM natively supports `import.meta.url`. Updated compose worker command accordingly.
- **Files modified:** `Dockerfile`, `docker-compose.yml`
- **Verification:** Worker starts without crash; logs show `[worker] started`.
- **Committed in:** `8194d33` (Task 3 commit)

**6. [Rule 1 - Bug] Worker crashes: @prisma/client runtime cannot be bundled in ESM (dynamic require of Node.js built-ins)**
- **Found during:** Task 3 (after fix 5 — worker still crashing)
- **Issue:** `@prisma/client/runtime/client.js` (CJS) does `require('node:path')` inside code that esbuild bundles into the ESM worker. esbuild's `__require2` shim cannot resolve Node.js built-in modules with `node:` prefix → `Dynamic require of "node:path" is not supported`. `pg` has the same issue with `require('events')`.
- **Fix:** Added `--external:pg --external:@prisma/client` to esbuild command. Copied `@prisma/client` + `@prisma/client-runtime-utils` from the pnpm virtual store (using `cp -rL "${PRISMA_STORE}/node_modules/@prisma" /tmp/prisma-scope`) and added `COPY --from=builder /tmp/prisma-scope ./node_modules/@prisma` in runner stage. `pg` is already in standalone's node_modules (traced by Next.js NFT).
- **Files modified:** `Dockerfile`
- **Verification:** Worker starts; `node_modules/@prisma/` contains `client` + `client-runtime-utils` in runner image.
- **Committed in:** `8194d33` (Task 3 commit)

**7. [Rule 1 - Bug] Healthcheck fails: Alpine localhost resolves to IPv6 ::1**
- **Found during:** Task 3 (app container showed as "unhealthy")
- **Issue:** Alpine's `localhost` resolves to `::1` (IPv6 loopback) but Next.js standalone listens on `0.0.0.0` (IPv4 only). `wget http://localhost:3000/api/health` → "Connection refused" even though the server IS running.
- **Fix:** Changed healthcheck test from `http://localhost:3000/api/health` to `http://127.0.0.1:3000/api/health`.
- **Files modified:** `docker-compose.yml`
- **Verification:** App container status shows `(healthy)` after fix.
- **Committed in:** `8194d33` (Task 3 commit)

**8. [Rule 1 - Bug] Worker crashes: pg-boss v12 queue does not exist**
- **Found during:** Task 3 (worker running but crashing after startup)
- **Issue:** pg-boss v12 removed implicit queue creation. Calling `boss.work("heartbeat", ...)` and `boss.schedule("heartbeat", ...)` when the queue row doesn't exist in the `queue` table → foreign key violation (23503).
- **Fix:** Added `await boss.createQueue("heartbeat")` between `boss.start()` and `boss.work(...)`. `createQueue` is idempotent.
- **Files modified:** `src/lib/worker/index.ts`
- **Verification:** Worker shows `[worker] started` with no pg-boss errors; `/api/health` reports `worker.lastRunAt`.
- **Committed in:** `8194d33` (Task 3 commit)

---

**Total deviations:** 8 auto-fixed (all Rule 1 — pre-existing bugs exposed by first production build)
**Impact on plan:** All fixes necessary for the stack to build and run. No scope creep. The original plan's esbuild CJS approach was correct in intent but Prisma 7's generated client (ESM-first with import.meta.url) required the ESM pivot. The pnpm virtual store symlink handling was a known pitfall (documented in the plan) and resolved with cp -rL.

## Known Stubs

None - all delivery items fully wired. `/api/health` reports real DB status and real worker last-run timestamp.

## Issues Encountered

- **pnpm symlink resolution for Docker COPY**: pnpm stores packages in `.pnpm/` virtual store with symlinks at `node_modules/@scope/package`. Docker COPY follows top-level symlinks but the COPIED files can't resolve their transitive deps (e.g., `@prisma/client-runtime-utils` is only alongside `@prisma/client` in the virtual store, not at the top-level `node_modules/@prisma/` scope). Fix: `cp -rL` from the specific virtual store entry (`@prisma+client@7.8.0*`) to get all `@prisma/*` deps as plain files, then COPY to runner.
- **Caddy localhost HTTPS**: `{$DOMAIN:localhost}` causes Caddy to use its local CA (HTTPS with 308 redirect on port 80). This is expected Caddy behavior. The healthcheck bypasses Caddy (direct to app:3000), so this does not affect stack health. Browser users on `https://localhost` will see a self-signed cert warning unless they run `caddy trust`.

## User Setup Required

Before running `docker compose up`, copy `.env.example` to `.env` and set:
- `POSTGRES_PASSWORD` — required
- `BETTER_AUTH_SECRET` — required (run `openssl rand -hex 32`)
- `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` — use `http://localhost` for local or `https://yourdomain.com` for production
- `DOMAIN` — optional, defaults to `localhost`

## Next Phase Readiness

- One-command self-host works end-to-end: `docker compose up` → healthy stack in ~45s
- Migrations applied automatically on startup; subsequent restarts are no-ops
- Worker heartbeat running; pg-boss infrastructure ready for additional job queues
- `docker compose down -v` cleanly tears everything down for testing
- Ready for README quick-start docs (next priority) and AI/LLM integration phases

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
