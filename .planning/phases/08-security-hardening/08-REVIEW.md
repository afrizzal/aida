---
phase: 08-security-hardening
part: a (CSP, security headers, auth upgrade, container and compose, dependencies, CI)
reviewed: 2026-11-11T16:00:00Z
depth: standard
diff_range: a6a8499..HEAD (HEAD b465819)
files_reviewed: 18
files_reviewed_list:
  - src/proxy.ts
  - src/lib/security/csp.ts
  - next.config.ts
  - src/app/layout.tsx
  - src/components/theme-provider.tsx
  - src/app/globals.css
  - src/lib/auth.ts
  - src/lib/auth-client.ts
  - Caddyfile
  - Dockerfile
  - docker-compose.yml
  - docker-compose.egress-test.yml
  - .env.example
  - package.json
  - .github/workflows/audit.yml
  - .github/workflows/ci.yml
  - .github/workflows/integration.yml
  - .github/dependabot.yml
coverage_note: "All 18 files were read in full, and their diff hunks were checked against a6a8499. For context only, these were also read: src/lib/rate-limit/client-ip.ts; the client-IP section of docs/OPERATIONS.md; Next 16.4.6's middleware matcher call, 404 and DecodeError handling (router-server.js, resolve-routes.js) and its agentRules code path (start-server.js, generate-agent-files.js); Better Auth 1.7.20's getIP, rate-limiter key and error route, and better-call 1.4.5's router; next-themes 0.4.6's nonce handling; react-style-singleton 2.2.3. No tests, builds, containers or proxies were run. The Better Auth 1.6 to 1.7 default changes were checked only for the IP source and the trusted-origins environment variable, not for every cookie or session default. Runtime proof of the non-root images (migrate as `node`, whether `.next/cache` needs to be writable, uploads on a fresh volume) is Part B (Phase 8.1, 08-14 and 08-23) and is not reported here."
findings:
  critical: 1
  warning: 2
  info: 7
  total: 10
status: issues_found
---

# Phase 8: Code Review Report (part a, CSP, headers, auth, containers, dependencies, CI)

**Reviewed:** 2026-11-11
**Depth:** standard (full files; see coverage note)
**Files Reviewed:** 18
**Status:** issues_found

## Summary

The orchestrator's eight checks:

1. **Nonce CSP.**
   - `createNonce()` runs inside every `forwardWithSecurityHeaders` call and is never stored at module level.
   - Client-sent `x-nonce` and `content-security-policy` request headers are overwritten with `set`, not merged.
   - `script-src` is `'self' 'nonce-…' 'strict-dynamic'`. It gains `'unsafe-eval'` only when `NODE_ENV === "development"` and never gets `'unsafe-inline'`. `style-src-elem` has no `'unsafe-inline'` either.
   - There is no duplicate header: `next.config.ts` has no `headers()`, and the `Caddyfile` sets no CSP.
   - HTML pages are dynamic, because the root layout awaits `headers()`. Next serves them `private, no-store`, so the nonce does not reach a shared cache.
   - The responses without a CSP are the 403 and 401 JSON responses and the `/login` redirect. All three carry nosniff, X-Frame-Options and Referrer-Policy.
   - Two gaps: the client keeps changing the nonce after the page has loaded (CR-a1), and some paths skip the proxy because the matcher exclusions are not anchored (WR-a1).
2. **K125.**
   - `request.nextUrl.pathname` is the raw, still-encoded path, and `decodeURIComponent` accepts `%25`, `%2F` and percent-encoded UTF-8. The query is never checked.
   - The guard rejects only a bare `%` without two hex digits, or invalid UTF-8. Next would answer those with its own 400 or 404 anyway.
   - The guard is the first statement of `proxy()`. It does not run for paths the matcher excludes (WR-a1).
3. **`agentRules: false`.** Next reads it only in `start-server.js`, inside the dev-server branch (`syncAgentRulesForDev`). The build and `next start` never read it. With the flag off, the dev server only removes a Next-managed block from a root `AGENTS.md`, and there is none. It has no production effect.
4. **better-auth 1.7.20.**
   - The only config change is `advanced.ipAddress.ipAddressHeaders: ["x-aida-client-ip"]`. The proxy writes that header on every forwarded request, `/api/auth` included, and overwrites any value a client sent.
   - The shared-bucket value `shared:no-client-ip` is not a valid IP. Better Auth's `getIP` therefore returns null, and the limiter falls back to its own `no-trusted-ip` bucket. Rate limiting still applies.
   - Cookie, session and `trustedOrigins` config is unchanged. 1.7.20 still reads `BETTER_AUTH_TRUSTED_ORIGINS`.
   - The `@ts-expect-error` removed from `auth-client.ts` was a type workaround only.
   - better-call 1.4.5 returns 404 for `//` paths and does not decode the route path, so `BLOCKED_PUBLIC_ROUTES` keeps working.
5. **Non-root images.**
   - `runner` ends with `USER node` after `mkdir -p /data/uploads && chown node:node /data/uploads`. The code stays root-owned and readable.
   - `builder` ends with `USER node`. `migrate` now calls the Prisma CLI through `node` instead of corepack's pnpm.
   - Whether these run at runtime is Part B.
6. **CI.**
   - Every job uses `runs-on: ubuntu-latest`.
   - No new schedule. The nightly cron in `integration.yml` predates this phase.
   - `audit` runs on `pull_request`, push to `master` and `workflow_dispatch`, with `permissions: contents: read`.
   - Dependabot is weekly with `open-pull-requests-limit: 3` on every entry.
   - There is no `pull_request_target`, and no `${{ github.event.* }}` value reaches a `run:` line.
   - Gap: `ci.yml` and `integration.yml` have no `permissions:` block (WR-a2).
7. **Client IP.** `header_up X-Forwarded-For {remote_host}` replaces the header; the `+` prefix would append. The app reads only the proxy-written `x-aida-client-ip` and the rightmost XFF entry. No other code in `src/` reads `x-forwarded-for` or `x-real-ip`.
8. **Fonts.** No `next/font`, `--font-inter`, Google font host or `@import url(` is left in `src/`, `next.config.ts` or `package.json`. `shadcn/tailwind.css` contains no `url(` and no font.

The main defect is CR-a1. The nonce comes from the RSC payload, and a refresh or a revalidating server action sends a new one. The page's CSP still holds the nonce of the first HTML response. After the first `router.refresh()`, every style tag that Radix scroll lock or next-themes inserts is blocked.

## Critical Issues

### CR-a1: After a refresh, the client stamps style tags with a nonce the page's CSP does not allow

**Files:** `src/components/theme-provider.tsx:13-16`, `src/app/layout.tsx:21`, `:30`, `src/proxy.ts:47`
**Issue:** The browser fixes a document's CSP when the document loads: it is the `Content-Security-Policy` header of the first HTML response. The client, however, keeps reading the nonce from props that the server renders again on every RSC request:

- The proxy makes a fresh nonce for every request that passes through it (`proxy.ts:47`), RSC requests included.
- The root layout reads `x-nonce` (`layout.tsx:21`) and passes it as a prop to the client `ThemeProvider` (`layout.tsx:30`).
- `router.refresh()` marks the root segment for refetch, so the server renders the root layout again under a new nonce. Fourteen files under `src/` call it, for example `composer.tsx`, `triage-status-chip.tsx`, `status-manager.tsx`, `csat-form.tsx` and `follow-up-form.tsx`. Server actions that call `revalidatePath` send a new tree in the same way.
- `ThemeProvider` re-renders with the new prop. It calls `setNonce(newNonce)` (`theme-provider.tsx:14`) and passes the new nonce on to next-themes.

Two style injectors then use a nonce the document never allowed:

- **react-style-singleton.** It creates a new `<style nonce=getNonce()>` whenever its counter returns to 0, that is, on every Dialog, Select or modal menu opened after all the others were closed. Its singleton code is `makeStyleTag` → `getNonce()`.
- **next-themes 0.4.6.** Its `disableTransitionOnChange` style is built as `W(p)` with the current `nonce` prop (`useCallback(..., [p])`). It is inserted on every theme change, the OS-driven `system` changes included.

`style-src-elem 'self' 'nonce-<first>' <hashes>` blocks both. Failure scenario:

1. An agent opens a ticket and sends a reply. `composer.tsx` calls `router.refresh()`.
2. The agent opens any Radix dialog. The scroll-lock style (`overflow: hidden` on `body`, scrollbar compensation) is refused with a CSP violation, and the page behind the modal scrolls.
3. The agent switches the theme. The transition-disabling style is refused, so colours animate mid-switch, with another violation.

D-15 requires zero violations including a popover and a theme switch. The 08-08 spec passes because it never opens a popover after a refresh. The policy itself stays safe; the defect is broken behaviour plus violation noise on the main agent flow.
**Fix:** Keep the client on the nonce of the document it is running in. Capture it once and ignore later props:
```tsx
"use client";
import { setNonce } from "get-nonce";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// The document's CSP is fixed at load; later RSC payloads carry other nonces (CR-a1).
let documentNonce: string | undefined;

export function ThemeProvider({ children, nonce, ...props }: ComponentProps<typeof NextThemesProvider>) {
  if (typeof window !== "undefined") {
    if (documentNonce === undefined && typeof nonce === "string" && nonce !== "") {
      documentNonce = nonce;
      setNonce(nonce);
    }
    return <NextThemesProvider {...props} nonce={documentNonce}>{children}</NextThemesProvider>;
  }
  return <NextThemesProvider {...props} nonce={nonce}>{children}</NextThemesProvider>;
}
```
Another option is to read the nonce from the DOM, using the `.nonce` property of any framework `<script>`, because browsers hide the attribute. Extend the 08-08 E2E: call `router.refresh()` (or submit a reply), then open a dialog and switch the theme, and assert zero violations.

## Warnings

### WR-a1: Unanchored matcher exclusions send some HTML paths past the proxy, with no CSP and no K125 guard

**File:** `src/proxy.ts:144` (comment at `:137-143`)
**Issue:** The matcher `"/((?!_next/static|_next/image|favicon.ico).*)"` uses a negative lookahead with no trailing boundary, and the `.` in `favicon.ico` is unescaped. So any path that merely starts with one of these strings skips the proxy:

- `/_next/staticX`;
- `/_next/image-foo`;
- `/favicon.ico/x`, `/favicon.icoANY`, `/faviconXico`.

The project has no favicon: `public/` is empty and `src/app` has no `favicon.ico` or `icon.*`. A top-level navigation to `/favicon.ico`, which has no non-HTML `Sec-Fetch-Dest`, therefore also falls through. Next's router-server only short-circuits `/_next/static/` (with the slash) and non-HTML `Sec-Fetch-Dest` requests to a plain-text 404; in production these paths render the app's HTML not-found page. That page leaves without:

- `Content-Security-Policy`;
- `X-Frame-Options`, `nosniff` and `Referrer-Policy`;
- the K125 guard, so `/favicon.ico%E0%A4%A` reaches Next's own decode path, which is the scenario K125 was written to close.

Without the proxy, a client-sent `x-nonce` (and `x-aida-client-ip`) also reaches the root layout unchanged. That breaks the "never trust a client nonce" invariant of D-12 on these paths. Nothing is exploitable today: the not-found page reflects no input, and nothing on these paths reads the client IP. But the comment's claim "None of them returns HTML" is false, and the D-11 promise "every HTML path" does not hold for them.
**Fix:** Anchor the exclusions to the exact assets, and add a real icon so `/favicon.ico` is a file:
```ts
export const config = {
  matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$).*)"],
};
```
Add a proxy unit test asserting that `/_next/staticX`, `/favicon.icoX` and `/favicon.ico/x` match the matcher. Add `src/app/icon.svg` (or `favicon.ico`), or keep `favicon.ico` inside the matcher.

### WR-a2: `ci.yml` and `integration.yml` run with the repository's default token permissions

**Files:** `.github/workflows/ci.yml:1-19`, `.github/workflows/integration.yml:1-19`
**Issue:** Both workflows were edited in this phase (the D-27 `env:` block), but neither has a `permissions:` block. `audit.yml:14-15` sets `contents: read`. Without a block, `GITHUB_TOKEN` gets the repository default. On a repository whose Actions setting is "Read and write", or that was created before GitHub switched the default to read, that is write access to contents, packages, pull requests and more. Fork pull requests always get a read-only token, but push to `master`, the nightly cron and `workflow_dispatch` get the default. Failure scenario: a compromised dependency's install script or a compromised tag of `pnpm/action-setup@v4` runs in `pnpm install` on a push to `master` and gets a token that can push to the repository. This is the least-privilege check the orchestrator asked for (note 6).
**Fix:** Add at the top level of both files:
```yaml
permissions:
  contents: read
```
Neither job needs more.

## Info

### IN-a1: Dockerfile comments still name `dist/worker.cjs`

**File:** `Dockerfile:63`, `:98`
**Issue:** Both comments say the worker runs `node dist/worker.cjs`. The bundle is `--outfile=dist/worker.mjs` (`:52`), and both compose files run `node dist/worker.mjs`. A maintainer who follows the comment gets a "module not found" error.
**Fix:** Change both comments to `dist/worker.mjs`.

### IN-a2: `sonner` uses a caret range while the CSP pins a hash of its CSS

**Files:** `package.json:63`, `src/lib/security/csp.ts:35`
**Issue:** `SONNER_STYLE_HASH` allows exactly the CSS text of the installed sonner. With `"sonner": "^2.0.7"`, any lockfile refresh or the grouped Dependabot minor-and-patch PR can move it to a version with different CSS. `tests/unit/csp-style-hashes.test.ts` then fails, and that test is the only guard. The package rule asks for pinned versions on anything the security posture depends on.
**Fix:** Pin `"sonner": "2.0.7"` and update the hash and the pin together.

### IN-a3: `get-nonce` works only while it is the same module instance as react-style-singleton's copy

**Files:** `package.json:40`, `src/components/theme-provider.tsx:3`
**Issue:** `setNonce` writes module state that `react-style-singleton` reads through its own `import { getNonce } from 'get-nonce'`. Today the lockfile has one `get-nonce@1.0.1`, so both resolve to the same file. If a later update resolves react-style-singleton to a different get-nonce version, the app's `setNonce` writes a second copy. The scroll-lock styles then lose their nonce silently, and only the E2E violation check would notice.
**Fix:** Add a unit check that `require.resolve("get-nonce")`, resolved from the project root and from react-style-singleton's directory, gives the same real path. At minimum, add a comment at `package.json`'s `get-nonce` pin that names this coupling.

### IN-a4: The K125 response duplicates the D-14 header set instead of reusing the helper

**File:** `src/proxy.ts:88-99`
**Issue:** `malformedPathResponse` hard-codes `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`, while every other exit goes through `withSecurityHeaders` → `securityHeadersFor` ("one helper so the exits cannot drift", `:60-62`). A header added later to `securityHeadersFor`, for example a `Permissions-Policy`, would be missing from the 400 path.
**Fix:** Build the response with only `Content-Type` and the static CSP, pass it through `withSecurityHeaders(response, "/status")`, which yields `no-referrer`, or override `Referrer-Policy` afterwards.

### IN-a5: Dependabot's `docker` entry does not cover the compose images

**File:** `.github/dependabot.yml:33-40`
**Issue:** The `docker` ecosystem reads Dockerfiles. `pgvector/pgvector:pg16` and `caddy:2` in `docker-compose.yml`, and `greenmail/standalone:latest` in the egress compose file, get no update PRs. `caddy:2` is the open 08-o2 item.
**Fix:** If the owner agrees under rule I, add a `docker-compose` entry (weekly, `open-pull-requests-limit: 3`). Otherwise record that the compose images are updated by hand.

### IN-a6: Workflow actions are referenced by mutable tags

**Files:** `.github/workflows/audit.yml:32-36`, `ci.yml:25-29`, `integration.yml:25-27`
**Issue:** `actions/checkout@v5`, `pnpm/action-setup@v4` and `actions/setup-node@v5` resolve to whatever the tag points to at run time. Dependabot's `github-actions` entry already exists and can keep SHA pins current.
**Fix:** Pin each action to a full commit SHA with a `# v5` comment.

### IN-a7: No `Strict-Transport-Security` on any response

**Files:** `Caddyfile:6-29`, `src/lib/security/csp.ts:73-80`
**Issue:** D-14 did not require HSTS, and Caddy does not add it by default. On a real domain, a first visit over `http://` can be downgraded before Caddy's redirect.
**Fix:** Optional, and for real domains only: `header Strict-Transport-Security "max-age=31536000"` in the site block. Keep it off for `localhost`, and document it in `docs/OPERATIONS.md`.

---

_Reviewed: 2026-11-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Orchestrator dispositions (2026-11-11)

Source reviews: this file (part a), `08-REVIEW-b.md`, `08-REVIEW-c.md`, `08-REVIEW-d.md`. Totals: 3 critical, 25 warnings, 28 info. The orchestrator checked CR-a1 and CR-01 against the code before triage (`src/components/theme-provider.tsx` sets the nonce from every render's prop; imapflow 1.7.8 throws `GREETING_TIMEOUT`, `CONNECT_TIMEOUT`, `UPGRADE_TIMEOUT`, `ETIMEOUT`, `NoConnection` and `ClosedAfterConnect*`, none of which `errors.ts` knows). Every warning and critical is fixed. Info rows are fixed when cheap and clearly right, otherwise deferred with a reason. Fix batches run one after another in the main checkout (one test process at a time). Every behaviour change needs a test that was run red before the fix.

### Run decisions

- **K126 (CR-a1):** the client keeps the nonce of the first render of the page and ignores later props. `get-nonce` and next-themes both receive that first value. A soft refresh never changes the nonce the document's CSP allows. Proof: an E2E step that runs `router.refresh()` (or a server action that revalidates), then opens a dialog and switches the theme, with zero CSP violations.
- **K127 (CR-01, WR-01, WR-02):** one rule for all four probes. `invalid_configuration` is only local input validation. `authentication_failed` is only a server of the probed protocol rejecting credentials (HTTP 401 or 403 on the probe call, SMTP 530, 534 or 535, an IMAP authentication failure). Every timeout, close, refusal, DNS or TLS failure, protocol mismatch (`EPROTOCOL`, a non-JSON body, a non-auth HTTP status on the probe call) and every imapflow connection code becomes `connection_failed`. `unknown` is left for errors that are not network or protocol errors. The `connection_failed` text is widened so it stays honest when a server answered but not as expected (wrong service, missing model). The server log carries an allowlisted shape (error name, code and HTTP status from fixed sets) and never a message, host or URL. IMAP gets an explicit connection timeout. The residual (a credential rejection proves a service of that protocol answered; timing differs) is written in `errors.ts` and `docs/SECURITY.md`.
- **K128 (WR-b2):** a per-request file-count cap, checked before any file is read, answered 413 `too_many_files`. The value follows the largest count the shipped public forms allow; 10 if no form sets one. The public form shows the error.
- **K129 (WR-b3):** length caps on the public text fields, answered 400. The values follow existing limits in the code (agent composer, email ingest, database columns) where they exist; otherwise name 200, email 320, subject 500, message 50 000 characters. Truncating the triage prompt for the email ingest path is deferred (it belongs with the ingest limits).
- **K130 (WR-b1):** the limiter bounds its wait. A lock wait or pool wait past a short limit answers 429 with `Retry-After`, never a 500 and never an unbounded queue. Proof: an integration test that holds the advisory lock from another backend (bound by PID) and shows the bounded 429.

### Batches

| Batch | Rows | Area |
|---|---|---|
| F1 | a-CR-a1 (K126), a-WR-a1, a-WR-a2, d-WR-d3, a-IN-a1, a-IN-a2 (check whether `csp-style-hashes.test.ts` already fails on a changed sonner CSS; pin only if not, and only if pnpm can do it without re-breaking the better-auth peer snapshot), a-IN-a4 | CSP, proxy matcher, layout, CI permissions |
| F2 | c-CR-01 (K127), c-WR-01, c-WR-02, c-WR-03, d-WR-d2, c-IN-01, c-IN-02 | connection tests |
| F3 | b-WR-b1 (K130), b-WR-b2 (K128), b-WR-b3 (K129), b-WR-b4, d-WR-d4, d-WR-d8, b-IN-b1, b-IN-b2, b-IN-b3, b-IN-b4, b-IN-b7 (one clear log line naming the setting; no boot failure), d-IN-d1, d-IN-d2, d-IN-d3, d-IN-d5, d-IN-d6, c-WR-10 | rate limits, public routes, health |
| F4 | c-CR-02, c-WR-04, c-WR-05, c-WR-06, c-WR-07, c-WR-08, c-WR-09, c-IN-03, c-IN-04, c-IN-05, c-IN-06 | image check and gate scripts |
| F5 | d-WR-d1, d-WR-d5, d-WR-d6, d-WR-d7, d-IN-d4, c-WR-11 | test teardown, auth upgrade test, website upgrade page |

### Deferred (with reason, into `deferred-items.md`)

- a-IN-a3: `get-nonce` single-instance assumption. A pnpm dedupe change could split it; K126's E2E step catches the effect. Recorded, no code.
- a-IN-a5: Dependabot for compose images. Adds pull requests on top of the 08-o1 volume question; owner item 08-o1.
- a-IN-a6: pinning workflow actions by commit SHA. Supply-chain hardening outside Part A's plans; needs a Dependabot `github-actions` entry to stay current, which is also an 08-o1 volume question.
- a-IN-a7: HSTS. Self-hosted installs on plain HTTP or with a later domain change can lock users out; a deployment decision, not a Part A fix.
- b-IN-b5: duplicated upload cleanup. Refactor only, no behaviour change.
- b-IN-b6: orphaned files on an unreachable branch. Unreachable today.
- b-IN-b8: `text/plain` and `text/csv` never pass the sniff. Pre-existing v1 behaviour; widening accepted types is a product choice.
- c-IN-07: the gate's evidence directory lives in TMPDIR by rule C. The tracked `08-GATE-A.md` keeps the results; the limit is written there.

## Codex diff critique round 1 dispositions (2026-11-12)

Source: `.planning/run-loop/codex/fase08-diff-jawab.md` (4 HIGH, 1 MEDIUM, 1 LOW). The orchestrator checked every claim against the code before triage: `errors.ts` maps any HTTP 401 or 403 to `authentication_failed`, and only the Ollama probes take a configurable URL (the OpenAI and Anthropic probes use the vendor hosts and an API key; the Ollama probes send no credential); the pool in `src/lib/db.ts` has no `connectionTimeoutMillis` and the F3 report already names the abandoned-waiter residual; `imageRow` in `scripts/part-a-gate-check.ts` reads the verify log's word and checks only status, exit, target, tag and run id against the image log; the "foreign resources unchanged" row passes on two identical files, including two empty ones; intake counts only non-empty `file` parts, after the whole multipart body is parsed. All six are accepted. Five are fixed in batch F6; the LOW is deferred.

### Run decisions

- **K131 (Codex 1):** on the Ollama probes, an HTTP 401 or 403 is `connection_failed`, because AIDA sends Ollama no credential, so such a reply cannot be a rejection of AIDA's credentials. A probe passes only when the response has the Ollama shape (`/api/tags`: a `models` array; `/api/embed`: an `embeddings` array of non-empty number arrays). OpenAI and Anthropic keep 401 and 403 as `authentication_failed`. `docs/SECURITY.md` and `errors.ts` drop the claim that a credential rejection proves the protocol; the residual is a service that imitates Ollama's shapes, plus timing.
- **K132 (Codex 2):** admission control in front of the pool. An in-process limit on concurrent limiter transactions (a small fixed share of the 10-connection pool, leaving the rest for the app); a request over it is answered 429 with `Retry-After` at once and never calls `pool.connect`. With this, a flood cannot grow pg-pool's waiter queue through the limiter. AIDA runs one app process (single server), which the limit relies on; the docs say so. Other database errors on the limiter path still propagate as before (a down database is not an overload).
- **K133 (Codex 3):** the gate verifier runs the same pure validation the image check's `--verify` runs, over the actual image log and exit file, at derive and at check time, instead of trusting the verify log's word. The validation moves to a module both scripts import, with no Docker code in it. Mutation tests per validated field and for a missing teardown line.
- **K134 (Codex 4):** the foreign-resource evidence records each listing's exit code and requires exit 0 and a well-formed, non-empty listing (header line present) before and after. The row is renamed to what it measures (the listed containers, and the volumes of project `aida`, unchanged), so it no longer claims every foreign resource. `08-24-PLAN.md` gets a dated revision note for the capture commands; the gate itself is rerun at step 8.
- **K135 (Codex 5):** a part-count cap before the multipart parse. The bounded reader's raw bytes are scanned for the boundary delimiter, and a body with more parts than a fixed limit (10 file parts plus the route's known text fields, small slack) is answered 413 `too_many_parts` without parsing. Every `file` part counts toward the 10-file cap, empty ones included. No new dependency.

### Batch

| Batch | Rows | Area |
|---|---|---|
| F6 | codex-1 (K131), codex-2 (K132), codex-3 (K133), codex-4 (K134), codex-5 (K135) | Ollama probes, limiter admission, gate verifier, public multipart |

### Deferred

- codex-6 (LOW): responses Caddy makes itself (the probe's 404, the body-size 413) carry no security headers. Adding a global `header` block in Caddy would duplicate the app's CSP on proxied responses, and the real Caddy behaviour can only be proven by plan 08-22 (Phase 8.1). Deferred to Phase 8.1 and recorded in `deferred-items.md`.

## Codex diff critique round 2 dispositions (2026-11-12)

Source: `.planning/run-loop/codex/fase08-diff-r2-jawab.md` (no HIGH; 3 MEDIUM, 1 LOW). Checked against the code before triage: the three admission slots in `src/lib/rate-limit/check-rate-limit.ts` are shared by every identity and route; `countFormParts` in `src/lib/http/read-bounded-form-data.ts` keeps scanning after the closing delimiter and after the limit, and the url-encoded branch loops once per `&` over up to 31 MiB; the boundary is encoded as latin1, so a non-ASCII boundary that the parser reads as UTF-8 would not be counted (the orchestrator found this one while checking, it is not in the critique); `src/lib/db.ts` caches the pool and client on `globalThis` only outside production, and the admission counter is a module variable. The three MEDIUM are fixed in batch F7. The LOW is accepted as a written limit.

### Run decisions

- **K136 (Codex r2-1):** fairness in front of the shared slots. One identity (scope plus client-IP hash) holds at most one admission slot; a second concurrent call from the same identity gets 429 at once. A check that denies records an in-memory "denied until" time for that scope and identity, and later calls before that time get 429 without a transaction (the database would deny them too, because Retry-After is the window reset). Both maps are bounded in size and swept, like the health throttle.
- **K137 (Codex r2-2 and the boundary finding):** the part counter stops as soon as the count passes the limit, stops at the first closing delimiter (the parser ignores the epilogue), and the url-encoded branch stops the same way. A multipart boundary must be 1 to 70 RFC 2046 boundary characters (ASCII only), quoted or not; any other boundary is refused unparsed. Tests: an adversarial body with many fake closing delimiters, a body with millions of `&`, a non-ASCII and an over-long boundary, a quoted boundary; all bounded by assertions on work done (counts or early returns), not on wall-clock time.
- **K138 (Codex r2-3):** one pool, one Prisma client and one admission state per process in production too. The pool, the client and the limiter's admission state live on `globalThis` under fixed `Symbol.for` keys in every environment, as the health store does (`Symbol.for("aida.health.state")`). A unit test re-imports the modules after `vi.resetModules()` and shows both copies share the same pool and the same counters.
- **Codex r2-4 (LOW, accepted as a limit):** the K134 row accepts a header-only listing when exit 0 and identical, because an empty listing is legitimate. It does not prove when or with which filter the listing was taken, nor that volume contents are unchanged. The row name already says what it measures; the gate's note for the row states this limit.

### Batch

| Batch | Rows | Area |
|---|---|---|
| F7 | codex-r2-1 (K136), codex-r2-2 (K137), codex-r2-3 (K138), boundary charset (K137) | limiter fairness, part counter, process singletons |

## Codex diff critique round 3 (last) dispositions (2026-11-12)

Source: `.planning/run-loop/codex/fase08-diff-r3-jawab.md` (no HIGH; 2 MEDIUM, 1 LOW). Checked against the code: `tests/e2e/uat-gaps.spec.ts` drives six intake posts from one identity, and the fixture only deletes database rows, so a CI retry (`retries: process.env.CI ? 1 : 0`) meets the denial the running server remembers (K136); `countFormParts` treats `--boundary--` at any byte position as the closing delimiter, so a value such as `hello--b--world` makes a legitimate body `invalid`. Both MEDIUM are fixed in batch F8. This was the last Codex round on the topic (charter: at most 3), so F8 gets no further Codex review; it is kept small, test-first and conservative, and the final gate and the verifier check it.

### Run decisions

- **K139 (Codex r3-1):** the rate-limit E2E case uses its own client address per attempt (derived from `testInfo.retry`), sent as `X-Forwarded-For` on both the API requests and the browser page, so a retry starts with a fresh identity and the case no longer has to be last. Test-only; product behaviour unchanged. The E2E server's hop setting is checked to pick that address.
- **K140 (Codex r3-2):** a delimiter is recognised only at the start of the body or right after a line feed (`\n--boundary`, which covers CRLF and bare LF), as the parser does. Every such occurrence is examined, closing ones included, and the scan refuses once the examined count passes `maxParts + 2`, so many fake closings stay bounded. A closing delimiter that is not the last delimiter occurrence is refused as `invalid`, which keeps the round-2 protection (a `--b--` in part headers followed by more parts). The epilogue rule from F7 stays. Proof: a differential test over a corpus of adversarial and legitimate bodies (mid-line delimiters, CRLF and LF framing, a closing delimiter in headers and in content, preamble, epilogue, many fake closings) asserting the scanner's count is never below the entry count of the runtime's own `Request.formData()`, and that the bodies with mid-line `--b--` in a value or a file are accepted.
- **Codex r3-3 (LOW, accepted as a limit):** with one slot per identity, the shared "no usable address" identity admits one check at a time, so a proxy misconfiguration or a large NAT also limits concurrency, not only quota. `docs/OPERATIONS.md` gets one sentence saying so next to the shared-bucket warning.

### Batch

| Batch | Rows | Area |
|---|---|---|
| F8 | codex-r3-1 (K139), codex-r3-2 (K140), codex-r3-3 (docs sentence) | E2E retry isolation, delimiter recognition |
