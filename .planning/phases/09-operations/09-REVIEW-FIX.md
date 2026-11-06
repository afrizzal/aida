# Phase 9: Code Review Fix Report

Fixes for the four-part Phase 9 code review (`09-REVIEW.md`, `09-REVIEW-b.md`, `09-REVIEW-c.md`, `09-REVIEW-d.md`), one section per fix batch (see "Orchestrator dispositions (2026-11-12)" in `09-REVIEW.md`). Every new behaviour is shown red before green. Runs used `AIDA_TEST_RUN_ID=mwdj7jbu-806ef1af59a3dd21` and the Colima `DOCKER_HOST`, one test process at a time, exit codes read without a pipe.

## F1

**Date:** 2026-11-12. **Scope:** part c (`09-REVIEW-c.md`): c-CR-01 (K141), c-WR-01, c-WR-02 (K147), c-WR-03, c-IN-02, c-IN-05. The other part c info items are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree, as the dispatch asked. **Result:** 6 of 6 in-scope findings fixed, 7 commits.

### c-CR-01 / K141: admin gates read the session once

**Change.** `src/lib/authz.ts` now has `getActiveOrgAccess()`. It reads the session once and returns `{ session, orgId, role }`, where `role` is the member row's role in exactly `orgId`. `requireOrgAdminScope()` is the admin gate for a write. It throws `Forbidden: admin role required` unless `isAdminRole(role)`, and it returns `scopedDb(orgId)` for that same organization. `getOrgRole()` and `requireOrgAdmin()` now delegate to the one-read helper. `requireOrgAdmin()` has no callers left in `src/`.

**Callers converted.** I found them with `grep` for files that use both a role helper and a session helper. These are the 20 places that ran `requireOrgAdmin()` and then `getScopedDb()`, or `getScopedDb()` and then `getOrgRole()`, to authorize a write:
- `src/app/api/settings/branding/logo/route.ts`: `requireLogoAdmin`, used by POST and DELETE. Without a session or without an active organization the answer is still 401.
- `src/app/(app)/kb/actions.ts`: 2 actions.
- `src/app/(app)/settings/actions.ts`: 6.
- `src/app/(app)/settings/branding/actions.ts`: 1.
- `src/app/(app)/settings/custom-fields/actions.ts`: 3.
- `src/app/(app)/settings/email/actions.ts`: 4.
- `src/app/(app)/settings/sla/actions.ts`: 1. Its `getSessionActor()` action was already a single read and is unchanged.
- `src/app/(app)/settings/tags/actions.ts`: 2.

**Not changed, by design:**
- `settings/branding/page.tsx` and `settings/sla/page.tsx` still read `getScopedDb()` and then `getOrgRole()`. They use the role only to choose what to display. Every write they offer goes through a converted action.
- `settings/backups/page.tsx` already makes a single read.
- `kb/page.tsx`, `tickets/ticket-list-panel.tsx` and `tickets/[id]/page.tsx` take the session and the organization from one `getScopedDb()` call.
- `insights/actions.ts` and `tickets/[id]/actions.ts` have no admin gate.

**Test.** `tests/unit/org-access-single-read.test.ts` replaces only Better Auth's `getSession`, the member lookup, `scopedDb` and the stores. The real code in `session.ts`, `authz.ts`, the route and the actions runs. The active organization switches after the first session read, and the user is admin in one organization and member in the other. The test covers:
- DELETE with member then admin: 403 and no write.
- DELETE with admin then member: 200 and a write only to the admin organization.
- `deleteTag` and `createKbArticleAction`: they write only to the organization whose role was checked.
- Exactly one `getSession` call each time.

`tests/unit/logo-upload-route.test.ts` and `tests/unit/settings-connection-actions.test.ts` now mock the new helper.

**Runs:**
- Red, before the fix: `vitest run tests/unit/org-access-single-read.test.ts` exit 1, 4 failed and 1 passed (5). The first case got 200, meaning the member's write went through.
- Green: the new file plus `logo-upload-route`, `settings-connection-actions` and `admin-role`: exit 0, 4 files, 48 passed. `tsc --noEmit` exit 0.

**Commit:** `bd8cb94` fix(09-F1): c-CR-01 admin gates read the session once (K141)

### c-WR-01: logo validation requires image data, not only a header

**Change.** `src/lib/branding/logo-validate.ts` runs a structure check after the dimension and pixel limits, and still decodes no pixel:
- **PNG:** every chunk's length, type and CRC framing fits in the file, IHDR comes first, at least one IDAT is non-empty, and IEND is reached. An `acTL` chunk returns `not_image`.
- **JPEG:** a frame header comes before the start of scan, the SOS header fits, there is at least one byte of scan data, and an `FF D9` follows it.
- **WebP:**
  - the RIFF size fits in the file and every chunk fits inside it (with even padding);
  - a `VP8 ` key frame holds its whole first partition, whose size comes from the frame tag;
  - `VP8L` has data after its 5 header bytes;
  - `VP8X` needs an image chunk after it (`VP8 `, `VP8L` or `ANMF`).

A file that fails the check is `unreadable`. Bytes after IEND or after EOI are still accepted, so the padded 1 MiB boundary case is unchanged.

**Fixture.** `tests/support/logo-images.ts` now builds complete images:
- The PNG has a real zlib IDAT for every scanline, so it decodes, up to 4,194,304 pixels. Above that a one-byte stream stands in, because the validator refuses on the dimensions first.
- The JPEG and WebP builders are structurally complete, but their compressed bytes are placeholders and do not decode. The file header says so.
- The earlier header-only shapes are kept as `pngHeaderOnlyBytes`, `jpegHeaderOnlyBytes`, `webpVp8HeaderOnlyBytes` and `webpVp8xHeaderOnlyBytes`. The tests use them to show that such files are refused.

One existing case ("JPEG cut inside its frame header") now computes its cut from the header-only length, so it still cuts inside the frame header.

**New tests.** Nine refusal cases in `tests/unit/logo-validate.test.ts`:
- PNG cut after IHDR;
- header-only PNG (empty IDAT);
- PNG without IEND;
- PNG whose IDAT runs past the end of the file;
- header-only JPEG;
- JPEG without EOI;
- header-only VP8;
- VP8X with no image chunk;
- each WebP kind cut short of its RIFF size.

**Runs:**
- Red: the new tests and fixture against the old validator, `logo-validate` plus `logo-upload-route`: exit 1, 9 failed and 37 passed (46). Every existing case passed on the new fixture.
- Green: exit 0, 46 passed. `tsc` exit 0.
- Integration, logo files only: `logo-routes` and `logo-store` (Testcontainers): exit 0, 2 files, 20 passed. That run also includes c-IN-02's new case.
- Ad hoc check, not committed: PNG, baseline and progressive JPEG, and lossy, lossless and alpha WebP encoded by `sharp` (present through Next) all pass, and each one cut in half is `unreadable`.

**Commit:** `3d2acff` fix(09-F1): c-WR-01 logo validation requires image data, not only a header

### c-WR-02 / K147: app-level error boundary with one h1

**Change.** New `src/app/(app)/error.tsx` (client component). It is inside the `(app)` layout, so the sidebar and the top bar stay, and it renders inside `<main>`. It shows one `sr-only` `<h1>` with the top-bar title for the current path, then the destructive callout "Couldn't load this page." with a Retry link button. It uses tokens only and `text-[13px]`, and it never shows error text.

The title mapping moved from `src/components/top-bar.tsx` to `src/lib/navigation/page-title.ts`, so the top bar and the boundary name a route the same way. The top-bar output is unchanged.

The boundary covers every route without its own boundary: `/kb` and its pages, `/insights` and every `/settings` page. `tickets`, `tickets/[id]` and `contacts` keep their own boundaries.

**Fault hook.** The existing hook cannot reach these routes, so I added two fault points to `src/lib/testing/e2e-fault.ts`, `kb-page` and `settings-backups-page`. They use the same production-inert gate and are called first in `kb/page.tsx` and `settings/backups/page.tsx`. `tests/unit/e2e-fault.test.ts` lists them (10 passed).

**Spec.** `tests/e2e/single-h1.spec.ts` gets two error rows, `/kb` (h1 "Knowledge Base") and `/settings/backups` (h1 "Settings"). Every error row now also checks that the top bar is still present.

**Runs** (E2E, `--grep "normal, search|error states"`, because the error rows need the ticket that the normal case seeds):
- Red attempt 1, command started 19:45:53 with `error.tsx` moved to the scratchpad: exit 1 at 19:46:38. The E2E global setup hung on `/setup` (owner item next-o1): `TimeoutError: page.waitForURL: Timeout 30000ms exceeded` at `global-setup.ts:174`. The server log shows only repeated `GET /setup` and no POST. I copied the log, then moved `.next` to the Trash folder `aida-next-1794487643` at 19:47:23. E2E config and `next.config.ts` are unchanged.
- Red attempt 2, 19:47:29: exit 1, 1 failed and 1 passed. In the error-states case the four existing rows passed and the `/kb` row failed: "Couldn't load this page." was not found in `main`.
- Green: restored with `cp`, `cmp` exit 0. Exit 0, 2 passed.
- Full spec: see "Final checks".

**Commit:** `4cecdfc` fix(09-F1): c-WR-02 app-level error boundary with one h1 (K147)

### c-WR-03: route list compared with the page files on disk

**Change.** New `tests/unit/single-h1-route-list.test.ts`. It walks `src/app/(app)` for `page.*` files (route groups add no segment) and requires the `APP_PAGE_ROUTES` literal of `tests/e2e/single-h1.spec.ts` to equal that list. A new page therefore fails here until it is listed, and the spec's last case then requires a case that renders it. The E2E spec itself stays browser-only.

**Runs:**
- Green: exit 0, 2 passed.
- Red: a copy of the spec with `"/settings/tags"` removed from the list: exit 1, 1 failed and 1 passed. The diff names `/settings/tags`. Restored with `cp`, `cmp` exit 0.

**Commit:** `803cea0` fix(09-F1): c-WR-03 unit test pins single-h1 route list to the pages on disk

### c-IN-02: the public logo throttle runs before parameter work

**Change.** New case in `tests/integration/logo-routes.test.ts`. One identity sends 300 requests with malformed parameters (`../x`, `not-a-version`), each answering 404, and the 301st answers 429 `rate_limited`.

**Runs** (Testcontainers):
- Red: a mutation of `src/app/api/public/logo/[orgId]/[version]/route.ts` moved the limiter below the `ORG_ID`/`VERSION` check. Exit 1, 1 failed and 6 passed (7): 404 instead of 429. Restored with `cp`, `cmp` exit 0.
- Green: `logo-routes` and `logo-store`: exit 0, 2 files, 20 passed.

**Commit:** `ac72dc1` fix(09-F1): c-IN-02 test that the public logo throttle runs before parameter work

### c-IN-05: no success message when there was no logo to remove

**Change.** `src/app/(app)/settings/branding/logo-card.tsx` reads `removed` from the DELETE answer. When it is `false`, the card shows the neutral toast "There was no logo to remove." instead of "Logo removed.". The dialog closes and the page refreshes as before.

**Test.** New case in `tests/e2e/logo.spec.ts`. A logo is set and the page shows it. Another admin then removes it through the API, and the UI removal shows the neutral message, no success message, and the no-logo state.

**Runs:**
- Red: the new case against the old card: exit 1, 1 failed (the message was not visible).
- Green: the full `logo.spec.ts`: exit 0, 14 passed. The original remove case still shows "Logo removed.".

**Commit:** `1e3d2b4` fix(09-F1): c-IN-05 no success message when there was no logo to remove

### Other part c info items

c-IN-01, c-IN-03, c-IN-04, c-IN-06 (accepted as is, per the dispositions), c-IN-07 and c-IN-08 are recorded unchanged in `deferred-items.md`, one line each with the finding id.

**Commit:** `19dcca5` docs(09-F1): record part c info items not fixed in F1

### Final checks

| Command | Exit | Counts |
|---|---|---|
| `pnpm lint` | 0 | 669 files, 1 warning, pre-existing: `tests/unit/container-config.test.ts:160`, a file F1 did not touch |
| `pnpm typecheck` | 0 | 0 errors |
| `pnpm test` | 0 | 93 files, 1662 tests passed |
| `playwright test tests/e2e/single-h1.spec.ts` (full) | 0 | 9 passed |
| `playwright test tests/e2e/logo.spec.ts` (full) | 0 | 14 passed |
| `vitest --config vitest.integration.config.ts` logo-routes and logo-store | 0 | 2 files, 20 passed |

The full integration suite was not run. Only the two logo integration files were, because they are the ones whose fixture or cases F1 changed.

### Not done, and limits

- **Manual items:** no visual, dark-mode or screen-reader check of the new error state or the neutral toast. These stay manual.
- **`/settings` error state:** the app-level boundary sits above `src/app/(app)/settings/layout.tsx`, so an error on a `/settings` page replaces the settings sub-navigation along with the page. The sidebar and the top bar stay.
- **`/insights` error h1:** it reads "AIDA", because the shared title mapping (like the top bar) has no `/insights` entry.
- **Fixtures:** the JPEG and WebP fixtures are complete in structure only. Their compressed bytes do not decode. The PNG fixture decodes.
- **Animated WebP (c-IN-04):** WebP `ANMF` frames are accepted when they are larger than their 16-byte frame header. Refusing animated WebP is deferred.
- **`.next`:** moved once to the Trash folder `aida-next-1794487643` because of next-o1 (details under c-WR-02).

## F2

**Date:** 2026-11-12. **Scope:** part d (`09-REVIEW-d.md`): d-CR-1 (K142), d-WR-1, d-WR-2, d-WR-3, d-WR-4 (covered by the d-CR-1 test). The part d info items are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree, as the dispatch asked. Runs used `AIDA_TEST_RUN_ID=mwdk1k2d-f4394c6bcae9055b` and the Colima `DOCKER_HOST` (`colima status` exit 0, `docker info` exit 0 first), one test process at a time, exit codes read without a pipe. Red runs swapped in the old file with `git show <rev>:<path>`, then restored it with `cp` from a scratch copy and checked it with `cmp` (exit 0 every time). **Result:** 5 of 5 in-scope findings fixed, 7 commits. Requires human verification for d-CR-1 and d-WR-1 (logic changes; the real-Compose path is not exercised, see the limits).

### d-CR-1 / K142: a restore into a database with migrations the set lacks is refused

**Change.**
- `scripts/backup/aida-restore-set.sh` gets `check_schema`, which runs right after `db.dump`'s checksum and `pg_restore --list`, before the uploads validation and before anything is staged or written. It reads every `migration_name` in the dump's `_prisma_migrations` (`pg_restore --data-only --table=_prisma_migrations`; a name outside `[A-Za-z0-9_.-]+` fails validation, exit 4). It also reads every migration name in the target's `public._prisma_migrations`, in any state. A target without that table (an empty database) gives an empty list. If the target has a name the dump lacks, the script prints `refused: the target database has N applied migration(s) that the set does not contain (a newer schema), first: <name>` plus the two supported paths, and exits 9. A new mode, `--check-schema <setDir>`, runs only the lock check, the set and dump checks and this comparison, then exits.
- `scripts/restore.sh` runs `--check-schema` in a one-off `backup` container after the lock and the lease and before `compose stop`. Exit 9 gives `Refused: the target database has migrations that set <setId> does not contain (a newer schema). Nothing was stopped or changed.` and exit 9. Any other non-zero exit is passed through with "Nothing was stopped or changed". In both cases the trap releases the lock and the lease, and nothing is stopped or started.
- Docs (`docs/OPERATIONS.md`, `website/.../operations/backup-and-restore.md`, `upgrading-and-logs.md`):
  - a new section, "Which database a set can be restored into", with the two supported paths: a database of the set's own release, or an empty database followed by the target release's `migrate deploy`;
  - the new step 4 and an exit-9 row in the refusals table;
  - "Restore to a new server" now starts only `db backup-init`, so the database stays empty. Then it restores and runs `docker compose up -d --build`, so `migrate` applies every migration newer than the set;
  - the Upgrading rollback first takes a backup of the current state, checks out the previous tag, builds, removes the `app`, `worker` and `backup` containers (`docker compose rm -s -f`, volumes stay), empties the database (`dropdb --force` and then `createdb` in the `db` container), restores and runs `up -d`.

**Tests.**
- `tests/integration/backup-restore-roundtrip.test.ts`, new describe "a target at a newer schema is refused before any write". The case restores the base set into a fresh target (exit 0, so the rows are real). It then applies one extra migration: a `_prisma_migrations` row `29991231000000_k142_extra`, a `K142Extra` table with a foreign key to `organization` and one row per organization, and a new `organization` column. Then it restores the set again. It expects exit 9 and the refusal line, no `restoring the database`, and these unchanged: the full table inventory (row counts of every table), the uploads volume entries and the `_prisma_migrations` rows (id, name, checksum). It also expects no `target-touched`, no staging directory, and the lock still held.
- `tests/unit/restore-script.test.ts`: the fake docker answers `--check-schema` (`FAKE_CHECK_EXIT`). The step lists now include `check` between `lease` and `stop`, and the success case pins the exact check call. New cases: check exit 9 and check exit 6 each give the same exit code, the sequence `lock, lease, check, release`, no `stop`, no set run and no `start`.

**Runs:**
- Red, integration, old set script (`-t "newer schema"`): exit 1, 1 failed, 21 skipped (22). `expected 7 to be 9`. The old script ran `pg_restore --clean` and failed with `cannot drop table public.organization because other objects depend on it`, which is the review's scenario 1. After the test fix in `3bef0ca`, the red run was repeated with the same result: exit 1, `expected 7 to be 9`.
- Green, integration (same filter): exit 0, 1 passed, 21 skipped (22).
- Red, unit, old `restore.sh`: exit 1, 6 failed, 14 passed (20). Green: exit 0, 20 passed (20).
- The docs-reading unit files `part-a-gate-check` and `restore-script`: exit 0, 2 files, 105 passed.

**Commits:** `d37fa7f` fix(09-F2): d-CR-1 refuse a restore into a database with migrations the set lacks (K142); `3bef0ca` fix(09-F2): d-CR-1 seed one extra row per organization in the K142 case. The first full run of the integration file failed in the new case (`duplicate key ... "K142Extra_pkey"`), because the shared base set holds several organizations. The fix was the test's own seed id; the code was not changed.

### d-WR-1: the trap removes the restore container by its exact name before it releases anything

**Change.** In `scripts/restore.sh`:
- the set script now runs as `compose run ... --name aida-<holder>`;
- on every exit other than success, once that run has started, the trap first kills and waits for the client as before. Then it runs `docker stop -t 30 aida-<holder>` and `docker rm -f aida-<holder>`, and polls `docker ps -a --filter name=^/aida-<holder>$` once a second until the name is no longer listed. A failed `ps` counts as listed. Only after that does it read `target-touched`, release the lock or start services;
- if the container is still listed after `RESTORE_CONTAINER_WAIT_SECONDS` (default 60, 1 to 600; another value is a usage error, exit 2), the trap keeps the lock, starts nothing and names the container. While the container runs, its heartbeat keeps the lock fresh, so `--break-stale-lock` keeps refusing;
- `docs/OPERATIONS.md` ("What a failure leaves behind") describes this.

**Tests** (`tests/unit/restore-script.test.ts`, fake docker: exact-name `stop -t 30`, `rm -f`, `ps -a`, and `FAKE_CONTAINER_LISTED`, a number of polls or `stuck`):
- validation failure with the container listed by two polls: `set, ctr-stop, ctr-rm, ctr-ps x3, touched, release, start`, with the exact calls pinned and `release` and `start` after the last poll;
- TERM while the set script hangs, with the container listed by two polls: exit 143, the same order, nothing started before the poll that no longer lists it;
- container still listed when the wait ends (2 s): exit 4, 3 polls, no `touched`, no `release`, no `start`, and the message names the container and the kept lock;
- a wait setting of 0: exit 2 and no docker call.

The existing step lists gained the three container steps.

**Runs:** red, old `restore.sh`: exit 1, 9 failed, 15 passed (24). 4 of the failures are in the new d-WR-1 describe. Green: exit 0, 24 passed (24).

**Commit:** `2dcc8a9` fix(09-F2): d-WR-1 the restore trap removes the restore container by name before releasing anything

### d-WR-2: Docker Compose v2 is required

**Change:**
- `scripts/backup.sh` and `scripts/restore.sh` set `COMPOSE="docker compose"` and no longer read `COMPOSE_CMD`. Their headers, and the `--help` of `backup.sh`, state that Compose v2 is required;
- `docs/OPERATIONS.md` replaces the `COMPOSE_CMD="docker-compose"` block with that requirement and its reason, and states it in the intro and in "Restore to a new server" step 1;
- `README.md` (installer prerequisites) and the website quick-start prerequisites say "Docker Compose v2".

**Test:** new `tests/unit/compose-v2-required.test.ts`:
- it runs `backup.sh` with `COMPOSE_CMD=docker-compose` against a fake `docker` (no `docker-compose` on PATH) and expects exit 0 with every call starting `compose `;
- it checks that the two scripts, OPERATIONS.md and the website backup page neither set `COMPOSE_CMD` nor run `docker-compose`, and that OPERATIONS.md, the README and the quick-start page say "Docker Compose v2".

**Runs:**
- Red, old files: exit 1, 2 failed (2). The first assertion fails because `backup.sh` said "The 'db' service is not running": `docker-compose` was not found. The pin regex was then narrowed, so that naming the legacy binary to say it is unsupported is allowed. The red run was repeated with all five files swapped to their old versions (exit 1, 2 failed), and the files were restored and checked with `cmp`.
- Green: exit 0, 2 passed. Run together with `restore-script`, `install-script` and `part-a-gate-check`, everything else passed.

**Commits:** `017db5b` fix(09-F2): d-WR-2 require Docker Compose v2 and drop the docker-compose option; `0a19100` fix(09-F2): d-WR-2, d-WR-3 give the new script tests a complete ProcessEnv. `pnpm typecheck` refused the two new test files because their spawn env had no `NODE_ENV`.

### d-WR-3: the documented off-host copy runs under umask 077

**Change.** The copy line in `docs/OPERATIONS.md` and the website backup page is now `(umask 077 && docker compose run --rm --no-deps -T --entrypoint tar backup -C /backups -cf - <setId> > aida-backup-<setId>.tar)`. A sentence follows it: the file is mode 0600 and holds tenant data, so store it encrypted or on access-controlled storage.

**Test:** new `tests/unit/offhost-copy-umask.test.ts`. For each of the two pages it takes the one documented line, fills in `<setId>`, runs it under `umask 022` in bash against a fake `docker` that writes a few bytes, and expects the file to be mode `600`.

**Runs:** red, old docs: exit 1, 2 failed (2), `expected '644' to be '600'`. Green: exit 0, 2 passed (with the d-WR-2 file: 2 files, 4 passed).

**Commit:** `44457df` fix(09-F2): d-WR-3 run the documented off-host copy under umask 077 (and `0a19100` above)

### d-WR-4: no test could fail for d-CR-1

The K142 integration case above covers it. It restores into a database at a newer schema, and on the old script it fails: exit 7 instead of the refusal. The review's further SP-2 items (a stack B one release ahead, B's own uploads volume mounted, a HUP during validation on real Compose) were not added to `09-STACK-PROOFS.md`. They need a real compose stack, which U-15 and this dispatch's run rules exclude.

### Part d info items

d-IN-1 to d-IN-5 are recorded unchanged in `deferred-items.md`, one line each with the finding id. None was fixed: each touches the compose file, the installer or the backup exit codes, beyond a small testable change in this batch.

**Commit:** `e2256da` docs(09-F2): record part d info items not fixed in F2

### Final checks

| Command | Exit | Counts |
|---|---|---|
| `pnpm lint` | 0 | 671 files, 1 warning, pre-existing: `tests/unit/container-config.test.ts:160`, a file F2 did not touch |
| `pnpm typecheck` | 0 | 0 errors (a first run gave exit 2 for the two new test files; fixed in `0a19100`) |
| `pnpm test` | 0 | 95 files, 1672 tests passed |
| `vitest --config vitest.integration.config.ts tests/integration/backup-restore-roundtrip.test.ts` (full) | 0 | 22 passed (first full run: exit 1, 1 failed, 21 passed, fixed in `3bef0ca`) |

Only this integration file was run, because it is the only one F2 changed. The full integration suite was not run. After the runs, `docker ps -a` and `docker volume ls` showed no container or volume labelled with the run id and no `aida-restore-*` container. F2 created no container or volume outside the test helpers (rule J) and removed none by hand.

### Not done, and limits

- **Real Compose not exercised.** The wrapper's new behaviour was checked only against the fake `docker`. Three things are therefore unproven on real Compose and Docker: the `--check-schema` one-off run, `compose run --name`, and the `docker ps -a` name filter with its leading `/`. The same holds for the new doc steps: `docker compose up -d db backup-init` on a new server, and `docker compose rm -s -f app worker backup` followed by `dropdb --force`/`createdb` in the rollback. It is unproven too that `compose stop` and `compose start` behave as described when those containers do not exist: `restore.sh` is expected to report that it could not start them, and the docs say so. These belong with SP-2 (U-15).
- **The direction not covered by K142.** The check refuses only a target that is newer than the set. A set that is newer than the running code, restored into an empty or older database, passes. The docs say that migrations go only forward and that a set must not be restored into an earlier release, but no check compares the manifest's app version with the running release.
- **No minimum Compose v2 point version.** The docs say "Docker Compose v2" without a number. No minimum version for `config --format json` was checked.
- **Manual items:** none for this batch (no UI change).

## F3

**Date:** 2026-11-12. **Scope:** part b (`09-REVIEW-b.md`): b-WR-1, b-WR-2 and b-WR-5 (K143), b-WR-3, b-WR-4 (K144) and b-IN-1. The other part b info items are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree, as the dispatch asked. Runs used `AIDA_TEST_RUN_ID=mwdkqusq-9cbe91704e915c46` and the Colima `DOCKER_HOST` (`colima status` exit 0 and `docker info` exit 0 first). One test process ran at a time, and exit codes were read without a pipe. For each red run the old file (a scratch copy taken before the first edit, or the version at the previous F3 commit) or a one-line mutation was swapped in. The new file was then restored with `cp` and checked with `cmp` (exit 0 every time). **Result:** 6 of 6 in-scope findings fixed, in 4 fix commits. The K143 and K144 changes are logic changes and **require human verification**.

### b-WR-1, b-WR-2, b-WR-5 / K143: run deadline, a renewal that follows the run, bounded connects

**Change.**
- `scripts/backup/lib.sh`:
  - exports `PGCONNECT_TIMEOUT` (default 10) for every libpq connection: psql, `pg_dump`, `pg_restore` and the fence session. Restore gets it too, because it sources `lib.sh`;
  - adds `deadline_passed` and `bounded`. While `BACKUP_RUN_DEADLINE` is set, `bounded` runs a command under `timeout -k 10 <seconds left>`;
  - runs `psql_q` under `bounded`;
  - `pause_point` writes the main shell's pid into `<point>.reached` (test only).
- `scripts/backup/aida-backup.sh`, the deadline:
  - new setting `BACKUP_MAX_RUN_SECONDS`, default 21600, 1 to 999999; the run deadline is set after validation;
  - `pg_dump`, the three `find` calls, the three `tar` calls and both `pg_restore` calls run under `bounded`;
  - a step that fails after the deadline logs `backup aborted: run deadline passed` and fails with category `unknown`;
  - the exit trap gets 60 s of its own for its database calls, and the status is recorded through `fenced_action`.
- `aida-backup.sh`, `renew_loop`:
  - closes the fence FIFO's write end (`exec 7>&-`) and stops at once when `kill -0` on the main shell fails;
  - stops renewing 120 s after the deadline and signals the run (`deadline.passed`, then `backup aborted: run deadline passed`);
  - retries a psql error every `TTL/15` seconds (1 to 5) and logs `lease renewal failed; retrying`, until a third of the TTL would be left on the lease, counted from the last confirmed renewal. Each attempt is bounded by that point;
  - counts as lost only a confirmed 0 rows or the end of that margin;
  - its stdout now reaches the run's log.
- `aida-backup.sh`, a run that lost its lease still writes no `backup:lastRun`. It now prints the `AIDA_BACKUP_STATUS_UNRECORDED` line, writes `status-unrecorded-<setId>.json` and exits 5. Before, it exited 2 with no record, which 09-13 had pinned in a test. K143 ("never silence") overrides that, and the two existing tests were changed to match.
- `scripts/backup/scheduler.sh`:
  - sources `lib.sh` and validates `BACKUP_MAX_RUN_SECONDS` (exit 2 on an invalid value);
  - waits at most the deadline plus 180 s for a run. A watchdog that polls once a second then sends TERM, and KILL 30 s later. A run that ended on a signal makes the scheduler log `scheduled backup ended by signal N` and print the unrecorded line, with no set id;
  - new test mode `--run-once <limit> <killGrace>`.
- `docker-compose.yml`, `.env.example`, `docs/OPERATIONS.md` (settings tables, the "When a run does not complete" lines, exit 5) and the website environment page gain `BACKUP_MAX_RUN_SECONDS`. `tests/unit/compose-backup.test.ts` pins it.

**Tests:**
- `tests/unit/backup-scheduler.test.ts`, 4 new cases:
  - a fake run that ignores TERM is killed (exit 137, the four scheduler lines and one unrecorded line);
  - a fake run that handles TERM ends with its own code 2;
  - a run within the limit is not touched;
  - an invalid `BACKUP_MAX_RUN_SECONDS` exits 2.
- `tests/integration/backup-consistency.test.ts`, describe "K143 run liveness":
  - *main killed*: only the main shell is killed (`sh -c 'kill -9 <pid>'` inside the runner) at `after-dump` with TTL 6. Then the fence session ends, the lease expires and stays expired for 4.5 s more, and the next sweep deletes the queued file;
  - *one renewal error*: right after a confirmed renewal (TTL 15), connections to the isolated database are refused for 6.5 s (`ALTER DATABASE ... ALLOW_CONNECTIONS false`, issued from the shared database). The run then logs the retry, keeps its lease and succeeds with a consistent set.
- `backup-consistency`, existing cases changed: G3 and takeover now expect exit 5, the unrecorded line and the per-set file.
- `tests/integration/backup-failures.test.ts`:
  - *hung connect*: a listener inside the runner accepts and never answers. The run ends within 60 s with exit 5, `database not reachable`, the unrecorded line and the per-set file, and `backup:lastRun` is unchanged;
  - *run deadline*: a dump waits on a held ACCESS EXCLUSIVE lock (lock timeout 300s, `BACKUP_MAX_RUN_SECONDS` 8). The run ends within 45 s with exit 2, `backup aborted: run deadline passed` and a recorded failed status;
  - the lease-lost case now expects exit 5 and the record.

**Runs:**
- Unit, old `scheduler.sh`: exit 1, 4 failed, 26 passed (30).
  - The loop-mode case hung for 134 s, because the old scheduler started its daily loop. I stopped that process (my own `sh` process) with TERM, and its spawn now has a 10 s timeout.
  - The first green runs failed twice: the fakes' `sleep` held stdout open, and a watchdog kill race left a sleep orphaned. That led to the polling watchdog.
  - Green: exit 0, 30 passed (30).
- Integration `backup-consistency -t "K143"`, old `aida-backup.sh` with the new `lib.sh`:
  - the first red attempt had two red runs for the wrong reason. `kill` is not a binary in the image (exit 127), and Postgres refuses `ALLOW_CONNECTIONS false` from a session on the same database. I fixed the tests and repeated the red run;
  - repeated red: exit 1, 3 failed, 16 skipped (19). G3 has no unrecorded line. *Main killed*: after 15 s the fence session was still there, and afterEach found the lease row. The old orphaned renewer kept the fence FIFO open and renewed the lease. *Renewal error*: the run aborted with `lease lost` and no retry line;
  - takeover's earlier red: exit 1 on the same line;
  - green: exit 0, 4 passed, 15 skipped. After the `exec 7>&-` change: exit 0, 5 passed, 14 skipped (G2 included).
- Integration `backup-failures -t "hung connect|lease lost writes"`, old `lib.sh` and old `aida-backup.sh`: exit 1, 2 failed, 17 skipped (19). The hung run took 149.9 s and ended only when the listener exited; the lease-lost case expected 5 and got 2. Green: exit 0, 2 passed.
- Integration `backup-failures -t "run deadline"`, old `aida-backup.sh`: exit 1, 1 failed, 19 skipped (20), after 120.3 s: the dump outlasted the test's 120 s transaction. Green: exit 0, 1 passed.

**Commit:** `f1b00ad` fix(09-F3): b-WR-1, b-WR-2, b-WR-5 run deadline, renewal follows the run, bounded connects (K143)

### b-WR-3: the missing files and their rows are named

**Change.** `referenced_from_dump` now also emits `<Table> <row id>` for each reference (the `id` column; a missing one fails verification). If verification finds missing members, `log_missing` runs before the exit trap removes `RUN_TMP`. In key order it prints up to 20 lines, `[backup] missing: <organizationId>/<storageKey> (<Table> <id>[, ...])`, then `[backup] missing: N more not listed`. Only members and row ids that match their expected shape are printed; anything else prints as "an entry of unexpected shape". No file content and no other column is printed. `docs/OPERATIONS.md` (the `verification` row) describes the lines and the remedy.

**Tests** (`backup-consistency`, "verification covers every stored-file kind"):
- the three negative controls (ticket attachment, task attachment, logo) now assert the exact line with the referencing row's id;
- a new cap case removes 23 referenced files and expects 20 lines, in key order, and `3 more not listed`.

**Runs:** red, `aida-backup.sh` at `f1b00ad`: exit 1, 4 failed, 16 skipped (20); no `missing:` line. Green: exit 0, 4 passed.

**Commit:** `c9661ec` fix(09-F3): b-WR-3 name the missing files and their rows when verification fails

### b-WR-4 / K144: one fence connection while a delete is pending

**Change.** In `src/lib/storage/file-fence.ts`:
- each provider has one slot. While its previous handle has not closed, `open()` waits up to `FENCE_SLOT_WAIT_MS` (2 s, for a handle that is only finishing its unlock). It then refuses with the new reason `delete-pending` without connecting;
- the fence client gets `connectionTimeoutMillis` 10 s and `statement_timeout` 30 s;
- the worker job keeps one provider per process.

The slot belongs to the provider, not the module. The Phase 14 overlap test runs two sweeps at once in one process, standing for two workers, so its sweep 2 now gets its own provider. `project-file-cleanup.test.ts` also creates a fresh provider for each case.

**Test** (`tests/integration/file-fence.test.ts`, new case K144): four sweep ticks through one provider over a delete that hangs (ioBudget 300 ms):
- tick 1 gives `failed: 1`;
- ticks 2 to 4 each give `skipped: "delete-pending"`;
- exactly one `aida-delete-fence` lock is held after every tick, and only one handle was opened;
- after the delete settles, no lock is held, and the next tick deletes the other 3.

**Runs:**
- Red, original `file-fence.ts`: exit 1, 1 failed, 14 skipped (15). Tick 2 opened a second connection and returned `failed: 1`.
- Green: exit 0, 1 passed.
- The first full `project-file-cleanup` run after the change failed: exit 1, 1 failed, 10 passed (11). In the EACCES case, back-to-back sweeps were refused while the previous handle was still unlocking. The 2 s wait and the fresh provider per case fixed it: exit 0, 11 passed.

**Commit:** `89c0df1` fix(09-F3): b-WR-4 one fence connection per sweep provider while a delete is pending (K144)

### b-IN-1: one rule for organization folders starting with `-`

**Change.** `lib.sh` defines the member shape once (`MEMBER_ORG_RE`, `MEMBER_KEY_RE`, `MEMBER_PATH_RE`), and the organization part never starts with `-`. The backup's find patterns and its post-archive check use it, and `member_list_ok` already used `MEMBER_PATH_RE`. Both sides now refuse such a folder: the backup counts it as skipped instead of archiving it into a set that restore refuses.

**Test** (`backup-consistency`, "archive tolerance and odd entries"): a folder `-<orgId>` holding one file. `member_list_ok` refuses the member (exit 1), and the backup publishes without it: it is in neither the archive nor `uploads.sha256`, and `skippedEntries` is 2.

**Runs:** red, mutation `MEMBER_ORG_RE` back to the old `[A-Za-z0-9_-]{1,64}`: exit 1, 1 failed, 20 skipped (21); the member was archived. Green: exit 0, 1 passed.

**Commit:** `881425e` fix(09-F3): b-IN-1 one rule for organization folders starting with '-' in backup and restore

### Other part b info items

b-IN-2 to b-IN-6 are recorded unchanged in `deferred-items.md`, one line each with the finding id.

**Commit:** `8a25915` docs(09-F3): record part b info items not fixed in F3

### Final checks

| Command | Exit | Counts |
|---|---|---|
| `pnpm lint` | 0 | 671 files, 1 warning, pre-existing (`tests/unit/container-config.test.ts:160`) |
| `pnpm typecheck` | 0 | 0 errors |
| `pnpm test` | 0 | 95 files, 1676 tests passed |
| integration `backup-consistency.test.ts` | 0 | 21 passed |
| integration `backup-failures.test.ts` | 0 | 20 passed |
| integration `backup-restore-roundtrip.test.ts` | 0 | 22 passed |
| integration `file-fence.test.ts` | 0 | 15 passed |
| integration `project-file-cleanup.test.ts` | 0 | 11 passed |

Containers:
- F3 started no container by hand. The integration files' helpers started their rule-J runner containers (`startBackupRunner`) and removed them.
- The existing G3 case paused and unpaused its own runner, through the helper.
- The new *main killed* case killed one process inside the runner; no container was killed.
- After the runs, `docker ps -a` showed no container carrying the run id.

### Not done, and limits

- **Children of a killed run.** The scheduler's KILL ends only the script's shell. A child that still hangs (for example `pg_dump`) ends at its own `bounded` deadline, not at the KILL. The orphaned renewer stops at its next tick, at most TTL/3 later. This was shown for `kill -9`. No test kills the shell while a bounded child hangs.
- **Steps outside `bounded`.** `sha256sum`, `sort`, `stat` and the manifest write on the backups volume are bounded only by the renewer's stop 120 s past the deadline and by the scheduler. A hang in one of them was not tested. `bounded` needs `timeout(1)`, which is in the image (the deadline case passed in it). Without it, commands run unbounded.
- **Restore has no deadline.** `aida-restore-set.sh` gets `PGCONNECT_TIMEOUT` through `lib.sh`, but no run deadline.
- **K144 is per process.** Two worker processes would each hold one fence connection. The single-server deployment runs one worker.
- **Docs.** The website's backup-and-restore page was not changed for the new log lines. Only `docs/OPERATIONS.md` and the website environment page were.
- **Real Compose not exercised.** The scheduler's watchdog was tested only with a fake run on the host's `sh` (bash in POSIX mode on macOS), not inside the `backup` service. The compose change was checked only by the unit pin.
- **Human verification:** K143 (renewal margin, deadline, the lease-lost exit 5) and K144 (slot semantics, the 2 s wait) are logic changes.
- **Manual items:** none for this batch (no UI change).

## F4

**Date:** 2026-11-12. **Scope:** part a (`09-REVIEW.md`): a-WR-1 (K145), a-WR-2 (K146), a-WR-3, a-IN-2 and a-IN-6. The other part a info items are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree, as the dispatch asked. Runs used `AIDA_TEST_RUN_ID=mwdmf9mj-72630d119ae68b2b` and the Colima `DOCKER_HOST` (`colima status` exit 0 and `docker info` exit 0 first). One test process ran at a time, and exit codes were read without a pipe. For each red run the old file (a scratch copy taken before the first edit, or `git show HEAD:<path>`) was swapped in, and the new file was then restored with `cp` and checked with `cmp` (exit 0 every time). No code path deletes demo or tenant data; the only new outcomes are refusals that write nothing. **Result:** 5 of 5 in-scope findings fixed, 5 fix commits and 1 docs commit. a-WR-1 and a-WR-2 are logic changes and **require human verification**.

### a-WR-3: equal admin and agent demo emails are refused before any write

**Change.**
- `src/lib/demo/tenant-guard.ts`: new `demoIdentitiesCollide(env)`, true when the two configured demo emails are the same address after lower-casing. `runGuardedDemoSeed` checks it first, before the lock and before any read or write, and returns the new outcome `refused-config`.
- `src/lib/demo/bootstrap-demo.ts` logs one line for it: `[demo] Refusing to seed: DEMO_ADMIN_EMAIL and DEMO_AGENT_EMAIL are the same address; nothing written. Set two different addresses.` The boot returns normally.
- `prisma/seed.ts` prints the `[seed]` form of that line and exits 1.
- `docs/OPERATIONS.md` (Demo mode) states that the two addresses must differ.

**Test.** New case in `tests/integration/demo-boot.test.ts`. The agent email is the admin email in upper case, on an empty database. The seed CLI exits 1 with the line, and the demo boot returns with its line. Both print no password and no delete advice, and the full table inventory is unchanged after each run.

**Runs** (`-t "equal admin and agent"`):
- Red, old `tenant-guard.ts`, `bootstrap-demo.ts` and `seed.ts`: exit 1, 1 failed, 20 skipped (21). The seed CLI printed `[bootstrap] Created admin: ...` instead of the refusal. That was the first of the three committed writes.
- Green: exit 0, 1 passed, 20 skipped (21).

**Commit:** `a21311b` fix(09-F4): a-WR-3 the demo guard refuses equal admin and agent demo emails before any write

### a-WR-2 / K146: bootstrap failures never stop `register()`, and the boot lock waits are bounded

**Change.**
- `src/lib/tenant-seed-lock.ts`:
  - new option `maxWaitMs`, the pooled-connection wait (default 30 s as before);
  - new constant `BOOT_TENANT_SEED_LOCK_OPTIONS` = `{ lockTimeoutMs: 10_000, maxWaitMs: 10_000 }`.
- `src/lib/bootstrap.ts`, `bootstrapFromEnv(lockOptions)`:
  - a lock timeout still logs its one line;
  - every other failure now logs `[bootstrap] Skipped the headless admin bootstrap after an error (<class>[, <code>]); the app starts without it.` and returns. The class and the code are printed only when they match a fixed shape. The message is never printed, because it can quote the email.
- `runGuardedDemoSeed` passes `maxWaitMs` through, and `bootstrapDemoMode(lockOptions)` passes both waits.
- `src/instrumentation.ts` passes `BOOT_TENANT_SEED_LOCK_OPTIONS` to both steps.

**The stated bound** (in the constant's comment and in `docs/OPERATIONS.md`, Demo mode, "Boot never waits long on the lock"):
- the bootstrap and the demo boot each wait at most 10 s for a connection and 10 s for the lock;
- so `register()` waits at most 40 s in total before the app serves, plus the run time of a bootstrap or demo seed that does run.

The seed CLI and other callers keep the 120 s and 30 s defaults.

**Test.** New `tests/unit/boot-tenant-seed-lock.test.ts`. The real `instrumentation.ts`, `bootstrap.ts`, `bootstrap-demo.ts` and `tenant-guard.ts` run. Only `withTenantSeedLock`, the database, Better Auth, the demo data module and the pepper check are replaced. Three cases:
- an injected `PrismaClientKnownRequestError` with code P2028, whose message quotes the email and the password: `register()` resolves, exactly the one fixed line is logged, and neither the email nor the password appears;
- a non-Error rejection: `register()` resolves and logs `unknown error`;
- with `DEMO_MODE=true` and a lock timeout on both steps: two lock calls, each with `{ lockTimeoutMs: 10000, maxWaitMs: 10000 }`, and the two skip lines.

**Runs:**
- Red, all five old source files swapped in: exit 1, 3 failed (3). Case 1 failed with "promise rejected ... instead of resolving", which is the review's scenario. Case 3 failed with `expected undefined to deeply equal { lockTimeoutMs: 10000, ... }`.
- **Deviation during the red run.** The shell is zsh, so an unquoted `$F` list did not split. The scratch backup of the new files therefore failed, and the red swap overwrote them. The red result stands, because the old files were in place. I re-applied the same edits from the same script (identical diff stat, 59 insertions and 15 deletions over 5 files) and backed them up before going on. Every later loop used explicit paths.
- Green: exit 0, 3 passed. `tsc` exit 0, Biome exit 0 after formatting the test file.

**Commit:** `f694255` fix(09-F4): a-WR-2 bootstrap failures never stop register(), and boot lock waits are bounded (K146)

### a-WR-1 / K145: the /setup wizard counts and creates under the tenant seed lock

**Change.**
- `src/app/(auth)/setup/actions.ts`: the user count, `signUpEmail`, `createOrganization` and the `setupComplete` upsert now run inside `withTenantSeedLock`. The count and the upsert go through the lock's transaction. The new `SETUP_TENANT_SEED_LOCK_OPTIONS` sets 10 s for the lock and 10 s for the pool.
  - A `TenantSeedLockTimeout` returns `{ error: "Setup is busy right now. Please try again in a moment." }` and writes nothing.
  - `redirect()` runs after the transaction has committed, outside the lock.
- `src/lib/demo/identities.ts`: `createDemoIdentities` also refuses (throws) when any user exists, not only an organization, as the review's fix suggests. That narrows the window for any writer that still bypasses the lock.
- The header of `tenant-seed-lock.ts` and the `docs/OPERATIONS.md` Demo mode paragraph now say that `/setup` takes the lock, waits up to 10 s and then answers busy, and that user sign-up outside `/setup` does not take it.

**Test.** New `tests/integration/setup-seed-lock.test.ts`. `completeSetup` runs in-process through the real Better Auth and Postgres, with only `redirect` replaced, as in `auth-setup.test.ts`. The seed runs as a child through the demo driver. Each case gets its own database. Three cases:
- **Held lock.** A pg client holds the lock and reads 0 users, which is the seed's "empty" view. `/setup` then shows up as a waiting advisory lock in `pg_locks` within 8 s, and no user or organization exists while the lock is held. After the release it redirects, and exactly the setup admin and `setup-org` exist.
- **Busy.** A lock held past the setup wait: `/setup` answers busy in under 30 s and writes nothing.
- **Contention.** The seed child queues on a held lock first, then `/setup` queues (2 waiters), then the lock is released. Exactly one organization exists. Either `/setup` redirected and the seed was `refused-foreign` (no marker, no tickets), or `/setup` answered already-completed or busy and the seed seeded the complete demo (marker, 30 tickets, only the demo users). The two never both happen.

**Runs:**
- Green attempts 1 to 3 failed for reasons in the test, not the code:
  - `src/lib/db.ts` caches the pool and the client under `Symbol.for` keys, not `globalThis.prisma`, so the second and third cases still used the first database;
  - `createIsolatedDatabase` keeps the current `DATABASE_URL` as its admin URL for `drop()`, so a drop in `afterAll` connected to an already dropped database.

  The helper now ends and clears the cached pool, the client and pg-boss, and it creates each database from the shared URL.
- Green: exit 0, 3 passed (3).
- Red, old `actions.ts` (`git show HEAD:`): exit 1, 3 failed (3).
  - Held lock and contention: `expected false to be true`, meaning `/setup` never waited on the lock.
  - Busy: `expected 'NEXT_REDIRECT:/login?setup=complete' to deeply equal { error }`, meaning `/setup` created the workspace while the lock was held.

**Commit:** `7f96635` fix(09-F4): a-WR-1 the /setup wizard counts and creates under the tenant seed lock (K145)

### a-IN-2: a `$` in `POSTGRES_PASSWORD` is documented

**Check first** (ad hoc, not committed). `docker compose -p aida-test-f4-envcheck config --format json` renders only and creates nothing. It ran with a scrubbed environment and four temporary env files:
- `POSTGRES_PASSWORD=ab$cd` and `"ab$cd"`: every service gets `ab`;
- `'ab$cd'` and `ab$$cd`: every service gets `ab$cd`. `config` prints a literal `$` back as `$$`, so the rendered value is `ab$$cd`, for `db` and for the app's `AIDA_EXPECT_DB_PASSWORD` alike.

**Change.**
- `.env.example` (under the `AIDA_DATABASE_URL` note) and the `POSTGRES_PASSWORD` row of `docs/OPERATIONS.md` explain the case: single-quote the value or write each `$` as `$$`, and pass the generator the real password, single-quoted in the shell.
- The `docs/OPERATIONS.md` troubleshooting entry for the mismatch error names this cause.
- The usage comment of `scripts/database-url.sh` says the same; its mode stays 100755.

**Test.** New `tests/unit/env-dollar-docs.test.ts` pins the three files and the two examples. Red, old files: exit 1, 4 failed (4). Green: exit 0 together with `install-script`, `rate-limit-pepper-boot` and `db-url` (which run the generator): 4 files, 53 passed.

**Commit:** `9a0907c` fix(09-F4): a-IN-2 document how Compose treats a $ in POSTGRES_PASSWORD

### a-IN-6: LAUNCH.md item 3 matches the README

**Change.** Item 3 now reads: no new widget or tracking image was added, and the existing badges stay. The CI badge loads from GitHub, and the license and docs badges are third-party images from `img.shields.io`. Replace them with plain links if no third-party image should load. The README is unchanged; replacing the badges is the owner's choice.

**Check** (ad hoc shell check, not committed: if the README loads `img.shields.io`, LAUNCH.md must not say "No third-party widget" and must name `img.shields.io`). Red on the old LAUNCH.md: exit 1. Green: exit 0.

**Commit:** `820fe5f` fix(09-F4): a-IN-6 LAUNCH.md says the README's shields.io badges are third-party images

### Other part a info items

a-IN-1, a-IN-3, a-IN-4, a-IN-5 and a-IN-7 are recorded unchanged in `deferred-items.md`, one line each with the finding id.

**Commit:** `9a50293` docs(09-F4): record part a info items not fixed in F4

### Final checks

| Command | Exit | Counts |
|---|---|---|
| `pnpm lint` | 0 | 674 files, 1 warning, pre-existing (`tests/unit/container-config.test.ts:160`) |
| `pnpm typecheck` | 0 | 0 errors |
| `pnpm test` | 0 | 97 files, 1683 tests passed |
| integration `seed-guard.test.ts` | 0 | 3 passed |
| integration `demo-boot.test.ts` | 0 | 21 passed (the new a-WR-3 case included) |
| integration `auth-bootstrap.test.ts` | 0 | 3 passed |
| integration `auth-setup.test.ts` | 0 | 4 passed |
| integration `setup-seed-lock.test.ts` (new) | 0 | 3 passed |

The full integration suite was not run, only these five files. F4 started no container by hand: the integration global setup started its Testcontainers Postgres under the run id. The only Docker command outside the tests was the render-only `docker compose config` of a-IN-2, which creates nothing. F4 removed no container or volume.

### Not done, and limits

- **No held-lock integration case for `bootstrapFromEnv`.** The a-WR-2 timeout branch and the boot bound are proven in-process by the unit test, with `withTenantSeedLock` replaced. The real 10 s waits against a held lock in a child process were not run (a-IN-7, deferred).
- **The 40 s bound excludes work.** It covers the waits only. A bootstrap or demo seed that gets the lock runs to its end, and the demo seed can take longer than the waits. The transaction bound (600 s, a-IN-3) is unchanged.
- **The contention case takes one order.** Postgres grants the lock in queue order, and the seed child queues first, so the case always exercises "the seed wins, and `/setup` answers already-completed or busy". The other order is covered by the held-lock case. I did not check which branch each run took beyond the assertions.
- **The `/setup` UI was not exercised.** The busy message reaches the form as an ordinary `{ error }` result, but no E2E run or manual check was made. The E2E global setup (next-o1) was not run, and `.next` was not moved.
- **Human verification:** K145 (the setup flow under the lock, and the busy answer after 10 s) and K146 (the catch-all and the bound) are logic changes.
- **`STATE.md`** was not touched, and no tool changed it. The untracked `.planning/state.json` was there before F4 and was left alone.
