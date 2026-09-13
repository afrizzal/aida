# AIDA — Open-Source AI-Native Helpdesk

## What This Is

AIDA is an **open-source, self-hostable, AI-native helpdesk** (Apache-2.0). It positions as an open-source alternative to Zendesk/Intercom where **AI is a core feature, not a paywalled add-on** — auto-triage, citation-backed drafted replies, and AI-driven analytics — all running on a **single server** with a **bring-your-own / local LLM** (OpenAI, Anthropic, or Ollama). Tickets never leave the operator's infrastructure; there are no per-resolution fees.

Launch beachhead is **customer support**, but the ticketing core is built generic/multi-tenant so internal IT/ITSM works on the same foundation. The project is built in the open to earn community traction (GitHub stars) and also serves as portfolio evidence of applied/governed AI and service-desk engineering. **It is not tied to any company.**

## Core Value

**Ship a star-worthy, genuinely useful self-hostable AI helpdesk MLP whose AI experience (triage → cited RAG drafted replies → AIDA Insight) and one-command self-host (`docker compose up`) are the wedge.** Everything else exists to make that experience real, trustworthy (human-in-the-loop, privacy-first), and easy to run.

## Current State

**Shipped: v1.0.0 "Minimum Lovable Helpdesk" — 2026-09-13** (code-complete, verified, archived via `/gsd-complete-milestone`; 7 phases, 60 plans, 154 tasks, 401 commits over 78 days). The public release itself — placeholder security contact, repository settings, `git tag v1.0.0`, GitHub release, Pages — is still the maintainer's `LAUNCH.md` checklist.

What exists today: multi-tenant ticketing core (shared inbox + FTS, contacts, tags/custom fields, SLA timers, attachments, public intake + tokenized status page, CSAT), email channel (IMAP ingest, SMTP replies, encrypted settings), model-agnostic LLM port (OpenAI/Anthropic/Ollama) with advisory triage and a DB-enforced append-only audit log, RAG knowledge base with cited drafts behind a human gate, AIDA Insight analytics, one-command self-host with `DEMO_MODE`, backup/restore, CI, docs site, star-ready README, and a written security pass with a runtime egress proof.

Known gaps accepted for v1: no team invite flow (admin/agent are created via setup/bootstrap only), fixed `TicketStatus` enum, no public API/webhooks, no notifications/mentions, no logo upload, no backup scheduler, `POSTGRES_PASSWORD` not URL-encoded in `DATABASE_URL`. Two human checks remain open (Phase 5 aesthetic visual pass, Phase 6 real-LLM Insight quality). Full lists: `STATE.md` → Deferred Items, `milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md`, `07-SECURITY-PASS.md`.

<details>
<summary>v1 milestone goal as originally planned</summary>

**Goal:** A self-hostable helpdesk an SMB support team would actually adopt — core ticketing + email/web intake + the three AI wedges (triage, RAG drafted replies, Insight) + BYO-LLM — packaged so a stranger can `docker compose up` and be impressed, and so the public repo is star-ready.

**Target capabilities:** core ticketing & shared inbox; web + email intake; model-agnostic AI triage; RAG knowledge base with cited drafted replies behind a human-approval gate; AIDA Insight analytics; one-command self-host; star-ready README + docs.

**Key context:** crowded category — differentiation is *AI-native + self-host + BYO/local LLM + privacy + no usage fees*. Riskiest/most-impressive AI is introduced only after the core helpdesk works. Repo health (README/GIF/docs) is a milestone deliverable, not an afterthought.

</details>

## Next Milestone Goals

Not yet defined — `/gsd-new-milestone` decides scope and requirements. Candidates on the table as of 2026-09-13 (each a dormant seed in `.planning/seeds/`, researched in `research/plane-inspiration.md`):

1. **Team & inbox ergonomics** — invite flow + roles (SEED-007, closes the loudest v1 gap), saved views + bulk actions (SEED-005), command palette / keyboard inbox (SEED-006), auto-close automation (SEED-009)
2. **Ticket lifecycle** — relations / merge / snooze (SEED-003), custom workflow states with SLA pause (SEED-004), notifications + @mentions (SEED-008), plus AIDA-18 KB auto-generation from resolved tickets
3. **Integrations** — public API + tokens + signed webhooks (SEED-002), then an issue-tracker bridge to Plane / GitHub Issues (SEED-001)
4. **Repo health** — one-liner installer, version-bump CI gate, social-proof widgets (SEED-010)

Guardrail carried forward: AIDA does **not** become a project-management tool; it bridges to one (see Out of Scope).

## Requirements

### Validated

<!-- Filled in as phases complete. -->

- **AIDA-01** Ticket lifecycle (states, priority, subject/body) — Validated in Phase 2: core-ticketing
- **AIDA-02** Shared inbox with views/filter/search — Validated in Phase 2: core-ticketing
- **AIDA-03** Contacts/requesters linked to tickets with history — Validated in Phase 2: core-ticketing
- **AIDA-04** Assignment + public replies vs private internal notes — Validated in Phase 2: core-ticketing
- **AIDA-05** Tags/labels (+ basic custom fields) — Validated in Phase 2: core-ticketing
- **AIDA-06** SLA first-response & resolution timers with breach indicators — Validated in Phase 2: core-ticketing
- **AIDA-07** Conversation thread with attachments — Validated in Phase 2: core-ticketing
- **AIDA-08** Web form / portal intake → ticket — Validated in Phase 2: core-ticketing
- **AIDA-10** Auth + roles (admin, agent) + user management — Validated in Phase 1: foundation
- **AIDA-11** Workspace/organization scoping (multi-tenant-ready) — Validated in Phase 1: foundation
- **AIDA-21** One-command self-host (`docker compose up`) — Validated in Phase 1: foundation
- **AIDA-09** Email intake (inbound parse/threading) + outbound SMTP replies — Validated in Phase 3: email-channel
- **AIDA-14** Auto-triage: category, priority, sentiment, language, routing — Validated in Phase 4: ai-foundation
- **AIDA-19** Append-only audit log of AI actions (triage/draft/send) — Validated in Phase 4: ai-foundation
- **AIDA-13** Model-agnostic LLM layer (OpenAI/Anthropic/Ollama), AI toggle, encrypted keys — Validated in Phase 4: ai-foundation
- **AIDA-20** Untrusted-input & PII safeguards (prompt-injection defense, secret redaction, no egress beyond configured LLM) — Validated in Phase 4: ai-foundation
- **AIDA-16** RAG drafted reply with citations behind a human-approval gate — Validated in Phase 5: rag-drafted-replies (05-04 retrieval/grounded-draft engine + 05-07 draft card/citations/Insert-then-Send gate/DRAFT_APPROVED audit)
- **AIDA-15** Knowledge base: author/import + chunk + embed (pgvector) — Validated in Phase 5: rag-drafted-replies (05-01 schema + 05-02 embedding port + 05-03 chunker/write-path/embed job + 05-05 embedding provider settings + 05-06 KB authoring UI)
- **AIDA-17** AIDA Insight: recurring-issue clustering, KB-gap detection, volume drivers, SLA/CSAT insight — Validated in Phase 6: aida-insight (06-01 schema/types + 06-02 clustering math + 06-03 SQL aggregates + 06-04 KB-gap KNN/prompts + 06-05 CSAT capture + 06-06 insight-run orchestrator/pg-boss job + 06-07 /insights UI: period tabs, guarded generate button, 4 design-system cards, sidebar nav)
- **AIDA-12** Settings (branding, SLA policies, channels, AI config) — SLA policies/tags/custom-fields shipped in Phase 2, channels (AIDA-09) in Phase 3, AI config (AIDA-13) in Phase 4; the branding remainder (workspace display name, applied to sidebar/public pages/email from-name) shipped in Phase 7: launch-readiness (07-03), closing the requirement
- **AIDA-22** Seed/demo data + demo mode for the README — Validated in Phase 7: launch-readiness (07-02 dataset + 07-07 `DEMO_MODE` boot flag)
- **AIDA-23** Docs site + star-ready README with hero GIF — Validated in Phase 7: launch-readiness (07-05/07-06 CI + docs-site infra, 07-08 visual assets, 07-10 README rewrite, 07-11 docs-site content)
- **AIDA-24** Backups + basic ops docs (single-server pg_dump) — Validated in Phase 7: launch-readiness (07-04 backup/restore scripts + docs/OPERATIONS.md, 07-09 security pass)

### Active

<!-- v1 MLP. Full statements in REQUIREMENTS.md. -->

None — all 23 v1 MVP requirements shipped in v1.0.0 (see Validated). The next milestone's requirements are
written by `/gsd-new-milestone`; candidates are listed under Next Milestone Goals. AIDA-18 (KB auto-generation,
Stretch) is the one carried-over requirement statement — still backlog, never scheduled.

### Out of Scope

<!-- v1 discipline. -->

- **AIDA-18** KB auto-generation from resolved tickets — stretch, post-v1
- Live chat widget / real-time messaging — later (start with form + email)
- Additional channels (WhatsApp, social, voice) — later; pluggable channel interface only
- Multi-language UI / i18n beyond AI language detection — later
- Billing / SaaS / hosted multi-customer offering — not in v1 (Apache-2.0 keeps the door open)
- Fine-tuning / training models — AIDA orchestrates LLMs via API/local, it does not train them
- Mobile apps — responsive web only
- SSO/SAML, advanced RBAC beyond admin/agent — later
- A built-in project-management module (Plane/Linear-style cycles, modules, gantt, pages) — never; a helpdesk with half a PM tool loses to both. Bridge tickets to the team's tracker instead (SEED-001; `research/plane-inspiration.md`, 2026-09-13)
- Reusing AGPL-licensed code (e.g. makeplane/plane) — incompatible with Apache-2.0; patterns may be re-implemented clean-room, code never copied

## Context

**"Organization":** an open-source project / community, not a company. Target users = SMB and indie support teams (and self-host-minded IT teams) who want AI without Zendesk/Intercom pricing or data leaving their servers.

**Maintainer:** Afrizzal (solo, evenings/weekends), building in the open. Also portfolio evidence for IT-AI-automation & service-desk roles — secondary to the product being real and adopted.

**Why now:** commercial AI helpdesks lock AI behind per-resolution pricing and host your data; open-source helpdesks have weak/absent AI. Local/BYO LLMs are now good enough for triage and viable for RAG, so an AI-native, privacy-first, self-hostable helpdesk is buildable and differentiated.

**Technical environment:** Next.js 16 (App Router) + TypeScript + Prisma + PostgreSQL 16 + pgvector + pg-boss + a model-agnostic LLM layer + Tailwind/shadcn, all in one `docker compose` on a single host.

**State after v1.0.0 (2026-09-13):** ~17.4k LOC TypeScript in `src/` (excluding the generated Prisma client) + ~6.2k LOC tests (unit 90, integration 30 on Testcontainers, e2e suites per phase + a11y + honesty invariants); 30 Prisma models/enums; 16 app routes; `website/` docs site as a separate pnpm project. Not yet publicly launched, so no user feedback themes yet. Technical debt and accepted gaps are tracked in `STATE.md` → Deferred Items and `milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md`.

**Architecture principles:**
- Single server, minimal moving parts (pg-boss not Redis; pgvector in the same Postgres).
- Model-agnostic AI via one provider abstraction; AI always toggleable off.
- Privacy-first: data + keys stay on the operator's server; no egress beyond the configured LLM.
- Human-in-the-loop for anything customer-facing; ticket text is untrusted input.
- Multi-tenant-ready scoping from day one (workspace/org), even if v1 ships single-workspace.
- One-command self-host and repo health are product features.

## Constraints

- **Solo developer**, part-time. Scope ruthlessly; each phase must ship something usable.
- **Single server** deployment target; no managed-cloud dependency required.
- **GSD model profile = balanced** (Opus plans, Sonnet executes) to save tokens.
- **License Apache-2.0**; keep dependencies license-compatible.
- AI must degrade gracefully when no LLM is configured (helpdesk still works without AI).

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| AI-native open-source helpdesk, self-host, BYO/local LLM | The unfilled market gap between expensive commercial AI and AI-less OSS | ✓ Good — v1.0.0 shipped on it; market validation pending public launch |
| Customer-support beachhead, generic core | Largest self-hoster/star audience + sharp incumbent contrast; core still serves IT/ITSM | ✓ Good — core stayed generic (org-scoped, no support-only assumptions) |
| Apache-2.0 license | Permissive + patent grant → maximizes adoption & stars | ✓ Good — also the reason Plane (AGPL) code can only inspire, never be copied |
| Single server (Next.js monolith + pg-boss + pgvector) | Easiest self-host (`docker compose up`); fewest moving parts | ✓ Good — 4 containers vs. e.g. Plane's 13; no Redis ever needed |
| AI after core helpdesk works (phase ordering) | De-risk; ship a usable product before the hardest part | ✓ Good — AI phases were thin wiring over Phase 1–3 entrypoints |
| Human-in-the-loop for AI sends; citations required | Trust + anti-hallucination; the thing that separates "leads AI" from "uses ChatGPT" | ✓ Good — Insert-then-Send gate + `DRAFT_APPROVED` audit; groundedness gate in code |
| Repo health (README/GIF/docs) as a milestone deliverable | Verified top star-driver | ✓ Good — but it cost a full 13-plan phase; budget it explicitly next time |
| Better Auth (org + admin plugins) + `scopedDb` allowlist for tenancy (01-02/01-03) | One auth library covering sessions, orgs and roles; tenant scoping enforced in the data layer, not per query | ✓ Good — isolation proven by never-mocked Testcontainers tests; invite flow still unbuilt (⚠️ SEED-007) |
| Append-only `AuditEvent` enforced by a DB trigger (04-01) | Audit integrity cannot depend on app code | ✓ Good — side effect: no destructive reset exists, so seed/demo paths guard on `ticket.count()` |
| One LLM port `complete<T>()` with structured outputs and zero tool surface (04-02) | Prompt-injection can only produce data, never actions | ✓ Good — injection tests hold across triage, drafts and Insight |
| Fixed `TicketStatus` enum for v1 | Simplicity; SLA/filters/Insight SQL reason about it directly | ⚠️ Revisit — teams will want custom states + SLA pause (SEED-004) |
| Runtime egress test on a deny-all Docker network instead of a static sweep (07-09.1) | A runtime claim needs a runtime proof | ✓ Good — found the Prisma CLI checkpoint leak a static sweep had deprioritized |
| Two-tier brand color (`--primary` bg / `--primary-emphasis` text) (07-09.1 follow-up) | Same hue cannot pass WCAG AA as both background and text | ✓ Good — a11y contrast suite 8/8; screenshots re-captured once |
| Honest demo stamping (`provider: "demo"`) + strict `DEMO_MODE === "true"` (07-02/07-07) | Stored demo AI output must never look like a live model call | ✓ Good — README/docs make the stored-vs-live distinction explicit |
| GSD balanced profile (Opus plans, Sonnet executes) | Token cost without a quality hit | ✓ Good — 60 plans, no recorded quality complaint |
| Milestone closed as override_closeout, no tag (2026-09-13) | Remaining items are human-only (visual/LLM-quality passes, LAUNCH.md); tagging before the placeholder contact is replaced would ship a wrong contact | — Pending: LAUNCH.md steps, then tag v1.0.0 |

## Evolution

This document evolves at phase/milestone transitions (validated → move requirements; new ones → Active; decisions → table). v1.0.0 = Minimum Lovable Helpdesk (shipped 2026-09-13). Post-v1 candidates are the ten seeds + AIDA-18 listed under Next Milestone Goals; longer-horizon ideas (live chat, more channels, hosted offering) stay in Out of Scope until a milestone pulls them in.

---
*Last updated: 2026-07-18 — Phase 4 (ai-foundation) fully closed out (7/7 plans, 6/6 waves): 04-07 gap closure fixed the sole UAT gap (test 2, provider-switch model reset) — 04-UAT.md is now 10/10 pass, AIDA-13/AIDA-14/AIDA-19/AIDA-20 all validated end-to-end. Non-blocking human verification items (dark-mode visual pass, live-provider smoke test, network-egress capture) remain open per 04-VERIFICATION.md.*
*Last updated: 2026-07-22 — Phase 5 (rag-drafted-replies) execution complete (7/7 plans, 3/3 waves): KbArticle/KbChunk/vector(768) schema, embedding port, chunker + write path + embed worker job, retrieval + grounded-draft engine, Settings embedding-provider config, KB authoring UI, and the ticket-page draft card + human-approval send gate. AIDA-15 and AIDA-16 both validated end-to-end (05-VERIFICATION.md: 4/4 ROADMAP success criteria confirmed at the source level, including a full data-flow trace of the human-approval gate and an executable-test-backed groundedness gate). Non-blocking human verification items (live browser walkthrough, live embedding Test Connection, DESIGN-SYSTEM §9 visual pass) remain open per 05-HUMAN-UAT.md.*
*Last updated: 2026-07-25 — Phase 6 (aida-insight) fully closed out (7/7 plans, 4/4 waves): InsightRun/TicketEmbedding/CsatResponse schema, deterministic leader-clustering + redact-then-embed excerpts, SQL volume-driver/SLA/CSAT aggregates, KB-gap KNN + schema-forced cluster-label/narrative prompts, public CSAT capture, the insight-run pg-boss orchestrator, and the /insights UI (period tabs, guarded generate button, 4 design-system cards, sidebar nav). AIDA-17 validated end-to-end — 06-VERIFICATION.md: 4/4 ROADMAP success criteria confirmed against a live Testcontainers-backed integration run (reproducibility, AI-off degradation, redaction proof). Combined-suite verification (tsc clean, 81/81 unit, 26/26 integration, production build) and phase-goal check both passed. Non-blocking human verification items (insights page visual pass, CSAT click-through, real-LLM output quality) remain open per 06-HUMAN-UAT.md.*
*Last updated: 2026-09-03 — Phase 7 (launch-readiness) fully closed out (13/13 plans, 6/6 waves): demo dataset + `DEMO_MODE` (AIDA-22), the Branding settings tab closing the AIDA-12 remainder, backup/restore scripts + ops runbook + a written security pass (AIDA-24), the star-ready README + Starlight docs site (AIDA-23), CI/community files, and the 07-12 launch close-out (8-gate run, `CHANGELOG.md`, `LAUNCH.md`, planning-records reconciliation). **All 23 v1 MVP requirements are now Validated; AIDA-18 remains Out of Scope/backlog.** AIDA-12/22/23/24 moved from Active to Validated above; AIDA-13/AIDA-20 were already Validated (Phase 4) and needed no change. v1 — Minimum Lovable Helpdesk — is code-complete; the only remaining steps are the human-only items in `LAUNCH.md` (repo settings, tag, release, outreach).*
*Last updated: 2026-09-04 — Phase 7 verification PASSED (07-VERIFICATION.md: 23/23 must-haves; the three behaviour invariants — demo-boot idempotency, seed refuse-guard, backup/restore round trip — were executed for real against a live docker compose stack by the orchestrator and embedded as evidence). Code review 07-REVIEW.md: 0 critical, 3 warning, 2 info (advisory, non-blocking). Maintainer sign-off on 07-12 received 2026-09-04. Phase 7 marked complete via phase.complete; v1 milestone is code-complete pending the maintainer's own LAUNCH.md steps. Post-v1 follow-ups logged in STATE.md Open Todos (`@anthropic-ai/sdk` 0.110→0.123 bump; persisted regression tests for the three invariants).*
*Last updated: 2026-09-13 after v1.0.0 milestone — closed via `/gsd-complete-milestone` (override closeout: 23 acknowledged items, no git tag — `LAUNCH.md` owns tag/release). "Current Milestone" section replaced by Current State + Next Milestone Goals; Key Decisions table given outcomes and extended with the v1 architecture decisions; Out of Scope gained the "no PM module / no AGPL code" guardrails from the Plane research (`research/plane-inspiration.md`, SEED-001…010). Archives: `milestones/v1.0.0-{ROADMAP,REQUIREMENTS,STATE}.md`, `milestones/v1.0.0-phases/`.*
