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
