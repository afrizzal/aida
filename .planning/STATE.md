---
gsd_state_version: 1.0
milestone: v1
milestone_name: Minimum Lovable Helpdesk
status: planning
stopped_at: Project initialized (vendor-neutral OSS). Planning docs authored. Ready to plan Phase 1.
last_updated: "2026-06-28T00:00:00.000Z"
last_activity: 2026-06-28
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

Phase: 1 (not started)
Status: Ready to plan
Last activity: 2026-06-28 — project re-scoped as a vendor-neutral open-source product (decoupled from any company); PROJECT.md, REQUIREMENTS.md (AIDA-01..24), ROADMAP.md (7 phases) authored.

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
- `/gsd:plan-phase 1` to decompose Phase 1 (Foundation) into plans.

### Blockers
None.

## Session Continuity

**Last action:** Authored planning trio (PROJECT/REQUIREMENTS/ROADMAP) + STATE; rewrote repo scaffold to vendor-neutral OSS; added ARCHITECTURE/SECURITY reference docs + LICENSE.

**Next action:** `/gsd:plan-phase 1` (Foundation: scaffold + auth + workspace scoping + one-command self-host).

**Critical context for next session:**
- Market research summary lives in the conversation that created this project; positioning + wedge features captured in `docs/BRIEF.md`.
- Single-server only; pg-boss (no Redis); pgvector in the same Postgres.
- AI must be model-agnostic and toggleable; ticket text is untrusted input.

---
*Last updated: 2026-06-28 — project initialized; ready to plan Phase 1.*
