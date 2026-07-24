---
phase: 06-aida-insight
plan: 05
subsystem: api
tags: [nextjs, prisma, public-route, csat, honeypot, rate-limit]

# Dependency graph
requires:
  - phase: 06-aida-insight (06-01)
    provides: CsatResponse model (organizationId, ticketId unique, score, comment) + migration
provides:
  - "POST /api/public/status/[token]/csat — RESOLVED/CLOSED-gated, honeypot + rate-limited, upserts one CsatResponse per ticket"
  - "CsatForm client component (1-5 Star rating + optional comment, prefilled from existing response)"
  - "Public status page renders the CSAT form only when ticket.status is RESOLVED or CLOSED"
affects: [06-06, 06-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New public-endpoint rate-limit scope: status-csat"
    - "CsatForm mirrors FollowUpForm's client-state/fetch/router.refresh shape, swapping message-creation for a one-per-ticket upsert"

key-files:
  created:
    - src/app/api/public/status/[token]/csat/route.ts
    - src/app/(public)/status/[token]/csat-form.tsx
  modified:
    - src/app/(public)/status/[token]/page.tsx

key-decisions:
  - "CSAT route mirrors follow-up/route.ts byte-for-byte in structure (token lookup, honeypot, rate-limit, zod, mutate) with the message transaction swapped for a single csatResponse.upsert"
  - "RESOLVED/CLOSED gate enforced server-side in the route (409 not_eligible) AND client-side in page.tsx's conditional render — no path lets a requester submit CSAT on an open ticket"
  - "Star rating buttons are type=button (not a native radio group) tracking plain useState<number|null>, submitted via FormData.set(\"score\", String(score)) — kept structurally identical to the existing FormData-building pattern in follow-up-form.tsx"

patterns-established:
  - "Token-only public feedback form pattern (HoneypotField + text-[Npx] + text-muted-foreground/text-primary/text-destructive, no hardcoded colors or named text sizes) — reusable for any future public capture surface"

requirements-completed: [AIDA-17]

# Metrics
duration: ~20min
completed: 2026-07-25
---

# Phase 06 Plan 05: CSAT Capture Summary

**Public "How did we do?" 1-5 rating + optional comment on the ticket status page, upserted one-per-ticket via a RESOLVED/CLOSED-gated, honeypot- and rate-limit-protected POST route — the sole CSAT data source feeding AIDA Insight's SLA/CSAT aggregate.**

## Performance

- **Duration:** ~20 min (including a worktree fast-forward-merge to pick up Phase 6 planning docs + Wave 1 output that were missing from this agent's stale worktree branch)
- **Completed:** 2026-07-25T00:48:00+07:00
- **Tasks:** 2/2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `POST /api/public/status/[token]/csat` — bare-`prisma` bearer-token lookup, honeypot (`company_website`), `checkRateLimit("status-csat", ip)`, zod-validated `score` (int 1-5) + optional `comment` (max 2000 chars), gated on `ticket.status ∈ {RESOLVED, CLOSED}` (409 otherwise), `prisma.csatResponse.upsert` keyed on `{ ticketId }`
- `CsatForm` client component: five `type="button"` Star-icon rating controls (`fill-primary`/`text-primary` when selected, `text-muted-foreground` otherwise), an optional `Textarea` comment, prefilled from `existingScore`/`existingComment`, posts a `FormData` to the new route, shows a token-only "Thanks for your feedback!" confirmation on success
- `status/[token]/page.tsx` now includes the `csatResponse` relation and renders `<CsatForm>` only inside a `ticket.status === "RESOLVED" || ticket.status === "CLOSED"` guard, directly under the existing follow-up form block

## Task Commits

Each task was committed atomically:

1. **Task 1: CSAT POST route (csat/route.ts)** - `f010929` (feat)
2. **Task 2: CSAT rating form (csat-form.tsx) + wire into the status page** - `67bc3b5` (feat)

**Plan metadata:** (this commit) - docs: complete plan

## Files Created/Modified
- `src/app/api/public/status/[token]/csat/route.ts` - Public POST endpoint: token lookup, RESOLVED/CLOSED gate, honeypot, `status-csat` rate limit, zod validation, `csatResponse.upsert`
- `src/app/(public)/status/[token]/csat-form.tsx` - Client Component: 1-5 Star rating + optional comment, prefilled, posts to the new route
- `src/app/(public)/status/[token]/page.tsx` - Added `csatResponse: true` to the ticket include; renders `<CsatForm>` gated on RESOLVED/CLOSED

## Decisions Made
- Followed the plan's literal route/form code closely (it explicitly mirrors the existing follow-up route/form templates); no architectural deviations.
- Used `lucide-react`'s `Star` icon for the 1-5 rating control (already a project dependency via `follow-up-form.tsx`'s `Paperclip`/`Loader2` usage) rather than plain numbered buttons — stays token-only (`fill-primary`/`text-primary`/`text-muted-foreground`) and matches the plan's "star icons via lucide Star" option.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fast-forwarded this agent's stale worktree branch to master**
- **Found during:** Task setup (before Task 1) — reading `.planning/phases/06-aida-insight/06-05-PLAN.md` succeeded (repo-wide Read access) but writing/building inside the assigned worktree failed because the worktree's own branch (`worktree-agent-abd0389333c508443`) was still at commit `3fe2e2d` (Phase 5 head), missing all of Phase 6's planning docs, the `06-01` data-foundation code (CsatResponse model + migration), and `node_modules`/generated Prisma client.
- **Issue:** This is the same stale-worktree class of problem documented in STATE.md's 03-05 decision — a parallel-execution worktree assigned before `master` had advanced past its creation point.
- **Fix:** Confirmed `HEAD` was a fast-forward ancestor of local `master` (`git merge-base --is-ancestor`), ran `git merge --ff-only master` (clean, no conflicts), then bootstrapped the worktree: `cp .env.example .env`, `pnpm install`, `pnpm prisma generate`.
- **Files modified:** None beyond the fast-forward itself (brought in `.planning/phases/06-aida-insight/*`, `prisma/schema.prisma`, `prisma/migrations/20260724171144_insight_aida/`, `src/lib/insight/types.ts`, `src/lib/scoped-db.ts`, `src/lib/audit/record-audit-event.ts`, `src/components/tickets/ai-activity-section.tsx` — all pre-existing Wave 1 (06-01) commits, not new work by this plan).
- **Verification:** `git log --oneline -5` post-merge shows `master`'s Phase 6 commits; `pnpm exec tsc --noEmit` and `pnpm run build` both succeeded afterward.
- **Committed in:** Not a separate commit — this was a branch fast-forward (`git merge --ff-only`), not a working-tree change; no new commit was created for it.

---

**Total deviations:** 1 auto-fixed (1 blocking — stale worktree branch, same root cause as the 03-05 precedent already documented in STATE.md)
**Impact on plan:** No scope creep; this was purely an environment/branch-sync fix required before any task could be attempted. Both planned tasks were then executed exactly as written.

## Issues Encountered
- `pnpm exec biome check` returns exit code 1 with `Lint: No issues found` for every file tested, including a pre-existing baseline file (`follow-up/route.ts`) that has no known issues — confirmed this is an environment/wrapper quirk (likely the `rtk` hook) rather than a real lint failure, since the exit code is identical for known-good and new files and the reported message is clean in both cases.

## Next Phase Readiness
- AIDA-17's SLA/CSAT insight aggregate (06-03, 06-06/06-07) now has a real data source: `CsatResponse` rows are created/updated by this plan's route whenever a requester rates a RESOLVED/CLOSED ticket.
- No blockers for the remaining Wave 2 plans (06-02, 06-03, 06-04) or Wave 3/4 (06-06, 06-07) — this plan's files are fully self-contained (no shared file conflicts with the other Wave 2 plans per the phase plan's file-ownership split).

---
*Phase: 06-aida-insight*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: `src/app/api/public/status/[token]/csat/route.ts`
- FOUND: `src/app/(public)/status/[token]/csat-form.tsx`
- FOUND: `src/app/(public)/status/[token]/page.tsx`
- FOUND commit: `f010929`
- FOUND commit: `67bc3b5`
