---
phase: 08-security-hardening
part: d (tests)
reviewed: 2026-11-11T15:07:48Z
depth: standard
diff_range: a6a8499..HEAD
files_reviewed: 40
files_reviewed_list:
  - tests/e2e/csp.spec.ts
  - tests/e2e/global-setup.ts
  - tests/e2e/honesty-invariants.spec.ts
  - tests/e2e/kb-proposals.spec.ts
  - tests/e2e/phase4-ai.spec.ts
  - tests/e2e/phase5-rag.spec.ts
  - tests/e2e/support/process-tree.ts
  - tests/e2e/support/worker.ts
  - tests/integration/auth-bootstrap.test.ts
  - tests/integration/auth-ip-source.test.ts
  - tests/integration/auth-setup.test.ts
  - tests/integration/auth-upgrade.test.ts
  - tests/integration/fixtures/better-auth-pre-upgrade.ts
  - tests/integration/merge-reply-race.test.ts
  - tests/integration/public-route-limits.test.ts
  - tests/integration/public-state-label.test.ts
  - tests/integration/public-upload-caps.test.ts
  - tests/integration/rate-limit-atomic.test.ts
  - tests/integration/status-read-snapshot.test.ts
  - tests/integration/support/isolated-database.ts
  - tests/unit/add-tag-gate.test.ts
  - tests/unit/body-limit-lockstep.test.ts
  - tests/unit/build-egress-guards.test.ts
  - tests/unit/client-ip.test.ts
  - tests/unit/connection-test-errors.test.ts
  - tests/unit/container-config.test.ts
  - tests/unit/csp-style-hashes.test.ts
  - tests/unit/csp.test.ts
  - tests/unit/dependency-overrides.test.ts
  - tests/unit/e2e-process-tree.test.ts
  - tests/unit/health-probe-wiring.test.ts
  - tests/unit/health-probe.test.ts
  - tests/unit/health.test.ts
  - tests/unit/memory-throttle.test.ts
  - tests/unit/part-a-gate-check.test.ts
  - tests/unit/proxy.test.ts
  - tests/unit/read-bounded-form-data.test.ts
  - tests/unit/settings-connection-actions.test.ts
  - tests/unit/test-image-check.test.ts
  - tests/unit/test-suite-config.test.ts
coverage_note: "Static review only: no test, build, Docker or network command was run. The priority files (CSP, client IP and rate limits, upload caps, connection-test categories, auth upgrade, Docker and process-tree support) were read in full together with the product code they target (src/proxy.ts, src/lib/security/csp.ts, src/lib/rate-limit/*, src/lib/http/read-bounded-form-data.ts, the intake and follow-up routes, src/lib/connection-test/errors.ts, the settings actions, src/lib/health/health-check.ts). part-a-gate-check.test.ts (712 lines), test-suite-config.test.ts, container-config.test.ts and build-egress-guards.test.ts were checked for structure and for weak-assertion patterns only, not case by case against scripts/part-a-gate-check.ts. Files outside the diff (merge-provenance.test.ts, merge-race-coverage.test.ts, e2e support/fixtures.ts, tests/support/docker-test-*.ts) were read only where they bear on shared state or rule J. Missing Part B (Phase 8.1) proofs are not reported."
findings:
  critical: 0
  warning: 8
  info: 6
  total: 14
status: issues_found
---

# Phase 8: Code Review Report (part d, tests)

**Reviewed:** 2026-11-11
**Depth:** standard (see coverage note)
**Files Reviewed:** 40
**Status:** issues_found

## Summary

No test was found that passes no matter what the product does across its whole claim. Several key tests do have a blind spot for exactly the regression they are named after:

- **Auth upgrade (WR-d1).** The `prisma migrate deploy` half of D-02 is a no-op. The pinned "pre-upgrade" migration list equals today's head, so no migration runs on the populated database. The starting schema is also not the v1 schema that D-02 names. The session, login and membership checks (b) to (d) are real.
- **Connection-test log leak (WR-d2).** The log assertion serializes arguments with `JSON.stringify`, which drops an Error's `message` and `stack`. Logging the raw error object would therefore pass the test.
- **CSP wiring (WR-d3).** Nothing pins the header the proxy emits to `buildCsp`. Any policy that contains `'strict-dynamic'` and a nonce passes the proxy unit test and the E2E header check.

**Rule J (Docker).** No changed test or support file creates, stops, removes or overwrites a Docker resource outside the labelled `aida-test-` path:
- `isolated-database.ts` only runs `CREATE DATABASE` / `DROP DATABASE` inside the per-run Testcontainers server.
- E2E `global-setup.ts` still uses `startLabeledPostgres` and stops only its own container.
- `test-image-check.test.ts` drives scripted fakes. Its removal path goes through J1's `planExact`, and it covers the moved-ID and foreign-run-label cases.

**Process-tree teardown (08-17).** It signals only the process group whose id equals the spawned child's pid. It can hit a process that is not its own only after that group has fully exited and the number has been reused (WR-d7). Separately, it no longer fails on a hung worker (WR-d6). The dev server's global teardown does not use the waiting helper at all (WR-d5).

**08-gap1.** The fix did not hide a limiter defect:
- `public-route-limits.test.ts` still drives fixed IPv4 identities to a real 429 with `Retry-After` on all four routes.
- The limiter runs before token lookup and body parsing.
- The files that now use a random `/64` per request are not limiter tests.

But the fix is incomplete. Two other files still send non-IP `X-Forwarded-For` values into the shared bucket. Today they stay apart only because each file picks its own default pepper (WR-d4).

## Warnings

### WR-d1: The auth-upgrade "migrate deploy on a populated copy" step applies zero migrations and does not start from the v1 schema

**File:** `tests/integration/fixtures/better-auth-pre-upgrade.ts:89-104`, `tests/integration/auth-upgrade.test.ts:51-64`, `:84-91`
**Issue:** `PRE_UPGRADE_MIGRATIONS` lists 14 folders, and `prisma/migrations` holds exactly those 14 at HEAD. Phase 8 added no migration. `createIsolatedDatabase({ migrations: PRE_UPGRADE_MIGRATIONS })` therefore already builds the head schema. `deployHeadMigrations(db.url)` after the inserts is a no-op, and test (a) can pass only by checking that untouched rows are still there.

D-02 (08-CONTEXT line 24) asks for "`prisma migrate deploy` from the v1 schema on a populated copy". v1.0.0 is Phases 1 to 7, which ends at `20260724171144_insight_aida`. The seven later migrations (inbox, ticket lifecycle, ticket states, the FK restrict, KB proposals and its fence, projects foundation) never run on populated auth rows in this test. The 08-03 summary still says the database is "then migrated to head with the real `prisma migrate deploy`" and that every migration was applied on top of the populated database. Both statements overstate what ran.

**Failure scenario:** a v2 migration rewrites the `member` or `session` tables, for example a projects-membership FK or a `NOT NULL` column without a default. That breaks a populated v1 install on upgrade, and this file stays green.
**Fix:**
- Make (a) prove that something ran: read `_prisma_migrations` before and after `deployHeadMigrations`, and assert that the difference is the expected non-empty list. If the list is empty, the test should fail, or it should be skipped with an explicit "no pending migration" reason rather than pass.
- Add a v1 case: deploy up to `20260724171144_insight_aida`, insert the same auth rows (the columns they use exist in v1), deploy head, then re-run (b) to (d) on that database.
- Correct the 08-03 summary and the Part A evidence row so they do not count (a) as migration proof.

### WR-d2: The connection-test log assertion cannot see a raw Error that is logged as an object

**File:** `tests/unit/settings-connection-actions.test.ts:49-57` (also `tests/integration/public-route-limits.test.ts:142-150`)
**Issue:** `expectLogExcludes` serializes every non-string argument with `JSON.stringify`. `JSON.stringify(new Error("401 Incorrect API key sk-live-ABCDEF at https://llm.corp.example"))` yields only the error's enumerable own properties, here `{"status":401}`. The `message`, `stack` and `cause` are dropped. Only `console.error` is spied.
**Failure scenario:** a later edit logs the error for debugging: `console.error("[settings] connection test failed", { probe: "embedding", category, correlationId, err: e })`, or uses `console.warn(e)`. The raw key, host and message then reach the server log, and all four D-25 cases stay green.

`public-route-limits.test.ts` handles a top-level `Error`. A token inside a nested Error (`{ err }`) is still serialized as `{}`.
**Fix:** serialize with a deep inspector, and spy every console method:
```ts
import { inspect } from "node:util";
const text = typeof arg === "string" ? arg : inspect(arg, { depth: 8, showHidden: true });
for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m)...
```
Add one negative control that logs `{ err }` on purpose and checks that the helper rejects it.

### WR-d3: No test pins the CSP the proxy emits; any nonce plus `'strict-dynamic'` policy passes

**File:** `tests/unit/proxy.test.ts:69-77`, `:100-112`, `:206-214`; `tests/e2e/csp.spec.ts:104-119`
**Issue:** `csp.test.ts` pins `buildCsp()` to the exact D-11 string. The proxy tests and the E2E header checks, however, only check `toContain("'strict-dynamic'")` and `toContain("'nonce-")`.
**Failure scenario:** a change in `src/proxy.ts` could do any of these:
- pass `isDev: process.env.NODE_ENV !== "production"`, which ships `'unsafe-eval'` to any non-production `NODE_ENV`;
- append a source;
- build its own looser string such as `script-src * 'nonce-X' 'strict-dynamic'; style-src-elem * 'unsafe-inline'`.

Every proxy case would still pass. The zero-violation E2E checks would pass as well, more easily in fact, because a looser policy blocks less.
**Fix:** in `proxy.test.ts`, compare the whole header:
```ts
const nonce = cspNonce(csp)!;
expect(csp).toBe(buildCsp(nonce, { isDev: false }));
```
Add `vi.stubEnv("NODE_ENV", "production")` and `"development"` cases. In `csp.spec.ts`, assert at least that `script-src` and `style-src-elem` carry no `'unsafe-inline'` and no `*`.

### WR-d4: 08-gap1 left two files in the shared rate-limit bucket; they are isolated only by per-file pepper defaults

**File:** `tests/integration/merge-provenance.test.ts:165`, `:179`, `:113`; `tests/integration/merge-race-coverage.test.ts:209`, `:333`; `tests/integration/public-route-limits.test.ts:12-19`
**Issue:** these files still send `provenance-<uuid>` and `coverage-<uuid>` as `X-Forwarded-For`, and no header at all on the attachment calls. `getClientIp` maps all of these to `SHARED_CLIENT_BUCKET`.
- `status-follow-up` (5 per hour): merge-race-coverage makes 5 shared hits (1b, 2a, 2b, 2c, 2d), which is already exactly the limit. merge-provenance adds 2 more, for 7.
- `status-csat`: merge-provenance makes 2 more shared hits.

The two files do not collide today only because each one sets `RATE_LIMIT_PEPPER` with `if (!process.env.RATE_LIMIT_PEPPER)` to its own literal, inside a fresh worker. So the same `shared:no-client-ip` hashes to a different `ipHash` per file.
**Failure scenario:**
- If `RATE_LIMIT_PEPPER` is present in the environment that runs `pnpm test:integration` (a CI secret, an exported shell variable, or a future line in `global-setup.ts`), every file inherits it. The 6th and 7th shared follow-ups then return 429. In merge-race-coverage, the follow-up never reaches `onResolveStart`, so the test hangs to its timeout.
- Whether that happens also depends on order. Vitest sorts files by cached duration or size, and `public-route-limits.test.ts`'s `beforeAll` deletes every row in the four scopes, for all files, whenever it runs.
- Adding one more follow-up case to merge-race-coverage breaks it even without a shared pepper.

**Fix:**
- Move `uniqueClientIp()` into a shared helper (for example `tests/support/client-ip.ts`) and use it in merge-provenance and merge-race-coverage, including the attachment calls.
- In `public-route-limits.test.ts`, replace the global `deleteMany` with per-test unique identities (a fresh documentation-range or `fd00::/8` address per case), so the file neither depends on nor wipes other files' rows.

### WR-d5: The E2E global teardown kills the dev server without waiting or escalating

**File:** `tests/e2e/global-setup.ts:108-112`
**Issue:** `teardown` calls `killTree(server.pid)`, which sends one SIGTERM to the group and returns at once. It then stops the database container. The 08-17 summary says global setup "shares the cross-platform teardown". It shares the signal helper, but not `stopProcessTree`'s wait for the group to exit or its SIGKILL escalation.
**Failure scenario:** `next dev` (or a child it forked) is slow to exit or ignores SIGTERM while compiling. It then survives the run and keeps the E2E port, and the next `pnpm test:e2e` fails in `waitForServer` or talks to the stale server. The server can also log connection errors against the container that was just stopped. The "workers before 0, after 0" check in the 08-17 evidence counts only `src/lib/worker/index.ts`, so it would not show a leaked dev server.
**Fix:**
```ts
const teardown = async () => {
  await stopProcessTree(server, 15_000);
  await container.stop();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
};
```
and drop the now-unused direct `killTree` import.

### WR-d6: `stopProcessTree` never reports a hung or surviving tree, so kb-proposals lost its "worker did not exit" failure

**File:** `tests/e2e/support/process-tree.ts:84-89`; `tests/e2e/kb-proposals.spec.ts:192-194`
**Issue:** the old kb-proposals `stopWorker` rejected with `worker did not exit within WORKER_STOP_TIMEOUT_MS`. It was the only check that the worker's SIGTERM path (pg-boss stop) works. `stopProcessTree` resolves `void` in every case:
- after a graceful exit;
- after a SIGKILL;
- when the group is still alive 5 s after the SIGKILL, because the result of the second `waitForGroupExit` is ignored.

The 08-17 summary records this as a behaviour note. In practice it removed an assertion and left nothing in its place in the specs.
**Failure scenario:** a regression makes the worker ignore SIGTERM, or deadlocks its shutdown. All four specs pass, because SIGKILL silently cleans up. A tree that even SIGKILL cannot stop, for example one in uninterruptible I/O, leaks without any failure.
**Fix:** return a result and assert on it where it matters:
```ts
export async function stopProcessTree(child, timeoutMs = 15_000): Promise<{ graceful: boolean; gone: boolean }>
...
const r = await stopProcessTree(worker, WORKER_STOP_TIMEOUT_MS);
expect(r.gone).toBe(true);
expect(r.graceful).toBe(true); // kb-proposals keeps its old strictness
```

### WR-d7: Process-group teardown can signal a reused PID that it did not spawn

**File:** `tests/e2e/support/process-tree.ts:35-49`, `:85-89`; `tests/unit/e2e-process-tree.test.ts:50-53`, `:105`
**Issue:** the helper signals `-pid` and decides "alive" with `kill(-pid, 0)`, treating EPERM as alive. It never checks that the group is still the one it created. A pgid cannot be reused while any member is alive, so the normal path is safe. Once the whole tree has exited, though, the number can be given to a new process-group leader of the same user, such as a new shell, an editor helper or another detached spawn. A later call then sends SIGTERM and SIGKILL to that unrelated group.

Concrete paths:
- A worker that crashes at spec start, followed by `afterAll` minutes later.
- The unit test's `afterEach`, which SIGKILLs `-pid` for every started tree even after `stopProcessTree` has confirmed that the tree is gone.
- Case 3, which calls `killTree(pid)` on an exited child. On Windows that is `taskkill /pid <n> /t /f` on whatever process now holds the number.

The likelihood is low, but the rule-J spirit ("never touch what you did not create") applies.
**Fix:**
- In `stopProcessTree`, first check `child.exitCode !== null || child.signalCode !== null`. When the leader has exited, signal the group only if it was seen alive before the leader's `exit` event, and record that state from the spawn onward.
- In the unit test, remove a pid from `started` once its case has confirmed it gone, and do not call `killTree` on a reaped child.
- On Windows, guard `killTree` with the same exit check as the POSIX path.

### WR-d8: "Validate every file before storing any" cannot tell validate-first from store-then-remove

**File:** `tests/integration/public-upload-caps.test.ts:168-176`, `:189-205`
**Issue:** the 415 and 413 cases assert only that the number of files on disk is unchanged afterwards. An implementation that stores the PNG, then validates the second file and deletes the PNG, passes too. That is the very ordering D-24 rules out. The cleanup tests at `:217-237` prove removal. These cases were meant to prove that storage never happened.
**Failure scenario:** a refactor moves `storeValidatedUploads` into the per-file loop and adds a `removeStoredUploads` on rejection. Every rejected 30 MiB request then writes to disk first, and a crash between store and remove leaves orphan files. The suite stays green.
**Fix:** wrap `@/lib/attachments/validate-uploads` with `vi.mock(..., importOriginal)` the same way `create-ticket` is wrapped, and assert `expect(storeSpy).not.toHaveBeenCalled()` on the 415 and 413 cases.

## Info

### IN-d1: The "raw X-Forwarded-For never becomes the session IP" check is satisfied by any other value

**File:** `tests/integration/auth-ip-source.test.ts:77-80`, `:32-35`
**Issue:** `expect(ip).not.toBe("198.51.100.9")` passes for `null`, `""`, a different header or a mangled value. The session is also picked by "latest `createdAt`", not by the token that this sign-in returned.
**Fix:** assert the exact value Better Auth stores when `x-aida-client-ip` is absent (as observed, probably `""` or `null`). Select the session with `where: { token: result.token }`.

### IN-d2: Some identity tests read the ambient `TRUSTED_PROXY_HOPS`

**File:** `tests/unit/client-ip.test.ts:166`, `:189-194`; `tests/unit/proxy.test.ts:232-261`
**Issue:** these cases call `getClientIp` without `withHops`. With `TRUSTED_PROXY_HOPS=1` exported in the shell, they fail. They fail rather than pass falsely, but the result depends on the machine.
**Fix:** use `vi.stubEnv("TRUSTED_PROXY_HOPS", "")` in a `beforeEach` in both files, and call `vi.unstubAllEnvs()` after.

### IN-d3: The health "healthcheck stays 200 under a flood" case proves only that two maps are separate

**File:** `tests/unit/health.test.ts:77-96` (the "healthcheck: one no-identity GET every 10 s" case)
**Issue:** the flooder uses `203.0.113.41` (the per-identity map) and the probe uses the shared bucket, so the probe cannot be throttled by construction. The meaningful case, a flood in the shared bucket, is covered by `health-probe.test.ts` through the unthrottled probe route.
**Fix:** rename the case to what it proves, or flood with no identity and assert the expected 429 for `/api/health`.

### IN-d4: Caddyfile line order is asserted, but Caddy orders directives itself

**File:** `tests/unit/health-probe-wiring.test.ts:29-41`
**Issue:** Caddy sorts site-block directives by its built-in order (`respond` runs before `reverse_proxy` wherever it appears in the file), so the `refusal < proxy` line check proves nothing about runtime behaviour. It is correct today, but it could pass a broken config (for example the respond inside a `route` block placed after the proxy) or fail a working one.
**Fix:** keep the text pins, drop the ordering claim, and leave the behavioural proof to the real-Caddy check in Phase 8.1 (08-22).

### IN-d5: Dead read, and intake tickets created in an arbitrary organization

**File:** `tests/integration/public-upload-caps.test.ts:105`, `:153-156`
**Issue:** `await samplePng();` in the first test discards its result. The intake route uses `prisma.organization.findFirstOrThrow()` with no order. On the shared database, the two accepted intake requests therefore add tickets to whichever organization comes first, which may belong to another file's fixtures.
**Fix:** remove the dead line. Either assert nothing about other organizations' counts anywhere, or note in the test that intake writes into the first organization.

### IN-d6: Timing-sensitive 121-call window and duplicate case IDs

**File:** `tests/integration/public-route-limits.test.ts:31-49`; `tests/unit/proxy.test.ts:181`, `:187`, `:193`, `:232`, `:240`, `:250`
**Issue:**
- The attachment case needs all 121 calls to finish inside the 60 s window. On a loaded host the earliest hits expire and the 121st call is allowed. That is a flaky failure, not a false pass.
- `proxy.test.ts` reuses the case IDs P, Q and R in two describe blocks, which makes evidence rows that cite "proxy P" ambiguous.

**Fix:**
- Freeze the window: count `rateLimitHit` rows directly, or run the case with a smaller `max` through a test-only limit.
- Rename the D-18 cases to U, V and W.

---

_Reviewed: 2026-11-11T15:07:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
