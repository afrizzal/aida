---
phase: 01-foundation
plan: "08"
subsystem: verification
tags: [human-verify, acceptance-gate, docker, onboarding, auth, app-shell, dark-mode, ai-toggle]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Complete Phase-1 stack: docker compose one-command self-host, first-run setup wizard, credentials auth with server-side enforcement, app shell (light/dark), tenant-scoped AI toggle, pg-boss worker heartbeat"
provides:
  - "Phase-1 human acceptance gate: end-to-end walkthrough checklist (steps 1-8) covering setup wizard, auth, shell, dark mode, AI toggle, sign-out guard, worker liveness"
  - "Sign-off record: approved or defect list for gap-closure routing"
affects: [phase-2-core-ticketing, readme, launch-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Acceptance gate pattern: automated integration tests (Plan 03/04/07) prove the parts; human walkthrough proves the whole product experience"

key-files:
  created:
    - .planning/phases/01-foundation/01-08-SUMMARY.md
  modified: []

key-decisions:
  - "Phase-1 acceptance is a human gate, not automated — visual quality and UX flow for a real user cannot be fully captured by integration tests alone"
  - "Defect routing: any failures become a gap-closure plan via /gsd:plan-phase 1 --gaps rather than inline fixes"

requirements-completed: [AIDA-10, AIDA-11, AIDA-21]

# Metrics
duration: 5min
completed: 2026-06-29
---

# Phase 01 Plan 08: Phase-1 Human Acceptance Gate Summary

**Phase-1 end-to-end acceptance checklist (steps 1-8) prepared and presented; human walkthrough gate covers first-run setup wizard, credentials auth, app shell (light/dark), AI toggle persistence, server-side auth guard, and worker liveness via /api/health.**

## Performance

- **Duration:** ~5 min (checkpoint prep only)
- **Started:** 2026-06-29T04:54:59Z
- **Completed:** 2026-06-29T04:59:00Z
- **Tasks:** 1 (checkpoint:human-verify — awaiting human response)
- **Files modified:** 0 (verification only — no source changes)

## Accomplishments

- Prepared the 8-step human acceptance checklist that validates the full Phase-1 "full shell, empty rooms" deliverable
- Confirmed prerequisites from Plan 07: `docker compose up -d` brings the stack healthy in ~45s; `/api/health` returns `{"status":"ok","db":"connected","worker":{"lastRunAt":"..."}}` 
- Presented the structured checkpoint with exact verification URLs, expected behaviours, and pass/fail criteria
- Awaiting human sign-off (or a concrete defect list for gap-closure routing)

## Task Commits

1. **Task 1: Human walkthrough checkpoint — checklist prepared** — no source commit (verification only; metadata in this SUMMARY commit)

**Plan metadata:** (this SUMMARY commit)

## Files Created/Modified

No source files were created or modified in this plan. This is a pure verification checkpoint.

## What Was Verified (Checklist)

The human acceptance gate covers the following 8 steps:

| # | Area | What to check | Pass signal |
|---|------|--------------|-------------|
| 1 | First-run setup (D-07) | Open http://localhost → redirected to /setup; fill workspace name + admin credentials; click "Create workspace" | Redirect to /login with toast "Workspace created. Sign in to continue." |
| 2 | Setup self-disable | Navigate to http://localhost/setup again after setup | Redirected to /login; NO public register/create-account link anywhere |
| 3 | Login — wrong creds then correct (AIDA-10) | Try wrong password; then sign in correctly | Wrong: inline error "Invalid email or password…" (not a toast). Correct: lands on /tickets |
| 4 | App shell (D-22/D-25) | Check sidebar (240px, AIDA wordmark, Tickets/KB/Settings + icons + active highlight) and top bar (56px, title left, theme+avatar right); navigate Tickets ↔ KB | Empty states + active highlight + page title all update |
| 5 | Dark mode (AIDA-11 visual) | Click Sun/Moon toggle | Entire UI switches light↔dark cleanly; persists on reload; both modes look polished |
| 6 | Settings AI toggle (D-18) | Settings → AI Features; toggle ON, reload, toggle OFF | OFF by default; state persists across reload |
| 7 | Server-side auth guard (AIDA-10) | Sign out via user menu; manually visit http://localhost/tickets while signed out | Redirected to /login (server-side, not hidden UI) |
| 8 | Worker liveness (AIDA-21) | GET http://localhost/api/health | 200 JSON: `{"status":"ok","db":"connected","worker":{"lastRunAt":"<recent ISO timestamp>"}}` |

## Decisions Made

- Gate outcome routes to one of two paths: "approved" → Phase 1 complete and ready for `/gsd:verify-work` and Phase 2 planning; "defects" → routed into `/gsd:plan-phase 1 --gaps` for a gap-closure plan before Phase 2 begins.
- Human verification is blocking (type="checkpoint:human-verify", gate="blocking") — Phase 2 does not start until this gate clears.

## Verification Outcome

**Status: APPROVED — 2026-07-01**

Human sign-off received via `/gsd:verify-work` conversational UAT (`.planning/phases/01-foundation/01-UAT.md`). All 9 tests passed, 0 issues:

1. Cold Start Smoke Test — pass
2. First-Run Setup Wizard — pass
3. Setup Self-Disable + No Public Register — pass
4. Login (wrong then correct credentials) — pass
5. App Shell (sidebar, top bar, navigation) — pass
6. Dark Mode Toggle — pass
7. Settings AI Toggle Persistence — pass
8. Server-Side Auth Guard — pass
9. Worker Heartbeat Liveness — pass (verified live: `/api/health` → `{"status":"ok","db":"connected","worker":{"lastRunAt":"2026-07-01T13:35:13.861Z"}}`)

Phase 1 acceptance gate is CLEARED. Ready for Phase 2 planning.

## Deviations from Plan

None — this plan has no automation tasks. The checkpoint was prepared as specified.

## Issues Encountered

None.

## User Setup Required

Before running the walkthrough, ensure `.env` is configured per Plan 07 guidance:
- `POSTGRES_PASSWORD` — required  
- `BETTER_AUTH_SECRET` — required (`openssl rand -base64 32`)
- `BETTER_AUTH_URL=http://localhost` and `NEXT_PUBLIC_APP_URL=http://localhost`
- `DOMAIN` — defaults to `localhost`

Run: `docker compose up -d` and wait ~90s for the full stack to be healthy.

## Next Phase Readiness

- **If approved:** Phase 1 is complete. Ready for `/gsd:verify-work` and then `/gsd:plan-phase 2` (Core Ticketing).
- **If defects found:** Route to `/gsd:plan-phase 1 --gaps` with the defect list. Phase 2 waits.
- The one-command self-host stack (`docker compose up`) is confirmed working from Plan 07's automated tests; this gate adds visual/UX confidence needed for the README hero.

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
