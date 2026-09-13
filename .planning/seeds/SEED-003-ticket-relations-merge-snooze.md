---
id: SEED-003
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions ticket lifecycle, duplicates, merge, snooze, problem management, ITSM, or inbox hygiene
scope: M (1 phase, ~5 plans)
---

# SEED-003: Ticket relations (duplicate / related / parent-child), merge, and snooze

## Why This Matters

Real inboxes are full of duplicates ("same outage, 14 tickets") and tickets waiting on the customer. AIDA has no way to say "this is a duplicate of #42", to merge threads, or to snooze a ticket until a date/reply. Plane models this cleanly: a typed relation table with a reverse map (`duplicate ↔ duplicate`, `blocked_by ↔ blocking`, `relates_to`) and an intake status set (`pending / accepted / rejected / snoozed(snoozed_till) / duplicate(duplicate_to)`). For the ITSM angle, parent-child gives "one problem ticket ← many incidents" for free. AIDA Insight's recurring-issue clusters could even *suggest* the duplicate links.

## When to Surface

**Trigger:** new milestone scope mentions ticket lifecycle, duplicates, merge, snooze, problem management, ITSM, or inbox hygiene.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**M** — `TicketRelation` model (`type ∈ duplicate_of | related_to | child_of`, unique per pair, org-scoped) + `Ticket.snoozedUntil`; merge action (move messages/attachments, close source as duplicate, audit event, customer-facing status page redirect); snooze action + pg-boss job that un-snoozes on date or on inbound reply (hook into the existing auto-reopen paths in `ingestMessage()` and the follow-up route); relation chips in `ticket-meta-header.tsx`; inbox filter "snoozed"; unified per-ticket activity feed ("merged from #12", "snoozed until …").

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 3 (Plane `db/models/issue.py:284-296`, `db/models/intake.py:40-73`, `app/serializers/intake.py:43-91`).
- Ticket model + counter: `prisma/schema.prisma` (`model Ticket`, `TicketCounter`); creation transaction `src/lib/tickets/create-ticket.ts`.
- Auto-reopen logic to reuse for un-snooze: `src/lib/channels/email/` (`ingestMessage()`, 03-04) and the public follow-up route under `src/app/(public)/status/[token]`.
- Status page token: `src/lib/tickets/status-token.ts` (merged tickets need a redirect/alias).
- Insight clusters that could suggest duplicates: `src/lib/insight/`.

## Notes

Merge is irreversible for the customer thread — require confirmation and write a full `AuditEvent`. `AuditEvent` is append-only (DB trigger), so never plan a "hard delete" of the source ticket.
