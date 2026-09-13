---
id: SEED-001
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions integrations, escalation, engineering hand-off, ITSM problem/change linkage, or Plane/GitHub/Linear/Jira
scope: M (1 phase, ~5-6 plans) — requires SEED-002 first
---

# SEED-001: Issue-tracker bridge — escalate a ticket to a Plane / GitHub Issues work item and sync status back

## Why This Matters

Support teams constantly hand bugs and feature requests to engineering. Zendesk↔Jira is the canonical integration; AIDA has none. Plane (self-hostable, same audience as AIDA) and GitHub Issues (the OSS audience's default) are the two natural first targets. This is also the honest answer to "should AIDA add project management?" — no, it should *link to* the tool the team already uses, via an adapter interface exactly like `src/lib/llm/`.

## When to Surface

**Trigger:** new milestone scope mentions integrations, escalation, engineering hand-off, ITSM problem/change linkage, or Plane/GitHub/Linear/Jira.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**M** — one phase: adapter interface + Plane adapter + GitHub Issues adapter, `TicketExternalLink` model, "Escalate" action in the ticket meta header, inbound webhook route (HMAC-verified, rate-limited, public prefix), internal-note sync, settings page for credentials (encrypted), egress-isolation test extension, docs. Depends on SEED-002 (webhook/API plumbing) landing first or in the same milestone.

## Breadcrumbs

- Design sketch + Plane API facts: `.planning/research/plane-inspiration.md` §5 (`X-Api-Key`, 60/min default rate limit, `PROJ-seq` lookup, `X-Plane-Signature` HMAC-SHA256, `X-Plane-Event`, `X-Plane-Delivery`).
- Adapter pattern to mirror: `src/lib/llm/` (provider abstraction, encrypted `llm:*` settings, `probe`/Test Connection).
- Secret encryption: `src/lib/crypto/` (AES-256-GCM secret-box, 03-02).
- Public route allow-list: `PUBLIC_PREFIXES` in `src/proxy.ts`; rate limiting: `src/lib/rate-limit/`.
- Ticket action surface: `src/components/tickets/ticket-meta-header.tsx`.
- Egress claim to update: `docs/SECURITY.md`; runtime proof: `tests/integration/egress-isolation.test.ts` (07-09.1).

## Notes

Clean-room only — implement from the research doc, never from Plane's AGPL source. Treat webhook payloads as untrusted input (prompt-injection rules apply if any text reaches an LLM).
