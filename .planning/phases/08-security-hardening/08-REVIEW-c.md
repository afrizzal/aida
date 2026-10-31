---
phase: 08-security-hardening
part: c (connection-test error categories and settings UI, image-check and gate scripts, operator docs)
reviewed: 2026-11-11T00:00:00Z
depth: standard
diff_range: a6a8499..HEAD
files_reviewed: 11
files_reviewed_list:
  - src/lib/connection-test/errors.ts
  - src/app/(app)/settings/actions.ts
  - src/app/(app)/settings/email/actions.ts
  - src/app/(app)/settings/email/test-connection-button.tsx
  - src/app/(app)/settings/embedding-test-connection-button.tsx
  - src/app/(app)/settings/llm-test-connection-button.tsx
  - scripts/test-image-check.ts
  - scripts/part-a-gate-check.ts
  - docs/OPERATIONS.md
  - website/src/content/docs/configuration/environment.md
  - website/src/content/docs/operations/upgrading-and-logs.md
coverage_note: "errors.ts, both action files, the three buttons, test-image-check.ts and part-a-gate-check.ts were read in full. The docs were read as diff hunks. Each operator claim was checked against Caddyfile, docker-compose.yml, Dockerfile, .env.example, src/lib/rate-limit/client-ip.ts, memory-throttle.ts, src/lib/health/health-check.ts, both health routes, src/proxy.ts and src/lib/auth.ts. The classifier was checked against the error codes that the installed probe libraries actually set (imapflow 1.7.8, nodemailer 9.1.1, read from node_modules), and against the probes in src/lib/llm/test-connection.ts and src/lib/rag/embed-test-connection.ts. The J1 helpers that test-image-check.ts calls (planExact, applyCleanup, teardownRefs in scripts/test-docker-cleanup.ts) were read for the image path only. runBuildPreflight, acquireLock and tagState were not re-reviewed: J1 closed them. No tests, builds, Docker or network commands were run. Part B (Phase 8.1) work is not reported as missing."
findings:
  critical: 2
  warning: 11
  info: 7
  total: 20
status: issues_found
---

# Phase 8: Code Review Report (part c: connection-test errors, image and gate scripts, operator docs)

**Reviewed:** 2026-11-11
**Depth:** standard (see coverage note)
**Files Reviewed:** 11
**Status:** issues_found

## Summary

**Connection-test errors (08-06).** The structure is sound:
- All four actions still call `requireOrgAdmin()` before `getScopedDb()`.
- The response is `{ ok, error: category, correlationId }`.
- The log line holds only the probe, the category and the ID.
- No raw message, host, IP or stack reaches the client or the log from the `catch`.
- The buttons render only `CONNECTION_TEST_ERROR_MESSAGES[...]` and the ID. They use tokens only (`text-success`, `text-destructive`) and explicit `text-[12px]`, so they follow DESIGN-SYSTEM.

The classifier does not collapse the oracle for IMAP, though. imapflow reports its timeouts and early closes as `CONNECT_TIMEOUT`, `GREETING_TIMEOUT`, `ClosedAfterConnectText` and `NoConnection`, and none of these is in `CONNECTION_CODES`. A closed port therefore gives `connection_failed`, while an open port running another service gives `unknown`. That is a working port scanner, and it contradicts D-25 ("Timeout, DNS, refusal and TLS all map to `connection_failed`"). AIDA-31 was closed on unit tests that never use these codes (CR-01). A smaller residual of the same kind remains on SMTP and on the Ollama HTTP probe (WR-01).

**Image check (08-09).** Every Docker call I traced is rule-J clean:
- Lock first, then the tag check, then J1's preflight, then the build.
- Teardown runs only with the lock held and after the build started.
- Only the recorded tag is removed, by `repo:tag`, and only while it still points to the image ID recorded after the build.
- There is no prune, no `rmi` by ID, and no container of its own.
- `.env` is excluded from the build context by `.dockerignore`.

I found no path that deletes or overwrites a resource the script did not create, apart from the documented K115 race. The weak points are elsewhere:
- A run can report `passed` after it pulled or moved the shared base image (WR-04).
- Real build failures can be relabelled `blocked (external)` (WR-05).
- Interrupt paths leave the lock and the image behind (WR-06).

**Gate verifier (08-24).** `blocked` rows are never counted as passed: `worstOf` ranks every non-`passed` word below `passed`, and `closed` needs `passed`. Missing `.exit` files are reported. However:
- The image rows ignore the recorded exit code entirely and do not tie the verify log to the image log or the gate run id. So an evidence directory that contradicts itself still yields `ok` (CR-02).
- The table parser silently drops rows that do not start with `| `, and it reads only the first section with each heading (WR-07).
- Cited log files are not required to exist (WR-08).

**Docs.** I checked these claims against the code, and they match:
- `TRUSTED_PROXY_HOPS` (pattern, 0 to 10, no leading zero, the exact error line, the shared bucket, rightmost selection, left entries never parsed).
- The Caddy `header_up` line and the `@healthprobe` 404.
- The `x-aida-client-ip` overwrite and Better Auth's `ipAddressHeaders`.
- Next.js filling `x-forwarded-for` from the socket (Next 16.4.6 `base-server.js:604`).
- The 3-second cache, 60 and 120 per minute, and the integer `Retry-After`.
- Non-root `node` users in `builder` and `runner`, and `/data/uploads` owned by `node`.

Two claims are wrong. "No amount of public traffic can make the container unhealthy" is an overclaim (WR-10). And the website upgrade page omits the one-time ownership step that existing installs now need (WR-11).

## Critical Issues

### CR-01: imapflow timeouts and early closes classify as `unknown`, so the IMAP test is still a port-scan oracle (D-25, AIDA-31)

**File:** `src/lib/connection-test/errors.ts:61-84` (with `src/app/(app)/settings/email/actions.ts:106-132` and `src/lib/channels/email/imap-client.ts:20-29`)
**Issue:** `CONNECTION_CODES` lists Node, undici and nodemailer codes only. imapflow 1.7.8 sets its own codes (`node_modules/.pnpm/imapflow@1.7.8/.../lib/imap-flow.js`):
- `GREETING_TIMEOUT`, at line 2441;
- `CONNECT_TIMEOUT`, through `ConnectionDeadline`, at line 2404;
- `ETIMEOUT`, at line 1450 (not `ETIMEDOUT`);
- `UPGRADE_TIMEOUT`, at line 1840;
- `ClosedAfterConnectText` and `ClosedAfterConnectTLS`, at line 2606;
- `NoConnection`, at line 2551.

None of these codes is listed, and none of these errors has a listed name, so they all fall to `unknown`.

Failure scenario: an org admin sets the IMAP host to `10.0.0.5` and tries ports in turn.
- **Closed port:** `ECONNREFUSED` is returned at once, which classifies as `connection_failed`.
- **Open port running a service that waits for the client to speak** (Postgres 5432, Redis, HTTP, or an IMAPS port probed with `imapSecure: false`): `GREETING_TIMEOUT` after 10 s, which classifies as `unknown`.
- **Open port that closes the connection:** `ClosedAfterConnectText`, which classifies as `unknown`.
- **Filtered port:** `CONNECT_TIMEOUT` after imapflow's default `connectionTimeout` of 90 s, because `createImapClient` sets `greetingTimeout` and `socketTimeout` but not `connectionTimeout`. This also classifies as `unknown`.

The category alone, before timing is even considered, separates open from closed. That is the network-mapping oracle D-25 exists to remove, and the timeout case contradicts D-25's literal text. The unit tests miss it for two reasons: `tests/unit/connection-test-errors.test.ts` never uses an imapflow code, and `tests/unit/settings-connection-actions.test.ts:21` mocks `createImapClient`. 08-GATE-A row 26 therefore closed AIDA-31 on evidence that does not cover the IMAP probe.

Two side effects of the missing `connectionTimeout`:
- The comment at `email/actions.ts:99` ("fails fast within a 10s timeout") is false for the connect phase.
- The server action can hang for 90 s.

**Fix:**
```ts
// errors.ts
const CONNECTION_CODES = new Set([
  // ...existing...
  // imapflow 1.x (lib/imap-flow.js): timeouts, early close, lost connection
  "CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT", "ETIMEOUT",
  "NoConnection", "ClosedAfterConnectText", "ClosedAfterConnectTLS",
]);
```
```ts
// imap-client.ts
connectionTimeout: opts?.timeoutMs ?? 90_000,
greetingTimeout: opts?.timeoutMs ?? 10000,
```
Add one classifier test per imapflow code. Add one action-level test that throws a real imapflow-shaped error (`Object.assign(new Error("..."), { code: "GREETING_TIMEOUT" })`) and expects `connection_failed`. Then reopen the AIDA-31 row until the gate is re-derived.

### CR-02: The gate verifier ignores the image check's exit code and never ties the verify log to the image log or the run id

**File:** `scripts/part-a-gate-check.ts:822-847` (`imageRow`)
**Issue:** `exit = ev.exit("image-<target>", true)` is read only to print the Exit code cell. The Result word comes entirely from `image-<target>-verify.log`: one `IMAGE-CHECK-VERIFY state=` line, `vexit === 0`, and a space line if the word is `blocked (space)`. Three cross-checks are missing:
- The recorded exit is never compared with `EXIT_CODES[state]`.
- The verify line's `tag` (which embeds the run id) is never compared with `run-id.txt`.
- `image-<target>.log`'s own `IMAGE-CHECK-RESULT` line is never compared with the verify line.

`test-image-check.ts --verify` takes the exit code as a free argument (`--verify <log> <exit> <target>`) and does not echo it, so the gate cannot tell which exit the verify step was given.

Failure scenario, for the rerun once space is added:
1. The real check prints a `passed` result line and then crashes in teardown or in a late listener (see IN-03), so `image-runner.exit` is `1`.
2. The orchestrator runs verify against that log with `0` typed by hand, or against the log of an earlier run.
3. The gate derives `| image check runner | 1 | passed |`.
4. `check` prints `PART-A-GATE-CHECK ok`.
5. Row 7 (AIDA-27 build path) closes.

The R3-4 mutation tests (`tests/unit/part-a-gate-check.test.ts:274-290`, `:570`) vary only `imageVerifyExit`, `imageVerify` and `imageLog`, never `image-<target>.exit`. This is exactly the class of contradiction the verifier must refuse ("wrong exit codes").

**Fix:** In `imageRow`, after `word` is derived:
```ts
const stateOf: Record<string, number> = { passed: 0, failed: 1, "blocked (space)": 3,
  "blocked (with evidence)": 3, "blocked (docker unhealthy)": 3 };
const expected = word.startsWith("not run (") ? 4 : stateOf[word];
if (expected === undefined || exit !== expected) { word = "failed"; note += `; exit ${exitText(exit)} disagrees with ${word}`; }
const res = lines(clog).filter((l) => l.startsWith("IMAGE-CHECK-RESULT "));
// require exactly one, JSON-parse it, and require res.runId === runId, res.tag === the verify tag,
// and summaryWord(res.state, res.cause) === word; otherwise "failed"
```
Also have `--verify` print `exit=<n>` on its line, and have the gate compare that value with `image-<target>.exit`. Add mutation tests: an `.exit` file that disagrees, a run id that disagrees, and a RESULT line that disagrees.

## Warnings

### WR-01: Protocol-mismatch and HTTP outcomes still separate "something answered" from "nothing answered"

**File:** `src/lib/connection-test/errors.ts:1-9`, `:176-182`
**Issue:** Even after CR-01, the four categories still leak liveness on the other probes:
- **SMTP:** an open port that sends a non-SMTP banner (SSH `SSH-2.0-...`, HTTP `HTTP/1.1 400`) fails with nodemailer `EPROTOCOL` (`smtp-connection/index.js:1438`, "Invalid greeting"), which classifies as `unknown`. A closed port gives `ECONNECTION`/`ESOCKET`, which classifies as `connection_failed`.
- **Ollama (LLM and embedding):** a host running any HTTP server answers `/api/tags` or `/api/embed` with a 404 (`ResponseError`, `status_code` 404) or with non-JSON (`SyntaxError`). Both classify as `unknown`. A 401 or 403 classifies as `authentication_failed`. A closed port classifies as `connection_failed`.

The module header says it "only removes the error-text oracle", and D-25 says the response "cannot map the network". Both claims overstate what the code does, because the category itself maps the network. Collapsing everything into one category is a product decision (it would cost the not-pulled-model UX). At minimum, the residual must be stated where it lives.
**Fix:** Either map protocol-level mismatches (`EPROTOCOL`, `SyntaxError` and non-auth HTTP statuses on the probe call) to `connection_failed`, with a test each, or reword the header to name this residual explicitly. For example: "`unknown` and `authentication_failed` still reveal that some service answered on the host and port; only `connection_failed` is collapsed across DNS, refusal, timeout and TLS." Carry the same sentence into `docs/SECURITY.md` when Part B reconciles it.

### WR-02: The `unknown` text sends the admin to a log line that holds nothing more than the UI already shows

**File:** `src/lib/connection-test/errors.ts:47-48`; `src/app/(app)/settings/actions.ts:98-104`, `:166-175`; `src/app/(app)/settings/email/actions.ts:126-131`, `:158-163`
**Issue:** The `unknown` message says "Check the server log for the reference below". The only log line for that reference is `{ probe, category, correlationId }`. An operator who finds it learns nothing beyond "unknown". After CR-01 and WR-01, `unknown` is the most common real failure (for example a not-pulled Ollama model, or a 5xx from the provider). The correlation ID then leads nowhere, and the UI text promises a diagnosis path that does not exist (honest-claims). D-25 allows a redacted detail in the log.
**Fix:** Log an allowlisted, non-network shape under the ID. For example, the error `name` and `code` and an HTTP `status`, taken only from fixed sets, and never the message, host or URL:
```ts
const shape = { name: names(e)[0] ?? null, code: safeCode(e), status: safeStatus(e) };
console.error("[settings] connection test failed", { probe, category, correlationId, shape });
```
Otherwise change the `unknown` text so it does not point at the log.

### WR-03: The rewritten docstring claims a 10 s timeout that the Ollama path does not have

**File:** `src/app/(app)/settings/actions.ts:78-83` (and `llm-test-connection-button.tsx:26`)
**Issue:** The docstring rewritten in this diff says "10s timeout (enforced inside testProviderConnection)". `src/lib/llm/test-connection.ts:31` constructs `new Ollama({ host })` with no timeout or abort signal. The same applies to `src/lib/rag/embed-test-connection.ts:27`. A host that accepts the TCP connection and never answers keeps the server action open until undici's 300 s headers timeout. The button "must never spin indefinitely", but it does spin for 5 minutes. The admin can also use this as a timing signal. The Ollama path is the SSRF-relevant one.
**Fix:** Pass a fetch with a deadline:
```ts
new Ollama({ host, fetch: (u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(10_000) }) })
```
`TimeoutError` is already in `CONNECTION_NAMES`. Otherwise correct the docstring.

### WR-04: The image check reports `passed` even when the build pulled or moved the shared base image

**File:** `scripts/test-image-check.ts:390-392`, `:460-463`, `:584-594`
**Issue:** `baseImageBefore` and `baseImageAfter` are recorded "for K116" and then never compared. Neither `inspectFindings` nor `verifyImageCheckLog` looks at them. Two cases follow:
- **Base image absent.** `baseImageBefore` is `"absent"`. The build pulls `node:22-alpine` implicitly, creating an unlabelled resource that rule J did not allow and that teardown will not remove. The result is still `passed`.
- **Base image changed.** `baseImageAfter !== baseImageBefore` means the shared `node:22-alpine` tag, which this run did not create, now points elsewhere. Rule J forbids overwriting an existing tag. The result is still `passed`, and the gate's row 7 would close.
**Fix:** Before the build, stop when `baseImageBefore === "absent"`, with `not run (parked: base image missing)` and evidence. After the build, set `failed` with cause `base-image` when `baseImageAfter !== baseImageBefore`. Have `--verify` refuse a `passed` result whose before and after IDs differ or are null.

### WR-05: The build-failure classifier relabels genuine build failures as `blocked (external)`

**File:** `scripts/test-image-check.ts:143-164`
**Issue:** Any of the needles anywhere in the last 80 lines makes a failed build `blocked (external)`. `--verify` accepts that, and the gate shows `blocked (with evidence)` instead of `failed`. Two of the needles are generic:
- `"@prisma/engines"` appears in ordinary `pnpm install` output for the `deps` stage (`.../node_modules/@prisma/engines: Running postinstall script`).
- `"ENOTFOUND"` and `"ETIMEDOUT"` appear whenever application code attempts a network call during `next build`, for example `getaddrinfo ENOTFOUND placeholder` from the placeholder `DATABASE_URL`.

A code regression that breaks `pnpm build` or `prisma generate` close to that output is therefore reported as an external stall, not as a failure.
**Fix:** Classify on the failing step only. Take the lines after BuildKit's last `ERROR:`/`failed to solve:` marker (or the `#N ERROR` block). Match download-specific phrases there (`binaries.prisma.sh`, `failed to resolve source metadata`, `toomanyrequests`, `TLS handshake timeout`). Drop the bare `@prisma/engines`, `ENOTFOUND` and `ETIMEDOUT` needles, or require them on the same line as a fetch or download verb.

### WR-06: An interrupt skips teardown: the lock and the tag stay, and the build can finish after the run is gone

**File:** `scripts/test-image-check.ts:610-650`, `:687-697`
**Issue:** No `SIGINT`/`SIGTERM` handler is installed, so `finally` (lines 467-525) does not run on an interrupt. Effects:
- `${TMPDIR}/aida-test-docker.lock` stays. K111 says stale locks are not removed automatically, so every later suite is parked until someone notices.
- A tag that was already built stays, with only a `planned` ledger entry.
- When only the Node process receives `SIGTERM` (an orchestrator timeout rather than a terminal Ctrl-C), the spawned `docker build` child is not in the signal path. It keeps running and tags `aida-test-nonroot-<target>:<runId>` after the lock was abandoned.

Separately, the watchdog sends `SIGTERM` once and never escalates. A docker CLI that ignores it hangs the script indefinitely.
**Fix:** Register `process.once("SIGINT"|"SIGTERM", ...)` handlers that kill the child, wait for `close`, run the same teardown block, release the lock and exit with `4`. Escalate the watchdog to `SIGKILL` after a grace period. Spawn the child with `detached: false` and kill its process group explicitly.

### WR-07: The gate parser silently skips table rows and duplicate sections

**File:** `scripts/part-a-gate-check.ts:1239-1253`, `:1319-1348`
**Issue:**
- `tableRows` keeps only lines that start with `"| "` and then drops the first two. A row written as `|7|↳|...|passed|-|-|yes|` (no space after the pipe) renders as a table row in GitHub-flavoured Markdown, but `check` never sees it.
- `sectionLines` uses `indexOf(heading)`, so only the first `## Evidence matrix` (or `## Results`, and so on) is compared. A second section with the same heading, contradicting the first, renders in full and is ignored.
- Non-table lines inside a table block are dropped without notice.

The result is a gate file whose rendered rows contradict the evidence while `check` prints `ok`.
**Fix:** Treat every line matching `/^\s*\|/` inside a section as a table line, and fail on any line that is neither blank nor a table line between the header row and the end of the table. Fail when a checked heading occurs more than once, or occurs again anywhere below `## Notes`. Add mutation tests for each of these three cases.

### WR-08: Cited evidence logs are not required, so rows pass with dangling `log <path>` notes

**File:** `scripts/part-a-gate-check.ts:770-820`, `:962-973`
**Issue:**
- `hostRow` and `vitestRow` print `log <dir>/<slug>.log` but never `need()` the log. `pnpm lint` and `pnpm typecheck` derive `passed` from the `.exit` file alone.
- The ops evidence checks (`ops-volume`, `ops-client-ip`, `sla-flag-comment`) do the same. A missing log yields `lastLine("") === ""`, and the row is `passed` with note `""`.

A missing evidence file therefore cannot fail these rows. The orchestrator brief explicitly lists this as something the verifier must catch.
**Fix:** Call `ev.need(`${slug}.log`)` in `hostRow`, `vitestRow`, the e2e and egress branches, and the slug-based evidence rows. Treat an empty ops log as `failed` ("no output to evidence the check").

### WR-09: An audit log containing a network-looking word becomes `blocked`, even when advisories were returned

**File:** `scripts/part-a-gate-check.ts:800-818`, `:424-425`
**Issue:** `AUDIT_NETWORK` is tested before the `Severity:` line. Its words include `ETIMEDOUT`, `ECONNRESET`, `getaddrinfo` and `socket hang up`. A `pnpm audit` that did reach the registry and printed advisories, one of whose titles or paths contains one of those words (HTTP-client advisories often do), becomes `blocked (with evidence)` instead of `failed`. Row 1 then shows a blocked audit rather than a failing one.
**Fix:** When a `Severity:` summary line is present, the audit got a response: classify it `failed`. Apply the network rule only when no `Severity:` line exists, and only to lines starting with ` ERR_PNPM_` or `Error`.

### WR-10: "No amount of public traffic can make the container unhealthy" overstates the probe design

**File:** `docs/OPERATIONS.md:189`; `website/src/content/docs/operations/upgrading-and-logs.md:84-88`
**Issue:** The probe removes one failure mode: public traffic exhausting the health throttle. It does not make the container immune to load. A flood on the public routes can still do any of these:
- saturate the single Node event loop, so `wget` times out;
- exhaust the Prisma connection pool, so `queryHealth` fails, the probe returns 503 and the container is marked unhealthy.

The Caddyfile comment states the narrower and true claim ("no public request can reach or starve it"). Under the honest-claims rule, the docs should say the same.
**Fix:** Reword both places. For example: "public requests can never reach the probe or use up its quota, so the health throttle cannot make the container unhealthy. Heavy load that slows the app or the database still can."

### WR-11: The website upgrade page omits the one-time ownership step this release requires

**File:** `website/src/content/docs/operations/upgrading-and-logs.md:9-26`
**Issue:** The public upgrade page still says to back up, then `git pull`, `docker compose build`, `docker compose up -d`. Since 08-09, `app` and `worker` run as UID 1000. An existing install whose `uploads_data` volume was written as root will fail every new upload and every inbound email attachment after following these exact steps. `docs/OPERATIONS.md:105-152` documents the procedure, but the website page, which this diff edited, neither mentions it nor links to it.
**Fix:** Add a short callout under "Upgrading": "Upgrading from a release whose containers ran as root? Do the one-time uploads-volume ownership change first:", linking to `docs/OPERATIONS.md#upgrading-an-install-whose-containers-ran-as-root`, or mirror the steps.

## Info

### IN-01: `errors.ts` says `docs/SECURITY.md` states the residual; it does not yet

**File:** `src/lib/connection-test/errors.ts:7-9`
**Issue:** `docs/SECURITY.md` has no mention of the connection-test oracle, SSRF or D-25 (grep: none). The reconciliation is Part B (08-15), which is fine, but the comment states it in the present tense.
**Fix:** Write "docs/SECURITY.md will state the residual (plan 08-15, Phase 8.1)", or drop the clause.

### IN-02: The embedding button's docstring still promises a clear not-pulled-model error

**File:** `src/app/(app)/settings/embedding-test-connection-button.tsx:23-29`
**Issue:** "so a not-pulled Ollama embedding model surfaces a clear error (Pitfall 8)". After D-25 the 404 shows the generic `unknown` text (08-06 SUMMARY, manual item 2).
**Fix:** Change it to "...surfaces a failure at Test time (category `unknown`) instead of later during chunk embedding".

### IN-03: A spawn error makes `finish` run twice and throw `EBADF`

**File:** `scripts/test-image-check.ts:639-648`
**Issue:** On a spawn failure such as `ENOENT`, Node emits `error` and then `close` (`onErrorNT` calls `_handle.onexit`). `finish` therefore runs twice, and the second `fs.closeSync(out)` throws inside the `close` listener. That is an uncaught exception after the result line was printed, so the exit code no longer comes from `EXIT_CODES`. This is a concrete way to produce the exit/result disagreement that CR-02 fails to catch.
**Fix:** Guard with `let done = false; if (done) return; done = true;`.

### IN-04: A build that exits 0 without producing the tag is `blocked (docker)`, not `failed`

**File:** `scripts/test-image-check.ts:446-454`
**Issue:** If `outcome.code === 0` but `after.id === null`, the inspect at step (i) fails with "No such image". This is classified `blocked`/`docker` and accepted by `--verify`.
**Fix:** After a zero-exit build, treat `after.id === null` as `failed` with cause `build` ("build exited 0 but the tag is absent").

### IN-05: The e2e and vitest result rows do not require that any test ran

**File:** `scripts/part-a-gate-check.ts:783-787`, `:938`
**Issue:** `pnpm test:e2e` is `passed` with `expected=0` when every test is skipped and Playwright exits 0. `vitestRow` likewise does not require `sum("passed") > 0`. The named-file matrix rows partly compensate, but the Results rows can read `passed` on an empty run.
**Fix:** Add `n("expected") > 0` and `sum("passed") > 0` to the `ok` conditions.

### IN-06: `quote()` does not redact URL credentials or bearer tokens, and its output lands in a tracked file

**File:** `scripts/part-a-gate-check.ts:461-471`
**Issue:** The redaction covers `PASSWORD`, `SECRET`, `PEPPER` and `_KEY` assignments only. A quoted log line holding `postgresql://user:pass@host` or `Authorization: Bearer ...` is copied verbatim into `08-GATE-A.md` in a public repository. Test credentials are fake today, so this is defence in depth.
**Fix:** Also replace `//[^/\s:@]+:[^@\s]+@` with `//<redacted>@`, and `Bearer\s+\S+` and `(TOKEN|AUTH)\S*\s*[=:]\s*\S+` with `<redacted>`.

### IN-07: `check` cannot be re-run once TMPDIR is purged

**File:** `scripts/part-a-gate-check.ts:1281-1287`; `.planning/phases/08-security-hardening/08-GATE-A.md:6`
**Issue:** The gate names an evidence directory under the system temporary directory. macOS removes unaccessed entries there after a few days. From then on, `check` reports every evidence file missing, and nobody else can ever re-verify the committed gate. The mechanical-verification property lasts only as long as one machine's temporary directory.
**Fix:** Archive the evidence directory, minus large logs or with secrets redacted, to a non-tracked but durable location that the gate names. Alternatively, commit a content hash of each evidence file into the gate, so that a later `check` can at least detect a substituted directory.

---

_Reviewed: 2026-11-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
