---
phase: 12-ticket-lifecycle
plan: 09
subsystem: docs, gate, tests
status: complete
tags: [gate, readme, design-checklist, evidence, merge, relations, snooze]
requires: ["12-08", "12-10"]
provides:
  - "README Features row: ticket links, merge and snooze, with refusals and limitations"
  - ".planning/phases/12-ticket-lifecycle/12-GATE.md: gate table on 7c3bad3, §9 checklist, security greps, permission and privacy evidence, requirement evidence, open items"
affects: [phase-12-verification, REQUIREMENTS.md (orchestrator), Phase 12.1]
tech-stack:
  added: []
  patterns:
    - "A timestamp condition that a race case claims is pinned in the stored row, never inferred from two clocks"
key-files:
  created:
    - .planning/phases/12-ticket-lifecycle/12-GATE.md
  modified:
    - README.md
    - tests/integration/merge-race-coverage.test.ts
    - tests/integration/ticket-relations.test.ts
decisions:
  - "Gate attempt 1 went red on merge-race-coverage 1b. The cause was a test bug: Prisma 7 fills @default(now()) from the Node clock at create time, while mergedAt is Postgres clock_timestamp(). 1a and 1b now pin createdAt 1 ms before mergedAt and assert the stored value. No visibility assertion was changed"
  - "The unlink path had no membership-refusal test. One was added, and the whole gate was rerun on the new commit (attempt 3, of record)"
  - "The ticket top bar's border-border (not /70) predates Phase 12 (v1 commit 2d65bbc). It is reported as an open item and not fixed here"
metrics:
  duration: "~14 min (15:37 to 15:52 UTC)"
  completed: 2026-11-08
plan_head_before: 118ac9574f58d1bf4ada8a36e9c07455ab149541
actuals:
  tokens: 8000
  tasks: 3
  commits: 4
---

# Phase 12 Plan 09: README note, phase gate, §9 checklist and evidence Summary

This plan added a README Features row for links, merge and snooze, and recorded the charter gate on `7c3bad3`. Every gate command is green except the audit, which is red at the baseline counts, and the two egress-driven suites, which are blocked (O-1). Getting there needed one test fix (a cross-clock assertion) and one added test (the unlink membership refusal). Every human, owner and backstop item stays open.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 (tracer) README note + Phase 12 E2E | `4ddc430` | `pnpm test:e2e tests/e2e/ticket-relations.spec.ts tests/e2e/ticket-merge.spec.ts tests/e2e/snooze.spec.ts tests/e2e/activity-feed.spec.ts tests/e2e/public-status.spec.ts` (Colima env): exit 0, 22 passed (4, 5, 8, 2, 3), 0 failed. Greps: snooze 1, merge 1, "different customers" 1. The tracer gate passed before Task 2 |
| 2 Gate | `65d4b7e` (fix), `7c3bad3` (test), `35c3917` (record) | See the gate table below |
| 3 §9, evidence, open items | `35c3917` | 12-GATE.md sections "§9 checklist", "Security greps", "Permission and privacy", "Requirement evidence" and "Open items (manual, left open)" |

## Gate of record (attempt 3, `7c3bad3`)

Commands ran one at a time. Logs are under `$TMPDIR/aida-12-09-gate3-*.log`, exit codes were read without a pipe, `pgrep -f 'artisan test'` was empty before each command, and the Colima socket variables were set.

| Command | Exit | Counts |
|---------|------|--------|
| `pnpm lint` | 0 | 387 files |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 268 tests |
| `pnpm test:integration --exclude tests/integration/egress-isolation.test.ts --reporter=verbose` | 0 | 32 files, 270 tests; egress-isolation only in the echoed command; all ten Phase 12 files ran |
| `pnpm test:e2e` (full) | 0 | 140 passed, 1 skipped (`uat-gaps`), 0 failed, 0 flaky |
| `pnpm build` | 0 | the known NFT warning |
| `pnpm audit --prod` | 1 | 7 critical, 52 high, 69 moderate, 13 low |
| `pnpm test:integration` (as-is), `pnpm test:egress` | blocked (O-1) | not run |

Compared with the Phase 11 final gate (lint 343, unit 229, integration 142, e2e 121, build 0, audit 7/52), nothing is worse. The `aida-egress-test` container listings were empty before and after every attempt.

Earlier attempts are kept in 12-GATE.md. Attempt 1 (`4ddc430`) went red on integration (exit 1, 268 passed and 1 failed: merge-race-coverage 1b). Attempt 2 (`65d4b7e`) was green apart from the audit; it had integration 269 and e2e 140 passed.

## Deviations from Plan

1. **[Rule 1 - Bug, test] Cross-clock assertion in merge-race-coverage 1a and 1b.** Found during Task 2, attempt 1. `expect(f.createdAt) < mergedAt` failed by 1 ms (1794152369529 vs 1794152369528). Prisma 7 sets `@default(now())` from the application clock when it creates the row (Prisma docs through Context7), and `mergedAt` is the database's `clock_timestamp()`. The old assertion passed only because of clock skew, and the 12-10 SUMMARY's inference that "createdAt is the transaction start time" was wrong. Fix: a `pinCreatedAtBefore` helper sets the stored `createdAt` 1 ms before `mergedAt` and asserts it, the same technique 1c uses, so the C1 condition holds by construction. Every seq, page and attachment assertion is unchanged. Commit `65d4b7e`.
2. **[Rule 2 - Missing test] Unlink membership refusal.** Found while building the permission evidence. `removeRelation` checks `findActiveMembership`, but no test proved that a removed member is refused. Added a case: `MEMBERSHIP_ENDED`, with the relation and audit counts unchanged. Commit `7c3bad3`. The whole gate was rerun as attempt 3.
3. **Tasks 2 and 3 share one documentation commit** (`35c3917`), because both write the same file and partial staging is not available non-interactively. The Task 2 code changes have their own commits.
4. **Integration row run once with `--reporter=verbose`.** The plan's command and the orchestrator's `pnpm test:integration --exclude …` are the same vitest invocation. One verbose run gives both the totals and the file list, instead of the separate 4a and 4b runs that Phase 11 used.

## Open items (copied from 12-GATE.md, all left open)

1. Visual approval (human) of every new surface: relation chips and row, actions menu, picker and its disabled reasons, the Link dialog, the merge dialog and callouts, the merged banner and composer line, the "Moved from" marker, the snooze trigger, popover and chip, the Snoozed toggle and lines, the feed event rows, and the public "Combined" label and notice: open (human).
2. Dark-mode review (human) of the same surfaces, DS §7: open (human).
3. Screen-reader check (human) of the actions menu, the picker reasons, the merge confirmation, the snooze popover and the feed list: open (human).
4. 12-06 backstops: actions menu with a 255-character subject at 1280px; chip truncation at 200px and the remove button at 1024px; picker row truncation and the cycle callout at 360px; the merge confirmation and its callout at 360px with three footer buttons.
5. 12-07 backstops: the banner and composer line at 1024px; a long IANA zone in the 320px popover inside a 360px viewport; chip wrapping in a 360px list row; the public merged notice at 360px; Asia/Jakarta Tomorrow 09:00 stored as 02:00 UTC.
6. 12-08 backstops: four active filters wrapping in the 360px list panel; a feed with 500 events and 200 messages; a 255-character member name in an event row at 1024px.
7. UI paths without E2E: the merge-refusal and rejected-call callouts, the snooze refusal callouts and "Snooze outcome unknown" (the server refusals are proven).
8. O-1: container tests on the shared Docker VM; `test:integration` as-is and `test:egress` blocked.
9. 12-o1: AIDA-53's literal "full `AuditEvent`" (and ROADMAP criterion 2's "full audit event") is not met. The merge audit is in `TicketAuditEvent` (D-11).
10. O-3: unparking Phases 8, 9 and 10.
11. AIDA-43 open (D-01): older pages and actions, including the agent messages route, still lack the membership check.
12. Phase 12.1 status readers (D-02): `src/lib/tickets/merge.ts`, `src/lib/demo/seed-demo-data.ts`, `src/lib/tickets/status-page-data.ts`, `src/app/(public)/status/[token]/page.tsx`, `src/app/api/public/status/[token]/csat/route.ts`, `src/lib/tickets/reopen-on-reply.ts` (with `follow-up/route.ts` and `ingest-message.ts`), `src/lib/worker/jobs/auto-close.ts`, `src/lib/tickets/list-filters.ts` and `list-query.ts`, `src/lib/tickets/snooze.ts`.
13. Documented limitations: no merge chains; one parent per child; tags, assignee and custom fields stay on the source; merging across customers is refused.
14. The ticket top bar uses `border-border`, not the DS `border-border/70` (pre-existing since v1, not changed by Phase 12).
15. Baseline debt not made worse: audit 7 critical and 52 high; the Windows-only `taskkill` teardown; honesty-invariants flakes (2/2 this run, not claimed fixed); the NFT build warning; the 1 `uat-gaps` skip.
16. The 12-10 SUMMARY's "createdAt is the transaction start time" is wrong. 12-GATE.md and this SUMMARY correct it; the 12-10 file was not edited.

## Requirement status from this gate (the orchestrator updates REQUIREMENTS.md)

- AIDA-52: evidence present, not blocked.
- AIDA-53: partly proven. Everything except the literal "full `AuditEvent`" (12-o1).
- AIDA-54: evidence present, not blocked.
- AIDA-55: evidence present, not blocked. Merge and assignment feed rows are covered by the unit copy table, not by their own E2E case.

## Known Stubs

None. The README row and 12-GATE.md describe shipped behaviour only.

## Threat model dispositions

- T-12-38: every gate row names its commit, command, exit code and counts, and the red attempt 1 is recorded.
- T-12-39: neither egress-driven suite ran, and the `aida-egress-test` listings were empty before and after each attempt.
- T-12-40: visual, dark-mode, screen-reader and backstop items are all left open.

## Self-Check: PASSED

Commits 4ddc430, 65d4b7e, 7c3bad3 and 35c3917 exist; README.md, 12-GATE.md and both edited test files exist; no commit of this plan deletes a file.
