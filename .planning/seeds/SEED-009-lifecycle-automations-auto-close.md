---
id: SEED-009
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions automation, ticket lifecycle, auto-close, inbox hygiene, or SLA/ops polish
scope: S (2-3 plans; could be a quick task if scoped to auto-close only)
---

# SEED-009: Lifecycle automations — auto-close resolved tickets after N days of silence (and friends)

## Why This Matters

Every helpdesk auto-closes RESOLVED tickets after a quiet period (typically 3–7 days) so the inbox and the SLA/CSAT numbers stay honest; AIDA leaves them RESOLVED forever unless a human clicks. Plane does the equivalent with two per-project settings (`archive_in`, `close_in`) and a daily scheduled task. AIDA already has a recurring pg-boss job (SLA flag, 02-05) and an org-scoped `Setting` store, so this is mostly a cron job + a settings field.

## When to Surface

**Trigger:** new milestone scope mentions automation, ticket lifecycle, auto-close, inbox hygiene, or SLA/ops polish.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**S** — org setting `autoCloseResolvedAfterDays` (0 = off) on the SLA settings page; pg-boss cron job that closes qualifying tickets (RESOLVED, last message older than N days, not snoozed) with an audit event and, optionally, a final customer email ("we're closing this, reply to reopen" — the existing auto-reopen path already handles the reply). Later candidates under the same umbrella: auto-assign round-robin, auto-tag from triage category, CSAT request N hours after resolve.

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 9 (Plane `bgtasks/issue_automation_task.py`, `celery.py:59`, `db/models/project.py` `archive_in/close_in`).
- Recurring job pattern: SLA flag job in `src/lib/tickets/jobs/` + registration in `src/lib/worker/`; queue client `src/lib/queue/`.
- SLA settings surface: `src/app/(app)/settings/sla/`.
- Auto-reopen on reply: `src/lib/channels/email/` (`ingestMessage()`) and the status-page follow-up route.
- CSAT capture (for a "request CSAT after resolve" automation): `src/lib/insight/` + `src/app/(public)/status/[token]`.

## Notes

Keep the worker bundle constraint in mind: anything read from both app and worker must use relative imports (see the 07-12 decision on `src/lib/branding/settings.ts`).
