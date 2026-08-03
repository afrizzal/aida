---
title: Environment variables
description: Every variable AIDA reads from .env, what it does, and which ones you must generate yourself.
---

By the end of this page you'll know what every variable in `.env.example` does and which ones
need a real, generated value before you go beyond a local trial.

This table covers exactly the variables in `.env.example` — nothing more, nothing invented.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `BETTER_AUTH_URL` | Yes | `http://localhost` | Public URL of the app, used by Better Auth for callbacks/cookies. Behind Caddy, this is your Caddy-facing URL (`http://localhost` or `https://yourdomain.com`), not `:3000`. |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost` | Public app URL exposed to the browser — links in emails, absolute URLs in client code. |
| `BETTER_AUTH_SECRET` | Yes | — | Session-signing secret. Generate with `openssl rand -base64 32`. |
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
| `UPLOADS_DIR` | Yes | `/data/uploads` | Filesystem path for stored attachments. In Docker this is the `uploads_data` volume mount — don't change it unless you also change the volume mount in `docker-compose.yml`. |
| `RATE_LIMIT_PEPPER` | Yes | — | Salts the per-IP hash used by the public-intake rate limiter (raw IPs are never stored). Generate with `openssl rand -base64 32`. |
| `APP_ENCRYPTION_KEY` | Yes (once credentials saved) | — | AES-256-GCM key encrypting IMAP/SMTP and LLM provider secrets at rest. The app boots without it, but saving any credential in Settings requires it. Generate with `openssl rand -base64 32`. |
| `DEMO_MODE` | No | *(blank)* | When exactly `true` **and** the database has zero tickets, auto-creates a demo org/admin/agent and loads the fictional demo dataset at boot. See [Try AIDA with demo data](/aida/getting-started/demo-mode/). Never enable on an internet-facing instance. |
| `DEMO_ADMIN_EMAIL` | No | `admin@demo.aida.test` | Email for the auto-created demo admin account. Only takes effect when `DEMO_MODE=true`. |
| `DEMO_ADMIN_PASSWORD` | No | `aida-demo-2026` | Password for the auto-created demo admin (and demo agent) account. Only takes effect when `DEMO_MODE=true`. |
| `DEMO_AGENT_EMAIL` | No | `agent@demo.aida.test` | Email for the auto-created demo agent account. Only takes effect when `DEMO_MODE=true`. |

## Generate your secrets

Three variables need a real random value, not the example string shipped in `.env.example`:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # RATE_LIMIT_PEPPER
openssl rand -base64 32   # APP_ENCRYPTION_KEY
```

Also set a real `POSTGRES_PASSWORD` — the shipped example value is for a quick local trial only.
Prefer a URL-safe generator such as `openssl rand -hex 24` for this one specifically: `DATABASE_URL`
is built by interpolating `POSTGRES_PASSWORD` directly into a connection-string URL without
URL-encoding it, so a base64-generated password containing `/`, `@`, `:` or `#` can silently break
the connection string.

:::danger
`BETTER_AUTH_SECRET` and `APP_ENCRYPTION_KEY` must be preserved across restores and server
migrations. Losing or changing `APP_ENCRYPTION_KEY` makes every stored IMAP/SMTP/LLM credential
**permanently undecryptable** — there is no recovery path other than re-entering every credential
from scratch. Losing or changing `BETTER_AUTH_SECRET` invalidates every existing session.
:::

## Where settings live

Not all configuration is an environment variable. Infrastructure config — URLs, secrets, database
connection, ports — lives in `.env` and is read once at boot. Product configuration — SLA
policies, tags, custom fields, the email channel, AI providers, and branding — lives in the
Settings UI and is stored per workspace in the database, so it can change without a restart. See
[Environment variables reference](https://github.com/afrizzal/aida/blob/master/docs/OPERATIONS.md#environment-variable-reference)
in the repository for the same table alongside the rest of the operations runbook.
