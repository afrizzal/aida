---
phase: 12-ticket-lifecycle
reviewed: 2026-11-08T16:00:38Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - src/app/(app)/tickets/[id]/page.tsx
  - src/app/(app)/tickets/filter-chip-row.tsx
  - src/app/(app)/tickets/save-view-dialog.tsx
  - src/app/(app)/tickets/ticket-list-panel.tsx
  - src/app/(app)/tickets/ticket-list-row.tsx
  - src/components/tickets/activity-event-row.tsx
  - src/components/tickets/activity-feed.tsx
  - src/components/tickets/link-ticket-dialog.tsx
  - src/components/tickets/linked-tickets-row.tsx
  - src/components/tickets/local-date-time.tsx
  - src/components/tickets/merge-ticket-dialog.tsx
  - src/components/tickets/merged-source-banner.tsx
  - src/components/tickets/snooze-control.tsx
  - src/components/tickets/thread-message.tsx
  - src/components/tickets/ticket-actions-menu.tsx
  - src/components/tickets/ticket-meta-header.tsx
  - src/components/tickets/ticket-picker.tsx
findings:
  critical: 0
  warning: 8
  info: 6
  total: 14
status: issues_found
---

# Phase 12: Code Review Report (part c, UI)

**Reviewed:** 2026-11-08T16:00:38Z
**Depth:** standard
**Files Reviewed:** 17 (the UI files of `git diff --name-only 6d5d8e4..HEAD -- src` under `src/app/(app)/` and `src/components/`, excluding the three server actions, which part a covered).
**Status:** issues_found

Scope note: this part covers the UI only. Server routes and `src/lib/` belong to another reviewer. Three things outside the scope were read only as cross-references: `src/lib/tickets/activity-copy.ts` (the feed's copy source, needed for the copy checks), the imports and merge markup of `src/app/(public)/status/[token]/page.tsx`, and the Phase 12 E2E specs. The Radix focus claim in UI-WR-03 was checked against `node_modules/.pnpm/radix-ui@1.6.0_…/@radix-ui/react-dialog/dist/index.mjs:148-151`.

## Summary

Checked against `12-UI-SPEC.md` and `.planning/DESIGN-SYSTEM.md`.

**Verified clean (no finding):**
- **Token-only colours.** The new component files contain no oklch/hex literal and no palette class. Text uses `text-primary-emphasis`, never `text-primary`.
- **Explicit text sizes.** No `text-xs`/`text-sm`/`text-lg` in new markup. Every shadcn internal the spec names is overridden to `text-[13px]`/`text-[15px]`. The one exception is UI-IN-01.
- **Feed never reaches a public route.** `ActivityFeed`, `ActivityEventRow` and `activity-copy` are not imported by any `(public)` route, directly or transitively. The public page imports only `status-page-data` (which imports only `status-visibility` and `db`), `ThreadMessage`, `ThreadSystemEvent`, `StatusChip`, `Badge` and `Button`. It never passes `movedFrom`.
- **Public notice reveals nothing about the target.** The public merged notice and the "Combined" badge use fixed copy that matches the spec rows. They show no target number, subject, status or date. `mergedAt` is loaded but not rendered. `ticket-merge.spec.ts:222-242` asserts this.
- **Agent banner, unreadable target.** The banner's unreadable-target form ("This ticket was merged into another ticket on {date}.") shows no target data.
- **No inline script** in the new UI files.

**Main defects:**
- **Time display.** The snooze chip's accessible name is formatted in the server's zone, and React does not patch it on hydration. The feed event-time tooltip is in UTC, but the spec says local time.
- **Focus.** Neither dialog returns focus anywhere when it closes.
- **Copy.** Several runtime strings have no Copywriting row, including the "a former member" literal.
- **Merge confirmation.** It can name a link type it made up.
- **E2E.** No test covers any merge or snooze error callout.

## Warnings

### UI-WR-01: The snoozed-chip trigger's aria-label shows the server's time zone and React never corrects it

**File:** `src/components/tickets/snooze-control.tsx:256`
**Issue:** The chip trigger builds `aria-label={`Snoozed until ${formatLocalDateTime(new Date(snoozedUntil))}. Change or wake.`}` during render. `formatLocalDateTime` is called with no `timeZone`, so it uses the zone of whatever process runs it.
- `SnoozeControl` is passed from the server page (`page.tsx:141-148`), so it is SSR'd. The server renders the label in the container's zone, usually UTC. The browser computes a different string in the viewer's zone.
- React 19 does not patch attribute mismatches during hydration ("This won't be patched up"). The label keeps the server value until the next client re-render, for example a revalidation.
- Result: on first load, a viewer in Asia/Jakarta who uses a screen reader hears "Snoozed until Tue, Nov 10, 02:00", while the chip shows 09:00. No zone is named, so the announced time is wrong by the offset.
- This breaks D-12 / UI-SPEC 4a, which allow only two forms: the UTC form marked "UTC", or local time after mount.
- The E2E runs browser and server in the same zone, so it cannot see this. The `Asia/Jakarta` backstop (`12-GATE.md:142`) is still open.

**Fix:** Build the label from the same hydration-safe state as `LocalDateTime`. One way is a hook that returns the UTC form before mount and the local form after:
```tsx
const [label, setLabel] = useState(() => `${formatLocalDateTime(new Date(snoozedUntil!), "UTC")} UTC`);
useEffect(() => { if (snoozedUntil) setLabel(formatLocalDateTime(new Date(snoozedUntil))); }, [snoozedUntil]);
// aria-label={`Snoozed until ${label}. Change or wake.`}
```
Another way: drop the `aria-label`. The visible chip text already reads "Snoozed until <time>". Add ". Change or wake." as `sr-only` text.

### UI-WR-02: The feed's event-time tooltip is in UTC; UI-SPEC Surface 6 requires local time

**File:** `src/components/tickets/activity-event-row.tsx:32-43,77`
**Issue:**
- UI-SPEC Surface 6 says the event time is `<time dateTime="{ISO}" title="{full local time}">`. D-12 / 4a says times are shown in the viewer's browser zone.
- `ActivityEventRow` is a server component. It hard-codes `TITLE_FORMAT` with `timeZone: "UTC"` and renders `title="… UTC"`, so every viewer's tooltip shows UTC. The comment says this is on purpose ("as the first render of LocalDateTime does"). But `LocalDateTime` switches to local time after mount, and this tooltip never switches.
- Inside the same row, the snooze deadline (`part.type === "time"` → `LocalDateTime`) shows local time. One event row therefore mixes zones. Example: "snoozed this ticket until Tue, Nov 10, 09:00 · 2 hours ago", where hovering "2 hours ago" shows "… 02:00 UTC".

**Fix:** Render the relative time through a small client component. It keeps the server text, starts with the UTC title for hydration and swaps in the local full title after mount, for example by reusing `LocalDateTime`'s `formatFull`:
```tsx
"use client";
export function EventTime({ iso, relative }: { iso: string; relative: string }) {
  const [title, setTitle] = useState(() => formatFull(new Date(iso), "UTC"));
  useEffect(() => setTitle(formatFull(new Date(iso))), [iso]);
  return <time dateTime={iso} title={title}>{relative}</time>;
}
```
`formatFull` needs to be exported. Then add an E2E case with `timezoneId: "Asia/Jakarta"` that asserts the title.

### UI-WR-03: The Link and Merge dialogs do not return focus to the "More ticket actions" trigger when they close

**File:** `src/components/tickets/ticket-actions-menu.tsx:55-99` (dialogs: `link-ticket-dialog.tsx:51-67`, `merge-ticket-dialog.tsx:75-101`)
**Issue:**
- UI-SPEC Surface 1 says: "Both dialogs return focus to the menu trigger when closed (radix default)".
- The dialogs are opened from `DropdownMenuItem onSelect` through `setLinkOpen` / `setMergeOpen`, and neither has a `DialogTrigger`. The Radix 1.6.0 modal `DialogContent` runs `onCloseAutoFocus: (event) => { event.preventDefault(); context.triggerRef.current?.focus(); }` (`react-dialog/dist/index.mjs:148-151`). With no `DialogTrigger`, `triggerRef.current` is `null`. The FocusScope default (return to the previously focused element) is prevented, and nothing is focused.
- After Close, Keep tickets separate, Escape or a successful link, keyboard and screen-reader users land on `<body>` at the top of the document. They are not on the ⋯ button.
- No E2E asserts focus after a dialog closes.

**Fix:** Keep a ref to the menu trigger and restore focus yourself:
```tsx
const triggerRef = useRef<HTMLButtonElement>(null);
<DropdownMenuTrigger asChild><Button ref={triggerRef} …/></DropdownMenuTrigger>
// in each DialogContent:
onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus(); }}
```
This needs an `onCloseAutoFocus` prop forwarded through `LinkTicketDialog` / `MergeTicketDialog`. Add `await expect(page.getByRole("button", { name: "More ticket actions" })).toBeFocused()` to the relations and merge E2E after Close.

### UI-WR-04: Focus is dropped to `<body>` after several async outcomes

**File:** `src/components/tickets/merge-ticket-dialog.tsx:127-132,284-324`; `src/components/tickets/link-ticket-dialog.tsx:178-204`; `src/components/tickets/snooze-control.tsx:253-266,305-311`; `src/components/tickets/linked-tickets-row.tsx:146-160`
**Issue:** In each case below, the focused control becomes disabled or unmounted, and nothing moves focus afterwards.
- **Merge, rejected call** (`kind: "unknown"`). The focused "Merge tickets" button is disabled while pending and stays disabled (`mergeBlocked`). "Back" is disabled too (`:290`). Only the rule-refusal case refocuses (`:130-132`). Focus is lost, and the only way on ("Keep tickets separate") is not focused.
- **Link dialog refusal.** "Link tickets" and the picker input are disabled while pending (`:193`, `disabled={pending}` on the picker). When the callout appears, focus is not restored.
- **Snooze popover refusal.** The clicked preset is disabled while pending (`:309`). After a refusal, focus is not returned to it or to the callout.
- **Snooze or wake success.** After revalidation, the trigger changes element type: the `<Button>` ghost becomes the chip `<button>` (`:253-266`), or the reverse. Radix returns focus to the old trigger, which then unmounts.
- **Removing a link** (`linked-tickets-row.tsx`). The focused remove button disappears with its chip.

UI-SPEC 4c says focus "returns to the trigger on close". Surface 3a says focus moves deliberately on each state change.
**Fix:**
- After each failure, focus the first still-enabled control: "Keep tickets separate" for an unknown merge outcome, the picker input or "Link tickets" for a link refusal, the clicked preset for a snooze refusal.
- For the snooze trigger, render one stable `<button>` element whose content changes between the ghost style and the chip style, so the node survives revalidation.
- After removing a chip, focus the next chip's link, or the "Linked tickets" heading (`tabIndex={-1}`).

### UI-WR-05: Runtime copy with no UI-SPEC Copywriting row

**File:** `src/lib/tickets/activity-copy.ts:159-160,97-99`; `src/components/tickets/merged-source-banner.tsx:22,69`; `src/components/tickets/merge-ticket-dialog.tsx:221-223`; `src/components/tickets/linked-tickets-row.tsx:88-91`
**Issue:** UI-SPEC says "All copy is … final; the executor uses it verbatim", and every string must map to a row. These strings have no row, or contradict the row they reuse:
1. `activity-copy.ts:160`: `"a former member"`, an inline lower-case literal. The row is "Actor: former member" = "A former member". The comment ("Mid-sentence, the former-member marker starts lower case") admits it invents a variant. It is not the exported `ACTOR_FORMER_MEMBER` constant, so the copy-table unit test and any grep for the row miss it.
2. `activity-copy.ts:99`: `label()` returns `"none"` for a missing `before`/`after` value. It also falls back to the raw enum key for an unknown value (`map[key] ?? key`). The output reads "changed the priority from none to High.", which has no row, and the spec rule says raw values are never shown.
3. `merged-source-banner.tsx:22`: `"an earlier date"` when `mergedAt` is null. Both banner rows require `{date}`.
4. `merged-source-banner.tsx:69`: `"Replies go on the ticket this one was merged into."` is the unreadable-target composer line. Only the banner has an "unavailable" row. The composer line has none.
5. `merge-ticket-dialog.tsx:221-223`: the sr-only `DialogDescription` "Review what happens before you merge these tickets." has no row.
6. `linked-tickets-row.tsx:89-91`: a rejected *remove* call shows "Link outcome unknown" ("The link may have been **saved**"). That is wrong for a removal: the link may have been *removed*.

**Fix:** Add rows to `12-UI-SPEC.md`, then use them verbatim from one module. Suggested rows:
- "Actor: former member (mid-sentence)" = "a former member"
- "Feed events: missing value" = "no value"
- "Merged banner, date unknown"
- "Merged composer line, target unavailable"
- "Merge confirm description (sr)"
- "Link remove outcome unknown" = "The result is not known. The link may have been removed. Refresh the page to check before you try again."

For item 2, render the "other" row when the value is not a known enum, instead of echoing the key. Export each string as a constant, and extend the copy-table unit test to cover them.

### UI-WR-06: The merge confirmation can name a link type it made up

**File:** `src/components/tickets/merge-ticket-dialog.tsx:212,258-263`
**Issue:**
- `replacedLabel = target.alreadyLinked ? linkLabels[target.id] : undefined` mixes two sources. `alreadyLinked` comes fresh from the picker endpoint. `linkLabels` is built from the relations loaded with the page (`ticket-meta-header.tsx` `Object.fromEntries(relations…)`).
- If a link was added after the page loaded (another agent or tab), `linkLabels[target.id]` is undefined. The confirmation then says `The current link "Related to" … is replaced by "Duplicate of"` because of the `?? "Related to"` fallback, even when the real link is "Parent of" or "Child of".
- This is the destructive confirmation step that AIDA-53 requires. Stating a wrong fact there is a correctness defect, not a cosmetic one.

**Fix:** Have the picker endpoint return the current link label from this ticket's side (it already computes `alreadyLinked`), and use it here. If the label is unknown, use a generic row, for example "The current link between these tickets is replaced by "Duplicate of"." (add it to UI-SPEC). Never default to a specific type.

### UI-WR-07: "Back" from the confirm step keeps the choice but hides it

**File:** `src/components/tickets/merge-ticket-dialog.tsx:166-209,284-297`; `src/components/tickets/ticket-picker.tsx:72-73`
**Issue:**
- UI-SPEC 3a says "Back (outline, returns to step 1 with the choice kept)". Step 1 unmounts `TicketPicker` when the dialog moves to step 2. Going back remounts it with `query = ""` and `outcome = null`, so the list shows "Type a ticket number, or at least 2 letters of the subject." and no checked row.
- `target` is still set in `MergeFlow`, so "Review merge" stays enabled for a ticket the user can no longer see.
- After a rule refusal (for example `TARGET_MERGED`), Back takes focus (by design), and one click on "Review merge" re-submits the same refused target with no visible choice.

**Fix:** Lift `query`/`outcome` out of `TicketPicker` into `MergeFlow`, or keep step 1 mounted but hidden. At minimum, show the chosen ticket as a "Selected: #N subject" line above the picker on step 1. After a rule refusal, clear `target` so the user has to pick again.

### UI-WR-08: No E2E for the merge-refusal, snooze-error and time-zone paths

**File:** `tests/e2e/ticket-merge.spec.ts`, `tests/e2e/snooze.spec.ts`, `tests/e2e/ticket-relations.spec.ts`
**Issue:**
- **Merge.** `ticket-merge.spec.ts` has 5 cases and none reaches a step-2 callout. Untested: "Nothing was changed." + a "Merge error" row, "Merge tickets" disabled with Back focused after a rule refusal, and "Merge outcome unknown" with Back and Merge disabled.
- **Snooze.** `snooze.spec.ts` has 8 cases, with no `role="alert"` callout, no "Snooze error" row, no "Snooze outcome unknown", and no client-validation line ("Pick a time at least 5 minutes from now." / "Pick a time within the next 365 days.").
- **Links.** No E2E covers a failed link removal (the `role="alert"` line in the row).
- **Time zone.** No spec sets `timezoneId`, so UI-WR-01 and UI-WR-02 cannot be caught.
- `12-GATE.md:147` records these gaps as open, but no test exists. These are exactly the paths where UI-WR-04's focus loss occurs.

**Fix:** Add these cases:
- **Merge refusal:** open the confirm step for A→B, set `B.mergedIntoTicketId` through the fixture, click "Merge tickets", then assert the alert text `Nothing was changed. #B was merged into another ticket…`, "Merge tickets" disabled and Back focused.
- **Merge unknown:** abort the server-action POST with `page.route("**/tickets/**", r => r.request().method()==="POST" ? r.abort() : r.continue())` and assert "Merge outcome unknown".
- **Snooze refusal:** open the popover, close the ticket through the fixture, click a preset, then assert the closed-ticket alert.
- **Snooze unknown:** abort the POST, then assert "Snooze outcome unknown".
- **Snooze validation:** a custom time 1 minute ahead, then assert the "too soon" line.
- **Time zone:** a `test.use({ timezoneId: "Asia/Jakarta" })` block that asserts the chip's accessible name and the feed tooltip.

## Info

### UI-IN-01: The Snoozed toggle has no explicit text size

**File:** `src/app/(app)/tickets/filter-chip-row.tsx:324-333`
**Issue:** The new toggle is `Button size="sm"` with no `text-[13px]`, so it inherits `text-[0.8rem]` from `button.tsx:37`. UI-SPEC Typography says `Button size="sm"` → `text-[13px]`, and DS §8 rule 6 requires explicit sizes. The sibling Status, Tag and Custom field buttons (pre-existing) do the same, so the row is consistent, but the new element does not follow the rule.
**Fix:** Add `text-[13px]` to the toggle, or to all four buttons for consistency.

### UI-IN-02: The "Merge error: unknown" refusal path is dead code

**File:** `src/components/tickets/merge-ticket-dialog.tsx:53-55,149-158`
**Issue:**
- `MergeErrorCode` (`merge.ts:49-56`) has 7 members, and `mergeErrorMessage` maps all 7. The `default: return null` branch, and the `rule: false` failure that keeps "Merge tickets" enabled, can never run. `mergeTickets` returns only `MergeError` codes and rethrows everything else, which becomes the rejected-call path.
- The UI-SPEC rule "'Merge tickets' stays enabled only for the 'unknown' refusal" is therefore implemented but unreachable, and the "Merge error: unknown" row is never shown.

**Fix:** Delete the branch and make the switch exhaustive (`const _x: never = code`), or add an explicit `UNKNOWN` code if the service should ever return one.

### UI-IN-03: Custom-time field error is unreachable in one case, not announced, and never cleared

**File:** `src/components/tickets/snooze-control.tsx:203-207,359,363`
**Issue:** "Enter both a date and a time." can never show, because the button is `disabled` until both fields hold a value (`:363`). The field-error `<p>` has no `role="alert"`/`aria-live`, and the inputs do not reference it through `aria-describedby` or `aria-invalid`, so screen readers never hear "Pick a time at least 5 minutes from now." It also stays on screen after the user edits the fields.
**Fix:** Give the line an id and `role="alert"`, add it to both inputs' `aria-describedby`, set `aria-invalid` while it shows, and clear `fieldError` in both `onChange` handlers. Drop the unreachable branch, or enable the button and keep the check.

### UI-IN-04: The "Moved from #N" marker sits in a header line that does not wrap

**File:** `src/components/tickets/thread-message.tsx:66,76-92`
**Issue:** UI-SPEC E6 says the marker is "one more item in the existing header line of `ThreadMessage`, which already wraps". The header is `flex items-center gap-1.5` with no `flex-wrap`. An internal note with a long author name, the "Internal Note" label, the relative time and "Moved from #12345" overflows a narrow reading pane.
**Fix:** Add `flex-wrap` (and `gap-y-1`) to the header line.

### UI-IN-05: The merged banner's button cannot wrap below the text, and the icon uses an off-scale offset

**File:** `src/components/tickets/merged-source-banner.tsx:24-28,41`; also `src/app/(public)/status/[token]/page.tsx:82`
**Issue:** UI-SPEC E5 (overflow) says the banner's button "wraps below on narrow ones". The container is `flex items-start` with no `flex-wrap`, so on a narrow pane the paragraph squeezes instead and the button never wraps. `mt-0.5` (2px) on the icon in the banner and in the public notice is off the declared 4/8/16/24/32 scale ("Every other spacing value used by a new element is on the declared scale").
**Fix:** Add `flex-wrap` to the banner, with `basis-full sm:basis-auto` on the button if needed. Align the icon with `items-start` plus a line-height-matched icon box instead of `mt-0.5`, or record the exception in UI-SPEC.

### UI-IN-06: The snooze popover dialog has no accessible name

**File:** `src/components/tickets/snooze-control.tsx:268-298`
**Issue:** Radix `PopoverContent` renders `role="dialog"`, and the E2E finds it with `getByRole("dialog")` (`snooze.spec.ts:46`). It has no `aria-labelledby` or `aria-label`, so screen readers announce a nameless dialog. The visible heading ("Snooze until" / "Change snooze") is an unlinked `<h2>`. This feeds the open accessibility backstop (UI-SPEC E1–E11).
**Fix:** Give the `<h2>` an id from `useId()`, and pass `aria-labelledby={headingId}` to `PopoverContent`.

---

_Reviewed: 2026-11-08T16:00:38Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (UI part c: 17 files; server routes and src/lib/ are covered by another reviewer)_
