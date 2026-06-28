# REQUIREMENTS — AIDA v1 (Minimum Lovable Helpdesk)

Each requirement is a single testable statement. `MVP` = required for the v1 milestone; `Stretch` = nice-to-have if time allows.

## Core ticketing

- **AIDA-01** `MVP` — A user can create a ticket (subject, body, priority) and move it through a lifecycle (`new → open → pending → resolved → closed`); state and priority changes persist and are visible.
- **AIDA-02** `MVP` — Agents see a shared inbox with saved views (Unassigned, Mine, by status), plus filter and full-text search across tickets.
- **AIDA-03** `MVP` — Every ticket is linked to a contact/requester record; opening a contact shows their ticket history.
- **AIDA-04** `MVP` — An agent can assign a ticket to another agent, post a **public reply** (visible to the requester) or a **private internal note** (team-only), and the two are visually distinct.
- **AIDA-05** `MVP` — Agents can apply tags/labels to tickets and filter by them; a small set of basic custom fields is supported.
- **AIDA-06** `MVP` — Each ticket has SLA timers (first-response and resolution) derived from priority/policy, with a visible breach/at-risk indicator.
- **AIDA-07** `MVP` — A ticket shows a chronological conversation thread (inbound + outbound messages) with file attachments.

## Channels (intake)

- **AIDA-08** `MVP` — A public web form (and/or portal link) creates a ticket; the submitter receives a confirmation and a way to view status.
- **AIDA-09** `MVP` — Inbound email is parsed into a ticket (replies thread onto the existing ticket via message-id/headers); agents' public replies are delivered outbound via SMTP.

## Auth & multi-tenant

- **AIDA-10** `MVP` — Authentication with at least two roles (admin, agent); admins can invite/manage users; server-side authorization is enforced (not just hidden UI).
- **AIDA-11** `MVP` — All data is scoped to a workspace/organization id (multi-tenant-ready); queries cannot cross workspaces even if v1 ships a single workspace.
- **AIDA-12** `MVP` — A settings area lets an admin configure branding, SLA policies, channels (email/web), and AI provider/keys.

## AI

- **AIDA-13** `MVP` — A model-agnostic LLM layer supports OpenAI, Anthropic, and a local model via Ollama, selectable in settings; provider API keys are encrypted at rest; AI features can be toggled fully off and the helpdesk still works.
- **AIDA-14** `MVP` — On intake, a ticket is auto-triaged: predicted category, priority, sentiment, and language are attached and used to suggest routing; triage is advisory (an agent can override).
- **AIDA-15** `MVP` — Admins can author or import knowledge-base articles; article content is chunked, embedded, and stored in pgvector for retrieval.
- **AIDA-16** `MVP` — For an open ticket, AIDA retrieves relevant KB/past-ticket context and produces a **drafted reply with inline citations**; the draft is shown to an agent who must approve/edit before it is sent (no autonomous customer-facing sends in v1).
- **AIDA-17** `MVP` — AIDA Insight presents AI-driven analytics: clustering of recurring issues, detection of knowledge-base gaps (frequent questions with no good article), top ticket-volume drivers, and SLA/CSAT insight — beyond static counts.
- **AIDA-18** `Stretch` — AIDA can propose a new KB article drafted from one or more resolved tickets, for admin review/approval.

## Trust & governance

- **AIDA-19** `MVP` — Every AI action (triage decision, generated draft, approved send) is recorded in an append-only audit log with input/output references and the model used.
- **AIDA-20** `MVP` — Ticket/customer text is treated as untrusted: prompt-injection cannot cause the AI to take actions or leak system/context data; obvious secrets are redacted before reaching the LLM or logs; no data is sent anywhere except the operator-configured LLM endpoint.

## Self-host & DX

- **AIDA-21** `MVP` — `docker compose up` starts the full stack (Next.js app + PostgreSQL/pgvector + pg-boss worker) on one host; a documented `.env.example` and a healthcheck are provided.
- **AIDA-22** `MVP` — A seed/demo dataset (and a demo mode) lets a newcomer explore a populated helpdesk immediately for screenshots/trial.
- **AIDA-23** `MVP` — The repo ships a star-ready README (hero GIF/screenshot, one-line pitch, quick-start, comparison) and a docs site covering install, configuration, and AI setup.
- **AIDA-24** `MVP` — Backup/restore guidance for a single server (pg_dump) and basic ops docs (upgrade, logs, env) are provided.

## Traceability

All MVP requirements (AIDA-01 … AIDA-17, AIDA-19 … AIDA-24) are mapped to phases in `ROADMAP.md`; AIDA-18 is backlog. No MVP requirement is left unmapped.
