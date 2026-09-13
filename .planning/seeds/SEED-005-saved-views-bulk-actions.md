---
id: SEED-005
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions inbox productivity, agent efficiency, views, filters, or bulk actions
scope: S-M (1 phase, ~4 plans)
---

# SEED-005: Saved inbox views (private/shared) + bulk actions

## Why This Matters

Agents live in the inbox. Today AIDA's filters (view/status/tag/custom field/FTS) are ephemeral URL state; nobody can save "Breaching in <2h, unassigned" as a shared view, and there is no multi-select to assign/tag/close 20 tickets at once. Plane persists views as a filters JSON document with private/public access and a lock flag, and exposes bulk endpoints. Both are cheap on AIDA's stack and are table-stakes in every helpdesk comparison.

## When to Surface

**Trigger:** new milestone scope mentions inbox productivity, agent efficiency, views, filters, or bulk actions.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**S-M** — `SavedView` model (name, filters JSON validated against the existing filter schema, `visibility ∈ private|shared`, owner, sort order, org-scoped) + sidebar "Views" section + "Save current filters" affordance; multi-select checkboxes in the inbox list + bulk action bar (assign, status, add/remove tag, priority) behind one server action that loops the existing single-ticket mutations inside a transaction and writes one audit entry per ticket; E2E for isolation + bulk.

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 5 (Plane `db/models/view.py:58`, `app/urls/issue.py:89-101`).
- Inbox shell + filter state: `src/app/(app)/tickets/` (02-08), `filter-chip-row.tsx`, `src/lib/tickets/list-query.ts`, `cf-param.ts` (custom-field filter param encoding).
- Ticket mutations to reuse for bulk: reading-pane actions from 02-09 under `src/app/(app)/tickets/[id]/`.
- Design system: sidebar tokens + empty-state halo pattern in `.planning/DESIGN-SYSTEM.md` (Views section must use `sidebar-*` tokens).

## Notes

Pairs well with SEED-006 (palette can list saved views and run bulk actions).
