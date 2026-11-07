# Operations

The day-two runbook for a self-hosted AIDA instance: backups, restore, upgrades, logs, health checks, and every environment variable. Written for a single-server operator, not a platform team — every command here runs against the shipped `docker-compose.yml` as-is, with Docker Compose v2 (the `docker compose` command; the legacy Compose v1 binary is not supported).

## Backups

A **complete** AIDA backup has two parts, and both are required to restore an instance:

1. A **Postgres dump** (`pg_dump --format=custom`): tickets, contacts, messages, KB articles, insight runs, settings, everything in the database.
2. An **archive of the `uploads_data` volume**: every ticket and task attachment and the workspace logo. Files live on disk under `/data/uploads`, not in Postgres, so a database-only dump silently loses every attachment. The `app` and `worker` services share this volume: the app stores uploads, and the worker stores inbound email attachments and runs the scheduled job (every minute) that removes the files of deleted attachments.

**A database-only dump is not a complete backup.** Never treat `pg_dump` alone as sufficient.

**Backups contain tenant data.** Every set holds the whole database and every stored file of every workspace on the instance. They stay on this server: copying them off the host, and controlling who can read them there, is your job (see [Copying backups off the host](#copying-backups-off-the-host)).

### Scheduled backups: the `backup` service

`docker compose up -d` starts a `backup` service with the rest of the stack. It is on by default and runs one backup every day:

| Setting | Default | Meaning |
|---|---|---|
| `BACKUP_ENABLED` | `true` | `false` keeps the service up without running any backup; it logs `[backup] backups disabled (BACKUP_ENABLED=false)` once. |
| `BACKUP_SCHEDULE` | `02:00` | The daily run time, `HH:MM`, 24-hour, **UTC**. An invalid value logs `[backup] invalid BACKUP_SCHEDULE: use HH:MM, 24-hour UTC, for example 02:00` and the service exits with code 2 (and is restarted, logging the line again, until you fix it). |
| `BACKUP_RETENTION` | `7` | How many successful sets are kept, 1 to 9999. After each successful run, older sets are removed. Failed runs never count and never remove a set. |
| `BACKUP_LEASE_TTL_SECONDS` | `900` | Advanced. How long the backup's lease lasts before it must be renewed (the run renews it every third of this time). |
| `BACKUP_FENCE_WAIT_SECONDS` | `300` | Advanced. How long a run waits for a file deletion that is in progress before it gives up with `file fence busy`. |
| `BACKUP_MAX_RUN_SECONDS` | `21600` | Advanced. The longest one run may take (6 hours), 1 to 999999. A step still running at that point is stopped and the run fails with `backup aborted: run deadline passed`; the scheduler stops a run that is still there 180 seconds later. |

Change a setting in `.env`, then recreate the service: `docker compose up -d backup`. The exact time of the next run is in the log (`[backup] next backup in <seconds>s`). A run that is exactly due when the previous one ends waits for the next day; there is never a second run in the same minute.

The service uses the same image as `db` (`pgvector/pgvector:pg16`, which ships `pg_dump` and `pg_restore`), so there is no extra image to build or pull. It runs `scripts/backup/scheduler.sh`, mounted read-only from this checkout, and reaches the database with the libpq variables `PGHOST`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` taken from `POSTGRES_*`, never with a connection URL, so a password with URL-reserved characters needs nothing extra here.

**Why it runs as `1000:1000`.** `app` and `worker` run as the image's `node` user, UID and GID 1000, and the files they store keep the default modes. Running the backup as the same numeric user lets it read every stored file without root. The PostgreSQL image has no `node` account, so the compose file names the user by number. The uploads volume is mounted **read-only** into `backup`: a backup can read stored files but never change or delete one.

### The one-time preparation: `backup-init`

A new named volume's root directory is created owned by `root:root` with mode `0755`, so user 1000 cannot write into a fresh `backups_data` volume. The PostgreSQL image has no account or directory owned by 1000 that the volume could inherit, and AIDA does not build an extra image for this. The alternative, a root entrypoint in `backup`, would run the whole backup as root. So one one-shot service, `backup-init`, runs as root before `backup` starts and does only this, on the `/backups` mount point of `backups_data` and nothing else:

- if the mount point already reads owner `1000:1000` and mode `700`, it exits at once (`[backup-init] /backups already 1000:1000 mode 700`);
- otherwise it sets mode `0700`, then owner `1000:1000` (`[backup-init] /backups prepared: 1000:1000 mode 700`). It never changes ownership recursively and never touches `uploads_data` or any file inside the volume.

It has no network (`network_mode: none`), a read-only root filesystem, every capability dropped except `CAP_CHOWN`, and `no-new-privileges`. It is the only AIDA container that runs as root, and this section is its written reason.

**If `backup-init` fails**, it logs `[backup-init] could not prepare /backups; see docs/OPERATIONS.md, Backups`, and `backup` does not start. Without `CAP_FOWNER` the init step can change the mode only of a directory it owns, so the usual cause is a mount point already owned by 1000 whose mode was changed by hand. The fix is a one-time `chmod 0700` on that mount point, run as its owner:

```bash
docker compose run --rm --no-deps --entrypoint chmod backup 0700 /backups
docker compose run --rm --no-deps --entrypoint stat backup -c '%u:%g:%a' /backups   # must print 1000:1000:700
docker compose up -d
```

### Where sets live

Sets live in the `backups_data` volume (Compose prefixes it with the project name, for example `aida_backups_data`), one directory per set, named by its set id (UTC time plus a random suffix, for example `20261112T020001Z-a1b2c3`):

```
<setId>/db.dump          the Postgres dump (custom format)
<setId>/uploads.tar.gz   every stored file, as <organizationId>/<storageKey>
<setId>/uploads.sha256   the sha256 of every file in the archive
<setId>/manifest.json    set id, time, AIDA version, counts, and the sha256 and size of each part
```

A run writes into a temporary `.tmp-<setId>` directory and renames it to `<setId>` only after the dump, the archive and the manifest all validated, so a directory named by a set id is always complete. To list the sets:

```bash
docker compose run --rm --no-deps --entrypoint ls backup -1 /backups
```

**How a set stays consistent.** While a backup holds its lease and the file fence, every deletion of a stored file waits (deleted files are queued and removed later by the worker), so every file the dump refers to is still on disk when the archive is taken. After archiving, the run checks that every attachment, task attachment and logo the dump references is in the archive with a checksum; if one is missing, the set fails and nothing is published.

The uploads volume carries an identity marker that the worker writes the first time its cleanup job runs on the mounted volume. A backup refuses to run (`uploads volume not verified`) when the marker is missing or does not match the database, for example when a different volume is mounted. A local `pnpm worker` outside a container deletes no stored files: its `UPLOADS_DIR` is not a mount point, so the cleanup job refuses to delete there.

### Seeing the result

- **Settings → Backups** (workspace owners and admins only) shows the most recent run: Succeeded or Failed, when it finished, the set id, and on failure one fixed sentence for its category. It shows nothing else and has no buttons: backups are configured here, on the server.
- **`docker compose logs backup`** shows every run. A success ends with `[backup] backup succeeded: <setId>`, a failure with `[backup] backup failed: <category>`, usually after a line naming the reason.

| Category | Meaning | What to check |
|---|---|---|
| `dump` | `pg_dump` failed, for example a lock it could not get in time. | The `db` service and its log; long-running transactions. |
| `archive` | The uploads archive could not be written, for example a file the backup user cannot read. | Ownership of the files in `uploads_data` (see [Upgrading an install whose containers ran as root](#upgrading-an-install-whose-containers-ran-as-root)). |
| `verification` | A file the database refers to was missing from the archive. | The uploads volume: the set was refused on purpose. The log names up to 20 missing files with the rows that refer to them, `[backup] missing: <organizationId>/<storageKey> (<Attachment, TaskAttachment or Setting> <row id>)`, and counts the rest. Restore the file into `uploads_data`, or remove the row (or the logo) in the app, then run a backup again. |
| `storage` | The backups volume could not be written or is full. | Free space on the host; the `backup-init` result. |
| `unknown` | Anything else, including the cases in the next section. | The reason line before `backup failed: unknown`. |

### When a run does not complete

These lines appear in `docker compose logs backup`:

- **`backup skipped: lease held`** (exit code 3): another backup is running, for example a manual run that overlaps the schedule. Nothing was touched; the next scheduled run tries again.
- **`backup skipped: restore in progress`** (exit code 3): a restore holds its lock (`.restore-lock` in the backups volume). Nothing more is published, no set is removed and no status is recorded.
- **`backup aborted: lease lost`**: the run could no longer renew its lease (another holder took it, the container was paused past `BACKUP_LEASE_TTL_SECONDS`, or the database stayed unreachable until only a third of the lease was left). Nothing is published. The run does not write the status in Settings, because it can no longer prove deletions were waiting, but it records its outcome as in "When the outcome cannot be recorded" below (exit code 5). The next scheduled run tries again.
- **`lease renewal failed; retrying`**: one renewal of the lease failed, for example while the database restarted. The run retries every few seconds and continues when a retry succeeds; it gives up only when a third of the lease is left (`backup aborted: lease lost`).
- **`backup aborted: run deadline passed`**: the run took longer than `BACKUP_MAX_RUN_SECONDS`, for example a dump or archive step that hung. The step was stopped and the run fails with category `unknown`. Database connects give up after 10 seconds (`PGCONNECT_TIMEOUT`), so an unreachable database fails a run quickly instead of hanging it.
- **`scheduled backup still running after <seconds>s; stopping it`** and **`scheduled backup did not stop; killing it`**: the scheduler's own limit (the run's deadline plus 180 seconds) was reached. A run that had to be killed could not record anything itself, so the scheduler prints the `AIDA_BACKUP_STATUS_UNRECORDED` line for it (without a set id). If a run is killed in any other way, its lease is no longer renewed and expires within `BACKUP_LEASE_TTL_SECONDS`, so file deletions resume and the next run proceeds.
- **`file fence busy`**: a file deletion held the fence for longer than `BACKUP_FENCE_WAIT_SECONDS`. The run fails with category `unknown`; the next one tries again.
- **`uploads volume not verified`**: see the identity marker above. The run fails with category `unknown` before any dump.
- **`database not reachable`**: the run could not reach `db`. Its failure usually cannot be recorded either (exit code 5, below).
- **`backup retention incomplete`**: the new set was published, but an old set could not be removed. The run still counts as succeeded.

**When the outcome cannot be recorded** (exit code 5), the database was unreachable when the run tried to write its status, or the run lost its lease, so Settings → Backups still shows the previous run. The outcome is kept in two places instead:

- one stderr line in the service log, `AIDA_BACKUP_STATUS_UNRECORDED {"finishedAt":...,"result":...,"setId":...,"category":...}`. Find it with `docker compose logs backup | grep AIDA_BACKUP_STATUS_UNRECORDED`;
- a file `status-unrecorded-<setId>.json` with the same four fields in the backups volume, one per run. AIDA never removes these files; delete each one once you have dealt with it:

```bash
docker compose run --rm --no-deps --entrypoint sh backup -c 'ls /backups/status-unrecorded-*.json'
docker compose run --rm --no-deps --entrypoint rm backup /backups/status-unrecorded-<setId>.json
```

### Running a backup by hand

```bash
./scripts/backup.sh
```

This takes one backup now, outside the schedule, in a one-off container of the `backup` service (as 1000:1000, the same script and settings). It requires the `db` service to be running (`docker compose up -d db`), runs `backup-init` first (it exits at once on a prepared volume), and exits with the run's code: 0 succeeded, 2 failed, 3 skipped, 5 outcome not recorded; 1 means its own preflight failed. The new set lands in `backups_data` like a scheduled one and counts towards `BACKUP_RETENTION`. Releases before this one took an output directory argument; the script now refuses one, because sets live in the volume.

`backup.sh` and `restore.sh` call `docker compose`, which needs Docker Compose v2: the legacy Compose v1 binary cannot read `docker-compose.yml` (it nests an interpolation in a default value) and has no `config --format json`, so it is not supported.

### Copying backups off the host

A backup that lives on the same disk as the instance it protects does not survive a disk failure, and AIDA copies nothing anywhere by itself. Copy sets off the host as part of your own practice, for example one set as a tar stream:

```bash
(umask 077 && docker compose run --rm --no-deps -T --entrypoint tar backup -C /backups -cf - <setId> > aida-backup-<setId>.tar)
```

`umask 077` makes the file readable by you only (mode 0600) whatever your shell's umask; keep it. Treat the copy like the database itself: it holds every workspace's tickets, contacts and files, so store it encrypted or on access-controlled storage, readable only by the people who operate the instance.

**Back up `APP_ENCRYPTION_KEY` separately.** It is not in any set. Credentials stored in Settings (IMAP and SMTP passwords, LLM provider keys) are encrypted with it, so a restore without the same key cannot read them; they would have to be entered again. Keep `BETTER_AUTH_SECRET` with it, or every session ends after a restore.

## Restore

```bash
docker compose run --rm --no-deps -T --entrypoint ls backup -1 /backups   # list the sets
./scripts/restore.sh <setId>
./scripts/restore.sh <setId> --validate-only                               # check a set, write nothing
```

Example: `./scripts/restore.sh 20261112T020001Z-a1b2c3`. The `db` service must be running. Run the script from the checkout of the release that is running: it reads that release's migrations from `prisma/migrations` (see [Which database a set can be restored into](#which-database-a-set-can-be-restored-into)).

**`--validate-only`** takes the restore lock only (no backup lease, so nothing is written to the database), checks the whole set exactly as a restore would (the four files, the manifest, the sha256 and size of every part, the dump, every archive member, the extraction into a staging directory on the backups volume and every extracted checksum) and checks that every migration of the set is in this release. It does not compare the set with the current database, writes nothing to the database or the uploads volume, stops nothing, asks no confirmation, and removes its staging directory. Exit code 0 means the set can be restored by this release; 4 a failed validation; 9 a set newer than this release.

**This is destructive.** It replaces the entire current database and the entire contents of the uploads volume with one set from the backups volume. There is no undo other than restoring a different set. Unless you pass `--yes`, the script asks you to type `restore` before it touches anything.

**Before you restore:**

- **`APP_ENCRYPTION_KEY` must be the one from the install that made the set** (keep `BETTER_AUTH_SECRET` with it). Credentials stored in Settings are encrypted with it; with another key they cannot be read after the restore and must be entered again, and with another `BETTER_AUTH_SECRET` every session ends.
- **Restoring copies tenant data.** A set holds every workspace's tickets, contacts, users and files. Restoring it into an instance gives that instance all of them, and replaces whatever the instance held.
- **A running backup makes the restore refuse.** Wait until `docker compose logs backup` shows the run ended, then try again.

What it does, in order:

1. Checks the set id and, without `--yes`, asks for the confirmation.
2. Finds the real names of the `uploads_data` and `backups_data` volumes from `docker compose config --format json` (a project name or a `name:` changes them) and checks each with `docker volume inspect`. A missing volume stops it with exit code 6; nothing is stopped.
3. Takes the **restore lock** in a one-off container of the `backup` service: a directory `.restore-lock` on the backups volume holding a new random holder (`restore-` and 32 hex characters) and a heartbeat. It lives on the backups volume, so it survives the database replacement, and it is not a write to the database. A backup that starts later sees the lock and skips (`backup skipped: restore in progress`).
4. Checks the migrations, read only, in a one-off `backup` container (`aida-restore-set.sh --check-schema`): every migration of the set must be in this release, and the target database must be truly empty or hold exactly the set's migrations. Otherwise it refuses with exit code 9 before anything is stopped; the `[restore] refused:` line says which check failed. See [Which database a set can be restored into](#which-database-a-set-can-be-restored-into). Nothing has been written to the target database before this check. The set script repeats these checks after the services have stopped, before its first write.
5. Takes the **backup lease** with the same holder when the target database has a migration history, so a backup that is running makes the restore refuse before anything is stopped. A truly empty target database has no `SystemSetting` table: no backup can hold or take a lease on it, so the restore lock alone coordinates the restore, and the restore says so (`no lease is written`).
6. Stops `backup`, `app` and `worker` (no writes, no job pickup, no backup while it runs).
7. Runs `scripts/backup/aida-restore-set.sh` in a one-off `backup` container as user 1000:1000, with the uploads volume mounted read-write at `/restore/uploads`. It renews the lock's heartbeat every 60 seconds and stops when the lock names another holder.
   - **Validation, before anything is written** (the lines say `[restore] validation: <reason>`, then `set failed validation`, exit code 4): the set directory holds exactly the four files; the set id equals the directory name and the manifest's `setId`; the sha256 and size of `db.dump`, `uploads.tar.gz` and `uploads.sha256` equal the manifest's (`<file> checksum`); `pg_restore --list` reads the dump (`dump`); every archive member is a regular file named `<organizationId>/<storageKey>` (`member name`, `member type`: no absolute path, `..`, link, device, FIFO, odd name or volume marker); the archive is extracted into `.restore-staging-<holder>` on the backups volume, and the extracted files must equal the checksum list exactly with every checksum matching (`staged checksum`); the dump must hold the uploads volume identity (`volume identity missing from the dump`).
   - **Target checks** (exit code 6, nothing written): it runs as 1000:1000; the uploads target is a mount point (`uploads target is not a mount point`); every entry in it is owned by 1000:1000 (`uploads target holds an entry not owned by 1000:1000`; see below).
   - **Database step** (exit code 7 on failure): `pg_restore --clean --if-exists --no-owner --no-privileges` into the database, then the `backup:lease` row the dump carried in is removed.
   - **Uploads step** (exit code 8 on failure): removes the volume's current entries one by one (never the volume itself), copies the extracted files in (directories 0755, files 0644, owned by 1000:1000), checks every copied file against `uploads.sha256`, and writes the volume marker `.aida-uploads-volume` from the restored database's identity, so the next backup and the file cleanup recognise the volume. Then it checks that every entry is owned by 1000:1000 and that a probe file can be created, read and removed.
   - The staging directory is removed on every exit.
8. On success: releases the lease (when it took one) and the lock. When the set is older than this release (step 4 printed `set migrations: older than this release`), it first runs this release's one-shot `migrate` service (`prisma migrate deploy`); if that fails it starts nothing and exits with code 1, and `docker compose up -d` (which runs `migrate` first) is the next step once the cause is fixed. Then it starts `backup`, `app` and `worker`, and polls the app's probe (`/api/health/probe`, inside the `app` container) for up to 60 seconds; a probe that does not answer is a warning only.

**Refusals before anything is stopped** (the set and the instance are untouched, nothing to clean up):

| Message | Exit code | What to do |
|---|---|---|
| `Another restore holds the restore lock: holder <holder>, last heartbeat <N>s ago.` | 3 | Wait for that restore. If it is no longer running, see [A restore lock left behind](#a-restore-lock-left-behind). |
| `a backup is running; retry after it finishes.` | 3 | Wait for the backup run to end, then run the restore again. |
| `Volume <name> does not exist.` | 6 | Run the script from the same checkout and project name as the running stack. |
| `Set <setId> was not found in the backups volume.` | 4 | List the sets (above) and check the id. |
| `[restore] refused: the set has N migration(s) that this release does not contain (a newer set)` | 9 | The set was made by a later release. Restore it with that release or a later one. |
| `[restore] refused: the target database has N applied migration(s) that the set does not contain (a newer schema)` | 9 | The database belongs to a later release than the set. Restore into an empty database (see below). |
| `[restore] refused: the target database lacks N migration(s) of the set (an older schema)` | 9 | The database belongs to an earlier release than the set. Restore into an empty database (see below). |
| `[restore] refused: the target database is not empty (N relation(s)) and has no migration history` | 9 | The database holds tables that are not an AIDA schema. Restore into an empty database (see below). |

### Which database a set can be restored into

`pg_restore --clean` drops and recreates only the objects that are in the dump. Any other object in the target database survives the restore next to the restored schema: a table of a newer schema that still references one the dump drops, a table of an older schema the set no longer has, or a table that is not AIDA's at all. So the restore proceeds only into one of two targets, and refuses (exit code 9) before it stops anything or writes anything otherwise:

- **A truly empty database**: no table, view, sequence or other relation in any schema except the system ones. A database that has a schema but no `_prisma_migrations` table is not empty.
- **A database whose migration history equals the set's exactly**: the names in its `_prisma_migrations` (any state, a failed one included) are exactly the names in the set's dump. This is a database of the release that made the set.

The release that runs the restore must also know every migration of the set: a set whose migrations are not all in this checkout's `prisma/migrations` is refused, because migrations only go forward and this release's code would run on a schema it does not know. When the set is older than the release, the restore runs the release's `migrate deploy` before `app` and `worker` start (step 8).

The comparison is by migration name. It does not prove that two schemas are identical: a migration that failed half way, one edited after it was applied, or a schema changed by hand can differ under the same names. Restore into an empty database when in doubt.

Two paths are supported:

- **Into a database of the release the set came from.** Run the release that made the set; its database has the same migrations as the dump, and the restore replaces it.
- **Into an empty database.** Restore into a database that has no relation yet, with the release that made the set or a later one. The restore runs that release's `migrate deploy` afterwards when the set is older. [Restore to a new server](#restore-to-a-new-server) and the rollback under [Upgrading](#upgrading) show the commands.

### What a failure leaves behind

The set script records which target it is about to write to (`target-touched` in the lock: `database`, then `uploads`) immediately before its first write to it. The wrapper reads that record on every failure and on Ctrl-C, `TERM` or `HUP`, always releases its own lock and, when it took one, its own lease, and acts on it:

| Where it stopped | Exit code | Database | Uploads volume | `backup`, `app`, `worker` |
|---|---|---|---|---|
| Validation (`set failed validation`) | 4 | unchanged | unchanged | started again; the message says nothing was changed |
| Target check | 6 | unchanged | unchanged | started again; the message says nothing was changed |
| Database step | 7, or a signal | may be partly restored | untouched | **left stopped**; the message names the database step |
| Uploads step | 8, or a signal | restored | may be partly restored (files missing) | **left stopped**; the message names the uploads step |

Before it reads that record, the wrapper stops and removes the one-off restore container by its exact name (`aida-restore-<32 hex>`, the holder with an `aida-` prefix) and waits until `docker ps -a` no longer lists it, because the `docker compose run` client can exit while its container keeps running. Only then does it release the lock or start anything. If the container is still listed after 60 seconds (`RESTORE_CONTAINER_WAIT_SECONDS`, 1 to 600), the message names it: the lock is kept and nothing is started. Check `docker ps -a --filter name=aida-restore-`, and once it is gone, see [A restore lock left behind](#a-restore-lock-left-behind).

After a failure in the database or the uploads step, do not start the services on the half-restored data. Read the lines before the message, fix the cause, and run the restore again, with the same set or another one: it replaces the database and the uploads volume again from the start. `docker compose up -d` starts everything on whatever state is there, if you decide to keep it. The restore never removes a Docker volume and never runs `docker compose down`.

### Ownership of the restored files

`app` and `worker` run as UID and GID 1000, so the restore runs as 1000:1000 too, extracts with `--no-same-owner`, and writes every restored file and directory as 1000:1000. It refuses (exit code 6, nothing written) when the uploads volume already holds an entry not owned by 1000:1000. That happens on an install whose uploads volume was written by an older release that ran as root: change its ownership first as described in [Upgrading an install whose containers ran as root](#upgrading-an-install-whose-containers-ran-as-root), then restore. After copying, the restore checks that every entry is owned by 1000:1000 and that a probe file can be created, read and removed, so the app can read and write the restored uploads.

### What the checks prove, and what they do not

The checks detect a corrupted set and a partly tampered one: a changed dump, archive or checksum list whose manifest was not changed with it, an archive whose files differ from the checksum list, and any unsafe archive member. The manifest is **not signed**, so they do not detect a set forged consistently, manifest included, by someone who can write to the backups volume. They prove integrity, not authenticity: keep the backups volume and every copy off the host as protected as the database itself.

### A restore lock left behind

The lock is never taken over automatically, even when it is old: a restore that paused (a suspended terminal, a slow disk) must not find another restore writing over it. A lock stays behind only when the restore that held it was killed without its trap running (a lost host, `kill -9`). Its heartbeat then stops. When the heartbeat is older than 900 seconds, remove the lock with the holder from the refusal message:

```bash
./scripts/restore.sh --break-stale-lock restore-<32 hex>
```

It removes the lock only when the stored holder matches and the heartbeat is older than 900 seconds; otherwise it refuses with exit code 3 and says why (no lock, another holder, a heartbeat that is too recent). It starts nothing: if the restore it belonged to stopped in the database or uploads step, run the restore again first. Never remove `.restore-lock` by hand while a restore might be running.

### Notes on `pg_restore`

**On the `AuditEvent` append-only trigger:** the database carries a trigger (`aida_audit_event_no_update_delete`) that raises an error on `UPDATE`/`DELETE` against `AuditEvent` rows — this is intentional (audit integrity). Restore is unaffected: `pg_restore --clean` issues `DROP TABLE`, not `DELETE`, so the trigger never fires during a restore. **Never** try to prune audit rows yourself with a manual `DELETE` — it will raise, by design. If you need audit retention policy, that's a product feature request, not a DB workaround.

**On benign restore warnings:** `pg_restore` can print warnings when restoring into a non-empty database, and one specific error is known to be harmless: `cannot drop inherited constraint` against `pgboss.job_common` (pg-boss's job table is declaratively partitioned; this is a known `pg_dump`/`pg_restore` limitation with declarative partitioning). The restore treats exactly that message as non-fatal and says so (`only the known benign pg-boss partition message; continuing`); any other `pg_restore` error fails the database step, and its `pg_restore: error:` lines are printed.

## Restore to a new server

Moving AIDA to new hardware (disk failure, migration, etc.):

1. **Install Docker** (Docker Engine + the Docker Compose v2 plugin) on the new server.
2. **Clone the repo**: `git clone <your-fork-or-origin> && cd aida`, at the release that made the set or a later one (never an earlier one: migrations only go forward).
3. **Recreate `.env`.** Copy your old `.env` across, or recreate it from `.env.example`. **`BETTER_AUTH_SECRET` and `APP_ENCRYPTION_KEY` MUST be the exact same values as the old server.** If they differ, existing user sessions become invalid and — more importantly — every stored IMAP/SMTP/LLM credential becomes permanently undecryptable (they're encrypted with `APP_ENCRYPTION_KEY`; there is no recovery path for a lost key other than re-entering every credential from scratch).
4. **Start only the database and prepare the two volumes the restore needs**:

   ```bash
   docker compose up -d db backup-init
   docker compose build app
   docker compose run --rm --no-deps -T --entrypoint true app
   ```

   The first line starts the database and prepares the backups volume (`backup-init`). It does not run `migrate`, so the database stays empty and the restore accepts it whatever release you cloned (see [Which database a set can be restored into](#which-database-a-set-can-be-restored-into)). The last line creates the `uploads_data` volume: Docker fills a new named volume from the image directory it is mounted on, so the volume root gets the app image's `/data/uploads` ownership, `node` (1000:1000), which the restore requires (see [Ownership of the restored files](#ownership-of-the-restored-files)). The container runs `true` and exits; it starts no server, runs no migration and does not touch the database. Without this step the restore stops with `Volume <name> does not exist` (exit code 6) before it changes anything. The database **must** be the `pgvector/pgvector:pg16` image already pinned in `docker-compose.yml` — a stock `postgres:16` image cannot load a dump containing `CREATE EXTENSION vector`.
5. **Copy the set into the backups volume**, from the tar stream made as in [Copying backups off the host](#copying-backups-off-the-host):

   ```bash
   docker compose run --rm --no-deps -T --entrypoint tar backup -C /backups -xf - < aida-backup-<setId>.tar
   ```

6. **Run the restore**: `./scripts/restore.sh <setId> --validate-only`, then `./scripts/restore.sh <setId> --yes`. It fills the empty database and the uploads volume from the set, and runs this release's `migrate deploy` when the set is older. `backup`, `app` and `worker` do not exist yet, so it says it could not start them; that is expected here.
7. **Start the instance**: `docker compose up -d --build`. The one-shot `migrate` service runs this release's `prisma migrate deploy` again (nothing is left to apply), and then `app`, `worker` and `backup` start.
8. **Verify**: `curl http://localhost/api/health` should return `{"status":"ok",...}`.
9. **Point DNS** at the new host and set `DOMAIN` in `.env` to your real domain, then `docker compose up -d caddy` — Caddy will automatically obtain a fresh Let's Encrypt certificate for the domain once ports 80/443 are reachable from the internet.

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

**With the installer** (an install made by `scripts/install.sh`, not a git clone): from the install directory run `sh scripts/install.sh backup`, then `sh scripts/install.sh upgrade <tag>`. It downloads that tag's source archive (its only network call; docs/SECURITY.md, "Installer network use"), replaces every file of the install except `.env`, and runs `docker compose up -d --build`; `.env` stays byte-identical. When the new `.env.example` has keys your `.env` lacks it names them, and `sh scripts/install.sh install` adds them without touching an existing value. Files that the new release no longer ships are left in place. A git clone keeps the `git pull` steps above.

The one-shot `migrate` service runs `prisma migrate deploy` automatically before `app`/`worker` start (it's gated on `db` being healthy, and `app`/`worker` are gated on `migrate` completing successfully) — **no manual migration step is needed**.

**Take a backup first**: `./scripts/backup.sh` before every upgrade, and note the set id on its `backup succeeded` line. Check it with `./scripts/restore.sh <setId> --validate-only` (it writes nothing).

**Rolling back.** If something goes wrong, go back to the previous git tag and restore the pre-upgrade set into an empty database. The upgrade has already migrated the database to the new release, so a restore into it is refused (exit code 9, see [Which database a set can be restored into](#which-database-a-set-can-be-restored-into)). Each step below changes nothing that a later step cannot still recover, and the database of the new release is kept, renamed, until the restore has succeeded:

```bash
# 1. Stop every writer. Only db keeps running; nothing writes from here on.
docker compose stop app worker backup

# 2. A backup of the current state, now complete because nothing writes. Note its set id from
#    the `backup succeeded` line, and check it (both commands write nothing to the database).
./scripts/backup.sh
./scripts/restore.sh <current-setId> --validate-only

# 3. The previous release, and a check that it can restore the pre-upgrade set. Stop here if the
#    check fails: nothing has been changed yet, and `docker compose up -d` on the new release
#    brings the instance back as it was.
git checkout <previous-tag>
docker compose build
./scripts/restore.sh <pre-upgrade-setId> --validate-only

# 4. Remove the containers of the new release (containers only; every volume stays).
docker compose rm -s -f app worker backup

# 5. Keep the new release's database under another name and create an empty one in its place.
#    ALTER DATABASE ... RENAME fails while any session is connected to it; then nothing changed.
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"${POSTGRES_DB}_before_rollback\"" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

# 6. Restore the pre-upgrade set into the empty database, then start the previous release.
./scripts/restore.sh <pre-upgrade-setId> --yes
docker compose up -d
```

Because the writers stop in step 1 before the backup in step 2, that set holds the whole state of the new release up to the stop, and the database renamed in step 5 holds the same state. Nothing written after the pre-upgrade set is lost while either of them is kept.

`restore.sh` says it could not start `backup`, `app` and `worker` (their containers were removed in step 4, so no new-release container runs on the old schema); `docker compose up -d` then creates them from the previous release and its `migrate` finds nothing to apply.

**If the restore in step 6 fails**, the empty database may be partly restored and the renamed one is untouched. To go back to the new release: rename the partly restored database out of the way (`ALTER DATABASE "<db>" RENAME TO "<db>_failed_restore"`, as in step 5), rename `<db>_before_rollback` back to `<db>`, `git checkout` the new release, and run `docker compose up -d --build`. No step of this procedure drops a database.

**Once the previous release runs correctly**, the renamed `<db>_before_rollback` database is no longer needed by AIDA. It still holds the new release's data and takes disk space; removing it is your decision, after you have kept the step 2 set wherever you keep backups.

This form needs a previous tag that already has set-based backups and `restore.sh --validate-only` (this release or later). Releases before it took a database dump and an uploads tarball as two files, and their own `restore.sh` takes those two files.

### Upgrading an install whose containers ran as root

From this release, `app`, `worker` and `migrate` run as the image's built-in `node` user (UID/GID 1000) instead of root. A fresh install needs nothing: a new `uploads_data` volume takes its ownership from the image on first mount. An `uploads_data` volume written by an older release is owned by root, so new uploads fail with a permission error until its ownership changes. Do this once, in order:

1. Before pulling the new release, still on the old images, take a backup:

   ```bash
   ./scripts/backup.sh ./backups
   ```

2. Pull and build the new release:

   ```bash
   git pull
   docker compose build
   ```

3. Stop the services that write uploads:

   ```bash
   docker compose stop app worker
   ```

4. Find the real volume name. Compose prefixes it with the project name (for example `aida_uploads_data`); make sure the one you change is AIDA's:

   ```bash
   docker volume ls --filter name=uploads_data
   ```

5. **Warning: the next command recursively changes the owner of every file in the uploads volume. Run it only after the backup in step 1 has finished, and only against AIDA's uploads volume.** It runs a one-off container of the new image as root, mounting the volume at `/data/uploads`:

   ```bash
   docker compose run --rm --no-deps --user 0:0 --entrypoint chown app -R 1000:1000 /data/uploads
   ```

6. Verify the result. This must print `1000:1000` and nothing else (the second command prints the first file not owned by UID 1000, if any):

   ```bash
   docker compose run --rm --no-deps --entrypoint sh app -c 'stat -c "%u:%g" /data/uploads; find /data/uploads ! -user 1000 | head -n 1'
   ```

7. Start the stack:

   ```bash
   docker compose up -d
   ```

The procedure is idempotent: running steps 5 and 6 again changes nothing and prints the same result. There is deliberately no automatic fix: no root entrypoint, `su-exec` wrapper or init container changes operator data without the operator's consent. The one root init step AIDA has, `backup-init` (see [Backups](#the-one-time-preparation-backup-init)), touches only the mount point of the backups volume, never `uploads_data`.

## Logs

```bash
docker compose logs -f app       # Next.js request logs, auth events
docker compose logs -f worker    # pg-boss job execution
docker compose logs -f caddy     # reverse proxy / TLS
docker compose logs -f migrate   # one-shot migration output (only runs at startup)
docker compose logs -f backup    # scheduled backups: next run, results, skip and failure lines
```

Normal `worker` output is a recurring cadence of small job-completion lines — a heartbeat job (writes `SystemSetting['heartbeat:lastRunAt']`), the SLA-flag sweep, and the rate-limit-hit cleanup job. If the email channel is configured, you'll also see periodic inbound-poll job runs. A **repeated inbound-poll failure** (IMAP auth error, connection refused, TLS error) in the worker log means the email channel is broken even though the app itself is healthy — check Settings → Email for the last-checked status.

**Credentials are never logged.** IMAP/SMTP passwords, LLM API keys, and `APP_ENCRYPTION_KEY` never appear in `docker compose logs` output, by design (secrets are decrypted only in-process, immediately before use, and never written to a logger).

## Health checks

```bash
curl http://localhost/api/health
```

Note the port: this goes **through Caddy on port 80** (or 443 with a real domain), not `:3000` — the app's own port is only reachable from inside the compose network, not from the host.

Success (HTTP 200):

```json
{"status":"ok","db":"connected","worker":{"lastRunAt":"2026-07-28T22:58:14.680Z"}}
```

Failure (HTTP 503, database unreachable):

```json
{"status":"error","db":"unreachable"}
```

`worker.lastRunAt` is the timestamp the worker's heartbeat job last wrote. **A stale `lastRunAt` (not advancing over several minutes) means the worker process is down even though the app answers 200** — check `docker compose ps worker` and `docker compose logs worker`. If no heartbeat has ever run, the field reads `{"status":"no heartbeat yet"}` instead of a timestamp — expected briefly right after startup.

The compose healthcheck for `app` does not use `/api/health`. It calls `http://127.0.0.1:3000/api/health/probe`, which answers `{"status":"ok"}` (HTTP 200) or `{"status":"error"}` (HTTP 503) from the same 3-second cache as `/api/health`, carries no rate limit, and is refused by Caddy with HTTP 404 (`@healthprobe` in the `Caddyfile`). Public requests can therefore never reach the probe or use up a quota it depends on, so the health throttle cannot make the container unhealthy. Load can: the probe reads the same database snapshot as `/api/health`, so heavy traffic that saturates the app process or the database connection pool can still make the probe time out or answer 503, and the container is then marked unhealthy. External monitors keep using `/api/health` through Caddy, which is throttled and answers 429 with `Retry-After` when over the limit. The healthcheck targets `127.0.0.1` rather than the `localhost` equivalent — Alpine Linux resolves the hostname `localhost` to `::1` (IPv6) while Next.js listens on `0.0.0.0` (IPv4 only), so that hostname inside the container silently fails to connect. This is an internal container-to-container detail; from the host, always use the Caddy-fronted `http://localhost/api/health` shown above, never port 3000 directly (it isn't published to the host). Exposing port 3000 is unsupported; see [Client IP and reverse proxies](#client-ip-and-reverse-proxies).

Anything that can reach `app:3000` directly can call the probe and read the binary database status (`ok` or `error`) from it, with no rate limit; that is the trust boundary described in [Client IP and reverse proxies](#client-ip-and-reverse-proxies). The probe reveals nothing else, and it adds no database load beyond the shared cache.

### Cache and throttle

The endpoint is public and unauthenticated, so it protects the database itself (D-20):

- **3-second cache.** The database read is cached for 3 seconds, a 503 included, and concurrent requests share one in-flight read. The reported status can therefore lag reality by up to 3 seconds, for an outage and for a recovery alike.
- **2-second read timeout.** A database read that has not answered after 2 seconds counts as unreachable: the endpoint answers 503, and that 503 is cached like any other, so a hung database gives a 503 rather than a request that never returns.
- **In-memory throttle, per process.** Each client address may call the endpoint 60 times a minute. Callers without a usable client address share one bucket of 120 a minute. The container healthcheck does not count against either limit, because it calls the probe path above. Loopback is not exempt. The throttle lives in the app's memory, never in the database, and its keys (client addresses) are never logged or stored. Restarting the app resets it.
- **Over the limit** the endpoint answers HTTP 429 with `{"error":"rate_limited"}` and an integer `Retry-After` header (seconds until the window resets). A monitor that polls more often than once a second from one address will see 429s; poll every 10 seconds or slower.

`worker.lastRunAt` stays in the public response by choice: it holds no tenant data, it is served from the cache, and the troubleshooting steps above rely on it. The limits (60, 120) are starting values and can be tuned from real monitoring traffic.

## Client IP and reverse proxies

Rate limits on the public routes and on sign-in are keyed on the client's address. AIDA works out
that address in one place, `src/lib/rate-limit/client-ip.ts`, and it is only as trustworthy as the
proxy in front of the app. This section is the contract an operator has to keep.

**Supported topology.** Only Caddy is published. Inside `reverse_proxy app:3000` the Caddyfile has:

```
header_up X-Forwarded-For {remote_host}
```

so Caddy replaces any X-Forwarded-For a client sends with the address of the TCP peer it actually
saw. The app takes the rightmost entry of X-Forwarded-For as the client identity for rate limits.
IPv4 addresses are used whole; IPv6 addresses are grouped by their /64. The app stores only a
peppered hash of that key (see `RATE_LIMIT_PEPPER`), never the raw address.

**The trust boundary is direct access to `app:3000`.** This path is not impossible: anything that
can reach the container on port 3000 can talk to the app without Caddy. Whoever has that access
chooses their own rate-limit identity, because the app takes X-Forwarded-For as sent (or, when the
header is absent, the TCP peer address that Next.js fills in). The shipped `docker-compose.yml`
does not publish port 3000. Keeping it unpublished, and keeping the `app` container off networks
that other workloads share, is the operator's responsibility. Exposing port 3000 is unsupported.
For the same reason, running an unknown proxy in front of Caddy is unsupported unless you set it
up as described below.

**Advanced: a CDN in front of Caddy.** When a CDN (or another proxy you control) sits in front of
Caddy, Caddy would otherwise see only the CDN's address. To key on real clients:

1. Configure Caddy's `trusted_proxies` with the CDN's published address ranges, in the global
   options block (`servers { trusted_proxies static <ranges> }`). Caddy ignores an incoming
   X-Forwarded-For unless the peer is in `trusted_proxies`.
2. Remove the `header_up X-Forwarded-For {remote_host}` line from the Caddyfile, so Caddy appends
   the CDN's address to the header instead of overwriting it.
3. Set `TRUSTED_PROXY_HOPS` in `.env` to the number of trusted proxy addresses at the right end of
   X-Forwarded-For as the app receives it: `1` for a CDN plus Caddy. The maximum is
   `MAX_TRUSTED_PROXY_HOPS`, 10. The app then uses the entry that many places from the right.

Do steps 2 and 3 together. Setting `TRUSTED_PROXY_HOPS` without removing the `header_up
X-Forwarded-For {remote_host}` line sends every client to the shared bucket, because Caddy still
writes a one-entry chain: sign-in and the public routes then share one small quota for the whole
site.

The CDN itself must keep its side of the contract:

- It must overwrite the X-Forwarded-For a client sends, or sanitize it by appending the address it
  observed, so the entry at the trusted position is always written by the CDN and never by the
  client.
- With `TRUSTED_PROXY_HOPS` above 0, restrict direct access to Caddy to the CDN's published ranges,
  for example with a host firewall. A client that reaches Caddy directly arrives with a chain
  shorter than declared and lands in the shared bucket described below, which it can then exhaust
  for everyone else in that bucket.

**Wrong settings fail closed.** An invalid `TRUSTED_PROXY_HOPS` (anything other than an integer
from 0 to 10, written without a leading zero), a chain shorter than declared, or a malformed entry
inside the trusted part of the chain puts every such request into one shared rate-limit bucket.
That shared identity also admits only one limiter check at a time ("One check at a time per
client" below), so a proxy misconfiguration limits how many requests run at once as well as how
many are allowed; the same holds for many clients behind one large NAT, which share one address.
An invalid value also logs one error line per process, naming the setting and no address:
`TRUSTED_PROXY_HOPS must be an integer from 0 to 10; every request now uses the shared client bucket.`
A valid value above 0 that meets a chain shorter than declared, or a malformed entry in the trusted
part, logs one other line per process, again naming only the setting: it starts with
`TRUSTED_PROXY_HOPS is <n>, but a request arrived whose X-Forwarded-For has fewer valid trusted
entries than that` and points at the `header_up` line above. With `TRUSTED_PROXY_HOPS` blank or 0
nothing is logged.
A value that is too low keys every client behind the CDN on the CDN's address: coarse, but never
the client-sent value. A value that is too high sends every request to the shared bucket. Entries
further left than the trusted position are client-controlled and are ignored, never parsed or
validated, so a client cannot move itself into the shared bucket by sending garbage there.

**Sign-in uses the same identity.** Better Auth's sign-in limiter reads the client address only
from an internal header, `x-aida-client-ip`. The app's proxy (`src/proxy.ts`) overwrites that
header on every request with the identity above, so a client-sent value never reaches Better Auth,
and a raw X-Forwarded-For is never read for sign-in either. Caddy also strips a client-sent
`x-aida-client-ip` (`header_up -X-Aida-Client-Ip`); keep that line if you change the proxy setup.

### Public rate limits under load

The public routes (request form, status-page follow-up, CSAT, status-page attachments) count each
request in the database. That check runs in a short transaction on one of the app's 10 pool
connections (`DB_POOL_MAX`). To keep a flood of requests from taking the whole pool, at most **3**
of these checks run at once (`RATE_LIMIT_MAX_CONCURRENT` in
`src/lib/rate-limit/check-rate-limit.ts`), and none starts while 3 or more requests are already
waiting for a pool connection. A request over that answers HTTP 429 with `Retry-After: 1` at once,
without touching the database, and is not counted. The other 7 connections stay with the rest of
the app. The same 429 is given when the check waits longer than 500 ms for another request of the
same client, or longer than 1 s for a pool connection.

**One check at a time per client.** One client (the client address, per route) runs at most one
of these checks at once, so a flood from one address cannot take the 3 slots other clients need.
Its second simultaneous request answers 429 with `Retry-After: 1` at once. Clients without a usable
address share one bucket, and so share that one check; under the supported topology Caddy always
supplies the address. When a client is over its quota, the app remembers until when (at most
10,000 clients, expired entries swept every second), and answers that client's requests before
then with 429 and the same `Retry-After` without asking the database. This memory lives in the app
process: deleting rate-limit rows from the database does not lift a denial it already remembers,
and restarting the app does.

**The limit is per app process.** AIDA runs one app process: one server, one `app` container.
Running several `app` replicas multiplies the limit, and with it the share of the database those
checks can take, so it is not supported. Within the process, every route shares one database pool
and one copy of these limits, also when the production build loads the code once per route: both
are kept process-wide (`src/lib/db.ts`, `src/lib/rate-limit/check-rate-limit.ts`). The `worker`
container is a separate process with its own pool (`DB_POOL_MAX=5`).

## Environment variable reference

Every variable in `.env.example`, and nothing else. `Required` means the app will not function correctly (or will refuse to boot) without it.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `BETTER_AUTH_URL` | Yes | `http://localhost` | Public URL of the app, used by Better Auth for callbacks/cookies. Behind Caddy, this is your Caddy-facing URL (`http://localhost` or `https://yourdomain.com`), not `:3000`. |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost` | Public app URL exposed to the browser (links in emails, absolute URLs in client code). |
| `BETTER_AUTH_SECRET` | Yes | — | Session-signing secret. Generate with `openssl rand -base64 32`. **Must be preserved across restores/migrations** — changing it invalidates every existing session. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Yes | `http://localhost,https://localhost` | Comma-separated extra origins trusted for CSRF checks. |
| `DATABASE_URL` | Yes (local dev) | `postgresql://aida:aida@localhost:5432/aida` | Postgres connection string for local (non-Docker) development: host-side tools and `pnpm dev`. Docker Compose never passes this `.env` value to `app`, `worker` or `migrate`: it builds their URL from `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` (`postgresql://<user>:<password>@db:5432/<db>`), unless `AIDA_DATABASE_URL` is set. |
| `AIDA_DATABASE_URL` | Only for a password with URL-reserved characters | *(unset)* | The URL `app`, `worker` and `migrate` use instead of the one built from `POSTGRES_*`. Leave it unset when `POSTGRES_PASSWORD` is URL-safe (for example `openssl rand -hex 24`). If the password, user or database name contains a character such as `/ @ : # ?` or `%`, generate it with `POSTGRES_USER=... POSTGRES_PASSWORD='...' POSTGRES_DB=... sh scripts/database-url.sh`, which percent-encodes all three and prints one `AIDA_DATABASE_URL=...` line to paste into `.env`. At start-up the three services compare the decoded URL with `POSTGRES_*` and refuse to start on a difference (see [Troubleshooting](#troubleshooting)). |
| `POSTGRES_USER` | Yes | `aida` | Postgres role used by the `db` service, the `backup` service (as `PGUSER`) and `restore.sh`. |
| `POSTGRES_PASSWORD` | Yes | — | Postgres password. The `db` service refuses to start without it. A `$` in the value needs care: Compose reads `$name` in an unquoted or double-quoted `.env` value as a variable, so `POSTGRES_PASSWORD=ab$cd` reaches every service as `ab`. Single-quote the value (`POSTGRES_PASSWORD='ab$cd'`) or write each `$` as `$$` (`POSTGRES_PASSWORD=ab$$cd`); both give `ab$cd`. Pass `scripts/database-url.sh` the real password, single-quoted in the shell. |
| `POSTGRES_DB` | Yes | `aida` | Database name. |
| `DOMAIN` | Yes (prod) | `localhost` | Domain Caddy serves. `localhost` uses Caddy's local CA; a real domain triggers Let's Encrypt auto-HTTPS. |
| `DB_POOL_MAX` | No | `10` | Prisma connection pool size for local (non-Docker) dev. Compose overrides this per-service (`app`=10, `worker`=5) — the two must stay under Postgres's `max_connections` (default 100). |
| `ADMIN_EMAIL` | No | *(blank)* | If set on a fresh instance, auto-creates the first org + admin on boot and skips the `/setup` wizard (headless/CI installs). |
| `ADMIN_PASSWORD` | No | *(blank)* | Password for the auto-created admin above. **Never ship a default value** — leave blank to use the interactive `/setup` wizard instead. |
| `ADMIN_NAME` | No | *(blank)* | Display name for the auto-created admin above. |
| `UPLOADS_DIR` | Yes | `/data/uploads` | Filesystem path for stored attachments. In Docker this is the `uploads_data` volume mount — do not change it unless you also change the volume mount in `docker-compose.yml`. |
| `RATE_LIMIT_PEPPER` | Yes | — | Salts the per-IP hash used by the public-intake rate limiter (raw IPs are never stored). Generate with `openssl rand -base64 32`. Without it the public routes (request form, status-page follow-up, CSAT, status-page attachments) answer 500 rather than store an unsalted hash. If it is missing or still the `.env.example` placeholder, the app logs one line at start-up naming `RATE_LIMIT_PEPPER`; it still starts. |
| `TRUSTED_PROXY_HOPS` | No | *(blank, meaning 0)* | Advanced. Number of trusted proxy addresses at the right end of X-Forwarded-For, 0 to 10. Leave blank behind the shipped Caddy; set only with a CDN in front of Caddy, see [Client IP and reverse proxies](#client-ip-and-reverse-proxies). An invalid value puts every client in one shared rate-limit bucket. |
| `APP_ENCRYPTION_KEY` | Yes (once credentials saved) | — | AES-256-GCM key encrypting IMAP/SMTP (and LLM) secrets at rest. The app boots without it, but saving any credential in Settings requires it. Generate with `openssl rand -base64 32`. **Must be preserved across restores/migrations** — losing or changing this key makes every previously stored credential permanently undecryptable. |
| `DEMO_MODE` | No | *(blank)* | When exactly `true`, the app seeds the demo org/admin/agent and the fictional demo dataset at boot **only into an empty database** (no organization and no user). A database holding the complete demo is left as it is; any other database gets one refusal line in the log, nothing is written, and the app starts normally. See [Demo mode](#demo-mode). **Never enable this on an internet-facing instance** — the credentials below are documented publicly (README, this file). Leave blank for a normal install. |
| `DEMO_ADMIN_EMAIL` | No | `admin@demo.aida.test` | Email for the auto-created demo admin account. Only takes effect when `DEMO_MODE=true`. |
| `DEMO_ADMIN_PASSWORD` | No | `aida-demo-2026` | Password for the auto-created demo admin (and demo agent) account. Only takes effect when `DEMO_MODE=true`. |
| `DEMO_AGENT_EMAIL` | No | `agent@demo.aida.test` | Email for the auto-created demo agent account ("Sam Rivera"). Only takes effect when `DEMO_MODE=true`. |
| `BACKUP_ENABLED` | No | `true` | `true` runs the `backup` service's daily backup; `false` keeps the service up without running any. See [Backups](#scheduled-backups-the-backup-service). |
| `BACKUP_SCHEDULE` | No | `02:00` | Daily backup time, `HH:MM`, 24-hour, **UTC**. An invalid value stops the `backup` service with exit code 2 and a log line naming the format. |
| `BACKUP_RETENTION` | No | `7` | Number of successful backup sets kept in the `backups_data` volume, 1 to 9999. Older sets are removed after each successful run. |
| `BACKUP_LEASE_TTL_SECONDS` | No | `900` | Advanced. Lifetime in seconds of the lease a backup holds while deletions of stored files wait; renewed every third of it. A run that cannot renew it aborts (`backup aborted: lease lost`). |
| `BACKUP_FENCE_WAIT_SECONDS` | No | `300` | Advanced. Seconds a backup waits for a file deletion in progress before it fails with `file fence busy`. |
| `BACKUP_MAX_RUN_SECONDS` | No | `21600` | Advanced. The longest one backup run may take, 1 to 999999 seconds; past it the run fails with `backup aborted: run deadline passed`. |

### Demo mode

Demo mode (AIDA-22) turns a fresh `docker compose up` into an instantly explorable, fully populated helpdesk — no shell, no `pnpm db:seed` command, just one environment variable.

**Turning it on:** set `DEMO_MODE=true` in `.env` (optionally override `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` / `DEMO_AGENT_EMAIL`) before the **first** `docker compose up` against a fresh database. On boot, `instrumentation.register()` logs a loud `[demo] DEMO MODE IS ACTIVE...` warning, then checks the database and creates the demo org, a demo admin, a demo agent, and seeds ~30 tickets, contacts, KB articles, CSAT responses, and three completed AIDA Insight runs, only if the database is empty. The log line names the admin email and never a password; the password is the `DEMO_ADMIN_PASSWORD` you set (or the documented default).

**It seeds only an empty database.** Before any write, the demo boot and `pnpm db:seed` classify the tenant data (organizations and users; infrastructure rows such as migrations, the job queue, `SystemSetting` and `RateLimitHit` never count):

| Database holds | `DEMO_MODE` boot | `pnpm db:seed` |
|---|---|---|
| No organization and no user | Seeds the demo | Seeds the demo, exit 0 |
| The complete demo: one organization carrying the demo completion marker, and only the configured demo accounts | Leaves it as it is (`[demo] The complete demo workspace is already present; nothing written.`) | Prints that it is already seeded, exit 0 |
| An incomplete demo: demo accounts only, no completion marker (a seed that stopped part-way) | Refuses with one log line, writes nothing | Refuses, writes nothing, exit 1 |
| Anything else (a real workspace, a non-demo user, a second organization) | Refuses with one log line, writes nothing | Refuses, writes nothing, exit 1 |

A refusal never deletes, renames or changes anything, and the demo boot never stops the app from starting: every outcome, and every error, ends in one log line and a normal start. The seed CLI, the demo boot and the headless admin bootstrap take the same database lock, and so does the `/setup` wizard, so two of them started together cannot both create a workspace. While a seed holds the lock, `/setup` waits up to 10 seconds and then answers "Setup is busy right now" without writing anything. User sign-up outside `/setup` does not take that lock.

**`DEMO_MODE` together with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.** The headless admin bootstrap runs first at boot. On an empty database it creates a real workspace for `ADMIN_EMAIL`, and the demo boot then finds a workspace that is not the demo and refuses. Set one or the other, not both.

**Boot never waits long on the lock.** At start-up the headless admin bootstrap and then the demo boot each wait at most 10 seconds for a database connection and 10 seconds for the lock, so `app` waits at most 40 seconds in total before it serves, plus the time of a bootstrap or demo seed that does run. When a wait ends, or the bootstrap fails for any other reason, the step logs one line (`[bootstrap] Skipped the headless admin bootstrap ...` or `[demo] Skipped the demo seed ...`; the bootstrap line names only the error class, never the email or the password) and the app starts without it. Run the seed or restart `app` again once the other run has finished.

**`DEMO_ADMIN_EMAIL` and `DEMO_AGENT_EMAIL` must differ.** When they are the same address (case does not matter), the demo boot and `pnpm db:seed` refuse before any write, with one line, and `pnpm db:seed` exits 1.

**The seed's writes are not one transaction.** The demo accounts, the organization and each ticket commit on their own, and the completion marker is written last. A seed that stops part-way (a crash, a killed container, a database restart) leaves those rows and no marker; from then on both the boot and `pnpm db:seed` refuse that database as an incomplete demo.

**Recovering from an incomplete or unwanted demo** is a manual step, by design; nothing in AIDA deletes it for you:

1. Stop the writers: `docker compose stop app worker`.
2. Keep the database and the uploads as they are, for investigation. Do not delete them.
3. Point the demo at a new, separate database: for example a separate Compose project with its own volumes (`docker compose -p <new-project-name> up -d`, run from a separate copy of this directory with its own `.env`; it needs the ports the old project's `caddy` service holds, so stop that service first), or a new, empty database on your Postgres server set in `AIDA_DATABASE_URL`.
4. Let `migrate` apply the migrations to the new database, then seed it: start the stack with `DEMO_MODE=true`, or run `pnpm db:seed` against it.

Never try to make AIDA accept the old database by adding the completion marker by hand: the marker is only trustworthy when the seed itself wrote it last.

**The seeded AI results are stored data, not live model output.** Every seeded triage tag, drafted-reply audit row, and Insight run is stamped `provider: "demo"` / `model: "demo-seed"` — the UI renders it exactly like a real AI result would, but it was written directly by the seed script so every AI surface looks populated even with **zero LLM configured**. Turning on a real provider in Settings → AI does not touch this seeded data; it only affects new, live AI actions (Generate draft, Generate insights, Re-run triage) from that point forward.

## Troubleshooting

**Uploads fail with a permission error after upgrading.**
The `uploads_data` volume was written by an older release whose containers ran as root, while `app` and `worker` now run as the `node` user (UID 1000). Follow [Upgrading an install whose containers ran as root](#upgrading-an-install-whose-containers-ran-as-root): back up first, then change the volume's owner to `1000:1000` once and verify it.

**`app` is unhealthy but `db` is up.**
Check `DATABASE_URL` construction: Compose builds the services' URL from `POSTGRES_*`, unless `AIDA_DATABASE_URL` is set, and never uses the `.env` `DATABASE_URL` line (that one is for local development). A password with a URL-reserved character needs `AIDA_DATABASE_URL`, generated with `scripts/database-url.sh`; see the next entry. Check the `migrate` service actually completed: `docker compose ps migrate` should show `Exited (0)`; if it exited non-zero, `app`/`worker` never start (they're gated on `migrate`'s success) — read `docker compose logs migrate`.

**`app`, `worker` or `migrate` exits at start-up with `DATABASE_URL ... does not match POSTGRES_PASSWORD` or `DATABASE_URL could not be parsed`.**
The boot guard found that the database URL the service received disagrees with `POSTGRES_USER`, `POSTGRES_PASSWORD` or `POSTGRES_DB` (the message names which: user, password or database), or that the URL does not parse. The usual cause is a password with a URL-reserved character such as `/ @ : # ?` or `%`, which breaks the URL Compose builds, or an `AIDA_DATABASE_URL` left over from an earlier password. A `$` in an unquoted or double-quoted `POSTGRES_PASSWORD` in `.env` is another cause: Compose cuts the value at the `$`, while the generator encoded the whole password (see the `POSTGRES_PASSWORD` row in the [Environment variable reference](#environment-variable-reference)). The message never contains either value. Fix: run `POSTGRES_USER=... POSTGRES_PASSWORD='...' POSTGRES_DB=... sh scripts/database-url.sh` with the values from your `.env`, replace the `AIDA_DATABASE_URL` line in `.env` with its output (or remove that line when the password is URL-safe), then `docker compose up -d`. The lines are prefixed `[migrate]` or `[boot]`; read them with `docker compose logs migrate` or `docker compose logs app`.

**Worker heartbeat is stale (`/api/health`'s `worker.lastRunAt` isn't advancing).**
`docker compose logs worker` — look for a crash loop or an unhandled exception. `docker compose ps worker` — confirm the container is actually `Up`, not restarting.

**Caddy fails to obtain a TLS certificate on a real domain.**
Let's Encrypt needs to reach the server on ports 80 and 443 from the public internet to complete the ACME challenge — check your firewall/security group and that `DOMAIN` in `.env` resolves (DNS) to this server's public IP. `docker compose logs caddy` shows the ACME error detail.

**Attachments are missing after a restore.**
`restore.sh` restores the database and the uploads volume from one set together, and there is no way to restore only the database through it (by design: a partial restore would silently reintroduce the exact "lost every attachment" failure mode this runbook warns about). A published set has every file its database refers to, because a backup refuses to publish a set with a missing file (category `verification`), and the restore checks every copied file against the set's checksum list. So missing attachments after a restore usually mean one of these:

- the restore stopped in the uploads step (exit code 8, `backup`, `app` and `worker` left stopped): see [What a failure leaves behind](#what-a-failure-leaves-behind) and run the restore again;
- the stack runs with another uploads volume than the one restored, for example after a change of the Compose project name: the restore uses the volume names `docker compose config` reports from the directory you run it in, so run it from the stack's own checkout;
- the database was restored by hand (`pg_restore` of `db.dump` alone), which restores no file: run `restore.sh` with the set instead.

**Database connection exhaustion / "too many connections".**
`app`'s pool (`DB_POOL_MAX=10`) plus `worker`'s pool (`DB_POOL_MAX=5`) must stay comfortably under Postgres's `max_connections` (default 100). If you've scaled `app`/`worker` replicas or added other Postgres clients, check `SELECT count(*) FROM pg_stat_activity;` against the `max_connections` setting before raising either pool size.
