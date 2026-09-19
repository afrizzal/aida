---
phase: 12-ticket-lifecycle
plan: 01
subsystem: database, tickets, test-support
status: complete
tags: [prisma, migration, relations, merge, snooze, provenance, testcontainers]
requires: []
provides:
  - "Migration 20261109100000_ticket_lifecycle: TicketRelation, Ticket.snoozedUntil/mergedIntoTicketId/mergedAt/mergeMessageSeq, Message.mergedFromTicketId/seq, six TicketAuditAction values"
  - "src/lib/tickets/relation-pairs.ts (RELATION_TYPES, relationLabel, relationSideFor, LINK_CHOICES, DEFAULT_LINK_CHOICE, RELATION_LABEL_ORDER, sortRelationChips, orderedPair)"
  - "src/lib/tickets/status-visibility.ts (statusMessageWhere, isMessageVisibleForToken)"
  - "tests/support/lifecycle-fixtures.ts (seedContactTicket, seedMessage, seedRelation; re-exports seedOrgWithMembers, seedTicket)"
affects: [12-02, 12-03, 12-04, 12-05, 12-06, 12-07, 12-08, 12-09, 12-10]
tech-stack:
  added: []
  patterns:
    - "Unique expression index on an unordered pair (LEAST/GREATEST)"
    - "BIGSERIAL insert sequence as a provenance marker instead of timestamps"
    - "Hand-written object definitions pinned by pg_get_expr / indexdef equality tests"
key-files:
  created:
    - prisma/migrations/20261109100000_ticket_lifecycle/migration.sql
    - src/lib/tickets/relation-pairs.ts
    - src/lib/tickets/status-visibility.ts
    - tests/support/lifecycle-fixtures.ts
    - tests/integration/lifecycle-schema.test.ts
    - tests/unit/lifecycle-helpers.test.ts
  modified:
    - prisma/schema.prisma
    - src/lib/scoped-db.ts
decisions:
  - "Message.seq uses @default(autoincrement()) (BIGSERIAL form); prisma validate accepted it, so no hand-made sequence was needed. pg_get_serial_sequence('\"Message\"', 'seq') resolves to public.\"Message_seq_seq\""
  - "Second CHILD_OF guard chosen (Claude's discretion): partial unique index TicketRelation_one_parent_key"
  - "Both helpers refuse a half-merged ticket (mergedIntoTicketId set, mergeMessageSeq null) by throwing, rather than guessing; the CHECK makes it unreachable"
metrics:
  duration: "~10 min"
  completed: 2026-11-08
actuals:
  tokens: 13400
  tasks: 3
  commits: 4
plan_head_before: 03145e6c72f5038cae700cd7fe6f17aa14893b2e
---

# Phase 12 Plan 01: Ticket lifecycle data foundation Summary

One hand-edited migration adds relations, merge and snooze columns, a database-drawn `Message.seq` with its `Ticket.mergeMessageSeq` marker, and six audit actions; the pair, one-parent, self-link and merge-field rules live in the database. A seq-based status-token predicate and a relation label helper are proven against a unit matrix and real rows, with unmocked isolation and hand-written-object proofs.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Schema and one migration, proven through a relation row | a75c12a | validate 0, typecheck 0, integration 4/4 |
| 2 | Relation pair/label helper and provenance predicate | 711b7de | unit 18/18, typecheck 0, integration 5/5 |
| 3 | Isolation, append-only and hand-written-object proofs | 7f8b903 | integration 16/16 |
| - | Biome format of Task 2 files (formatting only) | 444d89c | lint 0 on all plan files; unit 18/18, typecheck 0, integration 16/16 re-run after |

Tracer gate: Task 1's verify passed end to end before Task 2 began.

## Migration evidence (D-19)

- Fresh database `aida_p12_lifecycle`, created with `createdb` inside the running `aida-dev-db` container (127.0.0.1:55432). The password was read from the container at command time; no credential appears in any tracked file.
- `prisma migrate dev --create-only --name ticket_lifecycle` generated `20261108141213_ticket_lifecycle`, renamed to `20261109100000_ticket_lifecycle` and edited by hand. Removed generated statements (recorded in the migration header): `DROP INDEX "Message_searchVector_idx"`, `DROP INDEX "Ticket_searchVector_idx"`, `DROP COLUMN "searchVector"` on `Message` and on `Ticket`. Appended: `TicketRelation_pair_key`, `TicketRelation_no_self_check`, `TicketRelation_one_parent_key`, `Ticket_merge_fields_check`. Nothing uses a new enum value.
- The searchVector expressions and GIN indexdefs were captured before deploy and pasted into the Task 3 test as constants.
- `prisma migrate deploy`: exit 0. `prisma migrate status`: exit 0, "9 migrations found in prisma/migrations / Database schema is up to date!"
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`: exit 0, output only the pre-existing drift 11-01 recorded:

  ```sql
  DROP INDEX "Message_searchVector_idx";
  DROP INDEX "Ticket_searchVector_idx";
  ALTER TABLE "Message" DROP COLUMN "searchVector";
  ALTER TABLE "Ticket" DROP COLUMN "searchVector";
  ```
- `prisma generate`: exit 0. `prisma db push` was not used; the env file is unchanged (not in `git diff --name-only 03145e6..HEAD`); no container was created, started, stopped or removed.

## Verification commands (exit codes)

- `pnpm prisma validate`: 0
- `pnpm typecheck`: 0 (after each task)
- `pnpm exec vitest run tests/unit/lifecycle-helpers.test.ts`: 0, 18 passed
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/lifecycle-schema.test.ts`: 0, 16 passed
- `pnpm exec biome check` on the eight plan files: 0
- `pgrep -f 'artisan test'` found nothing before each Testcontainers run. The full `pnpm test:integration` and `pnpm test:egress` were not run (orchestrator rule; O-1).

## Deviations from Plan

1. **[Rule 3 - Blocking] seedContactTicket calls createTicket directly.** 11-01's `seedTicket` takes no contact email, and inbox-fixtures is outside this plan's files, so `seedContactTicket` follows the same `createTicket` path with the given email. The fixture file re-exports `seedOrgWithMembers` and `seedTicket`. Commit a75c12a.
2. **[Rule 1 - Lint] Biome findings fixed:** `String.raw` on the four captured constants replaced by plain template literals (the strings hold no backslash), one unused binding removed, Task 2 files formatted (commit 444d89c).
3. Small additions: both helpers throw on a half-merged ticket; the schema test also asserts `TicketRelation_pair_key`/`one_parent_key`/`no_self_check`/`merge_fields_check` exist; the seq case also inserts through raw SQL with seq omitted.

## Threat model dispositions

- T-12-01 to T-12-04: mitigated as planned (DOMAIN_MODELS entry and unmocked isolation cases; one predicate with unit and real-row agreement; trigger proven for all six actions; pg_trigger, pg_get_expr and indexdef equality, UPDATE/DELETE rejected on both audit tables).
- **T-12-05 (accepted):** `onDelete: Restrict` on `mergedIntoTicketId` blocks hard-deleting a merge target. No hard delete is the rule (D-08) and AIDA has no ticket delete feature. Recorded, not solved.

## Open items

- D-01/AIDA-43: unchanged by this plan; later Phase 12 plans add the membership checks to their new paths.
- D-02 readers: none added here (no status reader in this plan).

## TDD Gate Compliance

Task 2 RED: `tests/unit/lifecycle-helpers.test.ts` failed with "Cannot find module '../../src/lib/tickets/relation-pairs'" before the helpers existed; GREEN: 18 passed. RED and GREEN were committed together in 711b7de (one commit per task). Task 3 adds proofs over schema built in Task 1, so it has no separate RED stage.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: all 6 created and 2 modified files
- FOUND commits: a75c12a, 711b7de, 7f8b903, 444d89c
