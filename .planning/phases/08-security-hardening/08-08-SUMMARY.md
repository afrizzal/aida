---
phase: 08-security-hardening
plan: 08
subsystem: security
status: parked
tags: [csp, e2e, nonce, sonner, radix, get-nonce, AIDA-28]
requires: ["08-07", "08-04", "08-17"]
provides:
  - "tests/e2e/csp.spec.ts: CSP zero-violation E2E (9 tests, 8 green)"
  - "SONNER_STYLE_HASH, EMPTY_STYLE_HASH in src/lib/security/csp.ts, pinned by tests/unit/csp-style-hashes.test.ts"
  - "ThemeProvider hands the nonce to get-nonce (Radix scroll-lock styles)"
affects: ["08-15", "08-16", "08-21"]
tech-stack:
  added: []
  patterns: ["static third-party inline style allowed by a recomputed sha256", "client-only get-nonce setNonce at render time"]
key-files:
  created: [tests/e2e/csp.spec.ts, tests/unit/csp-style-hashes.test.ts]
  modified: [src/lib/security/csp.ts, tests/unit/csp.test.ts, src/components/theme-provider.tsx]
decisions:
  - "Next.js dev-tools chunk violations are excluded in the spec by source file and counted, not allowed in the policy"
  - "C13-boundary left failing as a recorded blocker: Next.js 400 HTML with nonced scripts and no CSP header"
metrics:
  duration: "about 45m"
  completed: 2026-11-11
  tasks: 2
  files: 5
estimate:
  tokens: 90000
actuals:
  tokens: 9000
  tasks: 2
  commits: 4
plan_head_before: c9ee39f4b0b7193c49a1ec58b1eeaba7842fd8e4
---

# Phase 8 Plan 08: CSP Zero-Violation E2E Summary

The enforced nonce CSP now has its acceptance spec. Login, the public request and status pages, the inbox (including a theme switch there and back) and the ticket page (including the Radix "Change status" dropdown) record zero CSP violations. Two real blocks were found and fixed without weakening the policy: sonner's style tag is allowed by a pinned hash, and Radix scroll-lock styles now carry the nonce. The status page sends `no-referrer`. The C13 404 pages and the intake 400 carry the CSP. The plan is **parked**: the `C13-boundary:` test fails because Next.js answers `/status/%E0%A4%A` with an HTML 400 page that contains scripts and has no CSP header.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | c4b5486 | test(08-08): CSP zero-violation E2E on login (D-15) |
| 1 | 631c2de | fix(08-08): allow sonner's static style by hash under the nonce policy (D-11) |
| 2 | 24aa9a9 | fix(08-08): hand the CSP nonce to Radix scroll-lock styles (D-11) |
| 2 | 38aa527 | wip(parkir): CSP E2E on all core pages; C13-boundary fails on Next.js 400 HTML without CSP (08-08) |

## Violations observed before fixes

Run 1 (login only, policy from 08-07), 35 events, all `{"blockedURI":"inline","disposition":"enforce","effectiveDirective":"style-src-elem","violatedDirective":"style-src-elem","sample":""}` (`sample` is empty because the policy has no `'report-sample'`). By source:
- 33 from `/_next/static/chunks/0_j-_next_dist_compiled_next-devtools_index_09ucvlo4rn7c9.js` (32 at line 2642, 1 at line 2691): Next.js dev overlay (style-loader, font-face).
- 2 from `/_next/static/chunks/node_modules__pnpm_0bmfjp2epxyq0._.js` lines 2181 and 2182: sonner's `__insertCSS` (`head.appendChild(style)` empty, then the text node). Confirmed by reading the dev chunk.

Run 3 (all pages, sonner fixed), ticket page after opening the dropdown: `style-src-elem` inline, `sourceFile` `/_next/static/chunks/node_modules__pnpm_0ldnsc2b2nbzo._.js` line 14175, which is react-style-singleton's `insertStyleTag` (Radix scroll lock).

## Fix rules applied

- **Rule 3 (sonner):** `SONNER_STYLE_HASH = 'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY='` and `EMPTY_STYLE_HASH = 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='` appended to style-src-elem in both modes. tests/unit/csp-style-hashes.test.ts recomputes the hash from the installed sonner 2.0.7 with a fake `document`. csp.test.ts's exact production string was updated with literal hashes.
- **Task 2 step 3 (Radix):** src/components/theme-provider.tsx calls `setNonce(props.nonce)` from get-nonce 1.0.1 at render time, guarded by `typeof window !== "undefined"` and a non-empty string. All props are still spread to NextThemesProvider.
- **Rule 4 (dev tooling):** see Deviations. Policy unchanged.

## Final policies (verbatim, nonce N)

Production:
```
default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'nonce-N' 'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY=' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```
Development:
```
default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'nonce-N' 'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY=' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```
`grep -n "unsafe-inline" src/lib/security/csp.ts` code lines: 55 (`style-src` fallback) and 57 (`style-src-attr`). Lines 11, 13, 14 and 17 are comments. None on script-src or style-src-elem. The nonce and `'strict-dynamic'` are kept, and the policy stays enforced (the spec asserts no `content-security-policy-report-only` header).

## C13 results

| Test | Observed |
|------|----------|
| C13 anonymous `GET /request/<uuid>` | 404, CSP with nonce and strict-dynamic: pass |
| C13 admin `GET /<uuid>` | 404, CSP with nonce and strict-dynamic: pass |
| C13 `POST /api/public/intake`, `text/plain`, body `x` | 400, CSP with nonce and strict-dynamic: pass |
| C13-boundary `GET /status/%E0%A4%A` | **fail**, see below |

Boundary line (identical in runs 3, 4 and the full run):
```
PRE-PROXY-BOUNDARY {"status":400,"contentType":"text/html; charset=utf-8","hasCsp":false,"hasScript":true}
```
Body, from a temporary capture that was not committed: a Pages Router error page `<title>400: Bad Request</title>` whose `<script>` tags carry `nonce="..."` (for example `/_next/static/chunks/0_j-_next_dist_build_polyfills_polyfill-nomodule.js`). The nonce means the proxy did run and set the request CSP header. Next.js's decode-error 400 path then drops the proxy's response headers. The plan assumed this response would be non-HTML and script-free, and it is not.

## Blocker (parked)

The C13-boundary acceptance fails. The cause is Next.js 16.2 internals (the malformed-URL 400 is rendered without the middleware response headers). No file in this plan's scope can change that, and a fix would be a framework-level change (Rule 4 territory: for example a custom server, or a next.config header that would conflict with the per-request policy). No fix was attempted, so the policy and the test were not loosened. The spec was committed with the test failing (`wip(parkir):`), as plan step 4 requires. Until it is resolved, every full `pnpm test:e2e` fails on this one test. Options for the orchestrator or owner: (a) accept HTML for the boundary and assert only that the page carries no injectable content (this changes the must-have); (b) look for a Next.js setting or version that keeps headers on the decode-error page; (c) a reverse-proxy (Caddy) rule that adds a static restrictive CSP on 4xx/5xx without one. 08-15 documents the boundary and 08-21 reuses the file, so both inherit this.

## Test results

Docker health before each task's first Docker step: `colima status` exit 0 and `docker info` exit 0, twice. All Docker runs used `AIDA_TEST_RUN_ID=mwc3la6a-646402198bb14254` and `DOCKER_HOST` from the docker context.

| Command | Exit | Result |
|---------|------|--------|
| `pnpm test:e2e tests/e2e/csp.spec.ts` (run 1, login, before fixes) | 1 | 1 failed (35 violations above) |
| `pnpm exec vitest run tests/unit/csp.test.ts tests/unit/csp-style-hashes.test.ts tests/unit/proxy.test.ts` | 0 | 3 files, 27 passed |
| `pnpm test:e2e tests/e2e/csp.spec.ts` (run 2, login, after sonner fix) | 0 | 1 passed |
| `pnpm test:e2e tests/e2e/csp.spec.ts` (run 3, all 9) | 1 | 7 passed, 2 failed (ticket dropdown, C13-boundary) |
| `pnpm test:e2e tests/e2e/csp.spec.ts` (run 4, after setNonce) | 1 | 8 passed, 1 failed (C13-boundary) |
| `pnpm test:e2e` (full, once) | 1 | 217 passed, 1 skipped, 1 failed (csp C13-boundary only); honesty-invariants green; workers before 0, after 0 |
| `pnpm test` | 0 | 62 files, 972 passed |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | clean |

Each page logs `CSP-DEV-TOOLING-EXCLUDED {"events":18,"console":18}` under `next dev`.

## Deviations from Plan

**1. [Rule 3 - Blocking] Next.js dev-tools violations excluded in the spec, not allowed in the policy**
- **Found during:** Task 1, run 1.
- **Issue:** the dev overlay chunk stamps nonces only from its own private webpack runtime (`r.nc`), which the app cannot set. No CSP source allows it narrowly. A dev-only `'unsafe-inline'` is ignored while a nonce is present, and dropping the nonce would hide every real app violation in dev and break D-11.
- **Fix:** the spec filters only violations, and CSP console messages, whose source file matches `/_next/static/chunks/*next-devtools*.js`, and logs the count. buildCsp is unchanged for dev tooling. Under `next start` the filter never matches, so the spec stays valid for 08-21 (C6).
- **Commit:** c4b5486.

**2. The `/login` "Sign in" button visibility and the `/request` `form` visibility were added as page-ready anchors.** These are not policy changes.

## Review Dispositions Ledger applied

- C13 and R2-9: the C13 tests and the separate C13-boundary test are implemented as specified. The `status/%E0%A4%A` path appears only inside the C13-boundary test. The boundary result contradicts the plan's assumption (blocker above).
- C6: no dev-only assumption. The dev-tools filter is inert in production mode.
- R2-2: the Docker health rule was applied before each task's E2E. Both checks were healthy.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: missing-csp | Next.js error path | The malformed-URL 400 HTML page (`/status/%E0%A4%A`) has framework scripts and no CSP response header |

## Manual items

None new. A full manual browse under the production policy is not claimed.

## Self-Check: PASSED

- FOUND: tests/e2e/csp.spec.ts, tests/unit/csp-style-hashes.test.ts, src/components/theme-provider.tsx (setNonce)
- FOUND: commits c4b5486, 631c2de, 24aa9a9, 38aa527
- `git rev-list --count c9ee39f..HEAD` gives 4 before the docs commit
