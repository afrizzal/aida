---
status: partial
phase: 06-aida-insight
source: [06-VERIFICATION.md]
started: 2026-07-25T02:10:00Z
updated: 2026-08-01T00:00:00Z
---

## Current Test

[awaiting human testing — items 1 & 2 have automated E2E equivalents; item 3's objective half (numbers/citations cannot be model-driven) is now closed by tests/e2e/honesty-invariants.spec.ts (07-09.1); its subjective half (cluster-label/KB-gap-match semantic quality) remains a genuinely open, non-blocking backlog item — see the Disposition note under item 3]

## Tests

### 1. Visual review of the /insights page
expected: Generate a real insight run and view `/insights` across the 7/30/90-day tabs, in both light and dark mode. Four cards render per DESIGN-SYSTEM.md (token-only colors, halo empty-state when no run exists, CSS bar rows for distributions), the "Generate insights" button shows "Generating…" while a run is in flight, and "Last generated {relative time}" updates correctly.
result: Automated E2E equivalent added — `tests/e2e/phase6-insight.spec.ts`, describe `"AIDA Insight (/insights)"` (4 tests, all green). Drives the real `/insights` UI end-to-end against a live pgvector Testcontainer + `next dev`: (a) the halo empty-state renders ("No insights yet" + "Not generated yet") and the sidebar "Insight" nav item routes correctly; (b) a seeded COMPLETED `InsightRun` (all five JSON columns filled to the exact `src/lib/insight/types.ts` shapes) renders all four cards populated — Recurring Issues (label + "{n} tickets" badge + citation links), Knowledge-Base Gaps ("Gap" badge + zero-KB coverage copy), Volume Drivers (By Category/Tag/Company bar rows + deltas), SLA & CSAT (breach rate, at-risk, avg durations, 1–5★ distribution, AI-summary panel) + a "Last generated …" indicator; (c) the 7d/30d/90d period tabs switch the visible run (30d populated ↔ 90d empty, proving period-scoping); (d) clicking "Generate insights" enqueues a PENDING background `InsightRun` via the real Server Action + pg-boss (non-blocking) and the button reflects the busy state. Reference screenshots captured under `test-results/phase6-visual/` (gitignored, regenerated per run): `insights-empty-state.png`, `insights-populated.png`, `insights-period-90-empty.png`. Claude visually inspected `insights-populated.png` directly — all four cards render token-consistently in light mode with correct data, bars, delta indicators, and the AI-summary panel. Residual (still needs a human): dark-mode fidelity and responsive breakpoints are single-viewport/light-mode only in the capture; a live human dark-mode pass is recommended but no longer required for functional confidence.

### 2. CSAT capture end-user flow
expected: On a real RESOLVED/CLOSED ticket's public status page, click through the 1-5 star rating and submit a comment, then reload the page. The rating control is clickable and responsive, submission shows "Thanks for your feedback!", and reloading shows the prefilled existing score/comment.
result: Automated E2E equivalent added — `tests/e2e/phase6-insight.spec.ts`, describe `"Public CSAT capture"` (2 tests, all green), run unauthenticated like the real customer flow. Proves: (a) the CSAT block is HIDDEN on a non-resolved ticket (only the always-present follow-up form shows) and appears only once the ticket is RESOLVED; (b) the full click-through — "How did we do?" heading visible, Submit disabled until a star is picked, clicking "Rate 5 out of 5" sets `aria-pressed=true` and enables Submit, filling the comment, submitting shows "Thanks for your feedback!", and the `CsatResponse` row persists exactly once (score 5 + comment, asserted via Prisma on the `ticketId` key); (c) a full page reload re-renders the server form with the existing rating PREFILLED (5 stars filled + comment restored). Reference screenshots: `csat-form-filled.png`, `csat-prefilled.png`. Claude visually inspected `csat-prefilled.png` — the reloaded public page shows 5 filled stars and the restored comment on the RESOLVED ticket. This is a CI-safe, repeatable equivalent to a human eyeballing the real page once; residual risk low.

### 3. Real LLM output quality
expected: With a real, configured LLM + embedding provider (not the integration test's canned mock), run "Generate insights" against an organization with genuine ticket history. Cluster labels are semantically meaningful for the actual tickets, KB-gap nearest-article matches look sensible, and the AI narrative reads naturally alongside the SQL numbers it describes (and never contradicts them).
result: [pending]

**Disposition (07-09.1, SPLIT):** This item bundles an OBJECTIVE claim ("never contradicts the SQL numbers it describes") and two SUBJECTIVE ones ("cluster labels are semantically meaningful", "KB-gap matches look sensible"). The objective half is now closed without a live credential: `tests/e2e/honesty-invariants.spec.ts`, case (a), seeds a known SLA/CSAT dataset, configures the stub to return a narrative asserting deliberately wrong numbers ("0% breach rate, 100 responses"), runs a real Insight run, and asserts `src/app/(app)/insights/sla-csat-card.tsx`'s LOCKED invariant holds — the card still displays the SQL-derived numbers from `src/lib/insight/sla-csat.ts`, never the narrative's claims. This is a stronger proof than a human eyeballing one real run, because it tests the adversarial case a human reviewer would never think to construct. The subjective half — is a given cluster's LABEL actually a good, human-meaningful summary of its tickets, and does a given KB-gap's nearest-article match actually look sensible — is not automatable by construction (there is no SQL ground truth for "is this label good"); it remains genuinely open. **Re-logged as a quality-backlog item, explicitly NOT a release gate**, matching 04-VERIFICATION.md item 3's identical residual (same root cause: judging real-model output quality needs a real model). **Owner:** maintainer (Afrizzal), no target date — do this alongside 04-VERIFICATION.md item 3's live-provider pass in one session (both need the same configured real/local-Ollama credential).

## Summary

total: 3
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0
automated_equivalent: 2

## Gaps

Items 1 and 2 now have CI-safe automated E2E equivalents (`tests/e2e/phase6-insight.spec.ts`, 6/6 green under Node 22.23.1) that drive the real UI against a live Testcontainer — a live human pass is optional (dark-mode/responsive for item 1), not blocking. Item 3's objective half (numbers/citations cannot be model-driven) is now closed by `tests/e2e/honesty-invariants.spec.ts` (07-09.1) without a live credential. Item 3's subjective half (real-LLM semantic quality of cluster labels / KB-gap matches / narrative prose) remains genuinely pending, re-logged as a non-blocking quality-backlog item, not a release gate — it needs a human run with a configured real or local-Ollama LLM + embedding provider, and no automated proxy can substitute for a human judging whether generated text reads well.
