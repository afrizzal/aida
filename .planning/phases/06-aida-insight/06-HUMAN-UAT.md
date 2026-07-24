---
status: partial
phase: 06-aida-insight
source: [06-VERIFICATION.md]
started: 2026-07-25T02:10:00Z
updated: 2026-07-25T02:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Visual review of the /insights page
expected: Generate a real insight run and view `/insights` across the 7/30/90-day tabs, in both light and dark mode. Four cards render per DESIGN-SYSTEM.md (token-only colors, halo empty-state when no run exists, CSS bar rows for distributions), the "Generate insights" button shows "Generating…" while a run is in flight, and "Last generated {relative time}" updates correctly.
result: [pending]

### 2. CSAT capture end-user flow
expected: On a real RESOLVED/CLOSED ticket's public status page, click through the 1-5 star rating and submit a comment, then reload the page. The rating control is clickable and responsive, submission shows "Thanks for your feedback!", and reloading shows the prefilled existing score/comment.
result: [pending]

### 3. Real LLM output quality
expected: With a real, configured LLM + embedding provider (not the integration test's canned mock), run "Generate insights" against an organization with genuine ticket history. Cluster labels are semantically meaningful for the actual tickets, KB-gap nearest-article matches look sensible, and the AI narrative reads naturally alongside the SQL numbers it describes (and never contradicts them).
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
