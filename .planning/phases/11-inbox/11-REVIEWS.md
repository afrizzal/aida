# Phase 11: Inbox — Plan Reviews

Reviews run under `run-loop/PIAGAM.md` step 5: Codex reads a `git archive` export of `HEAD` and gives opinions only. The orchestrator re-checked the factual claims before setting a disposition. The planner must carry every accepted item into the relevant PLAN.md, with a `## Review Dispositions Ledger` / `### Round 1 — <REVIEWS sha>` block in each changed plan.

## Codex

### Cycle 1

- Question: `run-loop/codex/fase11-plan-tanya.md` (commit `5ebd48b`); answer: `run-loop/codex/fase11-plan-jawab.md`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`.
- Codex verdict: not ready (6 HIGH, 3 MEDIUM). Codex confirms as planned: the three ordinary customer-reply race orders with lock-first, the migration (trigger, partial indexes, `migrate deploy` and `diff`, the `aida-dev-db` precondition), the blocked egress suites and the open visual checks; the `pg_blocking_pids` holder predicate itself has no relation-lock defect. Execution results are unverified.

| ID | Severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| C1 | HIGH | `addTag` keeps its find-or-create of the tag before calling the service, so a revoked member can create tags and a refused ticket mutation can leave a new tag behind | Verified: 11-02 line 130 (find-or-create in the wrapper) and line 94 (membership check only inside the service transaction) | accept |
| C2 | HIGH | The priority change drops two SLA side effects: the old action also writes `firstResponseTargetMinutes` and `resolutionTargetMinutes`, which the SLA job uses for its at-risk threshold | Verified: `src/app/(app)/tickets/[id]/actions.ts:66-75`; 11-02 line 122 lists only the due dates and flags; `src/lib/worker/jobs/sla-flag.ts:27` reads the targets | accept |
| C3 | HIGH | Auto-close can miss a public message being written: the quiet condition reads the newest PUBLIC message, but an agent's public reply does not touch the ticket row and an uncommitted message is invisible to the job's snapshot; automatic mail also skips the lock | Verified: 11-04 line 129 (`GREATEST(resolvedAt, enabledAt, newest PUBLIC message)`); `src/app/api/tickets/[id]/messages/route.ts:113-117` (an agent reply updates the ticket only for the first response and never changes status) | accept, narrowed: remove the message rule instead of serialising every message write (see required properties) |
| C4 | HIGH | The dispatcher handles `Meta/Ctrl+K` before the `defaultPrevented`, `repeat` and `isComposing` guards, contrary to D-13 | Verified: 11-08 line 122 (rule order) | accept |
| C5 | HIGH | Error-contract contradiction: Task 1 rethrows any error that is not a `TicketMutationError`, while the Task 3 rollback test expects the hook's sentinel error to be returned | Verified: 11-02 lines 95 and 156 | accept |
| C6 | HIGH | `waitForWaiters` counts every waiting backend; the bulk concurrency proof uses it as evidence that both bulk runs are queued, so any other backend can satisfy it | Verified: 11-01 line 162; 11-02 line 160 | accept |
| C7 | MEDIUM | Saved-view permissions are not proven against a concurrent visibility change (an admin reads a shared view just before the owner makes it private); in 11-02, a membership check inside the transaction does not by itself serialise against a concurrent member removal | Verified: 11-03 Task 2 tests permissions and concurrent edits but not this order | accept |
| C8 | MEDIUM | The job reads the auto-close setting before each ticket's transaction and never re-checks it, so a close can follow a setting that was just turned off or lengthened | Verified: 11-04 lines 127-129 | accept |
| C9 | MEDIUM | The chord hint has no timer, so it can stay visible after one second when no further key arrives, contrary to UI-SPEC 5d | Verified: 11-08 Tasks 1-2 decide expiry only on the next event; UI-SPEC line 343 | accept |

### Required properties for the replan

- **C1:** `addTag` by name runs entirely inside the service transaction, in this order: actor membership, find-or-create of the tag in the organization, ticket lock, mutation, audit. Tests: a revoked actor and an unavailable ticket each leave the organization's tag count unchanged.
- **C2:** a priority change writes `priority`, `firstResponseTargetMinutes`, `resolutionTargetMinutes`, both due dates and both flag resets in one write, exactly as the old action did. A test changes priority between levels with different targets and checks the stored targets and due dates; parity with the old action is stated in the plan.
- **C3:** amend D-16 with a dated note: the quiet period starts at the later of `resolvedAt` and `autoCloseEnabledAt`; messages are not read. A real customer reply reopens the ticket under the D-17 lock; agent replies and automatic mail on a resolved ticket do not restart the period, and the auto-close card and docs say so. The job's candidate query and its conditional `UPDATE` no longer read `Message`. Remove every test, truth and UI-SPEC row that depends on the message rule, or rewrite it to the new rule.
- **C4:** the universal guards (`defaultPrevented`, `repeat`, `isComposing`) run before the `⌘K`/`Ctrl+K` exception; the exception keeps only the editable-target case. Unit tests cover each guard combined with `Meta+K` and `Ctrl+K`.
- **C5:** one error contract. The rollback seam throws a sentinel that is not a `TicketMutationError`; the test asserts the call rejects with that sentinel, then checks that nothing was written. Alternatively the sentinel is a `TicketMutationError` and the test asserts the exact `{ ok: false, error }`. Task 1 and Task 3 say the same thing.
- **C6:** every concurrency proof records the PID of each run (for example with `pg_backend_pid()` from a hook) and waits for those PIDs specifically, each blocked by the expected holder; no helper counts anonymous waiters. The same applies to the 11-04 race tests and any other caller.
- **C7:** saved-view update and delete lock the view row (or use a conditional update on owner, visibility and organization) and re-check permission and visibility inside the transaction; a test forces both orders of "owner makes the view private" against "admin edits it". For 11-02, the plan states what a member removal racing a mutation guarantees, and tests it if a guarantee is claimed.
- **C8:** the close statement reads the setting inside the same statement (or locks the setting row first), and the plan defines the behaviour: a setting change applies to closes that start after it commits. A test forces both orders of "admin turns auto-close off" and "job closes".
- **C9:** a timer clears the chord hint after `CHORD_TIMEOUT_MS`; it is cleared on completion, cancel, navigation and unmount. A test proves the hint disappears with no further key.
