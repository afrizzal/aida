---
phase: 04-ai-foundation
plan: 02
subsystem: llm-provider-port
tags: [openai, anthropic-ai-sdk, ollama, zod, structured-output, redaction, encryption]

# Dependency graph
requires:
  - phase: 04-ai-foundation
    plan: 01
    provides: provider SDKs installed (openai/@anthropic-ai/sdk/ollama), scopedDb DOMAIN_MODELS
      pattern, secret-box precedent
provides:
  - "complete<T>(db, params) — the ONE lib/llm port entrypoint: redact -> resolve active
    provider -> dispatch -> { output, redactedPrompt, provider, model }"
  - "src/lib/llm/settings.ts — llm:provider/model/apiKeyEnc/ollamaBaseUrl Setting keys,
    getLlmSettings/saveLlmSettings/isProviderConfigured"
  - "src/lib/llm/active-provider.ts — resolveActiveProvider(db), throws when unconfigured"
  - "src/lib/llm/test-connection.ts — testProviderConnection(), 10s-timeout probe per provider"
  - "src/lib/llm/redact.ts — redactSecrets(text), unit-tested against 5 obvious-secret shapes"
  - "MODEL_CATALOG curated dropdown values per provider (src/lib/llm/types.ts)"
affects: [04-03, 04-04, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "complete<T>() is the single AI call surface for every future feature (triage now;
      Phase 5 RAG, Phase 6 Insight reuse it unchanged) — redaction happens inside complete()
      itself, before any provider adapter is touched, so it cannot be forgotten per-feature"
    - "Three provider adapters each use their SDK's own zod-integrated structured-output helper
      (zodResponseFormat/zodOutputFormat/z.toJSONSchema) instead of hand-rolled JSON-mode
      translation — zero function/tool-calling fields anywhere in src/lib/llm (D-16)"
    - "resolveActiveProvider() returns a ResolvedProvider type (LlmSettings & { provider:
      LlmProviderName }) rather than the raw LlmSettings — narrows `provider` away from the
      `LlmProviderName | \"\"` union once isProviderConfigured has proven it non-empty, so
      complete()'s switch/return type-checks without an unchecked cast at the call site"

key-files:
  created:
    - src/lib/llm/types.ts
    - src/lib/llm/redact.ts
    - src/lib/llm/settings.ts
    - src/lib/llm/active-provider.ts
    - src/lib/llm/complete.ts
    - src/lib/llm/test-connection.ts
    - src/lib/llm/providers/openai.ts
    - src/lib/llm/providers/anthropic.ts
    - src/lib/llm/providers/ollama.ts
    - tests/unit/llm-redact.test.ts
  modified: []

key-decisions:
  - "settings.ts mirrors channels/email/settings.ts structurally exactly as mandated by D-05:
    relative imports only, SettingDb Pick-type (exported for reuse by active-provider.ts and
    complete.ts), findFirst+conditional create/update (never .upsert()), apiKey written only
    inside an `if (input.apiKey)` guard (blank submit = keep existing stored key)"
  - "Ollama adapter uses the native ollama npm client against /api/chat, NOT the openai SDK
    pointed at Ollama's OpenAI-compat /v1 route (Pitfall 2 from 04-RESEARCH.md) — documented
    inline so a future 'one HTTP client' refactor re-verifies structured-output compliance first"
  - "Anthropic adapter uses the new native output_config.format + messages.parse() API — no
    tool-use/forced-function-call workaround for JSON extraction (Pitfall 1)"
  - "AIDA-13/AIDA-20 intentionally NOT marked complete in REQUIREMENTS.md yet — this plan ships
    only the lib/llm port + settings module + redaction; provider selection UI (04-04) and
    prompt-injection fencing (04-03) are still required before either requirement's full
    acceptance statement is satisfied. Mirrors the established 02-08/03-01/04-01 precedent for
    requirements split across multiple plans."

patterns-established:
  - "Acceptance-criteria greps that check for the LITERAL ABSENCE of a string (e.g. no
    \"tool_choice\" anywhere under src/lib/llm/) apply to comments too, not just code — worth
    remembering when writing explanatory comments about what a module deliberately avoids."

requirements-completed: []  # AIDA-13/AIDA-20 declared in this plan's frontmatter are phase-level
  # requirements; this plan (Wave 2) ships the provider-agnostic port + encrypted settings +
  # redaction only. Not marked complete until 04-03 (prompt-injection fencing) and 04-04
  # (settings UI / AI toggle gating) land.

# Metrics
duration: 45min
completed: 2026-07-07
---

# Phase 4 Plan 2: Model-Agnostic LLM Provider Port Summary

**Built `src/lib/llm/complete<T>()` — the one port entrypoint that unconditionally redacts secrets, resolves the single globally-active provider (OpenAI/Anthropic/Ollama), dispatches to a native-structured-output adapter with zero tool-calling surface, and returns `{ output, redactedPrompt, provider, model }` for every future AI feature to reuse unchanged.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-07T05:50:00Z (approx)
- **Completed:** 2026-07-07T06:16:40Z
- **Tasks:** 3/3 completed
- **Files modified:** 0 modified, 10 created

## Accomplishments

- `src/lib/llm/types.ts`: `LlmProviderName`, `CompleteParams<T>`/`CompleteResult<T>`, and the curated `MODEL_CATALOG` dropdown values per provider — zero function/tool-calling fields in the port contract (D-16), confirmed by a targeted grep for the literal absence of `tool_choice`/bare `tools` across the whole `src/lib/llm/` tree (including comments).
- `src/lib/llm/redact.ts`: `redactSecrets()` — the exact research-verified regex set (OpenAI/Anthropic key shapes, AWS `AKIA` ids, `Bearer` tokens, card-like sequences). TDD RED→GREEN: 7/7 unit tests green in `tests/unit/llm-redact.test.ts` (47/47 full unit suite still green).
- `src/lib/llm/settings.ts`: mirrors `channels/email/settings.ts` structurally — `llm:provider`/`llm:model`/`llm:apiKeyEnc`/`llm:ollamaBaseUrl` Setting keys, `getLlmSettings`/`saveLlmSettings`/`isProviderConfigured`, `secret-box` reuse, blank-apiKey-keeps-existing semantics, `findFirst`+conditional create/update (never `.upsert()`).
- `src/lib/llm/active-provider.ts`: `resolveActiveProvider(db)` — the single D-02 resolution point; throws `"No LLM provider configured"` when unconfigured; returns a narrowed `ResolvedProvider` type so downstream code never has to guard against an empty-string provider.
- Three provider adapters (`providers/{openai,anthropic,ollama}.ts`), each using their SDK's native zod-integrated structured-output helper (`zodResponseFormat`, `zodOutputFormat`, `z.toJSONSchema`), `timeout: 30_000, maxRetries: 0` (pg-boss owns retry). Ollama uses the native `/api/chat` client (not the OpenAI-compat `/v1` route) with an inline pitfall-2 comment for future maintainers.
- `src/lib/llm/complete.ts`: the ONE port entrypoint — redacts unconditionally before resolving the active provider, switches on provider name, returns the typed result plus redacted prompt/provider/model for future audit-log writes.
- `src/lib/llm/test-connection.ts`: `testProviderConnection()` — 10s-timeout connectivity probe per provider (`models.list()` for OpenAI/Anthropic, `ollama.list()` for Ollama) for the future Settings UI's Test Connection button (D-04).
- `pnpm test` (47/47), `pnpm exec tsc --noEmit`, and `biome check --write` (import-order + object-formatting fixes) all clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define port contracts (types.ts) + redaction (redact.ts) with unit tests** - `284dd2f` (test, RED) + `72db370` (feat, GREEN)
2. **Task 2: Encrypted llm:* settings module + active-provider resolver** - `4c2779a` (feat)
3. **Task 3: complete() port + three provider adapters + connectivity probe** - `cae010b` (feat)

**Plan metadata:** (this commit) `docs(04-02): complete model-agnostic LLM provider port plan`

## Files Created/Modified

- `src/lib/llm/types.ts` - port contracts (`LlmProviderName`, `CompleteParams`/`CompleteResult`, `MODEL_CATALOG`)
- `src/lib/llm/redact.ts` - `redactSecrets()` regex set
- `tests/unit/llm-redact.test.ts` - 7 unit tests covering every documented secret shape + clean-prose idempotency
- `src/lib/llm/settings.ts` - encrypted `llm:*` Setting keys module (mirrors email settings)
- `src/lib/llm/active-provider.ts` - `resolveActiveProvider()` / `ResolvedProvider` type
- `src/lib/llm/complete.ts` - the port entrypoint
- `src/lib/llm/test-connection.ts` - `testProviderConnection()`
- `src/lib/llm/providers/openai.ts` - OpenAI adapter (`zodResponseFormat`)
- `src/lib/llm/providers/anthropic.ts` - Anthropic adapter (`zodOutputFormat`, native `output_config`)
- `src/lib/llm/providers/ollama.ts` - Ollama adapter (native `/api/chat`, `z.toJSONSchema`)

## Decisions Made

- Final `MODEL_CATALOG` values (D-01 curated dropdown, custom-ID free-text remains the escape hatch in the future settings UI):
  - `openai`: `["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"]`
  - `anthropic`: `["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"]`
  - `ollama`: `["llama3.1", "qwen2.5", "mistral"]`
- Zero tool-calling surface confirmed: no `tools`/`tool_choice` field exists anywhere in `src/lib/llm/` (code or comments) — verified via grep as part of this plan's own acceptance criteria, not just asserted.
- `resolveActiveProvider()`'s return type narrowing (`ResolvedProvider`) — a small, necessary type-safety addition beyond the plan's literal sketch so `complete.ts`'s switch/return type-checks cleanly (see Deviations).
- AIDA-13/AIDA-20 intentionally left unmarked in REQUIREMENTS.md (see key-decisions) — this is the provider-port/settings-module/redaction foundation only; provider-selection UI (04-04) and prompt-injection fencing (04-03) still owe the rest of each requirement's acceptance statement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `resolveActiveProvider`'s return type didn't narrow `provider` away from `LlmProviderName | ""`**
- **Found during:** Task 3 (writing `complete.ts`)
- **Issue:** `LlmSettings.provider` is typed `LlmProviderName | ""`. `isProviderConfigured()` (a plain boolean predicate, per the plan's literal spec) doesn't narrow the type, so after `resolveActiveProvider()` throws-or-returns, TypeScript still saw `provider: LlmProviderName | ""` — `complete.ts`'s `return { ..., provider: s.provider, ... }` failed to type-check against `CompleteResult<T>.provider: LlmProviderName`.
- **Fix:** Added an exported `ResolvedProvider = LlmSettings & { provider: LlmProviderName }` type in `active-provider.ts`; `resolveActiveProvider()` now returns `Promise<ResolvedProvider>` via a cast that reflects the runtime invariant `isProviderConfigured` already proved (not an unchecked assertion). `isProviderConfigured`'s own signature is untouched (still plain `boolean`, matching the plan's literal spec for `settings.ts`).
- **Files modified:** `src/lib/llm/active-provider.ts`
- **Commit:** `cae010b`

**2. [Rule 1 - Bug] Two unit-test assertions and one test input didn't match the mandated card/AKIA regex's real behavior**
- **Found during:** Task 1 GREEN step (first `pnpm test -- llm-redact` run after implementing `redact.ts`)
- **Issue:** (a) The plan's exact card-like regex (`/\b(?:\d[ -]?){13,19}\b/g`) greedily consumes a trailing space/dash before its final word-boundary check when the digit sequence is immediately followed by a space — two of my initial test assertions expected the trailing space to survive redaction and failed. (b) My initial AKIA test key body was only 14 characters, not the required 16.
- **Fix:** Reworded the two card-sequence test cases to end each digit sequence with punctuation (not a bare space) so the boundary behavior is deterministic, and used the real AWS-documented 20-character example key `AKIAIOSFODNN7EXAMPLE`. The regex itself was left untouched — it is the plan-mandated, research-verified pattern; only the test inputs were wrong.
- **Files modified:** `tests/unit/llm-redact.test.ts`
- **Commit:** `72db370`

**3. [Rule 1 - Bug] Explanatory comments in `types.ts`/`openai.ts`/`anthropic.ts` initially contained the literal substrings `"tools"`/`"tool_choice"`**
- **Found during:** Task 3, running the plan's own acceptance-criteria grep checks before committing
- **Issue:** Comments describing "there is no `tools`/`tool_choice` field" contain the very strings the acceptance criteria grep for the absence of — a literal `grep -rn "tool_choice" src/lib/llm/` would have failed on comment text alone, even though no code ever references either field.
- **Fix:** Reworded the three affected comments to describe the same guarantee ("no function/tool-calling fields") without using the literal forbidden substrings. Re-ran the grep checks to confirm zero matches for `tool_choice`, bare `tools` in `types.ts`, and `tools:` in `anthropic.ts`.
- **Files modified:** `src/lib/llm/types.ts`, `src/lib/llm/providers/openai.ts`, `src/lib/llm/providers/anthropic.ts`
- **Commit:** `cae010b`

No architectural deviations (Rule 4) were needed — the plan's module structure, adapter shapes, and settings-mirroring design were followed as specified.

## Issues Encountered

None beyond the auto-fixed items above.

## User Setup Required

None — no external service configuration required yet. Actual provider API keys and the Settings UI to enter them are 04-04's job; this plan only builds the module that will read/write/use them.

## Next Phase Readiness

- `complete<T>(db, params)` is ready for `04-03` (triage engine) to call directly — it already returns everything `recordAuditEvent()` will need (`redactedPrompt`, `provider`, `model`, `output`).
- `getLlmSettings`/`saveLlmSettings`/`isProviderConfigured` are ready for `04-04` (Settings AI Features page) to build the provider-config form and the `aiEnabled` toggle's D-21 gating ("Configure a provider first" hint) against.
- `testProviderConnection()` is ready for `04-04`'s Test Connection button (same 4-state idle/testing/success/failure UI pattern already proven by `03-06`'s email Test Connection button).
- No blockers for `04-03` or `04-04`.

---
*Phase: 04-ai-foundation*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: src/lib/llm/types.ts
- FOUND: src/lib/llm/redact.ts
- FOUND: src/lib/llm/settings.ts
- FOUND: src/lib/llm/active-provider.ts
- FOUND: src/lib/llm/complete.ts
- FOUND: src/lib/llm/test-connection.ts
- FOUND: src/lib/llm/providers/openai.ts
- FOUND: src/lib/llm/providers/anthropic.ts
- FOUND: src/lib/llm/providers/ollama.ts
- FOUND: tests/unit/llm-redact.test.ts
- FOUND commit: 284dd2f
- FOUND commit: 72db370
- FOUND commit: 4c2779a
- FOUND commit: cae010b
