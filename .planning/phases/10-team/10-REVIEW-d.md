---
phase: 10-team
part: d (mentions)
reviewed: 2026-11-13T02:09:14Z
depth: standard
diff_range: bd02a39..HEAD
head: c1ed7fc
files_reviewed: 7
files_reviewed_list:
  - src/lib/mentions/mentions.ts
  - src/lib/mentions/composer-tokens.ts
  - src/lib/markdown/render.ts
  - src/app/api/tickets/[id]/messages/route.ts
  - src/app/api/members/mentionable/route.ts
  - src/components/tickets/composer.tsx
  - src/components/tickets/mention-autocomplete.tsx
coverage_note: "Static review only. No test, build, lint, Docker, E2E or pnpm command was run. All seven files were read in full and diffed against bd02a39. Read for context, not reviewed: src/lib/notifications/emit.ts (recipient membership filter), src/lib/workspace-members/member-admin.ts listMembers and deactivateMember, src/lib/session.ts getScopedDb, src/components/ui/command.tsx (CommandItem and CommandList base classes), unified 11.0.5 lib/index.js addPlugin, and the hast-util-sanitize 5.0.2 default schema. Of the tests, tests/unit/markdown-render.test.ts (mention block) was read in full. tests/unit/mention-tokens.test.ts, tests/integration/mentions.test.ts, tests/integration/mention-mode-switch.test.ts and tests/e2e/mentions-leak.spec.ts were checked by case names and targeted greps only. Browser behaviour (undo stack, caret, Radix and cmdk events) was not observed; claims about it are marked unverified. Known open items not re-reported beyond what is asked: AIDA-45 45.1 is reported as d-WR-5 because the caller asked for it; the 10-GATE spacing finding is d-WR-6 for the same reason."
findings:
  critical: 0
  warning: 6
  info: 8
  total: 14
status: issues_found
---

# Phase 10: Code Review Report (part d, mentions)

**Reviewed:** 2026-11-13
**Depth:** standard (see coverage note)
**Files Reviewed:** 7
**Status:** issues_found

## Summary

The leak boundary toward the customer holds on every path I traced:
- `parseMentionField` refuses any non-empty `mentions` field unless `mode` is exactly `internal`. That covers a missing mode, a case variant and a direct HTTP payload. It also refuses a non-string value (a File), malformed JSON, a non-array, more than 50 entries (V-12), empty entries and entries over 128 characters. It runs before any file is staged and before the transaction.
- Mention names reach `renderMarkdown` only from `resolveMentionedMembers`. That runs inside the transaction, after the in-transaction membership re-check and the ticket lock, with an explicit organization term. It deduplicates ids, drops the author and keeps only users who hold a member row. No name taken from the request is ever rendered.
- A public message is rendered with no names, so it has no span. The outbound worker sends only `PUBLIC` messages and re-renders `bodyMarkdown` without names (`email-outbound-send.ts:70`, `compose-outbound.ts:51`). The status page filters `PUBLIC` (D-21, checked by grep and not re-traced).
- remark-rehype runs without `allowDangerousHtml`, so a literal `<span>` in the Markdown never reaches the tree. A display name becomes a text node, and rehype-stringify escapes it. I found no XSS path.
- `GET /api/members/mentionable` sits behind `getScopedDb`, which re-reads the member rows. Every member already sees the same list, emails included, on Settings → Team, so the route discloses nothing new.

The defects are in the layers around that boundary:
- **d-WR-1:** the "after sanitize" span guard does not exist. unified collapses a plugin that is attached twice into one entry, so the guard runs only before the sanitize pass, and the unit test that claims "guard, schema, guard" has the same collapse.
- **d-WR-2:** the server records a mention and sends a notification for an id whose name does not appear as a mention in the body.
- **d-WR-3:** the switch-to-public strip deletes in-word `@name` sequences, such as part of an email address, from a customer-facing reply.
- **d-WR-4:** inserted names are not escaped for Markdown.
- **d-WR-5 and d-WR-6:** the route test gap and the off-scale `py-0.5` you asked about.

No finding is Critical: none of them lets a mention, a member name the agent did not type, or markup reach a customer, and none bypasses an authorization check.

## Warnings

### d-WR-1: The second `rehypeMentionSpanGuard` is silently dropped by unified, so the post-sanitize guard never runs

**File:** `src/lib/markdown/render.ts:187-196` (pipeline), `:49-56` (comment); `tests/unit/markdown-render.test.ts:264-275` (`sanitizeLikeRenderMarkdown`) and `:322-339` (the "never lets another class or attribute on a span survive" case)
**Issue:** `processor` calls `.use(rehypeMentionSpanGuard)` before and after `.use(rehypeSanitize, renderSanitizeSchema)` with the same function. In unified 11.0.5, `addPlugin` (`node_modules/unified/lib/index.js:1146-1171`) looks for an attacher with the same plugin identity. When it finds one, it only merges or replaces that entry's options, and it never pushes a second entry. The pipeline that actually runs is therefore parse → gfm → rehype → safe links → mentions → **guard** → sanitize → stringify. The comment at `:52-56` says that the guard "runs right before and right after the sanitize pass", and the header in `mentions.ts` repeats it, but that is false.

The unit test's harness builds its pipeline the same way, so it collapses the same way. The attribute case passes only because the pre-sanitize guard resets the properties of an exact-shape span. Nothing in the suite can detect that the second pass is missing.
**Why it matters:** today a span can come only from `mentionSpan`, which carries `className` and nothing else, so no output is wrong now. However, the review asked about this defense-in-depth layer specifically, and it is recorded as a mitigation (T-10-28) that is absent. `renderSanitizeSchema` lets every global `*` attribute through on `span` (`id` with the `user-content-` prefix, `title`, `lang`, `dir` and others). If a later change lets another span reach the tree, the layer that should catch it will not run: for example, a remark plugin, `rehype-raw`, or the guard being moved or edited.
**Fix:** give the second pass its own identity, and test that both passes are attached:
```ts
/** The same guard, as a distinct plugin: unified merges two .use() calls of one function. */
function rehypeMentionSpanGuardAfterSanitize() {
  return rehypeMentionSpanGuard();
}

const processor = unified()
  // ...
  .use(rehypeMentions)
  .use(rehypeMentionSpanGuard)
  .use(rehypeSanitize, renderSanitizeSchema)
  .use(rehypeMentionSpanGuardAfterSanitize)
  .use(rehypeStringify);
```
In the test, use the same two identities. Also add a case that runs only `rehypeSanitize` and then the after-guard on a mention-shaped span with an `id`, and assert that the `id` is gone. Today's test cannot fail if the second pass is missing.

### d-WR-2: Mentions and notifications are recorded for ids whose name is not rendered as a mention in the body

**File:** `src/app/api/tickets/[id]/messages/route.ts:163-189`; `src/lib/mentions/mentions.ts:112-137`; composer side `src/lib/mentions/composer-tokens.ts:246-253` with `:49-54`, against `src/lib/markdown/render.ts:97-100`
**Issue:** the route writes one `MessageMention` row and one `MENTION` notification for every id that resolves to a member. It does not check that the body contains `@{displayName}` at a position the renderer wraps. D-20 says the body "carries a readable `@Name`", but nothing enforces it. Three paths lead to a recorded mention that does not show in the note:
1. **Direct HTTP:** `mode=internal`, `body=hi`, `mentions=["<member id>"]`. The member gets "X mentioned you on ticket #N", and the note shows no mention.
2. **Composer, verified by reading:** insert `@Zeta ` and press Backspace once (R3-2). That removes only the space. Then type `x`. In `applyTextEdit`, an insertion exactly at `span.end` does not touch the span, so it stays intact and its id is sent. The renderer refuses `@Zetax` because `NAME_CHAR_AFTER` matches. The same happens when a letter is typed right before the `@`.
3. **Rename:** a member's name changes between the composer's one fetch per mount and the send. The body holds the old name, the server renders with the new one, and the mention is still recorded and notified.
**Why it matters:** the mentioned member's bell and digest point at a note that shows no mention of them. A member can also notify another member silently. That is not a privilege escalation, since every member can read every ticket, but it breaks the D-20 contract between the stored mention and the visible `@Name`.
**Fix:** derive the recorded set from what was actually wrapped:
- `rehypeMentions` writes the matched names into `file.data`, for example `mentionMatched: Set<string>`.
- `renderMarkdown` gets a sibling that returns `{ html, matchedNames }`.
- The route renders before `message.create` and passes only the members whose `displayName` is in `matchedNames` to `recordMentions`.

Optionally, the composer can reuse the renderer's boundary rule in `isIntactSpan`, so that a span followed or preceded by a word character is no longer sent. Add an integration case: `mentions=[id]` with a body that lacks the name records nothing.

### d-WR-3: The switch-to-public strip removes in-word `@name` sequences, corrupting customer-facing text such as email addresses

**File:** `src/lib/mentions/composer-tokens.ts:312-327` (second pass of `stripMentionTokens`)
**Issue:** the second pass removes every `@` followed by an inserted name and a non-letter-or-digit, whatever comes before the `@`. It has no left-boundary check. Both other rules have one: `findMentionQuery` (`:83`) requires whitespace or the start of the text before the trigger, and the renderer (`render.ts:97`) refuses a word character before the `@`.
**Failure scenario:** a member has no display name, so `mentionDisplayName` shows the email local part, here `sales`. The agent inserts `@sales` in a note, then switches to public to answer the customer: "Please write to orders@sales-desk.example". `@sales` is followed by `-`, so it is removed, and the reply now reads "Please write to orders-desk.example". The switch note only says "The mentioned names were removed", which the agent expects, so a broken address goes out to the customer. A URL such as `https://host/@Zeta/` is cut in the same way. UI-SPEC Surface 4 says "plain `@text` the agent typed stays". An in-word `@` is never a mention under any of the three rules.
**Fix:** require a boundary before the `@` in the second pass, the same rule the trigger uses:
```ts
if (out[i] === "@" && (i === 0 || /\s/u.test(out[i - 1]))) { /* ...existing name match... */ }
```
Add unit cases `orders@sales-desk.example` and `x@Zeta.` with `insertedNames` holding the name, and assert that both stay unchanged.

### d-WR-4: Inserted member names are not escaped for Markdown, so a member-chosen name becomes markup in another member's note and the mention silently fails to render

**File:** `src/lib/mentions/composer-tokens.ts:175-176` (`insertMention`); `src/lib/markdown/render.ts:91-118` (matching on text nodes after Markdown parsing); name source `src/lib/workspace-members/invite-onboarding.ts:41` (1 to 100 characters, no character rule; not reviewed further)
**Issue:** the composer writes `@${member.name} ` verbatim into a Markdown body. A display name is free text that the member chose. Any name containing Markdown syntax is parsed as Markdown in the note of the agent who mentions that member. Examples:
- `*`, `_` at a word edge, `` ` ``, `[`, `]`, `<`, `\`, `~`;
- a full link such as `[Zeta](https://example.invalid)`.

Two effects follow:
1. The text node no longer contains `@{name}` verbatim, so `splitMentions` finds nothing. The mention is recorded and notified (d-WR-2) but never styled.
2. A name such as `Zeta [docs](https://example.invalid)` renders a live link inside a colleague's internal note. The sanitizer keeps only safe schemes and adds `nofollow noopener noreferrer`, so this is a spoofing nuisance, not XSS. Raw HTML in a name (`<b>`) is dropped, again without a mention.
**Fix:** escape the name when it is inserted, and compare the escaped token in `isIntactSpan` and in the strip, for example:
```ts
const escapeMd = (s: string) => s.replace(/[\\`*_{}\[\]()<>#+\-.!|~]/g, "\\$&");
const token = `@${escapeMd(member.name)}`;
```
The parsed text node then holds `@{name}` again and the renderer wraps it. Alternatively, refuse Markdown-significant characters in display names at the name inputs, if the owner prefers that. Add a render case for a name containing `*` and one containing `[x](y)`.

### d-WR-5: No test reads `GET /api/members/mentionable`; "autocomplete offers members only" (AIDA-45 45.1) has indirect evidence only

**File:** `src/app/api/members/mentionable/route.ts:22-52`; `tests/` (`grep -rn "mentionable" tests` prints nothing); `10-GATE.md:185`, `:248`
**Issue:** the route makes several decisions:
- it excludes the caller;
- it serves only the active organization;
- it returns one entry per user despite duplicate member rows (O-4, V-26);
- it falls back to the local part and never uses the full email as `name`;
- it drops an empty name;
- it returns 403 `membership_ended` for a removed member and 401 without a session;
- it sets `Cache-Control: no-store`;
- its payload holds exactly `{ id, name, email }`.

None of these is asserted. The E2E only clicks an option it expects to be present (`tests/e2e/mentions-leak.spec.ts:81-86`). It never checks that a non-member, a removed member, a user of another organization or the caller is absent. The server-side re-validation (`mentions.test.ts:319`) protects what is stored, but not what the composer shows. A regression here would offer a user from another organization by name and email, and no test would fail.
**Fix:** add an integration case that calls the route handler with a member session in org A and seeds the following: a member, a member with two rows, a member without a name, a removed member, an org-B user and the caller. Assert the exact `members` array, including order, the absence of every non-member, `name` never containing `@`, and the 403, 401 and `no-store` cases. That closes 45.1.

### d-WR-6: Autocomplete rows use `py-0.5`, off the UI-SPEC spacing scale, and the spec's 288px figure cannot be met on the scale

**File:** `src/components/tickets/mention-autocomplete.tsx:135`; `.planning/phases/10-team/10-UI-SPEC.md:71-91` (scale and "every spacing value ... on the declared scale"), `:271` ("Max 8 visible, `max-h-[288px]`"); `10-GATE.md:67`
**Issue:** `py-0.5` (2px) overrides the shadcn `py-1.5`, and both values are off the 4/8/16/24/32 scale. The value was chosen so that a `size-8` avatar plus 2 × 2px gives 36px rows, and 8 × 36 = 288. The spec therefore contradicts itself. On-scale `py-1` gives 40px rows, so 288px shows 7.2 rows, and `py-2` shows 6. The design checklist (§9, Dimension 5) is recorded as failed for this one value, so the phase cannot pass its design gate as it stands. This is a project-rule violation, not a matter of taste.
**Fix:** pick one of these and record it as UI-SPEC amendment A9:
- (a) `py-1` with `max-h-[320px]` (8 × 40px), both on scale;
- (b) keep 36px rows by declaring the row height a size rather than spacing (like the avatar `size-8`), for example `h-9 py-0` on the item.

Then re-run the §9 spacing grep. A cut-off ninth row as a scroll cue is fine either way.

## Info

### d-IN-1: Three different `@` boundary rules (trigger, render, strip)

**File:** `src/lib/mentions/composer-tokens.ts:56-57`, `:83`, `:317`; `src/lib/markdown/render.ts:74-75`
**Issue:** the three rules disagree:
- **Before the `@`:** the trigger requires whitespace or the start of the text. The renderer accepts anything except a letter, a digit or `_`, so `(@Zeta)` is styled although the composer never inserts it there. The strip accepts anything at all (d-WR-3).
- **After the name:** the renderer treats `_` as a word character but not a combining mark (`\p{M}`). The strip treats a combining mark as part of the word but not `_`. So `@Zeta_x` is not wrapped but is stripped, and `@Zeta` followed by a combining accent is wrapped with the accent split off into the next text node.
**Fix:** export one boundary predicate pair from `composer-tokens.ts` (or a shared `mentions/boundary.ts`) and use it in all three places.

### d-IN-2: Comment in `mentions.ts` misdescribes the render order

**File:** `src/lib/mentions/mentions.ts:14-16`
**Issue:** the comment says that the renderer "only wraps text that already sits in the sanitized tree". `rehypeMentions` runs before `rehypeSanitize` (`render.ts:192-194`). Together with d-WR-1, the security narrative in the two headers does not match the pipeline.
**Fix:** say "wraps text nodes of the Markdown tree before the sanitize pass, whose schema allows exactly that span", and correct `render.ts:52-56` with d-WR-1.

### d-IN-3: No client cap at MAX_MENTIONS; an over-cap note fails with a generic toast

**File:** `src/components/tickets/composer.tsx:291-299`, `:304-307`; `src/lib/mentions/mentions.ts:23`
**Issue:** the composer sends every intact span id. With more than 50 distinct mentions, the server answers 400 `invalid_mentions`, and the agent sees "Couldn't save your note. Try again." Trying again can never succeed. The case is rare but has no exit.
**Fix:** stop offering the list once 50 distinct ids are intact, or read the error code and show a specific message.

### d-IN-4: `sent` after the await clears text typed while the request was in flight

**File:** `src/components/tickets/composer.tsx:281-310`, `src/lib/mentions/composer-tokens.ts:426-435`
**Issue:** only the buttons are disabled while sending; the textarea stays editable. `dispatch({ type: "sent" })` runs after `await fetch` and clears the text, the spans and `insertedNames`, including anything typed or inserted after the click. The old composer had the same pattern (`setBody("")`). It now also discards the mentions inserted meanwhile.
**Fix:** make the textarea `readOnly` while `isSending`. Alternatively, have `sent` carry the text that was sent and clear only when the current text still equals it.

### d-IN-5: Inconsistent error codes and status mapping on the two routes

**File:** `src/app/api/tickets/[id]/messages/route.ts:40` (`membership_ended`) against `:53` and `:229` (`MEMBERSHIP_ENDED`); `src/app/api/members/mentionable/route.ts:26-33`
**Issue:** one route returns the same condition under two spellings. The mentionable route maps every error from `getScopedDb` other than `AccessDeniedError` to 401 `unauthorized`, including a database failure. The composer treats both as "failed", so nothing breaks today, but the codes are unreliable for clients and logs.
**Fix:** use one spelling. Treat only the redirect thrown by `requireSession` as 401, and re-throw anything else so it becomes a 500.

### d-IN-6: The caret used for the mention query goes stale while the textarea is not focused

**File:** `src/components/tickets/composer.tsx:165-174`, `:177-180`
**Issue:** the layout effect updates `cursor` only while the textarea has focus. After a toggle click or an AI-draft `loadDraft` (the text is replaced, and focus is on a button), `cursor` keeps its old value. Switching back to internal then runs `findMentionQuery` against that stale caret. If it lands right after an `@word` in the new text, the popover can open while the textarea is not focused. This was read in code only and not reproduced in a browser.
**Fix:** set `cursor` to `null` whenever the reducer replaces the text without focus (`setMode`, `loadDraft`, `sent`), for example by dropping the `activeElement` condition for the `setCursor` call only.

### d-IN-7: The no-inserted-name guarantee holds only at the moment of the switch, not at the public send

**File:** `src/lib/mentions/composer-tokens.ts:400-414`; `src/components/tickets/composer.tsx:281-294`
**Issue:** C7 says "an inserted member name must never reach a public body". `stripMentionTokens` runs only on the internal-to-public transition. After the switch, `insertedNames` is kept until the send, but nothing checks the public body against it. A name pasted back after the switch, or restored by the browser's undo, goes out as plain text. Whether undo can restore text that React set programmatically depends on the browser; this is unverified. A deliberate paste can reasonably count as text the agent typed (D-21). It is listed so the owner can decide, because the stated guarantee is broader than the code.
**Fix:** either narrow the C7 wording to "at the switch", or re-apply the strip (with the d-WR-3 boundary) to a public body on submit when `insertedNames` is non-empty and show the switch note.

### d-IN-8 (pre-existing, not in the diff hunks): a `body` form field sent as a File crashes the route with a 500

**File:** `src/app/api/tickets/[id]/messages/route.ts:71`, `:75`
**Issue:** `form.get("body") as string | null` does not check the value. When a client sends `body` as a file part, `body.trim` is not a function, a TypeError is thrown, and the route answers 500 instead of 400. Nothing is written, because this happens before any file is staged.
**Fix:** `const rawBody = form.get("body"); if (rawBody !== null && typeof rawBody !== "string") return 400 invalid_form_data;`

---

_Reviewed: 2026-11-13T02:09:14Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
