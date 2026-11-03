---
phase: 08-security-hardening
plan: 24
subsystem: release-gate
tags: [gate, evidence, rule-j, part-a]
status: complete
requires: ["08-06", "08-08", "08-20"]
provides: ["scripts/part-a-gate-check.ts", ".planning/phases/08-security-hardening/08-GATE-A.md"]
affects: ["Phase 8.1 (Part B)", "v1.0.0 release decision"]
tech-stack:
  added: []
  patterns: ["derive/check of a gate file from a raw evidence directory (08-16 pattern, Part A only)"]
key-files:
  created:
    - scripts/part-a-gate-check.ts
    - tests/unit/part-a-gate-check.test.ts
    - .planning/phases/08-security-hardening/08-GATE-A.md
  modified: []
decisions:
  - "A named file source whose command row is `not run (...)` or `blocked (docker unhealthy)` takes that word instead of `failed` from a missing result, so a command that did not run is never shown as a failed file"
  - "Per-source notes of the matrix live in the derived model, not in the file: the matrix has no Note column (rule A-1)"
  - "Space quotes run from J1's message start to its end (cut at a JSON quote), so the full assertEnoughSpace text is quoted"
metrics:
  duration: 75min
  completed: 2026-11-11
plan_head_before: 5dc4c593c155ed9fd44f8bb98e17c6d37339c9cf
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
---

# Phase 8 Plan 24: Part A gate Summary

The Part A gate ran on one tested commit, and every cell of `08-GATE-A.md` is printed by a verifier that re-derives the file from the raw evidence and passes `check` over all sections. Host gates are green apart from the audit. `pnpm test:integration` is red: 13 rate-limit test failures. Egress and both image checks are `blocked (space)`. AIDA-26 and AIDA-31 close, AIDA-28 and AIDA-32 are split, and AIDA-25, 27, 29 and 30 stay open.

- Tested commit: `61c86966ec79466b05f2ac361e6009883879ca90` (Task 1 commit)
- Run id: `mwc6vmbv-8de59ebf3cc1c67e`
- Evidence dir (kept; `check` reads it): `/private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH`

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 61c8696 | test(08-24): Part A gate verifier with literal cases and mutation tests (R3-4, R4-1, R4-2, rule J) |
| 2 | d402fd2 | docs(08-24): record Part A gate results and evidence checks at the tested commit |
| 3 | bf63deb | docs(08-24): Part A evidence matrix, requirement split and open items |

## Task 1 verification

`vitest run tests/unit/part-a-gate-check.test.ts`: exit 0, 40 passed (16 literal cases, one worstOf case, a baseline and 22 mutations). Spec check: "spec matches plan: 31 rows". Source check: "sources named: 16 files in 31 rows". `pnpm typecheck` 0, `pnpm lint` 0 (one warning, in an existing file), `pnpm test` 0 (71 files, 1156 tests; part-a-gate-check passed 40). The process grep prints 0, `assertEnoughSpace` appears 4 times, and the retyped space text appears 0 times. RED was confirmed before the script existed.

## Results

| Command | Exit | Result | Note |
|---|---|---|---|
| pnpm lint | 0 | passed | |
| pnpm typecheck | 0 | passed | |
| pnpm test | 0 | passed | 71 files, 1156 passed |
| pnpm build | 0 | passed | |
| pnpm audit --prod | 1 | failed | 0 critical, 10 high ("Severity: 2 low \| 30 moderate \| 10 high"); residual table in 08-04-SUMMARY.md |
| pnpm audit --prod --audit-level=high | 1 | failed | same |
| pnpm test:integration | 1 | failed | 101 files, 1314 passed, 13 failed (below) |
| pnpm test:e2e | 0 | passed | expected=219 unexpected=0 skipped=1 flaky=0 |
| pnpm test:egress | 1 | blocked (space) | 4 skipped, 0 passed; "Free space on the host is 19.4 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check runner | 3 | blocked (space) | verify exit 0, `word="blocked (space)"`, same host space line |
| image check builder | 3 | blocked (space) | verify exit 0, `word="blocked (space)"`, same host space line |
| pnpm test:docker-cleanup --run | 0 | passed | "0 resource(s) of run mwc6vmbv-8de59ebf3cc1c67e; dry run, nothing removed." |
| compose stack gate | - | moved to Phase 8.1 | Part B, plan 08-16 |

Evidence checks: all 7 `passed` (audit exit recorded as 1, no Google Fonts host in the build log, OPERATIONS.md volume procedure and client IP section, sla-flag comment, foreign listing identical before and after, and no foreign project named in the 19 gate logs).

Integration failures, all from the Part A rate limits: `public-state-label.test.ts` (7) and `merge-reply-race.test.ts` (4) get `429 rate_limited`. `status-read-snapshot.test.ts` (2) throws `RATE_LIMIT_PEPPER is required`. The plan allows no code change after the tested commit, so these are recorded, not fixed. Matrix rows 15, 21, 22 and 23 take the failed integration row word.

## Design-system checklist

Item 1 is passed, and items 6 (no named text size in 104 added lines) and 8 are passed. Items 2 to 5 are `not run (manual: 6 UI files changed)`, and item 7 (dark mode) is `not run (manual: visual check)`. Neither manual item is claimed.

## Requirement status

| Requirement | Part A rows closed | Moved to Phase 8.1 | Requirement closed |
|---|---|---|---|
| AIDA-25 | no | - | no |
| AIDA-26 | yes | - | yes |
| AIDA-27 | no | 5, 6, 8, 10 | no |
| AIDA-28 | yes | 12, 13 | no (split: Phase 8.1) |
| AIDA-29 | no | 17, 18 | no |
| AIDA-30 | no | 20, 24, 25 | no |
| AIDA-31 | yes | - | yes |
| AIDA-32 | yes | 27, 31 | no (split: Phase 8.1) |

Candidate safe point for v1.0.0 (owner decides; not the Phase 8 safe point): 61c86966ec79466b05f2ac361e6009883879ca90

## Human items still open

All of them are listed in 08-GATE-A.md, `## Human items still open`. The owner decides on the candidate, on VM and host space (0a2), and on Phase 8.1. A human handles visual and dark-mode approval and design items 2 to 5. The audit, integration, egress and both image-check rows need a rerun. No cleanup `--apply` is needed, because the dry run found 0 resources.

## Deviations from Plan

- None in code. Interpretation, recorded under `decisions`: a named file source whose command did not run takes the command's `not run`/`blocked (docker unhealthy)` word.
- No `.next` move and no rerun. STATE, ROADMAP and REQUIREMENTS were not touched (they belong to the orchestrator).

## Known Stubs

None.

## Self-Check: PASSED

The created files exist. Commits 61c8696, d402fd2 and bf63deb are in `git log`. The full `check` prints "PART-A-GATE-CHECK ok sections=all results=13 evidence=7 design=8 matrix=31 requirements=8".

## Gate rerun after 08-gap1

Tasks 2 and 3 were rerun on a new tested commit that holds the 08-gap1 test fix (`c403af7`). The verifier `scripts/part-a-gate-check.ts` was reused unchanged. `08-GATE-A.md` was regenerated by `derive`, and the full `check` prints `PART-A-GATE-CHECK ok sections=all results=13 evidence=7 design=8 matrix=31 requirements=8`. All four Task 3 verifies pass ("results still valid for 4d0eefd...", "matrix ok: 31 rows, 8 requirements", "cleanup: 0 resources for mwc83b4f-d165ad43755f5ab7").

- Tested commit: `4d0eefd8f79542e8680d3baa27459f0a3e2f0698`. Outside `.planning` it equals `c403af7`, and it differs from `61c8696` only in the three integration test files of 08-gap1.
- Run id: `mwc83b4f-d165ad43755f5ab7`
- Evidence dir (kept; `check` reads it): `/private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l`

| Command | Exit | Result | Note |
|---|---|---|---|
| pnpm lint | 0 | passed | 600 files, 1 warning (existing) |
| pnpm typecheck | 0 | passed | |
| pnpm test | 0 | passed | 71 files, 1156 passed |
| pnpm build | 0 | passed | |
| pnpm audit --prod | 1 | failed | 0 critical, 10 high ("Severity: 2 low \| 30 moderate \| 10 high") |
| pnpm audit --prod --audit-level=high | 1 | failed | same |
| pnpm test:integration | 0 | passed | 101 files, 1327 passed, 0 failed |
| pnpm test:e2e | 0 | passed | expected=219 unexpected=0 skipped=1 flaky=0 (after one `.next` move, below) |
| pnpm test:egress | 1 | blocked (space) | 4 skipped, 0 passed; "Free space on the host is 18.5 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check runner | 3 | blocked (space) | verify exit 0, `word="blocked (space)"`, same host space line |
| image check builder | 3 | blocked (space) | verify exit 0, `word="blocked (space)"`, same host space line |
| pnpm test:docker-cleanup --run | 0 | passed | "0 resource(s) of run mwc83b4f-d165ad43755f5ab7; dry run, nothing removed." |
| compose stack gate | - | moved to Phase 8.1 | Part B, plan 08-16 |

Evidence checks: all 7 `passed`. The foreign listing is identical before and after (1 line), and no foreign project is named in the 20 gate logs. Docker health: `colima status` 0, `docker info` 0. The design-system checklist is unchanged from the first run: items 1, 6 and 8 `passed`, items 2 to 5 `not run (manual: 6 UI files changed)`, item 7 `not run (manual: visual check)`.

`.next` move (report to LAPORAN.md): the first `pnpm test:e2e` exited 1 with 0 tests run, because global setup hung on `/setup` (`page.waitForURL(/\/login/)` timed out at `tests/e2e/global-setup.ts:165`). This is the known stale `.next` after `pnpm build`. `.next` was moved with `mv .next ~/.Trash/aida-next-1794408154`, and E2E was rerun once, alone. That rerun is the recorded row. The first attempt is kept as `e2e-attempt1.{log,json,exit}` in the evidence directory.

Matrix rows 15, 21, 22 and 23 are now `passed`. Row 1 stays `failed` (audit), and row 7 stays `blocked (space)`.

| Requirement | Part A rows closed | Moved to Phase 8.1 | Requirement closed |
|---|---|---|---|
| AIDA-25 | no | - | no |
| AIDA-26 | yes | - | yes |
| AIDA-27 | no | 5, 6, 8, 10 | no |
| AIDA-28 | yes | 12, 13 | no (split: Phase 8.1) |
| AIDA-29 | yes | 17, 18 | no (split: Phase 8.1) |
| AIDA-30 | yes | 20, 24, 25 | no (split: Phase 8.1) |
| AIDA-31 | yes | - | yes |
| AIDA-32 | yes | 27, 31 | no (split: Phase 8.1) |

Compared with the first run, AIDA-29 and AIDA-30 move from `no` to `no (split: Phase 8.1)`.

Candidate safe point for v1.0.0 (owner decides; not the Phase 8 safe point): 4d0eefd8f79542e8680d3baa27459f0a3e2f0698

Human items still open: as listed in `08-GATE-A.md`. The owner decides on the candidate, on VM and host space (0a2; the host now has 18.5 GiB), and on Phase 8.1. A human handles visual and dark-mode approval and design items 2 to 5. The audit, egress and both image-check rows need a rerun. No cleanup `--apply` is needed, because the dry run found 0 resources. No compose command ran, and project `aida` and `aida-dev-db` were not touched.

| Commit | Subject |
|---|---|
| 61264b4 | docs(08-24): record Part A gate results and evidence checks at the tested commit |
| c3677e5 | docs(08-24): Part A evidence matrix, requirement split and open items |

## Final gate after review fixes F1 to F8 (step 8)

Tasks 2 and 3 were rerun as the charter's step 8 gate after the code review fixes F1 to F8 and three Codex diff rounds. The verifier `scripts/part-a-gate-check.ts` is the one at the tested commit, unchanged by this rerun (last change `e4466f0`, batch F6, K134). `08-GATE-A.md` was regenerated by `derive`, and the full `check` prints `PART-A-GATE-CHECK ok sections=all results=13 evidence=7 design=8 matrix=31 requirements=8` (exit 0). All Task 2 verifies pass ("tree state consistent", "results words ok: 13 results, 7 evidence checks"), and all Task 3 verifies pass ("results still valid for fc8078f...", "matrix ok: 31 rows, 8 requirements, candidate fc8078f...", "cleanup: 0 resources for mwcgrr52-67111e2a3044e0ec").

- Tested commit: `fc8078f04292c7718b31cae09050ff5cd56bfe3c`. Outside `.planning` it equals `e20c094`.
- Run id: `mwcgrr52-67111e2a3044e0ec`
- Evidence dir (kept; `check` reads it): `/private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa`
- Host disk (`df -h /System/Volumes/Data`): 15Gi available at the start and 15Gi at the end (14.8 GiB as J1 counts it). That is below rule J's 20 GiB and above the 12 GiB stop.

| Command | Exit | Result | Note |
|---|---|---|---|
| pnpm lint | 0 | passed | 616 files, 1 warning (existing) |
| pnpm typecheck | 0 | passed | |
| pnpm test | 0 | passed | 78 files, 1395 passed, 0 failed |
| pnpm build | 0 | passed | |
| pnpm audit --prod | 1 | failed | 0 critical, 10 high ("Severity: 2 low \| 30 moderate \| 10 high") |
| pnpm audit --prod --audit-level=high | 1 | failed | same |
| pnpm test:integration | 0 | passed | 101 files, 1360 passed, 0 failed |
| pnpm test:e2e | 0 | passed | expected=225 unexpected=0 skipped=1 flaky=0 |
| pnpm test:egress | 1 | blocked (space) | 4 skipped, 0 passed; "Free space on the host is 14.8 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check runner | 3 | blocked (space) | verify exit 0, `word="blocked (space)"`, same host space line |
| image check builder | 3 | blocked (space) | verify exit 0, `word="blocked (space)"`, same host space line |
| pnpm test:docker-cleanup --run | 0 | passed | "0 resource(s) of run mwcgrr52-67111e2a3044e0ec; dry run, nothing removed." |
| compose stack gate | - | moved to Phase 8.1 | Part B, plan 08-16 |

Evidence checks: all 7 `passed`. The K134 row ``listed containers, and the volumes of project `aida`, unchanged`` was captured one command per listing, each with its own `.exit` file (`foreign-<before|after>-<project-containers|dev-db-container|project-volumes>.{txt,exit}`): all six exit 0, each has its header line, 1 row in total, and before and after are identical. Its written limit is under `## Notes` of `08-GATE-A.md`, because the row's table note is derived and may not be hand-edited: it shows that the listed containers and the `aida` project's volumes did not change. It does not show that no other foreign resource was touched, and it says nothing about volume contents. No foreign project is named in the 19 gate logs. Docker health: `colima status` 0, `docker info` 0.

Design-system checklist: items 1, 6 and 8 `passed`; items 2 to 5 `not run (manual: 6 UI files changed)`; item 7 `not run (manual: visual check)`. Unchanged from the earlier runs. The plan's `part-a-src.patch` selects only the `type(08-NN):` commits of Part A plans, so the four `.tsx` files changed by F1 to F8 are not in it. A read-only diff of `src/**/*.tsx` and `src/**/*.css` between `4d0eefd` and the tested commit shows no added named text size. That check is noted in the gate file and was not derived.

Matrix: row 1 `failed` (audit), row 7 `blocked (space)`, and every other Part A row `passed`. The 13 rows that have a Phase 8.1 part (5, 6, 8, 10, 12, 13, 17, 18, 20, 24, 25, 27, 31) read `moved to Phase 8.1`, and none of them is closed.

| Requirement | Part A rows closed | Moved to Phase 8.1 | Requirement closed |
|---|---|---|---|
| AIDA-25 | no | - | no |
| AIDA-26 | yes | - | yes |
| AIDA-27 | no | 5, 6, 8, 10 | no |
| AIDA-28 | yes | 12, 13 | no (split: Phase 8.1) |
| AIDA-29 | yes | 17, 18 | no (split: Phase 8.1) |
| AIDA-30 | yes | 20, 24, 25 | no (split: Phase 8.1) |
| AIDA-31 | yes | - | yes |
| AIDA-32 | yes | 27, 31 | no (split: Phase 8.1) |

Split: two can close (AIDA-26, AIDA-31), four are split (AIDA-28, 29, 30, 32), and two stay open (AIDA-25 because of the audit, AIDA-27 because of the image checks and the runtime rows). AIDA-31's row 26 is derived from `tests/unit/connection-test-errors.test.ts` (30 passed, 0 failed, 14 of them titled with K127 or K131) and `tests/unit/settings-connection-actions.test.ts` (28 passed, 0 failed, 6 titled with K127 or K131) inside this run's `pnpm test` result. These are the connection-test classification fixes of F2 (K127) and F6 (K131). The split is the same as in the rerun after 08-gap1.

`.next` moves: none. E2E global setup did not hang on `/setup`, and every command ran once.

Candidate safe point for v1.0.0 (owner decides; not the Phase 8 safe point): fc8078f04292c7718b31cae09050ff5cd56bfe3c

Human items still open: as listed in `08-GATE-A.md`. The owner decides on the candidate, on VM and host space (0a2; the host now has 14.8 GiB), and on Phase 8.1. A human does the visual and dark-mode approval and design items 2 to 5. The audit, egress and both image-check rows need a rerun once their causes are gone. No cleanup `--apply` is needed, because the dry run found 0 resources. No compose command ran, and project `aida` and `aida-dev-db` were not touched. The image check left its own temp run dirs `aida-image-check-4nxpc3` and `aida-image-check-kbY82u` under `${TMPDIR}`. They were not created by `mktemp -d` in this run, so they were not removed.

| Commit | Subject |
|---|---|
| cce20ad | docs(08-24): record Part A gate results and evidence checks at the tested commit (final gate after F1 to F8) |
| 13a338b | docs(08-24): Part A evidence matrix, requirement split and open items (final gate after F1 to F8) |
