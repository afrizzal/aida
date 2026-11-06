# Phase 9: Code Review Fix Report

Fixes for the four-part Phase 9 code review (`09-REVIEW.md`, `09-REVIEW-b.md`, `09-REVIEW-c.md`, `09-REVIEW-d.md`), one section per fix batch (see "Orchestrator dispositions (2026-11-12)" in `09-REVIEW.md`). Every new behaviour is shown red before green. Runs used `AIDA_TEST_RUN_ID=mwdj7jbu-806ef1af59a3dd21` and the Colima `DOCKER_HOST`, one test process at a time, exit codes read without a pipe.

## F1

**Date:** 2026-11-12. **Scope:** part c (`09-REVIEW-c.md`): c-CR-01 (K141), c-WR-01, c-WR-02 (K147), c-WR-03, c-IN-02, c-IN-05. The other part c info items are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree, as the dispatch asked. **Result:** 6 of 6 in-scope findings fixed, 7 commits.

### c-CR-01 / K141: admin gates read the session once

**Change.** `src/lib/authz.ts` now has `getActiveOrgAccess()`. It reads the session once and returns `{ session, orgId, role }`, where `role` is the member row's role in exactly `orgId`. `requireOrgAdminScope()` is the admin gate for a write. It throws `Forbidden: admin role required` unless `isAdminRole(role)`, and it returns `scopedDb(orgId)` for that same organization. `getOrgRole()` and `requireOrgAdmin()` now delegate to the one-read helper. `requireOrgAdmin()` has no callers left in `src/`.

**Callers converted.** I found them with `grep` for files that use both a role helper and a session helper. These are the 20 places that ran `requireOrgAdmin()` and then `getScopedDb()`, or `getScopedDb()` and then `getOrgRole()`, to authorize a write:
- `src/app/api/settings/branding/logo/route.ts`: `requireLogoAdmin`, used by POST and DELETE. Without a session or without an active organization the answer is still 401.
- `src/app/(app)/kb/actions.ts`: 2 actions.
- `src/app/(app)/settings/actions.ts`: 6.
- `src/app/(app)/settings/branding/actions.ts`: 1.
- `src/app/(app)/settings/custom-fields/actions.ts`: 3.
- `src/app/(app)/settings/email/actions.ts`: 4.
- `src/app/(app)/settings/sla/actions.ts`: 1. Its `getSessionActor()` action was already a single read and is unchanged.
- `src/app/(app)/settings/tags/actions.ts`: 2.

**Not changed, by design:**
- `settings/branding/page.tsx` and `settings/sla/page.tsx` still read `getScopedDb()` and then `getOrgRole()`. They use the role only to choose what to display. Every write they offer goes through a converted action.
- `settings/backups/page.tsx` already makes a single read.
- `kb/page.tsx`, `tickets/ticket-list-panel.tsx` and `tickets/[id]/page.tsx` take the session and the organization from one `getScopedDb()` call.
- `insights/actions.ts` and `tickets/[id]/actions.ts` have no admin gate.

**Test.** `tests/unit/org-access-single-read.test.ts` replaces only Better Auth's `getSession`, the member lookup, `scopedDb` and the stores. The real code in `session.ts`, `authz.ts`, the route and the actions runs. The active organization switches after the first session read, and the user is admin in one organization and member in the other. The test covers:
- DELETE with member then admin: 403 and no write.
- DELETE with admin then member: 200 and a write only to the admin organization.
- `deleteTag` and `createKbArticleAction`: they write only to the organization whose role was checked.
- Exactly one `getSession` call each time.

`tests/unit/logo-upload-route.test.ts` and `tests/unit/settings-connection-actions.test.ts` now mock the new helper.

**Runs:**
- Red, before the fix: `vitest run tests/unit/org-access-single-read.test.ts` exit 1, 4 failed and 1 passed (5). The first case got 200, meaning the member's write went through.
- Green: the new file plus `logo-upload-route`, `settings-connection-actions` and `admin-role`: exit 0, 4 files, 48 passed. `tsc --noEmit` exit 0.

**Commit:** `bd8cb94` fix(09-F1): c-CR-01 admin gates read the session once (K141)

### c-WR-01: logo validation requires image data, not only a header

**Change.** `src/lib/branding/logo-validate.ts` runs a structure check after the dimension and pixel limits, and still decodes no pixel:
- **PNG:** every chunk's length, type and CRC framing fits in the file, IHDR comes first, at least one IDAT is non-empty, and IEND is reached. An `acTL` chunk returns `not_image`.
- **JPEG:** a frame header comes before the start of scan, the SOS header fits, there is at least one byte of scan data, and an `FF D9` follows it.
- **WebP:**
  - the RIFF size fits in the file and every chunk fits inside it (with even padding);
  - a `VP8 ` key frame holds its whole first partition, whose size comes from the frame tag;
  - `VP8L` has data after its 5 header bytes;
  - `VP8X` needs an image chunk after it (`VP8 `, `VP8L` or `ANMF`).

A file that fails the check is `unreadable`. Bytes after IEND or after EOI are still accepted, so the padded 1 MiB boundary case is unchanged.

**Fixture.** `tests/support/logo-images.ts` now builds complete images:
- The PNG has a real zlib IDAT for every scanline, so it decodes, up to 4,194,304 pixels. Above that a one-byte stream stands in, because the validator refuses on the dimensions first.
- The JPEG and WebP builders are structurally complete, but their compressed bytes are placeholders and do not decode. The file header says so.
- The earlier header-only shapes are kept as `pngHeaderOnlyBytes`, `jpegHeaderOnlyBytes`, `webpVp8HeaderOnlyBytes` and `webpVp8xHeaderOnlyBytes`. The tests use them to show that such files are refused.

One existing case ("JPEG cut inside its frame header") now computes its cut from the header-only length, so it still cuts inside the frame header.

**New tests.** Nine refusal cases in `tests/unit/logo-validate.test.ts`:
- PNG cut after IHDR;
- header-only PNG (empty IDAT);
- PNG without IEND;
- PNG whose IDAT runs past the end of the file;
- header-only JPEG;
- JPEG without EOI;
- header-only VP8;
- VP8X with no image chunk;
- each WebP kind cut short of its RIFF size.

**Runs:**
- Red: the new tests and fixture against the old validator, `logo-validate` plus `logo-upload-route`: exit 1, 9 failed and 37 passed (46). Every existing case passed on the new fixture.
- Green: exit 0, 46 passed. `tsc` exit 0.
- Integration, logo files only: `logo-routes` and `logo-store` (Testcontainers): exit 0, 2 files, 20 passed. That run also includes c-IN-02's new case.
- Ad hoc check, not committed: PNG, baseline and progressive JPEG, and lossy, lossless and alpha WebP encoded by `sharp` (present through Next) all pass, and each one cut in half is `unreadable`.

**Commit:** `3d2acff` fix(09-F1): c-WR-01 logo validation requires image data, not only a header

### c-WR-02 / K147: app-level error boundary with one h1

**Change.** New `src/app/(app)/error.tsx` (client component). It is inside the `(app)` layout, so the sidebar and the top bar stay, and it renders inside `<main>`. It shows one `sr-only` `<h1>` with the top-bar title for the current path, then the destructive callout "Couldn't load this page." with a Retry link button. It uses tokens only and `text-[13px]`, and it never shows error text.

The title mapping moved from `src/components/top-bar.tsx` to `src/lib/navigation/page-title.ts`, so the top bar and the boundary name a route the same way. The top-bar output is unchanged.

The boundary covers every route without its own boundary: `/kb` and its pages, `/insights` and every `/settings` page. `tickets`, `tickets/[id]` and `contacts` keep their own boundaries.

**Fault hook.** The existing hook cannot reach these routes, so I added two fault points to `src/lib/testing/e2e-fault.ts`, `kb-page` and `settings-backups-page`. They use the same production-inert gate and are called first in `kb/page.tsx` and `settings/backups/page.tsx`. `tests/unit/e2e-fault.test.ts` lists them (10 passed).

**Spec.** `tests/e2e/single-h1.spec.ts` gets two error rows, `/kb` (h1 "Knowledge Base") and `/settings/backups` (h1 "Settings"). Every error row now also checks that the top bar is still present.

**Runs** (E2E, `--grep "normal, search|error states"`, because the error rows need the ticket that the normal case seeds):
- Red attempt 1, command started 19:45:53 with `error.tsx` moved to the scratchpad: exit 1 at 19:46:38. The E2E global setup hung on `/setup` (owner item next-o1): `TimeoutError: page.waitForURL: Timeout 30000ms exceeded` at `global-setup.ts:174`. The server log shows only repeated `GET /setup` and no POST. I copied the log, then moved `.next` to the Trash folder `aida-next-1794487643` at 19:47:23. E2E config and `next.config.ts` are unchanged.
- Red attempt 2, 19:47:29: exit 1, 1 failed and 1 passed. In the error-states case the four existing rows passed and the `/kb` row failed: "Couldn't load this page." was not found in `main`.
- Green: restored with `cp`, `cmp` exit 0. Exit 0, 2 passed.
- Full spec: see "Final checks".

**Commit:** `4cecdfc` fix(09-F1): c-WR-02 app-level error boundary with one h1 (K147)

### c-WR-03: route list compared with the page files on disk

**Change.** New `tests/unit/single-h1-route-list.test.ts`. It walks `src/app/(app)` for `page.*` files (route groups add no segment) and requires the `APP_PAGE_ROUTES` literal of `tests/e2e/single-h1.spec.ts` to equal that list. A new page therefore fails here until it is listed, and the spec's last case then requires a case that renders it. The E2E spec itself stays browser-only.

**Runs:**
- Green: exit 0, 2 passed.
- Red: a copy of the spec with `"/settings/tags"` removed from the list: exit 1, 1 failed and 1 passed. The diff names `/settings/tags`. Restored with `cp`, `cmp` exit 0.

**Commit:** `803cea0` fix(09-F1): c-WR-03 unit test pins single-h1 route list to the pages on disk

### c-IN-02: the public logo throttle runs before parameter work

**Change.** New case in `tests/integration/logo-routes.test.ts`. One identity sends 300 requests with malformed parameters (`../x`, `not-a-version`), each answering 404, and the 301st answers 429 `rate_limited`.

**Runs** (Testcontainers):
- Red: a mutation of `src/app/api/public/logo/[orgId]/[version]/route.ts` moved the limiter below the `ORG_ID`/`VERSION` check. Exit 1, 1 failed and 6 passed (7): 404 instead of 429. Restored with `cp`, `cmp` exit 0.
- Green: `logo-routes` and `logo-store`: exit 0, 2 files, 20 passed.

**Commit:** `ac72dc1` fix(09-F1): c-IN-02 test that the public logo throttle runs before parameter work

### c-IN-05: no success message when there was no logo to remove

**Change.** `src/app/(app)/settings/branding/logo-card.tsx` reads `removed` from the DELETE answer. When it is `false`, the card shows the neutral toast "There was no logo to remove." instead of "Logo removed.". The dialog closes and the page refreshes as before.

**Test.** New case in `tests/e2e/logo.spec.ts`. A logo is set and the page shows it. Another admin then removes it through the API, and the UI removal shows the neutral message, no success message, and the no-logo state.

**Runs:**
- Red: the new case against the old card: exit 1, 1 failed (the message was not visible).
- Green: the full `logo.spec.ts`: exit 0, 14 passed. The original remove case still shows "Logo removed.".

**Commit:** `1e3d2b4` fix(09-F1): c-IN-05 no success message when there was no logo to remove

### Other part c info items

c-IN-01, c-IN-03, c-IN-04, c-IN-06 (accepted as is, per the dispositions), c-IN-07 and c-IN-08 are recorded unchanged in `deferred-items.md`, one line each with the finding id.

**Commit:** `19dcca5` docs(09-F1): record part c info items not fixed in F1

### Final checks

| Command | Exit | Counts |
|---|---|---|
| `pnpm lint` | 0 | 669 files, 1 warning, pre-existing: `tests/unit/container-config.test.ts:160`, a file F1 did not touch |
| `pnpm typecheck` | 0 | 0 errors |
| `pnpm test` | 0 | 93 files, 1662 tests passed |
| `playwright test tests/e2e/single-h1.spec.ts` (full) | 0 | 9 passed |
| `playwright test tests/e2e/logo.spec.ts` (full) | 0 | 14 passed |
| `vitest --config vitest.integration.config.ts` logo-routes and logo-store | 0 | 2 files, 20 passed |

The full integration suite was not run. Only the two logo integration files were, because they are the ones whose fixture or cases F1 changed.

### Not done, and limits

- **Manual items:** no visual, dark-mode or screen-reader check of the new error state or the neutral toast. These stay manual.
- **`/settings` error state:** the app-level boundary sits above `src/app/(app)/settings/layout.tsx`, so an error on a `/settings` page replaces the settings sub-navigation along with the page. The sidebar and the top bar stay.
- **`/insights` error h1:** it reads "AIDA", because the shared title mapping (like the top bar) has no `/insights` entry.
- **Fixtures:** the JPEG and WebP fixtures are complete in structure only. Their compressed bytes do not decode. The PNG fixture decodes.
- **Animated WebP (c-IN-04):** WebP `ANMF` frames are accepted when they are larger than their 16-byte frame header. Refusing animated WebP is deferred.
- **`.next`:** moved once to the Trash folder `aida-next-1794487643` because of next-o1 (details under c-WR-02).
