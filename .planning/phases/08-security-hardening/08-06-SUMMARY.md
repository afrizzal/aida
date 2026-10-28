---
phase: 08-security-hardening
plan: 06
subsystem: settings-connection-tests, tickets, worker
status: complete
tags: [security, D-25, D-28, F-08, F-11, F-13, AIDA-31, AIDA-32]
requires: []
provides:
  - src/lib/connection-test/errors.ts (CONNECTION_TEST_ERROR_CATEGORIES, ConnectionTestErrorCategory, ConnectionTestResult, ConnectionTestConfigError, classifyConnectionError, CONNECTION_TEST_ERROR_MESSAGES)
  - correlationId on the four connection-test action results
affects:
  - Settings LLM, embedding, IMAP and SMTP "Test connection" buttons (failure text)
  - tests/e2e/phase5-rag.spec.ts embedding failure assertion
tech-stack:
  added: []
  patterns:
    - "Connection-test catch: randomUUID correlation ID + classifyConnectionError(e) + console.error('[settings] connection test failed', { probe, category, correlationId })"
    - "Email probes validate host/port and construct the client inside the try"
key-files:
  created:
    - src/lib/connection-test/errors.ts
    - tests/unit/connection-test-errors.test.ts
    - tests/unit/settings-connection-actions.test.ts
    - tests/unit/add-tag-gate.test.ts
  modified:
    - src/app/(app)/settings/actions.ts
    - src/app/(app)/settings/email/actions.ts
    - src/app/(app)/settings/llm-test-connection-button.tsx
    - src/app/(app)/settings/embedding-test-connection-button.tsx
    - src/app/(app)/settings/email/test-connection-button.tsx
    - src/app/(app)/tickets/[id]/actions.ts
    - src/lib/worker/jobs/sla-flag.ts
    - tests/e2e/phase5-rag.spec.ts
decisions:
  - "ConnectionTestResult lives in the import-free errors module so both action files and all three buttons share one type"
  - "The classifier also recognises ETLS, ERR_SSL_* and status_code 401/403, beyond the plan's list, so nodemailer TLS errors, OpenSSL errors and Ollama ResponseError map like their siblings"
  - "A 404 from a provider (Ollama model not pulled) is unknown, per the plan's mapping; the plan defines no not-found category"
  - "addTag needed no reorder: getSessionActor (same requireSession redirect as getScopedDb) is already its first statement since 6619b4c (11-02); the test locks the order and a mutation run proves it discriminates"
metrics:
  duration: 7min
  completed: 2026-11-11
  tasks: 3
  files: 12
estimate:
  tokens: 85000
  tasks: 3
actuals:
  tokens: 13300
  tasks: 3
  commits: 3
plan_head_before: 6ec42504373a156e85afd0611218d5f56e5d72bd
---

# Phase 8 Plan 06: Categorized connection-test errors, addTag gate, sla-flag comment Summary

All four Settings connection tests (LLM, embedding, IMAP, SMTP) now return one of four fixed categories plus a fresh correlation ID. The response and the server log carry no raw failure text, host, URL or credential. `addTag`'s gate-first order is locked by a test, and `sla-flag.ts` explains why its raw SQL has no tenant filter (D-25, D-28; F-08, F-11, F-13).

## What was built

- **`src/lib/connection-test/errors.ts`** (no imports, client-safe). It provides the four categories, `ConnectionTestConfigError`, the shared `ConnectionTestResult` type, the message map, and `classifyConnectionError`. The classifier walks `cause` up to 5 levels below the thrown value and is cycle-safe. Hostile getters cannot make it throw. Precedence is fixed across the whole chain: invalid_configuration, then authentication_failed, then connection_failed, then unknown. It reads the raw message only to recognise the probes' own "Unsupported provider" errors.
- **Four actions.** Gates are unchanged (`requireOrgAdmin()`, then `getScopedDb()`). The catch block does `randomUUID()`, `classifyConnectionError(e)`, and `console.error("[settings] connection test failed", { probe, category, correlationId })`, then returns `{ ok: false, error, correlationId }`. Every `slice(0, 200)` raw echo is gone. IMAP and SMTP check the host (non-empty) and the port (integer 1..65535, or `ConnectionTestConfigError`), and build the client inside the `try`.
- **Three buttons.** They render `Connection failed: {CONNECTION_TEST_ERROR_MESSAGES[result.error]}` and `Reference: {correlationId}` inside the always-mounted `role="status" aria-live="polite"` region, using `text-[12px] text-destructive` (tokens only). A thrown action still shows "Unexpected error — please try again." with no reference.

### Exact category texts

| Category | Text |
|---|---|
| invalid_configuration | The settings are incomplete or invalid. Check the provider, host, port and URL. |
| authentication_failed | The server rejected the credentials. Check the API key, username or password. |
| connection_failed | AIDA could not reach the server. Check the address and that the server is running and reachable from AIDA. |
| unknown | The connection test failed for an unknown reason. Check the server log for the reference below. |

## Red-then-green runs

| File | Red | Green |
|---|---|---|
| tests/unit/connection-test-errors.test.ts | exit 1: "Cannot find module ../../src/lib/connection-test/errors" (module not yet written) | exit 0, 15 passed |
| tests/unit/settings-connection-actions.test.ts (Task 1 case) | exit 1: the LLM case got `'connect ECONNREFUSED 10.0.0.5:11434'` instead of `connection_failed` (1 failed, 1 passed) | exit 0 |
| tests/unit/settings-connection-actions.test.ts (Task 2 cases) | exit 1: 10 failed, 19 passed across both files. The concurrency and IMAP-success cases already passed on Task 1 code | exit 0, 14 passed in this file (29 across both files) |
| tests/unit/add-tag-gate.test.ts | Not red on current code: exit 0, 3 passed, because the gate was already first (see deviation 3). Discrimination proof: a temporary mutant (`if (!name.trim()) return { ok: false };` before the gate) gave exit 1, 2 failed (the gate case and the validation case), 1 passed. Restored with `git checkout -- <file>` | exit 0, 3 passed |

## Verification commands

| Command | Exit | Counts |
|---|---|---|
| `pnpm exec vitest run tests/unit/connection-test-errors.test.ts tests/unit/settings-connection-actions.test.ts` | 0 | 2 files, 29 tests passed |
| `pnpm exec vitest run tests/unit/add-tag-gate.test.ts` | 0 | 3 passed |
| `pnpm typecheck` | 0 | no `error TS` |
| `pnpm lint` | 0 | 565 files checked |
| `pnpm test` (after Task 3) | 0 | 57 files, 932 tests passed |
| Acceptance greps | pass | `classifyConnectionError(` count is 2 in each action file. `slice(0, 200)` count is 0. Both `createImapClient(` and `createSmtpTransport(` sit after `try {`. `CONNECTION_TEST_ERROR_MESSAGES` is used in all 3 buttons. errors.ts has 0 import lines. `F-13` was found in sla-flag.ts |
| `pnpm test:e2e` (phase5-rag assertion edit) | not run | Out of this plan's verify list. It runs at the Part A gate (08-24) |

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | b156aee | fix(08-06): return categorized LLM connection-test errors (D-25) |
| 2 | 4776d5b | fix(08-06): categorize embedding, IMAP and SMTP connection-test errors (D-25) |
| 3 | f2a8d03 | fix(08-06): gate addTag before validation and document sla-flag raw SQL (D-28) |

## Deviations from Plan

1. **[Rule 2 - Missing critical] Extra classifier signals.** I added `ETLS` (nodemailer), the `ERR_SSL_` prefix (OpenSSL, for example a TLS handshake against a plaintext port), `status_code` 401/403 (Ollama `ResponseError`), and the constructor name (SDK classes do not always set `name`). Without them, real TLS failures would fall to `unknown`, and the plan's truth says TLS maps to `connection_failed`. Files: errors.ts and its test (Task 1, b156aee).
2. **[Rule 1 - Bug caused by this change] E2E assertion on raw text.** `tests/e2e/phase5-rag.spec.ts` asserted the raw Ollama text `model "..." not found, try pulling it first`, and D-25 removes that text by design. The assertion now expects the `unknown` category text and a `Reference:` UUID line, and checks that the raw text is absent. The stub answers 404, and 404 carries no auth, network or config signal. This file is outside the plan's `files_modified`. I did not run it here (Task 2, 4776d5b). `phase4-ai.spec.ts` matches `/Connection failed:/` and still matches.
3. **[Plan drift] addTag was already gate-first.** The plan describes the tree at a01f6ce (`name.trim()` before `getScopedDb()`). Since 6619b4c (11-02), `addTag`'s first statement is `await getSessionActor()`, which calls the same `requireSession()` redirect as `getScopedDb()`. Name validation now sits in `runTicketMutation`'s `validateInput`. Replacing it with `getScopedDb()` would add an unused db client and change behaviour, so I left the code as it is. I added a JSDoc sentence stating the invariant, plus the test. The plan's literal verify (`grep "await getScopedDb()"` on the first body line) cannot match. The equivalent check, `grep "await getSessionActor()"`, prints `gate-first`. The test mocks `getSessionActor` and `@/lib/db` instead of `@/lib/tickets/sla` (the file no longer imports it). The backstop truth holds: the find-or-create path (`INSERT ... ON CONFLICT DO NOTHING` in mutations.ts) is untouched, and this plan made no code change to `addTag`.
4. **[Plan drift] The sla-flag comment matches the current code.** The file now has two lock `SELECT ... FOR UPDATE SKIP LOCKED` statements as well as the two UPDATEs (12.1-06), and the UPDATEs pair each ticket with its own `organizationId`. The plan's sentence "an UPDATE returns no rows to any caller" is kept in substance. The comment covers all four statements: the SELECTs return only id and organizationId to the job itself, and the handler returns nothing. It sits above the first raw statement (`lockBreachCandidates`), not above the first `$executeRaw`. The import `from "../../db"` stays relative but is on line 24, not line 1, because a header comment and a type import precede it (pre-existing).
5. **Test isolation.** add-tag-gate uses `vi.resetAllMocks()`, because `clearAllMocks` keeps queued once-implementations, which leaked between cases in the mutant run. The concurrency case in settings-connection-actions uses two `mockRejectedValueOnce` calls, not a persistent mock.

## Review Dispositions Ledger

Round 2 (96d7c8f) R2-2 (Docker health): not applicable, as the plan states. Only unit tests, typecheck and lint ran, and no Docker was used. No other review item is assigned to this plan.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change. T-08-20 to T-08-24 are mitigated as planned. T-08-25 (SSRF and timing) stays accepted, and the module header says so.

## Manual items (left open for a human)

- Check the three Settings buttons' new error text in the real UI, in light and dark mode (DESIGN-SYSTEM §9 look). Tests cover the token and size rules, not the look. Not done; no human result is recorded.
- A not-pulled Ollama embedding model now shows the generic `unknown` text instead of the specific "model not found" text (a UX trade-off of D-25). Whether to add a category for it is a product decision.

## Self-Check: PASSED

- FOUND: src/lib/connection-test/errors.ts, tests/unit/connection-test-errors.test.ts, tests/unit/settings-connection-actions.test.ts, tests/unit/add-tag-gate.test.ts
- FOUND commits: b156aee, 4776d5b, f2a8d03 (`git rev-list --count 6ec4250..HEAD` = 3)
