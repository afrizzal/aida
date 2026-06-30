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

## UI / Design System (mandatory — read before any UI work)

**Every UI change in every phase MUST conform to `.planning/DESIGN-SYSTEM.md`.**

Key rules (full details in the file):
- **Token-only**: use CSS design tokens (`text-primary`, `bg-sidebar`, etc.) — never hardcode oklch/hex values in components.
- **Sidebar**: always `border-r border-sidebar-border bg-sidebar` + `sidebar-*` tokens. Brand icon: `Sparkles` in `bg-sidebar-primary` box.
- **Top bar**: always `sticky top-0 z-10 backdrop-blur-sm border-border/70`.
- **Empty state**: always use halo + icon box pattern (`bg-primary/10 border border-primary/15 rounded-xl`).
- **Auth pages**: never self-wrap; rely on `(auth)/layout.tsx` for the decorative background.
- **Typography**: use explicit sizes `text-[Npx]` not Tailwind named sizes (`text-lg`, `text-xl`).
- After any UI phase: run **design checklist** (§9 of DESIGN-SYSTEM.md) before marking phase complete.

## Loop Engineering (mandatory — read before any new phase)

**`.planning/LOOP-ENGINEERING.md` defines the loop architecture for this project.**

Key rules:
- `STATE.md` is the single source of truth across all sessions — never let it go stale.
- Every phase has a **hard stop condition** checkable by a command (`tsc --noEmit`, `pnpm test`, checklist) — "agent says it's done" is not a stop condition.
- Phase loop: `discuss → plan (Opus) → execute (Sonnet) → design-check → verify → human sign-off → update STATE.md`.
- Current autonomy level: **2** (draft + human applies). Do not self-upgrade.

## Context

Maintainer: Afrizzal. This OSS product also serves as portfolio evidence of governed/applied AI + service-desk engineering, but that is secondary to it being genuinely useful, safe, and star-worthy. See `docs/BRIEF.md` for positioning and `.planning/` for the plan.
