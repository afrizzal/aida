---
phase: 09-operations
part: a (database URL, seed and demo guards, records and repo health)
reviewed: 2026-11-12T12:00:00Z
depth: standard
diff_range: b511b3b..HEAD (HEAD 7966417)
files_reviewed: 21
files_reviewed_list:
  - .env.example
  - .github/CODEOWNERS
  - .github/workflows/check-version.yml
  - AGENTS.md
  - LAUNCH.md
  - README.md
  - package.json
  - prisma/seed.ts
  - scripts/capture-demo-assets.ts
  - scripts/check-database-url.ts
  - scripts/check-version.mjs
  - scripts/database-url.sh
  - src/instrumentation.ts
  - src/lib/bootstrap.ts
  - src/lib/db-url.ts
  - src/lib/demo/bootstrap-demo.ts
  - src/lib/demo/identities.ts
  - src/lib/demo/seed-demo-data.ts
  - src/lib/demo/tenant-guard.ts
  - src/lib/tenant-seed-lock.ts
  - src/lib/worker/index.ts
coverage_note: "The new or rewritten files (db-url.ts, database-url.sh, check-database-url.ts, tenant-seed-lock.ts, tenant-guard.ts, bootstrap-demo.ts, identities.ts, bootstrap.ts, check-version.mjs, check-version.yml, CODEOWNERS, AGENTS.md) were read in full. For the long files with small changes (seed-demo-data.ts, capture-demo-assets.ts, README.md, LAUNCH.md, .env.example, package.json, instrumentation.ts, worker/index.ts, seed.ts), the diff hunks against b511b3b were read with the code around them. For context only, these were also read: the DATABASE_URL and AIDA_EXPECT_DB_* lines of docker-compose.yml, src/lib/db.ts, the /setup action (src/app/(auth)/setup/actions.ts), biome.json includes, the 09-01 to 09-03 SUMMARY deviations and the U-01 to U-18 update in 09-CONTEXT.md. Tests were read, not run: tests/unit/db-url.test.ts, tests/unit/check-version.test.ts, tests/integration/compose-database-url.test.ts, tests/integration/seed-guard.test.ts, tests/integration/demo-boot.test.ts, and from support/ the demo driver, demo-guard-fixtures (password scan, DELETE_ADVICE) and table-inventory. No Docker, Testcontainers, E2E or build was run. The claim that pg and the Prisma schema engine decode a percent-encoded URL the same way as WHATWG URL was not checked against their source; see a-IN-1. Checked and found sound, so not reported: no error, return value or log line of db-url.ts, check-database-url.ts, instrumentation.ts or the worker carries a URL or password; database-url.sh keeps the password out of argv (printf is a builtin, od reads a pipe) and its case table matches RFC 3986 unreserved exactly; the worker imports ../db-url relatively and tenant-seed-lock.ts, bootstrap.ts and db-url.ts carry no @/ import (tenant-guard.ts, identities.ts and bootstrap-demo.ts use @/ but are reached only from the app and the tsx seed, never from the worker bundle); no path in the reviewed code deletes an organization, user or demo row; the seed CLI and demo boot write nothing on demo-partial, demo-complete, foreign or lock timeout; check-version.yml uses only ubuntu-latest, has no schedule, uses plain pull_request with a read-only token, and passes the base sha through env with a format check; check-version.mjs escapes every untrusted value printed in an annotation and has no silent fallback in the script itself; package.json is 1.0.0; CODEOWNERS holds one catch-all rule for the owner's handle; no README widget was added in this range."
findings:
  critical: 0
  warning: 3
  info: 7
  total: 10
status: issues_found
---

# Phase 9: Code Review Report (part a, database URL, seed and demo guards, records and repo health)

**Reviewed:** 2026-11-12
**Depth:** standard (full files and diff hunks; see coverage note)
**Files Reviewed:** 21
**Status:** issues_found

## Summary

The database URL guard does what it says. It runs before Prisma or pg-boss connects in all three services, it reports only the name of the component that differs, and the shell generator and the TypeScript encoder use the same byte-wise RFC 3986 encoding. The tenant guard holds up for every path it covers: an empty database is the only one it writes to, every other state is refused with one line and no write, and nothing is deleted. The tests are mostly real. Inventories are compared with exact `toEqual`, password scans return booleans and never echo the value, and the lock-held case proves the timeout path.

The defects are at the edges of the lock. The `/setup` wizard does not take the lock, so the seed CLI can still write demo data into a database that is getting a real admin and workspace at the same moment (a-WR-1). `bootstrapFromEnv` claims boot never blocks, but it rethrows every error that is not a lock timeout from `register()`, and the two serial lock waits can hold the app's start for several minutes (a-WR-2). Two configured demo emails that compare equal make every seed fail after the first three writes have committed. That leaves the database permanently demo-partial, and under U-04 the only recovery is a new database (a-WR-3). There are no critical findings.

## Warnings

### a-WR-1: The /setup wizard bypasses the tenant seed lock, so the seed CLI can put demo data and a known-password account into a real workspace's database

**File:** `src/app/(auth)/setup/actions.ts:39-58` (with `src/lib/demo/tenant-guard.ts:158-182`, `src/lib/demo/identities.ts:39-51`, `src/lib/tenant-seed-lock.ts:13-14`)
**Issue:** `classifyTenantData` reads "empty" inside the lock. The wizard does its own unlocked `prisma.user.count()` followed by `signUpEmail` and `createOrganization` with an operator-chosen slug. The lock module states this as a limit, but it breaks D-15's promise that demo data never goes into a database holding real tenant data. The demo boot is safe because `register()` finishes before the server takes requests. `pnpm db:seed` is not: it runs while the app is serving.
**Failure scenario:** On a fresh install an operator runs `pnpm db:seed` against the stack. While it runs, someone completes `/setup` with slug `acme`. Both see zero users. The seed classifies the database as empty, finds no organization in `createDemoIdentities`, and signs up the demo admin. The wizard then signs up the real admin and creates `acme`, and the seed creates `aida` and loads 30 tickets, contacts and KB articles. The result is a real workspace and a demo workspace in one database, with two accounts carrying the publicly documented default password. If the wizard picks slug `aida` instead, the demo `createOrganization` fails, and the demo admin user stays in the real database with the public default password and no marker.
**Fix:** Run the wizard's count-and-create under the same lock, and re-check inside it:
```ts
await withTenantSeedLock(async (tx) => {
  if ((await tx.user.count()) > 0) return { error: "Setup has already been completed. Please sign in." };
  // signUpEmail, createOrganization, setupComplete as today
});
```
Map `TenantSeedLockTimeout` to a "setup is busy, retry" error. Also move the user-count re-check in `createDemoIdentities` from organizations only to users as well. That check runs outside the lock transaction but after classification, so it narrows the window for any writer that still bypasses the lock.

### a-WR-2: `bootstrapFromEnv` can stop or stall app start, despite "boot never blocks"

**File:** `src/lib/bootstrap.ts:86-105`, `src/instrumentation.ts:19-24`, `src/lib/tenant-seed-lock.ts:62-73`
**Issue:** Only `TenantSeedLockTimeout` is caught. Any other failure of `withTenantSeedLock` is rethrown out of `register()`. Examples are Prisma P2028 (no pooled connection within `maxWait` 30 s, or the 600 s transaction timeout), a dropped connection, or a 55P03 raised for some other reason. This is new with the lock, because the old code made a single `count()` call. The lock also serialises two waits: `bootstrapFromEnv` waits up to 120 s, then `bootstrapDemoMode` waits up to another 120 s, and `register()` awaits both before Next serves any request. U-17 says the demo boot never stops the app from starting. The comment at `bootstrap.ts:75-76` claims the same for the bootstrap.
**Failure scenario:** An operator runs `pnpm db:seed` in a second shell and restarts `app` with `ADMIN_*` and `DEMO_MODE=true` set. The seed holds the lock for its full run. The app logs nothing for up to about 4 minutes while both waits run, and the compose healthcheck and Caddy see a dead upstream. Alternatively, a pool stall over 30 s during boot makes `$transaction` throw P2028, `register()` rejects, and the app exits instead of starting without the headless admin.
**Fix:** Catch every error in `bootstrapFromEnv`, log one fixed line that names the error class and not the message (the message can quote the email), and return. Use a short lock wait at boot (for example `lockTimeoutMs: 10_000`), passed only from `register()`, so the two serial waits are bounded by seconds. Add a test that holds the lock and runs the `bootstrap-env` driver mode, as the T-09-07b case does for the demo boot.

### a-WR-3: Equal admin and agent demo emails make every seed fail after three committed writes, leaving a permanent demo-partial database

**File:** `src/lib/demo/identities.ts:34-37,56-61`, `src/lib/demo/tenant-guard.ts:86-90`
**Issue:** `demoIdentityEmails` deduplicates the two configured emails when they compare equal after lower-casing, so the classifier accepts that configuration. `createDemoIdentities` still signs up the admin, creates the organization and sets `setupComplete` (all committed), then calls `signUpEmail` again with the same email, and Better Auth rejects it. The marker is never written. Every later run classifies the database as demo-partial and refuses. Under U-04 nothing may delete those rows, so the only way out is a new database. The same happens if `DEMO_AGENT_EMAIL` equals the admin email in different case.
**Failure scenario:** An evaluator sets `DEMO_ADMIN_EMAIL=DEMO_AGENT_EMAIL=me@example.test` to sign in with one address and runs `docker compose up` with `DEMO_MODE=true`. The log shows "[demo] Demo seeding failed: …", and from then on every boot prints the incomplete-demo refusal. The volume has to be thrown away.
**Fix:** Validate the configuration before any write, inside `runGuardedDemoSeed` right after classification, or before taking the lock. If the two emails are equal after lower-casing, return a new `refused-config` outcome with one fixed log line. Write nothing. Add the case to the refusal matrix with an inventory comparison.

## Info

### a-IN-1: No test proves that the services actually connect with an encoded reserved-character password

**File:** `tests/integration/compose-database-url.test.ts:125-153`, `tests/unit/db-url.test.ts:51-80,179-206`
**Issue:** Case A renders `docker compose config` and decodes `DATABASE_URL` with this repo's own `parseDatabaseUrl`, which is WHATWG `URL` plus `decodeURIComponent`. The unit round-trip tests use the same parser on both sides. None of them shows that pg (`pg-connection-string`) and the Prisma schema engine used by `migrate deploy` decode the URL the same way. So the tests can fail for an encoder defect, but not for a mismatch between the parser the guard uses and the parser each service uses, which is the case that breaks a service. The stack proof is deferred to the Phase 8.1 harness (U-15). This finding records that the deferred proof is the only coverage for that clause.
**Fix:** When the 08-14 harness lands, run migrate, app and worker with the case-A vectors (including `%`, `@`, non-ASCII) and assert a real connection. Until then, a cheap unit check can parse the encoded URL with `pg-connection-string` and compare user, password and database.

### a-IN-2: A `$` in POSTGRES_PASSWORD is interpolated by compose but not by the generator, and the docs do not say so

**File:** `.env.example:17-23`, `scripts/database-url.sh:12-13`
**Issue:** Compose interpolates `$VAR` in unquoted and double-quoted `.env` values. The usage line passes the password single-quoted in the shell. With `POSTGRES_PASSWORD=ab$cd` in `.env`, compose gives db, migrate, app and worker the value `ab`, while the generator encodes `ab$cd`. The guard then stops migrate with "password does not match POSTGRES_PASSWORD". That is correct and safe, but the operator has no hint at the cause, because `.env.example` lists `/ @ : # ? %` and not `$`. The integration test writes single-quoted env files, so it never exercises this.
**Fix:** Add `$` to the list in `.env.example`, with a note to single-quote the value or escape it as `$$`, and say the same in the script's usage comment and in docs/OPERATIONS.md.

### a-IN-3: The 600 s transaction bound can turn a slow but healthy seed into a permanent demo-partial database

**File:** `src/lib/tenant-seed-lock.ts:62,72`, `src/lib/demo/tenant-guard.ts:176-182`
**Issue:** The marker is written through the lock transaction. If the seed takes longer than `transactionTimeoutMs`, Prisma rolls the transaction back and releases the lock, while the seed keeps writing on other connections. The final `tx.setting.create` then fails, and the database is demo-partial for good, with only a new database as recovery. The integration case timeout is also 600 s, so a seed time near that bound is plausible on a slow host.
**Fix:** Raise the bound for the guarded seed, or write the marker on a fresh connection after confirming the lock transaction is still open. Log a distinct line when the failure is the transaction timeout, so the operator knows the dataset is incomplete because of time and not a crash.

### a-IN-4: The version gate runs the pull request's own copy of the checker

**File:** `.github/workflows/check-version.yml:61,63,72,78`
**Issue:** With plain `pull_request`, both the workflow and `scripts/check-version.mjs` come from the merge ref. A pull request can edit the script (or the step) to always exit 0, and the check goes green. This is inherent to a self-hosted gate and fine as an informative check, but LAUNCH.md item 4 suggests making it a required status check, where this matters.
**Fix:** When the base has the script, run the base's copy (`git show "$sha:scripts/check-version.mjs" > "$RUNNER_TEMP/check-version.mjs"`) against the head's package.json. Otherwise state in LAUNCH.md that the check is advisory, and that Code Owner review of `scripts/` and `.github/` is what protects it.

### a-IN-5: check-version.mjs is neither linted nor typechecked, and the workflow's shell logic has no test

**File:** `biome.json:17`, `scripts/check-version.mjs`, `tests/unit/check-version.test.ts:287-330`
**Issue:** Biome includes only `{ts,tsx,js,jsx,json}`, and the 09-03 SUMMARY confirms that the `.mjs` was linted only through a manual `.js` copy. Nothing in CI lints it. The YAML tests check triggers, runners and permissions with line matching. The parts that guard against a silent fallback (the sha format check, the unreadable-commit exit, the all-zero `before` branch, the missing-package.json branch) are never run. Also, the `\r` and `\n` replacements in `shown()` (line 109) cannot match, because `JSON.stringify` has already escaped them, and the test at line 127 passes for that reason, not because the replacements work.
**Fix:** Add `mjs` to the Biome includes. Extract the `run:` block into a script under `scripts/` and test it against a temporary git repository: a malformed sha, an unknown commit, and a base without package.json.

### a-IN-6: LAUNCH.md says no third-party image goes into the README, but the README already loads shields.io badges

**File:** `LAUNCH.md:62-63`, `README.md:11-13`
**Issue:** Item 3 states "No third-party widget or tracking image goes into the README". Lines 12-13 of the README load images from `img.shields.io`, a third-party request on every README view. They predate this range, so nothing new was added, but the record as written is false.
**Fix:** Reword item 3 to "no new widgets were added, and the existing CI, license and docs badges stay", or replace the shields.io badges with plain links if the owner meant to exclude all third-party images.

### a-IN-7: Two concurrency tests cannot reliably fail for the defect they name, and one lock path is untested

**File:** `tests/integration/demo-boot.test.ts:358-385`, `src/lib/bootstrap.ts:97-103`
**Issue:** "bootstrapFromEnv and a seed CLI started together" races a three-write bootstrap against a seed in two separate tsx children. With the lock removed, the bootstrap usually finishes before the seed child classifies, and the test still passes, so it proves the lock only when the timing happens to overlap. By contrast, the seed-CLI-versus-demo-boot case (line 311) does fail reliably without the lock, because both seeds are long. Separately, the `TenantSeedLockTimeout` branch of `bootstrapFromEnv` is never run. The injected crash is a thrown exception, not a killed process. For rollback and lock release the two behave the same, so the crash-per-stage tests are sound on that point.
**Fix:** In the bootstrap race case, hold the lock from a pg client, start both children, wait until both are blocked on `pg_locks`, then release it, so they really contend. Add a `bootstrap-env --lock-timeout-ms` driver mode and a held-lock case for it, which a-WR-2's fix needs anyway.

---

_Reviewed: 2026-11-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Orchestrator dispositions (2026-11-12)

Four-part review of `b511b3b..HEAD`: part a (this file) 0 critical, 3 warning, 7 info; part b (`09-REVIEW-b.md`) 0, 5, 6; part c (`09-REVIEW-c.md`) 1, 3, 8; part d (`09-REVIEW-d.md`) 1, 4, 5. Total 2 critical, 15 warning, 26 info. Both criticals were re-checked in the code: `requireLogoAdmin` calls `getScopedDb()` then `getOrgRole()` (`src/app/api/settings/branding/logo/route.ts:51-52`), and `aida-restore-set.sh` runs `pg_restore --clean` into the live database with no migration comparison and no migrate afterwards (`:363`).

Run decisions (continuing the run's numbering after K140):
- **K141 (c-CR-01):** the role check reads the session once. A single helper in `src/lib/authz.ts` returns the active organization and the caller's role in that organization from one session read; the logo route and every existing caller of the two-read pattern use it. Test: the role is taken from the same organization that is written, with the organization switched between reads.
- **K142 (d-CR-1):** restore refuses, before stopping anything or writing, when the target database has applied migrations that the set's dump does not contain (a newer schema), unless the target database is empty. The documented path for "restore into a later release" is: restore into an empty database of the release the set came from, or restore into an empty database and then run the target release's `migrate deploy`. The Upgrading rollback and "Restore to a new server" docs are corrected. Test: a restore into a database with an extra migration is refused with nothing changed.
- **K143 (b-WR-1, b-WR-2, b-WR-5):** a backup run has a deadline; the lease renewer stops when the main script is gone; one transient renewal error is retried within the lease margin before the run counts the lease as lost; libpq connections have `PGCONNECT_TIMEOUT`; the scheduler bounds its wait on a run. Every abort leaves an unrecorded line or a status record.
- **K144 (b-WR-4):** at most one sweep holds a fence connection at a time; a new sweep run does not open another while a previous delete is still pending.
- **K145 (a-WR-1):** the `/setup` wizard counts and creates under `withTenantSeedLock`.
- **K146 (a-WR-2):** `bootstrapFromEnv` failures other than the lock timeout are caught and logged without stopping `register()`, as before Phase 9, and the bootstrap and demo boot lock waits are bounded so the app serves within a stated time.
- **K147 (c-WR-02):** an app-level `error.tsx` in `src/app/(app)/` renders one `<h1>` inside the app shell for every route without its own boundary.

| Finding | Severity | Disposition | Batch |
|---|---|---|---|
| c-CR-01 | critical | accept, K141 | F1 |
| c-WR-01 logo validation accepts header-only files | warning | accept: require image data consistent with the format (PNG `IDAT` and `IEND`, JPEG start of scan and end of image, WebP chunk sizes within the file); fix the header-only fixture | F1 |
| c-WR-02 error states without `error.tsx` | warning | accept, K147 | F1 |
| c-WR-03 hand-written route list in `single-h1.spec.ts` | warning | accept: a unit test compares the list with the page files on disk | F1 |
| d-CR-1 | critical | accept, K142 | F2 |
| d-WR-1 restore trap signals the client, not the container | warning | accept: the trap stops and removes the restore container by its exact name and waits until it is gone before releasing the lock or starting services | F2 |
| d-WR-2 Compose v1 offered | warning | accept: Compose v2 is required; remove the `docker-compose` option from `backup.sh` and the docs | F2 |
| d-WR-3 off-host copy readable by other users | warning | accept: `umask 077` in the documented copy | F2 |
| d-WR-4 tests cannot fail for d-CR-1 | warning | accept through K142's test | F2 |
| b-WR-1, b-WR-2, b-WR-5 | warning | accept, K143 | F3 |
| b-WR-3 missing-file list discarded | warning | accept: the run logs the storage keys and row ids of missing files (no file contents, no secrets), capped, before the temp directory is removed | F3 |
| b-WR-4 | warning | accept, K144 | F3 |
| a-WR-1 | warning | accept, K145 | F4 |
| a-WR-2 | warning | accept, K146 | F4 |
| a-WR-3 equal demo emails | warning | accept: the guard refuses equal admin and agent demo emails before any write | F4 |

Info items: fixed in the batch of their part when the fix is small and testable (a-IN-2 `$` in the password documented; a-IN-6 LAUNCH.md wording on README badges; b-IN-1 one rule for organization folders starting with `-` in backup and restore; c-IN-02 a test that the throttle runs before any parameter work; c-IN-05 no success message when there was no logo); otherwise recorded unchanged in `deferred-items.md` with the finding id. c-IN-06 (organization id in a valid token's logo URL) is accepted as is: it appears only when a logo is set and grants no access.

Fix batches run one per round with `gsd-code-fixer`, each new behaviour shown red before green: F1 (part c), F2 (part d), F3 (part b), F4 (part a). Then the Codex diff critique.
