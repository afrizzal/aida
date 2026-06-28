# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 01-foundation
**Areas discussed:** Auth library, Schema tenancy, Roles, First-run bootstrap, Docker/self-host/build/runtime, API/data-access convention, Worker topology, Worker jobs, AI boundary, Testing framework, pgvector scope, UI scaffolding depth

---

## Auth Library

| Option | Description | Selected |
|--------|-------------|----------|
| Auth.js v5 | Formerly NextAuth; credentials + OAuth; perpetual-beta; maintainers now recommend Better Auth for new projects | |
| Lucia v3 | Deprecated Mar 2025; now a "build-it-yourself" guide | |
| Better Auth | TypeScript-first, self-hosted, email/password built-in, organization + admin plugins, Prisma adapter, database sessions | ✓ |
| Custom JWT / @oslojs | Hand-roll sessions/RBAC/invites; clean revocation requires a denylist | |

**User's choice:** Better Auth with Prisma adapter + database sessions + organization + admin plugins
**Notes:** Lucia is deprecated. Auth.js v5 maintainers now recommend Better Auth for new projects ("migration-only" framing). Database sessions chosen over JWT: helpdesk needs session revocation (offboarding agents), active-session visibility, and admin impersonation. "Impersonation is gold for a helpdesk."

---

## Schema Tenancy — Better Auth Org as Workspace

| Option | Description | Selected |
|--------|-------------|----------|
| Better Auth `organization` IS the workspace | `organizationId` FK on all domain tables; `scopedDb(orgId)`; no separate Workspace model | ✓ |
| Separate AIDA `Workspace` model | Custom table references Better Auth org; domain tables FK to Workspace.id; duplicates the org concept | |

**User's choice:** Better Auth org IS the workspace — single source of truth.
**Notes:** `npx @better-auth/cli generate` writes org/member/invitation Prisma models into schema.prisma. Domain models add `@relation` back-references. `member` + `invitation` are Better Auth-managed — do not duplicate roles or invites in custom tables.

---

## Roles

**User provided directly (no separate question):**
Better Auth org roles: `owner`, `admin`, `member`. Map "agent" ≡ `member` for now. Extend via Better Auth access-control plugin when team features land (future phase).

---

## First-Run Admin Bootstrap

| Option | Description | Selected |
|--------|-------------|----------|
| Setup wizard (primary) | Zero users → /setup → create org + admin → wizard self-disables → invite-only forever after | ✓ |
| Env-var escape hatch | `ADMIN_EMAIL`/`ADMIN_PASSWORD` or `BOOTSTRAP_TOKEN` for headless/IaC/CI installs | ✓ (secondary) |
| Prisma seed only | Requires manual step outside docker compose | |
| First-user-becomes-admin | Auto-elevate first registrant; less explicit; no wizard UX | |

**User's choice:** Setup wizard as primary + env-var escape hatch for CI.
**Notes:** Pattern follows GitLab, Ghost, Sentry, Grafana, n8n — self-hosted standard. "Near-zero setup friction" star-driver. Never ship default admin/admin creds.

---

## Caddy Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 1 | Wire in docker-compose now; ~15 lines; auto-HTTPS; de-risks auth cookie topology while auth is built | ✓ |
| Phase 7 | Defer to Launch Readiness; simpler dev loop now | |

**User's choice:** Phase 1.
**Notes:** De-risks auth specifically — Secure/SameSite cookies, `trustedOrigins`, `X-Forwarded-*` all depend on the proxy/TLS topology. Get right during auth build, not during Phase 7 polish. Dev still uses `pnpm dev` directly; committed docker-compose routes through Caddy.

---

## Docker / Build / Runtime

**User provided decisions directly:**

| Decision | Choice |
|----------|--------|
| Docker services | Two services (app + worker) from ONE shared image; CMD override |
| Dockerfile | Multi-stage; Next.js `output: "standalone"` |
| Postgres image | `pgvector/pgvector:pg16`; named volume |
| Caddy config | `DOMAIN` env var → Caddyfile site block; localhost fallback; Let's Encrypt auto-HTTPS |
| Runtime | pnpm; Node 22 LTS pinned in `.nvmrc` + Dockerfile `FROM` |

---

## API / Data-Access Convention

**User provided decisions directly:**

| Decision | Choice |
|----------|--------|
| Server Components | Reads |
| Server Actions | Internal mutations |
| Route Handlers | External endpoints (webhooks, `/api/health`) |
| API layer | No tRPC, no GraphQL |
| Data access | `scopedDb(orgId)` Prisma client extension; zod-validated inputs |

---

## Worker Deployment in docker-compose

| Option | Description | Selected |
|--------|-------------|----------|
| One service (both in same container) | Simpler compose; crash coupling; pg-boss poll loop fragile inside Next.js lifecycle | |
| Two services, one shared image | `app=next start`, `worker=node dist/worker.js`; CMD override; independent restart + memory limits | ✓ |

**User's choice:** Two services, one shared image.
**Notes:** Matches ARCHITECTURE.md topology. Independent restart policies. Pool sizing: `app_pool + worker_pool < max_connections`. Dev runs both via `concurrently`/`tsx watch`.

---

## Phase 1 Worker Jobs

| Option | Description | Selected |
|--------|-------------|----------|
| Infra-only (no jobs) | Wire up pg-boss but ship zero jobs — "looks done but isn't" | |
| One heartbeat job | Proves full queue path; writes `lastRunAt`; `/api/health` reads it; CI assertion | ✓ |

**User's choice:** One heartbeat job.
**Notes:** "Infra wire-up that's never exercised is the classic 'looks done but isn't' foundation trap." Heartbeat is dual-purpose: full-path proof AND worker-liveness signal for `/api/health`.

---

## AI Boundary

**User provided decisions directly:**

| Decision | Choice |
|----------|--------|
| Phase 1 LLM code | Zero — `lib/llm/` does not exist in Phase 1 |
| AI artifact in Phase 1 | `aiEnabled: false` toggle in workspace settings (DB-stored) |
| `lib/llm/` abstraction | Phase 4 |

---

## Testing Framework + Workspace Isolation

| Option | Description | Selected |
|--------|-------------|----------|
| Jest | Mature; slower ESM support | |
| Vitest | ESM-native, fast, minimal config | ✓ |
| Mocked DB isolation test | Faster; can't catch missing `organizationId` filters or leaky client extensions | |
| Real Postgres integration test | Testcontainers or compose test-DB; proves tenant boundary at data layer | ✓ |
| ESLint + Prettier | Common but separate tools | |
| Biome | Unified lint + format | ✓ |

**User's choice:** Vitest + Biome. Real Postgres for isolation test.
**Notes:** "A mock can't catch a missing `organizationId` filter or a leaky client extension; mocking a security boundary gives false confidence." Per-test transaction rollback for speed.

---

## pgvector in Phase 1

| Option | Description | Selected |
|--------|-------------|----------|
| Extension + vector column (KbChunk) | Commits an embedding dimension now; violates model-agnostic mandate | |
| Extension only | Meets success criteria; defers dimension choice to Phase 5 | ✓ |

**User's choice:** Extension only (`CREATE EXTENSION IF NOT EXISTS vector` in migration).
**Notes:** Embedding dimension (1536? 768? 3072?) is a runtime BYO-LLM choice set by the operator's embedding model. Hardcoding violates the model-agnostic mandate and risks a painful migration for anyone on a different-dimension local model. KbChunk is Phase 5 territory.

---

## UI Scaffolding Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal (login + bare placeholder) | Just enough to test auth | |
| Full app shell + stub pages | Auth-gated layout, sidebar, shadcn/ui, dark mode, named stub pages | ✓ |
| Complete UI (full ticket inbox) | Over-building; Phase 2 reshapes | |

**User's choice:** Full app shell with empty stub pages — "full shell, empty rooms."
**Notes:** Screenshot-worthy for README hero (repo health = star driver). No public register page — admin-invite-only. Sidebar stubs: Tickets, Knowledge Base, Settings. Phase 2 replaces Tickets stub with real views.

---

## Claude's Discretion

- TypeScript tsconfig.json, path aliases (standard Next.js App Router conventions)
- Prisma schema organization (single schema.prisma)
- Error handling, loading states within stub pages
- Connection pool sizing specifics
- Specific Caddyfile directives
- GitHub Actions CI (nice-to-have, not Phase 1 blocker)

## Deferred Ideas

- i18n / multi-language UI (v1 scope: responsive web only)
- Demo seed data (Phase 7, AIDA-22)
- Custom error pages (Phase 7 polish)
- Backup/restore docs (Phase 7, AIDA-24)
- `lib/llm/` abstraction (Phase 4)
- GitHub Actions CI (Phase 7 or nice-to-have)
- Embedding dimension decision (Phase 5)
- Custom role vocabulary beyond owner/admin/member (future phase, access-control plugin)
