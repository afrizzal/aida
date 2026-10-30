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
