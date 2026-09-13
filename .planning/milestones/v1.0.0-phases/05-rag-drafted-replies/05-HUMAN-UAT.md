---
status: closed
phase: 05-rag-drafted-replies
source: [05-VERIFICATION.md]
started: 2026-07-22T00:00:00Z
updated: 2026-08-01T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live UI walkthrough: draft → insert → send → audit
expected: Generate a draft on a real ticket with a grounded KB article; DraftCard renders with citations; click Insert loads the text into the Composer (editable); click Send posts through the existing route; the ticket's AI Activity section shows a `DRAFT_GENERATED` row followed by a `DRAFT_APPROVED` row.
result: Automated E2E equivalent added — `tests/e2e/phase5-rag.spec.ts`, test `"Grounded draft: cites the KB article, Insert stays editable, Send audits DRAFT_GENERATED then DRAFT_APPROVED"`. Runs the full real flow through the UI (Generate draft -> DraftCard renders draft text + a `[1]` citation link to the seeded KB article -> Insert into reply populates the Composer textarea, which stays editable (the test types an edit) -> Send Reply POSTs to the real `/api/tickets/[id]/messages` route -> asserts the sent message appears in the thread, the AI Activity section shows both "Draft generated" and "Draft approved" labels, and directly queries `AuditEvent` to assert the actionType sequence is exactly `["DRAFT_GENERATED", "DRAFT_APPROVED"]`). The LLM/embedding calls are served by a local Ollama-protocol HTTP stub (real `/api/chat` + `/api/embed` wire shapes, verified against the `ollama` npm package's SDK source), not a live vendor — this is a CI-safe, repeatable equivalent, not a substitute for a human eyeballing the real rendered UI once. **A real product bug was found and fixed while building this coverage**: the AI Activity section never received or rendered `AuditEvent.actionType`, so every event (triage, draft-generated, draft-approved alike) was mislabeled "Triage" with a triage-shaped (and for drafts, always empty) result summary. Fixed in `src/components/tickets/ai-activity-section.tsx` and `src/app/(app)/tickets/[id]/page.tsx` (actionType now flows through and drives both the label and the result summary per action type). Residual risk: low. An optional final pass with a real OpenAI/Ollama credential is recommended but no longer required for confidence.

### 2. Live embedding Test Connection
expected: Settings -> AI Features -> Embedding Provider -> Test Connection succeeds against a real OpenAI or Ollama credential; a bad key or a not-pulled Ollama model surfaces a clear, specific error (not a generic 500).
result: Automated E2E equivalent added — `tests/e2e/phase5-rag.spec.ts`, test `"Settings: Embedding Test Connection succeeds against the stub, fails with a specific error"`. Points the real Embedding Provider form at a local Ollama-protocol stub server: success case asserts "Connected successfully"; failure case switches the stub to answer `/api/embed` with a 404 + a specific "model not found, try pulling it first"-style error body (mirroring a real not-pulled-Ollama-model failure) and asserts the UI surfaces that exact, specific message (`Connection failed: model "nomic-embed-text" not found, try pulling it first`) rather than a generic 500. A stub is not literally the maintainer's own live OpenAI/Ollama account, so residual risk is low but non-zero (a live credential could theoretically surface a vendor-SDK error-parsing edge case this stub doesn't reproduce). Automated equivalent added; optional final pass with a real credential recommended but no longer required for confidence.

### 3. DESIGN-SYSTEM §9 checklist pass
expected: Visual pass on `/kb`, `/kb/new`, `/kb/[id]`, and the ticket-page draft card — halo+icon-box empty state renders correctly at zero KB articles, chip/card visuals match the token palette in both light/dark, no visual regressions on the ticket reply area.
result: [pending] — still requires a human visual pass (light/dark contrast, spacing, no regressions). `tests/e2e/phase5-rag.spec.ts` captures reference screenshots under `test-results/phase5-visual/` (gitignored, regenerated per run): `kb-empty-state.png`, `kb-article-view.png`, `ticket-draft-grounded.png`, `ticket-draft-ungrounded.png`. Claude re-ran the 6-test spec in isolation post-build (6/6 passed, independent confirmation, not just trusting the build agent's report) and visually inspected all 4 screenshots directly: empty state renders the halo+icon-box pattern correctly, the grounded draft card shows the `[1]` citation linked to the KB article, the ungrounded card shows a distinct warning-toned "No relevant sources found" box with no citations — all token-consistent at a glance. These are light-mode-only, single-viewport captures — dark mode and responsive breakpoints still need a human look, so this item stays pending rather than passed.

**Disposition (07-09.1, CLOSED — mechanical half; aesthetic half re-logged):** `tests/e2e/a11y-contrast.spec.ts` now asserts zero axe-core `color-contrast` violations, in BOTH light and dark, on exactly the four surfaces this item names (`/kb`, `/kb/new`, `/kb/[id]`, and the ticket page's draft card — captured specifically in its IN-FLIGHT, generated-not-yet-inserted state, which is distinct from and narrower than what any prior screenshot covered). `tests/unit/design-tokens.test.ts` mechanically asserts the companion token rule (no hardcoded `oklch()`/hex color, no Tailwind named text-size class) across every file under `src/components/` and `src/app/`. Between writing these two tests and fixing what they found, this closure round FIXED four real, isolated contrast bugs (a `Badge` silently inheriting `bg-primary` in four components, plus the sidebar footer email's `/60`-opacity muted text) and two real token violations (`text-2xl` on the login/setup page titles, `text-sm` on a login error message) — see `07-09.1-SUMMARY.md` for the full list. **What remains genuinely open, NOT closed by this test, and NOT a release gate:** (a) a systemic gap where `--primary`/`--success` themselves fall short of 4.5:1 in several first-class usages (default buttons, text-on-dark, one badge) — a brand/semantic-color VALUE decision, logged with a reason and an owner in `deferred-items.md`'s "From 07-09.1" section, deliberately left failing rather than allowlisted; (b) pure aesthetic judgement (does the spacing/visual rhythm look right) — D-3 of 07-09.1-PLAN.md is explicit that this is not automatable and not a release gate, so it is re-logged here as ungated feedback, not a blocking pending item.
**Owner (residual (a)):** maintainer (Afrizzal), no target date.
**Owner (residual (b)):** maintainer, optional, whenever a visual pass is convenient — not blocking.

## Summary

total: 3
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 0
automated_equivalent: 3

## Gaps

None blocking. Item 3 (DESIGN-SYSTEM §9) is now automated for its mechanical half (contrast + token rule, `tests/e2e/a11y-contrast.spec.ts` + `tests/unit/design-tokens.test.ts`) — see the Disposition note above for the two residuals (a genuine brand-color contrast gap, tracked in `deferred-items.md`; and irreducibly subjective aesthetic judgement, never a release gate). Items 1 and 2 have had CI-safe automated equivalents since the original 05-VERIFICATION.md pass (see `tests/e2e/phase5-rag.spec.ts`); a live-credential pass remains optional, not blocking.
