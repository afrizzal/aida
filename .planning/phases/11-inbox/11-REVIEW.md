---
phase: 11-inbox
reviewed: 2026-11-08T11:14:37Z
depth: deep
files_reviewed: 53
files_reviewed_list:
  - prisma/migrations/20261108140000_inbox/migration.sql
  - prisma/schema.prisma
  - src/app/(app)/contacts/contact-search.tsx
  - src/app/(app)/layout.tsx
  - src/app/(app)/settings/sla/actions.ts
  - src/app/(app)/settings/sla/auto-close-form.tsx
  - src/app/(app)/settings/sla/page.tsx
  - src/app/(app)/tickets/[id]/actions.ts
  - src/app/(app)/tickets/bulk-action-bar.tsx
  - src/app/(app)/tickets/bulk-actions.ts
  - src/app/(app)/tickets/delete-view-dialog.tsx
  - src/app/(app)/tickets/filter-chip-row.tsx
  - src/app/(app)/tickets/layout.tsx
  - src/app/(app)/tickets/list-panel-focus.tsx
  - src/app/(app)/tickets/new-ticket-dialog.tsx
  - src/app/(app)/tickets/save-view-dialog.tsx
  - src/app/(app)/tickets/saved-view-actions.ts
  - src/app/(app)/tickets/saved-view-strip.tsx
  - src/app/(app)/tickets/ticket-list-panel.tsx
  - src/app/(app)/tickets/ticket-list-row.tsx
  - src/app/(app)/tickets/ticket-selection.tsx
  - src/app/api/palette/tickets/route.ts
  - src/app/api/public/status/[token]/follow-up/route.ts
  - src/components/command-palette.tsx
  - src/components/command-provider.tsx
  - src/components/keyboard/chord-hint.tsx
  - src/components/keyboard/key-caps.tsx
  - src/components/keyboard/keyboard-dispatcher.tsx
  - src/components/keyboard/keyboard-help-dialog.tsx
  - src/components/sidebar-views.tsx
  - src/components/sidebar.tsx
  - src/components/tickets/composer.tsx
  - src/components/tickets/ticket-meta-header.tsx
  - src/components/top-bar.tsx
  - src/lib/channels/email/ingest-message.ts
  - src/lib/commands/registry.ts
  - src/lib/keyboard/dispatch.ts
  - src/lib/keyboard/keymap.ts
  - src/lib/membership.ts
  - src/lib/saved-views/service.ts
  - src/lib/saved-views/ui-state.ts
  - src/lib/scoped-db.ts
  - src/lib/session.ts
  - src/lib/tickets/auto-close-days.ts
  - src/lib/tickets/auto-close-settings.ts
  - src/lib/tickets/list-filters.ts
  - src/lib/tickets/list-query.ts
  - src/lib/tickets/mutations.ts
  - src/lib/tickets/palette-search.ts
  - src/lib/tickets/reopen-on-reply.ts
  - src/lib/tickets/ticket-audit.ts
  - src/lib/worker/index.ts
  - src/lib/worker/jobs/auto-close.ts
findings:
  critical: 0
  warning: 2
  info: 7
  total: 9
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-11-08T11:14:37Z
**Depth:** deep (cross-file: callers of the mutation service, every other `Ticket` writer, the reply paths, the worker and the triage guard)
**Files Reviewed:** 53 (`git diff --name-only 1e5c0f3..HEAD -- src prisma`)
**Status:** issues_found

## Summary

I reviewed the 53 files in scope in the order the brief set. The tests under `tests/` served as context: I read `ticket-mutations.test.ts`, `reply-reopen-race.test.ts`, `support/lock-wait.ts` and the keyboard and palette E2E specs.

**I found no blocker in the focus areas.**

1. **Tenancy and authorization.**
   - Every new read and write carries an explicit `organizationId` predicate, either through `scopedDb` or as a bound parameter in raw SQL: `mutations.ts`, `saved-views/service.ts`, `auto-close-settings.ts`, `auto-close.ts`, `reopen-on-reply.ts`, `palette-search.ts` → `search.ts`, and the members list in `ticket-list-panel.tsx`.
   - `findActiveMembership` runs on all four D-01 paths. In the mutation service it runs inside the transaction (`mutations.ts:240`). The saved-view writes read it inside their transaction (`service.ts:225`, `:341`).
   - Private views reach no other user:
     - the sidebar and palette list filters by `ownerUserId` (`service.ts:298`);
     - the strip read filters with `OR [SHARED, ownerUserId]` (`service.ts:463-468`);
     - update and delete raise `NOT_FOUND` for another member's private view after the row lock (`service.ts:353`).
   - Palette search is scoped to the organization through `searchTickets`, whose SQL has `t."organizationId" = ${orgId}`.
2. **Raw SQL safety.** Every `$queryRaw` and `$executeRaw` is a tagged template with bound values. No identifier is built from input.
3. **Concurrency.**
   - The bulk path locks all of its tickets in one `ORDER BY id FOR UPDATE`. Its audit rows are written in the same transaction, and any error rolls the whole batch back.
   - The reply paths take the row lock first and then run the conditional reopen. This matches the D-17 amendment.
   - The job's conditional `UPDATE` re-checks `RESOLVED`, `resolvedAt` and `GREATEST(...)` after it waits on the lock.
   - The setting row uses `FOR SHARE` in the job and `FOR UPDATE` on save. I found no lock cycle among the job (Setting then Ticket), the reply paths (Ticket only), bulk (Tickets in id order) and save (Setting only).
4. **Side-effect parity.** Status writes (`resolvedAt`, flags) and priority writes (the seven SLA fields) match the pre-phase actions. `triggeredReopen` now comes from the row count. Every `Ticket` writer that sets `status` (`grep "UPDATE \"Ticket\""`, `ticket.update`) is now under the row lock, except the agent message route. That route never changes status.
5. **Keyboard dispatcher.** The guards for `defaultPrevented`, `repeat`, `isComposing`, modifiers, editable targets, overlays and open modals are in the documented order (`dispatch.ts:95-123`).
6. **Customer contact, egress and UI.**
   - The auto-close job sends nothing. It writes only the status and one SYSTEM audit row.
   - The only new `fetch` is to the same origin (`/api/palette/tickets`).
   - There is no inline script, no `dangerouslySetInnerHTML`, no hex or oklch value, and no named Tailwind text size in the added lines.
7. **`contact-search.tsx` fix (`9eddbd9`).** The fix stops the mount-time replace, but it adds a new bounce-back regression: see WR-01.

The two warnings are that regression and a robustness gap in the auto-close job. The info items are behaviour changes and small quality points. Each one was checked against the code. Where only the code, and not the running app, could confirm a behaviour, the item says so.

## Warnings

### WR-01: Contacts search now rewrites any navigation that changes `q` back to the typed text (regression from 9eddbd9)

**File:** `src/app/(app)/contacts/contact-search.tsx:15-32` (with `src/app/(app)/contacts/page.tsx:46`)

**Evidence:**
- The effect now depends on `currentQuery`, which is `useSearchParams().get("q")`.
- Its guard is `if (value.trim() === currentQuery) return;`.
- `value` is local state, seeded once from `defaultValue`. `ContactsPage` renders `<ContactSearch defaultValue={q ?? ""} />` without a `key`, so the state survives a same-route navigation.

Sequence:
1. The user is on `/contacts?q=foo`.
2. They click the sidebar "Contacts" link (`href="/contacts"`) or use any other link to `/contacts` or `/contacts?q=other`.
3. `currentQuery` becomes `""`, but `value` is still `"foo"`. The effect re-runs.
4. 300 ms later it calls `router.replace("/contacts?q=foo")`.

Before the fix, the deps were `[value, pathname, router]`. None of them changed in step 3, so the URL was never reverted. The input only went out of sync with the URL.

**Impact:**
- The user cannot clear or change a contacts search by navigating. The list flashes the new result and then snaps back to the old query.
- This is the same class of bug the fix was meant to remove: a debounced `replace` overriding a navigation the user started.
- No test covers it. `command-palette.spec.ts` only exercises the mount path.

**Fix:** Treat the URL as the source of truth when it changes from outside, and compare against the trimmed URL value:

```tsx
const currentQuery = (useSearchParams().get("q") ?? "").trim();
const [value, setValue] = useState(defaultValue);
const [syncedQuery, setSyncedQuery] = useState(currentQuery);
if (currentQuery !== syncedQuery) {
  // URL changed by navigation, not by typing: adopt it, do not fight it.
  setSyncedQuery(currentQuery);
  setValue(currentQuery);
}
useEffect(() => {
  if (value.trim() === currentQuery) return;
  const handle = setTimeout(() => { /* replace as today */ }, 300);
  return () => clearTimeout(handle);
}, [value, currentQuery, pathname, router]);
```

A simpler fix also works: render `<ContactSearch key={q ?? ""} defaultValue={q ?? ""} />` in `page.tsx`, so that an outside change of `q` remounts the input. Add an E2E case: from `/contacts?q=x`, click the sidebar Contacts link and assert that the URL stays `/contacts` after 600 ms.

### WR-02: One failing close aborts the auto-close run for every organization after it

**File:** `src/lib/worker/jobs/auto-close.ts:126-171`

**Evidence:**
- The per-organization loop has no `try/catch`.
- Any rejection inside it aborts `autoCloseHandler` as a whole:
  - `prisma.$transaction(...)` at lines 155-158: a transaction or `maxWait` timeout, a serialization or deadlock error, or a failed audit insert;
  - `prisma.ticket.count` or the candidate `$queryRaw` (lines 138-150).
- Organizations are processed in `organizationId` ascending order (line 123). An error in organization A therefore skips every organization that sorts after it for that run. The per-organization log line is never written for them.
- The job is daily (`15 2 * * *`, `worker/index.ts:45`). After pg-boss's retries are used up, the skipped organizations wait a full day. A persistent fault in one organization starves all later ones every day.

**Impact:** One tenant's problem can stop auto-close for every other tenant (the design is "at most 100 per organization per run", D-18, not "all or nothing across tenants"). The partial result is also not observable: no log line says which organization failed.

**Fix:** Isolate each organization and keep the run going:

```ts
for (const { organizationId: orgId } of orgRows) {
  try {
    // existing body
  } catch (err) {
    result.failedOrganizations.push(orgId);
    log(`[auto-close] org=${orgId} failed: ${err instanceof Error ? err.name : "unknown"}`);
  }
}
if (result.failedOrganizations.length > 0) {
  throw new Error(`auto-close failed for ${result.failedOrganizations.length} organization(s)`); // let pg-boss retry; the run is idempotent
}
```

Add a test where the `onCloseTransaction` hook throws for one organization's ticket. It should assert that a second organization's quiet ticket is still closed.

## Info

### IN-01: Re-applying the current priority, status or assignee is now a no-op, which changes two interactions

**File:** `src/lib/tickets/mutations.ts:310, 320, 339` (interaction with `src/lib/triage/run-triage.ts:54-55`)

**Issue:**
- Before Phase 11, `changePriority` and `changeStatus` always wrote. Re-selecting the current priority recomputed the SLA targets from the current policy, reset the flags and bumped `updatedAt`. Re-selecting RESOLVED re-stamped `resolvedAt`.
- Now these are no-ops with an audit row. This is intended and tested (D-08). Two consequences are not documented:
  1. An agent can no longer re-apply a priority to pick up an edited SLA policy.
  2. `run-triage.ts` uses `updatedAt` as an optimistic token so that an agent's priority wins over AI triage. An explicit "keep NORMAL" chosen during the LLM call no longer bumps `updatedAt`, so the triage result overwrites it.
- Radix `DropdownMenuRadioGroup` may fire `onValueChange` again for the checked item. I have not confirmed this at runtime.

**Fix:** Record the behaviour change in the SUMMARY or docs. If the second point matters, also bump `updatedAt` on a single-mode no-op priority write.

### IN-02: A customer reopen writes no TicketAuditEvent, so the status history has gaps

**File:** `src/lib/tickets/reopen-on-reply.ts:59-66`

**Issue:** An auto-closed ticket gets `AUTO_CLOSED` (RESOLVED → CLOSED). The later customer reopen (CLOSED → OPEN) leaves no `TicketAuditEvent`; only `Message.triggeredReopen` records it. D-07 does not list a reopen action, so this is within the decision. Still, reading `TicketAuditEvent` alone gives a wrong last-known status for that ticket.

**Fix:** Defer this item, or add a `SYSTEM` `STATUS_CHANGED` row (`before: {status}`, `after: {status: "OPEN"}`) in the same transaction when `changed === 1`.

### IN-03: Saving, editing, resetting or deleting a view from `/tickets/[id]` closes the open ticket

**File:** `src/app/(app)/tickets/save-view-dialog.tsx:231`, `delete-view-dialog.tsx:64`, `saved-view-strip.tsx:120`

**Issue:**
- The strip and the save dialog also render inside `TicketListPanel` on `/tickets/[id]`, which passes `basePath`.
- All three navigate to a hard-coded `/tickets?...`: `router.push(result.href)`, `router.push("/tickets?...")` and `<Link href={view.href}>`.
- The reading pane therefore closes, unlike "Clear" and "Load more", which keep `basePath`. UI-SPEC does not say which behaviour is wanted.

**Fix:** Build the target from the current pathname, as `buildClearViewHref` does. Alternatively, record this behaviour as intended in UI-SPEC.

### IN-04: Keyboard focus falls to `<body>` after a bulk action

**File:** `src/app/(app)/tickets/bulk-action-bar.tsx:129-134, 262-264`

**Issue:**
- `run()` sets `openPicker` to `null` and `pending` to `true` in one batch.
- In the same commit the popover closes and its trigger becomes `disabled`. Radix returns focus to the trigger on close, but a disabled button cannot take focus, so focus lands on `<body>`.
- A keyboard user loses their place after every bulk action, success or failure.

Confirmed from the code only; I did not observe it at runtime.

**Fix:** Keep the trigger focusable while pending (`aria-disabled` plus a guard in `onOpenChange`), or move focus to the bar's count line or failure alert once the call ends.

### IN-05: Admin-role checks disagree on multi-role members

**File:** `src/lib/saved-views/service.ts:311-316` vs `src/lib/tickets/auto-close-settings.ts:154,172` and `src/app/(app)/settings/sla/page.tsx:30-31`

**Issue:** The saved-view service splits Better Auth's comma-separated role (`"member,admin"` counts as admin). The auto-close save and the SLA page compare the whole string (`EDITOR_ROLES.has(role)`, `role === "admin"`). A multi-role admin may therefore edit shared views but not the auto-close setting. The rest of the app (`requireOrgAdmin`) behaves like the auto-close save.

**Fix:** Move one `isAdminRole(role)` into `src/lib/membership.ts` and use it everywhere.

### IN-06: An invalid visibility is reported as `INVALID_FILTERS`

**File:** `src/lib/saved-views/service.ts:129-134`

**Issue:** `validateVisibility` throws `INVALID_FILTERS`, so the dialog shows the generic unknown-error copy for a bad visibility value. The UI cannot send one; this matters only for crafted calls and for the clarity of the error contract.

**Fix:** Add an `INVALID_VISIBILITY` code, or reuse `INVALID_NAME`'s pattern with its own code.

### IN-07: Duplicated helpers

**File:** `src/lib/tickets/list-filters.ts:68-73` and `src/lib/tickets/palette-search.ts:46-51` (`cut`); `src/components/top-bar.tsx:34-55` and `src/components/keyboard/key-caps.tsx:13-29` (`isApplePlatform`, `subscribeNever`)

**Issue:** The same logic is copied in two places, so a fix to one copy can miss the other. The top bar could use `useApplePlatform()` from `key-caps.tsx`.

**Fix:** Export `cut` from one module (for example a small `src/lib/text/cut.ts`), and have `top-bar.tsx` use `useApplePlatform`.

## Checked and not raised

- **Tests that cannot fail.** None found in the files I read. The negative E2E checks wait with `waitForTimeout` and then assert (`keyboard.spec.ts:132,160,180,370,385,401`; `command-palette.spec.ts:252`). They can fail, but they are timing-based: they prove "not within N ms", not "never". This is acceptable for negative UI assertions.
- **Timestamp parameters in raw SQL.** `GREATEST("resolvedAt", ${enabledAt}) <= ${cutoff}` binds JavaScript `Date` values against `timestamp(3)` columns. This follows the precedent in `sla-flag.ts`, and the Testcontainers suite passes. I did not verify it under a non-UTC Node or Postgres timezone.
- **`scopedDb` coverage.** `scopedDb` does not scope `aggregate`, `findUnique` or `groupBy` (pre-existing). Phase 11 code never calls these on a `scopedDb` client; `nextPosition` uses an explicit predicate on the unscoped transaction.

## Fix status

Fixed on 2026-11-08 by gsd-code-fixer in the main checkout (`workflow.use_worktrees` is `false`), on branch `v2/run-loop`. Every fix has a test that failed before it and passes after it. No existing assertion was loosened.

| Finding | Outcome | Commit | Test (failed before, passes after) |
|---------|---------|--------|-------------------------------------|
| WR-01 | fixed: the search box records the queries it sent; a URL change that is not one of them came from outside, and the box takes it as its text, so the debounce does not navigate back | `cdb77ad` | E2E `contacts.spec.ts` "a navigation that clears the search is not reverted…" (before: the box kept the old text and the URL reverted) |
| WR-02 | fixed: each organization runs in its own `try/catch`; the error is logged as `org=… failed code=… closed=…` (code or class name only, never the message), the run continues, and a run with a failed organization ends by throwing `AutoCloseRunError` with the full result (`failedOrganizations`), so pg-boss marks the job failed and retries it (idempotent) | `02391a7` | integration `auto-close.test.ts` "a failing organization is logged by error code, later organizations still close, and the run rejects" (before: the later organization's quiet ticket stayed RESOLVED) |
| IN-01 | fixed (triage race): `runTriage` counts the ticket's `PRIORITY_CHANGED` audit rows before loading the ticket and again under the ticket row lock, and keeps the agent's priority when the count changed. The D-08 no-op stays a no-op on the ticket row. **Not changed:** re-applying a priority no longer picks up an edited SLA policy; that is D-08's intended no-op (with an audit row) | `131a09d` | integration `triage-priority-race.test.ts` (before: the no-op re-apply of NORMAL was overwritten with URGENT) |
| IN-02 | not fixed: D-07's action list has no reopen action, and a customer reopen is recorded by `Message.triggeredReopen`. Adding a `STATUS_CHANGED` row would change a locked decision; this is left for a CONTEXT amendment | — | — |
| IN-03 | not fixed: UI-SPEC fixes these targets. Surface 2c says that after a save or an edit the app navigates to "the view's href", which Surface 1 defines as `/tickets?sv=…`. Surface 2b's Reset goes to "the view's stored href". Surface 2d says to "navigate to `/tickets` with the same filter params minus `sv`". The sidebar rows and the palette's views use the same href. Keeping the open ticket would contradict that contract; changing it needs a UI-SPEC amendment | — | — |
| IN-04 | fixed: the bar remembers which picker started the call and focuses that picker's trigger once the call ends and the trigger is enabled again. This is the radix return-to-trigger behaviour that UI-SPEC relies on. The pending state still disables every button (Surface 3b) | `e4a0db4` | E2E `bulk-actions.spec.ts` "after a bulk action, and after a refused one, keyboard focus is back on the picker's trigger" (the server-action POST is held for 1 s; before: focus was on `<body>`) |
| IN-05 | fixed: `isAdminRole` (comma-separated Better Auth roles, owner or admin) lives in `src/lib/membership.ts`. The saved-view service, the auto-close save, the SLA and branding pages, and `requireOrgAdmin` all use it | `36b1e9b` | unit `admin-role.test.ts`; integration `auto-close.test.ts` "allows a member whose roles include admin…" (before: NOT_ALLOWED) |
| IN-06 | fixed: a new `INVALID_VISIBILITY` code. The dialog shows its generic error row, because the UI cannot send a bad value | `85785dd` | integration `saved-views.test.ts` "refuses an unknown visibility with its own code…" (before: INVALID_FILTERS) |
| IN-07 | fixed: `cut` is now in `src/lib/text/cut.ts`, and `isApplePlatform`/`subscribeNever` in `src/lib/keyboard/platform.ts`. The top bar keeps its own `null` server snapshot, so its key cap still appears only after hydration; it therefore does not use `useApplePlatform`, whose server snapshot is `false` | `a113db5` | unit `shared-helpers.test.ts` (before: the modules did not exist) |

Verification after the last fix (`e4a0db4`), main checkout, one process at a time, exit codes read without a pipe:

- `pnpm typecheck` 0
- `pnpm lint` 0
- `pnpm test` 0 (23 files, 228 tests)
- Integration with Testcontainers (Colima variables): `auto-close`, `saved-views`, `triage-priority-race`, `reply-reopen-race`, `ticket-mutations`, `triage-injection`, `palette-search` and `saved-views-ui-state`: exit 0 (8 files, 89 tests). The full suite and `test:egress` were not run (O-1).
- E2E: `contacts`, `bulk-actions`, `inbox`, `saved-views`, `command-palette`, `keyboard`, `auto-close`, `sla` and `phase4-ai`: exit 0 (68 passed).

---

_Reviewed: 2026-11-08T11:14:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

### Orchestrator follow-up (IN-05)

The IN-05 fix (`36b1e9b`) unified every admin check but accepted comma-separated roles (`member,admin`), which widened the v1 `requireOrgAdmin` gate. AIDA never assigns combined roles and role management belongs to the parked Phase 10, so the rule was made exact (`owner` or `admin` only) everywhere, including shared saved views; tests now refuse combined roles. Commit recorded in `run-loop/RUN-LOG.md`.

## Codex critique of the phase diff (round 1)

Question `run-loop/codex/fase11-diff-tanya.md` (commit `5c8c13e`); answer `run-loop/codex/fase11-diff-jawab.md`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`. Codex: fit for verification once the HIGH is fixed. Every claim below was re-checked in the code.

| ID | Severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| D1 | HIGH | `ticket-list-panel.tsx` reads every member of the session's organization through `getScopedDb` (no membership check) and sends names and emails to the bulk bar, so a removed member with a stale session receives the new roster | Verified: `ticket-list-panel.tsx:33-64` | fix: check `findActiveMembership` before loading the roster (and the other new panel data); a removed member gets no roster; test with a deleted member row |
| D2 | MEDIUM | The bulk bar shows "Nothing was changed." for every rejection, including a failure after commit or a lost response | Verified: `bulk-actions.ts:40`, `bulk-action-bar.tsx:139` | fix: a service refusal (definite rollback) keeps that message; an unknown outcome says the result is uncertain and asks for a refresh; test |
| D3 | MEDIUM | Re-selecting the same priority is now a no-op, while the old action recomputed SLA targets and cleared flags | Verified: `mutations.ts:336`; recorded as a deviation in `11-02-SUMMARY.md` | not changed (run-loop K30): D-08 makes a same-value change a no-op with one audit row; refreshing SLA after a policy change is not part of AIDA-48 |
| D4 | MEDIUM | Typing in the contacts search and navigating within 300 ms can still be overridden by the debounce | Verified: `contact-search.tsx:30`; listed in `deferred-items.md` | fix if a robust cancel exists (pending search invalidated when a navigation starts), with a test; otherwise record why not |
| D5 | MEDIUM | The full gate evidence is for `9523eac`, not for the code after the review fixes | Verified: `11-GATE.md`, `11-REVIEW.md` | step 8 reruns the allowed gate on the final commit |
| D6 | LOW | The stale-response palette test can pass because the old request is aborted, without exercising the stale-response guard | Verified: `command-palette.spec.ts:292`, `command-palette.tsx:158-175` | fix the test so the old response resolves after the new one |
| D7 | LOW | A pending `g` chord is not cancelled by a query-only navigation on the same pathname | Verified: `keyboard-dispatcher.tsx:159-161` | fix: also watch search params; test |
