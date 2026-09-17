---
phase: 11-inbox
plan: 09
subsystem: e2e, docs, phase-gate
status: complete
tags: [keyboard, e2e, readme, phase-gate, design-system, evidence]
requires:
  - "11-04: auto-close card copy (the do-not-restart rule)"
  - "11-08: keyboard.spec.ts (13 cases), docs/KEYBOARD.md, the This ticket and Help palette groups"
provides:
  - "tests/e2e/keyboard.spec.ts: 17 cases (13 from 11-08 reused, 2 of them extended, 4 new)"
  - "README: Inbox workflow feature row and docs/KEYBOARD.md in Documentation"
  - ".planning/phases/11-inbox/11-GATE.md: gate table on 9523eac, baseline comparison, egress container listings, §9 checklist, requirement evidence, open items"
affects: [phase-11-verification, REQUIREMENTS.md (orchestrator), AIDA-54, AIDA-56, AIDA-80, AIDA-86]
tech-stack:
  added: []
  patterns:
    - "Gate rows name the commit, the exact command, the exit code read without a pipe and the log counts"
    - "Mechanical §9 answers from greps over added lines in the base..tested range, with a control grep proving each pattern matches elsewhere"
key-files:
  created:
    - .planning/phases/11-inbox/11-GATE.md
  modified:
    - tests/e2e/keyboard.spec.ts
    - README.md
decisions:
  - "11-08's keyboard cases were reused, not duplicated: the list case gained the Bulk actions region assertions and an Enter on the still-focused row (instead of re-focusing it), the ticket-page case gained the 'Pending' item; four new cases cover what 11-08 did not"
  - "The integration-without-egress command was run a second time with --reporter=verbose because the default reporter prints totals only; both runs are recorded (4a and 4b)"
metrics:
  duration: "~14 min"
  completed: 2026-11-08
actuals:
  tokens: 6100
  tasks: 3
  commits: 3
plan_head_before: 222504f4c1752bdd82c9125ccee1990132278d78
---

# Phase 11 Plan 09: Keyboard E2E, README note and phase gate Summary

The keyboard E2E now covers the empty list, letters typed into the composer, `?` typed into the search input, and the palette's Change status and Show keyboard shortcuts. The README describes the inbox features. The charter gate ran on `9523eac`: lint, typecheck, unit, integration without egress, full E2E and build are green. `pnpm audit --prod` is red at the baseline counts. The two egress-driven suites are blocked (O-1). Every human and owner item is still open.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Keyboard E2E across list, ticket page, help and palette, plus the README note | 9523eac | `pnpm test:e2e tests/e2e/keyboard.spec.ts` exit 0, 17 passed; biome exit 0 |
| 2 | Run the charter's phase gate and record every result | ae68345 | 11-GATE.md gate table; see below |
| 3 | DESIGN-SYSTEM §9 checklist, requirement evidence and open items | f65b883 | 11-GATE.md sections; acceptance greps pass |

Tracer gate: Task 1's `<verify>` passed (exit 0, 17/17) before Task 2 started. There was no human checkpoint, per the run charter.

## Keyboard E2E: reused, extended, new

The plan's five cases, mapped to 11-08's spec:

- **(1) List**
  - Reused: 11-08's "j and k move focus … Enter opens".
  - Extended in 11-09: the `region` "Bulk actions" contains "1 ticket selected" after x and is gone after Escape. The first row is still focused after Escape, and Enter opens it without a manual `focus()`.
- **(2) Empty list**
  - New: "j and k on an empty list focus nothing". There is no `ticket-row-` link, and the active element is still `body`.
- **(3) Ticket page**
  - Reused: 11-08's s/a/t/r/n case.
  - Extended in 11-09: after s, a `menuitemradio` "Pending" is visible.
  - New: "letters typed into the internal-note composer stay in it". After n and then s, no menu opens, the textarea keeps focus and its value ends in s.
- **(4) Help**
  - Reused: 11-08's "? opens the help modal with every section".
  - New: "? typed into the inbox search input opens no dialog".
- **(5) Palette groups**
  - New: "the palette's Change status opens the status menu, and Show keyboard shortcuts opens help". Escape closes the menu before the second Meta+k (Codex C4).
  - 11-08's This ticket case ("Write an internal note") and Help item case stay as they are.

`grep -c "test(" tests/e2e/keyboard.spec.ts` gives 17.

## Gate (tested commit 9523eac, details in 11-GATE.md)

| Command | State | Exit | Counts |
|---------|-------|------|--------|
| `pnpm lint` | passed | 0 | 330 files |
| `pnpm typecheck` | passed | 0 | clean |
| `pnpm test` | passed | 0 | 21 files, 222 tests |
| `pnpm test:integration` (as-is) | blocked (O-1) | not run | starts compose project aida-egress-test |
| `pnpm exec vitest run --config vitest.integration.config.ts --exclude tests/integration/egress-isolation.test.ts` | passed | 0 | 18 files, 129 tests; verbose rerun exit 0, the same counts, egress file absent |
| `pnpm test:egress` | blocked (O-1) | not run | starts compose project aida-egress-test |
| `pnpm test:e2e` (full) | passed | 0 | 111 passed, 1 skipped (existing uat-gaps skip), 0 failed |
| `pnpm build` | passed | 0 | the one known Turbopack NFT warning |
| `pnpm audit --prod` | failed | 1 | 7 critical, 52 high, 69 moderate, 13 low |

Baseline comparison: Phase 11 makes none of the baseline facts worse.

- **Audit:** counts identical to the baseline. `package.json` and `pnpm-lock.yaml` are unchanged since `1e5c0f3`.
- **honesty-invariants:** passed 2/2 in the full run. One green run does not prove the flakes are gone, so they are not claimed fixed.
- **Teardown:** the Windows-only `taskkill` still prints "command not found" 3 times. It does not fail the run, and no process was left running.
- **Unchanged:** the skip count and the build warning.

The `aida-egress-test` container listings were empty before, during and after the gate. No `.next` deletion was needed.

## Deviations from Plan

1. **[Rule 3 - Evidence] Second integration run.** The default vitest reporter printed only totals, so the log could not show which files ran. I reran the same command with `--reporter=verbose` appended. Both runs passed, and both are recorded as rows 4a and 4b.
2. **Wording fix in 11-GATE.md before the Task 3 commit.** Row 6 first called inbox, mutations and reading-pane "Phase 11 specs". They predate Phase 11, and the row now says so.
3. **No state mutation.** STATE.md, ROADMAP.md and REQUIREMENTS.md were not edited, and no gsd-tools state, roadmap or requirements command ran. The orchestrator owns these.

## Open items (copied from 11-GATE.md, manual, left open)

1. **Visual approval (human):** the Views section, the strip and its notices, the save, edit and delete dialogs, the checked rows with the cursor ring, the bulk bar, the palette, the help modal and its key caps, the chord hint and the auto-close card.
2. **Dark-mode review (human), DESIGN-SYSTEM §7:** the same surfaces. This item is open (human). a11y-contrast 8/8 covers only the KB pages and the ticket page's draft card.
3. **D-14 screen-reader check:** single-letter keys against reading-mode keys, j/k row announcement, and the bulk count announcement.
4. **Backstop measurements at 360px not taken:** the palette rows, the help modal's longest action and the chord hint.
5. **O-1:** container tests on the shared Docker VM. `pnpm test:integration` as-is and `pnpm test:egress` stay blocked.
6. **O-2:** an automatic fixed-template customer notice on auto-close. Nothing is sent until the owner decides (D-19).
7. **O-3:** unparking Phases 8, 9 and 10.
8. **AIDA-43 stays open:** older pages and actions still lack the membership check (D-01).
9. **Cross-phase risks now triggered:**
   - The saved-view part of AIDA-56 (`SavedView` exists).
   - The auto-close parts of AIDA-54 and AIDA-56 (the job is registered).
   - AIDA-86 and AIDA-80, which build on the AIDA-49 registry and the AIDA-47 view model.
10. **Baseline debt, not worsened:**
    - audit: 7 critical, 52 high.
    - The Windows-only `taskkill` teardown.
    - The honesty-invariants flakes.
    - The NFT build warning.
    - The one skipped uat-gaps case.
11. **Residual from the 11-07 follow-up:** typing in the contacts search and leaving within 300 ms can still be overridden by its debounced replace.

AIDA-47 to AIDA-51 are not marked complete here. Their evidence is in 11-GATE.md, "Requirement evidence".

## Threat model dispositions

- T-11-40: mitigated. Each gate row names the commit, the command, the exit code and the log counts. The audit row stays red.
- T-11-41: mitigated. Neither egress-driven suite ran. The `aida-egress-test` listings before and after were empty.
- T-11-42: mitigated. Every visual, dark-mode and screen-reader item is written as open. No UAT result was filled in.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: tests/e2e/keyboard.spec.ts, README.md, .planning/phases/11-inbox/11-GATE.md
- FOUND commits: 9523eac, ae68345, f65b883
