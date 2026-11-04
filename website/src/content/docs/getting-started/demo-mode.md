---
title: Try AIDA with demo data
description: Boot a fully populated demo helpdesk with one environment variable, and understand exactly which parts of it are real AI versus stored results.
---

By the end of this page you'll have a fresh AIDA instance boot straight into a fully populated
helpdesk — no manual seeding, no empty inbox — and you'll know precisely which parts of what you
see are live AI and which are pre-recorded data.

## What demo mode is

Demo mode is a single environment variable, `DEMO_MODE=true`, checked once at boot. On an **empty
database** (no organization and no user), it auto-creates a demo organization plus a demo admin and
demo agent account, then loads a fictional support dataset — so `docker compose up` gives you an
instantly explorable, realistic helpdesk instead of a blank one.

## What gets seeded

- **30 tickets** spread across every status and SLA state, including tickets that are at-risk and
  tickets that have breached their SLA
- **12 contacts** across **7 companies**
- Tags and custom fields
- **6** knowledge-base articles
- CSAT responses from resolved tickets
- **three** completed AIDA Insight runs (recurring-issue clusters, KB-gap detection, volume
  drivers, SLA/CSAT summary)

## How to enable it

Edit `.env`:

```bash
DEMO_MODE=true
```

Then start (or restart) the stack:

```bash
docker compose up -d
```

Sign in with the credentials documented in `.env.example`:

| Account | Email | Password |
|---|---|---|
| Demo admin | `DEMO_ADMIN_EMAIL` (default `admin@demo.aida.test`) | `DEMO_ADMIN_PASSWORD` (default published in `.env.example`) |
| Demo agent | `DEMO_AGENT_EMAIL` (default `agent@demo.aida.test`) | same as the demo admin password |

## The honesty section — read this before you judge the AI

Everything AI-looking you see in the demo — triage chips on tickets, the AI Activity trail, the
AIDA Insight cards — renders with **no LLM provider configured at all**. That's possible because
those results are *stored data*, not a live model call: every seeded AI artifact is stamped
`provider: "demo"` and `model: "demo-seed"` in the audit log, exactly like a real result would be,
except it was written directly by the seed script.

That has two honest consequences:

- **Live AI actions still require a real provider.** Clicking Generate draft, Generate insights,
  or Re-run triage on a demo ticket behaves exactly as it would on a real instance with no
  provider configured — it needs Settings → AI Features set up first (see
  [AI provider setup](/aida/configuration/ai-providers/)).
- **RAG retrieval finds nothing, on purpose.** The seeded knowledge base is intentionally **not
  embedded** — its articles sit in `PENDING` embedding status. Retrieval-augmented drafts have
  nothing to retrieve until you configure an embedding provider and run **Re-embed all** from
  Settings → AI Features.

## When demo mode seeds, skips or refuses

Before it writes anything, the demo boot (and `pnpm db:seed`, which shares the same check) looks at
the organizations and users in the database. Migrations, the job queue and other infrastructure
rows never count.

| Database holds | What demo mode does |
|---|---|
| No organization and no user | Seeds the demo |
| The complete demo (one organization carrying the demo completion marker, only the demo accounts) | Leaves it as it is |
| An incomplete demo (demo accounts, no completion marker) | Refuses with one log line and writes nothing |
| Anything else, such as a real workspace | Refuses with one log line and writes nothing |

A refusal never deletes or changes anything, and the app still starts normally. If you also set
`ADMIN_EMAIL` and `ADMIN_PASSWORD`, the headless admin bootstrap runs first and creates a real
workspace, so demo mode then refuses: set one or the other.

## Starting the demo over

The seed's writes are not one transaction; the completion marker is written last. A seed that
stops part-way leaves an incomplete demo that both demo mode and `pnpm db:seed` refuse from then
on. AIDA never deletes it for you. To start over:

1. Stop the writers: `docker compose stop app worker`.
2. Keep the old database and uploads as they are, for investigation.
3. Point the demo at a new, separate database, for example a separate Compose project with its
   own volumes, or a new, empty database set in `AIDA_DATABASE_URL`.
4. Let the migrations run on the new database and seed it (boot with `DEMO_MODE=true`, or run
   `pnpm db:seed` against it).

Never add the completion marker by hand to make AIDA accept the old database. The full procedure
is in `docs/OPERATIONS.md`, section "Demo mode".

:::caution
**Never enable demo mode on an internet-facing instance.** The demo admin and agent credentials
above are published in this documentation and in `.env.example` — anyone who reads either can log
in. Demo mode is for local evaluation only, never for real tickets.
:::
