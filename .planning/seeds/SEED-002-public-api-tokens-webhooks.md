---
id: SEED-002
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions integrations, automation, API, webhooks, n8n/Zapier/Slack, or extensibility
scope: M (1 phase, ~5-6 plans)
---

# SEED-002: Public REST API with API tokens + signed outbound webhooks

## Why This Matters

Without an API and webhooks, AIDA cannot plug into anything (n8n, Zapier, Slack, a status page, SEED-001's tracker bridge). Every helpdesk people compare AIDA against has both. Plane's implementation is a solid reference for the *behaviour*: per-token expiry + last-used + rate limit, HMAC-SHA256 signed deliveries with delivery/event headers, retry with backoff + jitter, a delivery log, **auto-deactivation after N consecutive failures with an email to the owner**, and an SSRF guard on the target URL. pg-boss already gives us retry/backoff for free.

## When to Surface

**Trigger:** new milestone scope mentions integrations, automation, API, webhooks, n8n/Zapier/Slack, or extensibility.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**M** — `ApiToken` model (hashed at rest, prefix like `aida_…`, expiry, last-used, per-token rate limit) + bearer auth in `src/proxy.ts` for `/api/v1/*`; `Webhook` + `WebhookDelivery` models; pg-boss `webhook-deliver` job with HMAC-SHA256 signature header, retries, delivery log, auto-deactivate; SSRF guard (block private ranges/localhost, no redirects); Settings → Developers page (tokens + webhooks + regenerate secret + logs); OpenAPI doc page; tests (signature verification, retry, SSRF, org isolation).

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 1 (Plane paths `apps/api/plane/bgtasks/webhook_task.py:235-390`, `db/models/webhook.py:33`, `db/models/api.py:23`, `api/rate_limit.py`).
- Existing auth/route guard: `src/proxy.ts` (already returns 401 JSON for unauthenticated `/api/*`, quick-260705-bau).
- Queue: `src/lib/queue/` + job registry in `src/lib/worker/`; existing job shape: `src/lib/tickets/jobs/`.
- Rate limiting primitive: `src/lib/rate-limit/` (Postgres-backed, 02-05).
- Security notes to extend: `docs/SECURITY.md`; 07-09's known issue "SSRF error oracle" in `07-SECURITY-PASS.md` — the webhook SSRF guard should close that class properly.

## Notes

Every webhook payload must be org-scoped (scopedDb) and must never include encrypted settings or `AuditEvent.input`. Signature secret shown once, regenerable.
