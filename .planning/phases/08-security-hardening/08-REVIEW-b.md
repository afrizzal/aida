---
phase: 08-security-hardening
part: b (client IP, rate limits, public routes, health, upload caps)
reviewed: 2026-11-11T15:05:00Z
depth: standard
diff_range: a6a8499..HEAD
files_reviewed: 16
files_reviewed_list:
  - src/lib/rate-limit/check-rate-limit.ts
  - src/lib/rate-limit/client-ip.ts
  - src/lib/rate-limit/memory-throttle.ts
  - src/lib/rate-limit/public-limits.ts
  - src/lib/health/health-check.ts
  - src/lib/http/read-bounded-form-data.ts
  - src/lib/attachments/constants.ts
  - src/lib/attachments/validate-uploads.ts
  - src/app/api/health/route.ts
  - src/app/api/health/probe/route.ts
  - src/app/api/public/intake/route.ts
  - src/app/api/public/status/[token]/attachments/[id]/route.ts
  - src/app/api/public/status/[token]/csat/route.ts
  - src/app/api/public/status/[token]/follow-up/route.ts
  - src/lib/worker/jobs/sla-flag.ts
  - src/app/(app)/tickets/[id]/actions.ts
coverage_note: "All 16 files were read in full, and their diff hunks were checked against a6a8499. For context only, these were also read: Caddyfile, src/proxy.ts, next.config.ts, src/lib/db.ts, src/lib/attachments/staged-files.ts, buildStorageKey in local-file-storage.ts, the client-IP section of docs/OPERATIONS.md, Better Auth 1.7.20's getIP and rate-limiter key code, Next 16.4.6's X-Forwarded-For fill in base-server.js, and the GIF check in file-type 22. No tests, builds or containers were run. Caddy runtime behaviour (header_up overwrite, the path matcher, request_body cut-off) comes from the config and the docs, not from a live proxy. Proving it is Part B (Phase 8.1) work and is not reported here."
findings:
  critical: 0
  warning: 4
  info: 8
  total: 12
status: issues_found
---

# Phase 8 Part A: Code Review Report (part b, client IP, rate limits, public routes, health, upload caps)

**Reviewed:** 2026-11-11
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

I found no blocker. The supported topology (only Caddy published, `header_up X-Forwarded-For {remote_host}`, `TRUSTED_PROXY_HOPS` blank) gives the right identity, and the limiter, the throttle and the byte caps do what the plans say. There are four warnings. Two are pre-existing abuse paths that the new upload helper was meant to cover but does not: no cap on the number of files (WR-b2) and no length cap on text fields (WR-b3). One is a pool-pinning side effect of the advisory-lock limiter (WR-b1). The last is a silent failure mode in the client-IP fallback (WR-b4).

Answers to the orchestrator's checks:

1. **Client IP.** With hops 0 behind the shipped Caddy, the identity is right. Caddy overwrites X-Forwarded-For with the TCP peer. Next 16.4.6 only fills the header when it is absent (`req.headers['x-forwarded-for'] ??= socket.remoteAddress`, base-server.js:604), so it does not append Caddy's container address. `getClientIp` then takes the single entry. A client cannot inject `x-aida-client-ip`: `src/proxy.ts:53` overwrites it on every forwarded request, and the matcher skips only `_next/static`, `_next/image` and `favicon.ico`, none of which reaches Better Auth. The shared bucket cannot be reached by a client in the supported topology, because entries left of the trusted index are never parsed. With hops above 0, a client that bypasses the CDN reaches only the shared bucket and does not hurt CDN-routed users. That fail-closed choice is sound. The real risk is a misconfiguration that sends every request to the shared bucket without any app log line (WR-b4). Better Auth falls back the same way: `shared:no-client-ip` fails its `isValidIP`, so production uses its single `no-trusted-ip` bucket per path.
2. **Atomic limiter.** The count and the insert are serialized correctly. `Retry-After` is an integer of at least 1 on every 429 (`public-limits.ts:21`), and the limiter is the first awaited call in all four routes. `hashtext` gives a 32-bit key, so two identities can collide, but a collision only serializes two unrelated identities and never merges their counts, because the count is keyed by `scope` plus `ipHash`, not by the lock key. The lock is not held across slow work, only across count, findFirst and insert. However, waiters hold pool connections while they wait (WR-b1). A missing pepper fails closed: `hashIp` throws before any write, so no unsalted hash is stored, but all four public routes then answer 500 (IN-b7).
3. **Health.** Memory is bounded: `maxKeys` is 10 000 with oldest-first eviction, and the shared map has `maxKeys: 1`. Single-flight cannot leave a rejected promise behind, because `queryHealth` catches every error and `.finally` always clears `inFlight`. The cache stores 503 as well as 200. The one gap is that a hung DB read has no timeout (IN-b4). The probe returns only `ok` or `error`, which is less than `/api/health` returns, and Caddy's matcher `path /api/health/probe*` covers the trailing-slash and suffix forms.
4. **Byte caps.** The bounded reader cancels the stream as soon as the running total passes 31 MiB, and the Content-Length check is an early reject only. Next's proxy has already buffered the body (up to 32 MiB) before the route runs, so the comment "never buffered whole" holds only for the route's own copy (IN-b2). Every file is validated before any is stored. A failure during storing cleans up through `saveStagedFiles`. After storing, intake cleans up in its `catch`, and follow-up cleans up on `unavailable` and on a throw. One unreachable branch in intake can still orphan files (IN-b6).
5. **`sla-flag.ts` and `tickets/[id]/actions.ts`.** Both diffs are comments only, and both are safe. In `addTag`, `getSessionActor()` was already the first statement at a6a8499, so D-28's "move the gate first" was already true in the code. The diff adds the comment, and the test file `tests/unit/add-tag-gate.test.ts` exists. The sla-flag comment correctly counts four raw statements (two lock SELECTs at lines 65 and 107, two UPDATEs at lines 85 and 129). It also states correctly that each statement pairs a row with its own `organizationId`.

## Warnings

### WR-b1: The advisory-lock limiter lets one client address pin the app's connection pool

**File:** `src/lib/rate-limit/check-rate-limit.ts:67-91`
**Issue:** `consumeRateLimit` opens an interactive transaction (one pool connection), then blocks in `pg_advisory_xact_lock` until every earlier request with the same scope and identity commits. The app pool is `pg.Pool({ max: 10 })` (`src/lib/db.ts:5-10`, compose `DB_POOL_MAX: "10"`), and `connectionTimeoutMillis` is left at its default of 0, so other queries wait in the pool queue with no time limit.
**Failure scenario:** One address sends 50 concurrent `GET /api/public/status/x/attachments/y` requests. That route's limit is 120 per minute, so all of them reach the limiter. Ten requests take all ten connections. Nine of those sit idle, blocked on one lock, while the requests behind them wait for a connection. Agent page loads, Better Auth session reads and the health snapshot all queue behind them. Requests beyond the transaction's `maxWait` or `timeout` (5 s) fail with Prisma P2028, and the route turns that into a 500, not a 429. Even over quota, each request still costs a full transaction (BEGIN, lock, count, findFirst, COMMIT), so a 429 is no cheaper for the database than an allowed request. Without the lock, the same flood runs in parallel. With it, the flood is serialized while holding the whole pool. The probe also reads through this pool, so a long enough flood can make the container healthcheck fail while Postgres is healthy.
**Fix:** Bound the lock wait and answer 429 rather than 500:
```ts
return prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;
  } catch (err) {
    if (isLockTimeout(err)) return { allowed: false, retryAfterSeconds: 1 }; // SQLSTATE 55P03
    throw err;
  }
  // ...count / insert as now
}, { maxWait: 2000, timeout: 3000 });
```
A larger alternative is a fixed-window counter table with a single upsert (`INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`). That is atomic, needs no interactive transaction and takes one round trip. Also consider setting `connectionTimeoutMillis` on the pool, so a starved pool fails fast and does not hang requests.

### WR-b2: No cap on the number of files per public upload

**File:** `src/lib/attachments/validate-uploads.ts:31-55` (callers: `src/app/api/public/intake/route.ts:67`, `src/app/api/public/status/[token]/follow-up/route.ts:75`)
**Issue:** `validateUploadFiles` checks per-file size, the 30 MiB total and the sniffed type, but not how many files there are. `file-type` 22 reports `image/gif` for any buffer that starts with the three bytes `GIF` (`source/index.js:540`), and it accepts any buffer longer than 1 byte. This is pre-existing (v1 had no count cap either), but D-24 made `validate-uploads.ts` the single gate for public uploads, and the gate still leaves this open.
**Failure scenario:** One anonymous intake POST with about 31 MiB of multipart parts, each `GIF` plus about 70 bytes of part header, carries roughly 400 000 "valid" files. Intake stores every one: about 400 000 `storage.save` calls and one `attachment.createMany` with about 400 000 rows on a single ticket. At 5 requests an hour per address, and per IPv6 /64, a few requests exhaust inodes on the uploads volume and leave a ticket whose detail page has to list 400 000 attachments. In follow-up, the per-row `tx.attachment.create` loop inside the default 5 s transaction times out, and then `discard()` deletes 400 000 files on the request path.
**Fix:** Add a count cap next to the byte caps and check it before reading any file:
```ts
// constants.ts
export const MAX_FILES_PER_REQUEST = 10;
// validate-uploads.ts, first line of validateUploadFiles
if (files.length > MAX_FILES_PER_REQUEST) {
  return { ok: false, status: 413, error: "too_many_files" };
}
```
Add `"too_many_files"` to the error union, and add a test with `MAX_FILES_PER_REQUEST + 1` one-byte GIFs. Optionally also require a minimum valid header (for example `GIF87a` or `GIF89a` plus a logical screen descriptor) before a file counts as an image.

### WR-b3: Public text fields have no length cap, and Part A raised the effective ceiling from 12 MB to 31 MiB

**File:** `src/app/api/public/intake/route.ts:19-24`, `src/app/api/public/status/[token]/follow-up/route.ts:24-26`
**Issue:** `intakeSchema` (`name`, `subject`, `message`) and `followUpSchema` (`message`) have `.min(1)` and no `.max()`. The only bound is the 31 MiB body cap, and the 30 MiB file cap does not apply to text fields. Before Part A, Caddy cut bodies at 12 MB. Now it allows 32 MiB, so the text ceiling rose. The intake message goes unchanged into `createTicket`. From there it is enqueued for `ai-triage`, and `buildTriageUserPrompt` (`src/lib/triage/prompt.ts:32-34`) puts the whole body into the LLM prompt with no truncation. Follow-up runs `renderMarkdown` on the whole string inside the interactive transaction (`follow-up/route.ts:118`).
**Failure scenario:** An anonymous visitor posts a 30 MiB `message` five times an hour from each address. Each submission becomes a 30 MiB `Message` row, then a triage call that either burns the operator's paid LLM tokens or fails on the context window, and every agent who opens the ticket loads the 30 MiB body. A 30 MiB `subject` is also possible and lands in every ticket list. In follow-up, rendering 30 MiB of markdown can exceed the 5 s transaction timeout, which turns the request into a 500 after the files were already stored and then discarded.
**Fix:** Bound the fields and keep the body cap for files:
```ts
const intakeSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  subject: z.string().min(1).max(500),
  message: z.string().min(1).max(50_000),
});
const followUpSchema = z.object({ message: z.string().min(1).max(50_000) });
```
Choose the limits to match what the agent composer and the email ingest accept, and document them next to `MAX_TOTAL_REQUEST_BYTES`. Separately, consider truncating the body in `buildTriageUserPrompt`, because the email ingest path also feeds it.

### WR-b4: A plausible misconfiguration puts every client in the shared bucket with no app log line

**File:** `src/lib/rate-limit/client-ip.ts:72-85` (log only at `:62-69`)
**Issue:** The helper logs once when `TRUSTED_PROXY_HOPS` is invalid. It logs nothing when the value is valid but the chain is shorter than declared (`index < 0`, line 76) or when a trusted entry is malformed (line 82). The documented CDN setup has three steps (`docs/OPERATIONS.md`, "Advanced: a CDN in front of Caddy"), and step 2 is "remove the `header_up X-Forwarded-For {remote_host}` line". An operator who sets `TRUSTED_PROXY_HOPS=1` in `.env` but leaves the shipped Caddyfile unchanged gets a one-entry chain on every request.
**Failure scenario:** Every client, attacker or not, lands in `shared:no-client-ip`. Site-wide, intake then allows 5 submissions an hour, CSAT 5, follow-up 5, and status attachments 120 a minute. `/api/health` allows 120 a minute in total. Better Auth sign-in falls into its single `no-trusted-ip` bucket per path, whose default is 3 per 10 seconds for `/sign-in/email`. A single client, or ordinary traffic on a busy site, locks out every user, including agents trying to sign in. The only log signal is Better Auth's one-time warning on the first auth request, which does not mention `TRUSTED_PROXY_HOPS`. The fail-closed choice is right. The silence is the defect, because the operator cannot tell "under attack" from "my setting is wrong".
**Fix:** Log once per process, naming the setting and no address, when a valid hop count meets a chain that is too short or malformed:
```ts
let shortChainLogged = false;
function logShortChainOnce(): void {
  if (shortChainLogged) return;
  shortChainLogged = true;
  console.error(
    "TRUSTED_PROXY_HOPS is set but X-Forwarded-For has fewer trusted entries than declared; affected requests use the shared client bucket. See docs/OPERATIONS.md, \"Client IP and reverse proxies\".",
  );
}
// at :76  if (index < 0) { if (hops > 0) logShortChainOnce(); return SHARED_CLIENT_BUCKET; }
// at :82  if (canonical === null) { logShortChainOnce(); return SHARED_CLIENT_BUCKET; }
```
The `hops > 0` guard keeps a hostile client on a CDN-bypass path from reaching the log, and the once-per-process flag prevents log flooding. Also add a sentence to the OPERATIONS step list that setting the variable without step 2 sends every client to the shared bucket.

## Info

### IN-b1: Caddy does not strip a client-sent `x-aida-client-ip`

**File:** `src/lib/rate-limit/client-ip.ts:26-28` (writer: `src/proxy.ts:53`; proxy config: `Caddyfile:20-27`)
**Issue:** Better Auth trusts only `x-aida-client-ip`, and `src/proxy.ts` is its only writer. That is correct today. Caddy, however, forwards the header from the client unchanged. If a request ever reaches Better Auth without passing through the proxy, the client chooses its own sign-in limiter identity. That could happen through a future matcher exclusion, a route moved under an excluded prefix, or a framework bug that skips middleware like CVE-2025-29927.
**Fix:** Add `header_up -X-Aida-Client-Ip` inside `reverse_proxy` in the Caddyfile, so Caddy strips the header as a second fence. Add the line to the Part B real-Caddy spoofing test.

### IN-b2: The comment in the bounded reader overstates what it prevents

**File:** `src/lib/http/read-bounded-form-data.ts:3-7`, `:26`
**Issue:** The comment says an oversized body "is never buffered whole". With `proxyClientMaxBodySize` set to 32 MiB (`next.config.ts`), Next buffers the body for the proxy before the route runs, so the process already holds up to 32 MiB per request. The reader then holds a second copy (`chunks`), the Blob a third, and the FormData a fourth. The cap is still enforced correctly on what the route receives. Separately, `request.body.getReader()` (line 26) sits outside the `try`, so a body that is already locked throws a 500, not `invalid`. No current route does that.
**Fix:** Reword the comment to "the route never parses more than `maxBytes`; Next's proxy buffer (PROXY_BODY_LIMIT_BYTES) is the process-level bound". Move `getReader()` inside the `try`. Optionally clear `chunks` after building the Blob (`chunks.length = 0`).

### IN-b3: The CSAT route still parses an unbounded body

**File:** `src/app/api/public/status/[token]/csat/route.ts:44-49`
**Issue:** CSAT carries only `score` and a `comment` of at most 2 000 characters, but it calls `request.formData()` with no cap. A holder of a resolved ticket's token can make the route parse a 32 MiB multipart body. D-24 did not cover CSAT, so this is not a plan miss. It is the same route-level bound applied unevenly.
**Fix:** `const body = await readBoundedFormData(request, 16 * 1024);` and map `too_large` to 413, as the other two routes do.

### IN-b4: A hung health read has no timeout

**File:** `src/lib/health/health-check.ts:64-99`
**Issue:** Single-flight means every caller of `/api/health` and the probe awaits one `findUnique`. If the database stops answering on an open connection, or WR-b1 pins the pool (`connectionTimeoutMillis` is 0), the promise never settles. Every health request then hangs instead of getting the cached 503 that the design describes. The container healthcheck times out, which is the right outcome, but external monitors see hangs instead of a 503 body.
**Fix:** Race the read against a timeout inside `queryHealth`, so the 503 snapshot is cached like any other:
```ts
const hb = await Promise.race([
  prisma.systemSetting.findUnique({ where: { key: "heartbeat:lastRunAt" } }),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
]);
```

### IN-b5: `removeStoredUploads` duplicates `staged-files.ts` and ignores the `discard()` it is handed

**File:** `src/lib/attachments/validate-uploads.ts:57-85`
**Issue:** `storeValidatedUploads` calls `saveStagedFiles`, drops the returned `StagedFiles.discard()`, and then `removeStoredUploads` reimplements `deleteEach` (same ENOENT skip, same log shape, different prefix). Two copies of the cleanup rule can drift. For example, one gets a retry and the other does not.
**Fix:** Return the `StagedFiles` handle (or its `discard`) from `storeValidatedUploads`, and have the routes call it, or export `deleteEach` from `staged-files.ts` and reuse it.

### IN-b6: Intake can still orphan stored files when the initial message is not found

**File:** `src/app/api/public/intake/route.ts:91-110`
**Issue:** If `prisma.message.findFirst` returns null, the `if (initialMessage)` branch is skipped and no error is thrown. The files stay on disk with no attachment rows, and the response is 200. `createTicket` writes the message in its own transaction, so this is unreachable today. But D-24 says to remove stored files whenever a later step fails, and a missing message is such a step.
**Fix:** `if (!initialMessage) throw new Error("intake: initial message missing after createTicket");`. The existing `catch` then removes the files.

### IN-b7: A missing or placeholder pepper is not caught at boot

**File:** `src/lib/rate-limit/check-rate-limit.ts:19-27`
**Issue:** Without `RATE_LIMIT_PEPPER`, the limiter fails closed, which is correct: no unsalted hash is written. But it does so as a 500 on each of the four public routes, and since 08-11 that includes status-page attachment downloads, which had no limiter before. Nothing checks the pepper at boot. Separately (pre-existing), `getPepper` accepts `.env.example`'s public placeholder `replace-me-with-a-random-pepper`. An operator who copies the example without editing it gets a pepper that anyone can read, which makes the stored hashes as reversible as the unsalted case the comment warns about.
**Fix:** In production, check the pepper in `instrumentation.ts`: log an error, or refuse to start, when it is empty, shorter than about 16 characters, or starts with `replace-me`. Apply the same check to the other `replace-me` secrets.

### IN-b8: `text/plain` and `text/csv` can never pass the upload sniff

**File:** `src/lib/attachments/validate-uploads.ts:43-46` (list: `src/lib/attachments/constants.ts:2-10`)
**Issue:** `fileTypeFromBuffer` detects binary signatures only and returns `undefined` for plain text, so the `!sniffed` branch answers 415 for every `.txt` and `.csv`. The two text entries in `ALLOWED_MIME` are dead. This is pre-existing (v1 had the same check), but the public form presumably invites log or CSV attachments.
**Fix:** Either remove the text types from `ALLOWED_MIME` and the form's accept list, or add a text fallback: no sniff result, the declared type is in the text set, and the bytes are valid UTF-8 with no NUL. Store such files as `text/plain`, and keep `nosniff` plus `Content-Disposition: attachment` on download.

---

_Reviewed: 2026-11-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
