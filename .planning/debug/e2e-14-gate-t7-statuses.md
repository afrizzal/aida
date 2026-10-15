---
status: awaiting_human_verify
trigger: "Phase 14 gate on 4d6a498: pnpm test:e2e red; phase4-ai.spec.ts:387 T7 (Re-run AI triage button not found), T8 (triagedTicketId empty), ticket-statuses.spec.ts:313 (row Options button not found); 15 did not run"
created: 2026-11-09T22:00:00+07:00
updated: 2026-11-09T22:30:00+07:00
---

## Current Focus

bug_class: Heisenbug (timing; two independent races)
hypothesis_A (T7): the failed ai-triage job J1 is retried by pg-boss (retryLimit 2, retryDelay 0 -> immediate, picked up at the next worker poll); when that retry runs after the test sets stub.mode="ok" and before rerunTriage writes PENDING, the poll sees COMPLETED early, rerunTriage then overwrites it with PENDING, and the server-rendered page shows "Triaging..." with no Re-run button.
hypothesis_B (statuses:313): better-auth cookieCache maxAge 5 min + nextCookies; a server action run >5 min after the global-setup sign-in re-sets session_data, so Next re-renders the page in the action response; the soft-deleted ghost row vanishes and its Options button cannot be focused.
next_action: apply the test-only fixes, then Run B (fix plus the cookie probe moved before the renewal), then full pnpm test:e2e.
reasoning_checkpoint:
  hypothesis: "A: T7 races pg-boss's immediate automatic retry of the failed job against the manual Re-run. B: statuses:313 fails once the storage-state cookie cache is >5 min old, because the server action re-sets the cookie and Next re-renders the page."
  confirming_evidence: ["Run A: 1 pending ai-triage job right after FAILED", "Run A: clearing session_data reproduces the gate failure exactly", "gate snapshot: Triaging... with AI Activity (2) and two rerunTriage calls", "summed durations: test 186 at ~280 s (12.2) vs ~300 s (14)"]
  falsification_test: "A: T7 still red after waiting for no pending job. B: statuses:313 still red with session_data cleared and then renewed via get-session?disableCookieCache=true before the page loads"
  fix_rationale: "A: the Re-run click becomes the only job that can complete triage. B: every statuses test starts with a just-renewed cookie cache, so no action response re-renders the page"
  blind_spots: "exact wall-clock offset of test 186 since sign-in not logged; other specs past 5 min may hold similar latent refresh dependencies"
  candidate_causes: ["code (test): race and stale-cookie precondition", "environment: suite length crossing 300 s, pg-boss polling timing", "data: shared E2E DB (eliminated, fresh container)"]
  and_gate: "yes for B: needs cookie age >300 s AND a refusal path that keeps a server-deleted row; for A: needs the retry to finish between stub switch and the PENDING write"

## Symptoms

expected: T7, T8 and ticket-statuses:313 pass as on the 12.2 final gate (1a2f425, 209 passed)
actual: T7 times out at line 427 with the page showing "Triaging..." and "AI Activity (2)"; T8 fails because T7 did not leave triagedTicketId; statuses:313 shows the DEFAULT_ERROR_DELETED alert but the ghost row is gone from the list
errors: getByRole('button', { name: 'Re-run AI triage' }) not found; getByRole('button', { name: 'Options for "Ghost default ..."' }) not found
reproduction: full pnpm test:e2e on 4d6a498 (aida-14-gate-e2e.log)
started: first seen on the Phase 14 gate; Phase 14 changed nothing under src/app, src/components, tests/e2e

## Eliminated

- hypothesis: shared E2E data left by Phase 14 tests
  evidence: E2E DB is a fresh testcontainer per run (global-setup.ts); Phase 14 added no E2E spec and no change under tests/e2e, src/app, src/components, src/lib/triage, src/lib/llm
  timestamp: 2026-11-09T22:10
- hypothesis: orphan or competing worker process
  evidence: no worker/next/playwright process alive now; ai-triage registration unchanged in the worker diff (only a new project-file-cleanup queue)
  timestamp: 2026-11-09T22:10

## Evidence

- timestamp: 2026-11-09T22:05
  checked: T7 error-context.md snapshot
  found: chip text "Triaging..." (triageStatus PENDING) and "AI Activity (2)"; server log shows exactly two rerunTriage calls
  implication: COMPLETED was observed by the poll, then the second rerunTriage's PENDING write landed; only a job running before that write with stub ok can explain one extra success (failures write no audit row) -> J1's automatic retry
- timestamp: 2026-11-09T22:08
  checked: worker ai-triage queue options and pg-boss 12.23 retry SQL
  found: retryLimit 2, retryBackoff true, retryDelay unset (default 0) -> start_after = now() + LEAST(300, 0 * ...) = now(); runTriage sets FAILED and rethrows
  implication: J1 is retried right away (at the next poll), racing the manual re-run
- timestamp: 2026-11-09T22:15
  checked: statuses:313 snapshot and server log
  found: alert present, ghost row absent, no GET after the refused setDefaultStatusAction POST; action does not revalidate on refusal; auth.ts cookieCache maxAge 300 s with nextCookies()
  implication: the re-render came inside the action response (cookie set in a server action)
- timestamp: 2026-11-09T22:20
  checked: summed per-test durations in both gate logs
  found: test 186 starts at about 279.8 s (12.2) versus 300.1 s (14) of summed test time after global setup
  implication: test 186 crossed the 5-minute cookie-cache age on the 14 run (T7's 7.5 s timeout adds to it)

- timestamp: 2026-11-09T22:40
  checked: Run A (aida-14-dbg-runA-probes.log), both specs on HEAD plus two temporary probes, exit 1, 13 passed, 3 failed, 15 did not run
  found: T7 probe right after the FAILED poll: pendingTriageJobs = 1 (expected 0), so a pg-boss retry of the failed job is in flight while the test switches the stub and clicks Re-run; statuses:313 with the session_data cookie cleared at test start fails exactly like the gate (alert shown, ghost row gone, Options button not found)
  implication: both mechanisms reproduced on demand

- timestamp: 2026-11-09T22:55
  checked: Run B (aida-14-dbg-runB-fix-probe.log), both specs with the fixes and the cookie cleared just before the renewal, exit 0, 31 passed
  found: T7 passes (8.7 s, waits out two retries); statuses:313 passes although the cookie cache was cleared at test start
  implication: each fix removes its trigger; falsification tests did not fire

## Resolution

root_cause: "A (T7, and T8 by its shared state): pg-boss retries the failed ai-triage job immediately (retryLimit 2, retryDelay 0); a retry finishing with the stub already 'ok' between the stub switch and rerunTriage's PENDING write lets the COMPLETED poll pass early, and the page then renders PENDING ('Triaging...') for the Re-run's own job; B (statuses:313): every test reuses the global-setup storage state; past 300 s the better-auth cookieCache (maxAge 5 min, nextCookies) is renewed inside the server action, so Next re-renders /settings/statuses in the refusal response and the server-deleted ghost row and its Options button vanish; the 14 run reached test 186 after ~300 s of test time (12.2: ~280 s)"
fix: "tests/e2e/phase4-ai.spec.ts: wait until no ai-triage job for the ticket is created/retry/active before switching the stub to ok; tests/e2e/ticket-statuses.spec.ts: beforeEach renews the cookie cache via /api/auth/get-session?disableCookieCache=true and asserts the new cookie"
oracle_type: specified (existing assertions unchanged)
verification: "Run A red with probes (pending=1; statuses failure reproduced); Run B green (31 passed); biome and tsc clean; full pnpm test:e2e exit 0, 209 passed, 1 skipped, 0 failed (aida-14-dbg-full-e2e.log); commits 1092d7a, 059b3e9"
files_changed: [tests/e2e/phase4-ai.spec.ts, tests/e2e/ticket-statuses.spec.ts]
