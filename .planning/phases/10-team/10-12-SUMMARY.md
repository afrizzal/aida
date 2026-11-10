---
phase: 10-team
plan: 12
subsystem: mentions
status: complete
tags: [mentions, composer, autocomplete, a11y, privacy, testcontainers]
requires:
  - "10-02: getScopedDb membership re-read (cookie cache off since 0db72a9, R10-1, unchanged)"
  - "10-03: listMembers (one entry per user, V-26)"
  - "10-07: messages route `mentions` field, mentionDisplayName, 400 mentions_not_allowed"
provides:
  - "src/lib/mentions/composer-tokens.ts: isIntactSpan, findMentionQuery, insertMention, applyTextEdit, reconcileMentionIds, stripMentionTokens, outgoingMentionIds, filterMentionCandidates, shouldOfferMentions, mentionOptionLabel, mentionDraftReducer (edit, insert, setMode, loadDraft, sent)"
  - "GET /api/members/mentionable: { members: [{ id, name, email }] } behind getScopedDb, author excluded"
  - "MentionAutocomplete (Popover + Command) and the composer's single changeMode path"
affects: [10-13, 10-14]
tech-stack:
  added: []
  patterns:
    - "Composer draft in one pure reducer; the component only dispatches and restores the caret"
    - "Edited range from common prefix and suffix, the suffix bounded by the caret the textarea reports"
    - "Focus stays in the textarea; cmdk's option ids are read from the DOM by data-value for aria-activedescendant"
key-files:
  created:
    - src/lib/mentions/composer-tokens.ts
    - tests/unit/mention-tokens.test.ts
    - src/app/api/members/mentionable/route.ts
    - src/components/tickets/mention-autocomplete.tsx
    - tests/integration/mention-mode-switch.test.ts
  modified:
    - src/components/tickets/composer.tsx
decisions:
  - "The mentionable route sends mentionDisplayName as `name`, so an insertion writes exactly the text the server wraps; a member without a display name shows the email as the name line (mentionOptionLabel) and inserts the local part"
  - "Filtering is done by filterMentionCandidates (name or email contains the query, name prefix first) with Command shouldFilter={false}, so the first highlighted option is deterministic and unit-tested"
  - "A query may hold single spaces (names have them); once it holds a space the list shows only while something matches, so a plain '@someone said' sentence closes it"
  - "outgoingMentionIds is the one rule for the `mentions` field: ids only in internal mode; the composer also checks the mode before setting the field"
  - "setMode internal to public keeps insertedNames (names inserted since the last send) so a later switch still strips a pasted copy; only `sent` and `loadDraft` clear them"
  - "The switch note shows only when the switch removed something or there were spans"
metrics:
  duration: "about 20 minutes (2026-11-13T00:00Z to 00:18Z)"
  completed: 2026-11-13
  tasks: 3
  files: 6
estimate:
  tokens: 60000
  tasks: 3
actuals:
  tokens: 17700
  tasks: 3
  commits: 3
commits: 3
plan_head_before: b32b2a4ac54ab33f40c7471e22be3f851a6e46ed
---

# Phase 10 Plan 12: Member autocomplete in the internal-note composer Summary

Internal notes now get member autocomplete. Each inserted `@Name` is a span-tracked atomic token, Backspace removes it in two steps (R3-2), and every way into public mode passes through one `changeMode`, which strips inserted names. Public replies never carry mention ids. This is proven through the messages route and the outbound worker.

## What was built

- **`src/lib/mentions/composer-tokens.ts`** (pure, no React):
  - `isIntactSpan` is the single token rule. `reconcileMentionIds`, `stripMentionTokens`, the kept-span filter in `applyTextEdit` and `outgoingMentionIds` all use it.
  - `applyTextEdit(state, nextText, caret?)` finds the edited range. Spans before the range are kept and spans after it are shifted. When the range touches a span inside, the rest of that name is deleted and its id dropped, but characters the user typed stay. An insertion exactly at a span's start or end does not touch the span.
  - `insertMention` replaces `@query` with `@{Name} `. Its span covers `@{Name}` only, not the trailing space.
  - `stripMentionTokens` removes every intact span, whatever follows it. It then removes copies of inserted names that are followed by the end of the text or by something other than a letter or digit, trying the longest name first.
  - `mentionDraftReducer` handles five actions:
    - `edit`
    - `insert`: internal mode only
    - `setMode`: strip, clear spans, switch note
    - `loadDraft`: public, no spans, no names, `fromDraft`
    - `sent`
- **`GET /api/members/mentionable`**:
  - Calls `getScopedDb`. A removed member gets 403 `membership_ended`; an unauthenticated caller gets 401.
  - Lists current members through `listMembers`: one entry per user, the caller excluded, sorted by name.
  - Each entry is `{ id, name, email }` and nothing else, with `Cache-Control: no-store`.
- **`MentionAutocomplete`**:
  - `Popover` anchored to the composer wrapper, with `PopoverContent align="start"` at `w-[280px] p-0`.
  - `Command` list in `max-h-[288px]`. Each item has a `size-8` Avatar, the name (13px, semibold, truncate) and the email (12px muted, truncate). Rows are 36px, so 8 are visible.
  - Shows the no-match row with the Copywriting text, and one `Skeleton h-8 mx-2 my-2` while loading.
  - A mouse-down inside the popover keeps the textarea focused, and a click in the textarea does not close the list.
- **`composer.tsx`**:
  - `useReducer(mentionDraftReducer)` replaces the separate body, mode and `fromDraft` state.
  - The toggle and `focusComposer` (r and n keys, palette) call `changeMode`. The AI-draft effect dispatches `loadDraft`.
  - The change handler dispatches `edit` with `selectionEnd`. A layout effect restores the reducer's caret while the textarea is focused.
  - The member list is fetched once per mount. If it fails, the trigger turns off.
  - Keys: ArrowUp and ArrowDown move, Enter or Tab insert, and Escape closes and leaves the text.
  - In internal mode the textarea has `role="combobox"`, `aria-autocomplete`, `aria-expanded`, `aria-controls` and `aria-activedescendant`.
  - The switch note line appears while `switchNote` is on.
  - The `mentions` field is built only from `outgoingMentionIds`, and only in internal mode.

## Verification

| Command | Exit | Result |
|---------|------|--------|
| `pnpm exec vitest run tests/unit/mention-tokens.test.ts` (Task 1) | 0 | 24 passed |
| `pnpm test tests/unit/mention-tokens.test.ts` (Task 1; runs the whole unit tree) | 0 | 109 files, 1954 tests passed |
| `pnpm exec vitest run tests/unit/membership-inventory.test.ts` | 0 | 43 passed (the new route passes Rules A to E with no allowlist entry) |
| `pnpm typecheck` (Tasks 1, 2, 3) | 0 | clean |
| `pnpm lint` (Tasks 2, 3) | 0 | 1 warning, already there before this plan (`tests/unit/container-config.test.ts:160`, noTemplateCurlyInString); none in files of this plan |
| `pnpm test tests/unit` (Task 3) | 0 | 109 files, 1955 tests passed |
| `pnpm test:integration tests/integration/mention-mode-switch.test.ts` (run id `mwe7r043-e7833671d83eee03`) | 0 | 1 file, 1 test passed |

Docker health before the integration step: `colima status` exit 0, `docker info` exit 0.

Acceptance greps:
- In `composer.tsx`: `"mentions"` 1, `mentionDraftReducer` 4, `changeMode` 4, `useState("public"|"internal")` 0.
- `isIntactSpan` appears 5 times in `composer-tokens.ts`; `it(` appears 26 times in the unit file; `getScopedDb` appears 5 times in the route.
- `aria-activedescendant` appears 1 time in `composer.tsx` and 2 times in `mention-autocomplete.tsx`; named text sizes in `mention-autocomplete.tsx`: 0.
- The switch-note sentence appears 1 time in `composer.tsx`; in the integration test, `mentionDraftReducer` appears 7 times and `Omega` 3 times.

The integration test drives the reducer with the plan's exact sequence:
- "Hi ", then Zeta Prime, then a Backspace that removes the space, then ", can you check", then " and ", then Zeta, then "please. Ping @someone ", then Omega Probe and two Backspaces.
- It then switches with `setMode` public and posts a form built from `outgoingMentionIds`, which has no `mentions` field.
- It runs `emailOutboundSendHandler` with the transport mocked.
- It checks presence first: "can you check" and "@someone" are in the stored body and in the mail text.
- It then checks absence: no "Zeta", "Omega", mention class or member email in `bodyMarkdown`, `bodyHtml`, the mail text or the mail HTML, and zero MessageMention and notification rows in the organization.

## DESIGN-SYSTEM section 9

- Checked by code:
  - No new colour token. Only existing tokens are used (`bg-accent`, `text-muted-foreground`, `bg-primary/10`, `text-primary-emphasis`).
  - Typography uses explicit `text-[Npx]`. shadcn named sizes are overridden on each instance (PopoverContent, CommandItem, CommandEmpty).
  - `tsc --noEmit` is clean.
  - Empty state, sidebar, top bar and auth page do not apply here: the no-match row is the Command empty row from UI-SPEC, not a page empty state.
- Manual, still open: visual review, dark mode, screen-reader announcement of the combobox and its options, the 360px layout, and the backstop rows for a 255-character name and a missing display name in a real browser.

## Deviations from Plan

1. **[Rule 2 - correctness] `outgoingMentionIds` added to the token module.** The composer and the Task 3 integration test build the `mentions` field from the same function, so the test proves the composer's public-mode rule and does not restate it. The composer still checks `mode === "internal"` before setting the field. Commit 6d1ed96.
2. **[Rule 1 - correctness] `applyTextEdit` takes the caret the textarea reports.** Without it, the common-prefix scan places a typed character that equals its neighbour inside the span. For example, "@" typed just before "@Zeta" would be read as an edit inside the name and destroy the span. Unit cases cover the start and end of a span. Commit 8b3ac07.
3. **Filtering outside cmdk.** `Command shouldFilter={false}` renders the list that `filterMentionCandidates` returns. Focus stays in the textarea, so cmdk's own input, search and keyboard handling are not used. Behaviour matches UI-SPEC: options are filtered on the typed query.

## Known Stubs

None.

## Not run / manual

- E2E for the real composer (Backspace steps, mode switch, direct-payload leak): plan 10-13, not run here.
- Visual, dark-mode, screen-reader and 360px checks: manual, not recorded.

## Self-Check: PASSED

- All six files exist.
- Commits 8b3ac07, 6ac3176 and 6d1ed96 are in `git log`, and `git rev-list --count b32b2a4..HEAD` gives 3.
