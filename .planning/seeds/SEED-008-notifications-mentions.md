---
id: SEED-008
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions collaboration, notifications, mentions, assignments, or agent awareness
scope: M (1 phase, ~5 plans) — needs SEED-007 (multiple members) to be meaningful
---

# SEED-008: In-app notification inbox + @mentions in internal notes

## Why This Matters

Once there are several agents (SEED-007), nobody is told "you were assigned #42", "customer replied", or "@you please check this note". Plane's model is a good behavioural spec: one `Notification` row per (user, entity, event) with `read_at / snoozed_till / archived_at` so the inbox can be triaged like mail, per-user preferences by event type, and a *batched* email digest (every few minutes) rather than one email per event. Mentions come from the editor (`@name` → mention entity → notification).

## When to Surface

**Trigger:** new milestone scope mentions collaboration, notifications, mentions, assignments, or agent awareness.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**M** — `Notification` + `NotificationPreference` models; emitters on assignment change, inbound customer reply, internal note mention, SLA at-risk/breach (reuse the SLA flag job); bell + popover in the top bar with unread count, mark read/archive; `@mention` autocomplete in the internal-note composer (members list) stored as a lightweight `Mention` link; pg-boss digest job batching unread notifications into one email; settings page for preferences.

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 8 (Plane `db/models/notification.py:13-121`, `IssueMention` in `db/models/issue.py`).
- Composer (public/note) from 02-09: `src/app/(app)/tickets/[id]/` (composer.tsx — note the draft-insertion `useEffect` reviewed in 07-09).
- Markdown rendering with safe links: `src/lib/markdown/` (`renderMarkdown`, `rehypeSafeLinks`) — mention rendering plugs in here.
- SLA flag job (emit at-risk/breach notifications): `src/lib/tickets/jobs/`.
- SMTP send path for the digest: `src/lib/channels/email/` (03-05).

## Notes

Notifications must never leak `AuditEvent.input` or customer PII into email subjects; keep the digest terse and link back into the app.
