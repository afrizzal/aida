---
status: complete
phase: 04-ai-foundation
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md]
started: 2026-07-16T09:33:10Z
updated: 2026-07-16T11:15:00Z
mode: automated-e2e  # user delegated testing to Claude — executed via tests/e2e/phase4-ai.spec.ts
---

## Current Test

[testing complete]

## Test Harness

All 10 UAT tests executed via Playwright (`tests/e2e/phase4-ai.spec.ts`, committed):
fresh Testcontainers Postgres + `migrate deploy` + `next dev` (existing globalSetup),
plus a real pg-boss worker (tsx) and a local Ollama-protocol stub HTTP server
(`/api/tags`, `/api/chat`) — the full triage pipeline runs end-to-end with only the
model process faked. Final run: 10 passed / 1 known-issue workaround (test 2) across
runs 3+5.

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/worker. Start the stack from scratch. All 5 migrations apply cleanly (including the ai_foundation migration), app boots without errors, worker registers the ai-triage queue, and /api/health returns live data.
result: pass
evidence: "Playwright globalSetup: fresh Testcontainers pgvector:pg16 + `migrate deploy` applied all 5 migrations; next dev Ready in 4.0s; /api/health 200; worker (tsx, pg-boss) logged '[worker] started'; pgboss.queue contains ai-triage."

### 2. Configure LLM Provider in Settings
expected: Settings → AI Features shows a provider dropdown (OpenAI / Anthropic / Ollama) and a model dropdown populated per provider, plus a "Custom…" option revealing a free-text model field. OpenAI/Anthropic show a password-type API key field; Ollama shows a base URL field instead. Switching provider resets the model to the new provider's first catalog entry. Save persists the settings.
result: issue
reported: "Automated E2E (Playwright): switching provider does NOT reset the model to the new provider's first catalog entry — the Model select ends up EMPTY. handleProviderChange calls form.setValue('modelSelect', catalog[0]) but the value is cleared again when the Radix Select's item set swaps; the trigger shows the 'Select a model' placeholder and a subsequent Save is blocked by zod validation ([invalid] combobox + 'Select a model' error, no save toast) until the operator manually re-picks a model. Contradicts 04-04's documented key-decision ('Provider changes reset the model selection to the new provider's first catalog entry'). Everything else in this test passes (three providers listed, per-provider catalog + Custom… free-text, provider-specific credential fields, save + reload round-trip when a model is explicitly picked)."
severity: major

### 3. Test Connection Button
expected: With a provider configured, clicking Test Connection shows a "testing" state, then either a success or a failure message (failure shows a short error, never the API key). The result is announced politely (no page reload).
result: pass
evidence: "E2E: 'Connected successfully' against reachable Ollama endpoint; 'Connection failed: …' against a dead port; aria-live status region, no navigation."

### 4. Enable AI Toggle Gating
expected: Before any provider is saved, the "Enable AI" switch is disabled with hint text "Configure a provider first." After saving a provider, the switch becomes enabled and can be turned on.
result: pass
evidence: "E2E: switch disabled + 'Configure a provider first.' pre-config; enabled + 'Allow AIDA to triage tickets and draft replies.' post-save; turning on persists Setting aiEnabled='true'."

### 5. Auto-Triage on New Ticket
expected: With AI enabled and a working provider, creating a new ticket (agent New Ticket, public /request form, or inbound email) automatically triages it within moments: the ticket header's second meta row shows category, sentiment, and language chips, and priority reflects the AI's classification. While running, a "Triaging…" chip shows.
result: pass
evidence: "E2E (full pipeline, real pg-boss worker + Ollama-protocol stub): agent New Ticket → triageStatus COMPLETED in seconds; chips Technical/Negative/EN rendered; priority NORMAL→HIGH from AI output; SLA recomputed (firstResponseTargetMinutes 240)."

### 6. Agent Overrides Triage
expected: On a triaged ticket, the category chip opens a dropdown of 5 categories, the sentiment chip opens a dropdown of 3 sentiments, and the language chip opens a popover with a text input. Changing any of them updates the chip immediately. Changing category/sentiment/language does NOT change the SLA due times (only priority changes do).
result: pass
evidence: "E2E: overrides to Billing/Positive/ID applied + persisted; firstResponseDueAt/resolutionDueAt/priority byte-identical before/after."

### 7. Re-run AI Triage Control
expected: A successfully triaged ticket shows a subtle "Re-run AI triage" button (Sparkles icon) that re-queues triage when clicked. A ticket whose triage failed shows a red "Triage failed" badge with a "Re-run" link instead.
result: pass
evidence: "E2E: stub forced 500 → re-run ends FAILED → destructive 'Triage failed' badge + Re-run link; stub restored → Re-run → COMPLETED → ghost 'Re-run AI triage' button back."

### 8. AI Activity Section
expected: Below the message thread (above the composer), a muted collapsible "AI Activity" section lists each triage run: provider/model, relative time, and the parsed result (category · priority · sentiment · language). The raw prompt/ticket text sent to the LLM is never shown. On a never-triaged ticket, the section is absent entirely.
result: pass
evidence: "E2E: <details> lists ≥2 runs 'ollama · llama3.1' + 'TECHNICAL · HIGH · NEGATIVE · en'; page HTML contains no 'ticket_content' fence marker (AuditEvent.input never rendered); absent on never-triaged ticket (see test 9)."

### 9. AI Off = Zero Triage Chrome
expected: With the "Enable AI" toggle off, creating a ticket works exactly as before: no "Triaging…" chip, no triage chips, no AI Activity section — zero AI chrome anywhere on the ticket. The ticket still appears normally in the inbox.
result: pass
evidence: "E2E: toggle off → new ticket after 8s: triageStatus/triageCategory null, stub chat-call counter unchanged (LLM never called), zero triage chrome on page, ticket visible in inbox."

### 10. Blank API Key Keeps Existing
expected: Re-opening Settings → AI Features shows the API key field empty (never echoes the stored key). Saving the form with the key field left blank keeps the previously stored key working — Test Connection still succeeds afterward.
result: pass
evidence: "E2E: saved OpenAI + fake key → llm:apiKeyEnc blob stored; reload shows empty key field (never echoed); re-save with blank field → encrypted blob byte-identical (fresh-IV cipher means any rewrite would differ). Deviation: 'Test Connection succeeds afterward' not verifiable without a real OpenAI key — stored-key-kept proven via blob identity instead (stronger). Note: reaching Save after a provider switch required manually re-picking the model (see test 2 issue)."

## Summary

total: 10
passed: 9
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "Switching provider resets the model dropdown to the new provider's first catalog entry, and Save works immediately after a provider switch"
  status: failed
  reason: "User-delegated automated E2E found: after a provider switch the modelSelect form value ends up empty (handleProviderChange's setValue is clobbered when the Radix Select item set swaps) — trigger shows 'Select a model' placeholder and Save is blocked by zod validation until the operator manually re-picks a model. Reproduced in both directions (ollama→openai in T10, openai→ollama in T2)."
  severity: major
  test: 2
  root_cause: >-
    Upstream @radix-ui/react-select@2.3.1 bug (radix-ui/primitives #3135/#3381/#3693): the
    Select is inside a <form>, so Radix renders SelectBubbleInput — a hidden UNCONTROLLED
    native <select> whose <option>s (nativeOptionsSet) update one commit AFTER the SelectItem
    children swap. handleProviderChange's three setValue calls batch into one commit: value
    becomes catalog[0] while the native select still holds the OLD provider's options. The
    bubble-input sync effect (index.mjs:1094-1108) assigns select.value="gpt-5.4-mini" against
    non-matching options → per HTML spec value becomes "" / selectedIndex -1 → it dispatches a
    change event → onValueChange("") → field.onChange("") overwrites the setValue. Initial
    mount is safe because usePrevious returns the current value on first render (no sync
    dispatch) and the native select remounts fresh once options register. Full session:
    .planning/debug/model-select-clears-on-provider.md
  fix: >-
    One line: add key={provider} to the Model <Select> in llm-provider-form.tsx (~line 191) —
    remounts the Select subtree in the same commit where field.value is already catalog[0],
    taking the proven-safe initial-mount path. Do NOT key the Provider select (its items are
    static; keying it would drop focus per change). Regression: revert the explicit-pick
    workarounds in tests/e2e/phase4-ai.spec.ts T2/T10 to assert auto-reset + save-without-
    validation-error.
  artifacts: ["src/app/(app)/settings/llm-provider-form.tsx:191 (Model Select missing key={provider})", "node_modules @radix-ui/react-select dist/index.mjs:1094-1108 (bubble-input sync)"]
  missing: ["key={provider} on Model Select", "T2/T10 e2e assertions for auto-reset instead of explicit-pick workaround"]
