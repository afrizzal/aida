# Phase 11 (Inbox) — Phase gate

Plan 11-09. Run on 2026-11-08 between 10:57 and 11:02 UTC, on the Mac workspace, without a human.

- **Tested commit:** `9523eac0a33733fb0e9d1f76aea05bd2b6170f37` (`test(11-09): keyboard E2E …; README inbox note`). Later commits that touch only `.planning/` keep these results valid (ROADMAP gate rules).
- **Phase base commit:** `1e5c0f33d1c8e5bd54df43c2b829fa66cbcb0285` (`docs(11): replan from Codex review cycle 2`), the parent of `eb92d01`, the first commit whose message contains "(11-01)".
- **How it ran:** one command at a time, in the order of the table. Each command wrote to its own log under `$TMPDIR` (`aida-11-09-gate-*.log`, outside the repo). Each exit code was read from the command itself, never through a pipe. `pgrep -f 'artisan test'` found nothing before every Docker, Testcontainers, E2E and build command. Testcontainers and E2E commands carried `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`.
- **Containers:** the run created, started, stopped and removed no container by hand. The Testcontainers suites start and remove their own throwaway Postgres containers.

## Gate table

| # | Command | State | Exit / reason | Log summary | Commit |
|---|---------|-------|---------------|-------------|--------|
| 1 | `pnpm lint` | passed | 0 | biome: 330 files checked, no fixes | `9523eac` |
| 2 | `pnpm typecheck` | passed | 0 | `tsc --noEmit` printed no error | `9523eac` |
| 3 | `pnpm test` | passed | 0 | 21 files, 222 tests passed, 0 failed (includes `tests/unit/design-tokens.test.ts`) | `9523eac` |
| 4 | `pnpm test:integration` (as-is) | blocked (O-1) | not run: its `include` takes `tests/integration/egress-isolation.test.ts`, which starts the compose project `aida-egress-test`, a real compose stack (D-23, owner item O-1) | none, never claimed as passed | `9523eac` |
| 4a | `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm exec vitest run --config vitest.integration.config.ts --exclude tests/integration/egress-isolation.test.ts` (supplementary row for 4) | passed | 0 | 18 files passed (18), 129 tests passed (129), 0 failed, 0 skipped | `9523eac` |
| 4b | the same command as 4a with `--reporter=verbose` appended (file-list evidence only; the default reporter prints totals only) | passed | 0 | 18 files, 129 tests passed. Files run: audit-append-only, auto-close, create-ticket, draft-generation, email-ingest, inbox-schema, insight-run, kb-embed, palette-search, reply-reopen-race, saved-views-ui-state, saved-views, scoped-tx, search-isolation, sla-flag-handler, ticket-mutations, triage-injection, workspace-isolation. `egress-isolation` appears 0 times in the log | `9523eac` |
| 5 | `pnpm test:egress` | blocked (O-1) | not run: `vitest.egress.config.ts` drives the compose project `aida-egress-test`, a real compose stack (D-23, owner item O-1) | none, never claimed as passed | `9523eac` |
| 6 | `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:e2e` (full suite) | passed | 0 | 111 passed, 1 skipped, 0 failed, 0 flaky, in 2.5 min over 20 specs. Specs added in Phase 11: keyboard 17/17, saved-views 10/10, bulk-actions 6/6, command-palette 9/9, auto-close 4/4. Older specs over surfaces Phase 11 changed: inbox 6/6, mutations 5/5, reading-pane 2/2. a11y-contrast 8/8. honesty-invariants 2/2 in this run. The skip is the existing `uat-gaps.spec.ts:17` case "a zero-ticket workspace shows the 'Your inbox is empty' state", skipped in the spec itself before Phase 11. The log shows `/bin/sh: taskkill: command not found` 3 times (Windows-only teardown in `global-setup.ts`, `honesty-invariants`, `phase4-ai` and `phase5-rag`); it did not fail the run, and no worker or server process was left running afterwards (`pgrep` empty) | `9523eac` |
| 7 | `pnpm build` | passed | 0 | Next.js 16.2.11 (Turbopack) compiled; 1 warning: the known "unexpected file in NFT list" trace through `src/lib/attachments/local-file-storage.ts` (not a Phase 11 file, present since v1). No `.next` deletion was needed | `9523eac` |
| 8 | `pnpm audit --prod` | failed | 1 | 141 vulnerabilities: 7 critical, 52 high, 69 moderate, 13 low. The advisory service answered | `9523eac` |

Rows 4 and 5 are recorded as blocked, not passed. Row 8 stays red.

### Comparison with the v1 baseline (LAPORAN section 6)

| Item | Baseline | Phase 11 gate | Worse? |
|------|----------|---------------|--------|
| `pnpm audit --prod` | exit 1; 7 critical, 52 high, 69 moderate, 13 low | exit 1; 7 critical, 52 high, 69 moderate, 13 low | No. Identical counts. `git diff --stat 1e5c0f3 9523eac -- package.json pnpm-lock.yaml` is empty: Phase 11 added no package |
| E2E flakes in `honesty-invariants.spec.ts` (a, b) | failed in the full run, passed alone | passed in the full run (2/2) | No. This one green run does not prove the flake is gone; it is not claimed fixed |
| E2E teardown `taskkill` (Windows-only) | present | still present, 3 "command not found" lines, not fatal | No. Unchanged; Phase 11 did not touch these files |
| E2E skip count | 1 skipped | 1 skipped (same `uat-gaps` case) | No |
| Build warning | 1 known Turbopack NFT warning | the same warning | No |
| Integration without egress | 11 of 12 files, 26 passed, 4 skipped (as-is run, egress failed) | 18 of 18 files, 129 passed, 0 skipped (egress excluded) | No |

Phase 11 makes none of the baseline facts worse.

### Container listings for `aida-egress-test`

Command: `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock docker ps -a --filter label=com.docker.compose.project=aida-egress-test --format '{{.Names}} {{.Status}}'`

| When | Exit | Output |
|------|------|--------|
| Before the gate (10:57:40 UTC) | 0 | empty (0 lines) |
| After the integration run (spot check) | 0 | empty (0 lines) |
| After the gate (11:01:54 UTC) | 0 | empty (0 lines) |

The gate created and touched no `aida-egress-test` container.

## §9 checklist

DESIGN-SYSTEM §9, answered for Phase 11. Range: base `1e5c0f3` to tested commit `9523eac`. "Added lines" means `git diff -U0 1e5c0f3 9523eac -- src ':!src/generated' | grep -E '^\+[^+]'`: 5357 lines over the 51 changed `src` files (20 modified, 31 added). Each grep below exited 1 (no match) on those lines. As a control, the same patterns do match elsewhere in `src` (70 `oklch(` hits, 36 named text sizes in `src/components/ui`, 9 files using `EmptyState`), so the empty results are not caused by a broken pattern.

| §9 question | Answer | Evidence |
|-------------|--------|----------|
| All new tokens in `globals.css`, nothing hardcoded? | Yes, from code | Phase 11 adds no token: `src/app/globals.css` is unchanged. Added lines contain no `oklch(`, hex, `rgb(`/`rgba(` or `hsl(` literal, no Tailwind palette colour class (`bg-red-500`, `text-indigo-…`, `bg-white` and the like), and no `dark:` class. `pnpm test` (gate row 3) includes `tests/unit/design-tokens.test.ts`, which passed |
| Empty state uses halo + icon box? | Yes, from code: no new page empty state | Added lines contain no `EmptyState` and no `min-h-[60vh]`. The existing inbox empty state is untouched. The sidebar Views hint and the palette's empty rows are single text lines, not page empty states; UI-SPEC (Surface 1, "No views at all", and Design checklist hooks) justifies this |
| Sidebar uses `sidebar-*` tokens? | Yes, from code | `src/components/sidebar-views.tsx` uses only `text-sidebar-foreground/70`, `text-sidebar-foreground/60`, `bg-sidebar-accent`, `text-sidebar-accent-foreground`, `hover:bg-sidebar-accent/60` and `hover:text-sidebar-foreground` for colour. A grep for non-sidebar colour tokens (`bg-muted`, `text-primary`, `bg-background` and the like) in that file exits 1. The rows use the DS §4.1 active and inactive classes verbatim. `sidebar.tsx` keeps `border-r border-sidebar-border bg-sidebar text-sidebar-foreground` and the `Sparkles` brand box in `bg-sidebar-primary`; its added classes are layout only (`flex-1 overflow-y-auto px-2 py-2`, `space-y-0.5`) |
| Top bar sticky + backdrop-blur? | Yes, from code | `src/components/top-bar.tsx` line 63 still reads `sticky top-0 z-10 … border-b border-border/70 … backdrop-blur-sm`. The diff from the base changes no line containing `sticky` (grep exit 1); Phase 11 added only the palette trigger inside it |
| Auth pages do not wrap themselves? | Yes, from code: untouched | `git diff --name-only 1e5c0f3 9523eac -- 'src/app/(auth)'` lists 0 files |
| Typography uses explicit `text-[Npx]`? | Yes for Phase 11's own lines, from code | Added lines contain no `text-xs`, `text-sm`, `text-base`, `text-lg` or `text-xl`. The shadcn primitives in `src/components/ui` are unchanged since the base and still carry their own named sizes; the palette overrides them with `text-[12px]`, `text-[13px]` and `text-[15px]` (`src/components/command-palette.tsx`, for example the group heading class and `CommandEmpty`). Every other new use of a shadcn primitive was not audited one by one for an inherited named size |
| Dark mode tested? | open (human) | Not claimed. Evidence that exists: token-only colours (above), `design-tokens.test.ts` passed, and `a11y-contrast.spec.ts` 8/8 passed in gate row 6, but that spec covers `/kb`, `/kb/new`, `/kb/[id]` and the ticket page with a draft card in light and dark. It does not cover the Views section, the strip and notices, the dialogs, the checked rows with the cursor ring, the bulk bar, the palette, the help modal, the chord hint or the auto-close card. The look of these in dark mode (DESIGN-SYSTEM §7 and §8 rule 8) waits for a human |
| `tsc --noEmit` clean? | Yes | Gate row 2: `pnpm typecheck` exit 0 on `9523eac` |

Related charter checks over the same range: added lines contain no `lib/llm` import, no `dangerouslySetInnerHTML`, no `<script` and no `next/script` (grep exit 1). `src/lib/llm/`, `docs/SECURITY.md` and `tests/integration/egress-isolation.test.ts` are unchanged (D-20: no new egress, no inline script, no AI call).

## Requirement evidence

The orchestrator, not this plan, updates `REQUIREMENTS.md`. The rows cited below are gate rows 2, 3, 4a and 6, all passed on `9523eac`. No requirement's evidence relies on a failed or blocked row. The charter gate as a whole is still incomplete: rows 4 and 5 are blocked (O-1), and row 8 is red at the baseline counts.

| Requirement | Acceptance (REQUIREMENTS.md) | Evidence | ROADMAP Phase 11 criterion | Status from this gate |
|-------------|------------------------------|----------|----------------------------|-----------------------|
| AIDA-47 | Filters are validated against the existing filter schema; shared views are org-scoped with an unmocked isolation test; views appear in the sidebar using `sidebar-*` tokens. | `tests/integration/saved-views.test.ts` on Testcontainers Postgres, not mocked: "a member of another organization sees neither the shared nor the private view", "refuses an invalid name and invalid filters", "refuses a tag of another organization …", "every function refuses an actor whose member row was deleted". Also `saved-views-ui-state.test.ts` and `inbox-schema.test.ts` (row 4a), `tests/unit/inbox-parsers.test.ts` (row 3) and `tests/e2e/saved-views.spec.ts` 10/10 (row 6), including the member who sees the admin's shared view but never the private one. Sidebar tokens: §9 sidebar row | 1 | Evidence present; not blocked |
| AIDA-48 | One transaction, one audit entry per ticket, and a test proves a failure rolls back the batch. | `tests/integration/ticket-mutations.test.ts` (row 4a): "a bulk change over three tickets returns count 3 and writes three rows sharing one batchId", "a plain Error thrown after the first ticket was written … rolls everything back", "a batch containing a ticket of another organization is refused whole", "ids [a, b, a, c] write exactly three audit rows", the deadlock and same-name tag races. `tests/e2e/bulk-actions.spec.ts` 6/6 (row 6): status and assign with one audit row each in one batch, add and remove tag, a refused batch changes nothing, the 100 cap. Bulk priority is proven in the integration file, not in E2E | 2 | Evidence present; not blocked |
| AIDA-49 | E2E covers each command group; the registry can accept commands from other modules. | `tests/e2e/command-palette.spec.ts` 9/9 (row 6): ticket search, Go to, Create ticket, views, Save view. `tests/e2e/keyboard.spec.ts` (row 6): ⌘K and Ctrl+K, the This ticket group ("Write an internal note", and in 11-09 "Change status"), the Help group ("Show keyboard shortcuts"). `tests/unit/command-registry.test.ts` (row 3) covers register and unregister; the ticket page (`ticket-meta-header.tsx`), the list (`ticket-selection.tsx`) and the provider all register through the same registry. `tests/integration/palette-search.test.ts` (row 4a): organization scope, the 10-result limit and the membership refusal | 3 | Evidence present; not blocked |
| AIDA-50 | Shortcuts, chords with a timeout, and a `?` help modal work; keystrokes are ignored inside inputs and editors; a docs page lists the keys. | `tests/e2e/keyboard.spec.ts` 17/17 (row 6): j/k without wrapping, x, Esc, Enter, j and k on an empty list, s/a/t/r/n on the ticket page, the g chord and its one-second expiry, `?` and its four sections, `?` and gc typed into the search input staying there, s typed into the note composer staying there. `tests/unit/keyboard-dispatch.test.ts` (row 3): guards, chord timer and the `docs/KEYBOARD.md` parity test. Docs: `docs/KEYBOARD.md`, linked from the README | 4 | Evidence present; not blocked. The screen-reader behaviour (D-14) is open |
| AIDA-51 | An org setting with 0 meaning off; a pg-boss cron job closes qualifying tickets with an audit event; any customer notice is a fixed template, off by default, with no AI text. | `tests/integration/auto-close.test.ts` (row 4a): 0 clears the setting, "closes nothing at 0, without a setting row …", one SYSTEM `AUTO_CLOSED` row per close, the 100 cap, the enable-time rule, the setting and close races. `tests/integration/reply-reopen-race.test.ts` (row 4a): a customer reply reopens under the row lock. `tests/e2e/auto-close.spec.ts` 4/4 (row 6): an admin turns it on and off, a member sees the card read-only, the job closes the quiet fixture ticket once. The job is registered on the `auto-close` queue in `src/lib/worker/index.ts`. Customer notice: none is built or sent (D-19); whether a fixed-template notice may be sent without human approval is owner item O-2 | 5 | Evidence present for the setting, the job and the audit; the notice part rests on O-2 |

## Open items (manual, left open)

None of these is claimed as passed.

1. Visual approval (human) of the look of the Views section, the saved-view strip and its notices, the save, edit and delete dialogs, the checked rows with the cursor ring, the bulk bar, the command palette, the help modal and its key caps, the chord hint and the auto-close card.
2. Dark-mode review (human) of the same surfaces, DESIGN-SYSTEM §7: open (human).
3. D-14: a screen-reader check that single-letter keys do not clash with reading-mode keys, that j/k focus announces the row, and that the bulk count is announced: open (human).
4. Backstop measurements not taken: 360px wrapping of the palette rows (11-07), of the help modal's longest action and of the chord hint (11-08).
5. Owner item O-1: how container tests may run on the shared Docker VM. Until it is decided, `pnpm test:integration` as-is and `pnpm test:egress` stay blocked (gate rows 4 and 5).
6. Owner item O-2: whether an automatic fixed-template notice may reach customers on auto-close without a human approving each one. Nothing is sent until then (D-19).
7. Owner item O-3: unparking Phases 8, 9 and 10.
8. AIDA-43 stays open: only Phase 11's new server paths check the active membership (D-01); older pages and actions still lack the check.
9. ROADMAP Cross-phase risks now triggered:
   - `SavedView` exists in `prisma/schema.prisma`, so the saved-view part of AIDA-56 (filters built on states) applies when AIDA-56 lands.
   - The auto-close job is registered in `src/lib/worker/index.ts`, so the auto-close parts of AIDA-54 (skip snoozed tickets) and AIDA-56 (state groups) apply when they land.
   - The AIDA-49 registry and the AIDA-47 saved-view model now exist, so AIDA-86 (palette and shortcuts for Projects) and AIDA-80 (its view store) can build on them once AIDA-49 and AIDA-47 are closed.
10. Baseline debt, unchanged and not worsened by Phase 11: `pnpm audit --prod` 7 critical and 52 high; the Windows-only `taskkill` E2E teardown; the honesty-invariants flakes (green in this run, not claimed fixed); the Turbopack NFT build warning; the 1 skipped `uat-gaps` case.
11. The residual from the 11-07 follow-up fix: typing in the contacts search and then leaving within 300 ms can still be overridden by its debounced replace.

## Rerun on `a2d50bc` (after the code review and the Codex diff critique fixes)

Run by the orchestrator on 2026-11-08 18.51 to 18.55 WIB, one command at a time, each to its own log, exit codes read without a pipe, Colima socket variables set, `pgrep -f 'artisan test'` empty before every command. This closes Codex diff finding D5 (the evidence above was for `9523eac`).

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | 339 files |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 23 files, 229 tests |
| `pnpm test:integration --exclude tests/integration/egress-isolation.test.ts` | 0 | 20 files, 137 tests |
| `pnpm test:e2e` (full) | 0 | 116 passed, 1 skipped (the pre-existing `uat-gaps` skip), 0 failed |
| `pnpm build` | 0 | one Turbopack warning, the NFT warning known since v1 |
| `pnpm audit --prod` | 1 | 7 critical, 52 high, 69 moderate, 13 low: identical to the baseline; no dependency changed |
| `pnpm test:integration` (full), `pnpm test:egress` | blocked | owner item O-1 (run-loop K26); not run |

Nothing is worse than the baseline. The manual items listed above (visual and dark-mode approval, the D-14 screen-reader check, the 360px checks) remain open.
