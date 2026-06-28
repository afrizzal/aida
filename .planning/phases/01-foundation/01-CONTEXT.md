# Phase 1: Foundation - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Bootstrap the entire AIDA application stack from a blank repository: Next.js 16 App Router + TypeScript + Prisma + PostgreSQL 16 + pgvector + pg-boss, with authentication/roles, workspace-scoped data access, one-command self-host (`docker compose up`), and a screenshot-ready app shell.

Phase 1 does NOT ship any LLM code, domain ticketing logic, email channels, or knowledge-base features. Those are Phases 2–6.

</domain>

<decisions>
## Implementation Decisions

### Auth Library
- **D-01:** Use **Better Auth** with the Prisma adapter — credentials (email/password) built-in, database sessions (not JWT-only; sessions stored in Postgres for revocation, active-session visibility, and admin impersonation).
- **D-02:** Enable the **organization plugin** (multi-tenancy) and **admin plugin** (RBAC, user invites, impersonation). Run `npx @better-auth/cli generate` to write Better Auth's Prisma models (`organization`, `member`, `invitation`, `session`, `account`, `user`) into schema.prisma.
- **D-03:** Use **database sessions** only — not JWT. Rationale: helpdesk needs revocation (offboard an agent), active-session visibility, and admin impersonation. JWT-only can't revoke without a denylist.

### Schema Tenancy
- **D-04:** Better Auth's `Organization` table IS the workspace. There is NO separate `Workspace` domain model. All domain tables (Ticket, Contact, KbArticle, …) carry `organizationId String` + `@relation(fields: [organizationId], references: [id])` + an index. `scopedDb(orgId)` scopes all queries by this column.
- **D-05:** Do NOT add a parallel `Workspace` model — `Organization` is the single source of truth. `member` and `invitation` tables are Better Auth-managed; do not duplicate roles or invites in custom tables.

### Roles
- **D-06:** Better Auth org roles: `owner`, `admin`, `member`. Map "agent" to `member` for now. Extend to a custom role vocabulary via the access-control plugin when team features land (future phase).

### First-Run Admin Bootstrap
- **D-07:** **Primary path — setup wizard:** On first `docker compose up`, the app detects zero users → redirects all requests to `/setup` → user creates the first organization + admin account via a Better Auth signup → wizard self-disables → public registration locked forever (admin-invite-only thereafter). Follows the self-hosted standard (GitLab, Ghost, Sentry, Grafana, n8n).
- **D-08:** **Escape hatch — env-var bootstrap:** Optionally honor `ADMIN_EMAIL` + `ADMIN_PASSWORD` (or a one-time `BOOTSTRAP_TOKEN`) at container start for headless/IaC/CI installs. When present, run a bootstrap script and skip the wizard. Never ship default `admin/admin` creds.

### Docker / Self-Host
- **D-09:** **Two docker-compose services from ONE shared image.** `app` service: `command: next start`. `worker` service: `command: node dist/worker.js`. Independent `restart: unless-stopped` policies and separate memory limits (worker is CPU/LLM-bound; app is I/O-bound). Connection pools sized so `app_pool + worker_pool < max_connections`.
- **D-10:** **Multi-stage Dockerfile.** Builder stage → Next.js `output: "standalone"`; both services CMD-override the same final image.
- **D-11:** **Postgres image:** `pgvector/pgvector:pg16`. Named volume for the Postgres data directory (single source of truth for backup/restore).
- **D-12:** **Caddy in Phase 1.** One `caddy` service + Caddyfile. `DOMAIN` env var → Caddyfile site block (localhost fallback for local dev, Let's Encrypt auto-HTTPS for production). Bakes in `trustedOrigins`, Secure/SameSite cookies, and `X-Forwarded-*` header handling correctly while auth is being built — avoids a Phase 7 retrofit.
- **D-13:** **Runtime:** pnpm, Node 22 LTS (pinned in `.nvmrc` + Dockerfile `FROM`). Next.js `output: "standalone"`.

### API / Data-Access Convention
- **D-14:** App Router native — **Server Components** for reads, **Server Actions** for internal mutations, **Route Handlers** for external-facing endpoints (webhooks, `/api/health`). No tRPC, no GraphQL.
- **D-15:** All data access goes through `scopedDb(orgId)` — a Prisma client extension that automatically injects `organizationId: orgId` into every query's `where` clause. Inputs validated with zod at the Server Action / Route Handler boundary.

### Worker / Jobs
- **D-16:** Phase 1 ships **ONE heartbeat job** — a recurring pg-boss job that writes `lastRunAt` to a settings row and proves the full queue path (schema created, enqueue → dequeue → complete/ack). Not throwaway: `/api/health` reads `lastRunAt` to report worker liveness. Acts as a CI assertion.
- **D-17:** Zero domain jobs (triage, email, LLM) in Phase 1. pg-boss is initialized and the worker entrypoint is established; domain jobs are Phase 2+.

### AI Boundary
- **D-18:** Phase 1 ships **zero LLM code**. `lib/llm/` does not exist yet. The only AI-related artifact is a workspace setting toggle (`aiEnabled: false` default) stored in the database. AI toggle surfaced in the Settings stub page. `lib/llm/` abstraction and all AI features are Phase 4.

### Testing
- **D-19:** **Vitest** as the test framework (ESM-native, fast, minimal config — fits the TS/Next stack). **Biome** for lint + format.
- **D-20:** The workspace isolation test is a **real Postgres integration test** — never mocked. Use Testcontainers (or a dedicated `test-db` compose service). Migrate → seed Workspace A + B → assert `scopedDb(A)` never returns B rows → per-test transaction rollback for speed. This is the ROADMAP success criterion for AIDA-11.

### pgvector
- **D-21:** Phase 1: `CREATE EXTENSION IF NOT EXISTS vector` in a Prisma migration — extension enabled only. No vector columns, no `KbChunk` table. Embedding dimension deferred to Phase 5 (runtime choice set by the operator's BYO embedding model — could be 1536, 768, 3072, etc.; hardcoding violates the model-agnostic mandate).

### UI Scaffolding
- **D-22:** Ship an **auth-gated route group** (`(app)`) with a persistent layout: sidebar navigation + top bar. shadcn/ui + Tailwind CSS, theme provider with dark mode (wired once for all phases).
- **D-23:** Ships: login page, first-run setup wizard. **No public register page** — AIDA is admin-invite-only for agents; end-customers file tickets later without accounts (Phase 2+).
- **D-24:** Sidebar nav stubs: **Tickets**, **Knowledge Base**, **Settings** — each pointing to an empty page with placeholder content. Phase 2 replaces the Tickets stub with real ticket views.
- **D-25:** Goal: "full shell, empty rooms" — provides a screenshot-worthy product for the README hero (repo health = star driver) without over-building UI that Phase 2 reshapes.

### Claude's Discretion
- TypeScript `tsconfig.json` strict mode, path aliases (`@/lib`, `@/components`, etc.) — standard Next.js App Router conventions.
- Prisma schema organization — single `schema.prisma` is appropriate for Phase 1.
- Error handling patterns, loading states within stub pages.
- Connection pool sizing details (ensure `app_pool + worker_pool < max_connections`).
- Specific Caddyfile directives beyond the site block and `reverse_proxy`.
- GitHub Actions CI setup (typecheck + Vitest) — add if time allows; not a Phase 1 blocker.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Security
- `docs/ARCHITECTURE.md` — Module layout (`lib/db`, `lib/auth`, `lib/llm`, etc.), topology diagram, data model sketch, two-entrypoint app+worker design, why this stack
- `docs/SECURITY.md` — Auth/tenancy controls, secret handling, untrusted-input approach, what the Phase 7 security pass verifies

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — AIDA-10 (auth + roles), AIDA-11 (workspace scoping), AIDA-21 (docker compose up) — Phase 1 requirements with full acceptance criteria
- `.planning/ROADMAP.md` — Phase 1 success criteria (4 items) and full 7-phase sequencing context

### Project Constraints
- `CLAUDE.md` — Stack non-negotiables (pg-boss not Redis, pgvector in same Postgres, AI model-agnostic and toggleable, single-server, human-in-the-loop)
- `.planning/PROJECT.md` — Vision, core value, architectural principles, out-of-scope list for v1

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — this is a greenfield project. No existing components, hooks, or utilities.

### Established Patterns
- None yet — Phase 1 establishes the patterns all subsequent phases follow.

### Integration Points
- `LICENSE` (Apache-2.0) and skeleton `README.md` already committed — Phase 1 scaffolds the app into this repo without replacing these files.
- `.planning/` directory contains planning artifacts used to guide Phase 1.

</code_context>

<specifics>
## Specific Ideas

- **Better Auth admin impersonation** is explicitly wanted — "impersonation is gold for a helpdesk" (allows support staff to see what an agent/customer sees without credential sharing).
- **Self-host wizard pattern** follows GitLab, Ghost, Sentry, Grafana, n8n — "first person to the /setup URL becomes the admin."
- **Heartbeat job as dual-purpose signal:** Proves the full queue path AND provides the `/api/health` worker-liveness signal — not throwaway code.
- **"Full shell, empty rooms"** is the explicit UI metaphor: screenshot-worthy layout with stubs that Phase 2 replaces.
- **DOMAIN env var** controls Caddy's site block — same Caddyfile works for localhost (dev) and a real domain (prod/self-host). Let's Encrypt auto-HTTPS is a real product selling point.
- **Better Auth CLI:** `npx @better-auth/cli generate` writes the organization/member/invitation Prisma models; domain models then add `@relation` back-references and migrations are run.

</specifics>

<deferred>
## Deferred Ideas

- **i18n / multi-language UI** — not Phase 1; v1 scope says responsive web only.
- **Demo seed data** — explicitly Phase 7 (AIDA-22, Launch Readiness).
- **Custom error pages** (404, 500) — Phase 1 ships Next.js defaults; polish is Phase 7.
- **Backup/restore docs** — Phase 7 (AIDA-24). Phase 1 commits a named Postgres volume; docs are Phase 7.
- **`lib/llm/` abstraction** — Phase 4. Phase 1's only AI artifact is the `aiEnabled` toggle in workspace settings.
- **GitHub Actions CI** — Nice-to-have in Phase 1 if time allows; not a blocker. Phase 7 is the repo health milestone.
- **Embedding dimension decision** — Phase 5, when the BYO embedding model is chosen. Deferred by design (model-agnostic mandate).
- **Custom role vocabulary beyond owner/admin/member** — Future phase, extend via Better Auth access-control plugin.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-06-29*
