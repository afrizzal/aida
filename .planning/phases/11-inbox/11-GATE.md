# Phase 11 (Inbox) — Phase gate

Plan 11-09. Run on 2026-11-08 between 10:57 and 11:02 UTC, on the Mac workspace, without a human.

- **Tested commit:** `9523eac0a33733fb0e9d1f76aea05bd2b6170f37` (`test(11-09): keyboard E2E …; README inbox note`). Later commits that touch only `.planning/` keep these results valid (ROADMAP gate rules).
- **Phase base commit:** recorded in the §9 section below.
- **How it ran:** one command at a time, in the order of the table. Each command wrote to its own log under `$TMPDIR` (`aida-11-09-gate-*.log`, outside the repo). Each exit code was read from the command itself, never through a pipe. `pgrep -f 'artisan test'` found nothing before every Docker, Testcontainers, E2E and build command. Testcontainers and E2E commands carried `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`.
- **Containers:** the run created, started, stopped and removed no container by hand. The Testcontainers suites start and remove their own throwaway Postgres containers.

## Gate table

| # | Command | State | Exit / reason | Log summary | Commit |
|---|---------|-------|---------------|-------------|--------|
| 1 | `pnpm lint` | passed | 0 | biome: 330 files checked, no fixes | `9523eac` |
| 2 | `pnpm typecheck` | passed | 0 | `tsc --noEmit` printed no error | `9523eac` |
| 3 | `pnpm test` | passed | 0 | 21 files, 222 tests passed, 0 failed (includes `tests/unit/design-tokens.test.ts`) | `9523eac` |
| 4 | `pnpm test:integration` (as-is) | blocked (O-1) | not run: its `include` takes `tests/integration/egress-isolation.test.ts`, which starts the compose project `aida-egress-test`, a real compose stack (D-23, owner item O-1) | none, never claimed as passed | `9523eac` |
| 4a | `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm exec vitest run --config vitest.integration.config.ts --exclude tests/integration/egress-isolation.test.ts` (supplementary row for 4) | passed | 0 | 18 files passed (18), 129 tests passed (129), 0 failed, 0 skipped | `9523eac` |
| 4b | the same command as 4a with `--reporter=verbose` appended (file-list evidence only; the default reporter prints totals only) | passed | 0 | 18 files, 129 tests passed. Files run: audit-append-only, auto-close, create-ticket, draft-generation, email-ingest, inbox-schema, insight-run, kb-embed, palette-search, reply-reopen-race, saved-views-ui-state, saved-views, scoped-tx, search-isolation, sla-flag-handler, ticket-mutations, triage-injection, workspace-isolation. `egress-isolation` appears 0 times in the log | `9523eac` |
| 5 | `pnpm test:egress` | blocked (O-1) | not run: `vitest.egress.config.ts` drives the compose project `aida-egress-test`, a real compose stack (D-23, owner item O-1) | none, never claimed as passed | `9523eac` |
| 6 | `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:e2e` (full suite) | passed | 0 | 111 passed, 1 skipped, 0 failed, 0 flaky, in 2.5 min over 20 specs. Phase 11 specs: keyboard 17/17, inbox 6/6, saved-views 10/10, bulk-actions 6/6, command-palette 9/9, auto-close 4/4, mutations 5/5, reading-pane 2/2. a11y-contrast 8/8. honesty-invariants 2/2 in this run. The skip is the existing `uat-gaps.spec.ts:17` case "a zero-ticket workspace shows the 'Your inbox is empty' state", skipped in the spec itself before Phase 11. The log shows `/bin/sh: taskkill: command not found` 3 times (Windows-only teardown in `global-setup.ts`, `honesty-invariants`, `phase4-ai` and `phase5-rag`); it did not fail the run, and no worker or server process was left running afterwards (`pgrep` empty) | `9523eac` |
| 7 | `pnpm build` | passed | 0 | Next.js 16.2.11 (Turbopack) compiled; 1 warning: the known "unexpected file in NFT list" trace through `src/lib/attachments/local-file-storage.ts` (not a Phase 11 file, present since v1). No `.next` deletion was needed | `9523eac` |
| 8 | `pnpm audit --prod` | failed | 1 | 141 vulnerabilities: 7 critical, 52 high, 69 moderate, 13 low. The advisory service answered | `9523eac` |

Rows 4 and 5 are recorded as blocked, not passed. Row 8 stays red.

### Comparison with the v1 baseline (LAPORAN section 6)

| Item | Baseline | Phase 11 gate | Worse? |
|------|----------|---------------|--------|
| `pnpm audit --prod` | exit 1; 7 critical, 52 high, 69 moderate, 13 low | exit 1; 7 critical, 52 high, 69 moderate, 13 low | No. Identical counts. `git diff --stat 1e5c0f3 9523eac -- package.json pnpm-lock.yaml` is empty: Phase 11 added no package |
| E2E flakes in `honesty-invariants.spec.ts` (a, b) | failed in the full run, passed alone | passed in the full run (2/2) | No. This one green run does not prove the flake is gone; it is not claimed fixed |
| E2E teardown `taskkill` (Windows-only) | present | still present, 3 "command not found" lines, not fatal | No. Unchanged; Phase 11 did not touch these files |
| E2E skip count | 1 skipped | 1 skipped (same `uat-gaps` case) | No |
| Build warning | 1 known Turbopack NFT warning | the same warning | No |
| Integration without egress | 11 of 12 files, 26 passed, 4 skipped (as-is run, egress failed) | 18 of 18 files, 129 passed, 0 skipped (egress excluded) | No |

Phase 11 makes none of the baseline facts worse.

### Container listings for `aida-egress-test`

Command: `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock docker ps -a --filter label=com.docker.compose.project=aida-egress-test --format '{{.Names}} {{.Status}}'`

| When | Exit | Output |
|------|------|--------|
| Before the gate (10:57:40 UTC) | 0 | empty (0 lines) |
| After the integration run (spot check) | 0 | empty (0 lines) |
| After the gate (11:01:54 UTC) | 0 | empty (0 lines) |

The gate created and touched no `aida-egress-test` container.
