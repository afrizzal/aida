# Changelog

All notable changes to AIDA are documented in this file, starting at v1.0.0. Earlier
development history (seven build phases, from foundation through launch readiness) lives in
[`.planning/`](.planning/) — see [`.planning/ROADMAP.md`](.planning/ROADMAP.md) for the full
phase-by-phase build log.

## v1.0.0 — 2026-09-03

The first tagged release: a self-hostable, AI-native helpdesk with core ticketing, email/web
intake, model-agnostic AI (auto-triage, cited RAG drafted replies, AIDA Insight analytics), and
a one-command self-host.

### Added

**Core ticketing**
- Ticket lifecycle (NEW → OPEN → PENDING → RESOLVED → CLOSED) with priority, tags, and a small
  set of admin-defined custom fields.
- Shared inbox with saved views, filters, and full-text search across tickets and messages.
- Contacts linked to every ticket, with full per-contact ticket history.
- Assignment, public replies vs. private internal notes (visually distinct), and a chronological
  conversation thread with file attachments.
- SLA first-response and resolution timers derived from priority, with visible at-risk/breached
  indicators.

**Intake channels**
- Public web intake form plus a tokenised, no-login ticket-status page with follow-up replies
  and auto-reopen.
- Inbound email parsed into tickets (Message-ID/References threading), agent replies delivered
  outbound via SMTP.

**AI (model-agnostic, bring-your-own)**
- One LLM provider abstraction supporting OpenAI, Anthropic, and a local model via Ollama —
  selectable per workspace, provider keys encrypted at rest, AI fully toggleable off with the
  helpdesk still working.
- Auto-triage on intake: category, priority, sentiment, and language, advisory and
  agent-overridable.
- Knowledge base authoring with pgvector-backed chunking and embedding.
- Retrieval-grounded drafted replies with inline citations, shown to an agent who must
  approve or edit before anything sends — no autonomous customer-facing sends.
- AIDA Insight: recurring-issue clustering, knowledge-base-gap detection, ticket-volume
  drivers, and SLA/CSAT insight, beyond static counts.
- Append-only audit log recording every AI action (triage decision, generated draft, approved
  send) with input/output references and the model used.
- Prompt-injection defenses: ticket/customer text is treated as untrusted input; obvious
  secrets are redacted before reaching the LLM or logs; no data leaves the server except to the
  operator-configured LLM/SMTP/IMAP endpoints.

**Settings & administration**
- Branding (workspace display name, applied to the sidebar, public pages, and outbound email
  from-name), SLA policies, tags, custom fields, email channel, and AI provider/keys — all
  admin-gated with server-side authorization enforced on every mutating action.
- Auth with admin/agent roles; all data scoped to a workspace/organization id
  (multi-tenant-ready in the data model).

**Self-host & DX**
- One-command self-host: `docker compose up` brings up the app, PostgreSQL 16 + pgvector,
  a pg-boss worker (Postgres-backed queue, no Redis), and Caddy as the reverse proxy.
- A seed/demo dataset and an opt-in `DEMO_MODE` boot flag that populates a fictional support
  workspace (30 tickets across every status/SLA state, contacts, a knowledge base, CSAT
  responses, and AIDA Insight runs) for evaluation and screenshots.
- Backup/restore scripts (`scripts/backup.sh` / `scripts/restore.sh`, pg_dump + uploads volume)
  with a proven round-trip, plus `docs/OPERATIONS.md` (backups, restore, upgrades, logs, full
  env reference).
- A star-ready README (hero animation, honest comparison table, quick start) and a Starlight
  docs site covering install, configuration, AI setup per provider, guides, and operations.
- GitHub Actions CI (lint, typecheck, test, build) and a nightly integration workflow;
  `CONTRIBUTING.md`, a Contributor Covenant `CODE_OF_CONDUCT.md`, and a private vulnerability
  disclosure process (`.github/SECURITY.md`).
- A written pre-launch security pass (`docs/phases/07-launch-readiness/07-SECURITY-PASS.md`
  under `.planning/`) covering authz, secrets, tenant isolation, egress, and dependencies —
  1 HIGH and 3 MEDIUM findings fixed before this release.

### Known limitations

- **Single workspace in the UI.** The data model is multi-tenant-ready (every domain table
  carries an `organizationId`), but v1 ships and exposes only one workspace in the product UI.
- **No in-product invite flow.** There is currently no way to add a second team member to a
  workspace from within the product after initial `/setup` — a self-registered user gets no
  workspace membership. Planned for a future release.
- **No logo upload.** Branding ships name-only in v1 (`.planning/phases/07-launch-readiness/
  deferred-items.md`); a logo-upload flow is deferred.
- **No built-in backup scheduler.** Backup/restore is script-based and manually invoked (or
  cron-able by the operator) — there is no in-product scheduling sidecar yet.
- **No hosted demo instance.** `DEMO_MODE` lets you populate your own self-hosted instance for
  evaluation; AIDA does not operate a public hosted demo.
- **No KB auto-generation.** Proposing new knowledge-base articles from resolved tickets
  (AIDA-18) is a stretch goal, not implemented in v1.
- **Integration tests run nightly, not per-PR.** The Testcontainers-backed integration suite is
  isolated to a nightly cron workflow so a container-start flake never poisons the public CI
  badge on every pull request; `lint`/`typecheck`/`test`/`build` run on every push and PR.
- **Every container runs as root** (no non-root `USER` in the Docker runner stage) and
  **`sharp@0.34.5` carries known libvips CVEs** with no trivial patch available yet — both
  accepted, with mitigations, in the pre-launch security pass. See `07-SECURITY-PASS.md` for
  full detail and the complete list of accepted findings.
