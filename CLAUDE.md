# CLAUDE.md — AIDA

Instructions for Claude Code working in this repository.

## What this is

AIDA is an **open-source, AI-native, self-hostable helpdesk** (Apache-2.0). The launch beachhead is **customer-support** (an open-source alternative to Zendesk/Intercom/Chatwoot), but the ticketing core is built **generic/multi-tenant** so internal IT/ITSM works too. It is a real product aiming for community traction (GitHub stars) — not a demo, and **not tied to any single company**. Planning is managed with the GSD system under `.planning/`.

Differentiator: **AI is the core, not a paid add-on.** Self-host on one server, bring your own LLM (OpenAI / Anthropic / local Ollama), keep all ticket data on your own infrastructure, no per-resolution fees.

## Stack & deployment (do not drift)

- **Single server.** Everything runs via one `docker compose` on one host. Minimize moving parts. Queue = **pg-boss** (Postgres-backed — do NOT add Redis). Vector store = **pgvector** in the same Postgres. Reverse proxy = Caddy.
- Next.js 16 (App Router) + TypeScript + Prisma + **PostgreSQL 16 + pgvector** + **pg-boss** + a model-agnostic LLM layer + Tailwind + shadcn/ui.
- **One-command self-host is a first-class feature.** `docker compose up` must bring the whole thing up; keep setup friction near zero (this is a star-driver).

## Non-negotiable rules

- **AI is model-agnostic / bring-your-own.** All LLM calls go through one provider abstraction (`lib/llm/`) with adapters for OpenAI, Anthropic, and Ollama (local). Never hardcode a single vendor. AI must be fully toggleable off.
- **Privacy-first.** Ticket data and BYO API keys stay on the user's server. Encrypt provider keys at rest. Never send data to any third party other than the user-configured LLM. Default to "no training on your data."
- **Human-in-the-loop for AI sends.** AI may *draft* and *suggest*; a human approves before anything goes to a customer. Drafted replies must carry citations to their KB/source. Treat ticket text as **untrusted input** — guard against prompt-injection that tries to trigger actions or exfiltrate data.
- **Honest claims.** Self-hosted/local LLM = "consumed via API / orchestrated", never "trained/fine-tuned" (unless we genuinely ship a fine-tune). Relative metrics in any marketing, no fabricated resolution-rate stats.

## Workflow

- Use GSD: `/gsd:plan-phase N` → `/gsd:execute-phase N`. Atomic commits per plan. Keep `.planning/STATE.md` current.
- **Model profile: `balanced` (token-saving, required).** Planning/thinking agents (`/gsd:plan-phase`, discuss, review) run on **Opus**; execution/implementation agents (`/gsd:execute-phase`) run on **Sonnet**. Set in `.planning/config.json` (`model_profile: "balanced"`); change only via `/gsd:set-profile`.
- Quality gates: typecheck clean (`tsc --noEmit`), tests for logic, dogfood through the real UI (no hardcoded shortcuts).
- **Repo health is a feature.** README with a hero GIF, clean docs, and a frictionless quick-start are deliverables, not afterthoughts — they convert visitors into stars.

## Context

Maintainer: Afrizzal. This OSS product also serves as portfolio evidence of governed/applied AI + service-desk engineering, but that is secondary to it being genuinely useful, safe, and star-worthy. See `docs/BRIEF.md` for positioning and `.planning/` for the plan.
