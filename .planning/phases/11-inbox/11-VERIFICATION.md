---
phase: 11-inbox
verified: 2026-11-08T13:00:00Z
status: human_needed
score: 5/5 roadmap success criteria verified (requirements AIDA-47 to AIDA-51 verified in code and tests; charter-suite and owner items open)
covered_files: [".planning/REQUIREMENTS.md", ".planning/phases/11-inbox/11-01-PLAN.md", ".planning/phases/11-inbox/11-01-SUMMARY.md", ".planning/phases/11-inbox/11-02-PLAN.md", ".planning/phases/11-inbox/11-02-SUMMARY.md", ".planning/phases/11-inbox/11-03-PLAN.md", ".planning/phases/11-inbox/11-03-SUMMARY.md", ".planning/phases/11-inbox/11-04-PLAN.md", ".planning/phases/11-inbox/11-04-SUMMARY.md", ".planning/phases/11-inbox/11-05-PLAN.md", ".planning/phases/11-inbox/11-05-SUMMARY.md", ".planning/phases/11-inbox/11-06-PLAN.md", ".planning/phases/11-inbox/11-06-SUMMARY.md", ".planning/phases/11-inbox/11-07-PLAN.md", ".planning/phases/11-inbox/11-07-SUMMARY.md", ".planning/phases/11-inbox/11-08-PLAN.md", ".planning/phases/11-inbox/11-08-SUMMARY.md", ".planning/phases/11-inbox/11-09-PLAN.md", ".planning/phases/11-inbox/11-09-SUMMARY.md", "docs/KEYBOARD.md", "prisma/migrations/20261108140000_inbox/migration.sql", "src/app/(app)/layout.tsx", "src/app/(app)/tickets/[id]/actions.ts", "src/app/(app)/tickets/bulk-action-bar.tsx", "src/app/(app)/tickets/bulk-actions.ts", "src/app/(app)/tickets/ticket-selection.tsx", "src/components/command-palette.tsx", "src/components/sidebar-views.tsx", "src/lib/commands/registry.ts", "src/lib/keyboard/dispatch.ts", "src/lib/keyboard/keymap.ts", "src/lib/membership.ts", "src/lib/saved-views/service.ts", "src/lib/saved-views/ui-state.ts", "src/lib/tickets/auto-close-settings.ts", "src/lib/tickets/list-filters.ts", "src/lib/tickets/mutations.ts", "src/lib/tickets/palette-search.ts", "src/lib/tickets/reopen-on-reply.ts", "src/lib/worker/index.ts", "src/lib/worker/jobs/auto-close.ts"]
covered_digest: "v1:sha256:fba5707c2b1ec894c5d2eb229673ca1fd4932c3f3cbe03f8036b2d6564f14717"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Visual approval of the Views section, saved-view strip and notices, save/edit/delete dialogs, checked rows with cursor ring, bulk bar, command palette, help modal key caps, chord hint and auto-close card"
    expected: "Each surface matches 11-UI-SPEC.md and DESIGN-SYSTEM.md"
    why_human: "Look and feel; no visual pass is claimed by any run"
  - test: "Dark-mode review of the same surfaces (DESIGN-SYSTEM section 7)"
    expected: "Readable contrast and token-correct colours in dark mode"
    why_human: "a11y-contrast.spec.ts does not cover the Phase 11 surfaces"
  - test: "360px backstops: auto-close card (11-04), strip and broken-reference notice, 200-char search/cf summary, delete title (11-05), 255-char member and 100-char tag in pickers (11-06), palette rows (11-07), help modal longest action and chord hint (11-08)"
    expected: "No horizontal scroll; truncation or wrapping as each backstop statement says"
    why_human: "Backstop truths (verification: backstop) with no explicit evidence -> insufficient_spec"
  - test: "Backstop 11-06: a bulk status change that moves some selected tickets out of the current filter"
    expected: "Remaining selected tickets stay checked, moved ones drop from the selection, the bar count matches"
    why_human: "Pruning code exists in ticket-selection.tsx but no test exercises this case -> insufficient_spec"
  - test: "D-14 screen-reader check of single-letter keys, j/k row announcement, bulk count announcement"
    expected: "No clash with reading-mode keys; row and count are announced"
    why_human: "Assistive-technology behaviour; D-14 says never claimed as passed"
  - test: "Owner item O-1: decide how container tests may run, then run pnpm test:integration (full) and pnpm test:egress"
    expected: "Both exit 0"
    why_human: "Blocked by owner decision O-1 (run-loop K26); the charter's test:egress gate is open"
  - test: "Owner item O-2: whether a fixed-template auto-close notice may reach customers without per-send approval"
    expected: "Owner decision recorded"
    why_human: "Owner decision; D-19 builds no notice, which satisfies AIDA-51's 'off by default'"
---

# Phase 11: Inbox Verification Report

**Phase Goal:** An agent can work the inbox fast: saved views, batch actions, and the keyboard.
**Verified:** 2026-11-08 (HEAD `866b1ed`; code identical to gate commit `47fc015`, `git diff --stat 47fc015 866b1ed` touches only `.planning/`)
**Status:** human_needed
**Re-verification:** No (initial verification)

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Private and shared views persist, and shared views never cross organizations | VERIFIED | `SavedView` + partial unique indexes in `prisma/migrations/20261108140000_inbox/migration.sql:77,81`; `src/lib/saved-views/service.ts` calls `findActiveMembership`; integration `saved-views.test.ts` (unmocked Testcontainers, other-org member sees neither view) passed in the 47fc015 gate (142/142 without egress); E2E `saved-views.spec.ts` |
| 2 | A bulk action applies to all selected tickets or none, with one audit entry per ticket | VERIFIED | `src/lib/tickets/mutations.ts:35` cap 100, `:251` `FOR UPDATE` in id order, one transaction; `bulk-actions.ts:40` and the five single actions (`[id]/actions.ts:44,64,197,213,224`) use `runTicketMutation`; append-only trigger `migration.sql:97-106`; integration `ticket-mutations.test.ts` rollback seam, cross-org refusal, dedupe; E2E `bulk-actions.spec.ts` (11 cases incl. F1 pending lock) |
| 3 | `⌘K` and `Ctrl+K` open the palette, and its commands change with the page | VERIFIED | `src/lib/commands/registry.ts` (register/unregister, duplicate id throws); `command-palette.tsx`; membership-checked `palette-search.ts`; E2E `command-palette.spec.ts` and `keyboard.spec.ts` (both shortcuts, This ticket group); unit `command-registry.test.ts` |
| 4 | Inbox and ticket page work by keyboard, keystrokes ignored inside inputs, `?` lists keys | VERIFIED | `src/lib/keyboard/dispatch.ts:25` 1000 ms chord, `:95-123` guards (defaultPrevented, repeat, isComposing, modifiers, editable, overlays); `docs/KEYBOARD.md` with parity unit test `keyboard-dispatch.test.ts:335`; E2E `keyboard.spec.ts` (inputs and composer keep keys, `?` modal) |
| 5 | Resolved tickets close after the configured quiet period, and 0 turns it off | VERIFIED | `src/lib/worker/jobs/auto-close.ts:67,209` (0 = off), `:78,221` conditional RESOLVED re-check, `:87-90` SYSTEM `AUTO_CLOSED` audit, `:225` LIMIT 100, `:190` per-org failure isolation; scheduled daily `src/lib/worker/index.ts:41-45`; reply paths lock then reopen (`reopen-on-reply.ts:57`, imported by `ingest-message.ts:15` and `follow-up/route.ts:9`); integration `auto-close.test.ts`, `reply-reopen-race.test.ts`; E2E `auto-close.spec.ts` |

**Score:** 5/5 truths verified (0 present, behavior-unverified). Behaviour-dependent truths (rollback, races, chord expiry) are covered by named tests that passed in the final gate rerun on `47fc015`.

### Backstop truths (UI Considerations / plan must_haves)

| Backstop | Status | Evidence |
|----------|--------|----------|
| E1 Views error: sidebar falls back to empty, logs | VERIFIED | `ui-state.ts:26` `sidebarViewsOrEmpty`, used in `(app)/layout.tsx:44`; integration `saved-views-ui-state.test.ts:67` rejected loader resolves to empty lists |
| 11-08 keymap parity test | VERIFIED | `tests/unit/keyboard-dispatch.test.ts:335` |
| 360px / long-text backstops (11-04, 11-05 x3, 11-06 picker, 11-07, 11-08 x2) | insufficient_spec | No measurement taken (gate open item 4) -> human |
| 11-06 bulk status moves tickets out of filter | insufficient_spec | Prune logic in `ticket-selection.tsx`, no test -> human |
| 11-09 screen reader and visual/dark mode | human | D-14, gate open items 1-3 |

### Requirements Coverage

| Requirement | Status | Evidence / reason |
|-------------|--------|-------------------|
| AIDA-47 | SATISFIED | Shared zod schema `list-filters.ts`; unmocked isolation test; sidebar `sidebar-views.tsx` uses only `sidebar-*` colour tokens (gate §9) |
| AIDA-48 | SATISFIED | One transaction, one audit row per ticket, rollback test (see truth 2) |
| AIDA-49 | SATISFIED | E2E per group; registry accepts commands from list, ticket page and provider |
| AIDA-50 | SATISFIED | Shortcuts, 1 s chords, `?` modal, input guard, `docs/KEYBOARD.md`; D-14 screen-reader check open (human, not part of acceptance text) |
| AIDA-51 | SATISFIED | Setting 0 = off, pg-boss cron, audit event. Customer notice: none built (D-19), which satisfies "off by default, no AI text"; O-2 remains an open owner item |
| AIDA-43 | Not in this phase; stays open (D-01: only Phase 11 paths plus the E1-fixed ticket detail and create paths check membership) |

Charter suite gate: `pnpm test:integration` (full) and `pnpm test:egress` blocked by O-1, never claimed passed. `pnpm audit --prod` exit 1 at the unchanged v1 baseline (7 critical, 52 high); no package changed.

### Gate evidence (final rerun on `47fc015`, from 11-GATE.md)

lint 0 (343 files); typecheck 0; unit 0 (23 files, 229); integration without egress 0 (22 files, 142); full E2E 0 (121 passed, 1 pre-existing skip); build 0 (known NFT warning); audit 1 (baseline). The verifier did not rerun suites; `pgrep -f 'artisan test'` was empty and no container was touched.

### Anti-Patterns / review status

No new `lib/llm` import, inline script or hardcoded colour in Phase 11 lines (gate §9). Review WR-01, WR-02, IN-01, IN-04 to IN-07, Codex D1, D2, D4, E1 to E4 and F1 fixed with tests. Not fixed, by recorded decision: IN-02 (customer reopen writes no `TicketAuditEvent`; D-07 action list), IN-03 (saving a view from `/tickets/[id]` closes the ticket; UI-SPEC targets), D3 (decision K30). Deferred LOW: a refusal arriving after a bulk-bar remount loses its "Nothing was changed." reason (`deferred-items.md`). None contradicts a requirement, decision or must_have, so none is a gap.

### Human Verification Required

1. Visual approval of all Phase 11 surfaces.
2. Dark-mode review of the same surfaces.
3. 360px and long-text backstops (11-04 to 11-08).
4. Bulk status change that moves selected tickets out of the filter (11-06 backstop).
5. D-14 screen-reader check.
6. O-1: full integration suite and `test:egress` (charter gate open).
7. O-2: owner decision on an auto-close customer notice.

### Gaps Summary

No code gap against AIDA-47 to AIDA-51, D-01 to D-24 (with amendments) or the plan must_haves was found. Open items are human checks, backstops without evidence, and owner items O-1 and O-2.

---

_Verified: 2026-11-08_
_Verifier: Claude (gsd-verifier)_
