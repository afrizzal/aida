---
phase: 09-operations
plan: 04
subsystem: storage
tags: [postgres, advisory-lock, backup-fence, file-cleanup, uploads, testcontainers]

requires:
  - phase: 14-projects-foundation
    provides: "ProjectFileCleanup queue, enqueueFileCleanupInTx, sweepProjectFileCleanup, the worker job and the uploads mount (K66, K68)"
provides:
  - "src/lib/storage/file-fence.ts: FILE_FENCE_KEY_TEXT, FILE_FENCE_KEY_SQL, BACKUP_LEASE_KEY, BACKUP_LEASE_ACTIVE_SQL, leaseValueActiveSql, parseLease, createDeleteFenceProvider, DeleteFence, DeleteFenceProvider, FenceRefusal, FenceRefusalReason, DELETE_FENCE_APPLICATION_NAME, BACKUP_FENCE_APPLICATION_NAME"
  - "src/lib/storage/uploads-volume.ts: UPLOADS_VOLUME_ID_KEY, UPLOADS_MARKER_NAME, isMountPoint, ensureUploadsVolumeIdentity, isUploadsVolumeVerified, RawSqlClient"
  - "sweepProjectFileCleanup: required option fence, optional result field skipped"
  - "localFileStorage.save with exclusive create (EEXIST); uploadsRoot()"
  - "saveStagedFiles never deletes the key of a save that failed with EEXIST"
  - "tests/support/file-fence-fixtures.ts: testUploadsDir, testVolumeIdentity, testFenceProvider, trackFence, fenceLocks, backendsNamed, deleteBackupLease, backupEmulator"
affects: [09-05 logo store (enqueue list in the static test), 09-06 backup side of the fence, 09-08 docs (local worker deletes nothing), 09-10 restore (writes the marker)]

actuals:
  tokens: 23262
  tasks: 3
  commits: 3
plan_head_before: ec268dc877dce09e2b1dda070211bb7cb9039105

tech-stack:
  added: []
  patterns:
    - "Two-signal backup fence: session-level advisory lock (shared for the deleter, exclusive for the backup) plus a committed lease row judged by the database clock"
    - "A fence handle tracks every storage.delete promise and releases the lock in the background only after all settled"
    - "Uploads volume identity: mount point plus marker equal to a SystemSetting row, established once with exclusive create, never repaired by the deleter"
    - "Failure injection in integration tests: a test-only marker table and BEFORE INSERT triggers, created in beforeAll and dropped in afterAll"

key-files:
  created:
    - src/lib/storage/file-fence.ts
    - src/lib/storage/uploads-volume.ts
    - tests/support/file-fence-fixtures.ts
    - tests/unit/file-fence.test.ts
    - tests/unit/file-delete-callers.test.ts
    - tests/integration/file-fence.test.ts
    - tests/integration/file-delete-inventory.test.ts
  modified:
    - src/lib/projects/file-cleanup.ts
    - src/lib/worker/jobs/project-file-cleanup.ts
    - src/lib/attachments/local-file-storage.ts
    - src/lib/attachments/staged-files.ts
    - tests/integration/project-file-cleanup.test.ts
    - tests/integration/project-comments-attachments.test.ts
    - tests/integration/project-delete.test.ts

key-decisions:
  - "The deleter checks the mount point first and writes no identity on a directory that is not a mount point, so a container started without the volume never stamps the identity"
  - "saveStagedFiles skips the key whose save failed with EEXIST: with exclusive-create saves that key holds another writer's file, possibly a committed one (Rule 2)"
  - "parseLease also requires a non-empty holder; the SQL lease check needs only an ISO expiresAt, so a lease without holder still fences (the safe direction)"
  - "The worker handler test keeps its deletion assertion by replacing only isMountPoint of the uploads volume module in that one file (vi.mock), because a temporary directory is never a mount point"

patterns-established:
  - "Every sweep caller passes a fence; tests use testFenceProvider(dir) on a testUploadsDir() directory and await trackFence(...).allClosed() when a delete may outlive the run"

requirements-completed: []
requirements-partial: [AIDA-33, AIDA-38]

coverage:
  - id: D1
    description: "While a backup holds the exclusive fence the sweep deletes nothing; after release the next run deletes (U-12 G1)"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/file-fence.test.ts#G1"
        status: pass
    human_judgment: false
  - id: D2
    description: "Dropped fence session with an unexpired lease, paused backup with an expired lease, I/O timeout, crash safety and select ordering (U-12 G2 to G6)"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/file-fence.test.ts#G2 dropped session"
        status: pass
      - kind: integration
        ref: "tests/integration/file-fence.test.ts#G3 paused backup"
        status: pass
      - kind: integration
        ref: "tests/integration/file-fence.test.ts#G4 I/O timeout"
        status: pass
      - kind: integration
        ref: "tests/integration/file-fence.test.ts#G5 crash"
        status: pass
      - kind: integration
        ref: "tests/integration/file-fence.test.ts#G6 ordering"
        status: pass
    human_judgment: false
  - id: D3
    description: "The sweep deletes only on a verified uploads volume (mount point plus marker equal to uploads:volume-id); identity established once, adopted after a crash, never repaired; ENOENT counts only inside a verified run"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/file-fence.test.ts#uploads volume identity (5 cases) and ENOENT inside a verified run only (2 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Storage keys are immutable: a second save of the same key rejects with EEXIST and keeps the first bytes (D-02(1))"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/file-fence.test.ts#EEXIST"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every FileStorage.delete caller is inventoried; each non-sweep caller leaves a committed row's file in place after an injected failure (U-13)"
    requirement: AIDA-38
    verification:
      - kind: unit
        ref: "tests/unit/file-delete-callers.test.ts"
        status: pass
      - kind: integration
        ref: "tests/integration/file-delete-inventory.test.ts (17 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The fence on the real uploads volume inside the compose stack (worker container, backup service of 09-06)"
    requirement: AIDA-33
    verification: []
    human_judgment: true
    rationale: "Not run (waiting for the Phase 8.1 harness and the owner, U-15); the backup side is plan 09-06"

duration: 22min
completed: 2026-11-12
status: complete
---

# Phase 9 Plan 04: Backup fence on the single deletion queue Summary

**Phase 14's `ProjectFileCleanup` sweep is now the one fenced deletion path. A run deletes a stored file only when four things hold: the uploads volume is verified (mount point plus marker equal to `uploads:volume-id`), it holds the shared side of a session-level advisory lock that a backup takes exclusively, and no unexpired `backup:lease` row exists by the database clock. It keeps that lock until every delete promise has settled, including one that already timed out. Saves use exclusive create, and every other delete caller is inventoried with after-commit failure tests.**

## Performance

- **Duration:** about 22 min (ledger start 2026-11-12T07:16:39Z, end 2026-11-12T07:38:14Z, before the SUMMARY)
- **Tasks:** 3 of 3
- **Files:** 7 created, 7 modified (14 in the plan diff)

## Accomplishments

- `file-fence.ts` implements the deleter steps of the fence contract: (1) volume check; (2) `pg_try_advisory_lock_shared(hashtextextended('aida:file-fence', 0))` on its own `pg` client (`application_name` `aida-delete-fence`), where false gives `backup-archiving`; (3) `BACKUP_LEASE_ACTIVE_SQL` on the same connection, where an active lease means unlock and `backup-lease`; (4) a connection error gives `fence-unavailable`. The handle's `close()` waits on `Promise.allSettled` over every tracked delete, then unlocks and ends the client. `closed` never rejects. A connection lost during a run logs one line.
- The lease check uses `IS JSON OBJECT` and `pg_input_is_valid(..., 'timestamptz')` behind `CASE` guards plus a strict ISO pattern, so a malformed value counts as no lease and never raises an error. `parseLease` also rejects calendar dates that `Date.parse` would roll over (2026-02-30).
- `sweepProjectFileCleanup` opens the fence before its transaction. A refusal returns zeros with `skipped`, logs one line and touches nothing. Each `storage.delete` promise is passed to `track()` before `withinBudget` races it. `close()` runs in a `finally` after the transaction. Row selection, retry, ENOENT and budget logic are unchanged.
- The worker handler builds the provider from `DATABASE_URL`, `uploadsRoot()` and `prisma`, with no mount-point override.
- `localFileStorage.save` writes with `flag: "wx"`.

## Task Commits

1. **Task 1 (tracer): fence provider, volume identity, fenced sweep, G1** - `3824a4a` (feat)
2. **Task 2: U-12 interleavings G2 to G6, volume identity and immutable keys** - `2ee59c3` (test)
3. **Task 3: U-13 inventory of every FileStorage.delete caller** - `c4124a9` (test; includes the `staged-files.ts` fix)

Tracer gate (interactive, `end-of-phase`, automated verify only): the Task 1 integration verify was green on the final Task 1 code before Task 2 started. That run is the exit 0, 12 passed row below.

## U-13 caller table

| Caller | File and line | When it deletes | Committed reference possible | Mechanism | Test |
|---|---|---|---|---|---|
| Queue sweep | `src/lib/projects/file-cleanup.ts:233` | scheduled every minute, rows due | yes (a key whose reference was removed in an earlier committed transaction) | fenced: volume check, shared fence lock, no unexpired lease, lock held until every delete settled | `file-fence.test.ts` G1 to G6, volume and ENOENT cases; referenced by name in `file-delete-inventory.test.ts` "queue sweep (the fenced path)" |
| Staged rollback, save failure | `src/lib/attachments/staged-files.ts:52` (`deleteEach`), called at `:85` | a save fails part-way | no: only keys this request wrote; the key of an EEXIST failure is skipped | best-effort delete of the attempted keys | "staged rollback": "a save that fails part-way deletes every attempted key…", "after commit: a save that collides (EEXIST)…" |
| Staged rollback, `discard()` | `staged-files.ts:52`, called at `:96` | the request ends without a committed row | no | delete once, never throws | "discard() deletes the saved keys once" |
| `removeStoredUploads`, public intake | `src/lib/attachments/validate-uploads.ts:83`, called at `src/app/api/public/intake/route.ts:121` | ticket creation or attachment insert fails inside the `try` | no: nothing after the `createMany` is inside the `try` | best-effort delete | "public intake": "a failure before the attachment insert commits…", "after commit: …leaves every referenced file in place" |
| `removeStoredUploads`, status follow-up (`discard`) | `validate-uploads.ts:83`, via `follow-up/route.ts:100`, called at `:150` (thrown error) and `:158` (refusal) | the transaction throws or refuses | no: both calls follow a transaction that did not commit | best-effort delete | "status follow-up": "a failure inside the transaction…", "after commit: …" |
| Ticket messages route (`staged.discard`) | `src/app/api/tickets/[id]/messages/route.ts:164` (throw), `:169` (refusal) | membership ended, merged source, ticket unavailable or a thrown error | no | `saveStagedFiles` discard | "ticket messages route": refusal (MEMBERSHIP_ENDED), thrown error, "after commit: …" |
| Project attachments (`staged.discard`) | `src/lib/projects/attachments.ts:293` (throw), `:296` (refusal) | archived task, refusal or a thrown error | no | `saveStagedFiles` discard | "project attachments": refusal (ARCHIVED), thrown error, "after commit: a committed attachment's file survives a later failed upload" |
| Attachment delete and task or project hard delete (enqueue, no unlink) | `src/lib/projects/attachments.ts:336`, `src/lib/projects/delete.ts:96` | never directly; they enqueue in the dereferencing transaction | n/a | `enqueueFileCleanupInTx` in the same transaction; the sweep deletes later | "task hard delete and attachment delete": both rollbacks leave the row, no queue row and the file; "after commit: …one queue row per key and every file in place" |

The static list (`tests/unit/file-delete-callers.test.ts`) asserts five things: FileStorage `delete` is called only in those three files, one site each; `unlink`, `rm` and `rmdir` appear only in `local-file-storage.ts`; `enqueueFileCleanupInTx` is called only from `attachments.ts` and `delete.ts` (plan 09-05 adds the logo store there); and no `organization.delete`, `organization.deleteMany`, `deleteOrganization`, `DELETE FROM organization` or `organization/delete` appears in `src/`.

**Stated limit, email ingest:** `src/lib/channels/email/ingest-message.ts:146` saves each attachment directly with `localFileStorage.save` and has no rollback. If ingest fails part-way, the files already saved stay on disk unreferenced. They cost disk only: under U-13, backup verification checks only the keys the dump references. With exclusive create, a key collision now makes the ingest throw instead of overwriting.

## Verification (exit codes read without a pipe)

All Docker runs used `AIDA_TEST_RUN_ID=mwd7mugx-c18cd572b3dd46e5`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, one process at a time.

| Command | Code state | Exit | Counts |
|---|---|---|---|
| `colima status` / `docker info` (before the first Docker step) | n/a | 0 / 0 | n/a |
| `pnpm exec vitest run tests/unit/file-fence.test.ts` | final | 0 | 1 file, 10 passed |
| same, RED: calendar check in `parseLease` disabled | mutated | 1 | 1 failed ("rejects an expiresAt that is not an ISO timestamp", 2026-02-30), 9 passed |
| same, after restore | final | 0 | 10 passed |
| `pnpm test:integration tests/integration/file-fence.test.ts`, RED: shared-lock result ignored | mutated | 1 | 1 failed (G1: `{deleted: 1}` under a held fence) |
| `pnpm test:integration tests/integration/file-fence.test.ts tests/integration/project-file-cleanup.test.ts` (Task 1 verify) | final Task 1 | 0 | 2 files, 12 passed |
| `pnpm test:integration tests/integration/project-comments-attachments.test.ts tests/integration/project-delete.test.ts` | final Task 1 | 0 | 2 files, 33 passed |
| `pnpm test` (full unit, before the Task 1 commit) | Task 1 | 0 | 81 files, 1464 passed |
| `pnpm test:integration tests/integration/file-fence.test.ts`, RED run A (8 mutations: lease check off, lock check off, no `track()`, `close()` right after the select, no marker comparison, mount check always true, no marker adoption, no `wx`) | mutated | 1 | 11 failed, 3 passed (G5, first run, ENOENT verified were not targeted) |
| same, RED run B (lease expiry ignored, identity not established) | mutated | 1 | 3 failed (G5, first run, adopted), 11 passed |
| `pnpm test:integration tests/integration/file-fence.test.ts` (Task 2 verify) | final | 0 | 1 file, 14 passed |
| same, repeated for stability | final | 0 | 14 passed |
| `pnpm exec vitest run tests/unit/file-delete-callers.test.ts` | final | 0 | 5 passed |
| same, RED: an extra `localFileStorage.delete` call temporarily added to `ingest-message.ts` | mutated | 1 | 1 failed (caller set gained `src/lib/channels/email/ingest-message.ts`), 4 passed |
| `pnpm test:integration tests/integration/file-delete-inventory.test.ts`, before the `staged-files.ts` fix | Task 3 tests, old `saveStagedFiles` | 1 | 1 failed (EEXIST collision: the committed file was deleted, `[]`), 16 passed |
| `pnpm exec vitest run tests/unit/staged-files.test.ts tests/unit/file-delete-callers.test.ts` | after the fix | 0 | 2 files, 12 passed |
| `pnpm test:integration` (full, once) | after the fix | 0 | 104 files, 1396 passed, 113 s |
| `pnpm exec tsc --noEmit` | after the full run | 2, then 0 | 1 error (`Buffer` as `BlobPart` in the inventory test), fixed with `new Uint8Array(png)` |
| `pnpm test:integration tests/integration/file-delete-inventory.test.ts` | final (after the type fix) | 0 | 1 file, 17 passed |
| `pnpm lint` | final | 0 | 628 files, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`, `noTemplateCurlyInString`) |
| `pnpm test` (full unit) | final | 0 | 82 files, 1469 passed |

Every mutation was made in place on a copy-backed file and restored with `cp` from the copy. `git diff --stat -- src` confirmed the restore before the next run. No `git stash` was used.

### Acceptance criteria

- Task 1: both `pg_try_advisory_lock_shared` and `pg_advisory_unlock_shared` match in `file-fence.ts`; `flag: "wx"` matches; `isMountPoint` in the worker job prints nothing; `from "@/` in the four worker-bundled modules prints nothing; `git diff --name-only HEAD -- prisma/` prints nothing; `git grep PendingFileDeletion -- src prisma tests` prints nothing. PASS.
- Task 2: test names contain G1 to G6, "copied marker", "missing marker", "adopted" and "EEXIST" (one each); no `.skip(` or `.only(`. PASS.
- Task 3: one `describe` each for staged rollback, public intake, status follow-up, ticket messages, project attachments and task hard delete; 6 cases named "after commit", each asserting the referenced file exists; the caller table and the full integration exit code and counts are in this SUMMARY. PASS.
- No Prisma schema change and no migration.

## Files Created/Modified

- `src/lib/storage/file-fence.ts`: fence contract (constants, lease SQL, `parseLease`, provider, handle).
- `src/lib/storage/uploads-volume.ts`: mount point, marker and identity.
- `src/lib/projects/file-cleanup.ts`: required `fence`, `skipped?`, delete tracking, header covering U-11 and U-12.
- `src/lib/worker/jobs/project-file-cleanup.ts`: builds the real provider.
- `src/lib/attachments/local-file-storage.ts`: `wx`, `uploadsRoot()`.
- `src/lib/attachments/staged-files.ts`: the EEXIST key is never cleaned up.
- `tests/support/file-fence-fixtures.ts`: fixtures and the SQL-level backup emulator.
- `tests/unit/file-fence.test.ts`, `tests/unit/file-delete-callers.test.ts`, `tests/integration/file-fence.test.ts`, `tests/integration/file-delete-inventory.test.ts`: new tests.
- `tests/integration/project-file-cleanup.test.ts`, `project-comments-attachments.test.ts`, `project-delete.test.ts`: every sweep call passes `fence`; their upload directories come from `testUploadsDir()`. The hanging-delete case now resolves its delete in `finally` and awaits the handle's `closed`. No existing assertion was removed or loosened.

## Decisions Made

- The mount check runs before identity creation, so a directory that is not a mount point never writes the marker or the row.
- `parseLease` requires a holder, while `BACKUP_LEASE_ACTIVE_SQL` deliberately does not, so a holderless lease with a valid expiry still fences.
- `leaseValueActiveSql(column)` is exported so the emulator (and plan 09-06) writes a lease "only when no unexpired lease exists" with the same predicate the deleter reads.
- Extra exports beyond the plan list: `FILE_FENCE_KEY_TEXT`, both application names, `DeleteFenceProvider`, `FenceRefusalReason`, `RawSqlClient`. The fixtures also add `testVolumeIdentity`, `trackFence`, `fenceLocks`, `backendsNamed` and `deleteBackupLease`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] `saveStagedFiles` could delete a committed file after an EEXIST collision**
- **Found during:** Task 3 (reading `staged-files.ts` against the new `wx` saves)
- **Issue:** on a save failure the rollback deleted every attempted key, including the key whose save failed. With exclusive create, an EEXIST failure means that key already holds another writer's file, possibly one a committed row references, so the rollback would delete a referenced file (the U-13 invariant).
- **Fix:** when the save error code is `EEXIST`, the failing key is left out of the cleanup. This file is outside `files_modified`; the change is caused directly by this plan's `wx` change.
- **Files modified:** `src/lib/attachments/staged-files.ts`
- **Verification:** red first (the inventory case found `[]` instead of the committed key), then green. `tests/unit/staged-files.test.ts` stays green (non-EEXIST failures still clean up every attempted key).
- **Committed in:** `c4124a9`

**2. [Rule 3 - Blocking] The worker handler test needs a mount point**
- **Found during:** Task 1
- **Issue:** `project-file-cleanup.test.ts` calls the real worker handler, which (by acceptance criterion) never overrides the mount check, and a temporary directory is never a mount point. The handler would refuse, and the existing `{ deleted: 1 }` assertion would fail.
- **Fix:** that one file uses `vi.mock("@/lib/storage/uploads-volume", …)`, which keeps the real module and replaces only `isMountPoint` with `async () => true`. The fence, the lease and the marker check stay real, and the handler's assertion is unchanged. The real mount check is proven separately by the "copied marker" case (no override).
- **Committed in:** `3824a4a`

**3. [Precision] G4's ordering claim**
- **Issue:** the plan says the backup's lock is "granted only after the handle's `closed` resolved". The two events are replies on two different sockets, so their order on the client is not deterministic.
- **Fix:** G4 proves three things deterministically. First, the backup is blocked by the sweep's fence backend (`waitForBlockedBy`) while the timed-out delete runs. Second, at the moment of the grant the delete had settled (`deleteSettledAtGrant === true`). Third, `closed` resolves, and afterwards `pg_locks` shows only the backup's lock. The unlock is issued only after `Promise.allSettled` over the tracked deletes.

---

**Total deviations:** 3 (1 Rule 2 fix, 1 Rule 3 test seam, 1 precision note). **Impact:** the Rule 2 fix closes a referenced-file deletion that exclusive-create saves would otherwise have introduced. No scope added.

## Issues Encountered

- The first unit red attempt did not fail: the mutation disabled only the year comparison, and the month comparison still caught 2026-02-30. A second mutation disabled the whole check and failed as expected (both runs are in the table).
- The inventory test failed typecheck (`Buffer` as `BlobPart`) after the full integration run. The fix was type-only, and the file was re-run green.

## Stated limits

- **L1 (from the plan):** a backup that is paused, has lost its fence session and whose lease has expired, all at the same time, no longer fences deletions. The backup's lease-loss abort and its dump-to-archive verification (plan 09-06) keep such a set unpublished.
- **Organization delete (PATTERNS D4):** no code in `src/` deletes an organization (static test). However, Better Auth 1.7.20's organization plugin keeps its own owner-only `POST /api/auth/organization/delete` (`disableOrganizationDeletion` is not set in `src/lib/auth.ts`, and `src/proxy.ts` blocks only `/api/auth/sign-up`). That path was not exercised here. From reading the schema, the cascade into the append-only `AuditEvent` (and probably `TicketAuditEvent` and `ProjectActivity`) raises an error, so the delete would succeed only for an organization without such rows. A successful delete would remove the reference rows and the queue rows together and leave the files on disk: orphans that cost disk, never a referenced key without its file. Whether to set `disableOrganizationDeletion: true` is left for the owner (see Threat Flags).
- **Upload intents** are not built (plan's flagged assumption): a crash between storing a file and committing its reference leaves an unreferenced file.
- **Email ingest** has no rollback (see the caller table).
- **Local development:** outside a container `UPLOADS_DIR` is usually not a mount point, so a local `pnpm worker` deletes no files and logs `[project-file-cleanup] sweep skipped: uploads-unverified` once a minute. Plan 09-08 documents this in `docs/OPERATIONS.md`.
- **Connections:** each sweep run opens one extra short-lived database connection for the fence, outside the worker pool's `DB_POOL_MAX`. It is held longer only while a delete hangs, and a hung delete then blocks only the backup's fence wait, which times out in plan 09-06.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: tenant-delete-path | `src/lib/auth.ts` (Better Auth organization plugin, pre-existing) | `POST /api/auth/organization/delete` is reachable for an organization owner; not introduced by this plan, found during the U-13 audit. Owner decision whether to disable it. |
| threat_flag: new-db-session | `src/lib/storage/file-fence.ts` | A new database connection per sweep run (`application_name` `aida-delete-fence`) with session-level advisory locks; logs carry a reason and an error code only. |

## Not run

- Stack-level proof of the fence with the real worker container and the backup service: not run (waiting for the Phase 8.1 harness and the owner, U-15). The backup side itself is plan 09-06.
- `pnpm test:egress`, `pnpm test:e2e` and `pnpm build`: not run (outside this plan's verify; phase gate).

## User Setup Required

None.

## Next Phase Readiness

- Plan 09-05 (logo store) enqueues the replaced key through `enqueueFileCleanupInTx` and must add its file to the enqueue list in `tests/unit/file-delete-callers.test.ts`.
- Plan 09-06 implements the backup side with `FILE_FENCE_KEY_SQL`, `BACKUP_LEASE_KEY`, `leaseValueActiveSql` and the lease JSON `{"holder","expiresAt"}`. `tests/support/file-fence-fixtures.ts` `backupEmulator` is the SQL it must match.
- Plan 09-10 (restore) writes the marker of an existing identity. The sweep never does.

---
*Phase: 09-operations*
*Completed: 2026-11-12*

## Self-Check: PASSED

All 7 created files exist; commits 3824a4a, 2ee59c3 and c4124a9 are in the log; no home path in the tracked files of this plan.
