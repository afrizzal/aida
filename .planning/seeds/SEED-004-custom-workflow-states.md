---
id: SEED-004
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions custom statuses, workflow, SLA pause, "waiting on customer", ITSM, or process customisation
scope: L (1 phase, ~7 plans; enum → table migration touches SLA, filters, insight SQL, demo seed)
---

# SEED-004: Custom workflow states grouped into semantic state groups (+ SLA clock pause on "pending")

## Why This Matters

`TicketStatus` is a fixed enum. Every team past ~5 agents wants their own states ("Waiting on customer", "Waiting on engineering", "Escalated to L2"). Plane's design keeps code sane: users define *states*, each state belongs to a fixed *group* (`backlog/unstarted/started/completed/cancelled/triage`), and all logic reasons about the group. For a helpdesk the groups are `open / pending / resolved / closed`; the SLA clock should pause while a ticket sits in a `pending`-group state — a feature every commercial helpdesk sells and AIDA cannot express today.

## When to Surface

**Trigger:** new milestone scope mentions custom statuses, workflow, SLA pause, "waiting on customer", ITSM, or process customisation.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**L** — `TicketState` table (name, color, group, sort order, isDefault, org-scoped) seeded from the current enum for existing orgs; `Ticket.stateId` replacing `status` (keep a computed `statusGroup` for the public status page and Insight SQL); SLA helpers gain paused-time accounting; Settings → Workflow page (reorder, rename, colour, default); every status chip/filter/E2E fixture updated; demo fixtures updated (`ageHours`/`slaState` invariant must still hold).

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 4 (Plane `db/models/state.py:14-79`, default manager hiding triage `db/models/issue.py:92`).
- Current enum: `prisma/schema.prisma` (`enum TicketStatus`); SLA math: `src/lib/tickets/sla.ts`; SLA flag worker job: `src/lib/tickets/jobs/`.
- Status chips: `src/components/tickets/` (StatusChip from 02-06); inbox filters: `src/app/(app)/tickets/filter-chip-row.tsx`, list query `src/lib/tickets/list-query.ts`.
- Insight SQL aggregates that read status: `src/lib/insight/` (06-03).
- Demo data invariants: `src/lib/demo/fixtures.ts`, `src/lib/demo/seed-demo-data.ts` (07-08 reconciliation).

## Notes

Highest-risk seed here (schema migration across the whole product). Only worth it once teams ask; consider a cheaper first step: keep the enum, add a `pendingReason` + SLA pause on `PENDING` only.
