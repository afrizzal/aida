---
status: partial
phase: 05-rag-drafted-replies
source: [05-VERIFICATION.md]
started: 2026-07-22T00:00:00Z
updated: 2026-07-22T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live UI walkthrough: draft → insert → send → audit
expected: Generate a draft on a real ticket with a grounded KB article; DraftCard renders with citations; click Insert loads the text into the Composer (editable); click Send posts through the existing route; the ticket's AI Activity section shows a `DRAFT_GENERATED` row followed by a `DRAFT_APPROVED` row.
result: [pending]

### 2. Live embedding Test Connection
expected: Settings -> AI Features -> Embedding Provider -> Test Connection succeeds against a real OpenAI or Ollama credential; a bad key or a not-pulled Ollama model surfaces a clear, specific error (not a generic 500).
result: [pending]

### 3. DESIGN-SYSTEM §9 checklist pass
expected: Visual pass on `/kb`, `/kb/new`, `/kb/[id]`, and the ticket-page draft card — halo+icon-box empty state renders correctly at zero KB articles, chip/card visuals match the token palette in both light/dark, no visual regressions on the ticket reply area.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
