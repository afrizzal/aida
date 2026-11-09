---
phase: 10-team
plan: 17
subsystem: auth, membership gate, (app) render entries, static inventory
status: complete
tags: [membership, redirect, no-access, requirePageAccess, inventory, typescript-parser, e2e]
requires:
  - "10-02: src/lib/page-access.ts (requirePageAccess), /no-access, tests/support/source-inventory.ts, the membership inventory"
provides:
  - "requirePageAccess as the first statement of the (app) layout, all 18 (app) pages and TicketListPanel"
  - "tests/unit/page-access-inventory.test.ts: Rule B (findPageAccessViolations in tests/support/source-inventory.ts)"
  - "tests/e2e/single-h1.spec.ts and reading-pane.spec.ts: the /no-access redirect for a deleted-row member and a no-workspace user"
affects: [10-13, 10-14]
tech-stack:
  added: []
  patterns:
    - "The page helper is the first awaited statement of every protected render entry, outside any try; its db, orgId, session and role replace getScopedDb and getSessionActor there"
    - "A loader's membership_ended result (the member left between the gate and the read) also redirects to /no-access"
key-files:
  created:
    - tests/unit/page-access-inventory.test.ts
    - .planning/phases/10-team/deferred-items.md
  modified:
    - src/app/(app)/layout.tsx
    - src/app/(app)/tickets/page.tsx
    - src/app/(app)/tickets/[id]/page.tsx
    - src/app/(app)/tickets/ticket-list-panel.tsx
    - src/app/(app)/contacts/page.tsx
    - src/app/(app)/contacts/[id]/page.tsx
    - src/app/(app)/insights/page.tsx
    - src/app/(app)/kb/page.tsx
    - src/app/(app)/kb/[id]/page.tsx
    - src/app/(app)/kb/new/page.tsx
    - src/app/(app)/kb/proposals/page.tsx
    - src/app/(app)/kb/proposals/[id]/page.tsx
    - src/app/(app)/settings/page.tsx
    - src/app/(app)/settings/backups/page.tsx
    - src/app/(app)/settings/branding/page.tsx
    - src/app/(app)/settings/custom-fields/page.tsx
    - src/app/(app)/settings/email/page.tsx
    - src/app/(app)/settings/sla/page.tsx
    - src/app/(app)/settings/statuses/page.tsx
    - src/app/(app)/settings/tags/page.tsx
    - tests/support/source-inventory.ts
    - tests/unit/membership-inventory.test.ts
    - tests/e2e/single-h1.spec.ts
    - tests/e2e/reading-pane.spec.ts
decisions:
  - "A loader that still answers membership_ended after the gate (the member left in between) redirects to /no-access too, instead of an in-page state"
  - "getSessionActor gives way to the helper's actor on the six entries that used it; getOrgRole stays after the helper on branding, sla and backups"
  - "Rule B checks every (app) page and the (app) layout always, and nested layouts and server components only when they reach tenant data"
  - "Rule B lives in tests/support/source-inventory.ts beside Rules A to E, so it reuses the same parser and reach logic"
metrics:
  duration: "about 25 minutes (2026-11-12T20:44Z to 21:08Z)"
  completed: 2026-11-13
  tasks: 3
  files: 25
estimate:
  tokens: 60000
  tasks: 3
actuals:
  tokens: 17300
  tasks: 3
  commits: 5
commits: 5
plan_head_before: 4403f41c37aedb28aec914d517c6d3827c786880
---

# Phase 10 Plan 17: requirePageAccess first in every (app) render entry, Rule B, and the /no-access E2E Summary

The `(app)` layout, all 18 `(app)` pages and `TicketListPanel` now await `requirePageAccess()` as their first statement, outside any `try`. A removed member, a session with no active organization and a never-a-member account all land on `/no-access` from every protected page, before any organization, branding, logo, saved-view or tenant read. Rule B (`tests/unit/page-access-inventory.test.ts`) fails the unit suite when a page, the layout, or a tenant-reaching server component under `src/app/(app)` does not start with the helper, calls it inside a `try`, or imports or calls `getScopedDb`. It also fails when the number of pages found on disk differs from the number checked.

## What was built

- **`src/app/(app)/layout.tsx`**: `const { session, orgId, db } = await requirePageAccess()` is the first statement. The organization read uses `orgId`. Branding and logo use the helper's `db`. Saved views use the helper's session. The no-workspace fallback ("No workspace found…", sr-only "Workspace not found") is gone, and so are the `requireSession` and `scopedDb` imports.
- **Task 1 entries**:
  - `tickets/page.tsx`: `await requirePageAccess()` first.
  - `tickets/[id]/page.tsx`: the helper's `session`, `orgId`, `role` and `db`. The actor is built from the session. `isAdmin` uses the helper's conservative role, and the AI setting is read through the helper's `db`.
  - `ticket-list-panel.tsx`: the helper's `session`, `orgId` and `db`. Its `membershipActive` handling is unchanged.
  - `contacts/page.tsx`: the helper's `db`.
  - `contacts/[id]/page.tsx`: the helper's session and orgId as the actor.
  - The in-page "Your access to this workspace has ended." `EmptyState` of `tickets/[id]` and `contacts/[id]` is replaced by `redirect("/no-access")`. It fires when the loader still reports `membership_ended`, which can only happen if the member left between the gate and the loader. The not-found branches are unchanged.
- **Task 2 entries (14 pages)**: in each page the helper is the first statement. `getScopedDb` gives way to the helper's `db`, `orgId` and `session`. `kb/new` became `async` so it can await the helper. The `e2eFault` calls now come right after the helper (tickets, tickets/[id], ticket-list-panel, contacts, contacts/[id], kb, settings/backups).
- **Allowlist entries removed** from `tests/unit/membership-inventory.test.ts`: Rule A `src/app/(app)/layout.tsx#AppLayout`, Rule C `src/app/(app)/layout.tsx#AppLayout` and Rule A `src/app/(app)/settings/backups/page.tsx#BackupsSettingsPage`, plus the now-unused `PRE_10_17` constant. Each entry would otherwise have failed hygiene ("suppresses no finding"). The inventory, including Rule E, still passes: 43 cases.

### Pages that keep a second gate call after the helper

| Page | Call kept after `requirePageAccess` |
|---|---|
| `src/app/(app)/settings/branding/page.tsx` | `getOrgRole()` (shows or hides the admin controls) |
| `src/app/(app)/settings/sla/page.tsx` | `getOrgRole()` |
| `src/app/(app)/settings/backups/page.tsx` | `getOrgRole()` (the backup record is read only for owners and admins) |

There are no `getActiveOrgAccess` or `requireOrgAdminScope` calls in any page. `kb/page.tsx` keeps its `findConservativeMembership` read for the Proposals link (a membership read, not a gate call). These loaders still check membership themselves after the helper: `loadTicketDetailData`, `loadContactDetailData`, `loadTicketListPanelData`, `loadProposalList`, `loadProposalReview`, `listStatesForSettings` and `listSavedViewsForViewer`.

## Rule B (as checked)

`findPageAccessViolations(rules, sources)` in `tests/support/source-inventory.ts`, with rules `{ appPrefix: "src/app/(app)/", rootLayout: "src/app/(app)/layout.tsx", helper: requirePageAccess@src/lib/page-access.ts, forbidden: [getScopedDb@src/lib/session.ts] }`:

- **Judged**:
  - every `page.tsx` under the prefix, read from the file system by `readSourceTree`;
  - the root layout, always (its absence is a violation);
  - nested `layout.tsx` files, and every exported function of a server-component `.tsx` module (not `"use client"`, not `"use server"`), when they reach tenant data. "Reach" means the function, or a same-module function it calls, references a binding of a src/lib module for which `Project.libReaches` holds, or calls `scopedDb(` or raw SQL.
- **Per entry**:
  - the first statement of the body is `await requirePageAccess()`, either as a single declaration's initializer or as an expression statement. The callee must be imported from `src/lib/page-access.ts`; a same-named local helper does not count.
  - No call to the helper sits inside a `try`, `catch` or `finally`.
  - The module neither imports nor calls `getScopedDb`, aliases included (one finding per module).
- **Count check**: the pages found must equal the pages checked. A page whose default export the parser cannot read, for example `export default wrap(...)`, is a violation, not a silent skip.
- **Real tree**: 20 entries are judged, the 18 pages plus `layout src/app/(app)/layout.tsx#AppLayout` plus `component src/app/(app)/tickets/ticket-list-panel.tsx#TicketListPanel`. The result is 0 violations, with 18 pages found and 18 checked. `settings/layout.tsx` and `tickets/layout.tsx` read no tenant data and are not judged.
- **Cases** (22): 2 controls; 13 violation fixtures covering getScopedDb, getScopedDb after the helper or aliased, a try, a later try, another await first, params first, a sync page, a foreign same-named helper, default- and named-export components, a nested layout, the root layout, an unreadable default export and a missing root layout; 5 real-tree checks, including a real page put back on `getScopedDb`, which is flagged.

## Verification

Every Docker step ran with `AIDA_TEST_RUN_ID=mwe0khq1-ea5a968b4fe52746`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. `colima status` and `docker info` exited 0 before the first Docker step of Task 1 and of Task 3.

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` (Task 1, Task 2, Task 3, final) | 0 each | clean |
| `pnpm test:integration tests/integration/membership-gate.test.ts` (Task 1) | 0 | 1 file, 25 passed |
| `pnpm exec vitest run tests/unit/membership-inventory.test.ts` (Task 1, before removing the layout entries) | 1 | 1 failed, 42 passed: hygiene, the two layout entries "suppresses no finding" (expected) |
| same, after removing them (Task 1, Task 2) | 0, 0 | 43 passed each |
| `pnpm lint` (Task 2, Task 3, final) | 0 each | 710 and 711 files, 1 warning each, pre-existing at `tests/unit/container-config.test.ts:160` (not touched) |
| RED: `pnpm exec vitest run tests/unit/page-access-inventory.test.ts` with the typed stub (`--reporter=tap-flat`) | 1 | 17 failed, 4 passed, all on assertions. `gsd-tools check tdd-red-evidence` gave `RED_EVIDENCE_OK` (target: "flags a page that calls getScopedDb"). Vitest's TAP output has no node:test summary, so the `# tests/pass/fail` lines were counted from its `ok` and `not ok` lines and appended to the record. |
| GREEN: same file | 0 | 21 passed (22 after the real-tree mutation case) |
| `pnpm test tests/unit/page-access-inventory.test.ts tests/unit/membership-inventory.test.ts` (the script runs all of `tests/unit`) | 0 | 105 files, 1869 passed (twice: after Task 3 GREEN and at the end) |
| `pnpm test:e2e tests/e2e/single-h1.spec.ts` | 0 | 9 passed (43.4s). The server log shows 307s from the protected routes and 26 `GET /no-access 200`. |
| `pnpm test:e2e tests/e2e/reading-pane.spec.ts` | 0 | 3 passed |
| `pnpm test:integration tests/integration/kb-proposal-entry-flags.test.ts tests/integration/membership-gate.test.ts` (the entry-flags test calls TicketDetailPage and TicketListPanel directly) | 0 | 2 files, 31 passed |
| `pnpm test:e2e` (full suite, regression, beyond the plan) | 1 | 242 passed, 4 failed, 1 skipped, 15 did not run (7.0m). See "Deferred issues". |

The E2E global setup did not stall at `/setup` on any run, so `.next` was not moved.

Acceptance greps:
- `requirePageAccess` appears 2 times in each of the six Task 1 files.
- "Your access to this workspace has ended" appears 0 times in `tickets/[id]/page.tsx` and in `contacts/[id]/page.tsx`. "No workspace found" appears 0 times in the layout.
- `getScopedDb` appears 0 times in `ticket-list-panel.tsx` and in `contacts/page.tsx`.
- `git grep -L "requirePageAccess" -- 'src/app/(app)/**/page.tsx'` prints nothing.
- `git grep -l "getScopedDb" -- 'src/app/(app)/**/page.tsx' 'src/app/(app)/layout.tsx' 'src/app/(app)/tickets/ticket-list-panel.tsx'` prints nothing.
- In the new test, `requirePageAccess` and `getScopedDb` each appear at least once.
- `/no-access` appears 11 times in `single-h1.spec.ts`.
- `git diff --stat -- package.json pnpm-lock.yaml` prints nothing, and there is no schema or migration change.

## Prohibition

AIDA-43 safety ("MUST NOT render any tenant data, workspace name or branding of an organization to a session that is no longer a member of it"): verified by test.
- The layout's helper runs before the organization, branding and logo reads. Each page and TicketListPanel runs its own helper first, because the layout and the page render in parallel (C6).
- In the browser, a member whose row was deleted is redirected to `/no-access` from all 18 `(app)` routes. The no-workspace user is redirected from six routes and at sign-in.
- The reading-pane case asserts that the response the browser ends on holds no ticket subject, message text or roster name.
- Rule B keeps the property for new pages.
- D-08 still stands: the redirect is not authorization. Server actions and API routes keep their own membership checks, which the membership inventory judges.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug caused by this plan] `reading-pane.spec.ts` asserted the removed in-page state**
- **Found during:** Task 3
- **Issue:** "A member whose row was deleted … cannot read a known ticket" expected the "Your access to this workspace has ended." heading on `/tickets/[id]`. V-27 replaces that state with the redirect.
- **Fix:** it now expects `/no-access`, its h1 and its Sign out button. A redirect hop must answer with a 3xx status. The no-ticket-data assertions are kept on the final response. It polls past a first-hit 404, and the product is unchanged.
- **Files modified:** `tests/e2e/reading-pane.spec.ts` (outside the plan's file list)
- **Commit:** f8f5e5b

**2. [Rule 3 - Blocking] The membership inventory's temporary allowlist entries**
- After the wiring they suppress nothing and would fail hygiene, so I removed them in the task that made them unused: the layout's A and C entries in Task 1, the backups A entry in Task 2. `tests/unit/membership-inventory.test.ts` is not in the plan's list, but the dispatch asked for this.
- **Commits:** 06c705d, 8820248

### Interpretations

**3. The in-page branches became a redirect, not a bare removal.** `loadTicketDetailData` and `loadContactDetailData` still return `membership_ended` when the member is removed between the gate and the loader. Deleting the branch would not typecheck, and leaving it would keep an in-page state. `redirect("/no-access")` gives the same behaviour as the helper, outside any `try`.

**4. getSessionActor gives way to the helper's actor.** The plan's "keep after the helper" list names only `getActiveOrgAccess`, `requireOrgAdminScope` and `getOrgRole`. The six entries that called `getSessionActor` now build `{ userId: session.user.id, orgId }` from the helper: tickets/[id], contacts/[id], ticket-list-panel, kb/proposals, kb/proposals/[id] and settings/statuses. This saves a second fresh session read and loses no check, because each loader reads membership itself. On `tickets/[id]`, `isAdmin` uses the helper's role, which is the same `findConservativeMembership` read, instead of a second read of it.

**5. `e2eFault` moved from first to second position** in the seven files that call it. The plan says "stay where they are, after the helper". The helper must be the first awaited statement, so the fault call moved one statement down. The single-h1 error and loading cases pass.

**6. Rule B's logic is in `tests/support/source-inventory.ts`** (key_link: "entry-function and first-statement helpers"), not inside the test file. That file is not in the plan's list.

**7. Nested layouts.** The must-have reads "a page.tsx or layout.tsx under src/app/(app) … does not call requirePageAccess". Rule B always judges the 18 pages and the `(app)` layout. It judges `settings/layout.tsx` and `tickets/layout.tsx` only if they reach tenant data. Today they read nothing (a nav and a selection provider), and their parent layout and every child page are gated. A fixture proves that a nested layout which reaches tenant data is flagged.

**8. No-access assertions in single-h1.** `/no-access` is an `(auth)` page with no `<main>`, so its rows assert:
- the final URL;
- exactly one `h1` in the document, with the no-access title;
- that the `h1` is the first heading.

They do not assert `main h1`. The deleted-row member opens all 18 routes, not only the six of the old case. The no-workspace user opens six routes. The sign-in helper now waits for `/no-access` for that user, because the login form's push to `/tickets` is redirected.

## Deferred Issues

Also in `.planning/phases/10-team/deferred-items.md`:

- **Full E2E: 4 failures after a refused server action** (not caused by this plan): `bulk-actions.spec.ts:242` and `:518`, `snooze.spec.ts:209`, `ticket-statuses.spec.ts:331`.
  - In the trace of `:242`, the refused POST answers with `Set-Cookie: better-auth.session_data=…` and `x-action-revalidated: 1`.
  - 10-02's `readFreshSession` (`disableCookieCache`) rewrites the cookie cache inside every server action, and Next re-renders the route when an action sets a cookie. The re-rendered list drops the deleted or closed row, which prunes the selection and its alert, or removes the focused row.
  - 10-17 changed no server action or session read.
  - No E2E run of these specs exists between 10-02 and 10-17, so I did not prove this by a run at 4403f41. The attribution rests on the trace headers.
  - Recorded as failed, never as passed. It needs an orchestrator decision.
- `/no-access` is not yet in `tests/e2e/csp.spec.ts`'s route list (V-01, V-27). No Phase 10 plan names that edit.
- `/no-access` has no `<main>` landmark (the `(auth)` layout has none).

## Manual items (left open)

None of these was performed or is claimed: the screen-reader check of `/no-access`; the visual and dark-mode check of `/no-access` and the DS §9 checklist (10-14).

## Known Stubs

None. The RED stub of `findPageAccessViolations` was replaced in fc86dd3.

## Threat Flags

None. No new endpoint or data path. Every changed entry now refuses earlier.

## Ledger rows applied

- V-27 (settles V-18; rewrites C6): the helper is first in the layout and in every page and tenant-reading server component, outside any try. The in-page states and the layout fallback give way to the redirect, and single-h1 is updated.
- V-18 / D36: all 18 pages, not 13. Rule B checks the count.
- C6 (still binding): Rule B enforces the helper on every protected render entry.
- D-08: the redirect is not authorization; the actions and routes are unchanged.

## Self-Check: PASSED

- FOUND: tests/unit/page-access-inventory.test.ts, src/app/(app)/layout.tsx, tests/support/source-inventory.ts, tests/e2e/single-h1.spec.ts, tests/e2e/reading-pane.spec.ts, .planning/phases/10-team/deferred-items.md
- FOUND commits: 06c705d, 8820248, 1ed5242, fc86dd3, f8f5e5b
