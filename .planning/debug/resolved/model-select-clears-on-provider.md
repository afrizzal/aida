---
status: resolved
trigger: "Model select resets to placeholder/empty string when Provider select changes programmatically (setValue + catalog swap) in llm-provider-form.tsx; zod min(1) fails at submit. Diagnose only, do not fix."
created: 2026-07-16T00:00:00Z
updated: 2026-07-18T10:08:34Z
resolved_by: "04-07 (commits edcb651, 4106f42) — key={provider} added to the Model <Select>; tests/e2e/phase4-ai.spec.ts T2/T10 assert auto-reset directly, full spec green 11/11"
---

## Current Focus

hypothesis: CONFIRMED — Radix SelectBubbleInput (hidden native <select>) syncs the new controlled value into a DOM select that still contains the OLD provider's options; no matching <option> → native value becomes "" → dispatched change event → onValueChange("") → field.onChange("") overwrites the setValue
test: Read installed @radix-ui/react-select@2.3.1 dist source; traced full event chain; verified usePrevious + useControllableState guards; confirmed known upstream issues
expecting: n/a — root cause found
next_action: return diagnosis (goal: find_root_cause_only)

## Symptoms

expected: After switching Provider (e.g. ollama -> openai), Model select resets to the new provider's first catalog entry (per 04-04 plan decision D-01)
actual: Model select trigger shows placeholder "Select a model" with data-placeholder set; form value for modelSelect is EMPTY STRING at submit; zod min(1) "Select a model" renders; combobox aria-invalid. Explicitly opening the dropdown and clicking an option fixes everything.
errors: zod validation error "Select a model" on modelSelect at submit
reproduction: Playwright E2E, twice, both switch directions (ollama->openai and openai->ollama). Programmatic setValue("modelSelect", catalog[0]) simultaneous with SelectItem children swap (MODEL_CATALOG[provider] re-render).
started: Observed during phase 4 E2E (tests/e2e/phase4-ai.spec.ts T2:209-213 / T10:507-510 carry explicit-pick workarounds)

## Eliminated

- hypothesis: Display-only bug — "new catalog's items were never registered while closed" (theory in T2 comment, phase4-ai.spec.ts:210-212)
  evidence: Items DO register while closed — SelectContentFragment (react-select dist/index.mjs:273-288) portals children into a detached DocumentFragment so SelectItemText layout effects run; and T10 proves form STATE is empty (Save blocked by validation), so it is not display-only
  timestamp: 2026-07-16

- hypothesis: react-hook-form batching drops one of the three setValue calls
  evidence: RHF state provably receives "gpt-5.4-mini"/"llama3.1" first (the bubble input sync effect fires precisely BECAUSE prevValue !== selectValue, i.e. the Select received the new value prop); the "" arrives afterwards via field.onChange("")
  timestamp: 2026-07-16

- hypothesis: shadcn wrapper (src/components/ui/select.tsx) manipulates value
  evidence: Wrapper is a thin passthrough over radix-ui SelectPrimitive; no value logic
  timestamp: 2026-07-16

- hypothesis: SelectItem/typeahead paths emit ""
  evidence: Grep of dist shows only 3 onValueChange call sites: typeahead (index.mjs:162, keyboard only), item click (index.mjs:837, passes real item value), and BubbleInput onChange (index.mjs:1119) — only the last can produce ""
  timestamp: 2026-07-16

## Evidence

- timestamp: 2026-07-16
  checked: src/app/(app)/settings/llm-provider-form.tsx:97-108, 148-152, 185-209
  found: modelSelect Select fully controlled (value={field.value} onValueChange={field.onChange}, line 191); items = MODEL_CATALOG[provider] (line 198); handleProviderChange does 3 batched setValue calls (lines 101-107); everything sits inside <form> (line 150) so Radix renders its hidden native select (isFormControl, index.mjs:79)
  implication: One React commit swaps both the controlled value AND the SelectItem children

- timestamp: 2026-07-16
  checked: package.json + pnpm store — radix-ui@1.6.0 -> @radix-ui/react-select@2.3.1; react 19.2.7
  found: Version with the SelectBubbleInput imperative value-sync effect
  implication: Matches upstream issue reports (incl. #3381 "only on React 19")

- timestamp: 2026-07-16
  checked: @radix-ui/react-select dist/index.mjs:1082-1131 (SelectBubbleInput)
  found: Hidden native <select> keyed by nativeSelectKey (join of registered option values, index.mjs:82), UNCONTROLLED (defaultValue, line 1123), options rendered from nativeOptionsSet state; passive useEffect (1094-1108) — when prevValue !== selectValue it sets select.value via HTMLSelectElement prototype setter and dispatches a bubbling "change" event; onChange (line 1119) = (event) => onValueChange(event.target.value)
  implication: If the DOM select lacks a matching <option> at sync time, HTML spec makes select.value === "" → the dispatched change feeds "" back into onValueChange

- timestamp: 2026-07-16
  checked: dist/index.mjs:927-935 (SelectItemText) + index.mjs:80-92 (nativeOptionsSet)
  found: Native <option>s are (de)registered via useLayoutEffect per item; add/remove are setState calls that land in a FOLLOW-UP commit, not the commit that swapped the items
  implication: In the provider-switch commit, the BubbleInput's DOM select still holds the OLD provider's options while the value prop is already the NEW catalog[0]; React flushes that commit's passive effects (incl. the value-sync effect) before the options-refresh commit → stale-options race is deterministic

- timestamp: 2026-07-16
  checked: @radix-ui/react-use-previous dist (usePrevious) — first render returns current value
  found: prevValue === selectValue on mount → sync effect never dispatches on initial mount; options then register → nativeSelectKey changes → native select REMOUNTS fresh with correct options + defaultValue
  implication: Explains why initial mount / defaultValues display fine and only the programmatic value+items swap breaks

- timestamp: 2026-07-16
  checked: @radix-ui/react-use-controllable-state dist:32-44
  found: Controlled setValue guard `if (value2 !== prop) onChange(value2)` — echoes equal to current prop are dropped
  implication: Provider select is safe (static options → echo always matches → dropped); model select's "" !== "gpt-5.4-mini" → onChange("") fires into RHF

- timestamp: 2026-07-16
  checked: Upstream radix-ui/primitives issues via web search
  found: #3135, #3249, #3381 (React 19), #3693, #2817 all describe controlled Select inside a form calling onValueChange("") when value/options change
  implication: Known upstream bug in 2.3.1; local mitigation required

## Resolution

root_cause: Radix Select's hidden form-bridge <select> (SelectBubbleInput, @radix-ui/react-select@2.3.1 dist/index.mjs:1082-1131) syncs a changed controlled value into the DOM native select via a passive effect (1094-1108) BEFORE the follow-up commit that refreshes its <option> children (registered via SelectItemText layout effects, 927-935). During a provider switch, the native select still contains the old provider's options, so assigning the new catalog[0] yields select.value === "" per HTML spec; the effect then dispatches a bubbling change event, onChange (1119) calls onValueChange(""), which passes the useControllableState guard ("" !== new prop) and lands in react-hook-form as field.onChange("") — clobbering the setValue("modelSelect", catalog[0]) from llm-provider-form.tsx:106.
fix: (recommendation only, not applied — diagnose-only) Add key={provider} to the Model <Select> at llm-provider-form.tsx:191 to remount the whole Radix Select subtree on provider change; mount path is the proven-safe path (usePrevious parity → no dispatch; keyed native-select remount with correct options + defaultValue).
verification: (not applied) Revert T2/T10 explicit-pick workarounds in tests/e2e/phase4-ai.spec.ts to assert auto-reset (toContainText catalog[0], no data-placeholder, Save passes validation) in both switch directions.
files_changed: []
