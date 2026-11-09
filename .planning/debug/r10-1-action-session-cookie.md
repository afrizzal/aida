---
status: awaiting_human_verify
trigger: "R10-1: four E2E cases fail after a refused server action (route re-renders, client state lost) after plan 10-17; suspected fresh session read writing the cookie cache in every server action"
created: 2026-11-13
updated: 2026-11-13
---

## Current Focus

bug_class: Bohrbug mechanism (every action writes the cookie, deterministic) with a timing-dependent symptom (whether the re-render lands before the assertions)
hypothesis: CONFIRMED (see Evidence). Fix: session.cookieCache.enabled false in src/lib/auth.ts
next_action: orchestrator review; update the cache wording in 10-CONTEXT and the deferred-items R10-1 row; decide the auth-upgrade migration pin

reasoning_checkpoint:
  hypothesis: "readFreshSession passes disableCookieCache while the cookie cache is enabled, so Better Auth's getSession ends every valid read with setCookieCache (Set-Cookie session_data); nextCookies forwards it to cookies().set() inside the server action; Next marks the action x-action-revalidated 1 and re-renders the route in the action response, and the re-rendered server tree (deleted row gone, ticket closed, state deleted) prunes or replaces the client state the refusal tests assert"
  confirming_evidence:
    - "installed better-auth 1.7.20 session.mjs: disableCookieCache path ends at setCookieCache unless dontRememberMe/disableRefresh; setCookieCache no-ops only when cookieCache.enabled is falsy"
    - "next 16.4.6 action-handler.js addRevalidationHeader: any modified cookie => x-action-revalidated"
    - "traces at HEAD: every refused action POST in the 4 cases answers Set-Cookie better-auth.session_data + x-action-revalidated 1; 3 of 4 failed in a 4-case run, :242 is racy (passed alone, failed in 10-17 full run with the alert appearing then the selection dropping to 1)"
  falsification_test: "with the cache disabled, if a refused action still answers Set-Cookie or x-action-revalidated, or the 4 cases still fail, the hypothesis is wrong"
  fix_rationale: "AIDA never reads the cache (V-23); the cache's only remaining effects are the per-read write (this bug) and Better Auth's own HTTP endpoints trusting a 5-minute copy (a V-23 gap). Disabling it removes the write at its source with no Next-internal header sniffing and leaves sliding refresh untouched"
  blind_spots: "browsers holding a session_data cookie minted before the change get it expired once (one Set-Cookie, at most one re-render, within its 300 s life); RSC page renders still cannot write a refreshed session cookie (pre-existing upstream behaviour, unchanged)"
  candidate_causes:
    - "code: readFreshSession disableCookieCache path writes the cache (fresh-session.ts + better-auth getSession)"
    - "config: cookieCache.enabled true in auth.ts although no AIDA read may use it"
    - "environment: dev-server timing decides whether the re-render lands before the assertions (why :242 passes alone)"
    - "code (eliminated as cause): 10-17 page helper; it changed no server action and no session read"
  and_gate: "yes: the failure needs (a) a cookie write inside the action (config+code) AND (b) a re-render that changes server-derived state before/while the test asserts (timing). Removing (a) removes the re-render entirely, so one fix suffices"

## Symptoms

expected: after a server action is refused, the client keeps its state (refusal alert, selection, focus, pending flag) and the route is not re-rendered
actual: the route re-renders after the refusal; client state is lost; 4 E2E cases fail (bulk-actions.spec.ts:242 and :518, snooze.spec.ts:209, ticket-statuses.spec.ts:331)
errors: Playwright assertion failures in those four cases (alert/selection/focus not found)
reproduction: pnpm test:e2e (full) after 10-17; or one of the four specs alone
started: between the Phase 9 gate (38ef41a, 261 passed) and 10-17 (9eb2661); 10-02 (6876ee4) introduced readFreshSession

## Eliminated

- hypothesis: plan 10-17 (page helper, Rule B) caused the re-render
  evidence: 10-17 changed no server action and no session read; the Set-Cookie on the refused action comes from getSession's setCookieCache, present on every action since 10-02 (6876ee4)
  timestamp: 2026-11-13
- hypothesis: fix by passing disableRefresh for server-action requests in readFreshSession
  evidence: rejected on design, not on a run: needs Next's internal next-action header, turns off sliding refresh exactly where cookies can be written, and leaves Better Auth's own endpoints trusting the 300 s copy
  timestamp: 2026-11-13

## Evidence

- timestamp: 2026-11-13T04:10
  checked: better-auth 1.7.20 dist/api/routes/session.mjs getSession
  found: with query.disableCookieCache the cached-data branch is skipped; a valid DB session that needs no refresh and has no dont-remember cookie and no disableRefresh ends at `await setCookieCache(ctx, session, ...)` (a Set-Cookie of session_data on every call). setCookieCache (cookies/index.mjs:76-77) returns early when session.cookieCache.enabled is falsy.
  implication: every readFreshSession call with the cache enabled emits a session_data Set-Cookie.
- timestamp: 2026-11-13T04:12
  checked: better-auth dist/integrations/next-js.mjs nextCookies after hook
  found: forwards every Set-Cookie of any auth.api call to next/headers cookies().set(); errors swallowed (RSC). Its own comment: "cookies().set() unconditionally triggers router cache invalidation -- even if the value is unchanged".
  implication: inside a server action the session_data write becomes a Next cookie mutation.
- timestamp: 2026-11-13T04:13
  checked: next 16.4.6 dist/server/app-render/action-handler.js addRevalidationHeader and request-cookies.js:125
  found: any modified cookie in an action sets x-action-revalidated (ActionDidRevalidateStaticAndDynamic) and pathWasRevalidated, so the action response re-renders the page.
  implication: each server action re-renders the route; client state that depends on the server list (selection pruned to loaded rows, focused row, alert) can be lost.
- timestamp: 2026-11-13T04:14
  checked: tests/e2e/ticket-statuses.spec.ts:119-131 renewSessionCookieCache
  found: an existing helper already works around the same class before 10-02: once the 5 min session_data cookie expired, the first server action rewrote it and Next re-rendered the page.
  implication: the cookie-cache write in actions is a latent pre-10-02 flake made unconditional by disableCookieCache.
- timestamp: 2026-11-13T04:17
  checked: run 1 of bulk-actions.spec.ts:242 at HEAD
  found: global setup stalled at /setup (dev server "Compiled in 1ms" loop). .next moved to the user Trash as aida-next-1794518258 (never deleted); retried once, the retry started normally.
  implication: known dev-server issue, not this bug.
- timestamp: 2026-11-13T04:19
  checked: bulk-actions.spec.ts:242 alone at HEAD (twice, second with --trace on)
  found: passes alone (1 passed), but the trace shows the refused action POST answering with Set-Cookie better-auth.session_data=... and x-action-revalidated 1, same as the failing 10-17 trace (test-results/bulk-actions-...-9d319.../trace.zip). DOM snapshots: passing run ends at "2 tickets selected"; failing 10-17 run shows the alert appear ("Nothing was changed") and then "1 ticket selected" (the re-render pruned the deleted row and the alert went with it).
  implication: the mechanism is present on every run at HEAD; whether the re-render lands before the assertions finish is timing dependent (race), so the failure is load dependent.
- timestamp: 2026-11-13T04:21
  checked: the 4 cases in one run at HEAD (--trace on)
  found: 3 failed (bulk :518 alert not found, snooze :209 preset disabled after the re-rendered closed ticket, ticket-statuses :331 Options button not focused), bulk :242 passed. Every refused action POST in all four traces answers Set-Cookie better-auth.session_data and x-action-revalidated 1.
  implication: reproduced; the cookie write is on every refused action.
- timestamp: 2026-11-13T04:24
  checked: alternatives in the installed source
  found: (1) disableRefresh: true stops the write (early return) but also stops sliding refresh in exactly the context where Better Auth can write cookies (server actions; RSC renders skip refresh via nextCookies' shouldSkipSessionRefresh or swallow the write), and needs Next's internal next-action header to target actions only; it leaves the cache enabled, so Better Auth's own HTTP endpoints (sessionMiddleware -> getSessionFromCtx without disableCookieCache) keep trusting a 300 s copy. (2) cookieCache.enabled false: setCookieCache and the cached branch are skipped everywhere; deleteSessionCookie still expires session_data unconditionally; the refresh path (updateSession + setSessionCookie after updateAge) is unchanged; a request still carrying an old session_data cookie gets it expired once (session.mjs:46-49).
  implication: (2) is the smaller and stricter fix.
- timestamp: 2026-11-13T04:25
  checked: RED case (commit 50a806e) in tests/integration/membership-gate.test.ts at the old config
  found: 1 failed, 25 passed; the fresh read answered ["better-auth.session_data=...; Max-Age=300; ..."] where [] was expected.
  implication: the test catches the bug at the integration level.
- timestamp: 2026-11-13T04:30
  checked: fix applied (cookieCache enabled false), membership-gate suite
  found: 27 passed. Revert check (auth.ts set back to enabled true, file restored afterwards): 23 failed, the sign-in fixture's "no session_data" assertion first; the RED run above is the driving-test revert.
  implication: the change at the fix site is what turns the suite green.

- timestamp: 2026-11-13T04:31
  checked: the 4 cases after the fix (--trace on)
  found: 4 passed. Every refused action POST answers with no Set-Cookie and no x-action-revalidated; the one x-action-revalidated left (first, successful bulk action in :518) comes from the action's own revalidation and carries no Set-Cookie. The regenerated E2E storage state holds no session_data cookie.
  implication: the re-render after a refusal is gone.
- timestamp: 2026-11-13T04:33
  checked: session-related integration suites in one run (membership-gate, auth-bootstrap, auth-ip-source, auth-setup, auth-upgrade, ticket-picker, authz-conservative-membership)
  found: 63 passed, 1 failed: auth-upgrade.test.ts:119 pins 8 upgrade migrations, but plan 10-01 (1708239) added 20261115100000_team_foundation and the pin was not updated. The assertion compares migration names only; the suite's six session cases (pre-upgrade sessions and logins) passed with the cache off.
  implication: pre-existing, unrelated to R10-1; reported, not fixed here.
- timestamp: 2026-11-13T04:43
  checked: one full pnpm test:e2e on 0db72a9
  found: 261 passed, 1 skipped, 0 failed, 0 did not run (6.6m), exit 0; no /setup stall.
  implication: matches the Phase 9 gate count (261 passed).

## Resolution

root_cause: "src/lib/auth.ts kept Better Auth's cookie cache on (300 s) while readFreshSession (10-02, V-23) reads with disableCookieCache. In better-auth 1.7.20 that read ends every valid session lookup with setCookieCache, a Set-Cookie of session_data. The nextCookies plugin forwards it to cookies().set() inside the server action; Next.js 16 then answers x-action-revalidated and re-renders the route in the action response. After a refusal the re-rendered server tree (row deleted, ticket closed, state deleted) pruned the selection, removed the alert, disabled the preset or replaced the focused row. Whether the re-render lands before the assertions is timing dependent, so single runs can pass. Before 10-02 the same write happened only when the 300 s cache cookie had expired (the ticket-statuses workaround)."
fix: "cookieCache enabled false in src/lib/auth.ts. setCookieCache and the cached branch are skipped, so a valid read sets no cookie; Better Auth's own endpoints read the session row too. readFreshSession keeps disableCookieCache (a browser may still hold a copy from before; it is expired once)."
effects: "Sliding refresh unchanged: after updateAge Better Auth still extends the row and sets the session token cookie (at most one re-render per session per updateAge in a server action, as before). A gone session still gets its cookies expired and the read returns null. RSC renders still cannot write a refreshed cookie (upstream behaviour, unchanged). Better Auth endpoints cost one session-row lookup each."
verification:
  target_test: { result: pass, test: "tests/integration/membership-gate.test.ts R10-1 cases", red_at: 50a806e }
  mutation_check: { result: pass, reason: "Stryker not configured; manual mutant at the fix site (enabled true) makes the suite fail (23 failed), RED run shows the driving case fails for the Set-Cookie" }
  no_op_deletion: { result: flagged, deletion_justified_by_rca: true, note: "config turns a feature off; RCA shows no AIDA read may use it (V-23)" }
  adjacent_tests: { result: pass_with_preexisting_failure, suites_run: [unit 105 files 1869 tests, typecheck, lint, session integration suites 63 of 64 (auth-upgrade pin failure pre-existing), full e2e 261 passed 1 skipped] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, note: "revert by editing the line and restoring the file; git stash is forbidden in this run" }
  guardrail_verdict: accepted
files_changed: [src/lib/auth.ts, src/lib/fresh-session.ts, src/lib/session.ts, tests/integration/membership-gate.test.ts, tests/e2e/ticket-statuses.spec.ts]
commits: [50a806e test RED, 0db72a9 fix]
open: "10-CONTEXT V-07/V-23 and D-08 still describe the cache as on for 300 s; deferred-items R10-1 row and the auth-upgrade pin are for the orchestrator"
