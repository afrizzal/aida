# Roadmap — Milestone v1: Minimum Lovable Helpdesk

**Granularity:** coarse (7 phases) · **Sequencing:** MVP-first — ship a usable helpdesk before the hard AI; introduce AI risk only after the core works; repo health last so the launch is polished.
**Coverage:** 23/23 MVP requirements mapped (AIDA-18 is backlog/stretch).

---

## Phases

- [ ] **Phase 1: Foundation** — App scaffold, data model, auth + workspace scoping, one-command self-host shell
- [ ] **Phase 2: Core Ticketing** — Shared inbox, ticket lifecycle, contacts, replies/notes, tags, SLA, web intake
- [ ] **Phase 3: Email Channel** — Inbound email → ticket threading + outbound SMTP replies
- [ ] **Phase 4: AI Foundation** — Model-agnostic LLM layer + auto-triage + audit log + untrusted-input safeguards
- [ ] **Phase 5: RAG & Drafted Replies** — Knowledge base + embeddings + citation-backed drafts behind a human-approval gate
- [ ] **Phase 6: AIDA Insight** — AI-driven analytics (recurring issues, KB gaps, volume drivers, SLA/CSAT)
- [ ] **Phase 7: Launch Readiness** — Demo data, docs site, star-ready README, backups, security pass, public launch

---

## Phase Details

### Phase 1: Foundation
**Timebox:** ~1–2 weeks · **Depends on:** nothing (greenfield) · **Requirements:** AIDA-10, AIDA-11, AIDA-21
**Goal:** A running, self-hostable Next.js + Prisma + Postgres(pgvector) + pg-boss app with auth, workspace-scoped data, and `docker compose up`.
**Success Criteria (what must be TRUE):**
1. `docker compose up` from a clean clone brings up the app, PostgreSQL with the pgvector extension, and a pg-boss worker; the app is reachable and a healthcheck passes.
2. A user can register/log in; roles `admin` and `agent` exist; an admin can invite/manage users; protected routes are enforced server-side.
3. Every domain table carries a `workspaceId`; a data-access helper scopes all queries to the active workspace (verified by a test seeding two workspaces).
4. Prisma schema + migrations are committed; `.env.example` documents required config; `LICENSE` (Apache-2.0) and a skeleton README are present.
**Plans:** 2/8 plans executed
- [x] 01-01-PLAN.md — Project scaffold, tooling, shadcn/ui design system + documented .env.example (Wave 1)
- [x] 01-02-PLAN.md — Database + auth backbone: Prisma 7, Better Auth (org + admin), schema, initial migration (Wave 2)
- [ ] 01-03-PLAN.md — Multi-tenant data access: scopedDb + AIDA-11 real-Postgres isolation test + session bridge (Wave 3)
- [ ] 01-04-PLAN.md — Background worker + heartbeat job + /api/health liveness (Wave 3)
- [ ] 01-05-PLAN.md — Auth flow: middleware guard, self-disabling setup wizard, login, env bootstrap (Wave 3)
- [ ] 01-06-PLAN.md — App shell + Tickets/KB stubs + tenant-scoped AI toggle ("full shell, empty rooms") (Wave 4)
- [ ] 01-07-PLAN.md — Self-host: multi-stage Dockerfile, docker-compose (db+app+worker+caddy), Caddyfile (Wave 5)
- [ ] 01-08-PLAN.md — Visual verification checkpoint: human walkthrough of the self-hosted experience (Wave 6)

### Phase 2: Core Ticketing
**Timebox:** ~2 weeks · **Depends on:** Phase 1 · **Requirements:** AIDA-01, AIDA-02, AIDA-03, AIDA-04, AIDA-05, AIDA-06, AIDA-07, AIDA-08, AIDA-12 (partial)
**Goal:** A genuinely usable helpdesk (no AI yet): create/work tickets through a shared inbox via the web.
**Success Criteria:**
1. An agent can create a ticket and move it `new→open→pending→resolved→closed`; changes persist and render in the thread.
2. The shared inbox lists tickets with views (Unassigned/Mine/by status), filter, and full-text search.
3. Tickets link to contact records showing per-contact history; agents can assign tickets and post public replies vs private notes (visually distinct).
4. Tags + basic custom fields work and are filterable; SLA first-response/resolution timers compute from priority and show at-risk/breached states.
5. A public web form creates a ticket and returns a status link; the conversation thread supports attachments.
**Plans:** TBD

### Phase 3: Email Channel
**Timebox:** ~1–1.5 weeks · **Depends on:** Phase 2 · **Requirements:** AIDA-09
**Goal:** Real email support — the default channel for a CS helpdesk.
**Success Criteria:**
1. An inbound email creates a ticket; a reply to an existing thread is attached to the correct ticket via message-id/headers (no duplicate tickets).
2. An agent's public reply is delivered by SMTP to the requester and recorded in the thread.
3. Email config (IMAP/inbound + SMTP) lives in settings; failures are surfaced, not silent.
**Plans:** TBD

### Phase 4: AI Foundation
**Timebox:** ~2 weeks · **Depends on:** Phase 2 (tickets exist) · **Requirements:** AIDA-13, AIDA-14, AIDA-19, AIDA-20
**Goal:** Pluggable AI + the first visible AI value (triage), governed and safe.
**Success Criteria:**
1. One LLM provider abstraction supports OpenAI, Anthropic, and Ollama (local), selectable in settings; keys are encrypted at rest; toggling AI off leaves the helpdesk fully functional.
2. New tickets are auto-triaged (category, priority, sentiment, language) with results attached and overrideable by an agent.
3. Every AI action is written to an append-only audit log (input ref, output, model).
4. Ticket text is handled as untrusted: a prompt-injection test case cannot make the AI take actions or reveal system context; obvious secrets are redacted before reaching the LLM/logs; no network egress occurs except to the configured LLM endpoint.
**Plans:** TBD

### Phase 5: RAG & Drafted Replies
**Timebox:** ~2–2.5 weeks · **Depends on:** Phase 4 (LLM layer) · **Requirements:** AIDA-15, AIDA-16
**Goal:** The agent copilot — cited, grounded drafts with a human gate.
**Success Criteria:**
1. Admins can author/import KB articles; content is chunked, embedded, and stored in pgvector; retrieval returns relevant chunks for a query.
2. For an open ticket, AIDA produces a drafted reply grounded in retrieved KB/past tickets with **inline citations** to sources.
3. The draft requires explicit agent approval/edit before sending; nothing is sent to a customer autonomously; the approval and final send are audited.
4. When retrieval finds nothing relevant, the draft says so rather than hallucinating a source.
**Plans:** TBD

### Phase 6: AIDA Insight
**Timebox:** ~2 weeks · **Depends on:** Phases 2 + 4 (ticket history + AI) · **Requirements:** AIDA-17
**Goal:** The headline differentiator — analysis, not just dashboards.
**Success Criteria:**
1. Insight clusters recurring issues across tickets and names each cluster with an example set.
2. It flags knowledge-base gaps (frequent question themes with no good KB article).
3. It surfaces top ticket-volume drivers over a period and an SLA/CSAT insight summary.
4. Outputs cite the underlying tickets/data and are reproducible (not free-floating prose); compute runs as a pg-boss job, not blocking the UI.
**Plans:** TBD

### Phase 7: Launch Readiness
**Timebox:** ~1.5 weeks · **Depends on:** Phases 1–6 · **Requirements:** AIDA-22, AIDA-23, AIDA-24
**Goal:** Make the public repo star-worthy and operable.
**Success Criteria:**
1. A seed/demo dataset + demo mode let a newcomer explore a populated helpdesk instantly; screenshots/GIF are captured from it.
2. README leads with a hero GIF, one-line pitch, quick-start (`docker compose up`), and a comparison table; a docs site covers install, config, and AI/BYO-LLM setup.
3. Backup/restore (pg_dump) and basic ops docs exist; a security pass confirms encrypted keys, enforced authz, and the AIDA-20 safeguards.
4. The repo is ready for a Phase-1 (first-100-stars) outreach launch.
**Plans:** TBD

---

## Requirement Coverage

| Requirement | Phase | | Requirement | Phase |
|---|---|---|---|---|
| AIDA-01 | 2 | | AIDA-13 | 4 |
| AIDA-02 | 2 | | AIDA-14 | 4 |
| AIDA-03 | 2 | | AIDA-15 | 5 |
| AIDA-04 | 2 | | AIDA-16 | 5 |
| AIDA-05 | 2 | | AIDA-17 | 6 |
| AIDA-06 | 2 | | AIDA-19 | 4 |
| AIDA-07 | 2 | | AIDA-20 | 4 |
| AIDA-08 | 2 | | AIDA-21 | 1 |
| AIDA-09 | 3 | | AIDA-22 | 7 |
| AIDA-10 | 1 | | AIDA-23 | 7 |
| AIDA-11 | 1 | | AIDA-24 | 7 |
| AIDA-12 | 2,4,7 | | AIDA-18 | backlog |

**Coverage: 23/23 MVP requirements mapped. No orphans.** (AIDA-18 deferred to backlog.)

---
*Last updated: 2026-06-29 — Phase 1 decomposed into 8 plans (6 waves) via /gsd:plan-phase.*
