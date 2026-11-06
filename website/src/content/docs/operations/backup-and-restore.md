---
title: Backup & restore
description: What a complete AIDA backup is, how to take one, and how to restore it — including onto a new server.
---

By the end of this page you'll know how to take a complete, restorable backup and what to do
when you need to bring an instance back from one.

## What a complete backup is

A complete AIDA backup has **two parts**, and both are required to restore an instance:

1. A **Postgres dump** — tickets, contacts, messages, KB articles, insight runs, settings,
   everything in the database.
2. An **archive of the uploads volume** — every ticket and task attachment and the workspace
   logo. Files live on disk, not in Postgres.

**A database-only dump is not a complete backup.** Restoring only the database dump silently
loses every attachment — there's no warning at restore time, because the restore succeeds; the
files are just gone.

**Backups contain tenant data**: every workspace's database rows and files. They stay on your
server, and copying them off the host is your job.

## Scheduled backups

`docker compose up -d` starts a `backup` service that takes one backup every day: by default at
02:00 UTC, keeping the 7 newest successful sets. `BACKUP_ENABLED`, `BACKUP_SCHEDULE` and
`BACKUP_RETENTION` in `.env` change that (see [Environment variables](/aida/configuration/environment/));
recreate the service afterwards with `docker compose up -d backup`.

The service uses the same `pgvector/pgvector:pg16` image as the database and runs as the
non-root user `1000:1000`, the same user as `app` and `worker`, with the uploads volume mounted
read-only. One one-shot service, `backup-init`, runs as root once to give the new backups volume's
mount point to that user (mode `0700`); it touches nothing else and has no network.

Each set is one directory in the `backups_data` volume, named by its set id, holding `db.dump`,
`uploads.tar.gz`, `uploads.sha256` and `manifest.json`. Admins see the most recent run in
**Settings → Backups**; every run is in `docker compose logs backup`.

## Taking a backup by hand

```bash
./scripts/backup.sh
```

This runs one backup now in the `backup` service and prints its result; the set lands in the
`backups_data` volume like a scheduled one. It needs the `db` service to be running.

## Copying backups off the host

A backup on the same disk as the instance it protects doesn't survive a disk failure. Copy sets
off the host yourself, for example:

```bash
docker compose run --rm --no-deps -T --entrypoint tar backup -C /backups -cf - <setId> > aida-backup-<setId>.tar
```

Keep `APP_ENCRYPTION_KEY` separately: it is not in any set, and without it the credentials stored
in Settings cannot be read after a restore.

The full runbook (failure categories, the skip and abort log lines, and what to do when a run's
outcome could not be recorded) is in
[docs/OPERATIONS.md, Backups](https://github.com/afrizzal/aida/blob/master/docs/OPERATIONS.md#backups).

## Restoring

```bash
docker compose run --rm --no-deps -T --entrypoint ls backup -1 /backups   # list the sets
./scripts/restore.sh <setId>
```

**This is destructive.** It replaces the entire database and the entire uploads volume with one
set. Unless you pass `--yes`, it asks you to type `restore` before it touches anything.
`APP_ENCRYPTION_KEY` must be the one from the install that made the set, and restoring copies
every workspace's data in the set into this instance.

It takes a restore lock on the backups volume and the backup lease, so a second restore or a
running backup makes it refuse before anything is stopped. It also refuses, before anything is
stopped or written (exit code 9), when the target database has an applied migration that the
set does not contain: see [Which database a set can be restored into](#which-database-a-set-can-be-restored-into).
Then it stops `backup`, `app` and `worker` and validates the **whole set before it writes anything**: every checksum against the
manifest, every archive member (regular files named `<organizationId>/<storageKey>` only), and
the extracted files against the checksum list. Only then does it restore the database and the
uploads volume, as the app's user (1000:1000), and write the volume marker from the restored
database. On success it starts the services again.

If validation fails, nothing was changed and the services are started again. If the database or
the uploads step fails, the services are **left stopped** and the message names the step: run the
restore again. The checks detect corruption and partial tampering, not a set forged consistently
including its unsigned manifest.

## Which database a set can be restored into

`pg_restore --clean` replaces only the objects in the dump, and the restart after a restore does
not run `migrate`, so a database at a newer schema than the set would be left half dropped or
older than its code. The restore therefore refuses a target database with a migration the set's
dump does not contain, unless the database is empty. The supported paths:

- **Into a database of the release the set came from.**
- **Into an empty database, then the target release's `migrate deploy`:** restore, then run
  `docker compose up -d --build` with the release you want; its `migrate` service applies every
  migration newer than the set.

Migrations only go forward: a set made by a later release cannot be restored into an earlier one.

## Restoring onto a new server

1. Install Docker and clone the repository on the new server, at the release that made the set
   or a later one.
2. Recreate `.env`. **`BETTER_AUTH_SECRET` and `APP_ENCRYPTION_KEY` must be the exact same
   values as the old server** — losing either makes existing sessions invalid and every stored
   IMAP/SMTP/LLM credential permanently undecryptable.
3. Start only the database and the backups volume with `docker compose up -d db backup-init`.
   This does not run `migrate`, so the database stays empty. The database image **must
   be `pgvector/pgvector:pg16`** — a stock `postgres:16` image can't load a dump containing
   `CREATE EXTENSION vector`.
4. Copy the set into the backups volume:
   `docker compose run --rm --no-deps -T --entrypoint tar backup -C /backups -xf - < aida-backup-<setId>.tar`.
5. Run `./scripts/restore.sh <setId> --yes`. `backup`, `app` and `worker` do not exist yet, so
   it says it could not start them; that is expected here.
6. Run `docker compose up -d --build`. Its `migrate` service applies every migration newer than
   the set, then the services start.

## Full runbook

This page is a practical summary. For the complete runbook — every refusal message, what each
failure leaves behind, a restore lock left behind (`--break-stale-lock`), restore warnings you can
safely ignore, the `AuditEvent` append-only trigger's interaction with restore, and
troubleshooting —
see [`docs/OPERATIONS.md`](https://github.com/afrizzal/aida/blob/master/docs/OPERATIONS.md) in
the repository.
