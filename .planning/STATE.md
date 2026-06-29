---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-06-29T02:57:54.250Z"
last_activity: 2026-06-29
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 8
  completed_plans: 3
  percent: 25
---

# STATE — AIDA v1: Minimum Lovable Helpdesk

## Project Reference

**Core Value:** Ship a star-worthy, genuinely useful self-hostable AI-native helpdesk MLP whose AI experience (triage → cited RAG drafted replies → AIDA Insight) and one-command self-host are the wedge.

**Milestone:** v1 — Minimum Lovable Helpdesk
**Granularity:** coarse (7 phases)
**Model profile:** balanced (Opus plans, Sonnet executes)
**License:** Apache-2.0

## Current Position

Phase: 01 (foundation) — EXECUTING
Plan: 4 of 8
Status: Ready to execute
Last activity: 2026-06-29

Progress: [████░░░░░░] 38% (3/8 plans in phase 01)

## Accumulated Context

### Key Decisions

- AI-native open-source helpdesk, self-host, bring-your-own / local LLM (OpenAI/Anthropic/Ollama).
- Customer-support beachhead; generic multi-tenant core (also serves IT/ITSM).
- Apache-2.0 license.
- Single server: Next.js + Prisma + Postgres + pgvector + pg-boss + Caddy, one `docker compose up`.
- AI sequenced AFTER core helpdesk works; human-in-the-loop for customer-facing sends; citations required.
- Repo health (README/GIF/docs) is a milestone deliverable.
- Prisma 7: `url` must live in `prisma.config.ts` only (not in schema.prisma); `driverAdapters` is now stable — no previewFeatures needed.
- Better Auth `Organization` IS the workspace; all domain tables carry `organizationId`. `Setting` = org-scoped, `SystemSetting` = global.
- Generated client import path: `@/generated/prisma/client` (never `@prisma/client`). `prisma generate` must run in CI before build.
- `auth.ts` must always use bare `prisma` (never `scopedDb`) — BA models lack `organizationId`.
- `scopedDb(orgId)` via Prisma `$extends` with DOMAIN_MODELS=["Setting"] allowlist — injects organizationId into 9 operation hooks; Better Auth models never touched.
- Session property path: `session.session.activeOrganizationId` — outer `.session` is getSession return; inner `.session` is the DB record.
- Node 22 required for Testcontainers (undici@8 / testcontainers@12); use `volta run --node 22 pnpm test:integration`.
- `getScopedDb()` is the standard pattern for all protected Server Components: `const { db, orgId } = await getScopedDb();`.

### Open Todos

- `/gsd:plan-phase 1` to decompose Phase 1 (Foundation) into plans. CONTEXT.md is ready.

### Blockers

None.

## Session Continuity

**Last action:** Plan 01-03 executed — scopedDb(orgId) + AIDA-11 real-Postgres isolation test + session helpers complete; tsc clean; 2/2 integration tests green.

**Next action:** `/gsd:execute-phase 1` plan 04 — pg-boss worker + heartbeat job.

**Critical context for next session:**

- **Auth:** Better Auth (Prisma adapter + database sessions + organization plugin + admin plugin). Better Auth's `Organization` IS the workspace — no separate Workspace model. All domain tables carry `organizationId`.
- **Bootstrap:** Setup wizard (/setup, first-run, self-disables) + env-var escape hatch.
- **Docker:** Two services (app + worker) from one shared image. Caddy in Phase 1. `pgvector/pgvector:pg16`. Node 22 LTS, pnpm, Next.js standalone output.
- **Testing:** Vitest + Biome. Workspace isolation = real Postgres integration test (Testcontainers).
- **pgvector:** Extension only in Phase 1 — no vector columns. Embedding dimension deferred to Phase 5 (model-agnostic).
- **UI:** Full app shell + stub pages ("full shell, empty rooms"). No public register page.
- **AI:** Zero LLM code in Phase 1. Only `aiEnabled` toggle in workspace settings. `lib/llm/` is Phase 4.
- Single-server only; pg-boss (no Redis); pgvector in the same Postgres.

---
*Last updated: 2026-06-29 — Plan 01-03 complete: scopedDb + AIDA-11 Testcontainers integration test + session helpers.*
