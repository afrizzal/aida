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
