---
title: Upgrading, logs & health
description: How to upgrade a running instance, read its logs, and check whether it's actually healthy.
---

By the end of this page you'll know how to upgrade AIDA safely, read its logs, and tell a
healthy instance apart from one that only looks healthy.

## Upgrading

Back up first:

```bash
./scripts/backup.sh ./backups
```

Then:

```bash
git pull
docker compose build
docker compose up -d
```

The one-shot `migrate` service runs `prisma migrate deploy` automatically before `app`/`worker`
start — **there is no manual migration step**.

To roll back, check out the previous git tag and restore the pre-upgrade dump:

```bash
git checkout <previous-tag>
docker compose build
./scripts/restore.sh ./backups/<pre-upgrade-db-dump> ./backups/<pre-upgrade-uploads-tarball> --yes
docker compose up -d
```

## Logs

```bash
docker compose logs -f app       # Next.js request logs, auth events
docker compose logs -f worker    # pg-boss job execution
docker compose logs -f caddy     # reverse proxy / TLS
docker compose logs -f migrate   # one-shot migration output (only runs at startup)
```

Normal `worker` output is a recurring cadence of small job-completion lines — a heartbeat job,
the SLA-flag sweep, and rate-limit cleanup. If the email channel is configured, you'll also see
periodic inbound-poll runs.

**Credentials are never logged.** IMAP/SMTP passwords, LLM API keys, and `APP_ENCRYPTION_KEY`
never appear in `docker compose logs` output — secrets are decrypted only in-process,
immediately before use.

## Health

```bash
curl http://localhost/api/health
```

This goes through Caddy on port 80 (or 443 with a real domain) — not `:3000`, which isn't
reachable from the host at all in the compose stack.

A healthy instance returns:

```json
{"status":"ok","db":"connected","worker":{"lastRunAt":"2026-07-28T22:58:14.680Z"}}
```

`worker.lastRunAt` is the timestamp the worker's heartbeat job last wrote. **A stale
`lastRunAt` that isn't advancing over several minutes means the worker process is down even
though the app answers 200** — the app and worker are separate processes, and a healthy `app`
tells you nothing about `worker` on its own. Check `docker compose ps worker` and `docker compose
logs worker` when this happens.
