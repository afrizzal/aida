---
phase: 10-team
plan: 16
subsystem: public status-token paths, static inventory
status: complete
tags: [status-token, public-routes, inventory, typescript-parser, privacy, rule-e]
requires:
  - "10-02: tests/support/source-inventory.ts and tests/unit/membership-inventory.test.ts (the per-function inventory and its allowlist)"
provides:
  - "src/lib/tickets/status-page-data.ts: findTicketByStatusToken(token) beside loadStatusPageData and loadStatusAttachment"
  - "csat and follow-up routes reach their ticket only through findTicketByStatusToken"
  - "tests/integration/status-token.test.ts: 12 cases on Testcontainers"
  - "Rule E in the membership inventory: helper use, no own ticket or message read, bound delegate and lib calls, per-function public allowlist"
affects: [10-06, 10-14]
tech-stack:
  added: []
  patterns:
    - "One named lookup per kind of status-token read; the token is the authorization"
    - "Static binding check: every access in a status-token entry references the helper's returned value or a value derived from it"
key-files:
  created:
    - tests/integration/status-token.test.ts
  modified:
    - src/lib/tickets/status-page-data.ts
    - src/app/api/public/status/[token]/csat/route.ts
    - src/app/api/public/status/[token]/follow-up/route.ts
    - tests/support/source-inventory.ts
    - tests/unit/membership-inventory.test.ts
decisions:
  - "findTicketByStatusToken selects id, organizationId, contactId and state.group: the columns the two routes used (csat's include read every scalar but used only id and the group)"
  - "Rule E binding keys per model: ticket uses id, attachment accepts ticketId or messageId (it has no ticketId column), organization uses id as its organization key with no ticket key; every other model needs organizationId and ticketId"
  - "Rule E findings of kind no-helper, own-read, unbound-access and unbound-call are never allowlisted; only public-reach and raw-sql entries exist (R3-4)"
  - "consumeRateLimit and boundUploadCommitInTx are listed as non-tenant callees with reasons, hygiene-checked (each must exist and be called)"
  - "Any <receiver>.<model>.<prisma op> call in a status-token entry is judged, whatever the receiver, so a strict false positive is possible but no client is missed"
metrics:
  duration: "about 12 minutes of wall time for execution (2026-11-12T20:26Z to 20:38Z)"
  completed: 2026-11-13
  tasks: 2
  files: 6
estimate:
  tokens: 50000
  tasks: 2
actuals:
  tokens: 13800
  tasks: 2
  commits: 3
commits: 3
plan_head_before: b2eb7fe463ed60ed8b8a1a7702dc83fd177716c5
---

# Phase 10 Plan 16: findTicketByStatusToken for the two status-token POST routes, and Rule E with bound-access checks Summary

The csat and follow-up routes now reach their ticket through one named lookup, `findTicketByStatusToken`. It sits beside the page loader and the attachment loader, and no second page loader was added. Their answers are unchanged. The membership inventory's Rule E is now a real check. A status-token entry must call one of the three helpers and must not read tickets or messages itself. Every other access must carry the organization and ticket the helper returned. There is no escape hatch through the SUMMARY.

## What was built

- **`findTicketByStatusToken(token)`** in `src/lib/tickets/status-page-data.ts`. Its header comment states the rule: possession of the token is the authorization, and only that ticket's data is reachable. It returns null without a query for an empty token or one longer than 256 characters (`MAX_STATUS_TOKEN_LENGTH`; `generateStatusToken` writes 32). Otherwise it runs one `prisma.ticket.findUnique({ where: { statusToken } })`. The file still uses relative imports only.
- **Selected fields (the union, as the plan asked).** csat used `include: { state: { select: { group: true } } }` and read `ticket.id` and `ticket.state.group`. follow-up used `select: { id, organizationId, contactId }`. The helper selects `id`, `organizationId`, `contactId` and `state: { group }`. That reads no column either route did not read before. csat's include read every ticket scalar, so the helper actually reads fewer columns.
- **The csat and follow-up routes** call the helper in place of their inline lookup. The order is unchanged (rate limit, then lookup, then body). The 404 body `{ error: "not_found" }`, the honeypot, validation, file handling and the transaction are also unchanged. csat no longer imports `prisma`.
- **`tests/integration/status-token.test.ts`** runs 12 cases on Testcontainers with no mocks. Organizations come from `seedOrgWithMembers` (explicit ids), tickets and contacts from `seedContactTicket`, and messages from `seedMessage` and an explicit-id INTERNAL note. The routes' POST is called with constructed Requests, each from a fresh client identity.
- **Rule E** is in `tests/support/source-inventory.ts` (`statusTokenFindings`, `statusBoundNames`). Its configuration is `RULE_E` in `tests/unit/membership-inventory.test.ts`, with 14 new cases. The `// Rule E slot: plan 10-16` comment is gone. Rule A still skips the public prefixes, and Rule E judges them now.

## Rule E (as checked; the text is also in the test header)

Possession of the status token is the authorization, and only that ticket's data is reachable (D-08, V-11, R2-3, R3-4).

1. Every entry function under `src/app/(public)/status/` or `src/app/api/public/status/` calls `loadStatusPageData`, `loadStatusAttachment` or `findTicketByStatusToken`, imported from `src/lib/tickets/status-page-data.ts` (finding kind `no-helper`). A public entry elsewhere that calls a helper is judged the same way.
2. The entry's own body, plus the same-module and `src/app` helpers it runs, makes no read call (`findUnique`, `findFirst`, `findMany`, `count`, `aggregate`, `groupBy` and the `OrThrow` variants) on the `ticket` or `message` delegate. Kind `own-read`.
3. **Bound names.** The identifier the helper's awaited result is bound to is bound. So is any variable or assignment whose initializer references a bound name, and any parameter of a closure helper that receives a bound argument. This is a fixpoint over the closure, matched by name.
4. Every other model delegate call (`<receiver>.<model>.<op>`, with any receiver: `prisma`, a `$transaction` callback parameter, or anything else) carries a binding in its literal: `where` for reads, updates and deletes, `data` for creates (each element of an array literal), and `where` plus `create` for upsert. The literal needs an organization key and a ticket key whose initializers reference a bound name. Default keys: `organizationId` and `ticketId`. `ticket`: `organizationId` and `id`. `attachment`: `organizationId` and `ticketId` or `messageId` (the column does not exist, so it belongs to the ticket through its message). `organization`: `id` and no ticket key (the row is the tenant itself). A `data` or `where` given as a variable cannot be checked and is flagged. Kind `unbound-access`.
5. Every call to an imported tenant-reaching `src/lib` function (or a method of an imported `src/lib` value) passes an argument that references a bound name. Tenant reach is the inventory's `libReaches` (the shared prisma client, `scopedDb` or raw SQL, transitively). The prisma client itself is judged by item 4, and the helpers are skipped. Kind `unbound-call`.
6. Raw SQL (`$queryRaw`, `$executeRaw`, the `Unsafe` variants, `sql` tags) is reported as kind `raw-sql` and needs a per-function allowlist entry of that kind with a reason. The real tree has none.
7. Any other tenant-reaching entry under `src/app/(public)/` or `src/app/api/public/` is kind `public-reach` and needs a per-function allowlist entry of that kind with a reason.
8. Only `public-reach` and `raw-sql` can be allowlisted. A Rule E entry must name its kind, and an entry suppresses only findings of the same kind. Findings of kinds 1 to 5 are never allowlisted (R3-4). A fixture proves that an entry for the same function does not suppress them.

### Non-tenant callees (read before listing; each hygiene-checked: exists, non-empty reason, called by a public entry)

| Function | Home | Reason |
|---|---|---|
| consumeRateLimit | `src/lib/rate-limit/check-rate-limit.ts` | counts and inserts only RateLimitHit rows of the scope and the hashed client identity, under an advisory lock. RateLimitHit has no organization, and the call runs before the token lookup by design (D-21, D-22) |
| boundUploadCommitInTx | `src/lib/attachments/uncertain-commit.ts` | runs only `set_config('idle_in_transaction_session_timeout')` and `pg_current_xact_id()` in the caller's transaction (K155, K158), and reads or writes no row |

### Public allowlist (Rule E, kind public-reach), each confirmed by reading the file

| File | Function | Reason |
|---|---|---|
| `src/app/(public)/request/page.tsx` | RequestPage | the public request form's brand row: reads the id and name of the single organization (findFirst, single-org v1) and its public logo through loadPublicBrand; no ticket, contact or message row |
| `src/app/api/public/intake/route.ts` | POST | anonymous ticket creation from the public request form, rate limited first: resolves the single organization, stores the validated uploads under it, creates the ticket through createTicket and links the uploads to that new ticket's first message; it reads no existing ticket and answers only the new ticket's status token |
| `src/app/api/public/logo/[orgId]/[version]/route.ts` | GET | the public logo, rate limited first: readCurrentLogo selects by the organization id and the exact current logo version of the URL and serves only the stored logo bytes (Phase 9, 09-05); no other tenant row |

`src/app/(public)/layout.tsx#PublicLayout` reaches nothing, so it is recorded as "Rule E: no tenant reach" and has no entry. All three entries suppress one finding each, and the real-tree hygiene list is empty.

### Per status-token entry: helper and bound accesses

| Entry | Helper (bound name) | Bound accesses | Not judged (no tenant reach, or listed) |
|---|---|---|---|
| `src/app/(public)/status/[token]/page.tsx#StatusPage` | loadStatusPageData (`ticket`) | `prisma.organization.findUnique({ where: { id: ticket.organizationId } })`; `loadPublicBrand(org)` (`org` derived from the bound read) | none |
| `src/app/api/public/status/[token]/attachments/[id]/route.ts#GET` | loadStatusAttachment (`attachment`) | no delegate call and no tenant-reaching lib call besides the helper | consumeRateLimit (listed); getRateLimitIdentity, rateLimitedResponse, `localFileStorage.read({ orgId: attachment.organizationId, … })` (no database reach) |
| `src/app/api/public/status/[token]/csat/route.ts#POST` | findTicketByStatusToken (`ticket`) | `recordCsat(ticket.id, …)` | consumeRateLimit (listed); readBoundedFormData, getRateLimitIdentity, rateLimitedResponse |
| `src/app/api/public/status/[token]/follow-up/route.ts#POST` | findTicketByStatusToken (`ticket`) | `resolveReplyTicket(tx, ticket.organizationId, ticket.id)`; `reopenOnCustomerReply(tx, { orgId: ticket.organizationId, ticketId: effectiveTicketId })`; `tx.message.create({ data: { organizationId: ticket.organizationId, ticketId: effectiveTicketId, … } })` (`effectiveTicketId` derived from `resolved`); `tx.attachment.create({ data: { organizationId: ticket.organizationId, messageId: created.id, … } })` (`created` derived); `queueStagedFilesAfterUncertainCommit(ticket.organizationId, …)` | consumeRateLimit and boundUploadCommitInTx (listed); `storeValidatedUploads` and `removeStoredUploads` (filesystem, they pass `ticket.organizationId`), validateUploadFiles, renderMarkdown, readBoundedFormData, `followUpSchema.safeParse` |

## Verification

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` (Task 1, Task 2) | 0, 0 | clean |
| `pnpm test:integration tests/integration/status-token.test.ts tests/integration/status-read-snapshot.test.ts` (Task 1, then again after the commit as the tracer gate) | 0, 0 | 2 files, 15 passed (12 new and 3 snapshot) each time |
| `pnpm test:integration` public-route-limits, public-state-label, public-upload-caps, reply-reopen-race, merge-reply-race, merge-provenance (existing public-status suites) | 0 | 6 files, 83 passed |
| `pnpm lint` (Task 1 before format, after format, Task 2) | 1, 0, 0 | the first run failed on formatting of the new test only (fixed with `biome format --write`); after that 710 files, 1 warning, pre-existing at `tests/unit/container-config.test.ts:160` |
| RED: `pnpm exec vitest run tests/unit/membership-inventory.test.ts` before Rule E existed | 1 | 12 failed, 30 passed; every failure an AssertionError on the planned behaviour (the two controls passed, as expected) |
| GREEN: same command | 0 | 43 passed |
| Fail-first on the real tree (three temporary source mutations, each restored from a byte copy): follow-up `message.create` with a literal organization; csat `recordCsat(token, …)`; the status page reading its organization by `id: token` | 1, 1, 1 | each made "reports zero violations" fail with the expected unbound-access or unbound-call detail; `git status` was clean afterwards |
| `pnpm test tests/unit/membership-inventory.test.ts` (the script runs all of `tests/unit`) | 0 | 104 files, 1847 passed |
| `pnpm test:e2e tests/e2e/public-status.spec.ts`, attempt 1 | 1 | global setup stuck at `/setup` (`locator.click` timeout at `global-setup.ts:173`, a dev-server reload loop, no error line); no spec ran |
| `pnpm test:e2e tests/e2e/public-status.spec.ts`, attempt 2 after moving `.next` | 0 | 5 passed |

Every Docker step ran with `AIDA_TEST_RUN_ID=mwdzw2ae-97bea9f36b1346d1`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. `colima status` and `docker info` exited 0 before the first Docker step of each task and before each E2E attempt. `pnpm test:docker-cleanup --apply` was not run.

**`.next` move:** after the first E2E attempt hit the known reload loop (LAPORAN rows of 08-02, 09-07 and 09-09), `.next` was moved to `~/.Trash/aida-next-1794515820`. It was not removed. The retry passed.

Acceptance greps: `\.ticket\.(findUnique|findFirst|findMany)` is 0 in both routes. `findTicketByStatusToken` appears 2 times in each route. `export async function findTicketByStatusToken` appears 1 time, and `export async function load` 2 times. `it(` appears 12 times in status-token.test.ts. `Rule E slot: plan 10-16` is 0, `findTicketByStatusToken` appears 7 times, `loadStatusPageData|loadStatusAttachment` 9 times and `R3-4` 7 times in the inventory test. `git diff --stat -- package.json pnpm-lock.yaml` prints nothing.

## Prohibitions

- **AIDA-45** ("MUST NOT load an INTERNAL message, or a mention inside one, for the public status page"): verified by test. `loadStatusPageData` on a ticket with a PUBLIC reply and an INTERNAL note carrying a `font-semibold text-primary-emphasis` mention span returns the PUBLIC reply. Presence is asserted first. The note id, the span class and the mentioned name are absent from every returned message.
- **AIDA-43** ("MUST NOT let a status-token route read or write tenant data not bound to the ticket and organization its token resolved to"): verified by test, for the database. Integration: each of two organizations' tokens returns only its own ticket, and a follow-up through organization A's token writes one message on A's ticket, organization and contact, and nothing in B. Static: Rule E fails the unit suite on an own lookup, an own message read, a contact read bound only by organization (R3-4), an attachment read with a request-parameter organization (R3-4), and a raw token passed to a tenant-reaching lib call.

## Deviations from Plan

### Auto-fixed Issues

None. Both tasks ran as written. The points below are interpretations.

### Interpretations

1. **The helper file was extended.** As the plan allowed, I extended `tests/support/source-inventory.ts` because it had no binding lookup. New: `RuleId` "E", `RuleEKind`, `kind` on `AllowEntry` and `Violation`, `StatusTokenRules` and `ModelKeys`, `statusBoundNames`, `statusTokenFindings`, the Rule E branch in the entry loop, kind-matched suppression, and hygiene for E entries and the non-tenant callees. The inventory row's `exemption` now reads `Rule E: <helper>`, `Rule E allowlist: <reason>` or `Rule E: no tenant reach` for public entries.
2. **Per-model keys.** The must-have text names "an organizationId and a ticketId (or id for the ticket model)". The real tree needs two more cases, and the table above records them. The status page reads `organization` by `id` (no organizationId column). The follow-up route creates `attachment` rows, which have no ticketId and point at the message created under the bound ticket. The plan's own control (attachment with `ticketId: ticket.id`) still passes, because `attachment` accepts `ticketId` or `messageId`.
3. **Derived values count as bound.** The follow-up's `ticketId: effectiveTicketId` is derived from `resolveReplyTicket(tx, ticket.organizationId, ticket.id)`, so the binding follows variable initializers and assignments. This is a static over-approximation by name across the closure. A value computed from the helper's result together with request data also counts as bound.
4. **Non-tenant callees** are a test-held list with reasons and hygiene. This is not a per-entry escape hatch: such a call is skipped only because its module reaches no tenant row.
5. **RED evidence tool.** `gsd-tools check tdd-red-evidence` returned `INVALID_RED / zero_tests_discovered` on the vitest TAP output (`--reporter=tap-flat` and `--reporter=tap`). It parses node-test summary lines (`# tests N`, `# fail N`), and vitest does not print them. I did not fabricate those lines. The RED evidence is the run above: exit 1, 12 named tests failing on AssertionErrors (for example the R3-4 contact case, "expected [] to deeply equal [ 'E …/fx/route.ts#POST' ]"), and committed as `067f8f7` before the implementation.

## Known limitations (not stubs)

- Rule E's tenant reach is the inventory's database reach, so filesystem calls (`storeValidatedUploads`, `removeStoredUploads`, `localFileStorage.read`) are not judged. In the real tree each passes the bound organization id anyway. A later rule could add the attachment storage modules as tenant-reaching.
- Plan 10-06 (wave 3) adds a notification emit to the follow-up route. Rule E will require that emit's delegate writes and lib calls to carry the bound organization and ticket (or message) ids.

## Known Stubs

None.

## Threat Flags

None. No new endpoint or trust boundary. The two routes changed only which function runs their existing lookup.

## TDD Gate Compliance

RED `067f8f7` (test only, 12 assertion failures), GREEN `681fd28` (43 passed). No refactor commit was needed. Task 1 (tracer) was verified end-to-end again after its commit `5b05599` before Task 2 began.

## Manual items

None for this plan. No UI changed.

## Self-Check: PASSED

- FOUND: tests/integration/status-token.test.ts, src/lib/tickets/status-page-data.ts, tests/support/source-inventory.ts, tests/unit/membership-inventory.test.ts
- FOUND commits: 5b05599, 067f8f7, 681fd28
