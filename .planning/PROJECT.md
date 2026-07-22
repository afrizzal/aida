# AIDA — Open-Source AI-Native Helpdesk

## What This Is

AIDA is an **open-source, self-hostable, AI-native helpdesk** (Apache-2.0). It positions as an open-source alternative to Zendesk/Intercom where **AI is a core feature, not a paywalled add-on** — auto-triage, citation-backed drafted replies, and AI-driven analytics — all running on a **single server** with a **bring-your-own / local LLM** (OpenAI, Anthropic, or Ollama). Tickets never leave the operator's infrastructure; there are no per-resolution fees.

Launch beachhead is **customer support**, but the ticketing core is built generic/multi-tenant so internal IT/ITSM works on the same foundation. The project is built in the open to earn community traction (GitHub stars) and also serves as portfolio evidence of applied/governed AI and service-desk engineering. **It is not tied to any company.**

## Core Value

**Ship a star-worthy, genuinely useful self-hostable AI helpdesk MLP whose AI experience (triage → cited RAG drafted replies → AIDA Insight) and one-command self-host (`docker compose up`) are the wedge.** Everything else exists to make that experience real, trustworthy (human-in-the-loop, privacy-first), and easy to run.

## Current Milestone: v1 — Minimum Lovable Helpdesk

**Goal:** A self-hostable helpdesk an SMB support team would actually adopt — core ticketing + email/web intake + the three AI wedges (triage, RAG drafted replies, Insight) + BYO-LLM — packaged so a stranger can `docker compose up` and be impressed, and so the public repo is star-ready.

**Target capabilities:** core ticketing & shared inbox; web + email intake; model-agnostic AI triage; RAG knowledge base with cited drafted replies behind a human-approval gate; AIDA Insight analytics; one-command self-host; star-ready README + docs.

**Key context:** crowded category — differentiation is *AI-native + self-host + BYO/local LLM + privacy + no usage fees*. Riskiest/most-impressive AI is introduced only after the core helpdesk works. Repo health (README/GIF/docs) is a milestone deliverable, not an afterthought.

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

### Active

<!-- v1 MLP. Full statements in REQUIREMENTS.md. -->

**Auth & multi-tenant**
- [ ] **AIDA-12** Settings (branding, SLA policies, channels, AI config) — SLA policies/tags/custom-fields shipped in Phase 2; branding/channels/AI config land in Phases 4/7

**AI**
- [ ] **AIDA-17** AIDA Insight: recurring-issue clustering, KB-gap detection, volume drivers, SLA/CSAT insight

**Self-host & DX**
- [ ] **AIDA-22** Seed/demo data + demo mode for the README
- [ ] **AIDA-23** Docs site + star-ready README with hero GIF
- [ ] **AIDA-24** Backups + basic ops docs (single-server pg_dump)

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

## Context

**"Organization":** an open-source project / community, not a company. Target users = SMB and indie support teams (and self-host-minded IT teams) who want AI without Zendesk/Intercom pricing or data leaving their servers.

**Maintainer:** Afrizzal (solo, evenings/weekends), building in the open. Also portfolio evidence for IT-AI-automation & service-desk roles — secondary to the product being real and adopted.

**Why now:** commercial AI helpdesks lock AI behind per-resolution pricing and host your data; open-source helpdesks have weak/absent AI. Local/BYO LLMs are now good enough for triage and viable for RAG, so an AI-native, privacy-first, self-hostable helpdesk is buildable and differentiated.

**Technical environment:** Next.js 16 (App Router) + TypeScript + Prisma + PostgreSQL 16 + pgvector + pg-boss + a model-agnostic LLM layer + Tailwind/shadcn, all in one `docker compose` on a single host.

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
| AI-native open-source helpdesk, self-host, BYO/local LLM | The unfilled market gap between expensive commercial AI and AI-less OSS | — Active |
| Customer-support beachhead, generic core | Largest self-hoster/star audience + sharp incumbent contrast; core still serves IT/ITSM | — Active |
| Apache-2.0 license | Permissive + patent grant → maximizes adoption & stars | — Active |
| Single server (Next.js monolith + pg-boss + pgvector) | Easiest self-host (`docker compose up`); fewest moving parts | — Active |
| AI after core helpdesk works (phase ordering) | De-risk; ship a usable product before the hardest part | — Active |
| Human-in-the-loop for AI sends; citations required | Trust + anti-hallucination; the thing that separates "leads AI" from "uses ChatGPT" | — Active |
| Repo health (README/GIF/docs) as a milestone deliverable | Verified top star-driver | — Active |

## Evolution

This document evolves at phase/milestone transitions (validated → move requirements; new ones → Active; decisions → table). v1 = Minimum Lovable Helpdesk; post-v1 candidates: KB autogen (AIDA-18), live chat, more channels, hosted offering.

---
*Last updated: 2026-07-18 — Phase 4 (ai-foundation) fully closed out (7/7 plans, 6/6 waves): 04-07 gap closure fixed the sole UAT gap (test 2, provider-switch model reset) — 04-UAT.md is now 10/10 pass, AIDA-13/AIDA-14/AIDA-19/AIDA-20 all validated end-to-end. Non-blocking human verification items (dark-mode visual pass, live-provider smoke test, network-egress capture) remain open per 04-VERIFICATION.md.*
