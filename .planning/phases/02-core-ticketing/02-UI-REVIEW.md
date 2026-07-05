# Phase 2 — UI Review

**Audited:** 2026-07-05
**Baseline:** `.planning/phases/02-core-ticketing/02-UI-SPEC.md` (approved design contract, indigo-violet DESIGN-SYSTEM.md base)
**Screenshots:** not captured — no dev server detected on localhost:3000, :5173, or :8080 (code-only audit)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Every CTA/empty/error/destructive-confirmation string matches the Copywriting Contract verbatim; no generic labels found |
| 2. Visuals | 3/4 | Strong focal points and icon-label discipline; ticket-list-row chip row has no wrap/overflow guard in the fixed 360px column |
| 3. Color | 4/4 | Zero hardcoded hex/oklch anywhere in Phase 2; accent used sparingly and only on spec-approved elements |
| 4. Typography | 3/4 | Explicit `text-[Npx]` scale used everywhere except `request-form.tsx`, which mixes in Tailwind's generic `text-sm` |
| 5. Spacing | 4/4 | Zero arbitrary bracket spacing values in the whole `src/` tree; component spacing matches the UI-SPEC table exactly |
| 6. Experience Design | 3/4 | Excellent state coverage (loading/empty/disabled/confirm/SLA-flag-clearing) but the spec's "list fails to load" error banner is nowhere implemented |

**Overall: 21/24**

---

## Top 3 Priority Fixes

1. **No error boundary for list/data-fetch failures** — Agents and customers see Next.js's raw default error screen instead of the branded, recoverable state the design contract specifies, undermining trust in a product that markets itself on polish/self-host readiness — Add `src/app/(app)/tickets/error.tsx` (and ideally `contacts/error.tsx`, `[id]/error.tsx`) rendering `bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-[13px] text-destructive` with the exact copy `Couldn't load tickets.` + a `Button variant="link"` `Retry` calling `reset()`.
2. **Typography convention drift in `request-form.tsx`** — Public-facing intake form has three lines using generic `text-sm` sitting beside six lines using the mandated `text-[Npx]` scale in the same file, which is exactly the kind of quiet drift that erodes design-system enforceability over time — Change lines 126, 201, 233 (`text-sm`) to `text-[14px]` to match the file's own dominant convention and CLAUDE.md/DESIGN-SYSTEM.md §8 Rule 6.
3. **Ticket-list-row chip row can overflow the fixed 360px column** — A ticket that is Urgent + At-risk/Overdue + carries 2 tags + an assignee avatar has no wrap, truncation, or scroll fallback in `ticket-list-row.tsx`, risking clipped chips or an unwanted horizontal scrollbar on the list column for real (not rare) SLA-breach scenarios — Add `flex-wrap` to the chip row container (the row already uses `min-h-[80px]`, not a fixed height, so wrapping is layout-safe) or drop the lowest-priority chip first when space is tight.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

Every string declared in the UI-SPEC's Copywriting Contract was found verbatim in the implementation:

- Primary CTAs: `Send Reply` (`src/components/tickets/composer.tsx:139`), `Save Internal Note` (`composer.tsx:134`), `Submit Request` (`src/app/(public)/request/request-form.tsx:238`), `Send Follow-up` (`src/app/(public)/status/[token]/follow-up-form.tsx:141`), `New Ticket` (`src/app/(app)/tickets/new-ticket-dialog.tsx:84,169`), `Save SLA Targets` (`src/app/(app)/settings/sla/sla-form.tsx:107`), `Create Field` (`src/app/(app)/settings/custom-fields/custom-field-manager.tsx:239`).
- Empty states match exactly: `Your inbox is empty` (`src/app/(app)/tickets/ticket-list-panel.tsx:53`), `Select a ticket` (`src/app/(app)/tickets/page.tsx:23`), `No contacts yet` (`src/app/(app)/contacts/page.tsx:52`), `No tags yet — tags created from the ticket composer will appear here for management.` (`src/app/(app)/settings/tags/tag-manager.tsx:65`), `No custom fields yet. Add one to start capturing extra ticket details.` (`custom-field-manager.tsx:111`), `Nothing here — no tickets match this view.` (`ticket-list-panel.tsx:60`).
- Destructive-confirmation dialog copy matches exactly: `This removes it from all tickets. This can't be undone.` (`tag-manager.tsx:123`), `Existing values on tickets will be permanently removed. This can't be undone.` (`custom-field-manager.tsx:250`), both with `Delete tag`/`Delete field` confirm buttons.
- Rate-limit copy matches exactly, reused identically on both public surfaces: `You've submitted a few requests recently. Please wait a bit before trying again.` (`request-form.tsx:228`, `follow-up-form.tsx:147`).
- Invalid-token dead-end matches exactly: `We couldn't find that ticket` / `This status link may be invalid or expired. If you need help, please submit a new request.` + `Submit a new request` CTA (`src/app/(public)/status/[token]/page.tsx:42-49`).
- Composer failure toasts match exactly: `Couldn't send your reply. Try again.` / `Couldn't save your note. Try again.` (`composer.tsx:70`).
- Auto-reopen system-event copy matches exactly and is wired to the actual `Message.triggeredReopen` flag, not inferred client-side: `Ticket reopened — new reply from {contact}.` (`src/app/(app)/tickets/[id]/page.tsx:139`, `status/[token]/page.tsx:92`).
- `grep`-checked for generic patterns (`Submit`/`Click Here`/`OK`/`Cancel`/`Save` as bare labels) across `tickets/` and `settings/` — no matches; every button carries a specific, task-named label.
- Toasts not explicitly in the contract (status/priority/assignee/tag/custom-field mutation failures in `ticket-meta-header.tsx:123,130,138,146,153,162`, `contacts/[id]/notes-form.tsx:25`, settings managers) all follow the same "Couldn't/Failed to {action}. Try again." voice — consistent extension of the established tone, not filler boilerplate.

No deductions. This is a full-fidelity implementation of the Copywriting Contract.

### Pillar 2: Visuals (3/4)

- Clear focal points on both main screens, per UI-SPEC intent: the reading-pane subject heading (`ticket-meta-header.tsx:172`, `text-[18px] font-semibold`) and the composer's primary action are the two anchors that draw the eye first; the public status page mirrors this with `#{number} {subject}` + `StatusChip` (`status/[token]/page.tsx:58-61`).
- Icon-only buttons are consistently paired with `aria-label`: `Attach file` (`composer.tsx:120`, `follow-up-form.tsx:133`), `Remove tag {label}` (`tag-chip.tsx:9`), `Remove attachment {filename}` (`attachment-chip.tsx:51`), `Rename tag {name}` / `Delete tag {name}` (`tag-manager.tsx:99,108`), `Edit field {label}` / `Delete field {label}` / `Remove option {n}` (`custom-field-manager.tsx:123,132,211`), `Change status` / `Change priority` (`ticket-meta-header.tsx:177,197`).
- Visual hierarchy through color/weight is strong and matches the chip vocabulary contract precisely: `StatusChip`'s solid-fill NEW vs. tinted OPEN/PENDING/RESOLVED/CLOSED (`status-chip.tsx:6-10`), `PriorityChip`'s outline-only LOW/NORMAL vs. tinted HIGH/URGENT (`priority-chip.tsx:6-13`), and internal notes are unmistakably distinct (amber tint + left border + `Lock` icon + uppercase label, `thread-message.tsx:55,61-62`) — never confusable with a public reply.
- **Finding (drives fix #3 above):** `src/app/(app)/tickets/ticket-list-row.tsx:79` renders the chip row as `<div className="mt-1.5 flex items-center gap-1.5">` with no `flex-wrap`, `overflow-hidden`, or truncation strategy, inside a column that is a hard `w-[360px]` (`ticket-list-panel.tsx:40`, `page.tsx:33`). A row that combines `StatusChip` + `PriorityChip` (High/Urgent only) + `SlaDueChip` (At risk/Overdue) + up to 2 `TagChip`s + `TagOverflowChip` + `AssigneeAvatar` can plausibly exceed the ~328px available width (360px minus `px-4` padding) on exactly the tickets an agent most needs to see clearly (urgent + breaching + tagged). Not visually confirmed (no dev server available this audit), but structurally present in the shipped code with no fallback.

### Pillar 3: Color (4/4)

- `grep -rn "#[0-9a-fA-F]{3,8}|rgb(" src --include="*.tsx"` returns zero matches anywhere in the Phase 2 surfaces (`tickets/`, `contacts/`, `settings/`, `(public)/`, `components/tickets/`, `components/public/`) — full token-only compliance, no exceptions.
- Accent (`bg-primary`/`text-primary`/`border-primary`) usage is sparse and lands only on UI-SPEC-approved elements: active view-pill/status-filter/tag-filter/custom-field-filter buttons (`filter-chip-row.tsx`, 4 occurrences), the active Settings sub-nav tab (`settings-nav.tsx:30`, 1 occurrence), the solid `NEW` status chip + avatar tints + composer-toggle active state (`components/tickets/*`, 5 occurrences), avatar tints in Contacts (`contacts/page.tsx`, `contacts/[id]/page.tsx`, 2 occurrences), and the public-page decorative glow/brand mark (`(public)/layout.tsx`, `public-page-shell.tsx`). Total usage sits well under the ">10 unique elements" overuse threshold, and none of it appears on a chip the spec explicitly excludes — Pending/Resolved/Closed status and Low/Normal/High priority all correctly use `warning`/`success`/`muted`/outline instead of primary.
- `--warning`/`--success` semantic tokens are applied exactly where the contract reserves them: Pending status + High priority + At-risk SLA + Internal Note surface/lock/label/composer-CTA all use `--warning` (`status-chip.tsx:8`, `priority-chip.tsx:8`, `sla-due-chip.tsx:32-44`, `thread-message.tsx:55,61-62`, `composer.tsx:83,129`, `composer-toggle.tsx:34-36`); Resolved status uses `--success` (`status-chip.tsx:9`). Both tokens are registered correctly in `globals.css` (`@theme inline` mapping + `:root`/`.dark` values, lines 27-28, 69-70, 105-106) with no `-foreground` companion, matching the single-token `--destructive` convention exactly as specified.
- `Badge` and `Button` `destructive` variants (both pre-existing from Phase 1, reused here for tag/field delete confirmations) are already tint-only (`bg-destructive/10 text-destructive`), so the new Tags/Custom-Fields destructive confirmations inherit the correct visual weight with zero new code.

### Pillar 4: Typography (3/4)

- Every Phase 2 file uses the mandated explicit `text-[Npx]` scale (12/13/14/15/18px) — confirmed by grepping the whole `src/` tree for both the explicit-size pattern and for Tailwind's named sizes. The only named-size hits (`text-2xl`, `text-lg`) belong to pre-existing Phase 1 auth pages (`(auth)/login/page.tsx:23`, `(auth)/setup/page.tsx:16`), outside this phase's scope.
- Font weights are restricted to exactly the documented three: implicit 400, `font-medium` (500), `font-semibold` (600), plus deliberate `font-normal` overrides (`ticket-list-row.tsx:73` for non-new subjects, `sla-form.tsx:65,87` for field labels) — matches the UI-SPEC's explicitly-flagged 3-weight deviation precisely; no `font-bold`/`font-light`/etc. anywhere in Phase 2 code.
- **Finding (drives fix #2 above):** `src/app/(public)/request/request-form.tsx` mixes both conventions in the same file. Lines 109, 110, 125, 215, 223, 227 correctly use `text-[18px]`/`text-[14px]`/`text-[13px]`/`text-[12px]`, but lines 126 (`text-sm text-muted-foreground` subtitle), 201 (`text-sm font-medium leading-none` "Attachments (optional)" label), and 233 (`text-sm text-destructive` root form error) fall back to Tailwind's generic scale. This is a direct, narrow violation of CLAUDE.md/DESIGN-SYSTEM.md §8 Rule 6 ("Typography: use explicit sizes `text-[Npx]`, not Tailwind named sizes"). Visually near-invisible (`text-sm` = 14px, same as the file's own `text-[14px]`), but it is exactly the kind of small inconsistency that compounds into an unenforceable design system if left unaddressed.

### Pillar 5: Spacing (4/4)

- `grep -rn "\b(p|px|py|m|mx|my|gap|space-[xy])-\[[0-9.]+(px|rem)\]" src --include="*.tsx"` returns **zero matches** across the entire `src/` tree — no arbitrary spacing values anywhere, full 4px-grid compliance.
- Component-specific spacing matches the UI-SPEC's declared table exactly: ticket list row `min-h-[80px] px-4 py-3` (`ticket-list-row.tsx:57`), filter row and reading-pane header both `h-14` for cross-column alignment (`filter-chip-row.tsx:132`, `ticket-meta-header.tsx:168`), composer `border-t border-border p-4` (`composer.tsx:78`), settings/contact cards `p-6` (`contacts/[id]/page.tsx:53`), public-page `Card` `p-8` (`public-page-shell.tsx:24`), chip rows uniformly `gap-1.5`.
- The only non-4px-grid values present (`gap-2.5` brand box, `py-0.5` Badge default) are the pre-approved inherited exceptions explicitly carried over from Phase 1 shadcn defaults — no new exceptions were invented by this phase.
- Width/height utility values found via grep (`w-[360px]`, `min-h-[80px]`, `min-h-[96px]`, `min-h-[120px]`, `max-w-[70%]`) are all intentional layout dimensions explicitly declared in the UI-SPEC's Spacing Scale table (list column width, row/composer/textarea min-heights), not stray arbitrary spacing.

### Pillar 6: Experience Design (3/4)

- Loading states: 6× `Skeleton` rows plus a matching header skeleton for the list column (`ticket-list-row.tsx:99-118`, `page.tsx:31-42`) — exactly matches the UI-SPEC's declared loading pattern.
- Two-tier empty-state distinction correctly implemented: a true zero-tickets workspace gets the full halo `EmptyState` pattern, while a filtered-to-nothing view gets the lighter inline state — both branches present in `ticket-list-panel.tsx:50-62`, matching the UI-SPEC's explicit "don't use the heavy pattern for a filtered sub-state" guidance.
- Destructive-action confirmation dialogs are present for both delete flows with exact contract copy and correct destructive-variant confirm buttons (`tag-manager.tsx:118-135`, `custom-field-manager.tsx:245-262`).
- Disabled-during-pending coverage is comprehensive and consistent: `isSending`/`isSaving`/`isDeleting`/`isSubmitting` gate every mutating button across `composer.tsx`, `tag-manager.tsx`, `custom-field-manager.tsx`, `sla-form.tsx`, `notes-form.tsx`, `new-ticket-dialog.tsx`, `request-form.tsx`, and `follow-up-form.tsx`.
- Failure resilience: the composer and follow-up forms preserve typed content and selected attachments on a send failure rather than clearing them (`composer.tsx:65-74`) — matches the UI-SPEC's explicit requirement.
- SLA-flag-clearing is correctly duplicated at every state-changing write that can invalidate a stale flag: resolve/reopen (`[id]/actions.ts:22-27`), priority change (`[id]/actions.ts:57-68`, the documented "Pitfall 5" downgrade case), and first public reply (`api/tickets/[id]/messages/route.ts:99-106`) — this is a genuinely sophisticated piece of state management that prevents a whole bug class (stale "Overdue" chips after a priority downgrade or a first response).
- Auto-reopen wiring is end-to-end correct: the follow-up route is the sole writer of `Message.triggeredReopen`, and both the agent thread and the public status page render `<ThreadSystemEvent>` immediately after the flagged message using identical logic and copy (`[id]/page.tsx:137-141`, `status/[token]/page.tsx:90-94`) — neither surface infers reopening from `ticket.status`/timestamps, exactly as the plan mandated.
- Public-channel middleware exemptions are correctly wired (`src/middleware.ts:4-12` includes `/request`, `/status`, `/api/public`), so the entire public intake/status experience actually reaches unauthenticated visitors rather than bouncing to `/login`.
- **Finding (drives fix #1 above):** the UI-SPEC's explicitly specified "Error (list fails to load)" state — an inline banner reading `Couldn't load tickets.` with an inline `Button variant="link"` `Retry` — has no implementation anywhere. A repo-wide search for `error.tsx` under `src/app` returned zero files, and a search for the strings `"Couldn't load tickets"` / tied "Retry" copy returned zero matches. If a Server Component data fetch fails (e.g. `ticket-list-panel.tsx`'s `Promise.all`, or any `contacts`/`settings` page query), the failure falls through to Next.js's default unstyled error boundary instead of the branded, recoverable state the contract specifies. This gap is not disclosed as deferred or out-of-scope in any of the 12 plan `SUMMARY.md` deviation logs reviewed for this audit.

---

## Registry Safety

`components.json` confirmed present with `"registries": {}` (empty). UI-SPEC's Registry Safety table lists only one row — `shadcn official` — with no third-party registry entries. Per the registry-audit gate, the vetting steps (view/diff against a third-party registry) do not apply this phase.

Registry audit: 0 third-party blocks checked, no flags.

---

## Files Audited

**Planning inputs:** all 12 `02-0N-PLAN.md` / `02-0N-SUMMARY.md` pairs, `02-UI-SPEC.md`, `02-CONTEXT.md`, `.planning/DESIGN-SYSTEM.md`.

**Chip vocabulary / shared components:**
`src/components/tickets/status-chip.tsx`, `priority-chip.tsx`, `sla-due-chip.tsx`, `tag-chip.tsx`, `attachment-chip.tsx`, `assignee-avatar.tsx`, `thread-message.tsx`, `thread-system-event.tsx`, `composer.tsx`, `composer-toggle.tsx`, `ticket-meta-header.tsx`, `custom-field-input.tsx`; `src/components/public/public-page-shell.tsx`, `honeypot-field.tsx`; `src/components/empty-state.tsx`, `sidebar.tsx`, `top-bar.tsx`; `src/components/ui/button.tsx`, `badge.tsx`.

**Shared inbox (`/tickets`):**
`src/app/(app)/tickets/layout.tsx`, `page.tsx`, `ticket-list-row.tsx`, `ticket-list-panel.tsx`, `filter-chip-row.tsx`, `ticket-search-input.tsx`, `new-ticket-dialog.tsx`, `[id]/page.tsx`, `[id]/actions.ts`.

**Contacts (`/contacts`):**
`src/app/(app)/contacts/page.tsx`, `contact-search.tsx`, `[id]/page.tsx`, `[id]/notes-form.tsx`.

**Settings (`/settings`):**
`src/app/(app)/settings/settings-nav.tsx`, `layout.tsx`, `sla/page.tsx`, `sla/sla-form.tsx`, `tags/page.tsx`, `tags/tag-manager.tsx`, `custom-fields/page.tsx`, `custom-fields/custom-field-manager.tsx`.

**Public channel:**
`src/app/(public)/layout.tsx`, `request/page.tsx`, `request/request-form.tsx`, `status/[token]/page.tsx`, `status/[token]/follow-up-form.tsx`.

**API routes (state/copy-relevant paths):**
`src/app/api/tickets/[id]/messages/route.ts`; `src/middleware.ts`.

**Design tokens:**
`src/app/globals.css`, `components.json`.

**Grep sweeps run:** hardcoded hex/rgb literals (0 hits), Tailwind named font sizes (0 hits in Phase 2 scope), arbitrary bracket spacing values (0 hits repo-wide), font-weight distribution (400/500/600 only), accent-color occurrence counts per directory, generic copy patterns (`Submit`/`OK`/`Cancel` as bare labels — 0 hits), `error.tsx` existence (0 files repo-wide).
