---
phase: 02-core-ticketing
plan: 04
subsystem: search-and-attachments
tags: [postgres-fts, tsquery, multi-tenant, file-storage, path-traversal]

# Dependency graph
requires:
  - phase: 02-core-ticketing
    plan: "01"
    provides: Ticket/Message searchVector tsvector+GIN columns, scopedDb DOMAIN_MODELS allowlist, Testcontainers integration harness
provides:
  - "searchTickets(orgId, queryText, limit) — the ONLY raw-SQL FTS call site against Ticket/Message"
  - "FileStorage interface + localFileStorage — S3-ready attachment storage abstraction over UPLOADS_DIR"
  - "buildStorageKey() — server-generated, path-traversal-proof on-disk attachment key"
  - "MAX_BYTES / ALLOWED_MIME / MAX_TOTAL_REQUEST_BYTES centralized attachment limits"
affects: [02-09 (composer attachments), 02-11 (public web-form intake attachments), 02-12 (public status-page follow-up attachments), 02-08 (inbox search box)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Raw $queryRaw (tagged-template, never $queryRawUnsafe) as the sole, explicitly-org-filtered exception to scopedDb — documented in-file so no future call site copies the raw-SQL pattern without the organizationId filter"
    - "Server-generated storage keys (random hex + sanitized extension) as the structural path-traversal guard — original filename is only ever metadata, never part of a filesystem path"

key-files:
  created:
    - src/lib/tickets/search.ts
    - src/lib/attachments/constants.ts
    - src/lib/attachments/file-storage.ts
    - src/lib/attachments/local-file-storage.ts
    - tests/integration/search-isolation.test.ts
  modified: []

key-decisions:
  - "Plan 03 (createTicket helper) had not landed in this worktree at execution time — search-isolation.test.ts seeds tickets/messages via bare prisma.ticket.create / prisma.message.create with every required field, per the plan's documented fallback."
  - "buildStorageKey() uses crypto.randomBytes(16).toString('hex') (no new dependency) rather than a cuid library, per the plan's explicit either/or instruction."
  - "Test coverage extended beyond the plan's minimum (subject-match isolation) to also prove message-body-match isolation, directly exercising the EXISTS-subquery half of searchTickets's WHERE clause."

requirements-completed: [AIDA-02, AIDA-07]

# Metrics
duration: 40min
completed: 2026-07-02
---

# Phase 02 Plan 04: FTS Search + Attachment Storage Summary

**Org-safe `searchTickets()` (the single reviewed `$queryRaw` call site, ranked via `websearch_to_tsquery`) proven cross-tenant-isolated by a two-scenario Testcontainers test, plus an S3-ready `FileStorage` abstraction with a path-traversal-proof local Docker-volume implementation and centralized 10MB/MIME-allowlist limits.**

## Performance

- **Duration:** ~40 min (including worktree fast-forward to master, `pnpm install`, `prisma generate`)
- **Completed:** 2026-07-02
- **Tasks:** 2 completed
- **Files modified:** 5 created (2 lib files for search, 3 lib files for attachments, 1 integration test)

## Accomplishments

- `src/lib/tickets/search.ts`: `searchTickets(orgId, queryText, limit=25)` — tagged-template `$queryRaw` against `Ticket`/`Message`, explicit `t."organizationId" = ${orgId}` filter, `websearch_to_tsquery('english', ...)` matching on both the ticket's own `searchVector` and (via `EXISTS`) any message's `searchVector`, ranked by `ts_rank`. In-file comment flags it as the only raw-SQL call site and states why (`scopedDb` does not intercept `$queryRaw`).
- `tests/integration/search-isolation.test.ts`: two scenarios — (1) subject-match isolation: orgA and orgB each get a ticket with the identical distinctive subject word; `searchTickets(orgA.id, ...)` returns orgA's ticket and never orgB's, and vice versa; (2) message-body-match isolation: same pattern but the distinctive word lives only in a `Message.bodyMarkdown`, proving the `EXISTS` subquery path is also org-scoped. Both green against a real Testcontainers Postgres.
- `src/lib/attachments/constants.ts`: `MAX_BYTES` (10,485,760), `ALLOWED_MIME` (jpeg/png/gif/webp/pdf/text-plain/csv), `MAX_TOTAL_REQUEST_BYTES` (30MB combined cap for multi-file public intake).
- `src/lib/attachments/file-storage.ts`: `FileStorage` interface (`save`/`read`/`delete`), S3-ready shape.
- `src/lib/attachments/local-file-storage.ts`: `localFileStorage` implementation writing under `UPLOADS_DIR/{orgId}/{key}` (`UPLOADS_DIR` defaults to `/data/uploads`); `safeKey()` rejects any key not matching `^[a-z0-9]+\.[a-z0-9]{1,8}$/i`, making path traversal structurally impossible regardless of upstream bugs; `buildStorageKey(originalFilename)` generates `<32-hex-char>.<sanitized-ext>` (default `bin` if no usable extension) — the original filename is never used to build a path.

## Task Commits

Each task was committed atomically:

1. **Task 1: searchTickets() org-safe raw FTS + isolation test** - `916a5f7` (feat)
2. **Task 2: FileStorage interface + localFileStorage + constants** - `05749aa` (feat) — also carries a `biome --write` formatting fix to Task 1's test file, discovered while linting Task 2's new files

**Plan metadata:** (this commit, following SUMMARY/STATE/ROADMAP update)

## Files Created/Modified

- `src/lib/tickets/search.ts` - `searchTickets()`, the sole raw-SQL FTS call site
- `tests/integration/search-isolation.test.ts` - 2 tests: subject-match isolation, message-body-match isolation
- `src/lib/attachments/constants.ts` - `MAX_BYTES`, `ALLOWED_MIME`, `MAX_TOTAL_REQUEST_BYTES`
- `src/lib/attachments/file-storage.ts` - `FileStorage` interface
- `src/lib/attachments/local-file-storage.ts` - `localFileStorage`, `safeKey()`, `buildStorageKey()`

## Decisions Made

- Used bare Prisma inserts (not `createTicket`) in the isolation test since plan 03 had not landed in this worktree yet — matches the plan's explicit contingency instruction, so no blocking dependency was introduced between 02-03 and 02-04.
- Extended test coverage to a second scenario (message-body match) beyond the plan's literal minimum, because the `must_haves.truths` explicitly calls out body-match as a required search capability, not just subject/number match — worth proving in the same isolation test rather than deferring to a later UI-integration plan.

## Deviations from Plan

### Environment / Setup (not a plan deviation, but required before any task work)

- **Worktree was 29 commits behind local `master`** (missing all Phase 2 planning docs, Wave 1's schema/migrations/scopedDb allowlist, and the `02-04-PLAN.md` file itself). Fast-forwarded via `git merge --ff-only master` per the orchestrator's note — the worktree branch was a strict ancestor of `master` with zero divergent commits, so this was safe and lossless.
- Ran `pnpm install` (installs `@testcontainers/postgresql`, `file-type`, markdown deps, etc. added in Wave 1) and `pnpm prisma generate` (required `.env` — copied from `.env.example`, both gitignored per prior plans' documented bootstrap step) before any code could typecheck.
- Integration tests require Node 22 for Testcontainers/undici compatibility (documented in STATE.md); this environment's default `pnpm` resolves Node 20.20.2, so `volta run --node 22 pnpm test:integration` was used, exactly per the existing STATE.md guidance — not a new deviation.

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome formatting violations in newly-written files**
- **Found during:** Task 2 lint check (`pnpm exec biome check`)
- **Issue:** `file-storage.ts`, `local-file-storage.ts`, and `search-isolation.test.ts` had minor formatting deviations from the project's Biome config (line-wrapping of multi-property object types/params).
- **Fix:** `pnpm exec biome check --write` on the affected files.
- **Files modified:** `src/lib/attachments/file-storage.ts`, `src/lib/attachments/local-file-storage.ts`, `tests/integration/search-isolation.test.ts`
- **Commit:** `05749aa`

No other deviations. No architectural changes, no scope creep.

## Issues Encountered

- None beyond the worktree-sync/environment-bootstrap steps documented above (expected, not code issues).

## Verification

- `pnpm exec tsc --noEmit` — clean.
- `volta run --node 22 pnpm test:integration` (all 3 integration test files) — 6/6 tests green, including both new `search-isolation.test.ts` tests.
- `pnpm test` (unit suite) — 14/14 green, unaffected.
- `src/lib/tickets/search.ts` contains no `$queryRawUnsafe`; contains `websearch_to_tsquery` and `t."organizationId" = ${orgId}`.
- `src/lib/attachments/local-file-storage.ts` contains `safeKey` with the exact regex `^[a-z0-9]+\.[a-z0-9]{1,8}$` and exports `buildStorageKey`.
- `src/lib/attachments/constants.ts` exports `MAX_BYTES` (10485760) and `ALLOWED_MIME` containing `application/pdf`.

## Next Phase Readiness

- `searchTickets()` is ready for the inbox search box (plan 08) to call directly.
- `FileStorage`/`localFileStorage`/`buildStorageKey`/attachment constants are ready for the composer (plan 09), public web-form intake (plan 11), and public status-page follow-up (plan 12) to build their upload Route Handlers on top of, per RESEARCH.md Topic 4's illustrative Route Handler shape (not built in this plan — this plan ships only the storage/limits primitives, as scoped).
- No new env vars or docker-compose changes were required in this plan; `UPLOADS_DIR` volume wiring remains a to-do noted in RESEARCH.md for whichever plan first exercises `localFileStorage` end-to-end (plan 09 or 11).

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created files found on disk (`src/lib/tickets/search.ts`, `src/lib/attachments/constants.ts`, `src/lib/attachments/file-storage.ts`, `src/lib/attachments/local-file-storage.ts`, `tests/integration/search-isolation.test.ts`); both task commit hashes (`916a5f7`, `05749aa`) found in git history.
