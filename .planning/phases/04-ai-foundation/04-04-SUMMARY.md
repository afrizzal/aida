---
phase: 04-ai-foundation
plan: 04
subsystem: ui
tags: [settings, react-hook-form, zod, shadcn-select, llm-provider-config]

# Dependency graph
requires:
  - phase: 04-ai-foundation
    plan: 02
    provides: "lib/llm/settings.ts (getLlmSettings/saveLlmSettings/isProviderConfigured),
      lib/llm/test-connection.ts (testProviderConnection), lib/llm/types.ts (MODEL_CATALOG)"
provides:
  - "src/app/(app)/settings/actions.ts: saveLlmSettings + testLlmConnection admin-gated
    Server Actions"
  - "src/app/(app)/settings/llm-provider-form.tsx: provider Select + curated model Select +
    custom-model-ID free-text fallback (D-01) + provider-specific credential field + Test
    Connection + Save"
  - "src/app/(app)/settings/llm-test-connection-button.tsx: 4-state idle/testing/success/failure
    Test Connection trigger for the LLM provider form"
  - "src/app/(app)/settings/ai-toggle.tsx: providerConfigured-gated Switch (D-21)"
  - "src/components/ui/select.tsx: shadcn Select primitive (first use in this codebase)"
affects: [04-03, 04-05, 04-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First use of shadcn Select (radix-ui Select primitive was already a dependency via
      dropdown-menu/popover, so `pnpm dlx shadcn add select` only generated the component file,
      no new package.json dependency) — future forms needing a dropdown should reuse
      @/components/ui/select rather than a Command+Popover combobox."
    - "Split-field model selection: a form holds `modelSelect` (a MODEL_CATALOG entry or a
      `__custom__` sentinel) + `customModel` (free text), resolved to a single `model` string via
      resolveModel() right before submit/test — keeps zod validation simple while still letting
      the Select and the free-text Input coexist cleanly."

key-files:
  created:
    - src/app/(app)/settings/llm-provider-form.tsx
    - src/app/(app)/settings/llm-test-connection-button.tsx
    - src/components/ui/select.tsx
  modified:
    - src/app/(app)/settings/actions.ts
    - src/app/(app)/settings/page.tsx
    - src/app/(app)/settings/ai-toggle.tsx

key-decisions:
  - "saveLlmSettings/testLlmConnection mirror testImapConnection/testSmtpConnection's exact
    security contract: requireOrgAdmin() first, stored-key fallback when the submitted apiKey is
    blank, error sliced to 200 chars, key never echoed."
  - "AiToggle's Switch is disabled purely on `providerConfigured` (computed server-side via
    isProviderConfigured(getLlmSettings(db))) — no Test Connection state is read or persisted
    anywhere near the toggle, keeping D-21's 'no stale-test false guarantee' rule structurally
    honest rather than just documented."
  - "Provider-change handler resets the model selection to the new provider's first catalog
    entry (never silently keeps an old provider's model string) — avoids a form ending up with,
    e.g., provider=ollama but model='gpt-5.4-mini' after a careless provider switch."
  - "AIDA-13 is now code-complete end-to-end from this plan's perspective (provider port from
    04-02 + this configuration UI) — but left unmarked in REQUIREMENTS.md per the established
    04-01/04-02 precedent, since AIDA-20 (untrusted-input/redaction) still depends on 04-03's
    prompt-injection fencing landing before the full Phase 4 requirement set can be validated
    together. Deferring the actual REQUIREMENTS.md edit to whichever plan closes out the phase."

requirements-completed: []  # AIDA-13/AIDA-12 declared in this plan's frontmatter are phase-level
  # requirements only partially owed by this plan (provider config UI) — AIDA-20's
  # prompt-injection defense (04-03, running in parallel) and the phase-level close-out review
  # still gate marking either fully Validated in PROJECT.md/REQUIREMENTS.md.

# Metrics
duration: ~20min
completed: 2026-07-07
---

# Phase 4 Plan 4: Settings AI Provider Configuration UI Summary

**Extended the existing `/settings` "AI Features" page in place with a provider dropdown, curated model dropdown + custom-model-ID free-text fallback, encrypted API key / Ollama base-URL fields, a real per-provider Test Connection button, and D-21 gating of the Enable AI switch on provider-configured state only (never on a stale Test Connection result).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-07T06:19:00Z (approx, STATE.md last-updated timestamp at session start)
- **Completed:** 2026-07-07T06:38:31Z
- **Tasks:** 2/2 completed
- **Files modified:** 4 modified, 3 created (incl. the added shadcn Select primitive)

## Accomplishments

- `src/app/(app)/settings/actions.ts` gained `saveLlmSettings`/`testLlmConnection` — both admin-gated via `requireOrgAdmin()`, mirroring `saveEmailSettings`/`testImapConnection`'s security contract exactly (stored-key fallback on blank submit, 200-char error slice, key never echoed).
- `src/app/(app)/settings/llm-provider-form.tsx` — a client form (react-hook-form + `zodResolver` + `zod/v4` + shadcn `Form`/`Select`/`Input`) with: provider `Select` (OpenAI/Anthropic/Ollama), a model `Select` populated from `MODEL_CATALOG[provider]` plus a `Custom…` sentinel that reveals a free-text `customModel` `Input` (D-01), a `type="password"` API key field shown only for OpenAI/Anthropic, and a base-URL text field shown only for Ollama (D-03). Provider changes reset the model selection to the new provider's first catalog entry.
- `src/app/(app)/settings/llm-test-connection-button.tsx` — 4-state idle/testing/success/failure Test Connection trigger with an always-mounted `role="status" aria-live="polite"` region, calling the new `testLlmConnection` Server Action.
- `src/app/(app)/settings/ai-toggle.tsx` gained a `providerConfigured: boolean` prop — the Switch is `disabled` and the helper text reads "Configure a provider first." whenever no provider is saved yet; it is never gated on any Test Connection result (D-21).
- `src/app/(app)/settings/page.tsx` now loads `getLlmSettings(db)` alongside the existing `aiEnabled` read, computes `isProviderConfigured(settings)`, and renders `LlmProviderForm` above `AiToggle`; added `export const dynamic = "force-dynamic"` since the page now reads two DB sources at request time.
- Added the shadcn `Select` primitive (`src/components/ui/select.tsx`) — first use of a real dropdown `Select` in this codebase (existing "select-like" UIs used a Command+Popover combobox instead). No new `package.json` dependency was needed — `radix-ui` (the umbrella package) was already installed.
- `pnpm exec tsc --noEmit`, `pnpm run build`, and `biome check` (via `pnpm exec biome check`, since the project's `pnpm lint` script name collides with an environment hook rewriting it toward a nonexistent `eslint` binary — see Deviations) all pass clean on every file this plan touched.

## Task Commits

Each task was committed atomically:

1. **Task 1: LLM provider Server Actions (save + test), admin-gated** - `5dbc719` (feat)
2. **Task 2: Provider form + Test Connection button + AI-toggle gating (D-21), wired into the settings page** - `6b6822f` (feat)

**Plan metadata:** (this commit) `docs(04-04): complete settings AI provider configuration UI plan`

## Files Created/Modified

- `src/app/(app)/settings/actions.ts` - added `LlmSettingsInput`, `saveLlmSettings`, `testLlmConnection` (kept `setAiEnabled` unchanged)
- `src/app/(app)/settings/llm-provider-form.tsx` - provider/model/credential form + Test Connection + Save
- `src/app/(app)/settings/llm-test-connection-button.tsx` - reusable 4-state Test Connection trigger
- `src/app/(app)/settings/page.tsx` - loads `getLlmSettings`/`isProviderConfigured`, renders both new/updated components, `force-dynamic`
- `src/app/(app)/settings/ai-toggle.tsx` - added `providerConfigured` prop, D-21 gating + hint text
- `src/components/ui/select.tsx` - new shadcn Select primitive (generated via `pnpm dlx shadcn@latest add select`)

## Decisions Made

See `key-decisions` in frontmatter. In summary: the new Server Actions are a byte-for-byte security mirror of the email settings actions (03-06); the AI-toggle gating reads only a server-computed `providerConfigured` boolean, never any client-side Test Connection state, so D-21's "no stale-test false guarantee" is structurally true rather than merely documented; and the model-selection UI splits "which catalog/sentinel is picked" from "what free-text was typed" to keep the zod schema simple.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pnpm lint` doesn't resolve to this project's Biome-based lint script in this environment**
- **Found during:** Task 1 verification
- **Issue:** The plan's `<verify>` step calls `pnpm lint`. In this environment, `pnpm lint` failed with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "eslint" not found` — the local RTK (Rust Token Killer) CLI proxy hook appears to rewrite/intercept plain `pnpm lint` invocations, and this project's `package.json` `"lint"` script is actually `biome check .`, not an ESLint invocation.
- **Fix:** Ran `pnpm exec biome check <specific files>` directly instead (bypassing the ambiguous `pnpm lint` invocation), which correctly resolves to this project's real lint tool and reported "No issues found" on every file this plan created/modified.
- **Files modified:** None (verification-only workaround, no source changes).
- **Verification:** `pnpm exec biome check` clean on all 6 touched files.
- **Commit:** N/A (no file changes required).

No architectural deviations (Rule 4) were needed — the plan's component boundaries, form shape, and D-21 gating logic were followed exactly as specified.

---

**Total deviations:** 1 auto-fixed (1 blocking — environment tooling quirk, not a code issue)
**Impact on plan:** No scope creep; purely a local verification-command workaround. All acceptance criteria still verified via the equivalent direct tool invocation.

## Issues Encountered

None beyond the auto-fixed item above.

## User Setup Required

None — no external service configuration required. An operator still needs to actually enter a real OpenAI/Anthropic API key or a reachable Ollama base URL through this new UI before AI features can be enabled; that is expected manual operator action, not a setup gap in this plan.

## DESIGN-SYSTEM.md §9 Checklist

- [x] New tokens all in `globals.css` (not hardcoded)? — N/A, no new tokens; only existing semantic tokens used (`text-success`, `text-destructive`, `text-muted-foreground`, `border-border/70`, `bg-primary/10`, etc.), grep-confirmed zero hex/oklch literals in all 4 new/modified component files.
- [x] Empty state uses halo + icon box? — N/A, this plan introduces no empty state.
- [x] Sidebar uses `sidebar-*` tokens? — N/A, sidebar untouched.
- [x] Top bar sticky + backdrop-blur? — N/A, top bar untouched.
- [x] Auth page doesn't self-wrap? — N/A, not an auth page.
- [x] Typography uses explicit `text-[Npx]`? — Yes: `text-[18px]`/`text-[13px]`/`text-[12px]`/`text-[14px]` used throughout; no named Tailwind text sizes (`text-lg`, etc.) introduced.
- [ ] Dark mode tested? — Not visually verified in a browser this session (no dev server/browser check was run); all classes are semantic-token-based so dark mode should resolve correctly via the existing CSS variable system, but this is an assertion from code inspection, not a screenshot-verified check. Flagging as an open item for the phase-level UI review pass.
- [x] `tsc --noEmit` clean? — Yes, confirmed after both tasks.

## Next Phase Readiness

- The AI Features page now lets an admin configure and persist an encrypted provider (OpenAI/Anthropic/Ollama), pick a curated or custom model, and Test Connection — `isProviderConfigured()` (04-02) now has a real UI writing to the exact `llm:*` Setting keys it reads.
- `AiToggle`'s `providerConfigured` gate is ready for 04-03's triage worker job to rely on the same underlying `isProviderConfigured`/`aiEnabled` state as its kill-switch precondition.
- No blockers for 04-03 (triage engine, running in parallel in this session) or 04-05/04-06 — this plan touched only `src/app/(app)/settings/*` and `src/components/ui/select.tsx`, no overlap with 04-03's `src/lib/audit/*`/`src/lib/triage/*` file set.
- Open item carried to the phase-level UI review: manually verify dark-mode rendering of the new provider form + Test Connection states (see checklist above).

---
*Phase: 04-ai-foundation*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: src/app/(app)/settings/actions.ts
- FOUND: src/app/(app)/settings/page.tsx
- FOUND: src/app/(app)/settings/ai-toggle.tsx
- FOUND: src/app/(app)/settings/llm-provider-form.tsx
- FOUND: src/app/(app)/settings/llm-test-connection-button.tsx
- FOUND: src/components/ui/select.tsx
- FOUND commit: 5dbc719
- FOUND commit: 6b6822f
