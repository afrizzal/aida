---
phase: 14-projects-foundation
part: c (tests)
reviewed: 2026-11-09T00:00:00Z
depth: standard
diff_base: d88de64
files_reviewed: 12
files_reviewed_list:
  - tests/integration/project-file-cleanup.test.ts
  - tests/integration/project-comments-attachments.test.ts
  - tests/integration/project-content-isolation.test.ts
  - tests/integration/project-core-race.test.ts
  - tests/integration/project-access-race.test.ts
  - tests/support/project-fixtures.ts
  - tests/support/project-hard-delete.ts
  - tests/support/project-race.ts
  - tests/support/lock-wait.ts
  - tests/unit/project-operation-inventory.test.ts
  - tests/e2e/phase4-ai.spec.ts
  - tests/e2e/ticket-statuses.spec.ts
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 14 (part c, tests): Code Review Report

**Reviewed:** 2026-11-09
**Depth:** standard (static only; no suites, builds or Docker run)
**Files Reviewed:** 12 read in full or in the relevant ranges (listed above). The other phase test files were checked by targeted grep only: fixed sleeps, `expect.poll`, `waitForBlockedBy`, `assertNoDeadlock`, observer `clear()`, `mkdtemp`, and per-file race-helper use in `project-ops-race`, `project-tasks-race`, `project-recurrence-race` and `project-delete`.
**Status:** issues_found

## Summary

The race harness holds up. Every race file reviewed binds its proof to recorded PIDs (`holdAt`/`nextStartPid` -> `waitForBlockedBy(observer, holder, [waiter])`), checks for 40P01 and clears the observer in `afterEach`. No phase test file contains `setTimeout`, `sleep`, `waitForTimeout` or `expect.poll`. `projectTableSnapshot` covers all 18 project models in `prisma/schema.prisma` (Project..ProjectFileCleanup), including ProjectActivity.

Known items:
- **`DELETE FROM "ProjectFileCleanup"` in `beforeEach`:** this cannot break another file under the current config, because `vitest.integration.config.ts:10` sets `fileParallelism: false`, so integration files run one at a time. It is a latent coupling (IN-01).
- **Leftover `mkdtemp` directories:** confirmed in two files (IN-02).
- **K70 marker resolution:** the resolver is lexical and can be satisfied by things that are not checks (WR-03).

The real defects are a vacuous disk oracle, two isolation proofs that stop at org A's database rows, and the lexical K70 resolver.

## Warnings

### WR-01: `filesOnDisk` swallows every error, so "no file on disk" assertions can pass without checking anything

**File:** `tests/integration/project-comments-attachments.test.ts:56-61` (used at 228, 251, 272, 281, 390)
**Issue:** `filesOnDisk` returns `[]` from a bare `catch {}` for any `readdir` failure: EACCES, ENOTDIR, or a wrong `uploadsDir` because storage resolved a different root. Five assertions `expect(await filesOnDisk(w.orgId)).toEqual([])` claim that no file was written, or that it was removed. They pass whenever the directory cannot be read. Only line 195 asserts a file exists, and it guards the wiring for one case only.
**Fix:** treat only ENOENT as "empty" and rethrow everything else:
```ts
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
  throw err;
}
```

### WR-02: The `uploadTaskAttachments` isolation proof never checks the filesystem

**File:** `tests/integration/project-content-isolation.test.ts:219-238`
**Issue:** The refused-actor proof compares `projectTableSnapshot` and `activityCount`, which are database only. An upload that writes the blob before the access check, then refuses or rolls back, leaves an orphan file in `UPLOADS_DIR`, possibly under org B's directory for the outsider. No assertion here detects that. The test claims "change nothing", but the filesystem side of the write is outside the snapshot.
**Fix:** before the refused loop, record `readdir` of `UPLOADS_DIR` recursively for `pw.orgA` and `pw.orgB`. After the loop and before the member uploads, assert both lists are unchanged (use the ENOENT-only helper from WR-01).

### WR-03: The K70 resolver lets markers be satisfied by string literals, titles, trailing comments, or seeding helpers

**File:** `tests/unit/project-operation-inventory.test.ts:91-112, 170-192, 200-221`
**Issue:**
1. `parseBlocks` drops only full-line comments. `block.text` keeps string literals and trailing `// ...` comments.
2. `resolvedText` expands every identifier it finds, including words in `it("...")` titles and string contents. It looks them up in a merged, first-wins namespace of all `tests/support/*.ts` definitions.
3. The markers are plain `includes` or regex tests on that text. So `MEMBERSHIP_ENDED` is satisfied by an `it` title or a trailing comment that mentions it, and the `projectActivity` marker is satisfied by calling `seedActivity(` (`tests/support/project-fixtures.ts:309-314`, which contains `prisma.projectActivity.create`). That helper seeds a row; it does not check that a refused write added none.

The gate can therefore turn green for a block that has no refusal or activity assertion.
**Fix:**
- Run `stripStrings` and strip trailing `//` comments on block and definition text before resolving and testing markers (keep the raw title only for `hasWord(block.title, op)`).
- Add `seedActivity` (and any other seed helper) to a do-not-expand set, so expanding a seed helper can no longer satisfy a marker.
- Require the activity marker to be a read: `/projectActivity\.(count|findMany|findFirst)|ProjectActivity/`.
- Add a negative self-test: a fixture block that only seeds activity must be reported as a gap.

### WR-04: Isolation snapshots cover only org A, so a refused cross-org write into org B is not detected

**File:** `tests/integration/project-content-isolation.test.ts:99,109,222,232` (same pattern in the other `*-isolation` files); `tests/support/project-fixtures.ts:383-397`
**Issue:** `projectTableSnapshot(prisma, pw.orgA)` filters every model by `organizationId = orgA`, and `activityCount(pw.orgA)` does the same. The `outsider` actor belongs to org B. If a service resolved the target without its org term and then wrote under the actor's org, the new rows (comment, attachment, activity, cleanup row) would carry `organizationId = orgB`. Both checks would stay equal, and the existence-oracle comparison (`toEqual(... missingId())`) checks only the return value. The proof claims "refused actors change nothing" but observes only one of the two organizations.
**Fix:** snapshot both organizations, before and after:
```ts
const before = [await projectTableSnapshot(prisma, pw.orgA), await projectTableSnapshot(prisma, pw.orgB)];
// ...refused calls...
expect([await projectTableSnapshot(prisma, pw.orgA), await projectTableSnapshot(prisma, pw.orgB)]).toEqual(before);
```
A simpler option is a fixture `projectTableSnapshotAll(prisma, [orgA, orgB])` used by every write block. The inventory marker can then require it.

## Info

### IN-01: A global `ProjectFileCleanup` wipe and a global sweep couple this file to serial execution

**File:** `tests/integration/project-file-cleanup.test.ts:42-44, 76, 307, 347`
**Issue:** `beforeEach` deletes every outbox row in the shared database, and `handler([])` and `sweepProjectFileCleanup({ limit: 100 })` sweep all organizations. Exact counts (`deleted: 1`, `deleted: 20`, "empty table returns zeros") depend on that wipe. The wipe is safe today only because `vitest.integration.config.ts:10` sets `fileParallelism: false` and `docs/ops/local-dev.md` allows one test process at a time. Enabling parallelism, or running a second process against the same database, would silently delete outbox rows that `project-delete.test.ts` and `project-comments-attachments.test.ts` assert on.
**Fix:** add a comment at line 42 that names the dependency on `fileParallelism: false`. Better, give the sweep an org filter used only by tests, or assert counts on this file's own organizations rather than on global totals.

### IN-02: Temporary upload directories are never removed, and `UPLOADS_DIR` is not restored

**File:** `tests/integration/project-comments-attachments.test.ts:36-37`; `tests/integration/project-content-isolation.test.ts:50`
**Issue:** Both files `mkdtemp` a directory, write real PNG uploads into it, and have no `afterAll` that runs `rm`. Every run leaves `aida-project-attachments-*` and `aida-content-isolation-*` directories in the OS temp dir. `project-file-cleanup.test.ts:36-40` and `project-delete.test.ts:73-78` already show the correct pattern.
**Fix:** save the previous `UPLOADS_DIR`, then in `afterAll` restore it and run `await rm(dir, { recursive: true, force: true })`.

### IN-03: The `sweep2Blockers` assertion can never fail

**File:** `tests/integration/project-file-cleanup.test.ts:296-311`
**Issue:** `pg_blocking_pids(sweep2Pid)` is read inside `onLocked`, after sweep 2 already holds its row locks, so sweep 2 is not waiting at that moment. `expect(sweep2Blockers).not.toContain(sweep1Pid)` therefore always holds. The real proof is that `await sweepProjectFileCleanup(...)` for sweep 2 returns while sweep 1 is parked. If SKIP LOCKED regressed, sweep 2 would block and the test would hang until the 60 s test timeout instead of failing with a diagnostic.
**Fix:** drop the vacuous assertion. Wrap sweep 2 in `Promise.race([sweep2, timeout(10_000, "sweep 2 blocked behind sweep 1")])` so a regression fails fast with a clear message.

### IN-04: The T7 comment says "no retry delay", but the `ai-triage` queue uses exponential backoff

**File:** `tests/e2e/phase4-ai.spec.ts:416-421`
**Issue:** The comment says "ai-triage: retryLimit 2, no retry delay". `src/lib/worker/index.ts:89-93` creates the queue with `retryBackoff: true, retryDelayMax: 300`, so retries are delayed and grow exponentially. The poll itself is sound: the job data shape `{ ticketId }` matches `boss.send("ai-triage", { ticketId })` at `src/app/(app)/tickets/[id]/actions.ts:113`, and the states counted (`created`, `retry`, `active`) cover every unfinished job in pg-boss 12. Two retries fit inside the 60 s budget, but anyone who reads the comment and raises the retry settings will not see that the timeout needs to grow with them.
**Fix:** correct the comment to "retryLimit 2 with exponential backoff (see src/lib/worker/index.ts)" and note that the 60 s timeout must cover the backoff total.

## Checked and not flagged

- `tests/e2e/ticket-statuses.spec.ts` `renewSessionCookieCache`: `page.request` shares the browser context's cookie jar, and the test asserts both the 200 status and that `set-cookie` carries `better-auth.session_data=`, so it cannot pass without renewing the cookie.
- `tests/support/project-hard-delete.ts`: the header says it reproduces only the end state and proves nothing about `deleteProject`. No reviewed file uses it as a stand-in for the delete behaviour.
- The `Promise.race` at `project-file-cleanup.test.ts:269-274`: race attaches a handler to the rejecting branch, so it causes no unhandled rejection once sweep 1 finishes after release.

---

_Reviewed: 2026-11-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
