# Phase 3 — UI Review

**Audited:** 2026-07-06
**Baseline:** `.planning/phases/03-email-channel/03-UI-SPEC.md` (approved 2026-07-06)
**Screenshots:** captured (auth-gated — dev server on `localhost:3000` redirected every route, including `/settings/email`, to `/api/auth/signin`; captured screens show only the sign-in page at desktop/mobile/tablet viewports, saved to `.planning/ui-reviews/03-20260706-122013/`). No seeded/demo credentials were available in this environment to reach the authenticated Settings surface, so this audit is evidence-based on source code against the approved UI-SPEC contract, which is itself the literal audit method for every pillar below.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Every string (toasts, button labels, health-line states, chip copy) matches the UI-SPEC Copywriting Contract verbatim |
| 2. Visuals | 4/4 | Save button is the sole accent focal point exactly as specified; every icon is paired with adjacent text, no icon-only controls |
| 3. Color | 4/4 | Zero `bg-primary`/`text-primary` usage inside the email settings surface itself (accent correctly reserved to Save + nav pill); destructive/success used only where declared |
| 4. Typography | 4/4 | Exactly 4 sizes (12/13/14/18px) and 3 weights (400/500/600) used — matches the UI-SPEC table with zero drift, no named Tailwind sizes |
| 5. Spacing | 4/4 | All spacing classes fall inside the declared scale plus the pre-approved exceptions list (`gap-1.5`, `mt-1.5`, `py-0.5`) — no arbitrary bracket values |
| 6. Experience Design | 3/4 | `retryOutboundSend` (and its client caller) is the one action in this phase with no try/catch or failure feedback — risk of a stuck "Retrying…" state |

**Overall: 23/24**

---

## Top 3 Priority Fixes

1. **`retryOutboundSend` has no error handling, unlike every sibling email Server Action** — if `boss.send(...)` or `db.message.update(...)` throws (queue/DB transient failure), the Server Action's promise rejects uncaught; `DeliveryFailedChip.handleRetry()` (`src/components/tickets/delivery-failed-chip.tsx:19-23`) does `await retryOutboundSend(messageId); router.refresh();` with no try/catch and no check of the `{ ok }` result, so the local `retrying` state (set `true` at the top of `handleRetry`) never resets — the "Retrying…" text is stuck indefinitely with no visible error and no way to retry again short of a full page reload. Every other action added this phase (`saveEmailSettings`, `setEmailChannelEnabled`, `testImapConnection`, `testSmtpConnection` in `src/app/(app)/settings/email/actions.ts`) wraps its work in try/catch and returns `{ ok: false }`, and their callers all show a `toast.error(...)` on failure — `retryOutboundSend` (`src/app/(app)/tickets/[id]/actions.ts:79-92`) is the outlier. **Fix:** wrap the update+enqueue in try/catch returning `{ ok: false }` on failure; have `handleRetry` check the result (or catch a thrown error), reset `retrying` to `false`, and show a `toast.error("Failed to retry send. Please try again.")` on failure — mirroring `EmailChannelToggle`'s revert-on-failure pattern exactly.

2. **Test Connection buttons probe the network before form validation runs** — `TestConnectionButton.handleClick()` (`src/app/(app)/settings/email/test-connection-button.tsx:24-35`) calls `getValues()` directly (raw `form.getValues()`, not `form.trigger()`/`handleSubmit`), bypassing the zod schema's `"Required"` messages entirely. Clicking "Test IMAP connection" with a blank Host/Port surfaces whatever raw driver error `ImapFlow`/`nodemailer` throws (e.g. `getaddrinfo ENOTFOUND undefined`) instead of the friendly validation copy the form already defines. **Fix:** call `const valid = await form.trigger(["imapHost","imapPort","imapUser"])` (or the SMTP equivalent) before invoking the test action, and short-circuit with the existing `FormMessage` errors if invalid.

3. **Test Connection result panel has no `aria-live` region** — the success/failure block that appears below the button (`test-connection-button.tsx:58-70`) is a plain conditionally-rendered `<div>`; a screen-reader user who has already moved focus away after clicking will not be proactively notified when the async result (`Connected successfully` / `Connection failed: …`) appears ~1-10s later. **Fix:** add `aria-live="polite"` (and `role="status"`) to the wrapping `<div>` in both the success and failure branches.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)
Cross-checked every user-facing string against the UI-SPEC's Copywriting Contract table:
- `Save email settings` (`email-settings-form.tsx:264`) ✓
- `Test IMAP connection` / `Test SMTP connection` → `Testing…` (`test-connection-button.tsx:37,51`) ✓
- `Enable email channel` + exact caption `Poll a mailbox for inbound email and send agent replies via SMTP. Off by default until configured.` (`email-channel-toggle.tsx:32,35-36`) ✓
- From-address caption verbatim (`email-settings-form.tsx:253-256`) ✓
- `Connected successfully` / `Connection failed: {error}` (`test-connection-button.tsx:61,68`) ✓
- Health line's three states verbatim, including the em-dash copy `Not checked yet — the inbound poll runs every minute once enabled.` (`email-health-line.tsx:18,26,33`) ✓
- Toasts `Email settings saved.` / `Failed to save email settings. Please try again.` (`email-settings-form.tsx:53,55`) and `Failed to update email setting. Please try again.` (`email-channel-toggle.tsx:24`) ✓
- `Failed to send` badge + `Retry` link + `Retrying…` transient state (`delivery-failed-chip.tsx:26,33,42`) ✓
- Dropped-attachment note in `ingest-message.ts` (`"{N} attachment(s) not stored (too large or unsupported): {names}"`) is specific and non-generic, matching D-20's "never silently discarded" requirement.
- No generic `Submit`/`Click Here`/`OK` patterns found anywhere in the phase's UI files (targeted grep returned no matches).

### Pillar 2: Visuals (4/4)
- Focal point matches the UI-SPEC's declared hierarchy exactly: `Save email settings` uses the `Button` default variant, which is the only component in the entire email-settings surface resolving to `bg-primary` (confirmed via `src/components/ui/button.tsx:12`, `default: "bg-primary text-primary-foreground..."`). No other element in `src/app/(app)/settings/email/` uses primary/accent styling — grep for `bg-primary|text-primary` in that directory returns zero hits.
- `EmailChannelToggle` (Switch + label + caption) is the clear secondary anchor at the top of the page, exactly as specified.
- Every icon has adjacent text: `CircleAlert` + "Last poll failed:…"/"Failed to send", `CheckCircle2` + "Connected successfully", `XCircle` + "Connection failed:…", `Loader2` + "Testing…"/no bare spinner. No icon-only buttons exist in this phase's surface (Test Connection and Retry both render as labeled `Button` components).
- `Switch` carries `aria-label="Enable email channel"` (`email-channel-toggle.tsx:31`).

### Pillar 3: Color (4/4)
- Accent (`bg-primary`/`text-primary`) usage inside `src/app/(app)/settings/email/`: **0 explicit occurrences** (only inherited via the shared `Button` default variant on the Save button, exactly matching the UI-SPEC's "Accent is explicitly reserved for… Save… and the active nav pill" rule). The nav pill's `bg-primary/10 text-primary` (`settings-nav.tsx:31`) is the only other accent instance in this phase, matching spec.
- Destructive token (`bg-destructive/10 text-destructive border-destructive/20`) used in exactly the three declared places: health-line failure banner, Test Connection failure row, `DeliveryFailedChip` badge — no other destructive usage.
- Success token (`text-success`) used only in the Test Connection success row — matches "success reserved for Test Connection success only."
- No hardcoded hex/`rgb()` colors found anywhere in `src/app/(app)/settings/email/` or `delivery-failed-chip.tsx` (grep returned zero matches).
- The one intentionally-non-token surface, `wrapEmailSafeHtml()` in `src/lib/channels/email/compose-outbound.ts:24-26` (inline `style="…color:#1a1a1a;"`), is explicitly out of scope per both the UI-SPEC's own scope note and an inline code comment explaining why (third-party mail clients can't load Tailwind/CSS variables) — correctly exempted, not a violation.

### Pillar 4: Typography (4/4)
Grep across every Phase 3 UI file (`settings/email/*`, `delivery-failed-chip.tsx`, `thread-message.tsx`) found exactly:
- Sizes: `text-[12px]`, `text-[13px]`, `text-[14px]`, `text-[18px]` — 4 distinct sizes, matching the UI-SPEC Typography table's declared roles (caption/field-label/body/page-heading) one-for-one.
- Weights: `font-normal`, `font-medium`, `font-semibold` — 3 distinct weights, matching the declared 400/500/600 set exactly.
- Zero named Tailwind size classes (`text-sm`/`text-lg`/etc.) — every size is an explicit `text-[Npx]`, per DESIGN-SYSTEM.md's mandatory rule.

### Pillar 5: Spacing (4/4)
- Section containers use `space-y-4 rounded-lg border border-border/70 p-4` verbatim for both IMAP and SMTP blocks (`email-settings-form.tsx:62,153`), matching the declared component-specific value exactly.
- Page shell uses `space-y-6` (`page.tsx:14`), form uses `space-y-6` (`email-settings-form.tsx:61`) — matches the declared page-level scale.
- All other spacing values found (`gap-2`, `gap-3`, `mt-2`, `space-y-0`) are within the base 4px-grid scale.
- The three pre-declared UI-SPEC exceptions (`gap-1.5`, `mt-1.5`, `py-0.5`) appear exactly where the spec allows them: `TestConnectionButton`'s result row (`gap-1.5`), `DeliveryFailedChip`'s row offset (`mt-1.5`) and badge+row gap (`gap-2`, as the spec's widened variant), and the reused `Badge` class's `py-0.5`.
- No arbitrary bracketed spacing values (`p-[…px]`, `m-[…rem]`) found anywhere in the phase's files.

### Pillar 6: Experience Design (3/4)
Strong coverage overall, with one real gap:
- **Loading states:** `TestConnectionButton`'s `testing` state disables the button and shows `Loader2` + "Testing…" (`test-connection-button.tsx:45-52`); Save button disables + spins while `form.formState.isSubmitting` (`email-settings-form.tsx:262-265`).
- **Error states:** Save failure → toast; toggle failure → optimistic revert + toast (`email-channel-toggle.tsx:21-25`); Test Connection failure → inline destructive row with the actual error message; inbound-poll failure → persisted `lastPollError` surfaced in the health-line banner (D-25, "never silent") — all correctly implemented.
- **Empty state:** `EmailHealthLine`'s "Not checked yet — the inbound poll runs every minute once enabled." correctly covers the never-polled case.
- **Disabled states:** both async buttons (Test Connection, Save) disable themselves while in flight, preventing double-submission.
- **Confirmation for destructive actions:** correctly absent — per UI-SPEC's own Copywriting Contract note, this tab has no delete/remove action; the channel toggle is reversible and needs no confirmation dialog.
- **Gap found:** `retryOutboundSend` (`src/app/(app)/tickets/[id]/actions.ts:79-92`) is the only mutating action added across this entire phase that does **not** wrap its work in try/catch or return `{ ok: false }` on failure — every sibling action (`saveEmailSettings`, `setEmailChannelEnabled`, `testImapConnection`, `testSmtpConnection`) does. Combined with `DeliveryFailedChip.handleRetry()` not checking the result or catching an error, a transient queue/DB failure during retry leaves the UI stuck on "Retrying…" indefinitely with no error surfaced — a direct (if narrow) violation of this same phase's own "never a stuck spinner" principle (RESEARCH.md Pitfall 5), applied everywhere else but here. See Priority Fix #1.
- Also noted (not scored, since it's outside the pillar's specific audit criteria but worth recording): Test Connection doesn't pre-validate required fields via `form.trigger()` before firing the network probe (Priority Fix #2), and the Test Connection result panel lacks `aria-live` (Priority Fix #3).

---

## Files Audited

- `src/app/(app)/settings/email/page.tsx`
- `src/app/(app)/settings/email/email-settings-form.tsx`
- `src/app/(app)/settings/email/email-channel-toggle.tsx`
- `src/app/(app)/settings/email/email-health-line.tsx`
- `src/app/(app)/settings/email/test-connection-button.tsx`
- `src/app/(app)/settings/email/actions.ts`
- `src/app/(app)/settings/settings-nav.tsx`
- `src/components/tickets/delivery-failed-chip.tsx`
- `src/components/tickets/thread-message.tsx`
- `src/app/(app)/tickets/[id]/actions.ts` (`retryOutboundSend`)
- `src/lib/channels/email/compose-outbound.ts` (outbound HTML wrapper — confirmed correctly out-of-scope for token rules)
- `src/lib/channels/email/imap-client.ts`, `src/lib/channels/email/smtp-client.ts` (Test Connection timeout behavior)
- `src/lib/channels/email/ingest-message.ts` (dropped-attachment copy)
- `src/components/ui/button.tsx` (confirmed `default` variant = `bg-primary`)
- All six `03-0N-PLAN.md` / `03-0N-SUMMARY.md` pairs and `03-CONTEXT.md`/`03-UI-SPEC.md`

**Registry audit:** `components.json` exists (shadcn initialized), but `03-UI-SPEC.md` explicitly declares `"registries": {}` and zero third-party registries used this phase — registry safety audit not applicable, skipped per the gate condition.
