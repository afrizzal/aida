---
phase: 10-team
plan: 04
subsystem: notifications
status: complete
tags: [notifications, prisma, postgres, skip-locked, isolation, idempotency, testcontainers]
requires:
  - "10-01: Notification, NotificationPreference, NotificationSetting models (migration 20261115100000_team_foundation), DOMAIN_MODELS Phase 10 block"
provides:
  - "src/lib/notifications/types.ts: NOTIFICATION_TYPES, isNotificationType, NotificationItem, TICKET_ENTITY, NOTIFICATION_POLL_INTERVAL_MS"
  - "src/lib/notifications/emit.ts: emitNotifications(tx, orgId, items), emitForTicket(tx, orgId, event), FALLBACK_INSERT_CHUNK"
  - "src/lib/notifications/recipients.ts: unassignedFallbackRecipients(tx, orgId)"
  - "src/lib/notifications/store.ts: insertNotifications, countUnread, listRecent, markRead, markAllRead, archive, claimDigestCandidates, readDigestRows, stampDigested, listDigestPairs"
  - "src/lib/notifications/preferences.ts: getPreferences, setPreference, getUnassignedSetting, setUnassignedSetting, enabledInAppRecipients, unassignedEnabledRecipients"
affects: [10-06, 10-07, 10-09, 10-11, 10-14]
tech-stack:
  added: []
  patterns:
    - "Single access boundary for the Notification table (store.ts); emit.ts decides recipients only"
    - "createMany with skipDuplicates (ON CONFLICT DO NOTHING) inside the caller's transaction"
    - "Structural transaction-client interfaces (the TicketAuditTx shape) so global, scopedDb and transaction clients all fit"
key-files:
  created:
    - src/lib/notifications/types.ts
    - src/lib/notifications/emit.ts
    - src/lib/notifications/recipients.ts
    - src/lib/notifications/store.ts
    - src/lib/notifications/preferences.ts
    - tests/integration/notifications-core.test.ts
  modified: []
decisions:
  - "Transaction parameters are typed structurally, not as Prisma.TransactionClient, so a scopedDb transaction (the tracer case) and a global-client transaction (ticket mutations, SLA worker) both fit"
  - "Functions that run inside the caller's transaction write the organization term explicitly next to recipientUserId; scopedDb cannot wrap an existing transaction"
  - "Fallback rows follow only NotificationSetting.unassignedTickets, not the per-type in-app switch (flagged assumption of the plan, tested)"
  - "markAllRead returns the number of rows changed; markRead and archive return a boolean"
metrics:
  duration: "about 10 minutes (2026-11-12T20:09Z to 20:19Z)"
  completed: 2026-11-13
  tasks: 3
  files: 6
estimate:
  tokens: 65000
  tasks: 3
actuals:
  tokens: 16400
  tasks: 3
  commits: 4
commits: 4
plan_head_before: f933c2f555be4f2dacc110e119b0b25500f9bac7
---

# Phase 10 Plan 04: Notification core Summary

This plan adds the notification core for AIDA-44. Notifications are written inside the caller's transaction with `createMany` and `skipDuplicates`, so a retry or a race never stores a second row and never aborts the caller. Every read and update is scoped to the organization and the recipient. Unassigned tickets fall back to the organization's owners and admins (owner item 11 option b, V-28), and each person can opt out. Preferences have explicit defaults. All of it is proven in 28 unmocked Testcontainers cases.

## What was built

- **types.ts** has the five types in order, `isNotificationType`, the `NotificationItem` shape and `NOTIFICATION_POLL_INTERVAL_MS = 30_000` (V-19). The item shape has no organization field.
- **store.ts** is the single access boundary (D-15, C10).
  - `insertNotifications` writes `organizationId` from its parameter on every row. A stray `organizationId` on an item is ignored, and a test proves it.
  - `countUnread` and `listRecent` use `scopedDb(orgId)` and also filter `recipientUserId` and `archivedAt: null`. `listRecent` sorts by createdAt desc, then id desc, and caps the limit at 100. It resolves the ticket number and subject with one scoped ticket query. A missing ticket gives nulls.
  - `markRead`, `markAllRead` and `archive` use scoped `updateMany` filtered by id and recipient. Their conditions on `readAt: null` and `archivedAt: null` make each change happen once.
  - `claimDigestCandidates` is the only raw SQL. It takes the row lock and skips rows another transaction holds. All values are bound parameters, and the organization and recipient are explicit terms. With `includeFallback` false it leaves out fallback rows.
  - `readDigestRows` and `stampDigested` filter on organization, recipient and ids, plus the eligibility conditions.
  - `listDigestPairs` returns only `{ organizationId, recipientUserId }`. Its comment names it as the single D-15 exception and `digest.ts` (10-09) as its only caller.
- **emit.ts** decides who gets notified and holds no Notification-table query.
  - `emitNotifications` drops the actor, then recipients with no member row (one plain member read with an explicit organization term), then types that are off in-app (`enabledInAppRecipients`, one read per distinct type).
  - `emitForTicket` sends to the assignee when there is one. When there is none, it sends to every owner and admin from `unassignedFallbackRecipients`, minus the actor and minus anyone who opted out (`unassignedEnabledRecipients`, one NotificationSetting read). These rows are marked `unassignedFallback: true` and inserted in chunks of at most 500 in the same transaction. There is no cap and nothing is truncated.
- **recipients.ts**: `unassignedFallbackRecipients` reads member rows in id order with a plain read and takes no lock. It groups rows by user and keeps a user only if every row is `owner` or `admin`, using `isAdminRole` (the deciding-row rule, V-26).
- **preferences.ts**:
  - `getPreferences` returns all five types, defaulting to on.
  - `setPreference` is a scoped upsert on the `(organizationId, userId, type)` unique key. Fields left undefined keep their stored value.
  - `getUnassignedSetting` and `setUnassignedSetting` default to on when no row exists.
  - It also holds the two in-transaction reads that emit.ts uses.
- **Relative imports only.** None of the five modules contains `@/` or imports a framework (V-15, D-31).

## D-15 deviation (recorded per the Review Dispositions Ledger, Round 3)

The only raw SQL is `claimDigestCandidates`. A claim that locks rows and skips locked ones has no Prisma equivalent. It stays inside `store.ts`, with explicit organization and recipient terms and bound parameters. The insert is not raw; it uses `createMany` with `skipDuplicates`, which supersedes the Round 1 text. The functions that run inside the caller's transaction (insert, claim, `readDigestRows`, `stampDigested`) write the organization term explicitly, because that transaction may come from the unscoped global client (the worker). `listDigestPairs` is the one named cross-organization read.

## Fan-out duration

The test gives an unassigned ticket 60 admins and one owner. One `emitForTicket` call wrote 61 fallback rows in one transaction in **9.0 ms**, measured with `performance.now()` around the `prisma.$transaction` call. It was recorded from the verbose run (`[10-04 fan-out] 61 recipients, emitForTicket transaction 9.0 ms`) on the Testcontainers Postgres on this Mac.

## Verification

All Docker steps ran with run id `mwdza8xn-0b191ecba6cacfaf`. `colima status` exited 0 and `docker info` exited 0 (server 29.5.2) before every Docker step.

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` (Task 1) | 0 | clean |
| `pnpm test:integration tests/integration/notifications-core.test.ts` (Task 1, tracer) | 0 | 1 passed |
| same, Task 2 RED | 1 | no tests (module `preferences` missing): intended RED |
| `pnpm typecheck` (Task 2) | 0 | clean |
| same integration run, Task 2 GREEN | 0 | 16 passed |
| `pnpm typecheck` (Task 3) | 0 | clean |
| same integration run, Task 3 | 0 | 28 passed |
| same, `--silent=false --reporter=verbose` (fan-out duration) | 0 | 28 passed |
| `pnpm lint` | 0 | 709 files, 1 warning in `tests/unit/container-config.test.ts:160`, which this plan did not change |
| `pnpm test` (unit, includes the static inventory tests) | 0 | 104 files, 1834 passed |

The tracer gate passed: after Task 1, `<verify>` was re-run end to end before any expansion.

Acceptance greps:
- Task 1: `skipDuplicates` in store.ts is 3 (need at least 1). Notification-table matches in emit.ts: 0. `@/` in types, emit and store: 0 each. `NOTIFICATION_POLL_INTERVAL_MS` in types.ts: 1.
- Task 2: `recipientUserId` in store.ts is 42 (need at least 6). `SKIP LOCKED` in store.ts: 1. `unassignedFallback` in emit.ts: 5. `FOR (SHARE|UPDATE)` in recipients.ts: 0. `@/` in recipients.ts and preferences.ts: 0 each.
- Task 3: `vi.mock` in the test file: 0. `it(` count: 28. The single-boundary grep lists only `src/lib/notifications/store.ts` and `src/lib/scoped-db.ts`. The `listDigestPairs` grep lists only `src/lib/notifications/store.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Structural transaction types instead of `Prisma.TransactionClient`**
- **Found during:** Task 1 (`pnpm typecheck`, exit 2)
- **Issue:** The tracer case emits inside a `scopedDb(orgId).$transaction`. TypeScript does not accept that extended transaction client where `Prisma.TransactionClient` is expected.
- **Fix:** Each module declares the minimal structural client it uses (`NotificationInsertTx`, `EmitTx`, `EmitForTicketTx`, `RecipientsTx`, `PreferenceReadTx`, `DigestClaimTx`, `DigestRowsTx`, `DigestPairsClient`), following `TicketAuditTx` in `src/lib/tickets/ticket-audit.ts`. Global-client transactions also fit; the Task 2 and 3 cases use them.
- **Files modified:** src/lib/notifications/store.ts, emit.ts, recipients.ts, preferences.ts
- **Commit:** 9d2af95, c1a4434

### Other differences from the plan text

- The NotificationSetting opt-out read used by `emitForTicket` is `unassignedEnabledRecipients` in preferences.ts, not inline in emit.ts. It is still one query with an explicit organization term, and emit.ts holds no table query except the member read of `emitNotifications`.
- `emitNotifications` reads in-app preferences once per distinct type through `enabledInAppRecipients(tx, orgId, userIds, type)`, the signature the plan's artifact list gives. Every emitter planned so far sends one type per call, so in practice this is one query.
- `markAllRead` returns the number of rows changed; `markRead` and `archive` return a boolean. 10-11 can treat a count above 0 as "changed".
- `listRecent` clamps `limit` to between 1 and 100 so a caller cannot ask for unbounded reads. 10-11 asks for 20 or 21.
- Extra exports: `isNotificationType`, `TICKET_ENTITY`, `FALLBACK_INSERT_CHUNK`, `NotificationListItem`, `ClaimedNotification`, `DigestRow`, `DigestPair`.
- Task 3 cases pass on the Task 2 code. They are proofs of behaviour already built, so no separate RED commit was possible for them.

## Flagged assumptions (unchanged from the plan, both tested or documented)

- Fallback rows follow only the "Unassigned tickets" switch, not the per-type in-app switch. The case "fallback rows follow only the unassigned switch…" pins this. If the owner wants both to apply, one condition changes in `emitForTicket`.
- Fallback recipients are a snapshot read after the caller's locks. A recipient deactivated before commit may get a row. The bell (10-11) and the digest re-check (10-09) must not show or send it.

## Owner items and defaults used

- Owner item 11 option b, through V-28.
- O-7 default (a): new tickets notify nobody. This plan adds no emitter.
- O-7 default (b): an assignee who is no longer a member gets nothing, and the fallback does not apply. Tested in "a recipient whose member row was deleted gets nothing".
- O-9: REQUIREMENTS.md was not edited. Requirements AIDA-44, AIDA-46 and AIDA-43 were not marked complete; that is the orchestrator's job.

## Manual items (open)

- None for this plan. It has no UI.

## Known Stubs

None.

## Threat Flags

None. No network endpoint, auth path or file access was added. The new surface is the module boundary that the plan's threat register covers: T-10-14, T-10-15, T-10-16, T-10-16b, and T-10-16c (accepted, measured at 9.0 ms for 61 rows).

## Self-Check: PASSED

- FOUND: src/lib/notifications/types.ts, emit.ts, recipients.ts, store.ts, preferences.ts; tests/integration/notifications-core.test.ts
- FOUND commits: 9d2af95, 3caa8c6, c1a4434, 2da0a60
