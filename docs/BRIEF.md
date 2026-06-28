# AIDA — Project Brief (north star)

*Last updated: 2026-06-28*

## Positioning

> **AIDA — the open-source, AI-native helpdesk you can self-host. Bring your own LLM (OpenAI, Anthropic, or local Ollama). Your tickets never leave your server. AI triage, cited drafted replies, and AI-driven analytics built in — no per-resolution fees.**

A real open-source product, vendor-neutral, aiming for community traction (GitHub stars) and doubling as portfolio evidence. **Not tied to any single company.**

## The opportunity (from market research, 2024–2026)

The market splits two ways and both leave the same gap:
- **Commercial** helpdesks have AI but it's expensive and data-leaving: Intercom Fin bills **~$0.99/resolution** (and counts a "resolution" even when a customer just stops replying); Zendesk's AI agent is **~$1.50–$2.00/resolution + a $50/agent/mo add-on**.
- **Open-source** helpdesks are cheap and self-hostable but their AI is **absent or bolted-on**: Peppermint ships none; Zammad requires DIY Ollama wiring. Chatwoot leads OSS traction (~33.6k★ vs Zammad ~5.7k★).

**Gap → AIDA:** AI as the *core*, self-hostable, **bring-your-own / local LLM**, privacy-first, no usage fees. Even a commercial vendor (Jitbit) now ships BYO-LLM keys + a self-host AI stack — validating the demand; the open-source version of that is open.

*Verification note:* the above figures are 3-vote-verified research claims. Some popular stats (specific market sizes; "marketed 80% vs real 44%" AI resolution rates) were **refuted** in verification and are deliberately NOT used.

## Locked decisions

- **Name:** AIDA.
- **Segment beachhead:** customer-support (OSS alternative to Zendesk/Intercom). Ticketing core built generic/multi-tenant so internal IT/ITSM also works.
- **License:** Apache-2.0 (permissive + patent grant; maximizes adoption & stars).
- **Deployment:** single server, one `docker compose up`. Queue = pg-boss (no Redis). Vector = pgvector. Proxy = Caddy.
- **Stack:** Next.js 16 + TypeScript + Prisma + PostgreSQL 16 + pgvector + pg-boss + model-agnostic LLM layer + Tailwind/shadcn.

## Wedge features (the differentiation)

1. **Bring-your-own / local LLM** (OpenAI · Anthropic · Ollama) — privacy-first, no per-resolution fees, AI fully toggleable.
2. **AI auto-triage** — category, priority, sentiment, language → routing. Small/local models suffice.
3. **RAG drafted replies** — grounded in KB + past tickets, **with citations + human approval** (no silent AI sends).
4. **AIDA Insight** — AI-driven analytics (recurring-issue clustering, KB-gap detection, volume drivers, SLA/CSAT insight). *The headline differentiator vs plain dashboards.*
5. *(stretch)* **KB autogen** from resolved tickets.

## Minimum lovable v1

Core ticketing (shared inbox · tickets/status/assignment/tags · contacts · basic SLA · web + email intake) · one-command self-host · AI (triage + RAG drafted replies + Insight) · BYO-LLM config · star-ready README + hero GIF + docs site.

## Star strategy (research-backed)

- **Repo health first:** aesthetic README with hero screenshot/GIF + a docs site are prerequisites before any growth tactic converts.
- **AI-native positioning vs a crowded category** drives stars (precedent: ToolJet, and OSS-AI breakouts like OpenHands ~64k★/18mo, Ollama 136k★).
- **Two-phase launch:** first ~100 stars via direct outreach, then organic (HN / Reddit / ProductHunt / content), each launch a fresh wave.

## Honesty guardrails

Relative metrics only; no fabricated resolution-rate claims. LLM consumed/orchestrated via API (incl. local), not "trained/fine-tuned." Permissive about cloud — runs anywhere with Docker. This is a genuine product first; portfolio value follows from it being real, useful, and adopted.

## Portfolio link

Backs Afrizzal's active applications R10 (IT AI Automation Manager) + R11 (IT Service Desk) and his AI/governance/ITSM narrative. Career workspace: `D:\Aff\proj\career`.
