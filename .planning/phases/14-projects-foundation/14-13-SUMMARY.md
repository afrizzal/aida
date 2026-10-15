---
phase: 14-projects-foundation
plan: 13
subsystem: projects
tags: [inventory, completeness-check, gate, review-C5, review-C7, K70]
status: complete
requires: ["14-08", "14-09", "14-10", "14-11", "14-12"]
provides:
  - tests/unit/project-operation-inventory.test.ts (completeness check only, 21 of 21 passed after K70)
  - .planning/phases/14-projects-foundation/14-GATE.md (gate on 4d6a498 with evidence and open items)
affects: [phase-14-verification]
tech-stack:
  added: []
  patterns: ["pure block parser and rules over a path-to-text map; markers resolved through module-level helpers and constants the block references (K70)"]
key-files:
  created: [tests/unit/project-operation-inventory.test.ts, .planning/phases/14-projects-foundation/14-GATE.md]
  modified: []
decisions:
  - "K70: isolation markers other than the operation call may sit in a module-level helper or constant the block references (same file or tests/support/*.ts), followed transitively; the operation call itself must stay in the block's own text"
  - "projectTableSnapshot and missingId are not expanded during resolution, so calling the snapshot never stands in for the separate ProjectActivity check"
  - "The environment-file diff check of Task 3 (d) was replaced by a name-only diff of every path outside src, tests, .planning and prisma, because the secret-file guard refuses any command naming that file"
metrics:
  duration: "about 25 minutes (first run) plus about 40 minutes (K70 revision and gate)"
  completed: 2026-11-09
  tasks_completed: "3 of 3"
plan_head_before: 0b51266902038c694ea4561bb67a584bb371f516
actuals:
  tokens: 21000
  tasks: 3
  commits: 5
---

# Phase 14 Plan 13: Operation inventory and gate Summary

**The operation inventory passes after run decision K70 (21 of 21), and the Phase 14 gate ran on tested commit `4d6a498319774712de8870c503cf951831be92cd`. Lint, typecheck, unit (795), integration without the egress file (1198) and build are green. E2E is red (3 failed, 15 did not run) and stays red. The audit baseline is unchanged (141), the clean-room grep is empty, and the three O-1 rows are blocked.**

`commits: 5` is measured as `git rev-list --count 0b51266..HEAD` before this SUMMARY's own commit. It includes the orchestrator's `32ec6a0` (RUN-LOG). This plan's commits are `d5ceb9c`, `27accb7`, `4d6a498` and `0e4df7c`, plus the SUMMARY/STATE commit.

## Task 1: inventory after K70

- First run (`d5ceb9c`): red with 59 gaps. The markers sat in file-level helpers and constants, and the rule only counted a block's own text. The previous SUMMARY version (`27accb7`) records this.
- K70 revision (`4d6a498`): `resolvedText()` adds the text of every module-level function or constant that the block references, defined in the same file (which wins) or in `tests/support/*.ts`. It follows each helper's own references in turn. Sibling blocks are never definitions, and helpers the block does not reference never count. The operation call must still appear in the block's own text. `projectTableSnapshot` and `missingId` are not expanded. The snapshot rule now counts module-level constants that the function references (`SNAPSHOT_ORDER`).
- Own-parser fix: the snapshot rule took the first column-0 line starting with `)` as the end of the block, and biome writes the `): Promise<...> {` line of a wrapped signature at column 0. So the body was cut off, which was the actual cause of the 59th gap together with `SNAPSHOT_ORDER`. The rule now takes the whole module-level definition.
- New cases:
  - "negative: a helper holding the marker is defined but not called by the block (K70)".
  - "negative: projectTableSnapshot( never stands in for the ProjectActivity check (K70)".
  - "positive: markers reached through helpers and constants the block references count (K70)".
- Unchanged: every earlier rule, `PROJECT_OPERATIONS`, `NO_TARGET_ID_OPERATIONS`, all ten earlier negative cases and the positive control.
- Result: `pnpm exec vitest run tests/unit/project-operation-inventory.test.ts` exit 0, 21 passed. `biome check` exit 0. 12 "negative: " cases and the positive control. `git diff --name-only 0b51266..HEAD -- . ':!.planning'` lists only the inventory test.
- No real gap remained, so no gap list or owning plan applies.

## Task 2: gate on `4d6a498`

| Step | Exit | Counts / note | Verdict |
|---|---|---|---|
| `pnpm lint` | 0 | 544 files | green |
| `pnpm exec next typegen` + `pnpm typecheck` | 0 + 0 | | green |
| `pnpm test` | 0 | 49 files, 795 passed | green |
| integration with `--exclude tests/integration/egress-isolation.test.ts` | 0 | 88 files, 1198 passed, 0 skipped | green |
| `pnpm test:e2e` | 1 | 191 passed, 3 failed, 1 skipped, 15 did not run | red: `phase4-ai.spec.ts:387` T7 ("Re-run AI triage" button not found), `phase4-ai.spec.ts:433` T8 (`triagedTicketId` empty, serial state from T7), `ticket-statuses.spec.ts:313` (Options button not found for focus). Cause not diagnosed, not rerun. Phase 14 changed no file under `src/app` or `src/components`. |
| `pnpm build` | 0 | known NFT warning for `next.config.ts` | green |
| `pnpm audit --prod` | 1 | 141 (13 low, 69 moderate, 52 high, 7 critical) | baseline unchanged (not passed) |
| `git grep -i -n gr8r -- src docs website README.md public prisma tests` | 1 | no output | green |
| full integration with egress, `pnpm test:egress`, compose stack | not run | | blocked (O-1) |

No flake was observed and no command was rerun. Logs: `${TMPDIR}/aida-14-gate-{lint,typegen,typecheck,unit,integration,e2e,build,audit,cleanroom}.log`.

## Task 3: evidence

`14-GATE.md` contains:

- one row per acceptance clause of AIDA-64 to AIDA-71 and AIDA-100 to AIDA-105, with "recorded in ProjectActivity, owner confirmation pending" for the audit clauses of AIDA-103 and AIDA-104;
- rows SC1 to SC7, where SC2 to SC4 name integration behaviour tests and SC6 names the clean-room grep, followed by the completeness-check sentence;
- D-01 to D-17, K59 and K61 to K69, C1 to C18, and review items P1 to P3, C1 to C8, R2-1 to R2-3, P4 and R3-1 to R3-4;
- the phase-diff greps (no package change, no egress or LLM import, no single-row membership read, no path alias, the one migration);
- a note that the design checklist does not apply;
- the open items, ending with the fixed owner sentence.

Every test file it names exists, and every case title it quotes was checked against the test sources (one title corrected to its full text before the commit). The Task 2 and Task 3 verify loops both pass when run in bash. The post-gate check is empty: `git diff --stat 4d6a498..HEAD -- . ':!.planning'` and `git status --porcelain -- . ':!.planning'` print nothing.

## Deviations from Plan

1. **[K70, own file only] Marker resolution and snapshot parser fix.** Applied as the orchestrator decided; described above. No rule was dropped, loosened or narrowed beyond K70, and no file of an earlier plan was touched.
2. **[Guard] Environment-file diff.** The secret-file guard refuses any Bash command naming the environment file, so `git diff --stat PHASE_START..HEAD -- .env` could not run. The gate records the equivalent name-only diff of every path outside src, tests, .planning and prisma (README.md, two compose files, docs/OPERATIONS.md; no environment file), together with the reason.
3. **[Commit shape] Tasks 2 and 3 share one commit (`0e4df7c`).** Both write only `14-GATE.md`, and the file was written once.
4. **[Shell] Verify loops** were run unchanged inside `bash` (zsh word-splitting).

## Open (not claimed)

14-o1, 14-o2, O-1 (blocked suites, the compose stack, and K68 plus the inbound-email fix checked only statically), O-3 (AIDA-43), 12-o1, 12.2-o4, the review C8 limitation, and the manual item of 14-05. E2E is red; it needs diagnosis outside this plan.

## Self-Check: PASSED

- FOUND: tests/unit/project-operation-inventory.test.ts, .planning/phases/14-projects-foundation/14-GATE.md
- FOUND: d5ceb9c, 27accb7, 4d6a498, 0e4df7c
- The post-gate check is empty.
