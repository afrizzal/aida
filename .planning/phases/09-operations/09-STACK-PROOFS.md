# Phase 9 stack-level proofs (specification)

Written by plan 09-11 on 2026-11-12 (CONTEXT U-15). Phase 9 builds no container harness of its own. The three proofs below are written as tests on the Phase 8.1 harness (`deferred-8.1/08-14-PLAN.md`: `tests/container/support/compose-harness.ts`, `tests/container/compose.override.yml`) once the owner releases Phase 8.1. Until then every proof is not run, and the stack clauses of AIDA-33 and AIDA-35 stay open. Phase 9 does not edit `deferred-8.1/`.

No `tests/stack/` file, no `test:stack` script, no stack gate variable and no compose project named `aida` exist for Phase 9 (checked by plan 09-11 Task 1).

## Rules every proof follows (charter rule J, CONTEXT U-07)

- Compose project name `aida-test-stack-<runId>`, where `<runId>` is `AIDA_TEST_RUN_ID` (`tests/support/docker-test-labels.ts`, `testRunId`). Never project `aida`, `aida-dev-db` or any other project.
- The real `docker-compose.yml` plus a rule-J overlay from the harness:
  - the labels `aida.test=1` and `aida.test.run=<runId>` on every service, network, volume and build;
  - run-tagged images that never overwrite an existing tag (`assertTagsFree`);
  - Postgres data on tmpfs;
  - run-scoped volume names (`aida-test-...`);
  - no published host ports 80 or 443 (Caddy is either left out or bound to no host port).
- Before any build or `up`: the J1 lock (`acquireLock`), `assertProjectAbsent`, `assertNamesAbsent`, `assertTagsFree`, `assertComposeFollowsRuleJ` on the rendered configuration, and `runBuildPreflight`, which needs 20 GiB free on the host and in the VM (`MIN_FREE_BYTES`). A preflight stop is recorded `blocked (space)` with the measured sizes, never as passed.
- Cleanup only by label and prefix, through the J1 helpers and `scripts/test-docker-cleanup.ts`. No prune, no removal by name outside the run's prefix, nothing outside the run's labels.
- Assertions about secrets print booleans only. No captured log, trace or report contains a password.
- One stack at a time. A proof that needs two stacks removes the first by its own labels before it creates the second.

## SP-1: the real `backup` service runs on a schedule in the compose stack

Status: not run (waiting for the Phase 8.1 harness and the owner)

**Purpose and clauses closed.** AIDA-33, "Backups run on a schedule inside the single compose stack", and "no Redis and no managed service", observed in a running stack. Plans 09-06, 09-08 and 09-13 prove the script and the scheduler on Testcontainers Postgres and temporary directories. This proof runs the same files in the real services.

**What it starts.** `db`, `migrate`, `backup-init` and `backup` from `docker-compose.yml`, with the overlay above. `app` and `worker` only if the harness needs them for a health signal; the proof does not depend on them. No Caddy.

**Preconditions.**
- The owner has released Phase 8.1, and its 08-14 harness exists.
- The 20 GiB host and VM preflight passes.
- The project `aida-test-stack-<runId>` and the run's image tags are absent.

**Steps.**
1. Render the configuration with `BACKUP_SCHEDULE` set to the next whole UTC minute (format `HH:MM`, the compose default is `02:00`) and `BACKUP_RETENTION` 7. Check the rendered configuration with `assertComposeFollowsRuleJ`.
2. `up` the services listed above. Wait for `migrate` and `backup-init` to exit 0, and for `backup` to be running.
3. Wait at most until two minutes after the scheduled minute, then read the backups volume and the `SystemSetting` row `backup:lastRun`.

**Assertions.**
- `backup-init` exited 0. The run's backups volume root is owned `1000:1000` with mode `0700`.
- Exactly one published set exists in the backups volume. It holds the dump, the uploads archive and the manifest, and no temporary directory is left.
- `backup:lastRun` reads `succeeded` and names that set.
- The `backup` container runs as UID 1000.
- The rendered configuration has no Redis service and no image outside the project's own and `pgvector/pgvector:pg16`, `caddy` and the run-tagged app image.

**Cleanup.** Remove the run's resources by label and prefix through the J1 helpers.

## SP-2: restore into an isolated stack, with a content comparison

Status: not run (waiting for the Phase 8.1 harness and the owner)

**Purpose and clauses closed.** AIDA-33, "a test restores a set into an isolated stack and compares attachment records with their file contents". Per U-14 it covers `Attachment`, `TaskAttachment` and the workspace logo (`branding:logo`). Per U-16 it also checks that restored uploads are owned by `node` (1000) and that the app can read and write them. Plan 09-10 proves the component round trip on Testcontainers only.

**What it starts.** Two stacks in sequence, never at once:
- stack A, `aida-test-stack-<runId>-a`;
- stack B, `aida-test-stack-<runId>-b`.

Each is the real `docker-compose.yml` with the overlay and fresh run-scoped volumes. Each runs `db`, `migrate`, `app`, `worker`, `backup-init` and `backup`.

**Preconditions.** As SP-1. In addition, both project names are absent, and a run-scoped host directory under `${TMPDIR}` exists for the copied set.

**Steps.**
1. Stack A: seed through the app the fixture data: an organization, ticket attachments, a project task attachment and a logo. Record each record's storage key and the sha256 of its file, in memory.
2. Stack A: run `scripts/backup.sh` through the harness (one manual run in the `backup` service). Copy the published set out of A's backups volume into the run-scoped host directory with a tar stream.
3. Remove stack A by its own labels, volumes included. Check that nothing of A is left.
4. Stack B: `up` with fresh volumes. Copy the set into B's backups volume. Run `scripts/restore.sh <setId> --yes` through the harness, so that the wrapper's docker calls stay within project B.
5. Stack B: read every `Attachment`, `TaskAttachment` and `branding:logo` record from the database, and hash each referenced file in B's uploads volume.

**Assertions.**
- `restore.sh` exits 0.
- The set of records equals the recorded set, and for every record the sha256 of the restored file equals the recorded one.
- Every restored file under uploads is owned by UID 1000.
- Through the app, the restored attachment downloads, and a new upload succeeds after the restore.
- The public logo route serves the restored logo with its stored MIME type.
- `app` and `worker` are healthy again after the restore.
- At no time do both projects exist (checked before each `up`).

**Cleanup.** Remove stack B by label and prefix. Remove the run-scoped host directory with `rm -r --`.

## SP-3: boot with a reserved-character database password

Status: not run (waiting for the Phase 8.1 harness and the owner)

**Purpose and clauses closed.** AIDA-35:
- "a stack booted with the same password connects from `migrate`, `app` and `worker`";
- "no log or recorded evidence contains the password".

The first AIDA-35 clause, the `docker compose config` check, is already proven host-side by plan 09-01 (`tests/integration/compose-database-url.test.ts`).

**What it starts.** `db`, `migrate`, `app` and `worker` from `docker-compose.yml`, with the overlay. No Caddy, no published ports.

**Preconditions.** As SP-1.

**Steps.**
1. Generate in memory a synthetic password that contains `/ @ : # ?` and at least 16 random characters. It is never written to a tracked file or a log.
2. Build `AIDA_DATABASE_URL` from it with `scripts/database-url.sh`, and pass both values to compose through the process environment or a run-scoped temporary env file that is removed at cleanup.
3. `up` the services. Wait for `migrate` to exit, and for `app` and `worker` to be healthy or to fail.

**Assertions.** Each prints a boolean only.
- `migrate` exits 0, and the boot guard `scripts/check-database-url.ts` passed.
- `app` answers `ok` on `/api/health/probe` inside the container, the path the container healthcheck uses, never through Caddy.
- `worker` writes its heartbeat: the `SystemSetting` row `heartbeat:lastRunAt` appears or advances after the worker started. This is the positive database proof from the worker.
- A search of every captured log (compose logs of every service, the harness output, the test reporter output) for the password, its percent-encoded form and its URL form finds nothing.

**Cleanup.** Remove the run's resources by label and prefix. Remove the temporary env file, if one was used.

## Phase 9 facts the Phase 8.1 replan must account for

Taken from the U-02 contract sections of 09-01, 09-05, 09-08 and 09-10.

1. **Database URL (09-01).**
   - `migrate`, `app` and `worker` read `DATABASE_URL: ${AIDA_DATABASE_URL:-postgresql://...}`, plus `AIDA_EXPECT_DB_USER`, `AIDA_EXPECT_DB_PASSWORD` and `AIDA_EXPECT_DB_NAME`.
   - The `migrate` command runs `scripts/check-database-url.ts` before `prisma migrate deploy`. It still runs on `target: builder` as `node`.
   - `docker-compose.egress-test.yml` is unchanged and keeps its own fixture URL.
2. **Logo route (09-05).**
   - The route is `GET /api/public/logo/<orgId>/<version>`, public through the existing `/api/public` entry of `PUBLIC_PREFIXES`. `src/proxy.ts` and the CSP are unchanged; `img-src 'self'` covers the logo.
   - It is limited with `consumeRateLimit("public-logo", getRateLimitIdentity(request), { max: 300, windowMs: 60000 })`.
   - Logo files are written by the app as `node` with default modes, under `<UPLOADS_DIR>/<orgId>/`. The old file is removed only by the fenced `ProjectFileCleanup` sweep.
3. **Backup services (09-08).**
   - Two new services, both on `pgvector/pgvector:pg16` with no build:
     - `backup-init` is the only root service: `0:0` with `CAP_CHOWN` only, `network_mode: none`, a read-only root filesystem, the backups mount point only, and `restart: "no"`;
     - `backup` runs as `1000:1000`, uses libpq variables with `PGPASSWORD`, mounts `uploads_data` read-only, and has `restart: unless-stopped`.
   - One new named volume, `backups_data`.
   - What 08-14 and 08-16 must do:
     - the 08-14 non-root proof must not count `backup-init` as a regression;
     - the 08-16 compose gate sees `backup-init` exit 0 and `backup` stay up;
     - whether `backup` joins the egress stack is a Phase 8.1 decision.
4. **Restore (09-10).**
   - The restore runs in one-off containers of the `backup` service (`user: "1000:1000"`), with the real uploads volume mounted at `/restore/uploads` and `RESTORE_HOLDER` and `UPLOADS_DIR` set.
   - A Phase 8.1 change to the `backup` service's user, mounts or environment must keep that interface.
   - `docs/OPERATIONS.md` sections `## Backups`, `## Restore`, `## Restore to a new server`, `## Upgrading` and `## Troubleshooting` changed in Phase 9. `docs/SECURITY.md` gained one logo bullet; its line 8 is still owner item 08-o4 / plan 08-15.
