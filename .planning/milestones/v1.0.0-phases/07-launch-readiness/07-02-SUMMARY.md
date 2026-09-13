---
phase: 07-launch-readiness
plan: 02
subsystem: database
tags: [prisma, demo-data, seed-script, insight, audit-trail, csat, fixtures]

# Dependency graph
requires:
  - phase: 02-core-ticketing
    provides: createTicket() single write path, SLA targets/due-timestamp math, tag/custom-field models
  - phase: 04-ai-foundation
    provides: triage columns, AuditEvent model + recordAuditEvent() write path
  - phase: 05-rag-drafted-replies
    provides: createKbArticle() single write path, KB article/chunk schema
  - phase: 06-aida-insight
    provides: InsightRun schema + the five persisted JSON shapes (src/lib/insight/types.ts)
provides:
  - "pnpm db:seed / prisma/seed.ts CLI: turns an empty migrated DB into a fully populated demo helpdesk in one command"
  - "src/lib/demo/fixtures.ts: 12 contacts/7 companies, 8 tags, 3 custom fields, 30 tickets, 6 KB articles — pure data, zero DB imports"
  - "src/lib/demo/seed-demo-data.ts: seedDemoData() orchestrator writing settings/taxonomy/tickets/threads/KB + pre-computed triage/audit/CSAT/3x InsightRun artifacts"
  - "Non-empty-workspace guard (refuses instead of duplicating, since AuditEvent is append-only)"
  - "demo/demo-seed provider-honesty convention for every seeded AI artifact"
affects: [07-07-security-pass, 07-08-hero-gif, 07-10-readme, 07-11-docs-demo-walkthrough]

# Tech tracking
tech-stack:
  added: [dotenv (explicit devDependency — pnpm strict-linking fix for prisma.config.ts/seed.ts's "dotenv/config" side-effect import)]
  patterns:
    - "Demo dataset as pure TS fixtures (fixtures.ts) consumed by a bare-prisma orchestrator (seed-demo-data.ts), reusing createTicket()/createKbArticle() as the single write paths and direct writes only for models with no dedicated helper"
    - "Historical timestamps via createTicket() (stamps now()) + a same-transaction-adjacent follow-up prisma.ticket.update backdating createdAt/updatedAt/SLA fields — createTicket's own SLA math is discarded and recomputed via computeDueTimestamps(createdAt, ...) from the backdated time"
    - "provider:'demo'/model:'demo-seed' on every seeded AuditEvent/InsightRun — the demo-data honesty convention future phases (07-07/07-10/07-11) must keep referencing"
    - "Insight clusters/gaps/volume-drivers/SLA-CSAT/narrative all computed in-memory from the real seeded ticket set per period window — never invented numbers"

key-files:
  created:
    - src/lib/demo/fixtures.ts
    - src/lib/demo/seed-demo-data.ts
    - prisma/seed.ts
  modified:
    - prisma.config.ts
    - package.json

key-decisions:
  - "Demo org/admin bootstrap mirrors src/lib/bootstrap.ts's headless signUpEmail+createOrganization sequence exactly; credentials via DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD env vars, defaulting to admin@demo.aida.test / aida-demo-2026"
  - "Second 'agent' user (agent@demo.aida.test / Sam Rivera) added via the tests/e2e/global-setup.ts precedent: signUpEmail then a direct prisma.member.create (Better Auth model, not scopedDb)"
  - "Non-empty-workspace guard checks Ticket count and refuses (exit 1) rather than offering a destructive reset — AuditEvent's append-only Postgres trigger makes a safe reset-and-reseed structurally impossible"
  - "AI-toggle Setting key is never written by the seed — keeps auto-triage enqueue off and is what makes the 'renders populated with zero LLM configured' claim true"
  - "KB embeddingStatus intentionally left PENDING (no fake COMPLETED) — truthful given no embedding provider is configured in the demo"
  - "No Attachment rows seeded — avoids a localFileStorage mkdir on an absolute /data/uploads path that doesn't exist outside Docker"
  - "Added dotenv as an explicit devDependency (02-02 hast-util-sanitize precedent) — pnpm's strict node_modules linking left it unresolvable as a transitive-only package for prisma/seed.ts's side-effect import, which tsc actually type-checks (prisma.config.ts is tsconfig-excluded, prisma/seed.ts is not)"

patterns-established:
  - "Fixture-driven Insight synthesis: a small INSIGHT_THEMES table (label/description/tag/kbTitle) drives clusters, kbGaps (one real nearestArticle + one genuine null/null zero-embedded-KB case per run), and volume drivers — all computed from real fixture tag data, reusable by any future phase that needs another synthetic-but-honest Insight run"

requirements-completed: [AIDA-22]

# Metrics
duration: 41min
completed: 2026-07-29
---

# Phase 7 Plan 2: Demo Dataset & Seed Script Summary

**One-command `pnpm db:seed` turns an empty migrated database into a fully populated 30-ticket demo helpdesk — including triage, a 37-row AI audit trail, 8 CSAT responses, and 3 COMPLETED Insight runs — that renders every AI surface honestly with zero LLM configured.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-07-29T05:58Z (Task 1 commit)
- **Completed:** 2026-07-29T06:39Z (Task 4 commit)
- **Tasks:** 4
- **Files modified:** 6 (3 created, 3 modified, incl. lockfile)

## Accomplishments

- `src/lib/demo/fixtures.ts` — a dependency-free, 12-contact/7-company, 30-ticket fictional SaaS support workspace hitting every exact distribution the plan specifies (status, priority, SLA state, assignment, triage, CSAT, age spread, reply count).
- `src/lib/demo/seed-demo-data.ts` — `seedDemoData()` writes the full non-AI workspace via `createTicket`/`createKbArticle` (the project's single write paths) plus direct bare-`prisma` writes for taxonomy/custom-field-value/CSAT/InsightRun models, then layers on pre-computed triage fields, a 37-row `AuditEvent` trail (26 TRIAGE + 3 DRAFT_GENERATED + 2 DRAFT_APPROVED + 3 INSIGHT_CLUSTER_LABELS + 3 INSIGHT_SUMMARY), 8 `CsatResponse` rows, and 3 COMPLETED `InsightRun`s (7/30/90-day) with real citations.
- `prisma/seed.ts` — the `pnpm db:seed` CLI: resolves/creates the demo org+admin+agent, guards against re-seeding a non-empty workspace, prints the summary JSON and demo credentials, and exits cleanly despite `createKbArticle`'s open pg-boss pool.
- Proved the whole pipeline end-to-end against a real disposable `pgvector/pgvector:pg16` container: 7 migrations applied clean, first seed run succeeded with the exact documented counts, second run refused with exit 1, and every Insight citation/nearestArticle resolved to a real seeded row.

## Task Commits

1. **Task 1: Demo fixtures module (pure data, zero DB imports)** - `808b536` (feat)
2. **Task 2: seedDemoData core writer (settings, taxonomy, contacts, tickets, threads, KB)** - `074dafc` (feat)
3. **Task 3: Pre-computed AI artifacts — triage, audit trail, CSAT, three Insight runs** - `857cce6` (feat)
4. **Task 4: CLI entrypoint, guard, wiring, and a real end-to-end seed run** - `cfdd345` (feat)

## Files Created/Modified

- `src/lib/demo/fixtures.ts` - Pure demo dataset: `DEMO_CONTACTS` (12), `DEMO_TAGS` (8), `DEMO_CUSTOM_FIELDS` (3), `DEMO_TICKETS` (30), `DEMO_KB_ARTICLES` (6)
- `src/lib/demo/seed-demo-data.ts` - `seedDemoData(orgId, adminUserId, agentUserId, now?)` orchestrator + `SeedDemoSummary` + `DEMO_ARTIFACT_PROVIDER`/`DEMO_ARTIFACT_MODEL` exports
- `prisma/seed.ts` - CLI entrypoint with the org/admin/agent bootstrap + non-empty-workspace guard
- `prisma.config.ts` - `migrations: { seed: "tsx prisma/seed.ts" }` so `prisma db seed`/`migrate reset` work
- `package.json` - `"db:seed": "tsx prisma/seed.ts"` script + `dotenv` devDependency
- `pnpm-lock.yaml` - lockfile update for the new `dotenv` devDependency

## Decisions Made

See `key-decisions` in the frontmatter above — the org/admin/agent bootstrap mirroring, the refuse-not-reset guard, the `aiEnabled`-never-written / `embeddingStatus`-stays-PENDING / no-Attachment-rows honesty exclusions, and the `dotenv` devDependency fix are all first-class decisions future phases (07-07 security pass, 07-10 README, 07-11 docs demo walkthrough) should keep referencing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ticket #2 was accidentally left `triage: null` in the fixtures, breaking the exact 26 COMPLETED / 1 FAILED / 3 null triage-status contract**
- **Found during:** Task 4's real end-to-end seed run (the printed `auditEvents` summary count was 36, one short of the plan's required `>= 37`)
- **Issue:** `fixtures.ts`'s "Slack messages not syncing" ticket (T2) was written with `triage: null` during Task 1, but the fixture's category/sentiment tallies documented in this SUMMARY's design notes already counted it as a COMPLETED `TECHNICAL`/`NEGATIVE` triage — a transcription slip between two drafting passes, giving 25 COMPLETED triages (and therefore only 25 TRIAGE `AuditEvent` rows, 36 total) instead of the specified 26 (37 total)
- **Fix:** Set T2's `triage` to `{ category: "TECHNICAL", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" }`, matching the already-correct category/sentiment tallies; re-verified the fixtures' distribution script (26/1/3 exactly) and re-ran the full disposable-container seed, confirming `auditEvents: 37`
- **Files modified:** `src/lib/demo/fixtures.ts`
- **Verification:** `node node_modules/tsx/dist/cli.mjs` distribution-check script + a fresh end-to-end seed run against a disposable Postgres container, both confirmed correct after the fix
- **Committed in:** `cfdd345` (Task 4 commit — the fix was discovered and applied during Task 4's real-database proof step, so it rides along with that commit rather than reopening Task 1's already-pushed commit)

**2. [Rule 3 - Blocking] Added `dotenv` as an explicit devDependency**
- **Found during:** Task 4 (`tsc --noEmit` on the newly-created `prisma/seed.ts`)
- **Issue:** `prisma/seed.ts` needs `import "dotenv/config"` (same as `prisma.config.ts`) to load `.env` before resolving `DATABASE_URL`. `dotenv` is only a transitive dependency (via `prisma`), not hoisted to the top-level `node_modules` under pnpm's strict linking — `prisma.config.ts` never surfaced this because it's excluded from `tsconfig.json`'s `include` set, but `prisma/seed.ts` (under `prisma/`, not excluded) is real type-checked and failed with `TS2882: Cannot find module or type declarations for side-effect import of 'dotenv/config'`
- **Fix:** Added `"dotenv": "17.4.2"` (the already-resolved transitive version) to `package.json`'s `devDependencies` and ran `pnpm install`, mirroring the 02-02 `hast-util-sanitize` precedent for the same class of pnpm strict-linking issue
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `tsc --noEmit` clean on `prisma/seed.ts`
- **Committed in:** `cfdd345` (Task 4 commit)

**3. [Rule 3 - Blocking] T11 ("Cannot reset password") fixtures ticket gained a real PUBLIC admin reply**
- **Found during:** Task 3 (designing the 3 draft-lifecycle audit scenarios)
- **Issue:** The plan's Task 3 asks for 3 OPEN/PENDING, KB-adjacent draft scenarios (password reset / invoice / webhook), 2 of which also need a `DRAFT_APPROVED` row referencing the ticket's real, already-seeded PUBLIC agent/admin reply message id. T11 (the only OPEN password-reset-themed ticket) was originally designed in Task 1 with zero PUBLIC replies (only an INTERNAL note) to tell an "at-risk from no first response yet" story — leaving no real message id to reference for a `DRAFT_APPROVED` scenario
- **Fix:** Added a PUBLIC admin reply to T11 (`firstResponseAfterHours` changed from `null` to `10`), reframing the at-risk story as "responded, but the resolution SLA is still at risk" — equally realistic and unblocks a real `messageId` for the draft-approved audit row
- **Files modified:** `src/lib/demo/fixtures.ts`
- **Verification:** Fixtures distribution script re-run (replies count moved from 49 to 50, still within the required 45-70 range; all other counts unaffected); `tsc --noEmit`/`biome check` clean
- **Committed in:** `857cce6` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All three were necessary for the seed to actually hit its own documented acceptance numbers (37 audit events, a real messageId for the draft-approved scenario) and for `prisma/seed.ts` to type-check under this project's pnpm/tsconfig setup. No scope creep — all fixes stayed inside the plan's own declared `files_modified`.

## Issues Encountered

- The RTK shell-hook proxy intermittently mangled multi-line/parenthesized `grep`/`node -e` invocations run through the Bash tool during verification (regex parse errors, or silent stale output); worked around by using the dedicated `Grep` tool for all acceptance-criteria substring checks instead of shell `grep`.
- `node -e` with a multi-line inline script piped through Bash on Windows occasionally silently no-ops (e.g. an `import()`-based check produced no output); worked around by writing short throwaway `.mjs` scripts to disk (inside the project root, so relative `./src/lib/db.ts` imports resolve, then deleted before the final commit) instead of inline `-e` snippets for anything needing `import.meta`/ESM resolution.

## User Setup Required

None - no external service configuration required. `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD`/`DEMO_ADMIN_NAME` are optional env overrides; sensible non-production defaults (`admin@demo.aida.test` / `aida-demo-2026`) are baked in for local/demo use only.

## Next Phase Readiness

- The demo-seed → hero-GIF pipeline (07-08) now has real, populated data to record against: shared inbox with 30 tickets across every status/priority/SLA state, triage chips on 27 tickets (26 completed + 1 failed), an "AI Activity" panel with a full generate→approve draft sequence on 2 tickets, and all three `/insights` period tabs (7/30/90-day) rendering populated cards with real citations.
- 07-07 (security pass) and 07-10 (README)/07-11 (docs demo walkthrough) should keep citing the `provider: "demo"` / `model: "demo-seed"` honesty convention and the `DEMO_ADMIN_EMAIL`/`aida-demo-2026` default credentials established here.
- No blockers. `pnpm db:seed` is ready to be invoked from a fresh `docker compose up` install once demo-mode boot wiring (env-flag auto-seed, referenced in 07-CONTEXT.md D-02 but not part of this plan's task list) is built in a later 07-xx plan.

---
*Phase: 07-launch-readiness*
*Completed: 2026-07-29*

## Self-Check: PASSED

All created/modified files verified present on disk; all 4 task commit hashes (`808b536`, `074dafc`, `857cce6`, `cfdd345`) verified present in git history.
