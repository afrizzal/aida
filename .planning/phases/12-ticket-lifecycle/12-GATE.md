# Phase 12 (Ticket Lifecycle): Phase gate

Plan 12-09. Run on 2026-11-08 between 15:39 and 15:51 UTC on the Mac workspace, without a human. The gate ran three times. Attempts 1 and 2 found problems (one red result, then one evidence gap), both fixed in their own commits. Attempt 3 is the result of record. All three are listed below.

- **Tested commit (attempt 3, of record):** `7c3bad3bbb99523eda595f052eb2ed31163c78cd` (`test(12-09): prove removeRelation refuses a removed member`). Later commits that touch only `.planning/` keep these results valid (ROADMAP gate rules).
- **Phase base commit:** `03145e6c72f5038cae700cd7fe6f17aa14893b2e` (`docs(run-loop): start Phase 12 execution (round 45)`), the parent of `a75c12a`, the first commit whose message contains "(12-01)".
- **How it ran:** one command at a time, in table order. Each command wrote to its own log under `$TMPDIR` (`aida-12-09-gate{,2,3}-*.log`, outside the repo). Each exit code came from the command itself, never through a pipe. `pgrep -f 'artisan test'` found nothing before every command. The Testcontainers, E2E and build commands ran with `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`.
- **Containers:** the run did not create, start, stop or remove any container by hand. The Testcontainers suites start and remove their own throwaway Postgres containers. No compose stack was started.

## Gate table (attempt 3, on `7c3bad3`)

| # | Command | State | Exit / reason | Log summary | Commit |
|---|---------|-------|---------------|-------------|--------|
| 1 | `pnpm lint` | passed | 0 | biome: 387 files checked, no fixes | `7c3bad3` |
| 2 | `pnpm typecheck` | passed | 0 | `tsc --noEmit` printed no error (0 `error TS` lines) | `7c3bad3` |
| 3 | `pnpm test` | passed | 0 | 27 files, 268 tests passed, 0 failed (includes `tests/unit/design-tokens.test.ts`) | `7c3bad3` |
| 4 | `pnpm test:integration` (as-is) | blocked (O-1) | not run: its `include` covers `tests/integration/egress-isolation.test.ts`, which starts the compose project `aida-egress-test`, a real compose stack (D-22, owner item O-1, run-loop K26) | none; not claimed as passed | `7c3bad3` |
| 4a | `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration --exclude tests/integration/egress-isolation.test.ts --reporter=verbose` (= `vitest run --config vitest.integration.config.ts --exclude tests/integration/egress-isolation.test.ts --reporter=verbose`; supplementary row for 4) | passed | 0 | 32 files passed (32), 270 tests passed (270), 0 failed, 0 skipped. The string `egress-isolation` appears once in the verbose log, on line 3, which is the echoed command; no test line names it. Phase 12 files that ran, with passed counts: lifecycle-schema 16, ticket-relations 22, ticket-picker 8, ticket-merge 36, merge-provenance 6, merge-reply-race 11, merge-race-coverage 10, snooze 10, snooze-race 4, activity-feed 5 | `7c3bad3` |
| 5 | `pnpm test:egress` | blocked (O-1) | not run: `vitest.egress.config.ts` drives the compose project `aida-egress-test`, a real compose stack (D-22, owner item O-1, run-loop K26) | none; not claimed as passed | `7c3bad3` |
| 6 | `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:e2e` (full suite) | passed | 0 | 140 passed, 1 skipped, 0 failed, 0 flaky, in 3.5 min over 24 specs. Phase 12 specs: ticket-relations 4/4, ticket-merge 5/5, snooze 8/8, activity-feed 2/2. Regression specs over surfaces Phase 12 changed: public-status 3/3, inbox 6/6, reading-pane 3/3, saved-views 10/10, keyboard 19/19, auto-close 4/4. a11y-contrast 8/8. honesty-invariants 2/2 in this run. The skip is the existing `uat-gaps.spec.ts:17` case "a zero-ticket workspace shows the 'Your inbox is empty' state", skipped in the spec itself before Phase 11. The log shows `/bin/sh: taskkill: command not found` 3 times (the Windows-only teardown); it did not fail the run | `7c3bad3` |
| 7 | `pnpm build` | passed | 0 | Next.js (Turbopack) compiled; 1 warning: the known "unexpected file in NFT list" trace through `./src/lib/attachments/local-file-storage.ts` (not a Phase 12 file, present since v1). No `.next` deletion was needed | `7c3bad3` |
| 8 | `pnpm audit --prod` | failed | 1 | 141 vulnerabilities: 7 critical, 52 high, 69 moderate, 13 low. The advisory service answered | `7c3bad3` |

Rows 4 and 5 are blocked, not passed. Row 8 stays red.

### Earlier attempts (kept, not overwritten)

| Attempt | Commit | Result | What happened |
|---------|--------|--------|---------------|
| Task 1 E2E | `4ddc430` | passed, exit 0 | `pnpm test:e2e tests/e2e/ticket-relations.spec.ts tests/e2e/ticket-merge.spec.ts tests/e2e/snooze.spec.ts tests/e2e/activity-feed.spec.ts tests/e2e/public-status.spec.ts` in one process: 22 passed (relations 4, merge 5, snooze 8, activity-feed 2, public-status 3), 0 failed, 0 flaky |
| 1 | `4ddc430` | **red** at row 4a | lint 0 (387 files), typecheck 0, test 0 (27 files, 268 tests). Row 4a **exit 1**: 31 of 32 files passed, 268 passed, **1 failed**: `merge-race-coverage.test.ts` case 1b, `AssertionError: expected 1794152369529 to be less than 1794152369528` on `expect(f.createdAt.getTime()).toBeLessThan(source.mergedAt.getTime())`. The gate stopped there |
| 1, cause | — | test bug, not product | Prisma 7 fills a `@default(now())` field from the application (Node) clock when it creates the row (Prisma docs, checked through Context7). `mergedAt` is Postgres `clock_timestamp()` inside the Colima VM. The assertion compared two different clocks. In real time the follow-up inserts after the merge commits, so it passed in 12-10 only because of clock skew. The 12-10 SUMMARY's inference ("createdAt is the transaction start time") was wrong. This failure is not in the flaky list in STATE.md, so it was fixed instead of being rerun as a flake |
| 1, fix | `65d4b7e` | fixed in the test | 1a and 1b now set the stored `createdAt` to 1 ms before `mergedAt` through a helper that asserts the stored value, the same technique 1c already uses. The C1 condition ("createdAt earlier than mergedAt, yet seq decides") now holds by construction instead of through clock skew. Every seq, page and attachment visibility assertion is unchanged. `merge-race-coverage.test.ts` alone: exit 0, 10 passed |
| 2 | `65d4b7e` | all rows as expected | lint 0 (387); typecheck 0; test 0 (27 files, 268); 4a exit 0 (32 files, 269 tests, `egress-isolation` only in the echoed command); e2e exit 0 (140 passed, 1 skipped, 0 failed, 0 flaky, 3.4 min); build 0 (the known NFT warning); audit exit 1 (7 critical, 52 high, 69 moderate, 13 low) |
| 2, gap | `65d4b7e` | evidence gap, not a red result | While building the permission evidence, no test was found for the unlink path's membership refusal. `removeRelation` calls `findActiveMembership` (`src/lib/tickets/relations.ts:295`), but `ticket-relations.test.ts` tested `MEMBERSHIP_ENDED` only for `addRelation` and `listRelationsForTicket` |
| 2, fix | `7c3bad3` | test added | `removeRelation` with a removed member returns `MEMBERSHIP_ENDED`, and the relation and audit counts stay the same. The file alone: exit 0, 22 passed. The whole gate was then rerun as attempt 3 |

### Comparison with the Phase 11 final gate (11-GATE.md, rerun on `47fc015`)

| Item | Phase 11 final | Phase 12 gate (attempt 3) | Worse? |
|------|----------------|---------------------------|--------|
| `pnpm lint` | exit 0, 343 files | exit 0, 387 files | No. More files, all clean |
| `pnpm typecheck` | exit 0 | exit 0 | No |
| `pnpm test` | 23 files, 229 tests | 27 files, 268 tests | No. 39 more tests, 0 failed |
| Integration without egress | 22 files, 142 tests | 32 files, 270 tests | No. 0 failed, 0 skipped |
| `pnpm test:e2e` (full) | 121 passed, 1 skipped, 0 failed | 140 passed, 1 skipped (the same `uat-gaps` case), 0 failed, 0 flaky | No. 19 more passing cases, the same skip, honesty-invariants 2/2 in this run (not claimed fixed) |
| `pnpm build` | exit 0, the known NFT warning | exit 0, the same NFT warning | No |
| `pnpm audit --prod` | exit 1; 7 critical, 52 high, 69 moderate, 13 low | exit 1; 7 critical, 52 high, 69 moderate, 13 low | No. Identical counts. `git diff --stat 03145e6 7c3bad3 -- package.json pnpm-lock.yaml` is empty: Phase 12 added no package |
| `pnpm test:integration` (full), `pnpm test:egress` | blocked (O-1) | blocked (O-1) | Unchanged; still not run |

Phase 12 makes nothing worse than the Phase 11 final gate. Audit stays red at the baseline counts, and rows 4 and 5 stay blocked.

One result was red during the run and is not hidden: attempt 1's row 4a (exit 1, the 1b clock comparison). It was fixed in the test, and attempts 2 and 3 are green on that row.

### Container listings for `aida-egress-test`

Command: `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock docker ps -a --filter label=com.docker.compose.project=aida-egress-test --format '{{.Names}} {{.Status}}'`

| When | Exit | Output |
|------|------|--------|
| Before attempt 1 (15:39:06 UTC) | 0 | empty (0 lines) |
| Before attempt 2 (15:41:21 UTC) | 0 | empty (0 lines) |
| After attempt 2's integration run (spot check) | 0 | empty (0 lines) |
| After attempt 2 (15:45:52 UTC) | 0 | empty (0 lines) |
| Before attempt 3 (15:46:49 UTC) | 0 | empty (0 lines) |
| After attempt 3 (15:51:16 UTC) | 0 | empty (0 lines) |

The gate created and touched no `aida-egress-test` container.

## §9 checklist

DESIGN-SYSTEM §9, answered for Phase 12. Range: base `03145e6` to tested commit `7c3bad3`. "Added lines" means `git diff -U0 03145e6 7c3bad3 -- src ':!src/generated' | grep -E '^\+[^+]'`, which gives 4253 lines over the 45 changed `src` files (25 added, 20 modified). The `src` diff is the same at `65d4b7e` and `7c3bad3`, because the two fix commits touch only `tests/`. Each grep below exited 1 (no match) on those lines. As a control, the same patterns do match elsewhere in `src`: 70 `oklch(` hits in `.css` and `.tsx` files, 41 named text sizes in `src/components/ui`, and 9 files using `EmptyState`. So the empty results do not come from a broken pattern.

| §9 question | Answer | Evidence |
|-------------|--------|----------|
| All new tokens in `globals.css`, nothing hardcoded? | Yes, from code | Phase 12 adds no token: `git diff --stat 03145e6 7c3bad3 -- src/app/globals.css` is empty. The added lines contain no `oklch(`, no hex literal (`#[0-9a-fA-F]{3,8}`), no `rgb(`/`rgba(`/`hsl(`, no Tailwind palette colour class (`bg-red-500`, `text-indigo-…`, `bg-white`, `text-black` and the like) and no `dark:` class. `pnpm test` (gate row 3) includes `tests/unit/design-tokens.test.ts`, which passed |
| Empty state uses halo + icon box? | Yes, from code: no new page empty state | The added lines contain no `EmptyState` and no `min-h-[60vh]`. The feed's empty line, the snoozed-list empty line and the picker's start and no-match lines are section lines, not page empty states (UI-SPEC "Design checklist hooks", the same reasoning Phase 11 used) |
| Sidebar uses `sidebar-*` tokens? | Yes, from code: unchanged | `git diff --name-only 03145e6 7c3bad3 -- src/components/sidebar.tsx src/components/sidebar-views.tsx src/components/top-bar.tsx` lists 0 files. No changed `src` path contains `sidebar` or `layout` |
| Top bar sticky + backdrop-blur? | Yes for sticky and blur, from code. One pre-existing difference is reported, not fixed | The ticket top bar is `src/components/tickets/ticket-meta-header.tsx` line 315: `sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur-sm`. Phase 12 changes no line containing `sticky` (grep of the file's diff: 0 lines). It added only the snooze slot and the actions menu inside the bar (36 added lines, 1 removed, all in props and children). **Difference:** the bar uses `border-border`, not the DS `border-border/70` that the plan asked to confirm. The line is the same at the base (`git show 03145e6:…`, line 294) and dates from commit `2d65bbc` (2026-07-02, v1). Phase 12 did not introduce it and did not change it. It is listed as an open item. The app top bar `src/components/top-bar.tsx` line 54 carries `sticky top-0 z-10 … border-border/70 … backdrop-blur-sm` and is unchanged |
| Auth pages do not wrap themselves? | Yes, from code: untouched | `git diff --name-only 03145e6 7c3bad3 -- 'src/app/(auth)'` lists 0 files |
| Typography uses explicit `text-[Npx]`? | Yes for Phase 12's own lines, from code | The added lines contain no `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl` or `text-[2-9]xl`. The shadcn primitives in `src/components/ui` are unchanged since the base and keep their own named sizes. The places where a new surface inherits a primitive's named size were not audited one by one |
| Dark mode tested? | open (human) | Not claimed. What exists as evidence: token-only colours (above), and `design-tokens.test.ts` passed. `a11y-contrast.spec.ts` (8 cases in gate row 6) covers `/kb`, `/kb/new`, `/kb/[id]` and the ticket page with a draft card. It covers none of the new Phase 12 surfaces: relation chips, the link and merge dialogs, the warning callout, the merged banner, the snooze popover and chip, the Snoozed toggle, the feed event rows, the public merged notice. Their look in dark mode (DESIGN-SYSTEM §7) waits for a human |
| `tsc --noEmit` clean? | Yes | Gate row 2: `pnpm typecheck` exit 0 on `7c3bad3` |

## Security greps

Same range and the same added lines as §9.

| Check | Result | Evidence |
|-------|--------|----------|
| No new egress (D-21) | Yes | `src/lib/llm/`, `docs/SECURITY.md`, `tests/integration/egress-isolation.test.ts` and `vitest.egress.config.ts` are unchanged (`git diff --name-only 03145e6 7c3bad3 -- …` lists 0 files), so no new entry in the egress test or in `docs/SECURITY.md` was needed. A grep of the added lines for `fetch(`, `nodemailer` and `http://`/`https://` finds 1 line: the browser `fetch` to the app's own `/api/tickets/picker` in `src/components/tickets/ticket-picker.tsx`, a same-origin call that is not egress. `package.json` and `pnpm-lock.yaml` are unchanged (no new package). `src/proxy.ts` is unchanged |
| No inline script (D-21) | Yes | The added lines contain no `<script`, no `next/script` and no `dangerouslySetInnerHTML` (grep exit 1) |
| No AI call (D-21) | Yes | The added lines contain no `lib/llm` (grep exit 1). Nothing in Phase 12 imports the LLM layer |

## Permission and privacy (open axes, covered by tests)

Every new server path refuses a removed member (D-01, D-20). Each refusal is a Testcontainers test in gate row 4a on `7c3bad3`, unmocked, in which the member row is deleted before the call:

| Path | Test (file > case) |
|------|--------------------|
| Picker service and route | `ticket-picker.test.ts` > "refuses MEMBERSHIP_ENDED without searching …" and > "GET /api/tickets/picker … 403 after the member row is deleted" |
| Link | `ticket-relations.test.ts` > "addRelation: refusals change nothing > MEMBERSHIP_ENDED when the actor's member row was deleted" (the same case also covers `listRelationsForTicket`) |
| Unlink | `ticket-relations.test.ts` > "removeRelation > MEMBERSHIP_ENDED when the actor's member row was deleted, and the link and its audit stay" (added in this plan, commit `7c3bad3`) |
| Merge | `ticket-merge.test.ts` > "MEMBERSHIP_ENDED for an unmerged source after the member row was deleted (review C3)" and > "MEMBERSHIP_ENDED, never SOURCE_MERGED, for an already merged source (review C3)" |
| Snooze and wake | `snooze.test.ts` > "snooze refusals (D-12) > refuses another organization's ticket, an unknown id, an ended membership and NOT_SNOOZED" (`snoozeTicket` and `wakeTicket`, lines 300-315). The tests call the service, not the server action (12-05 deviation 5) |
| Feed loader | `activity-feed.test.ts` > "refuses a removed member viewing the page (membership_ended, no feed)"; `ticket-detail-data.test.ts` > "a member whose row was deleted cannot read a known ticket's subject, messages or roster" |

Privacy:

- The picker returns no contact data: `ticket-picker.test.ts` > "rows hold exactly the seven fields …" and the route case "200 with only the seven keys" (12-02).
- The public page of a merged source reveals nothing about the target: `merge-provenance.test.ts` > "the loader for a merged source carries merged true and only the source's own header fields" and > "an empty merged source shows nothing until a new target message is created, never the target's header" (12-04). The E2E case `ticket-merge.spec.ts` > "each status link shows only what D-09 allows after a merge" asserts that neither page shows the target's number, subject, token link or a `/tickets/` link (12-07).
- Each status link shows only the D-09 messages and attachments: `merge-provenance.test.ts` > "page, attachments and follow-up: each token sees exactly what D-09 allows" and > "csat stays one per ticket …"; `merge-race-coverage.test.ts` cases 1a, 1b, 1c and 2a (12-10).

## Requirement evidence

The orchestrator updates `REQUIREMENTS.md`, not this plan. All the rows cited below are gate rows 3, 4a and 6 on `7c3bad3`. Row 6 passed with 0 failed. No requirement's evidence relies on a failed or blocked row. The charter gate as a whole is still incomplete: rows 4 and 5 are blocked (O-1), and row 8 is red at the baseline counts.

| Requirement | Acceptance (REQUIREMENTS.md) | Evidence | ROADMAP Phase 12 criterion | Status from this gate |
|-------------|------------------------------|----------|----------------------------|-----------------------|
| AIDA-52 | Links are unique per pair, org-scoped, and shown from both sides. | `lifecycle-schema.test.ts` (row 4a): "refuses B->A after A->B, A->B twice and a second type on the same pair (TicketRelation_pair_key)", "refuses a self-link", "refuses a second parent for one child", "scopedDb(orgB) never reads, counts, updates or deletes A's TicketRelation rows". `ticket-relations.test.ts` 22/22 (row 4a): "links A as a duplicate of B, shows it from both sides and audits both tickets", ALREADY_LINKED for the same pair in the same direction, the reverse direction and another type, TICKET_UNAVAILABLE for another organization, PARENT_EXISTS, CYCLE, HIERARCHY_TOO_DEEP, the cycle and same-pair races bound to PIDs, and the membership refusals. `ticket-picker.test.ts` 8/8 (row 4a). `tests/e2e/ticket-relations.spec.ts` 4/4 (row 6): "a stored link shows on both tickets …", "the dialog links A as the parent of B …", "a three-ticket cycle is refused …", the picker lines. `tests/unit/lifecycle-helpers.test.ts` (row 3): the labels for each side | 1 | Evidence present; not blocked |
| AIDA-53 | Messages and attachments move; the source closes as a duplicate; confirmation is required; a full `AuditEvent` is written; no hard delete. Each status link keeps working but shows only what its holder could see before the merge plus replies addressed to that holder, tested with two contacts across the status page, attachments, follow-up and CSAT. If that rule cannot be met, merging tickets of different contacts is refused. | `ticket-merge.test.ts` 36/36 (row 4a): "moves the whole thread with provenance, closes the source as a duplicate and audits both" (`MERGED_INTO` and `MERGED_FROM` in `TicketAuditEvent`), "DIFFERENT_CONTACTS for tickets of two contacts (K33)", every D-07 refusal, the rollback seam, link replacement, the route race. `merge-provenance.test.ts` 6/6, `merge-reply-race.test.ts` 11/11 and `merge-race-coverage.test.ts` 10/10 (row 4a): two status links across the status page, attachments, follow-up and CSAT, plus the refused two-contact merge leaving both pages, attachments and CSAT as before. `tests/e2e/ticket-merge.spec.ts` 5/5 (row 6): "merging after confirmation moves the thread and closes the source", "tickets of two contacts cannot be picked and nothing changes", "a linked pair shows that the merge replaces the link", "a merged source shows the banner and no composer", "each status link shows only what D-09 allows after a merge". No hard delete: the merge updates rows only (12-03), and the source row stays with `mergedIntoTicketId` | 2 | **Partly proven.** Moving messages and attachments, closing the source as a duplicate, confirmation, no hard delete, per-link visibility and the different-contacts refusal are proven. The literal "a full `AuditEvent` is written" is **not met and not claimed**: the merge audit is in `TicketAuditEvent`, because `AuditEvent` is AI-only (11 D-07, D-11). This is owner item 12-o1. The same applies to ROADMAP criterion 2's "leaves a full audit event" |
| AIDA-54 | A pg-boss job and the inbound reply paths both wake it; the inbox has a snoozed filter; auto-close skips snoozed tickets. | `snooze.test.ts` 10/10 (row 4a): "snoozes through the service and the job wakes it exactly once", "a follow-up and an inbound email wake with WOKEN before = the deadline; automatic mail does not", "auto-close skips a snoozed RESOLVED ticket past its quiet period, and closes it after a wake", the refusals and edges. `snooze-race.test.ts` 4/4 (row 4a): a reply against the wake job, a re-snooze against the job (both orders), a snooze against auto-close. `tests/unit/snooze-filters.test.ts` (row 3): the `snoozed` filter grammar. `tests/e2e/snooze.spec.ts` 8/8 (row 6): the popover hides the ticket from the default inbox, "the wake job brings a ticket whose deadline passed back to the inbox", Wake now, the disabled trigger, and the Snoozed filter cases (toggle and saved view, an old stored view, the empty line). The job is registered on the `snooze-wake` queue every minute in `src/lib/worker/index.ts` | 3 | Evidence present; not blocked. "Until a date or the next customer reply" is read as "every snooze has a date, and a customer reply ends it earlier" (D-12) |
| AIDA-55 | The feed renders in order and is org-scoped. | `tests/unit/activity-feed.test.ts` (row 3): ordering by `(createdAt, kind, id)` with ties. `activity-feed.test.ts` 5/5 (row 4a): "excludes another organization's audit row that carries the same ticketId", names only from the organization's roster, a removed member shown as a former member, and the membership refusal. `tests/e2e/activity-feed.spec.ts` 2/2 (row 6): "the feed lists the customer message, the status change and the reply in that order" and "a link, a snooze and a wake appear as event rows in order between the messages". Merge and assignment events render through the same `describeEvent` copy table (`src/lib/tickets/activity-copy.ts`, every `TicketAuditAction`) | Feed is SEED-003; it serves criteria 1 to 3 by showing their events | Evidence present; not blocked. Merge and assignment rows have no E2E case of their own in the feed. Their copy is covered by the unit test of the copy table |

## Open items (manual, left open)

None of these is claimed as passed. Empty stays empty.

1. Visual approval (human) of every new surface: relation chips and the linked tickets row, the actions menu, the picker and its disabled reasons, the Link a ticket dialog, the two-step merge dialog and its warning callouts, the merged-source banner and composer line, the "Moved from" marker, the snooze trigger, popover and chip, the Snoozed toggle and its summary and empty lines, the feed event rows, and the public "Combined" label and merged notice: open (human).
2. Dark-mode review (human) of the same surfaces, DESIGN-SYSTEM §7: open (human).
3. Screen-reader check (human) that the actions menu, the picker's disabled reasons, the merge confirmation, the snooze popover (and the aria-disabled trigger's reason) and the feed list (`ol aria-label="Ticket activity"`) are announced correctly: open (human).
4. Backstop truths from 12-06, not measured:
   - with a 255-character subject, the actions menu stays visible in the top bar at 1280px and the subject truncates;
   - a 255-character subject in a relation chip truncates at 200px with the tooltip, and the remove button stays visible at 1024px;
   - a 255-character subject truncates in a picker row with the status chip visible, and the cycle callout wraps at 360px;
   - two 255-character subjects in the merge confirmation and the source-has-merges callout fit 360px, with all three footer buttons visible.
5. Backstop truths from 12-07, not measured:
   - at a 1024px window, the merged banner and the composer line wrap with "Open #N" visible;
   - a long IANA zone name (America/Argentina/ComodRivadavia) wraps inside the 320px popover, and the popover stays inside a 360px viewport;
   - in an inbox row in the 360px list panel, the snoozed, status, priority and SLA chips wrap without overlapping the subject;
   - at 360px, the public merged notice wraps and the header keeps the truncated subject and "Combined" on one line;
   - in a browser set to Asia/Jakarta, Tomorrow 09:00 is stored as 02:00 UTC and shown as 09:00 in the chip, the popover and the feed, and the time-zone line names Asia/Jakarta.
6. Backstop truths from 12-08, not measured:
   - with Status, Tag, Custom field and Snoozed all active, the filter row's second row wraps inside the 360px list panel and the save-view button stays reachable;
   - a ticket with 500 events and 200 messages renders the full feed in the scrolling pane without layout breakage, and the composer stays pinned below it (the feed has no paging, T-12-37 accepted);
   - an event row naming a 255-character member name wraps centered inside the reading pane at a 1024px window without horizontal scroll.
7. UI paths without an E2E case (server refusals are proven in integration): the merge-refusal and rejected-call callouts (12-06), and the snooze refusal callouts and "Snooze outcome unknown" (12-07).
8. Owner item **O-1**: how container tests may run on the shared Docker VM. Until it is decided, `pnpm test:integration` as-is and `pnpm test:egress` stay blocked (gate rows 4 and 5).
9. Owner item **12-o1**: AIDA-53's literal "a full `AuditEvent` is written" (and ROADMAP criterion 2's "full audit event") is not met. The merge audit is in `TicketAuditEvent` (D-11, 11 D-07). Changing the requirement text, or another resolution compatible with 11 D-07, is the owner's call.
10. Owner item **O-3**: unparking Phases 8, 9 and 10.
11. **AIDA-43** stays open (D-01): only the new Phase 11 and Phase 12 server paths check the active membership. Older pages and actions still lack the check. For example, the agent messages route (`src/app/api/tickets/[id]/messages/route.ts`) still authorises through `getScopedDb` only (12-03).
12. New status readers and writers that Phase 12.1 must migrate to the state table (D-02), by file:
    - `src/lib/tickets/merge.ts` (`mergeTickets`): reads the source's status under the lock and closes the source (CLOSED, and `resolvedAt` from a non-terminal status);
    - `src/lib/demo/seed-demo-data.ts` (`finalizeDemoTicket`): writes the seeded status under the row lock and refuses a merged ticket;
    - `src/lib/tickets/status-page-data.ts`: reads the token ticket's status for the public header and CSAT eligibility;
    - `src/app/(public)/status/[token]/page.tsx`: renders the token ticket's status and shows CSAT for RESOLVED and CLOSED;
    - `src/app/api/public/status/[token]/csat/route.ts`: unchanged, reads the token ticket's own status (a merged source is CLOSED, so it is eligible);
    - `src/lib/tickets/reopen-on-reply.ts` (`resolveReplyTicket` and `reopenOnCustomerReply`): the reply-path redirect to the merge target, the wake and the reopen, called from `src/app/api/public/status/[token]/follow-up/route.ts` and `src/lib/channels/email/ingest-message.ts`;
    - `src/lib/worker/jobs/auto-close.ts`: the candidate query and `closeResolvedTicketIfQuiet` read `status = 'RESOLVED'` together with `"snoozedUntil" IS NULL`;
    - `src/lib/tickets/list-filters.ts` and `src/lib/tickets/list-query.ts`: the snoozed filter combines with status filters;
    - `src/lib/tickets/snooze.ts` (`snoozeTicket`): refuses CLOSED tickets by reading `status` under the row lock.
13. Documented limitations (README Features row and D-05, D-07, D-08): no merge chains (a merged ticket, or one that has received a merge, cannot be merged); one parent per child; the source's tags, assignee and custom field values stay on the source; merging tickets of different customers is refused.
14. The ticket top bar (`src/components/tickets/ticket-meta-header.tsx:315`) uses `border-border` where DESIGN-SYSTEM asks for `border-border/70`. This predates Phase 12 (v1 commit `2d65bbc`) and Phase 12 did not change it. It is recorded here and not fixed in this plan.
15. Baseline debt, unchanged and not made worse by Phase 12: `pnpm audit --prod` 7 critical and 52 high; the Windows-only `taskkill` E2E teardown; the honesty-invariants flakes (2/2 in this run, not claimed fixed); the Turbopack NFT build warning; the 1 skipped `uat-gaps` case.
16. The 12-10 SUMMARY's statement "createdAt is the transaction start time" is wrong (gate attempt 1). The test is fixed (`65d4b7e`). The 12-10 SUMMARY itself is left as written; this file is the correction.

## Rerun after the code review fixes (on `06279f9`)

Run by the orchestrator after fixer passes F1, F2 and F3 (`12-REVIEW-FIX.md`). One command at a time, in this order, each writing its own log under `$TMPDIR` (`aida-12-fixgate-*.log`, outside the repo). Each exit code came from the command itself, never through a pipe. `pgrep -f 'artisan test'` found nothing before every command. The integration, E2E and build commands ran with `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. No container was created, started, stopped or removed by hand; no compose stack was started.

| Command | Exit | Result |
|---------|------|--------|
| `pnpm lint` | 0 | 388 files checked, no fixes |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 273 tests passed |
| `pnpm test:integration --exclude tests/integration/egress-isolation.test.ts --reporter=verbose` | 0 | 32 files, 278 tests passed; `egress-isolation` appears only in the echoed command |
| `pnpm test:e2e` (full suite) | 0 | 158 passed, 1 skipped (the existing `uat-gaps.spec.ts:17` skip), 0 failed, 0 flaky, 3.8 min; the Windows-only `taskkill` teardown message appears 3 times and did not fail the run |
| `pnpm build` | 0 | built |
| `pnpm audit --prod` | 1 | 7 critical, 52 high (same as the baseline) |

Integration full and `pnpm test:egress` stay blocked (O-1); no `aida-egress-test` container exists. Compared with attempt 3 on `7c3bad3`: unit 268 to 273, integration 270 to 278, E2E 140 to 158 passed; nothing is worse.

Gate item 7 of "Open items" (no E2E for the merge-refusal, rejected-call and snooze error callouts) is now covered by the F2 and F3 cases in `ticket-merge.spec.ts`, `snooze.spec.ts` and `ticket-relations.spec.ts`. The time-zone backstop is covered by the zone block in `snooze.spec.ts`, which picks a viewer zone different from the host zone. A visual pass is still open.
