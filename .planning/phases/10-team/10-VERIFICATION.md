---
phase: 10-team
verified: 2026-11-13T15:00:00Z
status: human_needed
score: 5/5 success criteria verified
covered_files: [".planning/REQUIREMENTS.md", ".planning/phases/10-team/10-01-PLAN.md", ".planning/phases/10-team/10-01-SUMMARY.md", ".planning/phases/10-team/10-02-PLAN.md", ".planning/phases/10-team/10-02-SUMMARY.md", ".planning/phases/10-team/10-03-PLAN.md", ".planning/phases/10-team/10-03-SUMMARY.md", ".planning/phases/10-team/10-04-PLAN.md", ".planning/phases/10-team/10-04-SUMMARY.md", ".planning/phases/10-team/10-05-PLAN.md", ".planning/phases/10-team/10-05-SUMMARY.md", ".planning/phases/10-team/10-06-PLAN.md", ".planning/phases/10-team/10-06-SUMMARY.md", ".planning/phases/10-team/10-07-PLAN.md", ".planning/phases/10-team/10-07-SUMMARY.md", ".planning/phases/10-team/10-08-PLAN.md", ".planning/phases/10-team/10-08-SUMMARY.md", ".planning/phases/10-team/10-09-PLAN.md", ".planning/phases/10-team/10-09-SUMMARY.md", ".planning/phases/10-team/10-10-PLAN.md", ".planning/phases/10-team/10-10-SUMMARY.md", ".planning/phases/10-team/10-11-PLAN.md", ".planning/phases/10-team/10-11-SUMMARY.md", ".planning/phases/10-team/10-12-PLAN.md", ".planning/phases/10-team/10-12-SUMMARY.md", ".planning/phases/10-team/10-13-PLAN.md", ".planning/phases/10-team/10-13-SUMMARY.md", ".planning/phases/10-team/10-14-PLAN.md", ".planning/phases/10-team/10-14-SUMMARY.md", ".planning/phases/10-team/10-15-PLAN.md", ".planning/phases/10-team/10-15-SUMMARY.md", ".planning/phases/10-team/10-16-PLAN.md", ".planning/phases/10-team/10-16-SUMMARY.md", ".planning/phases/10-team/10-17-PLAN.md", ".planning/phases/10-team/10-17-SUMMARY.md", "src/app/api/members/mentionable/route.ts", "src/app/api/notifications/route.ts", "src/app/api/tickets/[id]/messages/route.ts", "src/components/notification-bell.tsx", "src/lib/membership.ts", "src/lib/mentions/mentions.ts", "src/lib/notifications/digest.ts", "src/lib/notifications/emit.ts", "src/lib/page-access.ts", "src/lib/session.ts", "src/lib/worker/jobs/notification-digest.ts", "src/lib/worker/jobs/sla-flag.ts", "src/lib/workspace-members/invitations.ts", "src/lib/workspace-members/member-admin.ts"]
covered_digest: "v1:sha256:99a4369f3593bb24c654bd38b30a2e5f64ea722d8134235973efb162ac667502"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Send an invitation and a digest through a real mail server and read both in a real mailbox and mail client"
    expected: "Invitation link joins with the invited role; digest arrives as one email with the constant subject and no customer data in it"
    why_human: "Roadmap 'stays open for a human'; only a fake SMTP is exercised by tests"
  - test: "Visual approval and dark-mode review (DS section 7) of Settings > Team and its dialogs, /invite/[token] in every state, the bell, the mention autocomplete and span, Settings > Notifications, /no-access, plus the F1 to F7 surfaces (A10 hold note, A11 sentence, K161 refusal states)"
    expected: "Token-only styling readable in both themes; contrast of count pill, unread dot and mention text acceptable"
    why_human: "Visual judgement; design checklist item 7 is open in both gate runs"
  - test: "360px backstops (10-08, 10-10, 10-11) and the 50-mention layout backstop (10-07)"
    expected: "No horizontal scroll; long names and emails wrap; controls stay visible"
    why_human: "Layout at a narrow viewport is not asserted by any test"
  - test: "Screen-reader pass over /no-access, the invitation card, the Team page and dialogs, the bell, the autocomplete combobox and the preference switches"
    expected: "Each control announced with a name and state; one h1 per page"
    why_human: "Assistive-technology behaviour"
  - test: "Sign out from /no-access in a real browser (10-02)"
    expected: "Session ends and the login page shows"
    why_human: "Deferred manual check of 10-02"
---

# Phase 10: Team Verification Report

**Phase Goal:** A workspace can grow past one person, and its members hear about what concerns them.
**Verified:** 2026-11-13 at HEAD `8546b09`
**Status:** human_needed
**Re-verification:** No (initial verification)

No product or test file changed between the gate rerun commit `b96263d` and HEAD (`git diff --name-only b96263d HEAD` lists only `STATE.md`, `10-GATE.md` and three `.planning/run-loop/` files), so the gate rerun's Docker, integration, E2E and build results apply to the verified tree.

## Goal Achievement

### Observable Truths (roadmap success criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | An admin invites a person, who joins with the invited role; expired and mismatched invitations fail | VERIFIED | `src/lib/workspace-members/invitations.ts`: role ceiling `ROLE_ABOVE_OWN` (:188), accept refuses `not-pending` (:475), `expired` (:468, :476), `email-mismatch` (:485), then sets `accepted` under the pending guard (:495-496). Tests: `tests/integration/invitations.test.ts` (:290 role ceiling, :483 reused/revoked/expired/unknown fail identically, :547 expiry edge, :1272 SMTP off returns link); E2E `team-invitations.spec.ts` (:167 tracer joins as Member, :213 fake SMTP, :520 expired, :543 mismatch, :609 org isolation, :736 link works once). Gate rerun: integration 135/135 files, E2E team-invitations 17/17 |
| 2 | An admin can change roles and deactivate members; an already-open session of a deactivated member is refused on its next request; the last admin cannot be removed, even concurrently | VERIFIED (O-10 reading) | `member-admin.ts`: `changeMemberRole` (:251) and `deactivateMember` (:409) each lock the organization first (`lockOrganization`, :262, :419), owner floor `LAST_OWNER` (:121), sessions set to no workspace (:442-444, K178), pending invitations canceled (:185-187). Gate on every request: `src/lib/session.ts` `getScopedDb` re-reads member rows (`findConservativeMembership`) after an uncached session read; `page-access.ts:29` for pages; `getSessionActor` callers delegate to services that re-check, enforced by `tests/unit/membership-inventory.test.ts`; attachments route maps the refusal to 404. Tests: `team-member-admin.test.ts:865-` (owners deactivating/demoting each other under forced lock order, one owner remains), `deactivation-race.test.ts`, `membership-gate.test.ts`; E2E `team-deactivation.spec.ts:97` (open session lands on /no-access on six pages, action changes nothing, API 403, attachment 404) and :423 (two stale owner tabs). Reading of "last admin" is the O-10 owner default (owner floor) |
| 3 | Assignment, customer reply, mention and SLA events produce per-user notifications in the top bar | VERIFIED | Producers: assignment `src/lib/tickets/mutations.ts:449`; customer reply `src/lib/channels/email/ingest-message.ts:240` and `src/app/api/public/status/[token]/follow-up/route.ts:148`; mention `src/lib/mentions/mentions.ts:188`; SLA `src/lib/worker/jobs/sla-flag.ts:260`. Bell rendered in `src/components/top-bar.tsx:68`; `/api/notifications` behind `getScopedDb`. Tests: `sla-flag-handler.test.ts:292`, `:314`, `:335`, `:492`; `notifications-core.test.ts:342` (another member's or organization's id refused); `notifications-privacy.test.ts`; E2E `notifications-bell.spec.ts` (:126 assignment with read/archive persisting, :194 customer reply and unassigned fallback) and `mentions-leak.spec.ts:128` (mention in the bell) |
| 4 | A mention in an internal note notifies the member and cannot reach the customer | VERIFIED | `parseMentionField` refuses ids unless mode is internal (`mentions.ts:71`); the messages route resolves members only for internal mode, inside the transaction, and records only names the sanitized renderer wrapped (`src/app/api/tickets/[id]/messages/route.ts:171-205`); `/api/members/mentionable` behind `getScopedDb`. Tests: `mentionable-route.test.ts` (members of the active org only, caller/removed/other-org absent); E2E `mentions-leak.spec.ts` (:207 HTTP public reply with mentions is 400, :242 and :290 toggle strips names, :317 status page, :344 outgoing SMTP carries no member data), 7/7 in the rerun |
| 5 | Preferences apply, and the digest sends one batched email through a fake SMTP with no PII in the subject | VERIFIED | Constant subject `DIGEST_EMAIL_SUBJECT = "Your AIDA updates"` (`digest.ts:84`, used at :408); job registered by `registerNotificationDigest`, called from `src/lib/worker/index.ts:179`. Tests: `notification-digest.test.ts` (:222 exactly one message with the constant subject, :356 one email per recipient under concurrency, :389 retry without duplicate, :906/:982 a digest-off type is left out), `notification-digest-job.test.ts:137` (real PgBoss, one digest at the fake SMTP); `notifications-core.test.ts:755` and E2E `notifications-bell.spec.ts:255` for in-app preferences |

**Score:** 5/5 truths verified (0 present but behavior-unverified)

### Requirements Coverage

| Requirement | Status | Evidence | Stays open |
| --- | --- | --- | --- |
| AIDA-42 | SATISFIED (code) | SC1 evidence; README correction D-26 applied | real-email test, visual, dark mode, 360px, screen reader (human); V-23 accepted written limit |
| AIDA-43 | SATISFIED (code, O-10 reading) | SC2 evidence; audit rows via `member-audit.ts`; notifications and digests stop (recipient and digest re-read the member row) | O-10 (owner); visual and screen reader (human); K184 written bound |
| AIDA-44 | SATISFIED (code) | SC3 evidence; unmocked isolation tests in `notifications-core` and `notifications-privacy` | O-7 (owner default: new ticket and former-member assignee notify nobody); O-9 (owner keeps REQUIREMENTS.md); visual (human) |
| AIDA-45 | SATISFIED (code) | SC4 evidence; 45.1 now direct (`mentionable-route.test.ts`) | visual, dark mode, 50-mention layout, screen reader (human); AI-draft path proven in the reducer only (no paid LLM) |
| AIDA-46 | SATISFIED (code) | SC5 evidence; sent-after-acceptance, release on failure, retention (F3, F6, F7) | real-email digest (human); egress flow 7 blocked (rule J space); K184 and K187 written bounds |

No orphaned requirement: REQUIREMENTS.md maps exactly AIDA-42 to AIDA-46 to Phase 10. None is closed here (closing stays with the orchestrator and owner, O-9).

### Behavioral Spot-Checks and Commands

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm typecheck` (this verification, HEAD) | 0 | no `tsc` output |
| `pnpm lint` (this verification, HEAD) | 0 | 774 files, 0 errors, 1 warning (`tests/unit/container-config.test.ts:160`, the old known one) |
| `pnpm test` (this verification, HEAD) | 0 | 116/116 files, 2153/2153 tests |
| `pnpm test:integration` (gate rerun, `b96263d`) | 0 | 135/135 files, 1891 tests (recorded, not rerun) |
| `pnpm test:e2e` run 2 (gate rerun) | 0 | 296 passed, 1 skipped; run 1 failed in global setup (next-o1, owner) |
| `pnpm build` (gate rerun) | 0 | known 5 tracing warnings |
| `pnpm test:egress` (gate rerun) | 1 | BLOCKED (rule J: Docker VM 13.2 GiB free, 20 GiB required); not a pass |
| `pnpm audit --prod` (gate rerun) | 1 | 48 (10 high), AIDA-25 / 08-o3, not a Phase 10 deliverable |

### Probe Execution

No probe declared by the phase plans. SKIPPED.

### Anti-Patterns Found

`TBD`, `FIXME`, `XXX` over the Phase 10 modules (workspace-members, notifications, mentions, membership gate, team and notification settings, invite and no-access pages, bell, mentionable and notifications routes, digest job): none. No `TODO` or placeholder text in those modules. The informational items in `deferred-items.md` are follow-ups outside each fix batch's scope, not missing deliverables.

### Owner Items and Accepted Limits (not code gaps)

- Owner: O-7, O-9, O-10, 08-o4 (`docs/SECURITY.md` untouched), plus O-4, O-5, O-8 defaults; Docker VM space (rule J); next-o1 (E2E global-setup stall); 08-o3 audit.
- Accepted written limits for v1: V-23 (stale tab after accepting another workspace's invitation), K184 and K187 (digest after a removal or changed choice), documented in `docs/OPERATIONS.md`.

### Human Verification Required

1. **Real email** — send an invitation and a digest through a real mail server; check the link joins and the digest's look in a mail client.
2. **Visual and dark mode** — every new surface listed in the frontmatter, design checklist item 7.
3. **360px and 50-mention layout** backstops.
4. **Screen reader** — /no-access, invitation card, Team page and dialogs, bell, autocomplete, preference switches.
5. **Sign out from /no-access** in a real browser.

No result for any of these is recorded here.

### Gaps Summary

No code gap. All five success criteria hold in the code and in tests that ran (unit at HEAD; integration and E2E at the gate rerun, with no product change since). The phase stays `human_needed` for the human checks above; egress is blocked, owner items and written limits are listed as such.

Notes for the orchestrator: `ROADMAP.md` line 35 still says "code review next" for Phase 10, although review, fixes and the gate rerun are done. `STATE.md` front matter is current (stopped at "step 9 verifier next").

---

_Verified: 2026-11-13_
_Verifier: Claude (gsd-verifier)_
