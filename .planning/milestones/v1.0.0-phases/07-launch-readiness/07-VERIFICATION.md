---
phase: 07-launch-readiness
verified: 2026-09-04T06:00:00Z
status: passed
score: 23/23 must-haves verified
behavior_unverified: 0 # all 3 previously-flagged items resolved 2026-09-04 by direct orchestrator execution — see "Orchestrator behaviour checks" section
overrides_applied: 0
gaps: []
deferred: []
---

# Phase 7: Launch Readiness Verification Report

**Phase Goal:** Make the public repo star-worthy and operable.
**Verified:** 2026-09-04
**Status:** passed
**Re-verification:** Yes — behavior_unverified items closed by direct execution evidence (see below)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | A seed/demo dataset + demo mode let a newcomer explore a populated helpdesk instantly; screenshots/GIF captured from it | ✓ VERIFIED | `src/lib/demo/fixtures.ts` (30 tickets/12 contacts/6 KB/8 CSAT), `seedDemoData()`, `pnpm db:seed`, `DEMO_MODE` boot flag wired through `instrumentation.ts` → `bootstrap-demo.ts` → `seedDemoData`; `docs/assets/` contains hero GIF + 8 screenshot pairs (light+dark), human-approved (07-08-SUMMARY.md "Task 3 approval"). Idempotency on restart now proven by direct execution — see Orchestrator behaviour checks, Item 1. |
| 2 | README leads with hero GIF, one-line pitch, quick-start, comparison table; docs site covers install/config/AI setup | ✓ VERIFIED | README.md: GIF above the fold (line 16), pitch (line 5-9), quick start pointing at `http://localhost` (not `:3000`, with explicit note), honest comparison table with a caveat disclaimer, all 13 relative links resolve on disk; docs site has `getting-started/`, `configuration/` (incl. `ai-providers.md` covering OpenAI/Anthropic/Ollama), `guides/`, `operations/`, `security/`, all wired into `astro.config.mjs` sidebar `autogenerate` |
| 3 | Backup/restore (pg_dump) + ops docs exist; security pass confirms encrypted keys, enforced authz, AIDA-20 safeguards | ✓ VERIFIED | `scripts/backup.sh`/`scripts/restore.sh` are substantive, correct shell; round trip now proven end-to-end against a live stack with a planted smoke marker in both DB and uploads volume — see Orchestrator behaviour checks, Item 3. `07-SECURITY-PASS.md` is a genuinely thorough, evidenced 2000+ line report (14 sections, 16 findings, 4 fixed with commit hashes independently confirmed in code, 12 known-issues with maintainer-accepted rationale); AIDA-20 safeguards (egress-isolation, honesty-invariants) proven by real tests confirmed to have run and passed in 07-12's gate matrix |
| 4 | The repo is ready for a Phase-1 (first-100-stars) outreach launch | ✓ VERIFIED | `LAUNCH.md` is a concrete, ordered human-only checklist (repo settings, tag/release, outreach); `CHANGELOG.md` v1.0.0 accurately describes only what shipped, including an honest "Known limitations" section; REQUIREMENTS.md shows 23/23 MVP requirements checked, no orphans |

**Score:** 23/23 plan-level must-haves verified. All 4 ROADMAP success criteria are fully satisfied, including the two runtime-behavior sub-claims (demo-mode idempotency, backup/restore round trip) that were previously flagged as present-but-behavior-unverified and are now closed by direct execution against a live stack (2026-09-04).

### Per-Plan Must-Haves (union of all 13 plans' frontmatter)

| Plan | Truths | Status |
|---|---|---|
| 07-01 (repo hygiene) | `.gitattributes` first non-comment line `* text=auto eol=lf`; `src/proxy.ts` exists with `export function proxy`, `src/middleware.ts` removed; `git status --porcelain` empty (confirmed clean at HEAD); REQUIREMENTS.md restructured to checkbox+table format `gsd-tools` can mutate | ✓ VERIFIED |
| 07-02 (demo dataset) | `fixtures.ts`/`seedDemoData`/`prisma/seed.ts`/`db:seed` script all present and wired (`createTicket(`, `StoredCluster`, `seed:` in `prisma.config.ts` all confirmed); ticket-age spread and AI-surface population confirmed via fixtures + 07-08 screenshots; refuse-guard on non-empty workspace proven by direct execution (Orchestrator Item 2: refusal message + exit 1 + identical row-count snapshot) | ✓ VERIFIED |
| 07-03 (branding) | `BRANDING_SETTING_KEYS`, `getBrandingSettings`, admin-gated `saveBranding` (confirmed `requireOrgAdmin()` is the first statement — non-admin rejection is server-side, not UI-only); `brandName` wired into sidebar, public pages, outbound email from-name (3 grep hits each) | ✓ VERIFIED |
| 07-04 (backup/restore + ops docs) | `scripts/backup.sh`/`scripts/restore.sh` read in full — substantive, not stubs (preflight checks, non-empty-file checks, destructive-restore confirmation, health-check poll); `docs/OPERATIONS.md` contains "## Restore to a new server"; round trip proven by direct execution against a live stack with a planted DB+uploads smoke marker (Orchestrator Item 3) | ✓ VERIFIED |
| 07-05 (CI + community files) | `ci.yml` runs `pnpm db:generate → lint → typecheck → test → build` in order on push+PR (read in full, confirmed); `CONTRIBUTING.md`, `.github/SECURITY.md` ("## Reporting a Vulnerability"), issue/PR templates all present | ✓ VERIFIED |
| 07-06 (docs site scaffold) | `website/astro.config.mjs` has `base:`; `.github/workflows/docs.yml` has `actions/deploy-pages`; `tsconfig.json` excludes `website` | ✓ VERIFIED |
| 07-07 (demo mode) | `DEMO_MODE` flag-gated bootstrap wired from `instrumentation.ts` (`await import("@/lib/demo/bootstrap-demo")` → `bootstrapDemoMode()` → `seedDemoData`); `docker-compose.yml` plumbs `DEMO_MODE`; duplicate-boot prevention proven by direct execution (Orchestrator Item 1: restart logs the "already present, skipping" branch and the post-restart row-count snapshot is byte-identical to the post-boot snapshot) | ✓ VERIFIED |
| 07-08 (visual assets) | `scripts/capture-demo-assets.ts` uses `PostgreSqlContainer`; `docs/assets/` contains `aida-demo.gif` + 8 screenshot pairs (light/dark); human sign-off recorded in SUMMARY | ✓ VERIFIED |
| 07-09 (security pass) | `07-SECURITY-PASS.md` has a `## Findings` table (16 findings) and a `## Fixed in phase` table (4 fixes); all 4 fixes independently spot-checked in code (BLOCKED_PUBLIC_ROUTES in proxy.ts, requireOrgAdmin in setAiEnabled, getPepper() throw-on-empty in check-rate-limit.ts, next@16.2.11 in package.json) | ✓ VERIFIED |
| 07-09.1 (gap closure) | `egress-isolation.test.ts` (208 lines), `honesty-invariants.spec.ts` (390 lines), `a11y-contrast.spec.ts` (239 lines), `design-tokens.test.ts` (143 lines, re-ran locally: 5/5 pass) all substantive, wired into `vitest.egress.config.ts`/`playwright.config.ts`/`vitest.config.ts`; `CHECKPOINT_DISABLE=1` fix confirmed present in both `docker-compose.yml` and `docker-compose.egress-test.yml` | ✓ VERIFIED |
| 07-10 (README) | Hero GIF above fold, quick start fixed to `http://localhost`, demo-mode section, honest comparison table with disclaimer, all 13 relative links resolve on disk | ✓ VERIFIED |
| 07-11 (docs content) | `ai-providers.md` covers Ollama; `environment.md` contains `APP_ENCRYPTION_KEY`; sidebar `autogenerate` wired to all 5 content directories, all of which exist | ✓ VERIFIED |
| 07-12 (launch close-out) | `LAUNCH.md` has "## Repository settings"; `CHANGELOG.md` has "## v1.0.0"; REQUIREMENTS.md shows `AIDA-24` (and 12/20/22/23) checked `[x]`; independently re-ran `tsc --noEmit` (clean) and `biome check .` (283 files, 0 issues) against the current tree | ✓ VERIFIED |

### Required Artifacts (spot-checked, non-exhaustive list of the highest-risk ones)

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.gitattributes` | LF normalization contract | ✓ VERIFIED | First non-comment line `* text=auto eol=lf`, `.sh` rule present |
| `src/proxy.ts` | Next 16 proxy convention | ✓ VERIFIED | `export function proxy`, `getSessionCookie`, `BLOCKED_PUBLIC_ROUTES` (07-09 fix), old `src/middleware.ts` removed |
| `src/lib/demo/fixtures.ts` + `seed-demo-data.ts` + `prisma/seed.ts` | Demo dataset pipeline | ✓ VERIFIED | All exports present, wired to `createTicket`, `StoredCluster` types, `prisma.config.ts` `seed:` |
| `src/lib/branding/settings.ts` + branding UI/actions | Admin-gated branding | ✓ VERIFIED | `BRANDING_SETTING_KEYS`, `requireOrgAdmin()` first statement in `saveBranding` |
| `scripts/backup.sh` / `scripts/restore.sh` | Complete backup/restore | ✓ VERIFIED | Read in full — real `pg_dump`/`pg_restore`, uploads tar, destructive-op confirmation, health poll; round trip proven live (Orchestrator Item 3) |
| `.github/workflows/ci.yml` | Full quality gate on push/PR | ✓ VERIFIED | `db:generate → lint → typecheck → test → build`, triggers on `push: [master]` + `pull_request` |
| `website/astro.config.mjs` + `.github/workflows/docs.yml` | Docs site + Pages deploy | ✓ VERIFIED | `base:`, `actions/deploy-pages`, sidebar `autogenerate` matches 5 real content dirs |
| `src/lib/demo/bootstrap-demo.ts` | Flag-gated demo boot | ✓ VERIFIED | Strict `DEMO_MODE === "true"` gate (per 07-SECURITY-PASS.md), wired from `instrumentation.ts`; idempotent restart proven live (Orchestrator Item 1) |
| `.planning/phases/07-launch-readiness/07-SECURITY-PASS.md` | Security pass report | ✓ VERIFIED | 2000+ lines, 8 sweeps + completeness critic, 16 findings with dispositions, 4 fixes with commit hashes (spot-checked all 4 in code) |
| `tests/integration/egress-isolation.test.ts`, `tests/e2e/honesty-invariants.spec.ts`, `tests/e2e/a11y-contrast.spec.ts` | Automated proofs of AIDA-20 safeguards + a11y | ✓ VERIFIED | Substantive (208/390/239 lines), wired into real test configs; 07-12's gate matrix reports these ran and passed (integration 30/30 explicitly including egress-isolation; e2e suite passed in at least one full run for each, with the flaky specs list explicitly NOT including honesty-invariants.spec.ts) |
| `README.md` | Star-ready landing page | ✓ VERIFIED | Hero GIF, pitch, badges, features, quick start, demo section, comparison table, screenshots, all internal links resolve |
| `LAUNCH.md`, `CHANGELOG.md` | Human launch checklist + v1.0.0 notes | ✓ VERIFIED | Both substantive; CHANGELOG's "Known limitations" section is honest and specific |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `src/proxy.ts` | `better-auth/cookies getSessionCookie` | unchanged auth gate | ✓ WIRED |
| `src/lib/demo/seed-demo-data.ts` | `src/lib/tickets/create-ticket.ts` | `createTicket(` | ✓ WIRED |
| `prisma.config.ts` | `prisma/seed.ts` | `migrations: { seed: "tsx prisma/seed.ts" }` | ✓ WIRED |
| `src/components/sidebar.tsx` | `src/lib/branding/settings.ts` | `brandName` prop | ✓ WIRED |
| `src/lib/worker/jobs/email-outbound-send.ts` | `src/lib/branding/settings.ts` | `getBrandingSettings` | ✓ WIRED |
| `scripts/backup.sh` | `docker-compose.yml` `db` service | `$COMPOSE exec -T db pg_dump` | ✓ WIRED |
| `.github/workflows/ci.yml` | `package.json` scripts | `pnpm typecheck` etc. in order | ✓ WIRED |
| `.github/workflows/docs.yml` | `website/` | `path: ./website` | ✓ WIRED |
| `src/instrumentation.ts` | `src/lib/demo/bootstrap-demo.ts` | `await import(...)` → `bootstrapDemoMode()` | ✓ WIRED |
| `src/lib/demo/bootstrap-demo.ts` | `src/lib/demo/seed-demo-data.ts` | `seedDemoData` called after guard | ✓ WIRED |
| `README.md` | `docs/assets/` | GIF + screenshot embeds | ✓ WIRED (files exist) |
| `website/astro.config.mjs` | `website/src/content/docs/` | sidebar `autogenerate` per directory | ✓ WIRED (all 5 dirs exist) |
| `docker-compose.yml` / `docker-compose.egress-test.yml` | Prisma checkpoint ping | `CHECKPOINT_DISABLE: "1"` | ✓ WIRED (real regression the egress test found and got fixed) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Typecheck clean on current tree | `node node_modules/typescript/bin/tsc --noEmit` | exit 0, no output | ✓ PASS |
| Lint clean on current tree | `node node_modules/@biomejs/biome/bin/biome check .` | `Checked 283 files ... No fixes applied.` | ✓ PASS |
| `design-tokens.test.ts` (07-09.1 artifact) | `node node_modules/vitest/vitest.mjs run tests/unit/design-tokens.test.ts` | `5 passed (5)` | ✓ PASS |
| Fix F-01 present (anonymous sign-up blocked) | `grep BLOCKED_PUBLIC_ROUTES src/proxy.ts` | `/api/auth/sign-up` blocked before `PUBLIC_PREFIXES` check | ✓ PASS |
| Fix F-02 present (`setAiEnabled` admin-gated) | read `settings/actions.ts` | `requireOrgAdmin()` is first statement | ✓ PASS |
| Fix F-03 present (mandatory rate-limit pepper) | read `check-rate-limit.ts` | `getPepper()` throws on empty instead of falling back | ✓ PASS |
| Fix F-04 present (`next` patched) | `grep "next" package.json` | `"next": "16.2.11"` | ✓ PASS |
| README relative links resolve | file-existence check on all 13 relative link targets | all present | ✓ PASS |
| Docs site sidebar dirs match content dirs | `astro.config.mjs` autogenerate vs `ls website/src/content/docs/` | 1:1 match (5 dirs) | ✓ PASS |
| Demo-mode boot + idempotent restart | live docker compose (orchestrator, 2026-09-04) | boot seeds once (4261ms), restart skips, row-count snapshots identical | ✓ PASS — see Orchestrator behaviour checks, Item 1 |
| Seed refuse-guard on non-empty workspace | live docker compose (orchestrator, 2026-09-04) | refusal message + exit 1, row-count snapshot identical | ✓ PASS — see Orchestrator behaviour checks, Item 2 |
| Backup/restore round trip | live docker compose (orchestrator, 2026-09-04) | planted DB+uploads smoke marker destroyed then restored intact, health ok | ✓ PASS — see Orchestrator behaviour checks, Item 3 |

## Orchestrator behaviour checks (2026-09-04)

The three items this verification pass flagged as present-and-wired-but-behavior-unverified (demo-mode idempotency, seed refuse-guard, backup/restore round trip) were subsequently executed for real by the orchestrator against a live `docker compose` stack, running exactly the tests specified in the prior `behavior_unverified_items[].test` fields. Evidence below is reproduced verbatim from the orchestrator's report and cross-checked against the source it claims to exercise:

- The Item 1 restart log line (`[demo] Demo data already present (%d tickets) — skipping seed.`) matches `src/lib/demo/bootstrap-demo.ts` line 24 verbatim (format string confirmed by direct read).
- The Item 1 boot log line (`[demo] Seeded demo workspace in %dms: %o`) matches `bootstrap-demo.ts` line 39's log call verbatim.
- The Item 2 refusal message (three lines: `Refusing to seed...` / `not idempotent...` / `Start from a clean database...`) matches `prisma/seed.ts` lines 38-44 verbatim, and the `process.exit(1)` at line 47 matches the reported exit code.
- The health-check JSON shape (`{"status":"ok","db":"connected","worker":{"lastRunAt":...}}`) matches the shape independently confirmed during this same verification pass's review of 07-12's docker cold-start gate evidence.

**Method:** fresh `docker compose down -v`, then `DEMO_MODE=true docker compose up -d` (db/migrate/app/worker/caddy from the repo's `docker-compose.yml`, plus an override publishing db port 5432 → host 55432 so the host-side seed CLI could reach it). Row-count snapshots = `count(*)` for every BASE TABLE in schema `public` except `_prisma_migrations` (27 tables; 28 once the smoke table exists). Health was read via Caddy at `https://localhost/api/health`.

### Item 1 — Demo-mode boot + idempotency (07-07)

```
boot log: app-1 | [demo] Seeded demo workspace in 4261ms: { ... csatResponses: 8, auditEvents: 37, insightRuns: 3 }
health:   {"status":"ok","db":"connected","worker":{"lastRunAt":"2026-09-03T22:54:08.519Z"}}
snapshot S1 (27 tables) includes: public."Ticket"=30, public."Contact"=12, public."KbArticle"=6,
  public."AuditEvent"=37, public."InsightRun"=3, public."CsatResponse"=8, public."Message"=80,
  public."TicketTag"=38

then: DEMO_MODE=true docker compose restart app  → health ok after ~6s
restart log: app-1 | [demo] Demo data already present (30 tickets) — skipping seed.
snapshot S2 == S1 (all 27 table counts identical)
```
**Result: CHECK-DEMO-IDEMPOTENT: PASS**

### Item 2 — Seed refuse-guard (07-02)

```
host-side: node node_modules/tsx/dist/cli.mjs prisma/seed.ts (DATABASE_URL -> populated compose db)
[seed] Refusing to seed: workspace already has 30 tickets.
[seed] The demo seed is not idempotent and AuditEvent rows are append-only (they can never be deleted),
[seed] so re-seeding would duplicate data. Start from a clean database instead:
process exit code = 1
snapshot S3 == S1 (all 27 table counts identical, no duplicate rows)
```
**Result: CHECK-SEED-REFUSE: PASS**

Note: consistent with the already-accepted finding F-10 in `07-SECURITY-PASS.md` — `ensureDemoIdentities()` runs before the ticket-count guard, so a live re-seed still touches identity tables first. In this run the identity rows were already present from the demo boot, so the row-count snapshot stayed identical; this does not contradict F-10, it's the expected behavior on a workspace whose identities already exist. F-10 itself remains an accepted, non-blocking known issue and is not reopened by this evidence.

### Item 3 — Backup/restore round trip (07-04)

```
planted: CREATE TABLE backup_smoke(id int primary key, note text);
         INSERT INTO backup_smoke VALUES (1,'before-backup');
         /data/uploads/smoke/marker.txt = "before-backup" (written via a --no-deps app container)
snapshot S3' taken (28 tables)

bash scripts/backup.sh <dir>  → [backup] Done. exit 0 in 3s
  files: aida-db-20260903T225826Z.dump, aida-uploads-20260903T225826Z.tar.gz

destroyed: DROP TABLE backup_smoke;  (to_regclass check -> f)
           rm -f /data/uploads/smoke/marker.txt

bash scripts/restore.sh <dump> <tar> --yes
  → [restore] Waiting for /api/health ... [restore] Healthy: ... [restore] Done. exit 0 in 15s

after restore:
  SELECT note FROM backup_smoke WHERE id=1  → before-backup
  marker file content                       → before-backup
  snapshot S4 == S3' (all 28 table counts identical)
  health: {"status":"ok","db":"connected","worker":{"lastRunAt":"2026-09-03T22:58:18.661Z"}}
```
**Result: CHECK-BACKUP-RESTORE: PASS**

Teardown: `docker compose down -v` (volume `aida_postgres_data` removed, network removed, no `aida` containers left).

## Recommended follow-ups (non-blocking, not a release gate)

None of the following block `passed` — they are backlog observations, consistent with how 07-04's and 07-07's original round-trip/idempotency claims were accepted at execution time on the strength of a real proof run:

- **No persisted regression test** exists under `tests/` for the demo-mode idempotent-restart guard, the seed refuse-guard, or the backup/restore round trip. All three are now proven correct by direct execution (this section), but a future code change could regress any of them without CI catching it (CI does not restart the app, re-run `db:seed` against a populated DB, or invoke `backup.sh`/`restore.sh`). Consider a lightweight integration test for each, similar in spirit to `tests/integration/egress-isolation.test.ts`.
- **F-10** (`ensureDemoIdentities()` runs before the seed's non-empty-workspace guard) remains an accepted, non-blocking known issue per `07-SECURITY-PASS.md` — unaffected by this evidence, not reopened.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| AIDA-12 | 07-01 (infra), 07-03 (branding remainder) | Settings area incl. branding | ✓ SATISFIED | `[x]` + `Complete` in REQUIREMENTS.md; branding admin surface confirmed wired and admin-gated |
| AIDA-20 | 07-09.1 (supporting infra tag) | Untrusted-input safeguards | ✓ SATISFIED | `[x]` + `Complete` in REQUIREMENTS.md (owned by Phase 4); re-verified in this phase via `egress-isolation.test.ts` + `honesty-invariants.spec.ts`, both confirmed substantive and run in 07-12's gate matrix |
| AIDA-22 | 07-02, 07-07, 07-08 | Seed/demo dataset + demo mode | ✓ SATISFIED | `[x]` + `Complete`; fixtures/seed/demo-mode code confirmed wired, idempotency proven live |
| AIDA-23 | 07-01 (infra tag), 07-05, 07-06, 07-08, 07-10, 07-11 | Star-ready README + docs site | ✓ SATISFIED | `[x]` + `Complete`; README and docs site content confirmed substantive |
| AIDA-24 | 07-04, 07-09, 07-09.1, 07-12 | Backup/restore + ops docs | ✓ SATISFIED | `[x]` + `Complete`; scripts + `OPERATIONS.md` confirmed substantive; round trip proven live end-to-end |

**No orphaned requirements.** REQUIREMENTS.md shows 23/23 MVP requirements `[x]`/`Complete`; the only unchecked item is `AIDA-18` (`Stretch`, correctly backlog per ROADMAP).

### Anti-Patterns Found

None. Grepped `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` across `src/lib/demo/`, `src/lib/branding/`, `scripts/backup.sh`, `scripts/restore.sh`, `scripts/capture-demo-assets.ts`, `src/proxy.ts`, `src/instrumentation.ts`, `README.md`, and `website/src/content/docs/` — zero hits. The two intentionally-marked placeholders (`CODE_OF_CONDUCT.md` and `.github/SECURITY.md` maintainer contact) carry explicit `<!-- maintainer: set before launch -->` markers and are already tracked as human-only steps in `LAUNCH.md` §"Before you tag" — not undisclosed debt.

### Human Verification Required

None. The three items previously listed here (seed refuse-guard, demo-mode idempotent restart, backup/restore round trip) were closed by direct orchestrator execution against a live stack on 2026-09-04 — see "Orchestrator behaviour checks" above. All other human-verification history for this phase (security-pass residuals, subjective quality-backlog items) was already resolved or explicitly re-logged as non-blocking in `07-SECURITY-PASS.md` / `07-09.1-SUMMARY.md`, and reviewed by the maintainer with no blockers at 07-12's Task 4 checkpoint (2026-09-04).

### Gaps Summary

No gaps. Every must-have truth, artifact, key link, and requirement traceability check passed, including the three runtime-behavior invariants (demo-mode idempotency, seed refuse-guard, backup/restore round trip) that were initially flagged as present-but-behavior-unverified and are now closed by direct execution evidence. See "Recommended follow-ups" above for non-blocking backlog observations (persisting these checks as automated regression tests).

---

*Verified: 2026-09-04*
*Verifier: Claude (gsd-verifier)*
