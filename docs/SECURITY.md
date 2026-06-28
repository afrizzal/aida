# AIDA — Security & Privacy (reference)

AIDA's promise is **privacy-first, self-hosted AI**. These controls are product features, not afterthoughts. Phase plans must honor them; the Phase 7 security pass verifies them.

## Data residency & egress
- All ticket/customer data and KB content stay in the operator's PostgreSQL. **The only outbound network egress is to the operator-configured LLM endpoint** (OpenAI/Anthropic, or nothing for local Ollama). No telemetry, no third-party analytics by default.
- Local mode (Ollama) supports a fully air-gapped deployment — zero external API calls.

## Secrets & keys
- LLM provider API keys, email credentials, and other secrets are **encrypted at rest** (AES-256-GCM via an app key from env/secret store), never logged, never returned to the client in plaintext.
- `.env.example` documents required secrets; real secrets are never committed (enforced by `.gitignore`).

## Untrusted input (prompt-injection)
- Ticket subjects, bodies, and email content are **untrusted**. They are passed to the LLM as *data to analyze*, never as instructions, using clear delimiting and a system prompt that refuses embedded instructions.
- The AI has **no autonomous action capability in v1** beyond producing drafts/classifications: it cannot send to customers, change ticket state destructively, or call tools without a human. This structurally neutralizes "injection → action."
- Drafted replies are **citation-grounded** and require human approval before send; an agent is the gate against a malicious/hallucinated draft.

## PII handling
- Obvious secrets (API keys, passwords, tokens, card-like numbers) are redacted before text reaches the LLM or the audit log, via a redaction pass.
- The KB ingestion path is for operator-curated content; it should not ingest customer PII by default.
- Default posture: "no training on your data" — adapters request no-retention/no-train options where the provider supports them; documented per provider.

## AuthZ & tenancy
- Server-side authorization on every mutating route (admin vs agent); UI hiding is never the only control.
- All data access goes through `scopedDb(workspaceId)`; an integration test seeds two workspaces and asserts zero cross-tenant reads.

## Auditability
- `AuditEvent` is **append-only** — AI triage decisions, generated drafts, and approved sends are recorded with the model used and references to inputs/outputs. Audit rows are never mutated or deleted.

## Self-host hardening & continuity (single server)
- Caddy provides TLS by default; the app binds behind it.
- Backup/restore via `pg_dump`/`pg_restore` documented (AIDA-24); the Postgres volume is the single source of truth, so a volume snapshot + dump is a complete backup.
- Healthcheck endpoint for the container; documented upgrade path (migrate on deploy).
- An `AI off` switch lets an operator disable all LLM calls instantly (kill switch).

## Honesty in claims
- AIDA **orchestrates** LLMs (hosted or local) — it does not train/fine-tune models. Marketing uses relative/measured claims, never fabricated resolution-rate statistics.
