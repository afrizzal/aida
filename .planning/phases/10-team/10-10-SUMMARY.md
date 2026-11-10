---
phase: 10-team
plan: 10
subsystem: settings-team-ui
status: complete
tags: [team, members, roles, deactivation, reassignment, invitations, ui]
requires:
  - "10-03: member-admin.ts (listMembers, changeMemberRole, deactivateMember, reassignOpenTickets, countOpenAssignedTickets)"
  - "10-05: invitations.ts (createInvitation with delivery and link, revokeInvitation, listPendingInvitations)"
  - "10-17: page-access.ts (requirePageAccess) and the Rule B page inventory"
provides:
  - "src/app/(app)/settings/team/: the Team page, five server actions, member rows, Deactivate dialog, Invite dialog, pending invitation list, shared copy module"
  - "SettingsNav entries Team and Notifications after Backups (amendment A2)"
affects: [10-11, 10-13, 10-14]
tech-stack:
  added: []
  patterns:
    - "Server action: input shape check, one getSessionActor read, one src/lib/workspace-members service, service error code mapped to one Copywriting key, revalidatePath only after a change"
    - "Dialogs that can outlive their row (Deactivate, Revoke) live in the card component, keyed per opening, so revalidation that removes the row keeps their state"
key-files:
  created:
    - src/app/(app)/settings/team/page.tsx
    - src/app/(app)/settings/team/actions.ts
    - src/app/(app)/settings/team/team-member-row.tsx
    - src/app/(app)/settings/team/deactivate-dialog.tsx
    - src/app/(app)/settings/team/invite-dialog.tsx
    - src/app/(app)/settings/team/pending-invitation-list.tsx
    - src/app/(app)/settings/team/team-copy.ts
  modified:
    - src/app/(app)/settings/settings-nav.tsx
    - tests/e2e/single-h1.spec.ts
decisions:
  - "The Team page takes the actor's role from listMembers (owner only when every row is owner, admin only when every row is owner or admin, V-26), not from the deciding row of requirePageAccess"
  - "Server actions return a closed Copywriting key and the client renders the text; a 'use server' module may export only async functions, so the copy lives in team-copy.ts"
  - "INVITE_CONFIG and unexpected errors map to the 'Invite error: unknown' row (the contract has no config row); Deactivate NOT_ALLOWED and other codes map to 'Deactivate error: unknown' as the plan says"
  - "A reassignment refusal or an error before the first batch counts every open ticket still assigned to the removed member as failed (countOpenAssignedTickets), so Try again can retry them"
metrics:
  duration: "about 11 minutes of wall clock between the first edit and the last commit (2026-11-12T23:48Z to 23:59Z)"
  completed: 2026-11-13
  tasks: 3
  files: 9
estimate:
  tokens: 70000
  tasks: 3
actuals:
  tokens: 14700
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 2f92a6bafbef281bfe517531266579f6f979adba
---

# Phase 10 Plan 10: Settings → Team UI Summary

Settings → Team is built on the locked 10-03 and 10-05 services. Every member sees the member list. Owners and admins can change roles and deactivate members, with an optional reassignment step after the commit that reports counts and can be retried. They can also invite by email and role, with a copy-link fallback when the email is not sent, and revoke pending invitations. Each server action reads the session once and the service makes every permission decision.

## What was built

- **Nav (amendment A2):** `SettingsNav` gains `Team` (`/settings/team`) and `Notifications` (`/settings/notifications`) after Backups. The Notifications page belongs to a later plan, so the link has no page until that plan lands.
- **`page.tsx`:** the first statement is `await requirePageAccess()`, outside any try. It loads `listMembers(orgId)`. The actor's role comes from the actor's own list entry (the conservative read, V-26). For owners and admins only, it also loads `countOpenAssignedTickets` per member except the actor, plus `listPendingInvitations`. The pending meta line ("{Role} · invited by {name} · expires in N days") is built on the server. Layout: header (h1 18px, 13px muted subtitle, `Invite member` for owners and admins), then the Members card, then the Pending invitations card (owners and admins only).
- **`actions.ts`** (`"use server"`, five actions, one `getSessionActor` read each, nothing logged):
  - `changeRoleAction(targetUserId, newRole)` calls `changeMemberRole`. LAST_OWNER maps to last_owner; NOT_ALLOWED and SELF_CHANGE map to not_allowed; everything else maps to unknown.
  - `deactivateMemberAction(targetUserId, reassignToUserId | null)` calls `deactivateMember`. Only with a reassignee does it then call `reassignOpenTickets` with the same actor. It returns `{ ok, reassigned, skipped, failed }`. LAST_OWNER maps to last_owner, everything else to unknown.
  - `reassignTicketsAction(fromUserId, toUserId)` calls `reassignOpenTickets` (the A7 retry).
  - `inviteMemberAction(email, role)` calls `createInvitation`. It returns the link only for smtp_off and send_failed. Error mapping: INVALID_EMAIL, ALREADY_MEMBER, PENDING_EXISTS, ROLE_ABOVE_OWN and NOT_ALLOWED each have their own row; INVITE_CONFIG, INVALID_ROLE and thrown errors all map to unknown.
  - `revokeInvitationAction(invitationId)` calls `revokeInvitation`.
  - A refusal is returned, never thrown, and the page is revalidated only after a change.
- **`team-member-row.tsx`:**
  - `TeamMembersCard`: h2 with `tabIndex -1`, "1 person" / "{N} people", the admin-only notice for members, and a role=alert destructive callout for role errors at the top of the card that clears on the next change. It also holds the Deactivate dialog.
  - `TeamMemberRow`: Avatar size-8 with initials. A member with no display name shows the email as the name line, with initials from the email. Name 13px/600 truncates, email 12px muted, plus the "You" outline badge.
  - Role control per the "Who may do what" table: a Select `h-8 w-[120px] text-[13px]` with aria-label "Role for {name}" and options capped by the actor; otherwise a secondary Badge, with the focusable owner tooltip when the actor is an admin. The ghost "Deactivate member" (UserMinus, text-destructive) appears only where the table allows.
  - A pending role change disables the Select and shows the new value. Success shows the toast "{Name} is now {role}."; failure reverts the Select and shows the callout.
  - Under 640px the identity block takes the full width, so the controls wrap below it.
- **`deactivate-dialog.tsx`:**
  - Shows the title and description from the contract. When N > 0 it adds "{Name} has {N} open tickets assigned." and the "Reassign their open tickets to" Select, which defaults to "Keep them assigned" and lists every other member.
  - Buttons: "Keep member" and "Deactivate member", with the spinner and "Deactivating…" while pending. A refusal shows a 13px text-destructive role=alert line above the footer and keeps the dialog open.
  - Success closes the dialog, shows the toast (with the A7 skipped sentence when M > 0) and moves focus to the Members h2.
  - When tickets failed (A7), the dialog stays open with the warning callout "{Name} was removed. {K} open tickets could not be reassigned." and a "Try again" button that calls `reassignTicketsAction`.
- **`invite-dialog.tsx`:**
  - Email field (type email, autoComplete off, required, noValidate form with a client shape check). The role Select defaults to Member, its options are capped by the actor, and its 12px help text is linked through aria-describedby.
  - Buttons: "Close without sending" and "Send invitation", with the spinner and "Sending…" while sending; both fields are disabled while sending. Errors show as one role=alert destructive callout.
  - `sent`: closes and shows the toast "Invitation sent to {email}.".
  - smtp_off and send_failed: the warning callout with the matching notice (wrap-anywhere), a read-only link Input (`font-mono text-[12px]`, aria-label "Invitation link", selected on focus), and "Copy link" that turns into "Copied" with Check for 2 s (aria-live polite). The footer shows "Return to team". The link lives only in component state, and every close resets the form, the error and the link.
- **`pending-invitation-list.tsx`:** the "Pending invitations" card. With no invitations it shows the line "No pending invitations.". Each row shows the email (13px/600, truncate), the meta line (12px muted, truncate) and a ghost "Revoke invitation" (X). The Revoke dialog shows the contract title and description, "Keep invitation", "Revoke invitation" with "Revoking…", and on failure the revoke error as role=alert while staying open. Success shows the toast "Invitation revoked." and moves focus to the card h2.
- **`team-copy.ts`:** every Copywriting row of Surface 1 verbatim, plus the A7 sentences.

## UI-SPEC amendments

- **A2:** Team and Notifications follow Backups (UI-SPEC said "after Email", the last item on 2026-11-08).
- **A7 (new copy):** the toast suffix "{M} tickets were left as they are because someone changed them first."; the warning callout "{Name} was removed. {K} open tickets could not be reassigned."; the button "Try again". In the retry state the dialog shows its close button (the shadcn X) in place of the footer, because "Keep member" no longer applies.

## Verification

| Command | Exit | Result |
|---------|------|--------|
| `pnpm typecheck` (Task 1, 2, 3, and after the last fix) | 0 | clean |
| `pnpm lint` (final) | 0 | 742 files, 0 errors, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`) |
| `pnpm test tests/unit/membership-inventory.test.ts tests/unit/page-access-inventory.test.ts` (final; the `test` script's `tests/unit` filter runs the whole unit suite) | 0 | 108 files, 1930 tests passed |
| Task 2 `pnpm test tests/unit/membership-inventory.test.ts` | 0 | 108 files, 1930 tests passed |
| First Task 1 unit run | 1 | 1 failure: `tests/unit/single-h1-route-list.test.ts` (new page not listed in the E2E route list); fixed, see Deviations |
| Task 1 lint, first run | 1 | biome format on `team-member-row.tsx`; formatted |
| Task 3 lint, first run | 1 | import order in `actions.ts`; fixed with `biome check --write` on that file |

Acceptance greps:
- `/settings/team\|/settings/notifications` in settings-nav: 2, after Backups.
- `requirePageAccess` in page.tsx: 2.
- `text-(xs|sm|base|lg|xl)` under `src/app/(app)/settings/team`: none.
- `oklch(` / hex: none. `<script` / `dangerouslySetInnerHTML`: none. `p-3`, `gap-1.5`, `2.5`: none.
- `console.(log|info|warn|error)` in actions.ts and invite-dialog.tsx: 0 and 0.
- `createInvitation` in actions.ts: 5. `reassignOpenTickets` in actions.ts: 4.
- `getSessionActor` in actions.ts: 6 lines, which is the 5 exported actions plus the import line. Each action makes exactly one call.
- "Keep them assigned": 1 in deactivate-dialog.tsx (a comment) and 1 in team-copy.ts (the copy). "Return to team": 0 in invite-dialog.tsx and 1 in team-copy.ts. See Deviations 2.

Not run: `pnpm test:integration` and `pnpm test:e2e`. The plan runs neither; the browser proof is plan 10-13. Docker was not used, `.next` was not moved, and no Colima or Docker check was needed.

## DESIGN-SYSTEM §9

| Item | Status |
|------|--------|
| Tokens only, no hardcoded colours | checked by code (grep: no oklch or hex; destructive, warning, primary and muted tokens only) |
| Empty state halo + icon box | not applicable: "No pending invitations." is a line per UI-SPEC, not an EmptyState |
| Sidebar `sidebar-*` tokens | not touched |
| Top bar sticky + backdrop-blur | not touched |
| Auth page not self-wrapped | not applicable (no auth page in this plan) |
| Explicit `text-[Npx]` | checked by code (grep clean; shadcn internals overridden with `text-[13px]` or `text-[12px]` on Select items, Badges, buttons, dialog titles and descriptions) |
| Dark mode | **open, manual** |
| `tsc --noEmit` clean | checked (exit 0) |

## Open manual items (never recorded as passed)

- Visual approval of the Team page, Invite dialog, Deactivate dialog and Revoke dialog.
- Dark mode review of the same surfaces (DS §7, §8 rule 8).
- 360px backstops:
  - a 255-character member name and email truncate with the role control visible and no horizontal scroll;
  - a 254-character email and the full link fit the Invite dialog (the email wraps, the link Input scrolls, Copy link stays visible);
  - a 254-character invited email and a long inviter name truncate in the pending row with Revoke visible;
  - the Invite dialog fits with its footer visible.
- Backstops for the browser proof (10-13):
  - with a valid email and a role, Send invitation is enabled and the success view uses the contract copy;
  - one email per submit, and a second invite starts empty;
  - a pending invitation whose inviter was deactivated lists with "a former member" and stays revocable (`FORMER_MEMBER_LABEL` of 10-05).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The single-h1 route-list unit test pins the E2E route list to the pages on disk**
- **Found during:** Task 1
- **Issue:** `tests/unit/single-h1-route-list.test.ts` (Phase 9 c-WR-03) compares `APP_PAGE_ROUTES` in `tests/e2e/single-h1.spec.ts` with every `page.tsx` under `src/app/(app)`. The new page failed it, and the plan's unit command runs it.
- **Fix:** `/settings/team` was added to `APP_PAGE_ROUTES`, with three rendered cases: owner `h1 "Team"`, member read-only `h1 "Team"`, and the ended session going to /no-access. This keeps the spec's completeness check true. Plan 10-13 extends the same file with `/settings/notifications`.
- **Files modified:** `tests/e2e/single-h1.spec.ts`
- **Commit:** 934cf9e
- **Not run:** the E2E spec itself (no E2E in this plan).

**2. [Rule 3 - Blocking] The copy lives in one shared module**
- **Issue:** a `"use server"` module may export only async functions, so the actions cannot export copy. The page, the four client components and the actions need the same strings and keys.
- **Fix:** a new file `src/app/(app)/settings/team/team-copy.ts`, not in `files_modified`. Because of it, two acceptance greps count differently: "Return to team" prints 0 in invite-dialog.tsx (the string is in team-copy.ts, which the dialog imports), and "Keep them assigned" prints 1 in deactivate-dialog.tsx only because of a comment. The copy itself is in team-copy.ts.
- **Commit:** 934cf9e and later

**3. [Plan wording] `getSessionActor` count**
- The acceptance asks for a count equal to the number of exported actions. `grep -c` counts the import line too, so it prints 6 for 5 actions. Each action makes exactly one call, and the membership inventory (Rule A, Rule C2) passes.

### Notes

- A user whose rows mix `owner` and `admin` is listed as `admin` (the conservative role). An admin actor therefore sees a Select for that user, and the service refuses the change (NOT_ALLOWED, V-26 (3)), which shows "Role error: not allowed". `listMembers` does not expose "has any owner row", and this plan changes no service.
- The role-changed toast uses the lower-case role ("is now admin."), following the contract's lower-case `{role}` placeholder. The pending meta line uses the capitalised `{Role}`.

## Threat model

- **T-10-39:** role options are capped in the UI for convenience only. `changeMemberRole`, `createInvitation` and `revokeInvitation` re-check under the lock.
- **T-10-40:** the link is returned only for smtp_off and send_failed. It is held in InviteDialog state and dropped on close, and nothing in the team folder logs.
- **T-10-41:** the actor comes only from `getSessionActor`, read once per action.
- **T-10-42:** reassignment goes through `reassignOpenTickets` with `onlyIfAssignedTo`, and the skipped count is shown (A7).

No new surface beyond the threat model.

## Known Stubs

None. The Notifications nav link points to a page that a later Phase 10 plan creates. That is a planned dependency, not a stub in this plan's files.

## Self-Check: PASSED

- All seven files under `src/app/(app)/settings/team/` exist; `settings-nav.tsx` and `single-h1.spec.ts` were modified.
- Commits 934cf9e, 1d01025 and 6e698f0 exist on `v2/run-loop`. `git rev-list --count 2f92a6b..HEAD` = 3 before this SUMMARY.
