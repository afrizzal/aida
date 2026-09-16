---
phase: 11-inbox
plan: 01
subsystem: database, tickets, test-support
status: complete
tags: [prisma, migration, saved-views, ticket-audit, membership, zod, testcontainers, concurrency]
requires: []
provides:
  - "SavedView and TicketAuditEvent models, enums, migration 20261108140000_inbox"
  - "recordTicketAudit(tx, orgId, entry) in src/lib/tickets/ticket-audit.ts"
  - "findActiveMembership(client, userId, orgId) in src/lib/membership.ts"
  - "getSessionActor() in src/lib/session.ts"
  - "src/lib/tickets/list-filters.ts (one filter grammar, MAX_LIST_LIMIT 500)"
  - "parseAutoCloseDays(raw), MAX_AUTO_CLOSE_DAYS in src/lib/tickets/auto-close-days.ts"
  - "tests/support/lock-wait.ts (deferred, backendPid, waitForBlockedBy)"
  - "tests/support/inbox-fixtures.ts (seedOrgWithMembers, seedTicket)"
affects: [11-02, 11-03, 11-04, 11-05, 11-06, 11-07, 11-08]
tech-stack:
  added: []
  patterns:
    - "Hand-written partial unique expression indexes and CHECK constraints in a Prisma migration"
    - "Append-only trigger per audit table"
    - "Structurally typed client parameters so global, scoped and transaction clients all fit"
    - "Forced-order race proofs on recorded backend PIDs via pg_blocking_pids"
key-files:
  created:
    - prisma/migrations/20261108140000_inbox/migration.sql
    - src/lib/tickets/ticket-audit.ts
    - src/lib/membership.ts
    - src/lib/tickets/list-filters.ts
    - src/lib/tickets/auto-close-days.ts
    - tests/support/lock-wait.ts
    - tests/support/inbox-fixtures.ts
    - tests/integration/inbox-schema.test.ts
    - tests/unit/inbox-parsers.test.ts
  modified:
    - prisma/schema.prisma
    - src/lib/scoped-db.ts
    - src/lib/session.ts
    - src/lib/tickets/list-query.ts
    - src/app/(app)/tickets/ticket-list-panel.tsx
decisions:
  - "Migration 20261108140000_inbox keeps the hand-written searchVector FTS columns: the generated DROP statements for them were removed by hand (they are invisible to Prisma)"
  - "list-filters schemas are strict objects: unknown keys, including a stored limit, are refused; parseStoredFilters returns null for them"
  - "parseUrlFilters drops a tag id or cf definition id longer than 64 characters instead of failing the whole parse"
metrics:
  duration: "~9 min"
  completed: 2026-11-08
actuals:
  tokens: 14400
  tasks: 3
  commits: 3
plan_head_before: 1e5c0f33d1c8e5bd54df43c2b829fa66cbcb0285
---

# Phase 11 Plan 01: Inbox data and parsing foundation Summary

SavedView and append-only TicketAuditEvent arrive through one hand-edited migration, with case-insensitive partial unique name indexes proven under a forced-order race. The plan also adds the membership helper, the session actor, PID-based lock-wait test support, one zod filter grammar with a 500-row limit cap, and a strict auto-close days parser.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Schema and one migration, proven through recordTicketAudit | eb92d01 | validate, typecheck, 4/4 integration cases green |
| 2 | Membership helper, session actor, race support, isolation and uniqueness proofs | b4a1b67 | typecheck, 21/21 integration cases green |
| 3 | One filter schema, limit cap, auto-close days parser | c7290bf | 62/62 unit cases, typecheck and lint green |

The tracer feedback gate re-ran Task 1's `<verify>` before Task 2 began. It passed.

## Migration evidence (D-21)

- Fresh database `aida_p11_inbox`, created with `createdb` inside the running `aida-dev-db` container (127.0.0.1:55432). Credentials came from the container environment at command time and appear in no tracked file.
- `prisma migrate dev --create-only --name inbox` generated the folder, which was then renamed to `20261108140000_inbox` and edited by hand. `prisma migrate deploy` applied it with exit 0.
- `prisma migrate status` exited 0 and printed "8 migrations found in prisma/migrations / Database schema is up to date!"
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` exited 0. Its output:

  ```sql
  -- DropIndex
  DROP INDEX "Message_searchVector_idx";
  -- DropIndex
  DROP INDEX "Ticket_searchVector_idx";
  -- AlterTable
  ALTER TABLE "Message" DROP COLUMN "searchVector";
  -- AlterTable
  ALTER TABLE "Ticket" DROP COLUMN "searchVector";
  ```

  This is pre-existing drift from the hand-written FTS migration `20260701234808_ticket_search`, which the schema does not model. It is not caused by this migration. Prisma reported nothing for the new partial unique indexes or CHECK constraints, because it does not introspect them. The schema comments above SavedView and TicketAuditEvent still name them, so a future generated migration is reviewed for them.
- `prisma db push` was not used, `.env` was not touched, and no container was created, started, stopped or removed.

## Verification commands (exit codes)

- `pnpm prisma validate`: 0
- `pnpm typecheck`: 0 (after each task)
- `pnpm lint`: 0 (290 files)
- `pnpm exec vitest run tests/unit/inbox-parsers.test.ts`: 0, 62 passed
- `pnpm test` (whole unit suite): 0, 19 files and 152 tests passed
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/inbox-schema.test.ts`: 0, 21 passed. The three lock-wait timeout cases took 540 ms, 564 ms and 1101 ms, so they really did wait for their 500 ms timeouts. Both shared-name race cases observed `pidT2` blocked by `pidT1` before releasing T1.
- `pgrep -f 'artisan test'` found nothing before each Testcontainers run.
- The full `pnpm test:integration` and `pnpm test:egress` were not run (orchestrator rule; O-1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Generated migration dropped the FTS columns**
- **Found during:** Task 1
- **Issue:** `migrate dev --create-only` emitted `DROP INDEX` / `DROP COLUMN` for `Ticket.searchVector` and `Message.searchVector`. Those columns and their GIN indexes are hand-written and power `searchTickets`; applying the drops would have broken search.
- **Fix:** Removed the four statements. A header comment in migration.sql records the edit.
- **Files modified:** prisma/migrations/20261108140000_inbox/migration.sql
- **Commit:** eb92d01

**2. [Rule 3 - Blocking] `prisma format` reformatted unrelated models**
- **Found during:** Task 1
- **Issue:** The formatter re-aligned the whole schema, a large diff outside this plan's scope.
- **Fix:** Restored the file and re-applied only the Phase 11 additions, aligned by hand. `prisma validate` passes.
- **Commit:** eb92d01

### Small additions inside the plan's scope

- `seedOrgWithMembers` returns `memberId` with each user, in addition to `{ id, role }`. The membership test needs it to delete the member row.
- `parseUrlFilters` also accepts a `URLSearchParams`-like object (`get(name)`), so later plans can pass `useSearchParams()` directly.
- `filtersEqual` and `hasAnyFilter` compare through the canonical `filtersToSearchParams` form. The behaviors match the spec: status order, `limit`, an empty `q` and an empty `statuses` list are ignored.
- `parseAutoCloseDays` also refuses `NaN`, `undefined`, objects, `"0366"`, `"1 2"`, full-width digits and very long digit strings.
- The Load-more href is clamped to `MAX_LIST_LIMIT`, so a limit of 470 links to 500, not 520.

## Threat model dispositions

- T-11-01 to T-11-05: mitigated as planned. Isolation tests cover both models; the trigger rejects UPDATE and DELETE (Prisma and raw SQL); the actor CHECK constraint is proven; the limit clamp is proven; snapshots are typed as flat `string | boolean | null` records.
- T-11-06 (accepted): the append-only trigger blocks deleting an organization that has TicketAuditEvent rows. This is the same consequence as AuditEvent. AIDA has no organization deletion today (D-07). It is recorded here, not solved.

## Open items (D-01)

- Only the new Phase 11 server paths will check membership through `findActiveMembership`. Older pages and actions, including `getScopedDb` itself, still lack the check. **AIDA-43 stays open** until parked Phase 10 returns (owner item O-3).
- The Load-more cap line is UI copy from UI-SPEC. It has not been visually checked by a human, and no visual pass is claimed.

## TDD Gate Compliance

Task 3 RED: before the implementation existed, `tests/unit/inbox-parsers.test.ts` failed with "Cannot find package '@/lib/tickets/auto-close-days'". GREEN: 62 passed after implementation. RED and GREEN were committed together in c7290bf, as the plan's one-commit-per-task rule requires. Task 2's tests target helpers written in the same task; the lock-wait negative cases prove that each one waits for its full timeout.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: all 9 created files and 5 modified files listed above
- FOUND commits: eb92d01, b4a1b67, c7290bf
