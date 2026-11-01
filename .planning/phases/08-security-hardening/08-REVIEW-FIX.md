# Phase 8 Part A: Code Review Fix Report

Sources: `08-REVIEW.md` (part a, with the orchestrator dispositions and decisions K126 to K130), `08-REVIEW-b.md`, `08-REVIEW-c.md`, `08-REVIEW-d.md`.

## F1

Fixer: Claude (gsd-code-fixer), 2026-11-11. Branch `v2/run-loop`, main checkout (`workflow.use_worktrees` is false), so every test ran in the main checkout. Fix scope: the 7 rows of the disposition table whose batch is F1. 6 rows are fixed with a commit. a-IN-a2 needed no change, because the existing test already fails on a changed sonner CSS (evidence below). Each behaviour change has a test that was run red before the fix and green after it. No assertion was weakened or deleted, and no existing test encoded the old behaviour (see "Changed expectations").

New test files:
- `tests/unit/proxy-matcher.test.ts`: the matcher, checked with Next's own `unstable_doesMiddlewareMatch` from `next/experimental/testing/server` (present in next 16.4.6).
- `tests/unit/proxy-security-headers.test.ts`: every proxy exit takes its headers from `securityHeadersFor()`.

Extended test files: `tests/e2e/csp.spec.ts` (K126 step, d-WR-d3 header check), `tests/unit/proxy.test.ts` (d-WR-d3), `tests/unit/build-egress-guards.test.ts` (a-WR-a2).

### Rows

| Row | Commit | Failing-first evidence (red run, cause) | Fix |
|---|---|---|---|
| a-CR-a1 (K126) | d073ce6 | New E2E step "K126: after a router.refresh() ..." in `csp.spec.ts`, run against HEAD: failed with 4 `style-src-elem` violations (`blockedURI: inline`, two from each of two vendor chunks). Its preconditions passed: the internal-note POST returned 200, and the `RSC: 1` refresh response of the ticket page carried a different CSP nonce from the document. Same run: 219 passed, 1 failed (this step), 1 skipped. | `ThemeProvider` keeps the nonce of its first client render in module state, calls `setNonce` once with it, and passes that value to next-themes. It ignores later props. The server render passes the request nonce through and never touches module state. The E2E step sends an internal note (the composer's own `router.refresh()`), opens the modal status menu (Radix scroll lock), switches the theme twice and asserts zero violations. |
| a-WR-a1 | 8438afe | `proxy-matcher.test.ts` against the old matcher: 2 of 5 failed. `/_next/staticX` (and the other prefix-only paths) skipped the proxy, and so did `/favicon.ico`. | Matcher `/((?!_next/static/\|_next/image$).*)`. Only `/_next/static/...` and exactly `/_next/image` skip the proxy. There is no favicon file in the app (`public/` holds only `.gitkeep`; `src/app` has no favicon or icon file; the only favicon in the repo is `website/public/favicon.svg`, which belongs to the website). So `favicon.ico` is no longer excluded, and no icon asset was added. The false comment ("None of them returns HTML") is rewritten. The test also covers `/favicon.ico/x`, `/favicon.icoX`, `/_next/image-foo`, `/_next/image/x`, real `/_next/static/` assets and the image endpoint with a query. |
| a-WR-a2 | 5671bc6 | New case in `build-egress-guards.test.ts`, run with the HEAD workflow files: failed, `ci.yml: expected [] to deeply equal [ 'contents: read' ]`. | Top-level `permissions: contents: read` in `ci.yml` and `integration.yml`. Every step was checked: checkout only reads, `pnpm/action-setup` and `setup-node` (its cache uses the runner's cache token) need no token scope, and the rest are local `pnpm` and `cp` commands. The test checks all three workflows (audit.yml already had the block) and that no job overrides it. `runs-on: ubuntu-latest` is unchanged and no `schedule:` was added (rule I); the existing rule I cases stay green. |
| d-WR-d3 | 64e5cd8 | Mutations of `src/proxy.ts`, each restored from a saved copy, with `git diff --quiet` checked afterwards. (1) `isDev: process.env.NODE_ENV !== "production"`: 2 of 27 failed (the `test` mode equality and the no-`'unsafe-eval'` case). (2) `script-src *` added: 4 failed. (3) A hand-built loose policy (`script-src * 'nonce-X' 'strict-dynamic'; style-src-elem * 'unsafe-inline'`): 4 failed, while the 23 older proxy tests passed, which is the gap the finding names. | `proxy.test.ts` compares the response CSP and the forwarded request CSP with `buildCsp(nonce, { isDev })` for the forwarded nonce under `NODE_ENV` production, test and development, on three forwarding branches. It also checks that no non-development mode emits `'unsafe-eval'`, a `script-src` or `style-src-elem` `'unsafe-inline'`, or a `*`. `csp.spec.ts` checks the last two on every enforced header. Test-only change; the proxy was already correct. |
| a-IN-a1 | 3269189 | Comments only, no test. | Both Dockerfile comments name `dist/worker.mjs`. No other tracked file outside `.planning/` names `dist/worker.cjs`. |
| a-IN-a2 | none | Checked, no change needed. The test imports the installed `sonner` under a fake `document`, captures the injected CSS text and compares its sha256 with `SONNER_STYLE_HASH`. Proof without touching `node_modules` or the lockfile: a scratch vitest config aliased `sonner` to a copy of the installed `dist/index.mjs`. With an unmodified copy: 3 of 3 passed. With one space added after the first selector of the injected CSS: 1 of 3 failed, `expected 'sha256-7NXf…' to be 'sha256-CIxD…'`. | None. `package.json` keeps `"sonner": "^2.0.7"`; pinning it would need `pnpm add`, which re-breaks the better-auth peer snapshot (`deferred-items.md`, from 08-04), and the guard already fails loudly on any CSS change. |
| a-IN-a4 | 43e5dfb | `proxy-security-headers.test.ts` wraps `securityHeadersFor()` with a sentinel header (`vi.mock`). Against HEAD: 1 of 2 failed, `malformed: expected null to be '1'`. The forward, blocked sign-up, 401 and redirect exits already carried it. | `malformedPathResponse(pathname)` builds the 400 with only `Content-Type` and the static deny-all CSP, runs it through `withSecurityHeaders()`, then forces `Referrer-Policy: no-referrer` (an undecodable path cannot be classified and may be a status path with a token). The existing K125 cases in `proxy.test.ts` (P to T) stay green unchanged. |

### Changed expectations in existing tests

None. No existing assertion was changed, weakened or removed. The new cases are additions:
- `csp.spec.ts`: one new test (K126), and `expectEnforcedCsp` and `expectCspHeader` gained the d-WR-d3 check.
- `proxy.test.ts`: one new describe (d-WR-d3, 4 cases).
- `build-egress-guards.test.ts`: one new case (a-WR-a2).

### Not done, with reason

- a-IN-a2: no pin (see the row). The disposition allowed a pin only if the test did not already fail on a changed CSS, and only without re-breaking the better-auth snapshot.
- The K126 E2E step runs under `next dev` only in this batch. `pnpm build` and the production-mode run were not part of this batch's verification.

### Verification (one process at a time, main checkout)

Every E2E run used the run id from the dispatch and the Colima `DOCKER_HOST`.

- Red E2E run, `pnpm test:e2e -- tests/e2e/csp.spec.ts`, before the K126 fix: exit 1. 219 passed, 1 failed (the new K126 step), 1 skipped. The `--` makes pnpm pass the path through in a way Playwright ignores, so this command ran the whole suite. The later targeted runs used `pnpm test:e2e tests/e2e/csp.spec.ts`.
- `pnpm test:e2e tests/e2e/csp.spec.ts` after the K126 fix: exit 0, 11 passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0. 602 files checked, no fixes. It prints 1 warning (`noTemplateCurlyInString`), which is in `tests/unit/container-config.test.ts`; this batch does not touch that file.
- `pnpm test`: exit 0. 73 files, 1168 tests passed.
- `pnpm test:e2e tests/e2e/csp.spec.ts` after all F1 commits: exit 0, 11 passed.
- `pnpm test:e2e` (full suite) after all F1 commits: exit 0. 220 passed, 1 skipped (`uat-gaps.spec.ts` zero-ticket inbox state, the same skip as in the red run), 0 failed.
- Per-row red and green runs of single unit files are listed in the rows above.
- Not run (outside this batch's dispatch): `pnpm test:integration`, `pnpm test:egress`, `pnpm build`, image builds and compose.

`.next` moves: E2E global setup hung on `/setup` twice: on the first run, before any `src/` change, and on the first run after the K126 fix. Each time `.next` was moved to the Trash (`aida-next-1794410194` and `aida-next-1794410651`) and the run was repeated. The dispatch asked for one move; the second follows the owner rule in PIAGAM "Test dan bukti". The later runs needed no move.

## F2

Fixer: Claude (gsd-code-fixer), 2026-11-11. Branch `v2/run-loop`, main checkout (`workflow.use_worktrees` is false), so every test ran in the main checkout. Fix scope: the 7 rows of batch F2 (c-CR-01, c-WR-01, c-WR-02, c-WR-03, d-WR-d2, c-IN-01, c-IN-02). All 7 are fixed, each with its own commit. Every behaviour change has a test that was run red before the fix and green after it. Every real-client test connects to `127.0.0.1` only. No real LLM API, mail server or credential was used.

K127, as implemented:
- **`authentication_failed`:** HTTP 401 or 403 on the probe call, an SMTP reply of 530, 534 or 535, or an imapflow authentication failure.
- **`connection_failed`:** every other HTTP status on the probe call, every other SMTP reply, `EPROTOCOL`, `SyntaxError` (a body that is not JSON), undici's parser, socket, body and timeout errors (`HPE_*`, `UND_ERR_*`), the imapflow connection, parser and response codes, and the bare nodemailer `Connection closed`. Also every timeout, refusal, DNS and TLS failure, as before.
- **`unknown`:** errors that carry none of these signals.

New files:
- `src/lib/channels/email/test-connection.ts`: the IMAP and SMTP probes, moved out of the actions. The tests drive these exact probes against fake servers, with a short timeout passed through the same option the actions use.
- `src/lib/connection-test/deadline-fetch.ts`: a fetch with an `AbortSignal.timeout` deadline for both Ollama probes.
- `tests/unit/connection-test-probes.test.ts`: the real imapflow, nodemailer and ollama clients against local fake TCP and HTTP servers.
- `tests/support/console-capture.ts`: one log-capture helper, shared by the unit and integration log-leak checks.

### Rows

| Row | Commit | Failing-first evidence (red run, cause) | Fix |
|---|---|---|---|
| c-CR-01 (K127) | db531dd | Red run of 3 files (`connection-test-probes`, `connection-test-errors`, `settings-connection-actions`): exit 1, 7 failed, 32 passed. Each fake server gave `unknown`: silent port (imapflow `ETIMEOUT`), SSH banner then close (`ClosedAfterConnectText`), HTTP banner on an open connection (`GREETING_TIMEOUT`). The "one category" case got `[connection_failed, unknown]`. The classifier case failed at `CONNECT_TIMEOUT`, and the action case with `GREETING_TIMEOUT` gave `unknown`. `options.connectionTimeout` was `undefined`, so imapflow used its 90 s default. The closed port and the LOGIN rejection were already right. | The imapflow 1.7.8 codes found in `node_modules/imapflow/lib` go into `CONNECTION_CODES`: `CONNECT_TIMEOUT`, `GREETING_TIMEOUT`, `UPGRADE_TIMEOUT`, `ETIMEOUT`, `NoConnection`, `EConnectionClosed`, `ClosedAfterConnectText`/`TLS`, `STARTTLS_INJECTION`, `InvalidResponse`, `UnexpectedTag`, `ResponseProcessingFailed`, `LineTooLarge`, `ResponseTooLarge`, `LiteralTooLarge`, `MAX_IMAP_NESTING_REACHED`, `ETHROTTLE` and `COMPRESS_TRAILING_DATA`, plus the prefix `ParserError`. `createImapClient` passes `opts.timeoutMs` to `connectionTimeout`. The worker keeps imapflow's 90 s default because it passes no options. The action passes `EMAIL_PROBE_TIMEOUT_MS` (10 000). Green: 39 passed. |
| d-WR-d2 | 08bb114 | Scratch mutation: the embedding action logged `err: e`, so the raw 401 text with `sk-live-...` reached the log. With the old helper: exit 0, 15 of 15 passed (the gap). With the new helper and the same mutation: exit 1, 1 failed, 22 passed (`expected '{ probe: 'embedding', …' not to contain 'sk-live'`). The new negative controls, run against a copy of the helper that used `JSON.stringify`: 6 failed, 17 passed. Integration scratch mutation: the csat route did `console.warn` of `{ err: new Error(token) }`. `public-route-limits.test.ts` with the new helper: exit 1, 1 failed, 4 passed. Every mutation was restored with `git checkout --` and checked with `git diff --quiet`. | `tests/support/console-capture.ts` spies on `log`, `info`, `warn`, `error` and `debug`. It serializes with `util.inspect` (depth 8, `showHidden`), so an Error's message, stack and cause are all searched. Both tests use it. Negative controls check that the helper rejects a nested Error, a secret that appears only in a `cause`, each console method and a deeply nested value, and that it accepts a clean line. Green: 23 passed; integration: 5 passed. |
| c-WR-01 (K127) | 324ff7a | Red run of the same 3 files: exit 1, 23 failed, 58 passed. Real nodemailer gave `unknown` for an SSH banner, an HTTP banner (`EPROTOCOL`), a server that closes at once (bare `Connection closed`, no code) and AUTH answered with 454 (`EAUTH` with reply 454, which gave `authentication_failed`). The real ollama client, on both the LLM and the embedding probe, gave `unknown` for a text 404, a JSON 404, a 500, an HTML 200 (`SyntaxError`) and an SSH banner (`HPE_INVALID_CONSTANT`). Each probe's "one category" case failed. The classifier, message-map and EPROTOCOL action cases also failed. | `isConnection` treats any HTTP status from 100 to 599 (`status`, `statusCode` or ollama's `status_code`) and any SMTP reply from 200 to 599 as `connection_failed`. 401 and 403, and 530, 534 and 535, are caught first by `isAuth`. Also added: `EPROTOCOL`, the undici codes for body timeout, closed, headers overflow, content-length mismatch, max size, info and proxy TLS, the prefix `HPE_`, and the names `SyntaxError`, `HTTPParserError`, `SocketError`, `ConnectTimeoutError`, `HeadersTimeoutError` and `BodyTimeoutError`. `probeSmtpConnection` turns nodemailer's code-less `Connection closed` into a coded `ECONNECTION` error, with the original as its cause. New `connection_failed` text: "AIDA could not reach the server, or the server did not answer as expected (for example a different service on that port, or a model that does not exist there). Check the address, the port and the model name, and that the right server is running and reachable from AIDA." Green: 81 passed. |
| c-WR-03 | 38f35f9 | `connection-test-probes.test.ts -t deadline`: exit 1, 6 failed, 37 skipped. Each case hit vitest's 5000 ms test timeout, on both Ollama probes, against three servers: a silent TCP port, an HTTP server that never answers, and an HTTP server that sends headers and never finishes the body. | `fetchWithDeadline(timeoutMs)` combines `AbortSignal.timeout` with the client's own signal through `AbortSignal.any`. The deadline covers headers and body. Both Ollama clients get it through `new Ollama({ fetch })`. `testProviderConnection` and `testEmbeddingConnection` take `opts.timeoutMs`, default 10 000 (`PROBE_TIMEOUT_MS`, `EMBEDDING_PROBE_TIMEOUT_MS`, pinned by a test). OpenAI and Anthropic use the same budget through their SDK `timeout`. The timeout rejects with `TimeoutError`, which is `connection_failed`. Green: each case finishes in under 3 s; 44 passed. |
| c-WR-02 (K127) | 1c226e6 | Red run of `connection-test-errors` and `settings-connection-actions`: exit 1, 8 failed, 44 passed. 4 failed with `connectionErrorLogShape is not a function`. The other 4, exact log-line checks for each of the four probes, failed because the line had no `error` field. | `connectionErrorLogShape(e)` returns `{ name, code, status }`. `name` comes from the thrown value. `code` and `status` are the first found on the cause chain. Each value comes only from a fixed set (`LOG_NAMES`, `LOG_CODES`, `LOG_STATUSES`). Anything else is logged as `"other"`, and a missing value as `"none"`. All four actions log `{ probe, category, correlationId, error }`. A hostile `cause` getter now ends the cause-chain walk instead of throwing. Tests check: hostile names, codes, statuses, headers and causes leave no fragment in the shape; a Proxy whose every get throws, and a cyclic cause, are handled; and each probe's exact log line. The `unknown` text keeps pointing at the log. Green: 96 passed (3 files). |
| c-IN-01 | d8a0834 | Docs and comment only, no test. | New section "Settings connection tests" in `docs/SECURITY.md`. The `errors.ts` header now says the same and nothing more. The categories remove the error-text oracle and put every network and protocol failure into `connection_failed`. Three residuals remain: `authentication_failed` still proves that a service of that protocol answered at the address; timing still differs; and the probe still connects to the address the admin typed, so SSRF is not removed. |
| c-IN-02 | 6bd6614 | Comment only, no test. | The embedding button docstring and the header of `embed-test-connection.ts` now say: a not-pulled model fails at Test time with category `connection_failed`, whose fixed text names a missing model as one cause. |

### Changed expectations in existing tests

These existing assertions encoded the old categories or the old log policy, and were updated to K127:
- `tests/unit/connection-test-errors.test.ts`:
  - `withProps("x", { status: 500 })` was `unknown` and is now `connection_failed`. Two new cases stay `unknown`: `{ status: 99 }` (out of range) and `{ status: "500" }` (a string).
  - The message-map case pins the new `connection_failed` text.
- `tests/e2e/phase5-rag.spec.ts`: the stub's 404 "model not found" on the embedding Test expected the `unknown` text. It now expects the `connection_failed` text.
- `tests/unit/settings-connection-actions.test.ts`:
  - The LLM ECONNREFUSED case asserted that the string `ECONNREFUSED` never reaches the log, which was the old "category and ID only" policy. K127 logs the allowlisted code, so the case now excludes the raw message (`connect ECONNREFUSED`), the host and the port (`11434`, newly checked).
  - `expectLogExcludes` is stricter: it covers all console methods and serializes deeply.
- `tests/integration/public-route-limits.test.ts`: the token-leak check uses the shared deep serializer and also watches `console.debug`. This is stricter.

No other assertion was weakened or removed. The SMTP 535, HTTP 401 and imapflow `authenticationFailed` cases stay `authentication_failed`. Bare `EAUTH` (no server reply) also stays `authentication_failed`; see the first item below.

### Deviations and notes

- **Bare `EAUTH`.** nodemailer sets `EAUTH` for its own credential check (`Missing credentials`, an unknown method) with no server reply. That case stays `authentication_failed`, as the existing test pins. K127's "only 530, 534, 535" is applied to server replies: `EAUTH` with any other reply (for example 454) is now `connection_failed`. A bare `EAUTH` cannot come from a service of another protocol, so it adds no oracle beyond the stated residual.
- **SMTP close.** The fix for the code-less nodemailer error matches the library's exact message, and only when no code is set.
- **IMAP budget is per phase.** The 10 s budget applies to each phase (TCP or TLS connect, greeting, socket inactivity), not to the whole probe. SMTP works the same way through nodemailer's three timeouts.
- **Observation, not fixed (outside F2).** An HTTP service that answers the Ollama probe call with status 200 and any valid JSON still gives `ok: true`, because the probes do not check the response shape.
- **imapflow "Login is disabled" and "No matching authentication method".** These carry `authenticationFailed` and stay `authentication_failed`. They are answers from an IMAP server, so they fall within the stated residual.
- **AIDA-31.** c-CR-01 asks for the AIDA-31 gate row to be re-derived. That row belongs to the orchestrator and was not touched.

### Verification (one process at a time, main checkout)

Every Docker-backed run used the run id from the dispatch and the Colima `DOCKER_HOST`.

- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0. 606 files checked, no fixes. It prints 1 warning (`noTemplateCurlyInString`) in `tests/unit/container-config.test.ts`. The warning was already there before F2, and this batch does not touch that file.
- `pnpm test`: exit 0. 74 files, 1235 tests passed.
- `pnpm test:integration tests/integration/public-route-limits.test.ts`:
  - red run with the scratch route mutation: exit 1, 1 failed, 4 passed;
  - after restoring the route: exit 0, 5 passed.
- `pnpm test:e2e tests/e2e/phase5-rag.spec.ts`:
  - first run: exit 1, because global setup hung on `/setup` before any test ran;
  - `.next` was moved to the Trash (`aida-next-1794412555`) and the run repeated: exit 0, 6 passed.
- `pnpm test:e2e tests/e2e/phase4-ai.spec.ts` (renders the LLM button's `connection_failed` text): exit 0, 11 passed.
- Per-row red and green runs of single unit files are listed in the rows above.
- Not run (outside this batch's dispatch): the full `pnpm test:integration`, `pnpm test:egress`, the full `pnpm test:e2e`, `pnpm build`, image builds and compose. The other integration file that calls `testProviderConnection` (`egress-fixtures/probe.ts`, part of `pnpm test:egress`) was typechecked but not run.

`.next` moves: one, `aida-next-1794412555` (see above).
