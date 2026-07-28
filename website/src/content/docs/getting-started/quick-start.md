---
title: Quick start
description: Get a self-hosted AIDA instance running with docker compose in a few minutes.
---

AIDA runs as a single `docker compose` stack — one server, no managed cloud dependency. An LLM
provider is optional: AIDA runs (and the core helpdesk works) with AI turned off, and you can
configure a provider later from Settings.

## Prerequisites

- Docker and Docker Compose
- About 2 GB of free RAM
- Ports **80** and **443** free on the host
- (Optional) An API key for OpenAI or Anthropic, or a running [Ollama](https://ollama.com) instance
  for a fully local/BYO LLM setup

## 1. Clone and configure

```bash
git clone https://github.com/afrizzal/aida.git
cd aida
cp .env.example .env
```

Generate the three required secrets and paste each into `.env`:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # RATE_LIMIT_PEPPER
openssl rand -base64 32   # APP_ENCRYPTION_KEY
```

Also set a real `POSTGRES_PASSWORD` in `.env` — the value shipped in `.env.example` is only
meant for a quick local trial, not for anything exposed beyond your machine.

## 2. Start the stack

```bash
docker compose up -d
```

Then open **`http://localhost`** and complete the `/setup` wizard to create the first
organization and admin account.

For a headless first run (CI, scripted installs), set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and
`ADMIN_NAME` in `.env` *before* the first boot — AIDA auto-creates the admin and org and skips
the wizard.

:::note
`http://localhost:3000` is **not** the URL for the compose stack — that port is internal to the
Docker network. Port 3000 only applies when running the app directly with `pnpm dev` outside
Docker. Through `docker compose up`, everything is served by Caddy on `http://localhost` (port 80).
:::

## What just started

| Service | Role |
|---|---|
| `db` | PostgreSQL 16 with the pgvector extension — the only datastore AIDA uses |
| `migrate` | One-shot job that runs `prisma migrate deploy`, then exits |
| `app` | The Next.js application |
| `worker` | Background jobs (email polling/sending, SLA checks, embeddings, AI runs) via pg-boss |
| `caddy` | Reverse proxy — serves the app on port 80, and automatic HTTPS if you set `DOMAIN` to a real domain |

## 3. Verify it's working

```bash
curl http://localhost/api/health
```

A healthy instance returns a JSON body reporting the app status and the worker's last heartbeat
time. If the request fails, check `docker compose logs app` and `docker compose logs migrate`
first — most first-run issues are a missing `.env` value or the migration job still running.

## Next steps

Configuring email intake, an LLM provider, and other settings is covered in the rest of the
[AIDA repository docs](https://github.com/afrizzal/aida#readme).
