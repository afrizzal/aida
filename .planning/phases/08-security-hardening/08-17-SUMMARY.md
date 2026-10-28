---
phase: 08-security-hardening
plan: 17
subsystem: e2e-harness
status: complete
tags: [e2e, playwright, teardown, flake, gate-readiness]
requires: []
provides:
  - "tests/e2e/support/process-tree.ts: killTree, stopProcessTree (cross-platform process-tree teardown)"
  - "hydration-robust, self-contained honesty-invariants spec"
affects: [08-07, 08-08, 08-24]
tech-stack:
  added: []
  patterns:
    - "POSIX children spawned detached; teardown signals the process group, waits for ESRCH, escalates to SIGKILL"
    - "Radix select opened through expect(...).toPass() open-then-pick retry"
key-files:
  created:
    - tests/e2e/support/process-tree.ts
    - tests/unit/e2e-process-tree.test.ts
  modified:
    - tests/e2e/honesty-invariants.spec.ts
    - tests/e2e/global-setup.ts
    - tests/e2e/phase4-ai.spec.ts
    - tests/e2e/phase5-rag.spec.ts
    - tests/e2e/kb-proposals.spec.ts
  deleted:
    - tests/e2e/support/worker.ts
decisions:
  - "process-tree.ts replaces support/worker.ts (added by a60d339 after the plan's base tree); every caller moved to stopProcessTree"
  - "kb-proposals.spec.ts moved to the shared helper too, so no spec carries a platform-specific kill command (Task 2 grep)"
requirements: [AIDA-28]
duration: 50min
completed: 2026-11-11
plan_head_before: 7e7326797da7701baa9bf0ff9598ea83c60bbe4f
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
---

# Phase 8 Plan 17: E2E harness teardown and honesty-invariants flake Summary

The E2E harness now has one shared process-tree teardown, `killTree` and `stopProcessTree` in `tests/e2e/support/process-tree.ts`. On POSIX it signals the detached process group, waits for it to exit and escalates to SIGKILL. honesty-invariants now waits for a hydrated Radix select and sets up its own provider in both tests. Two consecutive full `pnpm test:e2e` runs on this Mac passed: exit 0, 209 passed, 1 skipped each, honesty-invariants 2/2 in each, and no leaked worker.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | e8af4ec | test(08-17): cross-platform worker teardown and hydration-robust honesty-invariants (gate readiness) |
| 2 | c8f9d8d | test(08-17): global setup and worker specs share the cross-platform teardown (gate readiness) |

FIRST = e8af4ec, LAST = c8f9d8d. Both `git diff --stat e8af4ec^..e8af4ec -- . ':!tests'` and `git diff --stat e8af4ec^..c8f9d8d -- . ':!tests' ':!.planning'` print nothing.

## Evidence

**Worker processes found before the first run** (`pgrep -fl src/lib/worker/index.ts`, 2026-11-11T11:07Z): none (exit 1).

| Command | Exit | Result |
|---------|------|--------|
| `pnpm exec vitest run tests/unit/e2e-process-tree.test.ts` (RED, before the module existed) | 1 | "Cannot find module '../e2e/support/process-tree'" |
| `pnpm exec vitest run tests/unit/e2e-process-tree.test.ts` (GREEN, re-run after the biome format pass) | 0 | 3 passed |
| `pnpm typecheck` (after Task 1, after Task 2) | 0, 0 | clean |
| `pnpm lint` (Task 1 first try) | 1 | organizeImports in honesty spec, format in the unit test; fixed with `biome check --write` on own files |
| `pnpm lint` (after the fix, after Task 2) | 0, 0 | clean |
| `colima status` / `docker info` (before Task 1 E2E, before Task 2 E2E) | 0 / 0, 0 / 0 | healthy |
| Task 1 verify: `pnpm test:e2e tests/e2e/honesty-invariants.spec.ts` | 0 | 2 passed (22.1 s); no kill "not found" line; workers before 0, after 0; `honesty-clean` |
| Task 2 grep verify | 0 | `one-teardown-helper` |
| Task 2 verify, full run 1 | 0 | 209 passed, 1 skipped, 0 failed (5.7 min); honesty (a) and (b) passed |
| Task 2 verify, full run 2 | 0 | 209 passed, 1 skipped, 0 failed (5.6 min); honesty (a) and (b) passed |
| Task 2 verify overall | 0 | workers before 0, after 0; no "taskkill" or "command not found" in either log; `e2e-twice-green` |

All Docker test runs used `AIDA_TEST_RUN_ID=mwc0k2s6-315351ecaa4e1238` and `DOCKER_HOST` from the active docker context.

Full-run log directory (kept for the orchestrator): `/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-e2e-full-lL1SKg` (`e2e-1.log`, `e2e-2.log`). The honesty-only log directory was deleted after it was read.

The baseline was 63 passed, 1 skipped and 2 failed (2026-11-08). Today's suite has more tests (209), because later phases added specs since that baseline.

## Deviations from Plan

**1. [Rule 3 - Blocking] The plan's base tree was out of date: `support/worker.ts` already existed**
- **Found during:** Task 1 read-first.
- **Issue:** Commit a60d339, which is not an ancestor of the plan's base e6ca145, had already replaced the Windows-only afterAll command in honesty-invariants, phase4-ai and phase5-rag with `stopWorker` from `tests/e2e/support/worker.ts`. That helper signalled only the tsx parent and did not use a detached group.
- **Fix:** the specs call `stopProcessTree` as the plan prescribes. `support/worker.ts` was deleted in Task 2 once it had no callers left.
- **Commits:** e8af4ec, c8f9d8d.

**2. [Rule 3 - Blocking] kb-proposals.spec.ts also changed (not in files_modified)**
- **Issue:** its local `stopWorker` still ran the Windows tree-kill command in code, which fails Task 2's grep check and the truth "no spec file contains a platform-specific kill command".
- **Fix:** it spawns its worker detached on POSIX, and its `stopWorker()` now delegates to `stopProcessTree(worker, WORKER_STOP_TIMEOUT_MS)`. Its audit-trail checks are unchanged.
- **Commit:** c8f9d8d.

**3. Behaviour note (no assertion changed):** the old `stopWorker` rejected a worker that had not exited within 60 s. `stopProcessTree` instead escalates to SIGKILL and never throws, as the plan specifies. A hung worker is therefore killed rather than failing afterAll. The before/after worker count in the verify commands still catches a leak.

No assertion was removed or widened. The adversarial assertions in honesty-invariants (SQL-derived numbers, no unbacked citation, raw output containing the fabricated chunk id) are unchanged.

## Known Stubs

None.

## Manual items

None for this plan.

## Self-Check: PASSED

- FOUND: tests/e2e/support/process-tree.ts, tests/unit/e2e-process-tree.test.ts
- FOUND: commits e8af4ec, c8f9d8d
- `tests/e2e/support/worker.ts` is absent (intentional deletion)
