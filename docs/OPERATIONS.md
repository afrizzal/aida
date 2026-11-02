# Operations

The day-two runbook for a self-hosted AIDA instance: backups, restore, upgrades, logs, health checks, and every environment variable. Written for a single-server operator, not a platform team — every command here runs against the shipped `docker-compose.yml` as-is.

## Backups

A **complete** AIDA backup has two parts, and both are required to restore an instance:

1. A **Postgres logical dump** (`pg_dump --format=custom`) — tickets, contacts, messages, KB articles, insight runs, settings, everything in the database.
2. A **tarball of the `uploads_data` volume** — every ticket and task attachment. Files live on disk under `/data/uploads`, not in Postgres, so a database-only dump silently loses every attachment. The `app` and `worker` services share this volume: the app stores uploads, and the worker stores inbound email attachments and runs the scheduled job (every minute) that removes the files of deleted task attachments.

**A database-only dump is not a complete backup.** Never treat `pg_dump` alone as sufficient.

Run:

```bash
./scripts/backup.sh ./backups
```

This produces two timestamped files in the output directory (default `./backups` if you omit the argument):

```
backups/aida-db-20260728T225848Z.dump
backups/aida-uploads-20260728T225848Z.tar.gz
```

The script prints both file paths, their sizes, and the exact restore command to use them. It requires the `db` service to already be running (`docker compose up -d db`) and exits with an error if either output file ends up empty.

If you use the legacy `docker-compose` binary instead of the `docker compose` plugin:

```bash
COMPOSE_CMD="docker-compose" ./scripts/backup.sh ./backups
```

### Automating backups (cron)

AIDA v1 ships **no built-in scheduler** — there is no backup sidecar service (deferred idea, see roadmap). Schedule `backup.sh` yourself with cron and prune old backups on a retention window:

```cron
# 03:30 daily, keep 14 days
30 3 * * * cd /srv/aida && ./scripts/backup.sh /srv/aida-backups >> /var/log/aida-backup.log 2>&1
35 3 * * * find /srv/aida-backups -type f -mtime +14 -delete
```

**Copy backups off the machine.** A backup that lives on the same disk as the instance it protects does not survive a disk failure. Sync `/srv/aida-backups` to off-box storage (object storage, another host, etc.) as part of your own operational practice — this is outside what the scripts do.

## Restore

```bash
./scripts/restore.sh <db-dump> <uploads-tarball>
```

Example, using the files a backup just produced:

```bash
./scripts/restore.sh ./backups/aida-db-20260728T225848Z.dump ./backups/aida-uploads-20260728T225848Z.tar.gz
```

**This is destructive.** It replaces the entire current database and the entire contents of the uploads volume with the contents of the backup files. There is no undo other than restoring a different backup. Unless you pass `--yes`, the script prompts for an explicit `restore` confirmation before touching anything.

What it does, in order:

1. Stops `app` and `worker` (prevents concurrent writes and pg-boss job pickup mid-restore).
2. Restores the database with `pg_restore --clean --if-exists --no-owner --no-privileges`.
3. Wipes and re-extracts the uploads volume from the tarball.
4. Starts `app` and `worker` again.
5. Polls `GET /api/health` (inside the `app` container) for up to 60 seconds and prints the result.

**On the `AuditEvent` append-only trigger:** the database carries a trigger (`aida_audit_event_no_update_delete`) that raises an error on `UPDATE`/`DELETE` against `AuditEvent` rows — this is intentional (audit integrity). Restore is unaffected: `pg_restore --clean` issues `DROP TABLE`, not `DELETE`, so the trigger never fires during a restore. **Never** try to prune audit rows yourself with a manual `DELETE` — it will raise, by design. If you need audit retention policy, that's a product feature request, not a DB workaround.

**On benign restore warnings:** `pg_restore` can print warnings when restoring into a non-empty database, and in particular it always logs one specific ignorable error — a `cannot drop inherited constraint` message against `pgboss.job_common` (pg-boss's job table is declaratively partitioned; this is a known `pg_dump`/`pg_restore` limitation with declarative partitioning, not a real problem). `restore.sh` recognizes this exact message and continues; any other `pg_restore` error still aborts the script and surfaces as a failure. If you ever see the script abort, treat it as real — this is only a runbook note about the one case that is not.

## Restore to a new server

Moving AIDA to new hardware (disk failure, migration, etc.):

1. **Install Docker** (Docker Engine + Compose plugin) on the new server.
2. **Clone the repo**: `git clone <your-fork-or-origin> && cd aida`.
3. **Recreate `.env`.** Copy your old `.env` across, or recreate it from `.env.example`. **`BETTER_AUTH_SECRET` and `APP_ENCRYPTION_KEY` MUST be the exact same values as the old server.** If they differ, existing user sessions become invalid and — more importantly — every stored IMAP/SMTP/LLM credential becomes permanently undecryptable (they're encrypted with `APP_ENCRYPTION_KEY`; there is no recovery path for a lost key other than re-entering every credential from scratch).
4. **Start the database only**: `docker compose up -d db`. It **must** be the `pgvector/pgvector:pg16` image already pinned in `docker-compose.yml` — a stock `postgres:16` image cannot load a dump containing `CREATE EXTENSION vector`, and restore will fail.
5. **Run the restore**: `./scripts/restore.sh <db-dump> <uploads-tarball> --yes` (the `db` service from step 4 satisfies the script's preflight check; `app`/`worker` don't need to exist yet — `stop`/`start` on services that were never created is a no-op).
6. **Bring up the full stack**: `docker compose up -d`.
7. **Verify**: `curl http://localhost/api/health` should return `{"status":"ok",...}`.
8. **Point DNS** at the new host and set `DOMAIN` in `.env` to your real domain, then `docker compose up -d caddy` — Caddy will automatically obtain a fresh Let's Encrypt certificate for the domain once ports 80/443 are reachable from the internet.

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

The one-shot `migrate` service runs `prisma migrate deploy` automatically before `app`/`worker` start (it's gated on `db` being healthy, and `app`/`worker` are gated on `migrate` completing successfully) — **no manual migration step is needed**.

**Take a backup first**: `./scripts/backup.sh ./backups` before every upgrade. If something goes wrong, roll back by checking out the previous git tag and restoring the pre-upgrade dump:

```bash
git checkout <previous-tag>
docker compose build
./scripts/restore.sh ./backups/<pre-upgrade-db-dump> ./backups/<pre-upgrade-uploads-tarball> --yes
docker compose up -d
```

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

The procedure is idempotent: running steps 5 and 6 again changes nothing and prints the same result. There is deliberately no automatic fix: no root entrypoint, `su-exec` wrapper or init container changes operator data without the operator's consent.

## Logs

```bash
docker compose logs -f app       # Next.js request logs, auth events
docker compose logs -f worker    # pg-boss job execution
docker compose logs -f caddy     # reverse proxy / TLS
docker compose logs -f migrate   # one-shot migration output (only runs at startup)
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
| `DATABASE_URL` | Yes | `postgresql://aida:aida@localhost:5432/aida` | Postgres connection string. In Docker Compose, `app`/`worker`/`migrate` get this constructed for them from `POSTGRES_*` and don't read the `.env` value directly — it only matters for local (non-Docker) dev. |
| `POSTGRES_USER` | Yes | `aida` | Postgres role used by the `db` service and by `backup.sh`/`restore.sh`. |
| `POSTGRES_PASSWORD` | Yes | — | Postgres password. The `db` service refuses to start without it. |
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
| `DEMO_MODE` | No | *(blank)* | When exactly `true` **and** the database has zero tickets, the app auto-creates a demo org/admin/agent and loads the fictional demo dataset at boot. **Never enable this on an internet-facing instance** — the credentials below are documented publicly (README, this file). Leave blank for a normal install. |
| `DEMO_ADMIN_EMAIL` | No | `admin@demo.aida.test` | Email for the auto-created demo admin account. Only takes effect when `DEMO_MODE=true`. |
| `DEMO_ADMIN_PASSWORD` | No | `aida-demo-2026` | Password for the auto-created demo admin (and demo agent) account. Only takes effect when `DEMO_MODE=true`. |
| `DEMO_AGENT_EMAIL` | No | `agent@demo.aida.test` | Email for the auto-created demo agent account ("Sam Rivera"). Only takes effect when `DEMO_MODE=true`. |

### Demo mode

Demo mode (AIDA-22) turns a fresh `docker compose up` into an instantly explorable, fully populated helpdesk — no shell, no `pnpm db:seed` command, just one environment variable.

**Turning it on:** set `DEMO_MODE=true` in `.env` (optionally override `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` / `DEMO_AGENT_EMAIL`) before the **first** `docker compose up` against a fresh database. On boot, `instrumentation.register()` logs a loud `[demo] DEMO MODE IS ACTIVE...` warning, then — only if the workspace has zero tickets — creates the demo org, a demo admin, a demo agent, and seeds ~30 tickets, contacts, KB articles, CSAT responses, and three completed AIDA Insight runs.

**It only fires once, on an empty database.** If the workspace already has tickets (a real install, or a demo that already seeded), `DEMO_MODE=true` is a safe no-op — the boot log shows `[demo] Demo data already present (N tickets) — skipping seed.` instead of seeding again.

**Resetting a demo instance:** `docker compose down -v` (this **deletes all data**, including the uploads volume) then `docker compose up` again with `DEMO_MODE=true` still set — seeding starts fresh against the new, empty database.

**The seeded AI results are stored data, not live model output.** Every seeded triage tag, drafted-reply audit row, and Insight run is stamped `provider: "demo"` / `model: "demo-seed"` — the UI renders it exactly like a real AI result would, but it was written directly by the seed script so every AI surface looks populated even with **zero LLM configured**. Turning on a real provider in Settings → AI does not touch this seeded data; it only affects new, live AI actions (Generate draft, Generate insights, Re-run triage) from that point forward.

## Troubleshooting

**Uploads fail with a permission error after upgrading.**
The `uploads_data` volume was written by an older release whose containers ran as root, while `app` and `worker` now run as the `node` user (UID 1000). Follow [Upgrading an install whose containers ran as root](#upgrading-an-install-whose-containers-ran-as-root): back up first, then change the volume's owner to `1000:1000` once and verify it.

**`app` is unhealthy but `db` is up.**
Check `DATABASE_URL` construction (Compose builds it from `POSTGRES_*`; a local `.env` override can conflict). Check the `migrate` service actually completed: `docker compose ps migrate` should show `Exited (0)`; if it exited non-zero, `app`/`worker` never start (they're gated on `migrate`'s success) — read `docker compose logs migrate`.

**Worker heartbeat is stale (`/api/health`'s `worker.lastRunAt` isn't advancing).**
`docker compose logs worker` — look for a crash loop or an unhandled exception. `docker compose ps worker` — confirm the container is actually `Up`, not restarting.

**Caddy fails to obtain a TLS certificate on a real domain.**
Let's Encrypt needs to reach the server on ports 80 and 443 from the public internet to complete the ACME challenge — check your firewall/security group and that `DOMAIN` in `.env` resolves (DNS) to this server's public IP. `docker compose logs caddy` shows the ACME error detail.

**Attachments are missing after a restore.**
The uploads tarball wasn't restored — either `restore.sh` was run with the wrong (or a database-only) backup, or the tarball argument was omitted. `restore.sh` always requires both a `DB_DUMP` and an `UPLOADS_TARBALL` argument; there is no way to restore only the database through the script (by design — a partial restore would silently reintroduce the exact "lost every attachment" failure mode this runbook warns about).

**Database connection exhaustion / "too many connections".**
`app`'s pool (`DB_POOL_MAX=10`) plus `worker`'s pool (`DB_POOL_MAX=5`) must stay comfortably under Postgres's `max_connections` (default 100). If you've scaled `app`/`worker` replicas or added other Postgres clients, check `SELECT count(*) FROM pg_stat_activity;` against the `max_connections` setting before raising either pool size.
