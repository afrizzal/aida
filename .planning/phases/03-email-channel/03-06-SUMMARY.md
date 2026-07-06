---
phase: 03-email-channel
plan: 06
subsystem: ui
tags: [settings, react-hook-form, zod, imap, smtp, server-actions, nextjs]

# Dependency graph
requires:
  - phase: 03-email-channel (plan 02)
    provides: "getEmailSettings/saveEmailSettings/EmailSettings over the 14 email:* Setting keys, AES-256-GCM secret-box encryption, blank-password-keeps-existing save semantics"
  - phase: 03-email-channel (plan 04)
    provides: "createImapClient (ImapFlow factory with configurable connect timeout)"
  - phase: 03-email-channel (plan 05)
    provides: "createSmtpTransport (nodemailer factory with configurable connection/greeting/socket timeouts)"
provides:
  - "Settings -> Email tab (/settings/email): enable/disable Switch, IMAP/SMTP/from-address form, per-section real Test Connection buttons, inbound-poll health line"
  - "Four admin-gated Server Actions: saveEmailSettings, setEmailChannelEnabled, testImapConnection, testSmtpConnection"
  - "AIDA-09 configuration surface (Success Criterion 3: config in Settings, failures surfaced not silent)"
affects: [phase-04-ai-provider-settings, phase-07-branding-settings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reusable TestConnectionButton (idle/testing/success/failure) composed from Button + Loader2/CheckCircle2/XCircle, one instance per connection kind"
    - "Admin-gated Server Actions, not a page-level route guard (mirrors sla/tags/custom-fields precedent)"

key-files:
  created:
    - src/app/(app)/settings/email/actions.ts
    - src/app/(app)/settings/email/page.tsx
    - src/app/(app)/settings/email/email-channel-toggle.tsx
    - src/app/(app)/settings/email/email-health-line.tsx
    - src/app/(app)/settings/email/email-settings-form.tsx
    - src/app/(app)/settings/email/test-connection-button.tsx
  modified:
    - src/app/(app)/settings/settings-nav.tsx

key-decisions:
  - "Blank password on save/test means 'keep the existing stored value' (plan 02 contract) — the form never round-trips a decrypted password into the UI; Test Connection falls back to the stored decrypted password via getEmailSettings() when the submitted field is blank."
  - "Test Connection actions use an explicit 10s timeout probe (createImapClient/createSmtpTransport's timeoutMs option) so a misconfigured host fails fast — never a stuck spinner."
  - "Authorization is admin-gated Server Actions, not a page-level guard — confirmed the 03-UI-SPEC Assumption 1 reading (page renders for any authenticated org member; every mutating action calls requireOrgAdmin() first), matching the existing SLA/Tags/Custom-Fields precedent exactly."

patterns-established:
  - "TestConnectionButton: reusable idle/testing/success/failure component, parameterized by kind (imap|smtp) + a getValues() callback into the live form state"

requirements-completed: [AIDA-09]

# Metrics
duration: 6min
completed: 2026-07-06
---

# Phase 3 Plan 06: Settings Email Tab Summary

**Admin-gated Settings -> Email tab shipped: enable/disable toggle, IMAP/SMTP/from-address form with real 10s-timeout Test Connection buttons per section, and an inbound-poll health line surfacing lastPollAt/lastPollError — the last piece needed to close out AIDA-09.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-06T04:23:32Z
- **Completed:** 2026-07-06T04:29:38Z
- **Tasks:** 3
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments
- Four admin-gated Server Actions (`saveEmailSettings`, `setEmailChannelEnabled`, `testImapConnection`, `testSmtpConnection`) — every one calls `requireOrgAdmin()` first (SECURITY.md).
- Real, fast-failing Test Connection for both IMAP (`createImapClient(...).connect()`) and SMTP (`createSmtpTransport(...).verify()`), both with a 10s timeout and a stored-password fallback when the form field is blank.
- Settings nav gained the "Email" tab entry; the new page loads `getEmailSettings`, renders the channel toggle, the IMAP/SMTP/from-address form, and the poll-health line — all token-only per DESIGN-SYSTEM.md and 03-UI-SPEC.md.
- Channel toggle (`EmailChannelToggle`) mirrors `AiToggle`'s optimistic-update/revert-on-failure shape exactly; health line (`EmailHealthLine`) covers all three D-25 states (failing/healthy-ever-polled/healthy-never-polled).

## Task Commits

Each task was committed atomically:

1. **Task 1: Admin-gated Server Actions + Email nav entry** - `3724e7e` (feat)
2. **Task 2: Email page shell + channel toggle + health line** - `d4ab3dc` (feat)
3. **Task 3: Email settings form + reusable Test Connection button** - `97f6c7a` (feat)

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified
- `src/app/(app)/settings/email/actions.ts` - Four `requireOrgAdmin`-gated Server Actions (save/toggle/test-imap/test-smtp)
- `src/app/(app)/settings/email/page.tsx` - Server page (`force-dynamic`), loads `getEmailSettings`, renders toggle/form, never passes decrypted passwords to the client
- `src/app/(app)/settings/email/email-channel-toggle.tsx` - `AiToggle`-shaped Switch + optimistic update/revert
- `src/app/(app)/settings/email/email-health-line.tsx` - Three-state inbound-poll health presentational component
- `src/app/(app)/settings/email/email-settings-form.tsx` - react-hook-form + zod IMAP/SMTP/from-address form, single bottom Save submit
- `src/app/(app)/settings/email/test-connection-button.tsx` - Reusable idle/testing/success/failure Test Connection button
- `src/app/(app)/settings/settings-nav.tsx` - Added `{ href: "/settings/email", label: "Email" }` to `navItems`

## Decisions Made
- Blank-password "keep existing" UX contract (see key-decisions above) — Test Connection falls back to the stored decrypted password via `getEmailSettings(db)` when the submitted field is blank, so an admin can verify a previously-saved credential without re-typing it.
- Test Connection uses a 10s timeout probe end-to-end (both `createImapClient`'s `greetingTimeout` and `createSmtpTransport`'s `connectionTimeout`/`greetingTimeout`/`socketTimeout`, all passed `{ timeoutMs: 10000 }` from the action).
- Admin-gated-actions (not page-guard) authorization — confirmed per 03-UI-SPEC Assumption 1: the page itself has no `requireOrgAdmin()` call; only the four mutating Server Actions do, matching every other Settings surface in the codebase.

## Deviations from Plan

None - plan executed exactly as written. Task 2's `page.tsx` imports `EmailSettingsForm` (a Task 3 file); both tasks' files were authored before running the shared `tsc --noEmit`/`biome check` verification pass so each task's automated checks reflect the final, cross-referencing state — this is a natural consequence of the plan's own task decomposition (page shell in Task 2, the form it renders in Task 3), not a deviation from what was specified.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. (An admin still needs to configure real IMAP/SMTP credentials via the UI to activate the channel, but that's the feature this plan ships, not a setup step.)

## Next Phase Readiness

- AIDA-09 (email intake + outbound SMTP replies) is now fully code-complete end-to-end: inbound poll/ingest (03-04), outbound send (03-05), credential encryption + settings module (03-02), and this plan's configuration UI. Ready to mark AIDA-09 complete in REQUIREMENTS.md/PROJECT.md at phase sign-off.
- Phase 3 (email-channel) is now 6/6 plans complete — ready for phase-level verify-work/UI-review/human sign-off per LOOP-ENGINEERING.md.
- No blockers for Phase 4 (AI provider settings) — this plan's `secret-box` encryption reuse and Settings-tab pattern are directly reusable there.

---
*Phase: 03-email-channel*
*Completed: 2026-07-06*

## Self-Check: PASSED

All 7 created/modified files confirmed present on disk; all 3 task commit hashes (`3724e7e`, `d4ab3dc`, `97f6c7a`) confirmed present in git log.
