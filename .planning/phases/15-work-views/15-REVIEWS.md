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
