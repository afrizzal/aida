---
phase: 09-operations
verified: 2026-11-12T17:01:15Z
status: gaps_found
score: 5/6 success criteria verified at host level (SC5 failed on STATE.md; stack clauses of SC1 and SC3 not proven, U-15)
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/STATE.md"
  - ".planning/phases/09-operations/09-01-PLAN.md"
  - ".planning/phases/09-operations/09-01-SUMMARY.md"
  - ".planning/phases/09-operations/09-02-PLAN.md"
  - ".planning/phases/09-operations/09-02-SUMMARY.md"
  - ".planning/phases/09-operations/09-03-PLAN.md"
  - ".planning/phases/09-operations/09-03-SUMMARY.md"
  - ".planning/phases/09-operations/09-04-PLAN.md"
  - ".planning/phases/09-operations/09-04-SUMMARY.md"
  - ".planning/phases/09-operations/09-05-PLAN.md"
  - ".planning/phases/09-operations/09-05-SUMMARY.md"
  - ".planning/phases/09-operations/09-06-PLAN.md"
  - ".planning/phases/09-operations/09-06-SUMMARY.md"
  - ".planning/phases/09-operations/09-07-PLAN.md"
  - ".planning/phases/09-operations/09-07-SUMMARY.md"
  - ".planning/phases/09-operations/09-08-PLAN.md"
  - ".planning/phases/09-operations/09-08-SUMMARY.md"
  - ".planning/phases/09-operations/09-09-PLAN.md"
  - ".planning/phases/09-operations/09-09-SUMMARY.md"
  - ".planning/phases/09-operations/09-10-PLAN.md"
  - ".planning/phases/09-operations/09-10-SUMMARY.md"
  - ".planning/phases/09-operations/09-11-PLAN.md"
  - ".planning/phases/09-operations/09-11-SUMMARY.md"
  - ".planning/phases/09-operations/09-12-PLAN.md"
  - ".planning/phases/09-operations/09-12-SUMMARY.md"
  - ".planning/phases/09-operations/09-13-PLAN.md"
  - ".planning/phases/09-operations/09-13-SUMMARY.md"
  - "docker-compose.yml"
  - "docs/OPERATIONS.md"
  - "prisma/seed.ts"
  - "scripts/backup/aida-backup.sh"
  - "scripts/backup/aida-restore-set.sh"
  - "scripts/backup/lib.sh"
  - "scripts/backup/scheduler.sh"
  - "scripts/check-version.mjs"
  - "scripts/install.sh"
  - "scripts/restore.sh"
  - "src/app/api/public/logo/[orgId]/[version]/route.ts"
  - "src/components/top-bar.tsx"
  - "src/lib/branding/logo-store.ts"
  - "src/lib/branding/logo-validate.ts"
  - "src/lib/db-url.ts"
  - "src/lib/demo/bootstrap-demo.ts"
  - "src/lib/demo/tenant-guard.ts"
  - "src/lib/projects/file-cleanup.ts"
  - "src/lib/storage/file-fence.ts"
  - "src/lib/tenant-seed-lock.ts"
covered_digest: "v1:sha256:82c44268f061a999477691d95456666ae9b2a494c6ab14c1985942f85d68a475"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "SC5 (AIDA-41): STATE.md has no stale statement"
    status: failed
    reason: "The orchestrator-owned sections of STATE.md describe the run as it stood after fix batch F3 and before the gate rerun. HEAD has F4 to F7 and the gate rerun at 38ef41a. The gate itself records this row as open (orchestrator)."
    artifacts:
      - path: ".planning/STATE.md"
        issue: "line 8 stopped_at: 'F1 to F3 done ... next F4'; F7 and the gate rerun are done"
      - path: ".planning/STATE.md"
        issue: "line 9 last_updated 2026-11-12T13:58Z and line 12 state_head ea50f35; 45 commits have landed since ea50f35"
      - path: ".planning/STATE.md"
        issue: "line 33 Current Position: 'step 6 done ... Next: step 7'; step 8 (gate rerun) is done"
      - path: ".planning/STATE.md"
        issue: "line 34 and front matter last_activity_desc: cite only the first gate at 2c75680 (unit 1646, integration 1500, E2E 260), not the rerun at 38ef41a (unit 1730, integration 1559, E2E 261)"
      - path: ".planning/STATE.md"
        issue: "line 129 Session Continuity: 'Stopped at: ... F1 to F3 done, next F4'"
    missing:
      - "The orchestrator updates the front matter, Current Position and Session Continuity of STATE.md to the post-rerun state. This is a records change, not a code change."
deferred: []
human_verification:
  - test: "Logo look in the sidebar, the Branding preview, /request and /status/[token], light and dark (D-11)"
    expected: "Logo is bounded, never cropped, legible on the dark sidebar; the name stays visible"
    why_human: "Visual judgment"
  - test: "Dark-mode pass of Branding, Backups, the sidebar, the app-level error state and the neutral 'no logo to remove' toast (DESIGN-SYSTEM section 9 item 7)"
    expected: "Token colours read correctly in both themes"
    why_human: "Visual judgment; the axe scan is automated evidence only"
  - test: "Screen-reader check of the h1 changes (09-09), the app-level error state's sr-only h1, and the Logo card (error rows, Remove dialog, alt='' brand logo)"
    expected: "Exactly one announced page heading; errors announced; decorative logo skipped"
    why_human: "Assistive-technology behaviour"
  - test: "Run scripts/install.sh on a clean VM against the published v1.0.0 tag (D-22)"
    expected: "Stack comes up; only the documented github.com download is made; a rerun keeps existing secrets"
    why_human: "Needs a real host, network and a published tag"
  - test: "SP-1, SP-2, SP-3 in 09-STACK-PROOFS.md"
    expected: "Scheduled backup runs in a compose stack with no Redis; restore into an isolated stack matches attachment contents and leaves uploads owned by 1000:1000; a reserved-character password boots migrate, app and worker with no password in logs"
    why_human: "Not run by design (U-15): waiting for the Phase 8.1 harness and the owner"
  - test: "Owner items: version bump policy (U-05), the v1.0.0 tag and release, fence limit L1, Docker VM space for test:egress, pnpm audit --prod 10 high (08-o3), E2E global-setup hang on /setup (next-o1)"
    expected: "Owner decision or action recorded"
    why_human: "Owner-only"
  - test: "AIDA-36 route states not rendered by any test (loading states other than /tickets, unseeded data variants, the 255-character long-text backstop, streaming, error states of routes under the app-level boundary other than /kb and /settings/backups)"
    expected: "Exactly one h1 in each"
    why_human: "Not rendered by any automated test; open part of AIDA-36"
---

# Phase 9: Operations Verification Report

**Phase goal:** A self-hoster can run AIDA unattended: backups happen on their own, the known boot and seed traps are fixed and pinned by tests, and the planning records tell the truth.
**Verified:** 2026-11-12T17:01:15Z, at HEAD `0af2bf8`. `git diff 38ef41a HEAD -- . ':!.planning'` is empty (checked again here), so the code is the code the gate rerun tested.
**Status:** gaps_found. The one gap is in the records (STATE.md), not in code.
**Re-verification:** No. This is the first verification.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A scheduled backup produces one consistent set (dump plus uploads archive), even while attachments change; it restores with matching attachments; a failed part fails the set; old sets are pruned | VERIFIED (host); stack clause not proven | `scripts/backup/aida-backup.sh:544-555` reads every key referenced by `Attachment`, `TaskAttachment` and the `branding:logo` Setting, and fails the set with category verification when a key is missing from the archive. Retention runs at `:627`. The fence is held by the sweep (`src/lib/projects/file-cleanup.ts:307-310`) and the worker (`src/lib/worker/jobs/project-file-cleanup.ts:17-25`). Restore extracts with `--no-same-owner` (`scripts/backup/aida-restore-set.sh:501`). Compose has `backup` as `1000:1000`, image pg16, `uploads_data:ro`, `PGPASSWORD`, and `backup-init` with `network_mode: none`, `read_only`, `cap_drop` and the mount point only. Tests: `backup-consistency.test.ts:613` (mid-backup add, replace, delete), `backup-failures.test.ts:239` (retention), `:425` (failure categories), `backup-restore-roundtrip.test.ts:577` and `:814`. These passed in the gate rerun's integration run (1559). The scheduled run in a compose stack and the isolated-stack restore were not run (SP-1, SP-2, U-15) and are not proven. |
| 2 | A logo uploads, shows in the sidebar and on public pages, and falls back to the name | VERIFIED (look open for a human) | Bytes are sniffed with `fileTypeFromBuffer` and SVG is refused (`logo-validate.ts:23,53-59`). The public route throttles before any parameter work, serves only the current version, and sends nosniff and immutable cache headers (`api/public/logo/[orgId]/[version]/route.ts:27-50`). The `(app)/layout.tsx:44-58` passes `logoUrl` to `Sidebar` and then `BrandMark`. `request/page.tsx:15` and `status/[token]/page.tsx:58` use `loadPublicBrand`; an invalid token gets `brand={null}` (`:37`). Replace and remove take the per-org advisory lock and enqueue the old key (`logo-store.ts:68,113,137`). `tests/e2e/logo.spec.ts` passed in E2E run 2 (261). |
| 3 | A password containing `/ @ : # ?` connects from every service, and every app page has exactly one `<h1>` | VERIFIED (host); stack clause not proven | `docker-compose.yml:42-45,65-68,123-126` give the same `AIDA_DATABASE_URL` fallback plus `AIDA_EXPECT_DB_*` to migrate, app and worker. The guard runs in `src/instrumentation.ts:6-8`, `src/lib/worker/index.ts:26`, and the migrate command (`docker-compose.yml:29`). `compose-database-url.test.ts` passed (integration). The top-bar title is a `<p>` (`top-bar.tsx:44`). `single-h1.spec.ts` passed in E2E run 2, and `single-h1-route-list.test.ts` pins the route list (unit run here). The booted stack (SP-3) is not proven. Some route states are not rendered by any test (AIDA-36 open part). |
| 4 | Neither `pnpm db:seed` nor the `DEMO_MODE` boot writes into a database with non-demo tenant data; a repeated demo boot works after the heartbeat; no password printed; the tests live in the repository suites | VERIFIED | `classifyTenantData` (`tenant-guard.ts`) reads only organization, user and the marker Setting, and returns empty, demo-complete, demo-partial or foreign. `runGuardedDemoSeed` seeds only when the database is empty, under `withTenantSeedLock`, and writes the marker last. `bootstrap-demo.ts` and `prisma/seed.ts:25` both call it. `bootstrap.ts:96` and `setup/actions.ts:49` take the same lock. There is no `delete`/`deleteMany` in `src/lib/demo/` or `prisma/seed.ts` (grep exit 1), which keeps the owner rule "refuses, never deletes". Output names only the environment variable, not the password (`seed.ts:32`, `bootstrap-demo.ts:33`); errors log only the error shape. `capture-demo-assets.ts:811` redacts. `demo-boot.test.ts` and `seed-guard.test.ts` have no `.skip`, `.only` or `skipIf`, and they sit in `vitest.integration.config.ts` (include `tests/integration/**`; only `egress-isolation` is excluded). |
| 5 | `01-VERIFICATION.md` exists and is backed by evidence, and `STATE.md` has no stale statement | FAILED | The first half holds: `.planning/milestones/v1.0.0-phases/01-foundation/01-VERIFICATION.md` exists, cites the 40-character commits it ran at, records criterion 1 as open-human and criterion 2 as failed, and marks no human check passed. The second half does not: STATE.md lines 8, 9, 12, 33, 34 and 129 describe the run before F4 (see Gaps). |
| 6 | `scripts/install.sh`, `check-version`, `AGENTS.md`, `CODEOWNERS` and the README widgets exist, or an owner-account item is recorded as manual | VERIFIED | `install.sh:157` is the only `curl` or `wget` call (https only). `check-version.yml` uses `ubuntu-latest`, runs on push, pull_request and workflow_dispatch, has no `schedule:`, and sets `permissions`. `package.json` has `"version": "1.0.0"`. `.github/CODEOWNERS` is `* @afrizzal`, the owner's handle from item 13. `AGENTS.md` has no handle and no home path (grep exit 1). No README widget was added: the three badges at `README.md:11-13` date from `b96120b` (2026-08-03), before this phase. `LAUNCH.md:57,62` records the bump policy as an open owner item and the "widgets not added" owner decision. The clean-VM installer run is left for a human. |

**Score:** 5/6 truths verified at host level, 0 present-but-behavior-unverified. SC5 failed. The stack clauses of SC1 and SC3 are not proven (U-15) and count as not-run items, not as gaps.

### Required Artifacts

All 50 artifacts named in the `must_haves.artifacts` of 09-01 to 09-13 exist and are substantive (from 20 lines for `scripts/check-database-url.ts` up to 1766 for `backup-restore-roundtrip.test.ts`). `.github/CODEOWNERS` has 2 lines by design. The ones read in full or in part above are wired as each plan's `key_links` describe.

### Key Link Verification

| From | To | Status |
| --- | --- | --- |
| docker-compose.yml migrate, app, worker | DATABASE_URL fallback plus AIDA_EXPECT_DB_* | WIRED (lines 42-45, 65-68, 123-126) |
| src/instrumentation.ts, src/lib/worker/index.ts | src/lib/db-url.ts | WIRED |
| prisma/seed.ts, bootstrap-demo.ts | tenant-guard.ts runGuardedDemoSeed | WIRED |
| bootstrap.ts, setup/actions.ts | tenant-seed-lock.ts | WIRED |
| worker project-file-cleanup job | file-fence.ts createDeleteFenceProvider | WIRED |
| file-cleanup.ts sweep | fence.open() before select | WIRED (lines 307-310) |
| logo-store.ts | enqueueFileCleanupInTx | WIRED |
| public logo route | PUBLIC_RATE_LIMITS.logo, consumeRateLimit | WIRED |
| (app)/layout.tsx | Sidebar to BrandMark logoUrl | WIRED |
| public pages | PublicPageShell to BrandMark via loadPublicBrand | WIRED |
| backup service | scheduler.sh entrypoint | WIRED |
| aida-backup.sh | Attachment, TaskAttachment, Setting reference check | WIRED (lines 544-555) |

### Behavioral Spot-Checks (run by this verifier at `0af2bf8`)

| Command | Exit | Result |
| --- | --- | --- |
| pnpm typecheck | 0 | clean |
| pnpm lint | 0 | "Checked 685 files", 1 warning (the pre-existing one) |
| pnpm test | 0 | 101 files, 1730 passed, 0 failed |

Integration, E2E, egress and build were not run here, as instructed. The gate rerun ran them on the same code (`38ef41a`): integration 1559 passed, E2E run 2 261 passed (run 1 hung in global setup, owner item next-o1), build exit 0, audit exit 1 (10 high), and `test:egress` blocked (space).

### Probe Execution

There is no `scripts/*/tests/probe-*.sh` in this phase. The stack proofs SP-1 to SP-3 are not run by design (U-15). They are not proven, and they are not a gap in the host-side code.

### Requirements Coverage

| Requirement | Status | Reason |
| --- | --- | --- |
| AIDA-33 | open | Host clauses are verified. SP-1 (schedule in a running stack, no Redis observed) and SP-2 (isolated-stack restore) are not run. |
| AIDA-34 | open | Automated clauses are verified. The logo look (D-11) waits for a human. |
| AIDA-35 | open | The compose-config clause is verified. SP-3 (booted stack, logs without the password) is not run. |
| AIDA-36 | open | The E2E h1 count is verified. Some route states are not rendered by any test, and the screen-reader check waits for a human. |
| AIDA-37 | closable | Verified in code and in the integration tests. |
| AIDA-38 | closable | The demo-boot, seed-guard and round-trip tests are in the default integration suite, with no skips. |
| AIDA-39 | closable | `01-VERIFICATION.md` is evidence-backed and leaves human checks open. |
| AIDA-40 | open | The artifacts are verified and the widgets were not added by owner decision. The clean-VM installer run waits for a human. |
| AIDA-41 | open (gap) | STATE.md orchestrator-owned sections are stale (see Gaps). |

No orphaned requirements: all nine IDs are claimed by plans.

### Anti-Patterns Found

None. The debt-marker grep over the phase's main source, scripts and docs found only `mktemp` `XXXXXX` templates in `scripts/install.sh:154,163,226`, which are not markers.

### Human Verification Required

These items are listed in the `human_verification` front matter: the logo look, the dark-mode pass, the screen-reader checks, the clean-VM installer run, SP-1 to SP-3 (not run, U-15), the owner items, and the AIDA-36 route states that no test renders. Logic changes K143 to K158 and r3-5 are covered by tests that passed in the gate rerun. This verifier records no human result.

### Gaps Summary

There is one gap, and it is in the records. The phase code achieves the host-side goal: backups, the fence, retention, restore, the seed and demo guards that refuse without deleting, the password URL guard, the logo, the h1 work and the repo-health files. All of it is present, wired and covered by suites that passed on this exact code. STATE.md, though, still describes the run after fix batch F3 (lines 8, 9, 12, 33, 34, 129). So SC5's "STATE.md has no stale statement" is false at HEAD. The orchestrator can close it with a STATE.md update; no code change is needed. Once that is done, the remaining items are all human or not-run items, and the status would become `human_needed`.

---

_Verified: 2026-11-12T17:01:15Z_
_Verifier: Claude (gsd-verifier)_
