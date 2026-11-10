---
phase: 10-team
plan: 13
subsystem: e2e-acceptance
status: complete
tags: [e2e, playwright, invitations, deactivation, notifications, mentions, csp, privacy]
requires:
  - "10-08: /invite/<token> page and POST accept route (V-24 Origin check), invite-onboarding"
  - "10-10: Settings -> Team (invite dialog, copy-link view, role select, Deactivate dialog)"
  - "10-11: bell (bellLabel, Mark as read, Archive, Mark all read) and Settings -> Notifications"
  - "10-12: composer mention reducer (two-step Backspace, setMode strip, r/n keys)"
  - "10-15: proxy prefix block of /api/auth/organization/ and /api/auth/admin/"
  - "10-17: requirePageAccess and /no-access"
provides:
  - "tests/e2e/support/team.ts: createOrg, createUser, addMember, insertInvitation (known token, hash stored), signedInContext, writeFakeSmtpSettings (no password), notificationsFor"
  - "tests/e2e/team-invitations.spec.ts (14), team-deactivation.spec.ts (4), notifications-bell.spec.ts (3), mentions-leak.spec.ts (7)"
  - "csp.spec.ts covers /invite/<valid>, /invite/<unknown>, /no-access; single-h1.spec.ts renders /settings/notifications as a member"
  - "FakeSmtpOptions.advertiseAuth (a relay without AUTH)"
  - "Product fix: the accept route admits the card's own post under no-referrer (Origin null + same-origin navigation fetch metadata)"
affects: [10-14]
tech-stack:
  added: []
  patterns:
    - "Per-spec organizations with password credentials from better-auth/crypto hashPassword; sign-in through the real /login page"
    - "warmAcceptRoute: poll the accept route with an Origin-less POST until 403 (compiled; refused before any read)"
    - "Bell assertions: reload, open the popover (refetch), toPass until the trigger's label carries the exact count"
    - "Outbound email proof: write passwordless SMTP settings after the reply is stored, then run emailOutboundSendHandler in the Playwright process against the loopback fake"
key-files:
  created:
    - tests/e2e/support/team.ts
    - tests/e2e/team-invitations.spec.ts
    - tests/e2e/team-deactivation.spec.ts
    - tests/e2e/notifications-bell.spec.ts
    - tests/e2e/mentions-leak.spec.ts
  modified:
    - src/app/(auth)/invite/[token]/accept/route.ts
    - tests/integration/invite-onboarding.test.ts
    - tests/support/fake-smtp.ts
    - tests/e2e/csp.spec.ts
    - tests/e2e/single-h1.spec.ts
    - .planning/phases/10-team/deferred-items.md
decisions:
  - "Accept route: Origin 'null' is admitted only with Sec-Fetch-Site: same-origin and Sec-Fetch-Mode: navigate; a missing Origin, a foreign Origin and a bare 'null' stay 403. The page keeps Referrer-Policy: no-referrer (D-04). Needs the orchestrator's review (security check changed)"
  - "Fake SMTP gains advertiseAuth:false instead of storing an encrypted password: nodemailer attempts AUTH with empty credentials whenever the server advertises AUTH, and this process has no APP_ENCRYPTION_KEY"
  - "Specs build their own organizations; the shared E2E owner and member are only read (the mismatch case uses member.json)"
metrics:
  duration: "about 35 minutes (2026-11-13T00:50Z to 01:25Z)"
  completed: 2026-11-13
  tasks: 3
  files: 11
estimate:
  tokens: 85000
  tasks: 3
actuals:
  tokens: 23700
  tasks: 3
  commits: 4
plan_head_before: 0043ec287b15cf4c358b21e5167c1e9ecd06d6eb
---

# Phase 10 Plan 13: E2E acceptance of AIDA-42 to AIDA-46 Summary

Twenty-eight new browser cases in four specs, plus three CSP cases, prove invitations, deactivation and closed plugin routes, the bell with its unassigned fallback, preferences, and mentions with their leak guarantees. Writing them exposed a product bug: the invitation card's own form post was refused, so no invitee could join from a real browser. It is fixed in the accept route.

## What each requirement's evidence is

| Requirement | Spec and case | Proves |
|---|---|---|
| AIDA-42 | team-invitations: tracer | The owner invites through the Team page with email off, and the copy-link view appears. A fresh browser sees "Join {name}" with the read-only address, creates the account and lands on /tickets with "Welcome to {name}.". The Team page lists the person as Member. |
| AIDA-42 (V-15) | team-invitations: fake SMTP | A loopback fake started in the test process captures exactly one message to the invited address, with the UI-SPEC subject. Its link joins in a fresh browser with the invited role (admin). |
| AIDA-42 (C9, V-23) | team-invitations: C9 (a), C9 (b), "no workspace" | A new account, an account of another organization (sign-in card) and a signed-in account with no workspace each land in the invited organization's /tickets with its ticket. The session row names that organization. |
| AIDA-42 (R3-1, V-13) | team-invitations: R3-1 (c) | The invitation is revoked after the card renders. Submitting shows the invalid card, and the user count for the address is 0. A new invitation from the Team page then joins. |
| AIDA-42 (R2-2) | team-invitations: R2-2 | The session row is deleted after the accept card renders (cookies kept). Accept gives the sign-in state of the same link, with no member row and the invitation still pending. Signing in through the card joins. |
| AIDA-42 (V-24) | team-invitations: two V-24 cases | A POST with no Origin, or with Origin `http://evil.test`, answers 403 `forbidden_origin` and adds no member row. The same session then accepts through the card. |
| AIDA-42 | team-invitations: expired, D-05 mismatch, isolation, D-04 headers, single use | Expired: the invalid card. Mismatch: the different-email card, no invited address shown, no membership. Isolation: a member of B only, and neither side reads the other's ticket ("Ticket not found"). /invite sends Referrer-Policy no-referrer and never shows the token as text. A used link is invalid. |
| AIDA-43 (C6, V-27) | team-deactivation: open session | Each request first succeeds while a member: a note with a file, GET of the attachment, GET of the count. After the owner deactivates the member in the UI, all six pages land on /no-access with one h1. The assignment action from the open ticket page changes nothing (no audit row). Messages POST and notifications GET answer 403, the attachment 404. The session names no organization. |
| AIDA-43 (C4, V-03, O-5) | team-deactivation: plugin routes | 8 paths × POST and GET × 5 callers = 80 requests, all 403 with the proxy's team-changes error. Callers: no cookie, owner, member, stale cookie of a member deactivated in the UI, and owner with a body naming organization B. Snapshots of organizations, members, invitations, sessions and users are equal before and after. |
| AIDA-43 (D-09, R2-4, O-10) | team-deactivation: floor, race | The only owner's row shows a Badge with no select and no Deactivate, for the owner and for an admin (tooltip on focus). Two stale owner pages: A demotes B (toast), B's change to A shows "You can't make this change with your role.", and exactly one owner (A) remains. |
| AIDA-44 | notifications-bell: assignment | "Ticket #N was assigned to you" with "Notifications, 1 unread". Mark as read, Archive and Mark all read (two rows) persist across reload, in the bell and in the database. |
| AIDA-44 (owner item 11, V-28) | notifications-bell: customer replies | A status-page follow-up on the member's ticket notifies only the member. One on an unassigned ticket gives the owner a row with `unassignedFallback` and the member none. With the owner's "Unassigned tickets" off (still off after reload), the next follow-up adds nothing. |
| AIDA-46 | notifications-bell: preferences | With "Assigned to me: in app" off (still off after reload), a committed assignment writes no row and the bell is empty. A plain member has no "Unassigned tickets" switch. |
| AIDA-44, AIDA-45 | mentions-leak: mention | An internal-note mention renders as a span and gives "{author} mentioned you on ticket #N" in Mira's bell. |
| AIDA-45 (R3-2) | mentions-leak: two-step Backspace | One Backspace: "Hi @Omega Probe", with `mentions` = [omega] and one MessageMention. Two: "Hi ", then "Hi x" with no `mentions` field and no MessageMention. |
| AIDA-45 (D-21) | mentions-leak: direct HTTP | A public reply carrying mentions gets 400 `mentions_not_allowed` and writes nothing. The same request as an internal note gets 200. |
| AIDA-45 (C7, R2-1, V-12) | mentions-leak: toggle, r key, status page, SMTP | Names are inserted three ways: followed by a comma, two sharing a prefix, and one partly deleted. After the toggle, the textarea keeps "can you check" and "@someone" and holds no Zeta or Omega, and the switch note shows. The stored PUBLIC body and its HTML have no names and no mention class, and there is no MessageMention and no MENTION notification. The `r` key path strips "Zeta Prime". The status page shows the reply but no note, name, member email or mention span. The outbound handler sends one message through the fake SMTP: the text is present, and no name, mention class or member email appears in the raw, text or HTML parts, deliveryStatus SENT. |
| V-01, V-18 | csp.spec.ts, single-h1.spec.ts | /invite/<valid> and /invite/<unknown> (both no-referrer) and /no-access load with zero CSP violations. A plain member renders /settings/notifications with its one h1. The completeness check still passes. |

## Product bug found and fixed

**[Rule 1 - Bug] The invitation card's own form post was refused, so no browser could join (AIDA-42).**
- **Found during:** Task 1, first E2E run. Every join case timed out. The trace shows the browser's POST to `/invite/<token>/accept` answered 403 `forbidden_origin`.
- **Cause:** the page sends `Referrer-Policy: no-referrer` (D-04, V-04). Under that policy the Fetch Standard ("append a request `Origin` header") serialises the Origin of a same-origin form POST as `null`. The route admitted only an exact match with the configured origin. 10-08's integration tests built requests with the real origin, so they could not see it.
- **Fix (`dd941e0`):** `isSameOriginPost`. It admits an exact Origin match, or `Origin: null` together with `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate`. Sec-Fetch-* are forbidden request headers: no page script can set them, and a cross-site form or a sandboxed frame is labelled cross-site. Still refused: a missing Origin (with or without metadata), a foreign Origin (with or without metadata), and a bare `null`. The existing integration case that refuses a bare `null` is unchanged and passes. Referrer-Policy stays no-referrer. Browsers without Fetch Metadata fail closed.
- **Tests:** two new integration cases in `tests/integration/invite-onboarding.test.ts`. The admitted shape joins (303, one member row). Seven refused shapes answer 403 with no limiter row and the invitation still pending: null with cross-site, same-site, none, cors or no-cors metadata, a missing Origin with metadata, and a foreign Origin with metadata. In the browser, every join case of team-invitations.spec.ts now passes.
- **For review:** this changes a security check (V-24). The orchestrator or the Codex diff critique should confirm the choice. The alternative was a different referrer policy for /invite (for example `same-origin`), which would change D-04.

## Deviations from Plan

1. **[Rule 3 - Blocking] Fake SMTP `advertiseAuth` option** (`tests/support/fake-smtp.ts`, not in the plan's file list). The plan writes settings without an SMTP password. nodemailer still runs AUTH with empty credentials whenever EHLO advertises AUTH, and fails with `EAUTH Missing credentials`. With `advertiseAuth: false` it sends without AUTH. The default is unchanged, so every existing integration test keeps its behaviour. Commit `9e68e95`.
2. **Accounts are made with `hashPassword` credentials, not the in-process Better Auth sign-up.** The plan's support action names an in-process sign-up with BETTER_AUTH_SECRET. That secret is random per run and is not written to `env.json`. Credential rows hashed with Better Auth's own `hashPassword` (the single-h1.spec.ts pattern) sign in through the real /login page. Invitee accounts are always created by the product's invitation page.
3. **The `r`-key case leaves the textarea with a blur, not with Escape.** Escape inside an editable target is a no-op by design (`src/lib/keyboard/dispatch.ts` step 3: local handlers win), so "leave the textarea with Escape" cannot happen in the product. The case presses Escape, which changes nothing, then blurs focus the way `keyboard.spec.ts` does, then presses `r`.
4. **Plugin-route callers:** five instead of the four in Task 2's behaviour list. A plain member's cookie was added, from the must_haves.
5. **The email body says "as admin."** It is lowercase as `tests/integration/invitations.test.ts` pins. The first draft of the spec expected "Admin" and was corrected; the product did not change.
6. **One locator fix:** Next's route announcer is an empty `role="alert"`, so the R2-4 callout is located by its text.
7. **`deferred-items.md`:** the `/no-access` CSP row is marked fixed by this plan.

## Verification

| Command | Result |
|---|---|
| `pnpm test:e2e tests/e2e/team-invitations.spec.ts tests/e2e/csp.spec.ts` (run 1) | exit 1, 20 passed, 8 failed: the product bug above. Two later join cases passed after the dev server hot-reloaded the fix. |
| same (run 2) | exit 1, stalled in global setup at /setup; `.next` moved to the Trash |
| same (run 3) | exit 0, 28 passed (14 + 14) |
| `pnpm test:integration tests/integration/invite-onboarding.test.ts` | exit 0, 23 passed |
| `pnpm test` (unit) | exit 0, 110 files, 1967 passed |
| `pnpm test:e2e tests/e2e/team-deactivation.spec.ts tests/e2e/notifications-bell.spec.ts tests/e2e/single-h1.spec.ts` | run 1: exit 1, 15 passed, 1 failed (alert locator); run 2: exit 0, 16 passed |
| `pnpm test:e2e tests/e2e/mentions-leak.spec.ts` | exit 0, 7 passed |
| `pnpm test:e2e` (full, run 1) | exit 1, stalled in global setup at /setup; `.next` moved to the Trash |
| `pnpm test:e2e` (full, run 2) | exit 0, 292 passed, 1 skipped, 0 failed (8.1 min) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, 1 warning (the known `tests/unit/container-config.test.ts:160`) |

Acceptance greps: team-invitations `test(` 14 and `newContext` 12; csp `/no-access|/invite/` 6; team-deactivation `/api/auth/organization/` 7 and `delete` 1; single-h1 `/settings/team|/settings/notifications` 11; notifications-bell `Unassigned tickets` 5; mentions-leak `test(` 7, `Backspace` 10, `emailOutboundSendHandler` 3, `fake-smtp` 1, `Zeta Prime` 7, `press("r")` 1.

`.next` moves (global-setup /setup stall, product code and config untouched):
- `~/.Trash/aida-next-1794532135`
- `~/.Trash/aida-next-1794532571`

## Not run, manual

- Visual, dark-mode and screen-reader checks of the bell, Team page, invitation page and preferences stay manual (10-14). No human or visual result is recorded.
- The AI-draft path into public mode is proven only by 10-12's reducer: E2E has no paid LLM (plan flagged assumption).
- Real email: not sent. Only the loopback fake was used.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: auth-check-changed | src/app/(auth)/invite/[token]/accept/route.ts | The V-24 Origin check now also admits `Origin: null` with `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate`. It is required for the card's own post under no-referrer. Cross-site, missing and bare-null Origins stay refused. |

## Known Stubs

None.

## Self-Check: PASSED

- Created files exist: tests/e2e/support/team.ts, team-invitations.spec.ts, team-deactivation.spec.ts, notifications-bell.spec.ts, mentions-leak.spec.ts.
- Commits exist: dd941e0, 9e68e95, dfafcd8, 4cbe9d9.
