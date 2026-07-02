---
phase: 02-core-ticketing
plan: 08
subsystem: tickets-ui
tags: [nextjs-app-router, server-components, scopedDb, full-text-search, url-searchparams]

# Dependency graph
requires:
  - phase: 02-core-ticketing (plan 04)
    provides: searchTickets(orgId, query, limit) org-safe FTS
  - phase: 02-core-ticketing (plan 06)
    provides: StatusChip/PriorityChip/SlaDueChip/TagChip/TagOverflowChip/AssigneeAvatar
  - phase: 02-core-ticketing (plan 07)
    provides: CustomFieldDefinition admin CRUD (read here for the filter dropdown)
affects: [02-09, 02-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "URL-searchParams-as-state for a filtered/paginated list: Server Component parses searchParams -> typed filters -> Prisma where, Client filter controls only ever router.push a new query string"
    - "Client/server bundle boundary: pure string-parsing helpers used by both a Client Component and a server-only query module get their own dependency-free file, so the client bundle never pulls in prisma/pg transitively"
    - "Shared list-column component (TicketListPanel) rendered by multiple routes (index + future [id]) instead of living in layout.tsx, because Next.js layouts don't receive per-route searchParams"

key-files:
  created:
    - src/app/(app)/tickets/layout.tsx
    - src/app/(app)/tickets/ticket-list-row.tsx
    - src/app/(app)/tickets/filter-chip-row.tsx
    - src/app/(app)/tickets/ticket-search-input.tsx
    - src/lib/tickets/list-query.ts
    - src/lib/tickets/cf-param.ts
    - src/app/(app)/tickets/ticket-list-panel.tsx
  modified:
    - src/app/(app)/tickets/page.tsx

key-decisions:
  - "cf-param.ts extracted as a dependency-free module (not part of list-query.ts) — filter-chip-row.tsx is a Client Component and importing parseCfParam/serializeCfParam from list-query.ts pulled searchTickets's prisma/pg chain into the client bundle, breaking `next build`."
  - "tickets/layout.tsx cancels the (app) shell's inherited p-6 padding via -m-6 for an edge-to-edge 2-pane view; explicit height calc(100vh-3.5rem) accounts for the TopBar."
  - "TicketListPanel accepts an optional basePath (default /tickets) so plan 09's /tickets/[id] route can reuse it for 'Load more' pagination without navigating away from the open ticket."
  - "Only AIDA-02 marked complete this plan — AIDA-05's 'apply tags/labels to tickets' half still lands in plan 09's reading-pane tag editor; the filter half shipped here."

requirements-completed: [AIDA-02]

# Metrics
duration: 70min
completed: 2026-07-02
---

# Phase 02 Plan 08: Shared Inbox — 2-Pane Layout, Filters, Search Summary

**Real shared-inbox UI: an edge-to-edge 2-pane layout (list + reading-pane slot), a server-driven `TicketListRow` list with SLA/priority/tag chips, a `FilterChipRow` (views/status/tag/custom-field) plus debounced full-text search — all state lives in URL searchParams, and the FTS pagination-truncation bug flagged in the plan (searchTickets's internal 25-row default vs the 50-row page size) is fixed by forwarding the page limit.**

## Performance

- **Duration:** ~70 min (worktree sync + install/generate included)
- **Started:** 2026-07-02
- **Completed:** 2026-07-02
- **Tasks:** 3 completed
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments

- `tickets/layout.tsx` + `TicketListPanel` give the Tickets route a true edge-to-edge 2-pane shell: a `w-[360px]` scrollable list column (border-r) and a `flex-1` reading-pane slot, replacing the old single-`EmptyState` stub.
- `TicketListRow` renders the full 3-line row contract (contact + relative time / subject / chip row: `StatusChip`, `PriorityChip` for High/Urgent only, `SlaDueChip` for whichever SLA timer is still live, up to 2 `TagChip`s + overflow, assignee avatar) plus a 6-row `TicketListSkeleton` used as the route's Suspense fallback.
- `FilterChipRow` drives Unassigned/Mine/All view pills, a status multi-select, a tag `Popover`+`Command` combobox, and a single active custom-field filter, all purely through URL searchParams (`view`/`status`/`tag`/`cf`); `TicketSearchInput` debounces the `q` param.
- `list-query.ts`'s `fetchTicketList` builds the `where` clause from all of the above and — critically — forwards `filters.limit ?? 50` as `searchTickets`'s own limit argument, so an FTS-active "Load more" no longer silently disappears (searchTickets's internal default of 25 would otherwise cap the candidate-id set below the 50-row page size).
- Empty states wired correctly: a true zero-tickets-ever workspace shows the shared `EmptyState` ("Your inbox is empty"), a filtered-to-nothing view shows the smaller inline "Nothing here" state, and the reading pane shows "Select a ticket" until plan 09's `/tickets/[id]` lands.

## Task Commits

Each task was committed atomically:

1. **Task 1: 2-pane layout + TicketListRow + list loading/empty states** - `fac955f` (feat)
2. **Task 2: FilterChipRow (views/status/tag/custom-field) + search input** - `059d5c6` (feat)
3. **Task 3: List query builder + ticket-list-panel data fetch** - `bb620f2` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/app/(app)/tickets/layout.tsx` - Flex-row 2-pane wrapper; `-m-6` cancels the `(app)` shell's inherited `p-6` for an edge-to-edge inbox; `h-[calc(100vh-3.5rem)]` accounts for the TopBar.
- `src/app/(app)/tickets/ticket-list-row.tsx` - `TicketListRow` (3-line row, selected/hover states) + `TicketListSkeleton` (6-row loading placeholder); local `formatRelativeTime`/`getActiveDue` helpers.
- `src/app/(app)/tickets/filter-chip-row.tsx` - View pills, status `DropdownMenuCheckboxItem` multi-select, tag `Popover`+`Command`, custom-field `DropdownMenu` picker + value input — all `router.push`-ing a new query string built from the current `useSearchParams()`.
- `src/app/(app)/tickets/ticket-search-input.tsx` - Debounced (300ms) search box bound to the `q` searchParam, self-contained (reads/writes its own URL state).
- `src/lib/tickets/list-query.ts` - `TicketListFilters`, `parseTicketListFilters` (URL -> typed filters), `fetchTicketList` (filters -> scopedDb `where` + `searchTickets` integration), `TicketListItem` type (inferred from `fetchTicketList`'s return, reused by `TicketListRow`'s prop type for guaranteed shape parity).
- `src/lib/tickets/cf-param.ts` - `parseCfParam`/`serializeCfParam`, dependency-free (see Deviations).
- `src/app/(app)/tickets/ticket-list-panel.tsx` - Async Server Component: `getScopedDb()` + parallel `fetchTicketList`/`ticket.count()`/`tag.findMany()`/`customFieldDefinition.findMany()`, renders `FilterChipRow` + rows/empty-states + "Load more".
- `src/app/(app)/tickets/page.tsx` - Renders `TicketListPanel` (Suspense-wrapped) on the left, "Select a ticket" `EmptyState` on the right.

## Decisions Made

- Extracted `cf-param.ts` as a standalone dependency-free module rather than exporting `parseCfParam`/`serializeCfParam` from `list-query.ts` — `filter-chip-row.tsx` is a Client Component, and importing from `list-query.ts` (which imports `searchTickets` -> `@/lib/db` -> `pg`) broke `next build` with a `node:tls`/`node:module` bundling error. This is the kind of client/server boundary mistake that's easy to make with "just add one more export" — worth a dedicated file precisely because it has zero dependencies and can never accidentally regain one.
- `TicketListPanel` takes an optional `basePath` (default `/tickets`) so plan 09's `/tickets/[id]` route can render the same panel for "Load more" pagination without the link navigating away from the open ticket back to the bare `/tickets` index.
- FilterChipRow's header is split into two rows (view pills + search on one line, status/tag/custom-field buttons on a second) rather than forcing everything into a single literal `h-14` — the UI-SPEC's single-row filter-row spec doesn't fit 3 pills + 3 filter buttons + a search box inside a 360px column; flagged here as a Claude's-discretion layout call (matches the "exact spacing" being explicitly left to Claude's discretion in 02-CONTEXT.md), not a deviation from the design tokens/typography/color rules themselves.
- Used `DropdownMenuCheckboxItem` (not a standalone `Checkbox` primitive) for the status multi-select — matches the UI-SPEC's literal wording ("multi-select checkboxes... compact DropdownMenu button") and the plan's acceptance criteria substring check, without adding a second checkbox-rendering code path.
- Only `AIDA-02` is marked complete by this plan. `AIDA-05` ("apply tags/labels to tickets and filter by them") is half-shipped: the *filter* half is fully wired here (tag `Popover`+`Command`, custom-field filter), but the *apply-tags-to-a-ticket* half is the reading pane's job (plan 09's "+ Add tag" ghost button in the ticket detail secondary meta row per 02-UI-SPEC.md §1). Marking AIDA-05 complete is deferred to whichever plan finishes that half, consistent with the AIDA-06/AIDA-08 partial-completion precedent set in 02-05's summary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Client/server bundle boundary break: filter-chip-row.tsx pulled prisma/pg into the client bundle**
- **Found during:** Task 3 verification (`pnpm run build`)
- **Issue:** `filter-chip-row.tsx` (`"use client"`) imported `parseCfParam`/`serializeCfParam` from `src/lib/tickets/list-query.ts`, which imports `searchTickets` from `search.ts`, which imports `prisma` from `@/lib/db` (the `pg` driver). Turbopack tried to bundle `pg`'s `node:tls`/`node:module`-dependent internals for the browser and failed the build outright.
- **Fix:** Extracted `parseCfParam`/`serializeCfParam` into a new dependency-free module (`src/lib/tickets/cf-param.ts`); `list-query.ts` (server) and `filter-chip-row.tsx` (client) both import from there instead of from each other.
- **Files modified:** `src/lib/tickets/cf-param.ts` (created), `src/lib/tickets/list-query.ts`, `src/app/(app)/tickets/filter-chip-row.tsx`.
- **Commit:** `059d5c6`

**2. [Rule 1 - Style] Off-scale typography (`text-[11px]`) on the status-filter count badge**
- **Found during:** Post-Task-2 design-system self-check (DESIGN-SYSTEM.md §3 established 12/13/14/15/18px only)
- **Issue:** A small count badge used `text-[11px]`, one size off the project's established explicit-size scale.
- **Fix:** Changed to `text-[12px]`.
- **Files modified:** `src/app/(app)/tickets/filter-chip-row.tsx`
- **Commit:** `059d5c6`

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 style). **Impact on plan:** no scope creep — both are structural correctness fixes required to ship the plan's own deliverables.

### Also discovered but explicitly out of scope (logged, not fixed)

- **CRLF vs LF (repo-wide, pre-existing issue documented since 02-05).** Reproduced again on `src/lib/tickets/search.ts` (plan 04, untouched by this plan) when running `biome check` alongside this plan's new files. Logged in `deferred-items.md` under a new "From 02-08" section rather than duplicated here; not fixed (same reasoning as 02-05: environment artifact, not this plan's regression, destructive to mass-fix, requires a git-config/`.gitattributes` change outside this plan's scope).
- **`gsd-tools requirements mark-complete AIDA-02` reports `not_found`** — same pre-existing REQUIREMENTS.md format mismatch documented in 02-05's summary (plain bullets, no checkbox/table format the tool's regex expects). AIDA-02 is genuinely complete per its full acceptance text ("shared inbox with saved views... plus filter and full-text search") but the tool can't record it; noted here for a future REQUIREMENTS.md restructuring pass.
- **`gsd-tools state update-progress` / `roadmap update-plan-progress` timing** — both tools compute progress by scanning `SUMMARY.md` files on disk, so they under-report by one plan until *after* this file exists; STATE.md's body `Progress:` line and frontmatter `completed_plans` were hand-edited (per the standing workaround documented in STATE.md's Key Decisions since 02-05) rather than trusted from the tool's "updated: true" response.

## Issues Encountered

**Worktree was behind master (Waves 1+2 not yet merged in).** Per the prompt's note, this worktree was still at the pre-Wave-3 commit (missing 02-01 through 02-07's schema/scopedDb/chip-vocabulary/settings work). Fast-forwarded (`git merge master --ff-only`, `9995d6e` -> `a27ff9b`, a strict ancestor relationship — safe fast-forward, no rebase/merge-conflict risk) before starting, then ran `pnpm install` and `pnpm prisma generate` (with a local `.env` copied from `.env.example` — Node 20 default in this shell still satisfies `prisma generate`'s actual requirement, which is just a resolvable `DATABASE_URL` string, not a live DB connection or the `>=22` engine warning being silenced).

## User Setup Required

None — no external service configuration required for this plan's scope.

## Next Phase Readiness

- Plan 09 (reading pane) can render `<TicketListPanel searchParams={...} selectedId={id} basePath="/tickets/[id]"/>` on the left of its own `/tickets/[id]/page.tsx` to keep the list visible while a ticket is open, exactly as this plan's layout/panel split was designed to support.
- Plan 09 must also implement the "+ Add tag" ticket-level tag editor and the `CustomFieldInput`-backed per-ticket custom-field value editor to finish AIDA-05 (this plan only shipped the *filter* half).
- `searchTickets`, the chip vocabulary, and `CustomFieldDefinition` reads are all now proven consumed end-to-end by a real UI surface (not just unit-tested in isolation) — no blockers for Wave 3's remaining plans (02-10 contacts, 02-11 public intake) or Wave 4 (02-09).

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 8 created/modified files and all 3 task commit hashes (`fac955f`, `059d5c6`, `bb620f2`) verified present on disk / in git history.
