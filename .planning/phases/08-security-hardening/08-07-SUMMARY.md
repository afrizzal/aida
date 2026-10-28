---
phase: 08-security-hardening
plan: 07
subsystem: security
status: complete
tags: [csp, nonce, strict-dynamic, security-headers, proxy, next-themes, AIDA-28]
requires: ["08-01", "08-05"]
provides:
  - "src/lib/security/csp.ts: CSP_NONCE_HEADER, createNonce, buildCsp, NO_REFERRER_PATH_PREFIXES, securityHeadersFor"
  - "forwardWithSecurityHeaders in src/proxy.ts (plan 08-10 extends it with the client-IP header)"
  - "withSecurityHeaders in src/proxy.ts for the 403, 401 and redirect exits"
  - "Root layout passes the x-nonce request header to ThemeProvider"
affects: ["08-08", "08-10", "08-17", "08-21"]
tech-stack:
  added: []
  patterns: ["per-request nonce CSP set on the forwarded request and the response in the proxy", "pure security module with no project imports"]
key-files:
  created:
    - src/lib/security/csp.ts
    - tests/unit/csp.test.ts
  modified:
    - src/proxy.ts
    - src/app/layout.tsx
    - tests/unit/proxy.test.ts
decisions:
  - "X-Frame-Options: DENY added next to frame-ancestors 'none' (CONTEXT discretion item): costs nothing and covers browsers without CSP2"
  - "Referrer-Policy prefix match is a plain startsWith on /status and /api/public/status. It errs toward no-referrer, the more private value"
  - "proxy.ts imports the CSP module with a relative path (./lib/security/csp), per the charter rule for modules shared by app and worker"
metrics:
  duration: "about 20m"
  completed: 2026-11-11
  tasks: 2
  files: 5
estimate:
  tokens: 70000
actuals:
  tokens: 4900
  tasks: 2
  commits: 2
plan_head_before: ff7e407a838c5c220e2443c3edcaa0b4a2a5d10d
---

# Phase 8 Plan 07: Nonce CSP with strict-dynamic and Security Headers Summary

Every request that passes through `src/proxy.ts` now gets a fresh 16-byte nonce and the locked D-11 policy, on public and authenticated paths alike. The proxy sets the nonce and policy on the forwarded request, overwriting anything the client sent, and sets the policy on the response. Next.js stamps the nonce on its own scripts, and the root layout passes it to next-themes. Every exit also carries `nosniff`, `X-Frame-Options: DENY` and a referrer policy. That includes the 403, the 401 and the redirect. Status-token paths get `no-referrer`. Every route in the build is dynamic.

## Policies (exact, with nonce N)

Production (`NODE_ENV` not `development`):

```
default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'nonce-N'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Development (`NODE_ENV=development`). The only difference is `'unsafe-eval'` at the end of script-src:

```
default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'nonce-N'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Static headers on every proxy exit: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy`. The referrer policy is `no-referrer` when the path starts with `/status` or `/api/public/status`, and `strict-origin-when-cross-origin` everywhere else. The 403, 401 and redirect exits get no CSP, because their bodies are not HTML.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | CSP module, proxy nonce on the public path, nonce to next-themes | 26f05b7 | src/lib/security/csp.ts, tests/unit/csp.test.ts, src/proxy.ts, src/app/layout.tsx, tests/unit/proxy.test.ts |
| 2 | Every exit, header overwrite, referrer policy, dynamic-rendering inventory | 738c2f1 | src/proxy.ts, tests/unit/proxy.test.ts |

Tracer gate after Task 1: the `<verify>` commands were re-run (vitest exit 0, `pnpm build` exit 0) before Task 2 started.

## Test results

TDD RED evidence:
- Task 1 RED: `pnpm exec vitest run tests/unit/csp.test.ts tests/unit/proxy.test.ts` exit 1. csp.test.ts failed on "Cannot find module '../../src/lib/security/csp'". Proxy case H failed with "expected '' to contain 'strict-dynamic'". Tests: 1 failed, 7 passed.
- Task 2 RED: the same command exit 1 after cases I to O were added. K, M and N failed, because the authenticated exit and the error exits had no headers yet. Tests: 3 failed, 21 passed. I, J, L and O already passed, because Task 1's public-path wiring covers them.

GREEN, final run (`--reporter=verbose`), exit 0, 24 passed:
- tests/unit/csp.test.ts, 9 passed: A (exact production string, `toBe`), B (dev differs only by `'unsafe-eval'`), C (no unsafe-eval in prod; no unsafe-inline in script-src or style-src-elem), D (deterministic and in fixed directive order), E (24-char base64 nonce), F (1000 distinct nonces), G (exported constants), H (no-referrer paths), I (strict-origin paths).
- tests/unit/proxy.test.ts, 15 passed: A to G (existing auth-gate cases, unchanged), H (CSP with nonce on /login), I (client x-nonce and CSP overwritten), J (empty client x-nonce gives a nonce of at least 22 chars), K (authenticated /tickets gets CSP and headers), L (50 distinct nonces), M (referrer policy per path), N (nosniff and DENY on the redirect, 401 and 403), O (403 before public-prefix handling, no `x-middleware-next`, no CSP).

Gates, run one process at a time:

| Command | Exit | Result |
|---------|------|--------|
| `pnpm exec vitest run tests/unit/proxy.test.ts tests/unit/csp.test.ts` | 0 | 2 files, 24 tests passed |
| `pnpm test` | 0 | 60 files, 967 tests passed |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | biome checked 571 files, no fixes |
| `pnpm build` (Task 1) | 0 | no "Failed to compile" |
| `pnpm build` (Task 2, inventory) | 0 | no "Failed to compile" |

No Docker, integration or E2E step is part of this plan. None was run.

## D-13 dynamic-rendering inventory

The route table from `pnpm build` at the Task 2 tree. Every route is `ƒ` (Dynamic, server-rendered on demand):

```
ƒ /
ƒ /_not-found
ƒ /api/attachments/[id]
ƒ /api/auth/[...all]
ƒ /api/health
ƒ /api/palette/tickets
ƒ /api/public/intake
ƒ /api/public/status/[token]/attachments/[id]
ƒ /api/public/status/[token]/csat
ƒ /api/public/status/[token]/follow-up
ƒ /api/tickets/[id]/messages
ƒ /api/tickets/picker
ƒ /contacts
ƒ /contacts/[id]
ƒ /insights
ƒ /kb
ƒ /kb/[id]
ƒ /kb/new
ƒ /kb/proposals
ƒ /kb/proposals/[id]
ƒ /login
ƒ /request
ƒ /settings
ƒ /settings/branding
ƒ /settings/custom-fields
ƒ /settings/email
ƒ /settings/sla
ƒ /settings/statuses
ƒ /settings/tags
ƒ /setup
ƒ /status/[token]
ƒ /tickets
ƒ /tickets/[id]
ƒ Proxy (Middleware)
```

No route is static (`○`) or SSG (`●`). `grep -rnE "generateStaticParams|export const revalidate|unstable_cache|\"use cache\"" src` printed nothing.

## Acceptance checks

- `grep -c "forwardWithSecurityHeaders(" src/proxy.ts` gives 3: the definition, the public exit and the authenticated exit.
- `BLOCKED_PUBLIC_ROUTES.some` is on line 66 of src/proxy.ts, and `PUBLIC_PREFIXES.some` is on line 79.
- The module-level nonce grep (`^(let|var|const) +[a-zA-Z]*[Nn]once`) on src/proxy.ts and src/lib/security/csp.ts printed nothing.
- The matcher-comment grep gives 3. `git diff ff7e407 -- src/proxy.ts` shows no change to the `matcher` line.
- src/lib/security/csp.ts has no `@/`, `./` or `../` import.
- `export default async function RootLayout` is at line 16 of src/app/layout.tsx and `nonce={nonce}` at line 30.

## Deviations from Plan

None. The plan was executed as written. Two small choices sit inside the plan's discretion:
- The proxy imports the CSP module as `./lib/security/csp`, not `@/lib/security/csp`. The charter rule is that modules read by the app and the worker use relative imports.
- The proxy test file's `describe` title stays "proxy — AIDA-10 auth gate". The header comment now also names AIDA-28 and the Node.js runtime.

## Review Dispositions Ledger applied

- C13 and R2-9: the matcher comment sits directly above `export const config`. It names `_next/static`, `_next/image` and `favicon.ico` and says why each is excluded. It says that route errors and 404s pass through the proxy. Responses Next.js produces before the proxy runs (the malformed percent-encoding 400) are the boundary that plan 08-08 records.
- C6: no change here, as the ledger says. Plan 08-21 owns the production-mode HTTP proof.
- R2-2: not applicable. This plan has no Docker step.

## Known Stubs

None.

## Notes for downstream plans

- 08-08: no runtime zero-violation proof was run here. The policy is enforced, not report-only. Inline `style` attributes are allowed through `style-src-attr`. Any runtime `<style>` element without the nonce will be blocked; 08-08 finds those.
- 08-10: `forwardWithSecurityHeaders(request, pathname)` is the place to add the client-IP request header.
- The build prints a Turbopack whole-project tracing warning for `src/lib/attachments/local-file-storage.ts`. It predates this plan and is out of scope.

## Self-Check: PASSED

- FOUND: src/lib/security/csp.ts, tests/unit/csp.test.ts, src/proxy.ts, src/app/layout.tsx, tests/unit/proxy.test.ts
- FOUND: commit 26f05b7, commit 738c2f1
- `git rev-list --count ff7e407..HEAD` gives 2 before the docs commit
