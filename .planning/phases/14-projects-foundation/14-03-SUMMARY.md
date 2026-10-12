---
phase: 14-projects-foundation
plan: 03
subsystem: projects-pure-helpers
status: complete
tags: [markdown, sanitize, uploads, file-type, rank, recurrence, calendar-dates, intl]
requires: ["14-01"]
provides:
  - "renderTaskMarkdown in src/lib/markdown/render.ts (run decision K65, C9)"
  - "validateUpload in src/lib/attachments/validate-upload.ts (C10)"
  - "appendRank, rankBetween, rebalancedRanks in src/lib/projects/rank.ts (contract section 8)"
  - "addDays, sequenceDate, nextOccurrence, nextOccurrenceDetailed, occurrenceBase, successorDates, initialAnchor in src/lib/projects/recurrence-rules.ts (contract section 7)"
affects: ["14-04", "14-05", "14-06", "14-07", "14-08", "14-09", "14-10", "14-11", "14-12", "14-13"]
tech-stack:
  added: []
  patterns: ["pure modules with relative imports only", "null means rebalance first", "direct index computation with a counted, bounded correction"]
key-files:
  created:
    - src/lib/attachments/validate-upload.ts
    - src/lib/projects/rank.ts
    - src/lib/projects/recurrence-rules.ts
    - tests/unit/validate-upload.test.ts
    - tests/unit/project-rank.test.ts
    - tests/unit/project-recurrence-rules.test.ts
  modified:
    - src/lib/markdown/render.ts
    - tests/unit/markdown-render.test.ts
decisions:
  - "rankBetween(null, after) uses 0 as the floor (floor(after / 2), valid only when below after), and rankBetween(null, null) equals appendRank(null)"
  - "validateUpload also refuses FILE_TOO_LARGE when the bytes actually read exceed MAX_BYTES, and reports sizeBytes as the length read, not the declared size"
  - "The recurrence rules throw a RangeError when a result would pass 2999-12-31 (for example a MONTHLY next occurrence after 2999-12-01); the services must handle that bound"
metrics:
  duration: "about 15 minutes"
  completed: 2026-11-09
estimate:
  tokens: 70000
actuals:
  tokens: 8700
  tasks: 3
  commits: 5
plan_head_before: b60e1de4f86be12c5763d73bf153b4c8de52025e
---

# Phase 14 Plan 03: Pure helpers for task content, uploads, ranks and recurrence Summary

Four database-free building blocks for the Phase 14 services, all proven as unit tests. renderTaskMarkdown removes every image, whatever its origin, and keeps live safe links (K65). validateUpload checks the size before reading and sniffs the bytes against ALLOWED_MIME. The rank math returns null when the group must be rebalanced. The recurrence rules compute the next occurrence from the distance in at most two counted corrections.

## Tasks

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 (tracer) | renderTaskMarkdown (K65) | 7c55f7e | src/lib/markdown/render.ts, tests/unit/markdown-render.test.ts |
| 2 (tdd) | Shared upload validator and rank math | 3b272bc (RED), 19fbd4a (GREEN) | src/lib/attachments/validate-upload.ts, src/lib/projects/rank.ts, tests/unit/validate-upload.test.ts, tests/unit/project-rank.test.ts |
| 3 (tdd) | Pure recurrence date rules | de05f13 (RED), e2c08c5 (GREEN) | src/lib/projects/recurrence-rules.ts, tests/unit/project-recurrence-rules.test.ts |

## Verification

- Task 1: `pnpm exec vitest run tests/unit/markdown-render.test.ts && pnpm exec biome check ...` exit 0, 32 tests passed (the existing renderMarkdown, preview and htmlLinkTargets cases unchanged). The tracer gate re-ran this verify before expanding, and it passed.
- Task 2: the verify chain (vitest, biome, no `@/` import) exit 0, 21 tests passed. The RED run failed with "Cannot find module" before the modules existed.
- Task 3: the verify chain (vitest, biome, no `@/` import, `pnpm exec next typegen`, `pnpm typecheck`) exit 0, 36 tests passed. The RED run failed with "Cannot find module".
- Plan level: all four files in one vitest process, 89 passed, exit 0. `git diff --stat` of package.json and pnpm-lock.yaml since the plan base is empty. No commit of this plan touches `src/app/api/tickets/[id]/messages/route.ts`, `src/app/api/public` or `src/lib/channels`. The reference-name grep over src, docs, website, README.md, public, prisma and tests is empty. `grep -cE 'performance\.now|Date\.now\('` on the recurrence test prints 0.

## Implementation notes

- renderTaskMarkdown: taskProcessor runs remarkParse, remarkGfm, remarkRehype, rehypeSafeLinks, rehypeReplaceImagesWithAlt, rehypeSanitize(schema) and rehypeStringify. rehypeReplaceImagesWithAlt replaces each img with a text node holding its alt (removes it when the alt is empty) and removes every picture and source element. A linked image becomes a live link whose text is the alt. renderMarkdown and renderMarkdownPreview are unchanged.
- validateUpload returns `{ ok: true, buffer, mimeType, sizeBytes, originalFilename }` or `{ ok: false, code }`. No storage key or path is ever derived from the name; the test asserts the exact key set of the result. A `cleanDisplayName` export carries the name rule (control characters U+0000 to U+001F and U+007F dropped, trim, cut to FILE_NAME_MAX code points, "file" fallback).
- nextOccurrenceDetailed: DAILY and WEEKLY start from the last sequence date on or before the base (floor of the day distance divided by the period). MONTHLY starts from the sequence date in the base's own month. One forward correction then gives the answer, and a guarded backward correction exists but never fires in the cases. Steps above 2 throw. A base before the anchor returns the anchor with index 0 and steps 0.

## Deviations from Plan

None. The plan executed as written. The additions inside its scope:
- [Rule 2 - Correctness] validateUpload also checks the length actually read against MAX_BYTES, because the declared size is the client's word.
- Extra test cases beyond the behavior list: an exactly-MAX_BYTES file, emoji names cut by code point, a ranking floor and a negative or fractional rebalance count, month-end strictly-after loops, the 2999-12-31 bound and refusal cases for an invalid rule, index, time zone and clock.

## Known Stubs

None.

## Threat Flags

None. The plan's threat register covers every new surface (T-14-12 to T-14-16, each mitigated with a unit case).

## Notes for later plans

- The services must catch or prevent the RangeError the recurrence rules throw when the next occurrence would fall after 2999-12-31. The contract names no refusal code for that bound.
- In validateUpload, text/plain and text/csv sit in ALLOWED_MIME but cannot be sniffed by magic bytes, so a plain text upload is refused as UNSUPPORTED_FILE_TYPE. This is the same behaviour as the four inline copies.

## Self-Check: PASSED

- FOUND: src/lib/markdown/render.ts (renderTaskMarkdown, rehypeReplaceImagesWithAlt, K65), src/lib/attachments/validate-upload.ts, src/lib/projects/rank.ts, src/lib/projects/recurrence-rules.ts and the four unit test files.
- FOUND commits: 7c55f7e, 3b272bc, 19fbd4a, de05f13, e2c08c5 (`git rev-list --count b60e1de..HEAD` = 5 before this summary).
