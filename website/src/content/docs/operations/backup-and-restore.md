---
title: Backup & restore
description: What a complete AIDA backup is, how to take one, and how to restore it — including onto a new server.
---

By the end of this page you'll know how to take a complete, restorable backup and what to do
when you need to bring an instance back from one.

## What a complete backup is

A complete AIDA backup has **two parts**, and both are required to restore an instance:

1. A **Postgres logical dump** — tickets, contacts, messages, KB articles, insight runs,
   settings, everything in the database.
2. A **tarball of the uploads volume** — every ticket attachment. Files live on disk, not in
   Postgres.

**A database-only dump is not a complete backup.** Restoring only the database dump silently
loses every attachment — there's no warning at restore time, because the restore succeeds; the
files are just gone.

## Taking a backup

```bash
./scripts/backup.sh ./backups
```

This produces two timestamped files:

```
backups/aida-db-20260728T225848Z.dump
backups/aida-uploads-20260728T225848Z.tar.gz
```

The script prints both paths, their sizes, and the exact restore command to use them.

### Automating backups

AIDA ships no built-in scheduler — there's no backup sidecar service. Schedule `backup.sh`
yourself with cron and prune on a retention window:

```txt
# 03:30 daily, keep 14 days
30 3 * * * cd /srv/aida && ./scripts/backup.sh /srv/aida-backups >> /var/log/aida-backup.log 2>&1
35 3 * * * find /srv/aida-backups -type f -mtime +14 -delete
```

**Copy backups off the machine.** A backup on the same disk as the instance it protects doesn't
survive a disk failure — sync your backup directory to off-box storage as part of your own
operational practice.

## Restoring

```bash
./scripts/restore.sh <db-dump> <uploads-tarball>
```

**This is destructive.** It stops `app` and `worker` first (so nothing writes mid-restore),
replaces the entire database and the entire uploads volume with the backup's contents, then
starts `app` and `worker` again and health-checks the result. Unless you pass `--yes`, it prompts
for an explicit confirmation before touching anything.

## Restoring onto a new server

1. Install Docker and clone the repository on the new server.
2. Recreate `.env`. **`BETTER_AUTH_SECRET` and `APP_ENCRYPTION_KEY` must be the exact same
   values as the old server** — losing either makes existing sessions invalid and every stored
   IMAP/SMTP/LLM credential permanently undecryptable.
3. Start the database only (`docker compose up -d db`). The target database image **must be
   `pgvector/pgvector:pg16`** — a stock `postgres:16` image can't load a dump containing
   `CREATE EXTENSION vector`.
4. Run `./scripts/restore.sh <db-dump> <uploads-tarball> --yes`.
5. Bring up the full stack with `docker compose up -d`.

## Full runbook

This page is a practical summary. For the complete runbook — restore warnings you can safely
ignore, the `AuditEvent` append-only trigger's interaction with restore, and troubleshooting —
see [`docs/OPERATIONS.md`](https://github.com/afrizzal/aida/blob/master/docs/OPERATIONS.md) in
the repository.
