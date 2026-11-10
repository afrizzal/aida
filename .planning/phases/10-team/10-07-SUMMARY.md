---
phase: 10-team
plan: 07
subsystem: mentions
status: complete
tags: [mentions, markdown, sanitize, notifications, privacy, testcontainers]
requires:
  - "10-01: MessageMention model (migration 20261115100000_team_foundation), DOMAIN_MODELS Phase 10 block"
  - "10-02: getScopedDb membership re-read, readFreshSession (cookie cache off since 0db72a9, R10-1)"
  - "10-04: emitNotifications(tx, orgId, items), TICKET_ENTITY"
provides:
  - "src/lib/mentions/mentions.ts: MAX_MENTIONS (50), MAX_MENTION_ID_LENGTH, MentionError, parseMentionField, mentionDisplayName, resolveMentionedMembers, recordMentions"
  - "src/lib/markdown/render.ts: renderMarkdown(markdown, { mentionNames }), MENTION_CLASS_NAMES, renderSanitizeSchema, rehypeMentionSpanGuard"
  - "messages route: `mentions` form field (JSON array of user ids), 400 invalid_mentions / mentions_not_allowed"
affects: [10-12, 10-13, 10-14]
tech-stack:
  added: []
  patterns:
    - "Mention spans built from text already in the hast tree, never from raw HTML; a guard before and after the sanitize pass keeps only the exact span shape"
    - "renderMarkdown has its own sanitize schema (shared schema plus one span shape); email, KB preview and task renderers keep the shared schema unchanged"
    - "Per-call renderer options through vfile data, so the processor stays one frozen instance"
key-files:
  created:
    - src/lib/mentions/mentions.ts
    - tests/integration/mentions.test.ts
  modified:
    - src/lib/markdown/render.ts
    - src/app/api/tickets/[id]/messages/route.ts
    - tests/unit/markdown-render.test.ts
decisions:
  - "Mention ids are validated just before message.create, inside the same transaction after the membership re-check and the ticket lock, because bodyHtml is computed at create time (the ledger's recorded deviation from V-12's word order)"
  - "An empty list (`mentions=[]`) on a public reply is no mention and is accepted; any non-empty list on a mode other than internal is 400 mentions_not_allowed (D-21)"
  - "A display name that is empty or contains `@` falls back to the email local part; renderMarkdown never wraps a name containing `@`, so the markup cannot carry an email address"
  - "A word boundary is required on both sides of a mention (no letter, digit or `_` before the `@` or after the name), so `@Anabel` and `x@Ana` are not `@Ana`"
  - "The span guard runs before and after sanitization: a span with an extra class is unwrapped, not trimmed by the sanitizer into the mention shape"
  - "Any member row counts as a current member for a mention (V-26 ledger row: a mention grants no right); duplicate member rows yield one mention"
metrics:
  duration: "about 13 minutes (2026-11-12T22:33Z to 22:46Z)"
  completed: 2026-11-13
  tasks: 3
  files: 5
estimate:
  tokens: 60000
  tasks: 3
actuals:
  tokens: 11800
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 160345fb83361246bb827c092b511151a35d8496
---

# Phase 10 Plan 07: Mentions (server) Summary

Mentions in internal notes are validated against current members inside the message transaction, stored in `MessageMention`, notified once per member (`MENTION`, eventKey `mention:{messageId}`), rendered through the sanitized markdown path as one allowed span shape, refused on anything but an internal note, and proven absent from the customer email and the status page.

## What was built

- **`src/lib/mentions/mentions.ts`** (relative imports only, no `@/`):
  - `parseMentionField(raw, mode)`: absent or `""` gives `[]`. Otherwise the field must be a JSON array of at most 50 non-empty strings of at most 128 characters, else `MentionError("invalid_mentions")`. A non-empty list with a mode other than internal gives `mentions_not_allowed`.
  - `resolveMentionedMembers(tx, orgId, authorUserId, ids)` deduplicates, drops the author, and runs one `member.findMany` with an explicit organization term inside tx. It returns each member once, in the order sent, with `mentionDisplayName` (the name, else the email local part, never the full email).
  - `recordMentions(tx, orgId, …)` runs `messageMention.createMany` with `organizationId` explicit and `skipDuplicates`, then calls `emitNotifications` with type MENTION, eventKey `mention:${messageId}`, entity ticket, and the author as actor. The emitter re-checks membership and in-app preferences.
- **`src/lib/markdown/render.ts`**: `renderMarkdown(markdown, { mentionNames })`.
  - With names, a rehype step before sanitization wraps each exact `@name` found in a text node in `<span class="font-semibold text-primary-emphasis">`. It skips text inside `code`, `pre` and `a`, tries the longest name first, and requires word boundaries.
  - `renderSanitizeSchema` is the shared schema plus `span: [["className", "font-semibold", "text-primary-emphasis"]]`.
  - `rehypeMentionSpanGuard` runs before and after sanitization. It keeps a span only in the exact shape (both classes, text children only) with no other property, and unwraps every other span. This also removes the global `id` that the default schema would otherwise allow.
  - The shared `schema` is unchanged, so `sanitizeEmailHtml`, the KB preview and the task renderer cannot carry the mention classes.
- **Messages route**:
  - `parseMentionField(form.get("mentions"), mode)` runs after the body is read, before any file is validated or staged and before the transaction. A failure is a 400 `{ error: code }`.
  - Inside the transaction, after `findActiveMembership(tx, …)` and `lockTicketForAgentWrite`, internal mode only: `resolveMentionedMembers`, then `bodyHtml: renderMarkdown(body, { mentionNames })`, then `message.create`, then `recordMentions`.
  - Plain `@text` in a public reply has no ids, so it stays text.

## How "never reaches the customer" is proven (D-21, V-12, T-10-26)

`tests/integration/mentions.test.ts` posts through the real route with a real Better Auth sign-in, mocking only `next/headers` and `next/navigation`. It uses a recording queue double and a recording SMTP transport (`vi.mock("@/lib/channels/email/smtp-client", …)`, as in `email-outbound-merge.test.ts`; V-15 allows this for plain sends).

- Public mode, or a mode outside the two, with a non-empty `mentions` field gets 400 `mentions_not_allowed`. No message row, no MessageMention, no notification, nothing queued.
- Outbound leak case:
  - An internal note mentions "Quillon Vantablack" on a ticket with a contact and email settings on. The note has the span and one MessageMention, and nothing is queued.
  - A PUBLIC reply is then posted through the route. The single queued job is run through `emailOutboundSendHandler`, which re-renders `bodyMarkdown`.
  - Exactly one mail is captured. Presence is asserted first: `to` is the contact, and `text` and `html` contain the reply text.
  - Then both parts are checked for absence: no "Quillon" or "Vantablack", no `text-primary-emphasis` or `font-semibold`, no member email, no note text.
- Status page: in the same case, `loadStatusPageData(statusToken)` shows the reply. Every message it returns is PUBLIC and carries no name, mention class or member email.
- Plain `@Quillon Plaintext` in a public reply: no span, no MessageMention, no notification. The outgoing mail keeps the plain text and has no span, no class and no email.

## How the sanitizing is proven (D-20, T-10-28)

Ten new cases in `tests/unit/markdown-render.test.ts` cover:
- no span without names;
- the exact span;
- `@Anabel`, `@Ana_b` and `x@Ana` not wrapped;
- inline code, fenced blocks and link text left plain;
- `@Zeta Prime` becoming one span when both names are given;
- a literal span tag in Markdown dropped (mention classes included);
- spans with style, `data-*`, id, title, an extra class, one class only, or element children never surviving (run through the same guard, schema, guard stages);
- 50 mentions giving 50 spans and the same count of every other tag;
- a hostile name escaped as text, and a name containing `@` never wrapped;
- inbound email HTML that cannot keep the mention classes.

## Verification

All Docker steps used run id `mwe4lvs8-498c47aa92572e0b`. `colima status` exited 0 and `docker info` exited 0 before each Docker step.

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` (Task 1, first run) | 2 | `MentionFileData` not assignable to vfile `Data`; fixed |
| `pnpm typecheck` (Task 1) | 0 | clean |
| `pnpm test:integration tests/integration/mentions.test.ts` (Task 1, tracer) | 0 | 1 passed |
| `pnpm test tests/unit/membership-inventory.test.ts tests/unit/markdown-render.test.ts` (Task 1; the script's `tests/unit` filter runs all unit files) | 0 | 106 files, 1879 passed |
| `pnpm exec vitest run tests/unit/markdown-render.test.ts` (Task 2, first run) | 1 | 41 passed, 1 failed: an extra class was trimmed into the mention shape; the guard now also runs before sanitization |
| same (Task 2) | 0 | 42 passed |
| `pnpm test tests/unit/markdown-render.test.ts` (Task 2 verify; runs every unit file) | 0 | 106 files, 1889 passed (includes the membership inventory, Rules A to E) |
| `pnpm typecheck` (Task 2, Task 3) | 0 | clean |
| `pnpm test:integration tests/integration/mentions.test.ts` (Task 3) | 0 | 10 passed |
| `pnpm lint` | 0 | 722 files, 1 warning in `tests/unit/container-config.test.ts:160`, which this plan did not change |
| `pnpm test:integration` on membership-gate, ticket-merge, snooze, sla-pause, merge-race-coverage, file-delete-inventory (regression on the changed route) | 0 | 6 files, 139 passed |

Tracer gate: Task 1's `<verify>` passed end to end before Tasks 2 and 3.

Acceptance greps:
- Task 1: `parseMentionField` in route is 3, `recordMentions` in route is 2, `text-primary-emphasis` in render.ts is 1, `@/` in mentions.ts is 0.
- Task 2: `Zeta Prime` in the unit test is 4; 10 new cases (need at least 7).
- Task 3: `it(` in mentions.test.ts is 11 (need at least 9); `emailOutboundSendHandler` is 2. The outbound case asserts exactly one captured mail and its presence text before any absence assertion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Span guard before sanitization as well as after**
- **Found during:** Task 2
- **Issue:** The sanitizer trims disallowed class tokens. A span with `font-semibold text-primary-emphasis evil` was therefore trimmed into the exact mention shape and kept.
- **Fix:** `rehypeMentionSpanGuard` now also runs before the sanitize pass, so such a span is unwrapped. The guard after the pass stays and removes the schema's global attributes, such as `id`.
- **Files modified:** src/lib/markdown/render.ts, tests/unit/markdown-render.test.ts
- **Commit:** c00a56f

**2. [Rule 2 - Critical] Post-sanitize span guard and a separate renderMarkdown schema**
- **Found during:** Task 1
- **Issue:** The default schema allows `span` and a global `id` on every element. Adding the span classes to the shared schema would also have let inbound email HTML keep mention-looking spans.
- **Fix:** renderMarkdown alone uses `renderSanitizeSchema`. The guard removes every span property except the two classes. The shared schema is unchanged; Task 2 has a test for this.
- **Commit:** d2ef6a9

### Other differences from the plan text
- **TDD order in Tasks 2 and 3:** Task 1 had to implement the render step and the route, so the behaviour existed before these cases were written. The cases passed on their first run, except the one in deviation 1, which was a genuine RED. No intentional RED commit exists for the rest.
- **Extra cases beyond the plan:**
  - exactly 50 ids is accepted;
  - display-name fallback to the email local part;
  - an empty `mentions` list on a public reply;
  - a mode string outside the two counts as public and is refused;
  - the status-page check inside the outbound case (D-21 lists the status page).
- **V-12 word order:** validation runs just before `message.create`, as the ledger records. The atomicity and lock order are unchanged.

## Flagged assumptions (from the plan, unchanged)

- The cap is 50 ids per message, and over the cap is a 400.
- Membership of a mentioned id is read inside the message transaction before the create. A member removed after that read and before commit still gets a MENTION row. The bell and the digest re-check membership.

## Not run / manual

- The backstop truth "a note with 50 mentions shows no layout overflow inside the thread message" is only proven at the markup level (50 spans, no other new element). Visual layout was not checked; it stays a manual or visual item.
- No E2E was run by this plan. The composer side (mode switch, Backspace behaviour, autocomplete) is 10-12 and 10-13.
- `.next` was not moved.

## Known Stubs

None.

## Threat Flags

None. The only new input is the `mentions` field on an existing authenticated route, and it is covered by T-10-26 to T-10-29.

## Self-Check: PASSED

- FOUND: src/lib/mentions/mentions.ts, tests/integration/mentions.test.ts, src/lib/markdown/render.ts, src/app/api/tickets/[id]/messages/route.ts, tests/unit/markdown-render.test.ts
- FOUND commits: d2ef6a9, c00a56f, b0d6697
