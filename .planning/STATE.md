---
gsd_state_version: 1.0
milestone: v1
milestone_name: Minimum Lovable Helpdesk
status: planning
stopped_at: Phase 1 context gathered. Ready to plan Phase 1.
last_updated: "2026-06-29T00:00:00.000Z"
last_activity: 2026-06-29
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# STATE — AIDA v1: Minimum Lovable Helpdesk

## Project Reference

**Core Value:** Ship a star-worthy, genuinely useful self-hostable AI-native helpdesk MLP whose AI experience (triage → cited RAG drafted replies → AIDA Insight) and one-command self-host are the wedge.

**Milestone:** v1 — Minimum Lovable Helpdesk
**Granularity:** coarse (7 phases)
**Model profile:** balanced (Opus plans, Sonnet executes)
**License:** Apache-2.0

## Current Position

Phase: 1 (context ready, not yet planned)
Status: Ready to plan
Last activity: 2026-06-29 — Phase 1 discuss-phase complete; CONTEXT.md authored with all implementation decisions locked (auth, tenancy, bootstrap, Caddy, worker, testing, pgvector, UI scaffolding).

Progress: ░░░░░░░░░░ 0% (0/7 phases)

## Accumulated Context

### Key Decisions
- AI-native open-source helpdesk, self-host, bring-your-own / local LLM (OpenAI/Anthropic/Ollama).
- Customer-support beachhead; generic multi-tenant core (also serves IT/ITSM).
- Apache-2.0 license.
- Single server: Next.js + Prisma + Postgres + pgvector + pg-boss + Caddy, one `docker compose up`.
- AI sequenced AFTER core helpdesk works; human-in-the-loop for customer-facing sends; citations required.
- Repo health (README/GIF/docs) is a milestone deliverable.

### Open Todos
- `/gsd:plan-phase 1` to decompose Phase 1 (Foundation) into plans. CONTEXT.md is ready.

### Blockers
None.

## Session Continuity

**Last action:** Phase 1 discuss-phase — 25 implementation decisions locked in `.planning/phases/01-foundation/01-CONTEXT.md`.

**Next action:** `/gsd:plan-phase 1` — CONTEXT.md is ready, proceed directly to planning.

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
*Last updated: 2026-06-29 — Phase 1 context gathered; 25 implementation decisions locked.*
