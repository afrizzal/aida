---
phase: 12-ticket-lifecycle
plan: 10
subsystem: tickets, public-status (tests only)
status: complete
tags: [merge, provenance, races, relations, testcontainers, review-c1, review-c10]
requires: ["12-02", "12-03", "12-04"]
provides:
  - "tests/integration/merge-race-coverage.test.ts: 10 forced-order Testcontainers cases for review C1 (provenance) and C10 (two merges and a reply, the second mismatch, removal against merge)"
affects: []
tech-stack:
  added: []
  patterns:
    - "Exact audit tallies keyed by ticket, action and actor, compared against a pre-race snapshot plus the rows each completed write must add"
    - "One waiter per waitForBlockedBy, named against the holder pg_blocking_pids reports (review R2-1)"
key-files:
  created:
    - tests/integration/merge-race-coverage.test.ts
  modified: []
decisions:
  - "The audit check counts rows per (ticket, action, actor). The merge and the removal run as two different members, so the tally shows which of them wrote each RELATION_REMOVED row"
  - "2d compares the audit tally with the pre-race snapshot plus the merge's own three rows. It does not read the tally mid-race, between the merge commit and F's rollback, so no timing window is involved"
metrics:
  duration: "~10 min"
  completed: 2026-11-08
actuals:
  tokens: 9100
  tasks: 3
  commits: 3
plan_head_before: 422432b0504b57bd51b96d7ebddc8196ca7c87c5
---

# Phase 12 Plan 10: Merge race coverage (review C1, C10) Summary

This plan adds ten unmocked Testcontainers cases on recorded PIDs, all in one new test file. They cover three review C1 items: a reply whose transaction began before a merge (agent route and follow-up), and equal or skewed timestamps, each checked on the status page and the attachment route for both tokens. They also cover review C10: two merges into one target racing a reply (three orders), the forced second-mismatch 409 `TICKET_CHANGED`, and a relation removal racing the merge's link replacement (three orders). No product code changed. Every case passed against the behaviour that 12-02 to 12-04 shipped.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | C1: replies that began before a merge, equal timestamps | 2b4bcad | typecheck 0; integration 3/3; tracer gate re-run passed before Task 2 |
| 2 | C10: two merges and a reply (2a, 2b, 2c), second mismatch (2d) | 34e38b1 | typecheck 0; biome 0; integration 7/7 |
| 3 | C10: removal against the merge's link replacement (3a, 3b, 3c) | e293efa | typecheck 0; biome 0; integration 67/67 (3 files) |

## Verification (exit codes)

- `pnpm typecheck`: 0 after each task. `pnpm exec biome check tests/integration/merge-race-coverage.test.ts`: 0, with no warnings at the end.
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/merge-race-coverage.test.ts`: 0, 3 passed after Task 1 and 7 passed after Task 2.
- `… pnpm test:integration tests/integration/merge-race-coverage.test.ts tests/integration/ticket-relations.test.ts tests/integration/ticket-merge.test.ts`: 0, 67 passed (10 new, plus 21 relation and 36 merge cases).
- `pgrep -f 'artisan test'` found nothing before each Testcontainers run. Runs were one at a time, logs were written under `$TMPDIR`, and exit codes were read without a pipe. The full integration suite and `test:egress` were not run (O-1). No migration, schema, package or env file change.
- Acceptance greps: `waitForBlockedBy` 9; `waitForBlockedBy(prisma, fPid, [m1Pid])` 1; `waitForBlockedBy(prisma, m1Pid, [m2Pid])` 2; `waitForBlockedBy(prisma, m1Pid, [fPid])` 1; calls listing two waiter PIDs 0; `it(` 10. The file contains `mergeMessageSeq`, `loadStatusPageData`, `onResolveStart`, `UPLOADS_DIR`, `TICKET_CHANGED`, `afterRelock`, `40P01`, `removeRelation`, `ALREADY_REMOVED` and `MERGE_LINK`. No sleep, `setTimeout` or `allSettled`.

## Forced orders proven

In every race below, `waitForBlockedBy` saw the named waiter PID blocked by the named holder before the release. Every call fulfilled, or rejected with exactly its own sentinel, and none reported 40P01.

- **1a:** the agent reply is held in the messages route's `onTransactionStart`, and the merge is held in `beforeCommit`. After both are released, `waitForBlockedBy(prisma, mergePid, [rPid])` passes and the merge is released. R is stored once on T, with `mergedFromTicketId` null and `seq` greater than `S.mergeMessageSeq`. **R.createdAt is earlier than S.mergedAt.** That assertion passed, so `createdAt` is the transaction start time and no deviation is needed. Both pages list R and the route serves aR for both tokens. a1 is served only for S's token and a2 only for T's token.
- **1b:** the follow-up through S's token is held in `onResolveStart`, then the merge is held. F is observed blocked by the merge. F lands once on T through the savepoint relock, with seq above the marker and createdAt before mergedAt, and both tokens see it and its attachment.
- **1c:** pre-merge T messages are set to createdAt = mergedAt and to mergedAt + 1 s. S's page does not list them and its token gets 404 for their attachments, while T's token lists and downloads them. A post-merge T message set to mergedAt − 1 min is listed and served for both tokens.
- **2a:** F through T's token holds T's row in `afterResolve`. `waitForBlockedBy(prisma, fPid, [m1Pid])`, then the second merge starts, then `waitForBlockedBy(prisma, m1Pid, [m2Pid])`. F has seq below both markers, so only T's token sees F. Every S1 and S2 message is on T with its own provenance. Both sources are CLOSED into T. The exact tally is one MERGED_INTO and one STATUS_CHANGED on each source, and two MERGED_FROM on T.
- **2b:** the first merge holds S1 and T. `waitForBlockedBy(prisma, m1Pid, [m2Pid])`, then F through S1's token, then `waitForBlockedBy(prisma, m1Pid, [fPid])`. F is stored once on T with null provenance, and S1's and T's tokens see it. S2's token sees it exactly when `F.seq > S2.mergeMessageSeq`, computed from the stored values.
- **2c:** as 2b, then the first merge throws its sentinel after the release and rejects with exactly that error. S1 is equal to its pre-race row (unmerged, no marker), its messages stay on S1, and F lands on S1, where only S1's token sees it. The second merge is complete, the only link is S2's DUPLICATE_OF, and the tally holds only the second merge's rows.
- **2d:** the merge is held, and F (two PDFs) through S's token is observed blocked by it. `afterRelock` sets S's `mergedIntoTicketId` to U inside F's transaction (it ran once). F answers 409 `{ error: "TICKET_CHANGED" }`. S still points at T. No marker message, no new message or attachment row, the audit tally is exactly the snapshot plus the merge's three rows, and the file count under UPLOADS_DIR is unchanged.
- **3a:** the merge is held after replacing R. removeRelation (the other member) is observed blocked by the merge and returns ALREADY_REMOVED. RELATION_REMOVED ×2 (`before.type` RELATED_TO) and RELATION_ADDED ×2 were all written by the merge's actor.
- **3b:** removeRelation is held in `beforeCommit`, and the merge is observed blocked by it. The removal returns ok, and the merge returns ok without a replacement. RELATION_REMOVED ×2 come from the remover, there is no RELATION_ADDED, and there is one MERGED_INTO and one MERGED_FROM.
- **3c:** as 3b, but the removal rejects with its sentinel. The merge replaces R, and all RELATION_REMOVED and RELATION_ADDED rows come from the merge's actor.
- 3a to 3c each end with exactly one DUPLICATE_OF. A final `removeRelation` on it returns MERGE_LINK and leaves the relations and the tally unchanged.

## Deviations from Plan

1. **Fixture status:** the plan context says that all fixture tickets are OPEN. `seedContactTicket` actually creates them as NEW. The 2c assertion compares S1 with its own pre-race row instead of a literal `OPEN`. The test checks the same thing; only the hard-coded status changed. No reopen or wake row is expected either way (neither NEW nor OPEN reopens).
2. **2b and 2c share one body** (`twoMergeRace(rollsBack)`), called from two named `it(` cases. 3a to 3c likewise share `removeAgainstMerge(order)`.
3. **Two members per organization:** each case seeds two admins, so the tally can tell the merge's audit rows from the removal's.

No product bug was found. No `fix(12-10)` commit was made.

## TDD Gate Compliance

This is a test-only plan. Tasks 2 and 3 are `tdd="true"`, and their behaviour already exists in 12-02 to 12-04, so every new case passed on its first full run. The only red run was the 2c fixture-status assumption in deviation 1, which was a test-side error.

## Known Stubs

None.

## Threat model dispositions

T-12-41 is mitigated by 1a to 1c and 2a to 2c, which check seq-based visibility on the page and the attachment route for every token. T-12-42 is mitigated by 2d (409 with no message, audit row or file). T-12-43 is mitigated by 3a to 3c (one DUPLICATE_OF and exact tallies). T-12-44 is mitigated by 2a to 2c (no rejection other than the sentinel, and no 40P01).

## Self-Check: PASSED

- FOUND: tests/integration/merge-race-coverage.test.ts.
- FOUND commits: 2b4bcad, 34e38b1, e293efa (`git rev-list --count 422432b..HEAD` = 3 before this SUMMARY).
