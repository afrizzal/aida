---
phase: 10-team
plan: 05
subsystem: workspace-members
status: complete
tags: [invitations, better-auth, smtp, fake-smtp, org-lock, session-activation, aida-42]
requires:
  - "10-01: invitation.tokenHash, MemberAuditEvent, errors.ts (InvitationError, MemberAdminError), org-lock.ts, member-rights.ts"
  - "10-03: changeMemberRole and deactivateMember (hooks, D-10 revocation), member-writers.test.ts"
  - "10-15: Better Auth organization and admin HTTP routes closed; /invite public"
provides:
  - "src/lib/app-url.ts: getAppBaseUrl() and getAppOrigin() from BETTER_AUTH_URL, AppUrlError"
  - "src/lib/workspace-members/invite-token.ts: createInviteToken, hashInviteToken, isInviteTokenShape"
  - "src/lib/workspace-members/invitations.ts: createInvitation, revokeInvitation, acceptInvitation, activateSessionInTx, getInvitationView, listPendingInvitations"
  - "src/lib/workspace-members/invite-email.ts: sendInvitationEmail -> sent | smtp_off | send_failed, INVITATION_EMAIL_SUBJECT, invitationEmailBody"
  - "tests/support/fake-smtp.ts: node:net SMTP server with capture and fault modes (shared by integration and E2E)"
affects: [10-08, 10-09, 10-10, 10-11, 10-13]
tech-stack:
  added: []
  patterns:
    - "Accept and session activation in one organization-locked transaction; zero session rows throws SESSION_GONE and rolls back"
    - "Retry path keyed on the append-only INVITATION_ACCEPTED row"
    - "Internal refusal reason exposed only through a test seam (onRefusal)"
    - "Email after commit; the copyable link returned only when not delivered"
key-files:
  created:
    - src/lib/app-url.ts
    - src/lib/workspace-members/invite-token.ts
    - src/lib/workspace-members/invitations.ts
    - src/lib/workspace-members/invite-email.ts
    - tests/support/fake-smtp.ts
    - tests/unit/app-url.test.ts
    - tests/integration/invitations.test.ts
  modified:
    - tests/unit/member-writers.test.ts
decisions:
  - "createInvitation returns the link only for smtp_off and send_failed, and never the raw token on its own (D-06); tests take the token from the link or from the captured email"
  - "acceptInvitation compares the invited email with both the user's stored email and the caller's userEmail (after trim and lower-case); either mismatch is INVALID_INVITATION"
  - "The internal refusal reason reaches only the AcceptInvitationHooks.onRefusal test seam; the result carries only the code"
  - "createInvitation adds a local INVALID_EMAIL code and revokeInvitation a local NOT_PENDING code; errors.ts is unchanged"
  - "An SMTP setup with no host or no from address counts as smtp_off"
metrics:
  duration: "about 75 minutes"
  completed: 2026-11-13
actuals:
  tokens: 25400
  tasks: 3
  commits: 3
plan_head_before: 076d52f973e3bbafe2b47afb9a5f34ff2044ae15
---

# Phase 10 Plan 05: Invitation service Summary

Owners and admins create invitations that respect role ceilings. Each one has a 256-bit link token, stored only as a SHA-256 hash, and expires after 7 days. Accept runs in one organization-locked transaction: it re-checks the invitation and the inviter's current rights, inserts exactly one member row and activates the requesting session. If no session row matches, everything rolls back. The invitation email goes through the existing SMTP transport. When SMTP is off or the send fails, the inviter gets a copyable link. All of it is proven against a real Postgres and a hand-written `node:net` fake SMTP server.

Built on better-auth 1.7.20 (D-01 as updated by V-01). A later Better Auth upgrade must rerun `tests/integration/invitations.test.ts` and the other Phase 10 invitation and membership suites.

## What was built

- **`app-url.ts`**: `getAppBaseUrl(env?)` parses `BETTER_AUTH_URL` with `URL`, requires http or https, and returns the origin plus the path with no trailing slash. Query and fragment are dropped. `getAppOrigin(env?)` returns the origin only. A missing, invalid or non-http value throws `AppUrlError` with reason `missing`, `invalid` or `scheme`, and the message never contains the value. No request header is read.
- **`invite-token.ts`**: 32 random bytes in base64url (43 characters) and a hex SHA-256. `isInviteTokenShape` rejects any other string before a lookup.
- **`invitations.ts`** (relative imports only, no logging):
  - `createInvitation({ orgId, actorUserId, email, role }, now?, hooks?)`. It resolves the base URL first: a failure is `INVITE_CONFIG` and nothing is written. The email is trimmed and lower-cased, and a malformed one is `INVALID_EMAIL`. A role outside owner, admin and member is `INVALID_ROLE`. Then one transaction: `lockOrganization`; actor not isAdmin → `NOT_ALLOWED`; role owner with an actor who is not isOwner → `ROLE_ABOVE_OWN`; a user with that email who holds any member row here → `ALREADY_MEMBER`; an unexpired pending invitation for that email → `PENDING_EXISTS`; then the insert (hash only, `expiresAt = now + 7 days`) and `INVITATION_CREATED`. After the commit it sends the email. The result is `{ ok, invitationId, email, role, expiresAt, delivery }`, plus `link` only when `delivery` is `smtp_off` or `send_failed`.
  - `revokeInvitation({ orgId, actorUserId, invitationId }, hooks?)`: lock, then actor isAdmin, then a pending invitation of this organization only becomes `canceled`, then `INVITATION_REVOKED`. Otherwise it returns `NOT_ALLOWED` or `NOT_PENDING` and changes nothing.
  - `acceptInvitation({ token, userId, userEmail, session }, hooks?, now?)`. It first resolves the organization from the token hash, outside the transaction. Then, in one transaction:
    1. `lockOrganization(tx, org, hooks)`, then the invitation is re-read by tokenHash and organizationId.
    2. Retry path first: status accepted, an `INVITATION_ACCEPTED` row for this invitation and user, and a member row → activate and return `retried: true`.
    3. Otherwise, in this order: pending, `now < expiresAt`, email match (stored user email and caller email), a known role, the inviter's current rights (isOwner for owner, isAdmin otherwise), and no existing member row.
    4. A conditional `pending → accepted` update that must match one row, one `tx.member.create`, `INVITATION_ACCEPTED` and `activateSessionInTx`.

    Refusals are `{ ok: false, error: "INVALID_INVITATION" | "SESSION_GONE" }`.
  - `activateSessionInTx(tx, { userId, orgId, session, now })`: one `session.updateMany` matched by `id` or `token`, the `userId` and `expiresAt > now`. Any count other than 1 throws `SESSION_GONE`.
  - `getInvitationView(token, now?)`: for a pending, unexpired invitation with a known role whose inviter may still grant it, the result is `{ state: "valid", workspaceName (branding name, else organization name), role, email, accountExists, expiresAt }`. Anything else is `{ state: "invalid" }`.
  - `listPendingInvitations(orgId, now?)`: pending, unexpired invitations, newest first. `invitedBy` is the inviter's name while they are still a member, else "a former member".
- **`invite-email.ts`**: `sendInvitationEmail(db, { to, inviterName, workspaceName, role, link, expiresAt })`. It reads the organization's email settings: disabled, or no host, or no from address, is `smtp_off`. Otherwise it sends plain text with the UI-SPEC subject and body verbatim through `createSmtpTransport` and the configured from address. The result is `sent` only when the awaited `sendMail` resolves with `to` in `info.accepted` and `info.rejected` empty; any rejection or error is `send_failed`. It never throws and never logs. The expiry date is written as `20 November 2026 at 04:52 UTC` (en-GB, long date, UTC).
- **`tests/support/fake-smtp.ts`**: `FakeSmtpServer` / `startFakeSmtp()` on 127.0.0.1 port 0. It handles EHLO (advertises AUTH PLAIN LOGIN; STARTTLS never, unless the option is set), HELO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA with dot-unstuffing, RSET, NOOP and QUIT. `messages` holds accepted messages; `received` holds every fully received message. Modes: `none`, `reject-rcpt`, `reject-data-command`, `reject-data`, `drop-on-data`, `drop-after-data-end` and `delay-ms`. The API is `start`, `port`, `setMode`, `reset` and `stop`. It has no imports beyond `node:net`.
- **`tests/unit/member-writers.test.ts`**: the allowlist gains `src/lib/workspace-members/invitations.ts` ("accept inserts one member row under the organization lock"), and a new case asserts its only writer is `tx.member.create`.

## Tasks and commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | Create, then a locked accept with session activation | d845678 | app-url.ts, invite-token.ts, invitations.ts, app-url.test.ts, member-writers.test.ts, invitations.test.ts |
| 2 (tdd) | Rejection rules, expiry boundary, session gone, retry, forced-order races | e7477e7 | invitations.test.ts |
| 3 (tdd) | node:net fake SMTP, invitation email, copy-link fallback | f7aba7f | fake-smtp.ts, invite-email.ts, invitations.ts, invitations.test.ts |

## Verification (commands and exit codes)

All Docker runs used `AIDA_TEST_RUN_ID=mwe2yp8j-2ee13c2c14b72a93`, `DOCKER_HOST` from the Colima context and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. Before each task's Docker step, `colima status` and `docker info` both exited 0.

| Command | Exit | Result |
|---------|------|--------|
| `vitest run tests/unit/app-url.test.ts tests/unit/member-writers.test.ts` (Task 1) | 0 | 2 files, 20 tests passed |
| `pnpm test:integration tests/integration/invitations.test.ts` (Task 1 tracer) | 0 | 1 passed |
| same, Task 2 first run (RED evidence) | 1 | 1 failed, 26 passed. The failure was a test fixture: the 1 ms before expiry case used a 1-day session with an injected `now` 7 days ahead, so the result was SESSION_GONE. Fixed in the test, no product change |
| same, Task 2 after the fix and after inlining waitForBlockedBy | 0 | 27 passed (two runs) |
| same, Task 3 RED | 1 | failed to load: `@/lib/workspace-members/invite-email` did not exist |
| same, Task 3 GREEN | 0 | 35 passed |
| `pnpm test:integration tests/integration/invitations.test.ts tests/integration/team-member-admin.test.ts` (final) | 0 | 2 files, 76 passed |
| `pnpm test tests/unit/app-url.test.ts tests/unit/member-writers.test.ts` (plan verify; the script runs the whole unit tree) | 0 | 106 files, 1879 tests passed |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | 718 files, 1 warning, which predates this plan (`tests/unit/container-config.test.ts:160`, noTemplateCurlyInString) |

Acceptance greps:
- Request-host pattern in `invitations.ts` and `app-url.ts`: 0 and 0.
- In `invitations.ts`: `tokenHash` 8, `lockOrganization` 6, `activateSessionInTx` 4.
- `@/` in `invitations.ts`, `app-url.ts`, `invite-token.ts`, `invite-email.ts` and `fake-smtp.ts`: 0 each.
- `invitations.ts` in `member-writers.test.ts`: 4.
- In `invitations.test.ts`: `waitForBlockedBy` 8, `assertNoDeadlock` 4, `SESSION_GONE` 8, `retried` 12, `it(` 39.
- In `fake-smtp.ts`: `node:net` 1, `drop-after-data-end` 4, `reject-data-command` 4.
- `info.rejected\|rejected.length` in `invite-email.ts`: 3.
- `console.*` in `invitations.ts`, `invite-email.ts` and `invite-token.ts`: 0 each.
- `git diff --stat -- package.json pnpm-lock.yaml`: empty.

Not run: the full `pnpm test:integration` suite and `pnpm test:e2e`. This plan names only the invitations suite, and it has no E2E step.

## Prohibitions (AIDA-42)

- Safety: an invitation never grants a role above the inviter's current rights, and never joins a person whose signed-in email differs from the invited address. The creation tests cover ROLE_ABOVE_OWN for an admin and for an owner with mixed rows, and NOT_ALLOWED for a member or a non-member. The accept tests re-read the inviter's rights under the lock: a demoted inviter and a mixed-row owner inviter both fail. The race tests cover demotion and deactivation of the inviter. Email mismatch is tested against both the stored user email and the caller's email. Status: verified by test.
- Privacy: no failure reveals whether a token belongs to another organization, was revoked, expired or was used. Used, revoked, expired, unknown and malformed tokens all return the identical `{ ok: false, error: "INVALID_INVITATION" }`, and their reasons differ only through the test seam. The view returns `{ state: "invalid" }` for every case. Status: verified by test.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 2 - Correctness] The raw token is no longer in the create result.** Task 1's text returned the raw token and the link. Task 3 and D-06 say the link (which contains the token) goes back only for smtp_off and send_failed. A separate `token` field would have bypassed that, so the final result carries neither when the email was sent. Commit f7aba7f.
2. **[Rule 2 - Input validation] `INVALID_EMAIL` on create.** An empty, whitespace-only, multi-`@`, over-254-character or whitespace-containing address is refused before any write. The code is local to `invitations.ts` (`CreateInvitationErrorCode`); the frozen union in `errors.ts` is unchanged. 10-10's action already maps "invalid email". Commit d845678.
3. **[Rule 2] `NOT_PENDING` on revoke.** The frozen codes have none for "no pending invitation with that id here". `RevokeInvitationErrorCode` is local. UI-SPEC has a single revoke error row, so 10-10 needs no new copy. Commit d845678.
4. **[Rule 2] Stricter email match at accept.** The invited email is compared with the user's stored email (re-read inside the transaction) as well as with the caller's `userEmail`. Commit d845678.
5. **[Rule 2] An empty SMTP host or from address is `smtp_off`.** The plan named only "disabled or no host". Sending with an empty MAIL FROM would be a misconfiguration. Commit f7aba7f.
6. **[Test seams] Extra hooks.** `createInvitation` and `revokeInvitation` take the 10-01 lock hooks (the revoke race needs a holder). `acceptInvitation` hooks add `onRefusal(reason, code)`, so tests can read the internal reason without it ever reaching the result. `sendInvitationEmail` takes an optional `timeoutMs` that production does not pass.

### Notes on expected codes in the races

- With the demotion and the inviter deactivation holding the lock, the waiting accept fails INVALID_INVITATION with reason `not-pending`, not `inviter`. 10-03's services cancel the invitations the target sent when that target's rights drop or the target is removed. The inviter-rights check is proven separately, by direct row writes that bypass the service (`inviter`), for a demoted admin and for an owner who gains an admin row.

## Known Stubs

None.

## Threat Flags

None. The new egress is the configured SMTP transport, which already existed (D-26). The loopback fake server is test-only.

## Manual items (open)

- A test with real email (charter phase table) stays open for a human. Nothing here sent a real email.
- The `docs/SECURITY.md` lines for the invitation send path and for tokens in the URL path are `blocked (08-o4)` (O-6). They are not written here.

## Self-Check: PASSED

- Files: `src/lib/app-url.ts`, `src/lib/workspace-members/invite-token.ts`, `src/lib/workspace-members/invitations.ts`, `src/lib/workspace-members/invite-email.ts`, `tests/support/fake-smtp.ts`, `tests/unit/app-url.test.ts` and `tests/integration/invitations.test.ts` exist.
- Commits: d845678, e7477e7 and f7aba7f are on `v2/run-loop`. `git rev-list --count 076d52f..HEAD` is 3 before this SUMMARY commit.
