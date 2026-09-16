---
phase: 11-inbox
plan: 03
subsystem: saved-views, tickets, api
status: complete
tags: [saved-views, permissions, row-locks, palette, search, membership, testcontainers, concurrency]
requires:
  - "11-01: SavedView model with partial unique name indexes, list-filters grammar, findActiveMembership, getSessionActor, lock-wait helpers, inbox fixtures"
provides:
  - "createSavedView(client, actor, input, hooks?), updateSavedView(client, actor, id, input, hooks?), deleteSavedView(client, actor, id, hooks?) in src/lib/saved-views/service.ts, returning { ok: true, id, href? } or { ok: false, error }"
  - "listSavedViewsForViewer(client, actor) -> { private, shared } of { id, name, visibility, href }; throws SavedViewError MEMBERSHIP_ENDED"
  - "getSavedViewForPanel(client, actor, svId, urlFilters) -> { status: not_available } | { status: ok, view, state, missing }; throws SavedViewError MEMBERSHIP_ENDED"
  - "SavedViewError codes INVALID_NAME, INVALID_FILTERS, DUPLICATE_PRIVATE_NAME, DUPLICATE_SHARED_NAME, MISSING_REFERENCE, NOT_ALLOWED, NOT_FOUND, MEMBERSHIP_ENDED"
  - "createSavedViewAction, updateSavedViewAction, deleteSavedViewAction in src/app/(app)/tickets/saved-view-actions.ts"
  - "searchTicketsForPalette(client, actor, rawQuery, deps?) in src/lib/tickets/palette-search.ts"
  - "GET /api/palette/tickets?q= -> 200 { results }, 401, 403 { error: no_workspace | membership_ended }"
affects: [11-05, 11-07, 11-08]
tech-stack:
  added: []
  patterns:
    - "Write paths in one interactive transaction with test seams onTransactionStart and beforeCommit; a hook error is rethrown unchanged"
    - "Permission decided from a row locked with SELECT … FOR UPDATE, never from an earlier read"
    - "Unique violations mapped from the rejected transaction to DUPLICATE_*_NAME by the visibility being written"
    - "Forced-order proofs through a shared forcedOrder helper: second call's recorded PID observed blocked by the first before release"
key-files:
  created:
    - src/lib/saved-views/service.ts
    - src/app/(app)/tickets/saved-view-actions.ts
    - tests/integration/saved-views.test.ts
    - src/lib/tickets/palette-search.ts
    - src/app/api/palette/tickets/route.ts
    - tests/integration/palette-search.test.ts
  modified: []
decisions:
  - "The two read functions (listSavedViewsForViewer, getSavedViewForPanel) THROW SavedViewError MEMBERSHIP_ENDED instead of returning it, so their result shapes stay exactly what 11-05 and 11-07 expect ({ private, shared } and not_available | ok); 11-05's layout already wraps the list call in try/catch"
  - "Stored filters keep the caller's status order (11-01 toStoredFilters); the href and filtersEqual use enum order, so applied/changed is order-insensitive"
  - "An invalid visibility value is refused with INVALID_FILTERS (the plan's code list has no separate code for it)"
  - "A view whose stored filters fail parseStoredFilters is left out of the lists and is not_available in the panel; only its id is logged"
  - "searchTicketsForPalette takes an optional deps.search (default: the real searchTickets with limit 10); tests pass a recorder that calls the real function, to prove no query under 2 characters and the 200-character cut"
  - "The route reads the session with auth.api.getSession({ headers: request.headers }) and sends Cache-Control: no-store"
metrics:
  duration: "~7 min"
  completed: 2026-11-08
actuals:
  tokens: 15100
  tasks: 3
  commits: 3
plan_head_before: ccf51e54d52182734223c3cf0b03af7d1c0f283c
---

# Phase 11 Plan 03: Saved-views service and palette ticket search Summary

The saved-views service decides every permission on the server. Edits and deletes lock the view row with `SELECT … FOR UPDATE`, and permission and visibility are decided from that locked row, so a view made private meanwhile is `NOT_FOUND` to everyone but its owner. The partial unique indexes, not a pre-check, settle duplicate names. The palette has a session- and membership-checked ticket search endpoint that returns at most 10 of the organization's tickets. Everything is proven on Testcontainers without mocks, including six forced-order races with recorded PIDs.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | A shared view created by one member is listed for another | 14782e7 | typecheck 0; 4/4 integration cases |
| 2 | Edit, delete, open, permissions, references, idempotency and concurrency | 1287dc4 | typecheck 0; lint 0; 24/24 integration cases |
| 3 | Membership-checked palette ticket search endpoint | ae338c5 | typecheck 0; lint 0; 5/5 integration cases |

Tracer feedback gate: Task 1's `<verify>` (typecheck plus `saved-views.test.ts`) was green right before its commit, and expansion began only after that. Auto-advance is off, the human-verify mode is end-of-phase, and the verify step is fully automated, so no checkpoint was raised.

## Concurrency evidence (Task 2)

From `pnpm test:integration tests/integration/saved-views.test.ts --reporter=verbose --silent=false`. In each case the second call started only after the first call's `beforeCommit` hook had signalled. Both PIDs were recorded inside each call's own `onTransactionStart`. The first call was released only after `waitForBlockedBy(prisma, pid1, [pid2])` resolved.

- **Shared-name create race, first commits:** the second (pid 231) was observed blocked by the first (pid 232) after 5 ms. M1 returned ok, M2 returned `DUPLICATE_SHARED_NAME`, and exactly one view remains: "Escalations", owned by M1.
- **Shared-name create race, first rolls back:** observed blocked after 53 ms. M1 rejected with its exact sentinel (`rejects.toBe`), M2 returned ok, and exactly one view remains: "escalations" (trimmed), owned by M2.
- **Concurrent edit race, first commits:** observed blocked after 54 ms. Both calls returned ok. The row holds "Escalations B" with `[PENDING]`, which is the second call's complete payload.
- **Concurrent edit race, first rolls back:** observed blocked after 54 ms. O rejected with its sentinel, A returned ok, and the row holds "Escalations B" with `[PENDING]`.
- **C7, owner first:** the admin's edit (pid 231) was observed blocked by the owner's change to PRIVATE (pid 232) after 52 ms. The owner's call returned ok and the admin's returned `NOT_FOUND`. The row is PRIVATE with the owner's name and filters, at position 1 (O's next private position).
- **C7, admin first:** the owner's change (pid 232) was observed blocked by the admin's rename (pid 231) after 54 ms. Both calls returned ok. The row is PRIVATE with the owner's name and filters, at position 1.

## Verification commands (exit codes)

- `pnpm typecheck`: 0 (after every task)
- `pnpm lint`: 0 (296 files)
- `pnpm test` (unit suite): 0, 19 files and 152 tests
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/saved-views.test.ts`: 0, 24 passed (the final run came after formatting)
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/palette-search.test.ts`: 0, 5 passed
- `pgrep -f 'artisan test'` found nothing before each Testcontainers run.
- `git diff --stat -- src/proxy.ts` is empty. No migration, no package change, no `.env` edit.
- The full `pnpm test:integration` and `pnpm test:egress` were not run (orchestrator rule; O-1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test expectation] Stored status order**
- **Found during:** Task 2, GREEN run
- **Issue:** One panel case expected the stored filters in enum order. 11-01's `toStoredFilters` keeps the caller's order.
- **Fix:** Corrected the test expectation. The href and `filtersEqual` already use enum order, so `applied` vs `changed` does not depend on order. The service was not changed.
- **Commit:** 1287dc4

**2. [Rule 3 - Acceptance] Literal `searchTickets(` call**
- **Found during:** Task 3 acceptance greps
- **Issue:** The test-observable `deps.search` defaulted to a bare reference to `searchTickets`, so `grep -c "searchTickets("` printed 0.
- **Fix:** The default dependency now calls `searchTickets(orgId, queryText, limit)` with limit `PALETTE_RESULT_LIMIT` (10). Behavior is unchanged.
- **Commit:** ae338c5

### Shape choices inside the plan's scope

- `deleteSavedView` accepts the same optional hooks as update, because the two share one internal step (`lockViewForWrite`). No test needs them yet.
- `getSavedViewForPanel` also returns `not_available` for another organization's shared view (tested).
- `isAdminRole` also accepts a comma-separated Better Auth role string such as "admin,member".
- The idempotency truth was tested in both groups: a SHARED duplicate gives `DUPLICATE_SHARED_NAME`, a PRIVATE duplicate gives `DUPLICATE_PRIVATE_NAME`, and the rows are unchanged after the refused second call.

## Threat model dispositions

- T-11-12: mitigated. Another member's private view gives `NOT_FOUND` on update and delete and `not_available` in the panel, identical to an unknown id. It never appears in a list (tested).
- T-11-13: mitigated. Every read and write carries an explicit `organizationId` predicate. A cross-organization case covers lists, the panel and membership.
- T-11-14: mitigated. A plain member gets `NOT_ALLOWED` on a shared view, and an admin or owner gets `NOT_ALLOWED` when changing visibility (tested).
- T-11-45: mitigated. Both orders are forced with PID-specific waits (C7 evidence above).
- T-11-15: mitigated. Another organization's ticket with the same word is never returned, and the membership check runs first.
- T-11-16: mitigated. Filters go through the zod grammar, and over-long q, unknown keys and duplicate statuses are refused (tested). Search text reaches only the parameterised SQL in `searchTickets` and is cut to 200 characters.
- T-11-17: carried to 11-05 (the save-dialog warning), as planned.
- Privacy prohibition (AIDA-47): no list, panel result or error code reveals another member's private view. Log lines carry only view ids.

## Open items

- 11-05 must handle the read functions' thrown `SavedViewError("MEMBERSHIP_ENDED")`. In the layout this happens through its planned try/catch. In `ticket-list-panel.tsx`, an uncaught throw would reach the error boundary for a removed member.
- `getScopedDb` and the older actions still do not check membership (D-01). AIDA-43 stays open (O-3).
- No UI was built in this plan, so no visual check is claimed.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/saved-views/service.ts, src/app/(app)/tickets/saved-view-actions.ts, tests/integration/saved-views.test.ts, src/lib/tickets/palette-search.ts, src/app/api/palette/tickets/route.ts, tests/integration/palette-search.test.ts
- FOUND commits: 14782e7, 1287dc4, ae338c5
