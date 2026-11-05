---
title: Upgrading, logs & health
description: How to upgrade a running instance, read its logs, and check whether it's actually healthy.
---

By the end of this page you'll know how to upgrade AIDA safely, read its logs, and tell a
healthy instance apart from one that only looks healthy.

## Upgrading

:::caution[Upgrading from a release whose containers ran as root?]
`app`, `worker` and `migrate` now run as the image's built-in `node` user (UID/GID 1000). A fresh
install needs nothing. An existing `uploads_data` volume written by an older release is owned by
root, so new uploads and inbound email attachments fail with a permission error until you change
its ownership once. Use the steps in the next section instead of the plain upgrade below.
:::

### One-time uploads ownership change (installs that ran as root)

Do this once, in order:

1. Before pulling the new release, still on the old images, take a backup:
   `./scripts/backup.sh ./backups`
2. Pull and build the new release: `git pull`, then `docker compose build`.
3. Stop the services that write uploads: `docker compose stop app worker`.
4. Find the real volume name with `docker volume ls --filter name=uploads_data`. Compose prefixes
   it with the project name (for example `aida_uploads_data`); make sure the one you change is
   AIDA's.
5. **The next command recursively changes the owner of every file in the uploads volume. Run it
   only after the backup in step 1 has finished, and only against AIDA's uploads volume.** It runs
   a one-off container of the new image as root:

   ```bash
   docker compose run --rm --no-deps --user 0:0 --entrypoint chown app -R 1000:1000 /data/uploads
   ```

6. Verify. This must print `1000:1000` and nothing else:

   ```bash
   docker compose run --rm --no-deps --entrypoint sh app -c 'stat -c "%u:%g" /data/uploads; find /data/uploads ! -user 1000 | head -n 1'
   ```

7. Start the stack: `docker compose up -d`.

Running steps 5 and 6 again changes nothing. There is deliberately no automatic fix: nothing
changes your data's ownership without you running it. The full procedure is in
[Upgrading an install whose containers ran as root](https://github.com/afrizzal/aida/blob/master/docs/OPERATIONS.md#upgrading-an-install-whose-containers-ran-as-root).

### Every upgrade

Back up first:

```bash
./scripts/backup.sh
```

Then:

```bash
git pull
docker compose build
docker compose up -d
```

The one-shot `migrate` service runs `prisma migrate deploy` automatically before `app`/`worker`
start — **there is no manual migration step**.

To roll back, check out the previous git tag and restore the set taken before the upgrade:

```bash
git checkout <previous-tag>
docker compose build
./scripts/restore.sh <pre-upgrade-setId> --yes
docker compose up -d
```

This needs a previous tag that already has set-based backups; older releases' own `restore.sh`
takes a database dump and an uploads tarball instead.

## Logs

```bash
docker compose logs -f app       # Next.js request logs, auth events
docker compose logs -f worker    # pg-boss job execution
docker compose logs -f caddy     # reverse proxy / TLS
docker compose logs -f migrate   # one-shot migration output (only runs at startup)
docker compose logs -f backup    # scheduled backups: next run, results, skip and failure lines
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

The endpoint is public, so it guards the database. Its database read comes from a **3-second
cache** (a 503 included), and concurrent requests share one read, so the status can lag by up
to 3 seconds. Each client address may call it 60 times a minute; callers without a usable
client address share 120 a minute. The throttle
is in memory, per app process, and never logs or stores the addresses it counts. Over the limit
you get HTTP 429 with `{"error":"rate_limited"}` and an integer `Retry-After` header; poll every
10 seconds or slower. `worker.lastRunAt` stays in the public response by choice: it holds no
tenant data and is served from the cache.

The container healthcheck does not use `/api/health`. It calls
`http://127.0.0.1:3000/api/health/probe`, which answers `{"status":"ok"}` (200) or
`{"status":"error"}` (503) from the same **3-second cache**, with no rate limit. Caddy refuses that
path with a 404, so public requests can never reach the probe or use up a quota it depends on: the
health throttle cannot make the container unhealthy. Heavy load still can, because the probe reads
the same database snapshot; traffic that saturates the app or the database connection pool can make
it time out or answer 503. Point external monitors at `/api/health` through Caddy. Anything that can reach `app:3000` directly can call the
probe and read the binary database status from it — that is the trust boundary described in the
operations runbook's "Client IP and reverse proxies" section.
