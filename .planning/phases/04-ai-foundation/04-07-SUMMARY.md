---
phase: 04-ai-foundation
plan: 07
subsystem: ui
tags: [radix-ui, react-select, react-hook-form, playwright, e2e, settings]

# Dependency graph
requires:
  - phase: 04-ai-foundation
    provides: "04-04's Settings -> AI Features provider/model Select form; 04-04's D-01 decision (provider switch resets model to catalog[0]); 04-06's ticket-page triage UI exercised by the same E2E spec"
provides:
  - "Model Select in llm-provider-form.tsx remounts per provider (key={provider}), structurally eliminating the Radix SelectBubbleInput stale-options race"
  - "tests/e2e/phase4-ai.spec.ts T2/T10 assert the provider-switch auto-reset directly (both switch directions), with the KNOWN-ISSUE explicit-pick workarounds removed"
  - "Phase 4 UAT test 2 gap closed — AIDA-13's acceptance is now fully satisfied end-to-end"
affects: [phase-04-close-out, settings-ui, e2e-regression-suite]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "React key-remount as the fix for a controlled-value + swapped-children race inside an upstream form-integrated component (Radix Select's hidden native <select> bridge) — remount takes the library's own proven-safe initial-mount code path instead of patching around the bug."

key-files:
  created: []
  modified:
    - "src/app/(app)/settings/llm-provider-form.tsx"
    - "tests/e2e/phase4-ai.spec.ts"

key-decisions:
  - "Applied the exact one-line fix pinned by the prior diagnose-only debug session (.planning/debug/model-select-clears-on-provider.md) verbatim: key={provider} on the Model <Select>, Provider <Select> and handleProviderChange left untouched."
  - "Both formatting drift blockers (llm-provider-form.tsx and phase4-ai.spec.ts had pre-existing biome format/import-order violations unrelated to this plan's edits) were resolved via biome --write since the plan's own verify/done criteria require biome-clean on these exact files and the fixes are purely mechanical (whitespace/import-order, zero logic change)."

patterns-established: []

requirements-completed: [AIDA-13]

# Metrics
duration: 21min
completed: 2026-07-18
---

# Phase 04 Plan 07: Model-select provider-switch gap closure Summary

**Keyed the Model `<Select>` by `provider` to force a remount on every provider switch, eliminating the upstream Radix `SelectBubbleInput` stale-options race that cleared the model field and blocked Save — closing Phase 4 UAT's last gap (test 2, AIDA-13).**

## Performance

- **Duration:** 21 min
- **Started:** 2026-07-18T09:46:29Z
- **Completed:** 2026-07-18T10:07:19Z
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments

- Applied the diagnosed one-line fix (`key={provider}` on the Model `<Select>`, `llm-provider-form.tsx:200`) — the previously-clobbered `modelSelect` form value now survives a provider switch because the Select subtree remounts in the same React commit `handleProviderChange` sets the new catalog's first entry, taking Radix's proven-safe initial-mount path instead of the buggy stale-options sync path.
- Reverted both T2 and T10's `KNOWN ISSUE` explicit-model-pick workarounds in `tests/e2e/phase4-ai.spec.ts` to assert the auto-reset behavior directly in both switch directions (openai->ollama in T2, ollama->openai in T10): trigger `toContainText` the new catalog's first model, no `data-placeholder` attribute, and `"Select a model"` renders zero times after a successful Save.
- Full `tests/e2e/phase4-ai.spec.ts` spec verified green 11/11 (Volta Node 22.23.1, Docker Desktop Testcontainers Postgres, real pg-boss worker, Ollama-protocol stub) — confirms the fix in the real browser/DOM, not just in isolation.
- Phase 4 UAT test 2 (`04-UAT.md`) is now ready for re-verification/re-mark as pass — AIDA-13's full acceptance statement ("selectable in settings") is achieved end-to-end.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add key={provider} to the Model Select** - `edcb651` (fix)
2. **Task 2: Revert T2/T10 workarounds, verify full spec green 11/11** - `4106f42` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/app/(app)/settings/llm-provider-form.tsx` - Model `<Select>` (line ~200) now carries `key={provider}`, forcing a full remount of the Select subtree on every provider change so the hidden Radix `SelectBubbleInput` native `<select>` never syncs a new value against a stale option set. `handleProviderChange` and the Provider `<Select>` are logically unchanged (only pre-existing formatting applied — see Deviations).
- `tests/e2e/phase4-ai.spec.ts` - T2 and T10 no longer explicitly click a model option after switching provider; both now assert the trigger auto-reset to the new catalog's first model (`toContainText`), assert no `data-placeholder` attribute, and assert `"Select a model"` renders zero times after Save succeeds. Both `KNOWN ISSUE` comments removed.

## Decisions Made

- Used the exact fix already pinned by the prior diagnose-only debug session (`.planning/debug/model-select-clears-on-provider.md`) verbatim — no re-diagnosis, no alternative mitigation (e.g. guarding `onValueChange` against `""`, or pinning a different `@radix-ui/react-select` version) considered, per the plan's explicit constraint.
- Both files this plan touched carried pre-existing biome format/import-order violations (multi-line import wrap, ternary wrap, prop wrap, import ordering) on lines unrelated to this plan's diff. Since the plan's own `<verify>`/`<done>` criteria require biome-clean on exactly these two files, and the fixes are purely mechanical formatting/import-order with zero behavior change, `biome check --write` was applied to both rather than deferring — this is a same-file, task-relevant blocker (Rule 3), not an unrelated-file drift item.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing biome formatting/import-order drift blocked the plan's own biome-clean verify gate**
- **Found during:** Task 1 (`llm-provider-form.tsx`) and Task 2 (`phase4-ai.spec.ts`)
- **Issue:** `node_modules/.bin/biome check` reported format violations (multi-line import wrap for `llm-provider-form.tsx`'s `@/components/ui/form` import, the `resolveModel` ternary, and the Provider `<Select>`'s prop wrap; import-sort order + several multi-line statement collapses in `phase4-ai.spec.ts`) on lines this plan never touched — pre-existing drift, not introduced by the `key={provider}` edit or the T2/T10 reverts.
- **Fix:** Ran `node_modules/.bin/biome check --write` on both files. Zero logic/behavior changes — whitespace and import-order only, confirmed via `git diff` review of each hunk.
- **Files modified:** `src/app/(app)/settings/llm-provider-form.tsx`, `tests/e2e/phase4-ai.spec.ts`
- **Verification:** `pnpm exec tsc --noEmit` and `node_modules/.bin/biome check <path>` both exit 0 on both files after the fix; the full E2E spec still passes 11/11 afterward.
- **Committed in:** `edcb651` (Task 1), `4106f42` (Task 2) — folded into each task's own commit since the reformatting is inseparable from making that task's verify gate pass.

**2. [Flake, not a deviation] First full-spec E2E run showed T7/T8 failing; second run passed 11/11**
- **Found during:** Task 2's hard-stop verification
- **Issue:** First `phase4-ai.spec.ts` run: 9 passed, 2 failed — T7 ("Re-run AI triage" button not visible after the failure->retry->success recovery cycle) and T8 (cascading: `triagedTicketId` module-scope variable read as `""`, consistent with Playwright reassigning a fresh worker process after T7's failure, resetting file-level state). T2 and T10 — the tests this plan actually changed — passed on the FIRST run already, directly proving the `key={provider}` fix and the reverted assertions both work.
- **Fix:** No code change. Re-ran the identical command; all 11 tests passed clean, including T7 and T8. This matches `04-UAT.md`'s prior recorded results (T7/T8 both `pass`) — nothing in this plan's diff touches the Re-run control or AI Activity section, so the first run's failure is treated as environment/timing flake, not a regression.
- **Files modified:** None
- **Verification:** Second run: `11 passed (2.3m)`.
- **Committed in:** N/A (no code change; the Task 2 commit reflects the fix verified by the passing run)

## Known Stubs

None — no new UI surfaces or data sources were added by this plan; it is a targeted bugfix + test-assertion change to an existing, fully-wired form.

## Next Steps

- Phase 4's `04-UAT.md` test 2 can be re-marked `pass` (gap closed) at the next phase-level close-out review — this plan does not itself edit `04-UAT.md`.
- No other Phase 4 gaps remain per the current `04-UAT.md` Gaps section (this was the only recorded gap).

## Self-Check: PASSED

- FOUND: `src/app/(app)/settings/llm-provider-form.tsx`
- FOUND: `tests/e2e/phase4-ai.spec.ts`
- FOUND: `.planning/phases/04-ai-foundation/04-07-SUMMARY.md`
- FOUND commit: `edcb651`
- FOUND commit: `4106f42`
