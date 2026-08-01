# AIDA — Security & Privacy (reference)

AIDA's promise is **privacy-first, self-hosted AI**. These controls are product features, not afterthoughts. Phase plans must honor them; the Phase 7 security pass verifies them.

## Data residency & egress
- All ticket/customer data and KB content stay in the operator's PostgreSQL. **The only *application-runtime* outbound network egress is to the operator-configured LLM endpoint** (OpenAI/Anthropic, or nothing for local Ollama) plus the operator's own configured SMTP/IMAP host. No analytics or error-reporting SDK exists anywhere in the codebase (verified: zero call sites for Sentry/PostHog/Datadog/Segment/etc.).
- Local mode (Ollama) supports a fully air-gapped deployment — zero external API calls once built.
- **Known gap (not application runtime):** the *build/deploy* path currently makes three third-party calls the privacy-first posture should eventually close, none of which carry ticket/customer data: `next/font/google` fetches a font at `next build` time (self-hosted afterwards — zero egress once built); Next.js's own build/dev telemetry to `telemetry.nextjs.org` is on by default (off at runtime); and the Prisma CLI's checkpoint ping to `checkpoint.prisma.io` fires on every `docker compose up` via the one-shot `migrate` service. See the Phase 7 security pass for full detail — corrected here rather than silently left implied by "no telemetry ... by default" above.

## Secrets & keys
- LLM provider API keys and email (IMAP/SMTP) credentials are **encrypted at rest** (AES-256-GCM via `APP_ENCRYPTION_KEY`, the app's one secret-box primitive), never logged, never returned to the client in plaintext. Verified: every credential-bearing `Setting` key round-trips exclusively through `encryptSecret`/`decryptSecret`, and all 14 `console.*` call sites in `src/` were traced and none interpolates a decrypted secret.
- `.env.example` documents required secrets; real secrets are never committed (enforced by `.gitignore`).
- Public-endpoint rate-limiting stores `sha256(ip + RATE_LIMIT_PEPPER)`, never the raw IP. `RATE_LIMIT_PEPPER` is **mandatory** — the app throws a descriptive error rather than silently falling back to an unsalted or public-default hash if it is ever unset at the point a rate limit is actually checked (fixed in the Phase 7 security pass; previously it could silently degrade to an unsalted hash on the shipped Compose path — corrected, not merely documented).
- **Known gap:** the `pnpm db:seed` CLI script (an operator-run tool, never invoked by the app or by `docker compose up`) currently echoes the demo account's effective password to stdout, including an operator-supplied override. Tracked as a low-severity finding in the Phase 7 security pass, not yet fixed.

## Untrusted input (prompt-injection)
- Ticket subjects, bodies, and email content are **untrusted**. They are passed to the LLM as *data to analyze*, never as instructions, using clear delimiting and a system prompt that refuses embedded instructions.
- The AI has **no autonomous action capability in v1** beyond producing drafts/classifications: it cannot send to customers, change ticket state destructively, or call tools without a human. This structurally neutralizes "injection → action."
- Drafted replies are **citation-grounded** and require human approval before send; an agent is the gate against a malicious/hallucinated draft.

## PII handling
- Obvious secrets (API keys, passwords, tokens, card-like numbers) are redacted before text reaches the LLM or the audit log, via a redaction pass.
- The KB ingestion path is for operator-curated content; it should not ingest customer PII by default.
- Default posture: "no training on your data" — adapters request no-retention/no-train options where the provider supports them; documented per provider.

## AuthZ & tenancy
- Server-side authorization on every mutating route (admin vs agent); UI hiding is never the only control. Verified across all 35 Server Actions and all 8 route handlers in the Phase 7 security pass — one gap was found (a single Settings action missing its admin gate) and fixed the same day; see the security pass report for the full per-action/per-route audit.
- All data access goes through `scopedDb(workspaceId)`; an integration test seeds two workspaces and asserts zero cross-tenant reads. `scopedDb` does **not** intercept raw SQL — every `$queryRaw`/`$executeRaw` call site in the codebase was individually audited and confirmed to filter `organizationId` explicitly (or an equivalent org-scoped join), except one system-cron job whose predicates are row-local and returns no rows to any tenant.

## Auditability
- `AuditEvent` is **append-only** — AI triage decisions, generated drafts, and approved sends are recorded with the model used and references to inputs/outputs. Audit rows are never mutated or deleted.

## Self-host hardening & continuity (single server)
- Caddy provides TLS by default; the app binds behind it.
- Backup/restore via `pg_dump`/`pg_restore` documented (AIDA-24); the Postgres volume is the single source of truth, so a volume snapshot + dump is a complete backup.
- Healthcheck endpoint for the container; documented upgrade path (migrate on deploy).
- An `AI off` switch lets an operator disable all LLM calls instantly (kill switch).

## Honesty in claims
- AIDA **orchestrates** LLMs (hosted or local) — it does not train/fine-tune models. Marketing uses relative/measured claims, never fabricated resolution-rate statistics.

## Reporting a vulnerability

Found a security issue? Please do not open a public issue — see [`.github/SECURITY.md`](../.github/SECURITY.md) for the private disclosure process. That document is the disclosure *process*; this one is the *design*.

---

**Last verified: 2026-08-01 — see [`.planning/phases/07-launch-readiness/07-SECURITY-PASS.md`](../.planning/phases/07-launch-readiness/07-SECURITY-PASS.md)** for the full evidence-backed audit (8 parallel sweeps with adversarial refutation of every claimed finding, plus a completeness critic), the severity-rated findings list, and the known issues accepted for v1.
