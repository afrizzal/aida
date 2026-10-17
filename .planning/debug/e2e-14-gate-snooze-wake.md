---
status: awaiting_human_verify
trigger: "Phase 14 final gate on 41b1597: tests/e2e/snooze.spec.ts:101 'the wake job brings a ticket whose deadline passed back to the inbox' got result.woken 0 from snoozeWakeHandler(undefined, { now: new Date() }), expected >= 1"
created: 2026-11-09T23:45:00Z
updated: 2026-11-10T00:20:00Z
---

## Current Focus

hypothesis: a worker started by an earlier spec (honesty-invariants, phase4-ai, phase5-rag) is never stopped on macOS (afterAll runs `taskkill`, which does not exist; the error is swallowed), so its every-minute `snooze-wake` schedule wakes the test ticket between the seed UPDATE and the in-test handler call
bug_class: Mandelbug (timing-dependent: only when a minute-boundary job lands inside the ~0.4-2.4 s window)
test: temporary diag spec run after phase4-ai.spec.ts; seed a ticket due 60 s ago, never call the handler, poll until snoozedUntil is null; record pgrep of src/lib/worker/index.ts
expecting: H true -> ticket woken by a SYSTEM WOKEN without the test calling the handler, worker pid visible; H false -> poll times out
next_action: write tests/e2e/zz-diag-stray-worker.spec.ts (temporary, never committed) and run it after phase4-ai.spec.ts

## Symptoms

expected: snoozeWakeHandler wakes the seeded due ticket (woken >= 1)
actual: woken 0 (370 ms test), every other snooze test passed; 208 passed, 1 failed
errors: expect(received).toBeGreaterThanOrEqual(expected) at snooze.spec.ts:112
reproduction: full pnpm test:e2e on macOS; intermittent
started: first macOS full E2E run (specs were written on Windows)

## Eliminated

- hypothesis: clock skew or data (another due ticket, wrong org) makes the handler find nothing
  evidence: diag run shows the seeded ticket woken by a SYSTEM WOKEN 6.5 s after seeding with no in-test handler call, from a live worker pid of phase4-ai.spec.ts; nothing else is needed to explain woken 0
  timestamp: 2026-11-09T23:55:00Z

## Evidence

- timestamp: 2026-11-09T23:45:00Z
  checked: gate log ${TMPDIR}aida-14-finalgate-e2e.log
  found: "/bin/sh: taskkill: command not found" three times, right after honesty-invariants (line 331), phase4-ai (613) and phase5-rag (646); all run before snooze.spec.ts (alphabetical, workers 1)
  implication: those three afterAll hooks never stopped their worker; the catch swallows the error
- timestamp: 2026-11-09T23:45:00Z
  checked: src/lib/worker/index.ts lines 55-59; tests/e2e/kb-proposals.spec.ts stopWorker
  found: every worker schedules snooze-wake "* * * * *" and runs snoozeWakeHandler on any due ticket of any org; kb-proposals alone stops its worker portably (SIGTERM off Windows) and waits for close
  implication: a live stray worker can wake the snooze test's ticket before the test's own handler call

- timestamp: 2026-11-09T23:55:00Z
  checked: run1 (before fix) playwright phase4-ai.spec.ts + temporary zz-diag-stray-worker.spec.ts, exit 0, 12 passed
  found: "/bin/sh: taskkill: command not found"; in the next file pgrep shows phase4-ai's worker alive (tsx 79925, child 79926); the diag ticket seeded due at 16:39:07.004Z was woken by actorType SYSTEM at 16:39:13.545Z with no handler call in the test
  implication: H confirmed; a stray worker's scheduled snooze-wake wakes due tickets of later files, so snooze.spec.ts:101's own handler call finds 0 when a run lands inside its window

reasoning_checkpoint:
  hypothesis: snooze.spec.ts:101 got woken 0 because the stray worker of an earlier spec (taskkill missing on macOS, error swallowed) ran its every-minute snooze-wake between the seed UPDATE and the in-test handler call
  confirming_evidence: [3x taskkill not found in gate log, live worker pid observed in a later file, SYSTEM WOKEN by no in-test call]
  falsification_test: after a portable stop, the same diag finds no worker and its ticket stays snoozed for 90 s
  fix_rationale: stop each spawned worker with SIGTERM off Windows and await close, so no worker or its schedules outlive the file that started it
  blind_spots: a worker started by a developer outside the run cannot reach the per-run Testcontainers DB, so it is not a factor
  candidate_causes: [environment (macOS lacks taskkill), code (test teardown swallows the error and never awaits exit), data (other due tickets), clock]
  and_gate: yes; needs a live stray worker AND its minute tick landing in the window, which is why it is intermittent

## Resolution

root_cause: honesty-invariants, phase4-ai and phase5-rag stop their spawned worker with `taskkill` only and swallow its failure; on macOS the worker keeps running into later files and its scheduled snooze-wake wakes snooze.spec.ts:101's due ticket first
fix: tests/e2e/support/worker.ts stopWorker (taskkill on win32, SIGTERM elsewhere, await close, 60 s bound) used by the three afterAll hooks
verification: |
  run2 control (after fix) phase4-ai + temporary diag: exit 1 as predicted; no taskkill error, diag sees no worker process, diag ticket stayed snoozed for the full 90 s poll (falsification test passed: the stray-worker wake is gone)
  run3 honesty-invariants + phase4-ai + phase5-rag + snooze: exit 0, 34 passed, 0 taskkill errors, no worker/dev-server process left
  run4 full pnpm test:e2e: exit 0, 209 passed, 1 skipped (uat-gaps.spec.ts:17, skipped in the gate run too), snooze.spec.ts:101 passed, 0 taskkill errors, no worker/dev-server process and no org.testcontainers=true container left
  tsc --noEmit exit 0; biome check of the 4 files clean; temporary diag spec deleted, never committed
guardrail_verdict: accepted
files_changed: [tests/e2e/support/worker.ts, tests/e2e/phase4-ai.spec.ts, tests/e2e/phase5-rag.spec.ts, tests/e2e/honesty-invariants.spec.ts]
