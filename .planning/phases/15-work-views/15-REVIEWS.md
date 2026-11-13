# Phase 15: cross-AI plan reviews

## Codex

### Cycle 1 (2026-11-10, export of `6507823`, model gpt-6.1-terra, effort xhigh)

Answer: `.planning/run-loop/codex/fase15-plan-jawab.md`. Verdict: plans not yet ready; 3 HIGH, 2 MEDIUM. Codex states its reading was targeted, not a full audit of 2.6 MB, and found no evidence of a private-project oracle or cross-organization leak on the read paths it checked.

| ID | Sev | Finding (checked by the orchestrator against the plan text) | Disposition |
|----|-----|-------------------------------------------------------------|-------------|
| CX1-1 | HIGH | 15-12 decision 7 (line 207): "a state canonically equal to the last saved one is not sent". With A stored, B in flight and the user choosing A again, the queued A is dropped and B stays: the last choice is lost silently. Confirmed in plan text. | Accepted, **K99**. |
| CX1-2 | HIGH | 15-12 builds the saver per mount and stops it at unmount; 15-08 (line 377) proves the server is last-commit-wins. Leaving and re-entering a view lets an old mount's held save A land after the new mount's save B. Confirmed in plan text. | Accepted, **K100**. |
| CX1-3 | HIGH | 15-22's response markers cover project, task, milestone and label identity but not the hidden-only assignee "Hidden Helper" (seeded precisely for this), so an RSC or action response could carry that person's name or id unseen. Confirmed: no assignee marker in 15-22's marker list. | Accepted, **K101**. |
| CX1-4 | MEDIUM | Views number reads when server props are adopted, not when they were read: a held RSC for a new filter may carry data read before a task change whose signal reload is then discarded by the adoption guard, leaving the view stale. 15-12 decision 9, 15-20 decision 19 and the other views' guards. | Accepted, **K102**. |
| CX1-5 | MEDIUM | 15-21 trusts Content-Length before `formData()`; the Phase 14 validator checks the file's size, not the whole multipart body (verified in code: `src/lib/attachments/validate-upload.ts:56`). A small valid file plus a large extra field, or a lying header, is not bounded by actual bytes. | Accepted, **K103**. |

### Run decisions from cycle 1

- **K99 View-state saver compares with the last requested state.** The saver keeps the latest desired state; a new state is dropped only when it equals the state of the save in flight or queued (the last requested), never merely the last stored one; when the in-flight save completes, the saver sends the latest desired state if it differs from what that save stored. Tests: A stored, B held, A chosen: A is sent after B and stays; plus a variant with C queued between.
- **K100 One saver per preference key across remounts.** The saver lives in a module-level registry keyed by (scope, projectId, viewKind) within the tab and survives unmount and remount, so saves for one key are serialized in the tab; an unmounted view's queued state is still sent in order. Cross-tab concurrency stays last-commit-wins on the server (15-08), recorded as a stated limitation. Test: leave and re-enter a view with the first save held; the later choice is the stored one.
- **K101 Assignee identity in the privacy markers.** 15-22 adds the hidden-only assignee's user id, name and email to the response and HTML markers; the owner control shows that identity; a regression case proves a response carrying the identity without rendering it fails the scan.
- **K102 Signal generation across adoption.** 15-12's `task-change-signal.ts` adds a monotonic generation (`tasksChangedGeneration()`); every view records the generation when it starts a navigation or read, and when it adopts server props it requests one depth-keeping reload through its runner if the generation advanced since that read began. Applies to List (15-12), Board (15-14), Table (15-15), Calendar (15-16), Timeline (15-17), workspace forms (15-20) and workspace Calendar and Timeline (15-22). Test in 15-12 (and reused shape): hold an RSC for a new filter past a task commit and its signal; after adoption the view shows the change without a manual reload.
- **K103 Upload body bounded by actual bytes.** 15-01 amends 18.1: the upload route reads the request body with a running byte count and refuses 413 FILE_TOO_LARGE as soon as the bytes read exceed `UPLOAD_REQUEST_MAX_BYTES`, before multipart parsing, whatever Content-Length says; then parses the buffered body. 15-21 implements it and tests a small valid file plus a large extra field (413, nothing written) and a header lower than the body (413, nothing written).

Revision order: 15-12 and 15-01 first (providers), then 15-21, 15-22, and the views for K102 (15-14, 15-15, 15-16, 15-17, 15-20), then 15-08's stated limitation note. Cycle 2 of the Codex review follows the revision.

### Revision 2 notes

- Providers committed: 15-01 (`71cf9d7`), 15-22 K101 (`a12cf4e`), 15-21 (`dbc7791`), 15-12 (`8cf9408`), 15-15 K102 (`a844216`).
- Defect found during the K102 follow-ups (15-15 reviser): 15-12's generation advanced only in `notifyTasksChanged`, but every K102 E2E dispatches the plain `aida:tasks-changed` window event, so the counter would not move and the tests would fail. Fix (revision 2b of 15-12): one module-level window listener counts every event; `notifyTasksChanged` only dispatches. The 15-15 test 18 carries a stop-and-report precondition for this.
- 15-15 hand-off: `useTableData` owns the adoption watch and exposes `TableDataApi.beginNavigation(nextQueryKey)`; the workspace Table only calls it before navigations.
- 15-12 revision 2b committed (`f6f3a7f`): the generation counts every plain window event, which the K102 tests of 15-12, 15-14, 15-15, 15-16, 15-17, 15-20 and 15-22 rely on. K102 follow-ups committed: 15-15 (`a844216`), 15-16 (`117e428`), 15-17 (`eba0341`), 15-14 (`8ef76d0`), 15-22 (this commit).
- Open item for the cycle-2 review (found by the 15-22 reviser, not yet decided): the 15-16 and 15-17 Set date and Set dates dialogs switch to the fresh task version after any reload (signal or K102 follow-up), which may conflict with the open-editor version rule (an open editor keeps the version it opened on); 15-22 reuses the dialogs unchanged.

### Cycle 2 (2026-11-10, export of `fa3efd5`, model gpt-6.1-terra, effort xhigh)

Answer: `.planning/run-loop/codex/fase15-plan-r2-jawab.md`. Verdict: not yet ready; 3 HIGH, 1 MEDIUM. CX1-1, CX1-3 and CX1-5 judged closed in design; CX1-2 and CX1-4 closed for the tested orders with the gaps below. No private-project oracle or other deadlock found on the paths read (targeted reading).

| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| CX2-1 | HIGH | 15-16 (line 370) and 15-17 (line 248) date dialogs keep the input but switch to the newest task version after a reload, so a stale submit can overwrite a change the user never saw (also the Calendar's paired-date math). Answers the open item from revision 2. | Accepted, **K104**. |
| CX2-2 | HIGH | The 15-12 saver registry key is (scope, projectId, viewKind) only and its queue survives until a document load; sign-out and sign-in use client navigation (verified in code: `src/components/user-menu.tsx:37`, `src/app/(auth)/login/login-form.tsx:75`), so user A's queued state could be sent under user B's session and overwrite B's preference, across accounts or organizations. | Accepted, **K105**. |
| CX2-3 | HIGH | A view mounting while the saver is busy initialises its controls from props only (15-12 line 284), so a new choice built on the stale base overwrites the queued one (A stored, B held, return, C built from A: B's change lost); the K100 test (line 299) even expects that outcome. | Accepted, **K106**. |
| CX2-4 | MEDIUM | The frame Reload is limited to one extra refresh (15-12 line 476); a signal arriving after the second refresh's read but before adoption can still mount stale data. | Accepted, **K107**. |

### Run decisions from cycle 2

- **K104 Date dialogs keep their opening snapshot.** In 15-16 and 15-17 (reused by 15-22) Set date and Set dates keep the task snapshot and `expectedVersion` taken when the dialog opened; background reloads never replace them; a stale submit gets CONFLICT with the input kept; only the user's explicit Reload on the conflict shows the newest dates, keeps the input and takes a new snapshot for the next try. E2E per dialog: open, type, change the task as another actor, signal and wait for the reload, submit: CONFLICT and the other actor's change intact; then Reload and resubmit succeeds.
- **K105 Saver bound to identity.** The registry key adds organizationId and userId; when the session identity a view mounts with differs from a saver's identity, that saver is stopped and its queue dropped without sending; every save carries the expected organizationId and userId, and the save action refuses without writing (a typed refusal resolved by Reload) when the session actor differs. Test: A with one save held and one queued, sign out, sign in as B in the same tab, release: A's row holds A's held state only, B's row is untouched.
- **K106 Busy saver supplies the control base.** A view mounting while its key's saver has a requested state in flight or queued takes that latest requested state as the base for its controls (not the props), and the K100 test expects both choices kept (both groups collapsed); also covered: returning without a change, and the next reload.
- **K107 Generation change carried across the frame Reload.** The bounded refresh stays (no endless loop), but when the generation advanced during the last refresh, the remounted view requests one reload through its runner after mount. Test: two held refresh responses with a signal during each; the final view shows both changes.

Revision 3 order: 15-12 (K105, K106, K107) and 15-16, 15-17 (K104) in parallel; 15-22 inherits K104 through the reused dialogs (note only); 15-25 evidence rows after. Codex cycle 3 (the last) follows.

### Cycle 3, the last (2026-11-10, export of `2d7508b`, model gpt-6.1-terra, effort xhigh)

Answer: `.planning/run-loop/codex/fase15-plan-r3-jawab.md`. Verdict: not ready; 2 HIGH, 1 MEDIUM. CX2-1 judged closed for real version conflicts and truly missing tasks; CX2-2 adds a server identity check with no project-existence oracle found (the identity refusal reads no project); CX2-3 closed for ordinary remounts; CX2-4 has a bounded follow-up with no endless loop.

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| CX3-1 | HIGH | Account switch A to B to A while A's already-sent save X is still in flight: B's mount stops A's saver, so when A returns before X completes, `pendingViewState` is null and A's controls are built from props possibly read before X stored; a new choice can then overwrite part of X (the CX2-3 class again). 15-12 decisions 21, 23, 24; the identity E2E returns to A only after X completes (line 276). | Open: phase parked. |
| CX3-2 | HIGH | 15-12 lines 275 to 276 still require `viewStateSaverKey("workspace", null, "LIST")` to yield `"workspace|~workspace|LIST"` while decision 23 requires the identity argument and an organization and user in the key: the executor would have to guess or hit a failing test and typecheck. | Open: phase parked. |
| CX3-3 | MEDIUM | The date dialogs (15-16 decision 23, 15-17 decision 26) close when the task prop is null after `onReload()` resolves, but the runner's promise also resolves when the read fails; a failed explicit Reload after a background reload already made the prop null can discard the input without a successful read proving the task is gone. | Open: phase parked. |

**Outcome:** three plan-review cycles are exhausted with HIGH findings left, so by the charter's decision table ("3 siklus review plan habis dengan temuan HIGH tersisa: Parkir fase") Phase 15 is parked. Nothing was revised after cycle 3. Suggested fixes for the owner, from Codex: CX3-1, on returning to an identity whose earlier save is still in flight, hold the controls until it completes and re-read (or keep that save as the base and serialize the new choice after it), with an A to B to A E2E while X is pending; CX3-2, update the K100 example to pass the identity and expect the full key; CX3-3, give `onReload()` a success or failure result and keep the dialog, input and retry on failure, tested for both dialogs and the workspace pages.

### Owner decision 15-o2 (2026-11-11) and revision 4 (2026-11-13)

Source: `.planning/run-loop/ANTREAN.md` row `15` (verbatim in `15-CONTEXT.md`, "Revision 2026-11-13"): option c, simplify K100, with two conditions (fix the date dialog, CX3-3; the last pending change is sent when the page is left, `fetch` with `keepalive: true`), then one Codex review of the changed parts only.

| ID | Disposition in revision 4 |
|----|---------------------------|
| CX3-1 | Resolved by removing the registry: one saver per mount, nothing of an earlier mount used as a base, each request carries its saver's identity and the route refuses another session's (404, nothing written). Returning before an earlier save commits is stated limitation (1), accepted by option c. E2E "A to B to A" in 15-12. |
| CX3-2 | Resolved by removal: `viewStateSaverKey` no longer exists; saver tests pass `I_A` and check `expected` on every request. |
| CX3-3 | Fixed: `createCoalescedReload` resolves a `ReloadResult`; both dialogs close only after a successful read with the task gone and keep dialog, snapshot, input and refusal on a failed or discarded read; tests in 15-16, 15-17 and both 15-22 pages. |
| Owner condition 2 | Every view-state save uses one keepalive transport to `POST /api/projects/view-state`; on unmount the queued state follows the save in flight, on `pagehide` or hidden visibility it is sent at once; failures after leaving show one generic toast, failures after the document is gone are not shown and the next visit reads the stored row. |

Applied as binding "Revision 4" sections at the end of 15-01, 15-08, 15-09, 15-10, 15-11, 15-12, 15-14, 15-15, 15-16, 15-17, 15-18, 15-20, 15-21, 15-22, 15-24 and 15-25 (their earlier text, truths and greps naming the withdrawn identifiers are superseded there; folding them inline is open work for the reviser of the Codex round).

Drift items fixed (code changed after planning at `7718899`):
1. Docker test commands (97 sites, 16 preconditions): `AIDA_TEST_RUN_ID` and `DOCKER_HOST` from `docker context inspect` (rule J, executor brief).
2. Cookie cache off (R10-1): `renewSessionCookieCache` (49 sites) became `expectSessionReadSetsNoCookie` (no set-cookie), 15-05 helper text and prose fixed.
3. Migration `20261114100000_work_views` collided in time with `20261114100000_project_file_cleanup_upload_xact_id` and sorted before Phase 13's reserved name: now `20261118100000_work_views` (33 sites); 15-02 generates it in a rule J disposable container (not `aida-dev-db`), counts migrations from disk and appends it to `UPGRADE_MIGRATIONS` of `tests/integration/auth-upgrade.test.ts`.
4. Rule A of `tests/unit/membership-inventory.test.ts` follows gate calls only into src/app helpers: `action-support.ts` moved to `src/app/(app)/projects/` (59 sites; 15-24's per-root example now `paths.ts`).
5. K164: actions map AccessDeniedError to MEMBERSHIP_ENDED (15-05 helper, tests, greps; 15-01 18.1); routes answer 403, and 401/500 through `gate-failure.ts` (15-01, 15-21, the new route).
6. Rule B: every Phase 15 page and tenant-reaching layout starts with `requirePageAccess()` (15-09 to 15-12, 15-14 to 15-18, 15-20 to 15-22); 15-09's `loadSessionActor` redirects AccessDeniedError to `/no-access`.
7. `tests/unit/single-h1-route-list.test.ts`: every new page joins `APP_PAGE_ROUTES` in `tests/e2e/single-h1.spec.ts` with a rendering case (same plans; the drawer route in 15-18).
8. 15-18: the `(app)` layout has no "No workspace found" return any more; the edit keeps requirePageAccess first and the JoinWelcomeToast block.
9. 15-10: top-bar titles moved to `src/lib/navigation/page-title.ts` and the top bar renders a `<p>` (AIDA-36, K147); sidebar `navItems` `:26-32`, active test `:59`.
10. 15-21 and 15-01: the upload route reuses `readBoundedFormData` (Phase 8, D-24); Caddy and `proxyClientMaxBodySize` are now 32 MiB (`PROXY_BODY_LIMIT_BYTES`), so the pinned comparisons change.
11. 15-25: `tests/e2e/support/worker.ts` (`stopWorker`) is gone; `stopProcessTree` and `assertTreeStopped` of `tests/e2e/support/process-tree.ts` replace it; test:egress under rule J.
12. Line references updated: session.ts `:49`/`:73` (15-01, 15-05), proposals actions.ts lines (15-05), kb-proposals and ticket-statuses spec lines (15-05, 15-09), proposals page (15-09), render.ts `:460-480` (15-09, 15-18), schema SavedView `:683-700`, Project `:1032`, organization `:107`, Task `:1168` (15-01, 15-02, 15-07), scoped-db DOMAIN_MODELS `:14-66` (15-02), (app) layout `:39`/`:49` (15-02, 15-10), projects/attachments.ts `:222-231`, `:55-134` (15-01, 15-18); 15-CONTEXT carries the rest in its revision section.
13. Checked, no change needed: no plan adds a settings tab (order pinned in `tests/e2e/backups-status.spec.ts`); Phase 14 services other than attachments.ts and file-cleanup.ts are unchanged since planning, so their line references stand.

Not done in revision 4 (for the next reviser): folding the Revision 4 sections into the task bodies, truths and greps of the named plans; recounting 15-24's manifest; the inline 15-12 test texts.
