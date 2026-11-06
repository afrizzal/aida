---
phase: 09-operations
part: c (logo backend and UI, public pages, one h1 per route state, the Backups tab, the E2E fault hook)
reviewed: 2026-11-12T00:00:00Z
depth: standard
diff_range: b511b3b..HEAD
files_reviewed: 35
files_reviewed_list:
  - src/app/(app)/contacts/[id]/page.tsx
  - src/app/(app)/contacts/error.tsx
  - src/app/(app)/contacts/page.tsx
  - src/app/(app)/kb/[id]/page.tsx
  - src/app/(app)/kb/page.tsx
  - src/app/(app)/kb/proposals/[id]/page.tsx
  - src/app/(app)/kb/proposals/page.tsx
  - src/app/(app)/layout.tsx
  - src/app/(app)/settings/backups/page.tsx
  - src/app/(app)/settings/branding/branding-form.tsx
  - src/app/(app)/settings/branding/logo-card.tsx
  - src/app/(app)/settings/branding/page.tsx
  - src/app/(app)/settings/settings-nav.tsx
  - src/app/(app)/settings/statuses/page.tsx
  - src/app/(app)/tickets/[id]/error.tsx
  - src/app/(app)/tickets/[id]/page.tsx
  - src/app/(app)/tickets/error.tsx
  - src/app/(app)/tickets/page.tsx
  - src/app/(app)/tickets/ticket-list-panel.tsx
  - src/app/(public)/request/page.tsx
  - src/app/(public)/status/[token]/page.tsx
  - src/app/api/public/logo/[orgId]/[version]/route.ts
  - src/app/api/settings/branding/logo/route.ts
  - src/components/brand-mark.tsx
  - src/components/empty-state.tsx
  - src/components/public/public-page-shell.tsx
  - src/components/sidebar.tsx
  - src/components/top-bar.tsx
  - src/lib/branding/logo-store.ts
  - src/lib/branding/logo-validate.ts
  - src/lib/branding/public-brand.ts
  - src/lib/branding/settings.ts
  - src/lib/rate-limit/public-limits.ts
  - src/lib/testing/e2e-fault.ts
  - src/lib/tickets/status-page-data.ts
coverage_note: "The new files were read in full: both logo routes, logo-store.ts, logo-validate.ts, public-brand.ts, e2e-fault.ts, brand-mark.tsx, logo-card.tsx, the Backups page and the app layout. The other files were read as their diff against b511b3b, plus the surrounding branch where a change needed context (the status page, both branches; the branding page). The helpers the new code calls were read at the call site: getOrgRole and isAdminRole, getCurrentSession and getScopedDb, buildStorageKey and the local storage read path, parseBackupStatus, and the cookieCache line of src/lib/auth.ts. Tests were read for what they assert: tests/unit/logo-upload-route.test.ts, tests/unit/e2e-fault.test.ts, the logo section of tests/unit/proxy.test.ts, the test lists of tests/unit/logo-validate.test.ts and tests/integration/logo-store.test.ts, tests/integration/logo-routes.test.ts (404 and 429 cases), and the route list, assertion helper and fault-hook cases of tests/e2e/single-h1.spec.ts. The test lists of logo.spec.ts and backups-status.spec.ts were read, plus their svg and fallback cases. The merge-provenance pin change was read through the 09-07 SUMMARY deviation only. The binding context was 09-CONTEXT (D-07 to D-11, D-14, U-01 to U-18), the 09-UI-SPEC sections for Surfaces 1, 2, 4 and 5, and the deviations in the 09-07 and 09-09 SUMMARYs. Nothing was run: no tests, build, Docker or E2E."
findings:
  critical: 1
  warning: 3
  info: 8
  total: 12
status: issues_found
---

# Phase 9: Code Review Report (part c: logo, public pages, single h1, Backups tab, E2E fault hook)

**Reviewed:** 2026-11-12
**Depth:** standard (see coverage note)
**Files Reviewed:** 35
**Status:** issues_found

## Summary

**Public logo route.** I traced each property and it holds:
- The limiter runs before any parameter or database work.
- `orgId` and `version` are checked against strict patterns, so neither a dot nor a slash reaches `path.join`.
- The storage key and the MIME type come only from the stored, strictly parsed reference (`parseLogoSetting`). The key pattern matches what `buildStorageKey` produces.
- The response sends the stored type, `nosniff`, `inline` and an immutable cache header.
- Every miss returns the same 404 body: unknown organization, no logo, another version, malformed input, or a missing file. The route is under the existing `/api/public` prefix, and the CSP `img-src 'self'` covers it.
- An SVG can never be stored. A `<svg` or `<?xml` head is refused as `svg`, and anything else fails the PNG/JPEG/WebP allow-list.

**Logo store.** The advisory lock serializes replace and remove. Every dereferenced key is enqueued in the same transaction that dereferenced it, and nothing in the store deletes a referenced file.

**Upload and remove route.** Role and session are checked before the body is read, and the unit tests pin this with `request.bodyUsed === false`. One authorization gap remains: the active organization and the role come from two independent session reads (CR-01).

**Status page.** An invalid token renders no brand row and runs no organization or setting query, so it reveals nothing. A valid token now shows the ticket's own organization id, but only inside the logo URL and only when a logo is set. I judge that acceptable (IN-06).

**E2E fault hook.** I found no way for it to act in production:
- The literal `process.env.NODE_ENV === "production"` check comes first, and Next inlines it at build time.
- The flag has to be exactly `"1"`, and nothing outside `tests/e2e/global-setup.ts` sets `AIDA_E2E_FAULTS`.
- `cookies()` is never called while the gate is closed, and a unit test pins that.

**Design and accessibility.** Tokens are used throughout and text sizes are explicit `text-[Npx]`. The `gap-2` brand row is a recorded UI-SPEC revision. Alt text follows the contract: `alt=""` next to the visible name, and a descriptive alt on the settings preview. The file input is `sr-only` and reached through a real button.

**Weak points:**
- The validator accepts files that contain only an image header (WR-01).
- The one-h1 rule is not met for error states on the routes that have no `error.tsx` (WR-02).
- The "every app route" E2E test uses a hand-kept list, so it cannot fail when a route is added (WR-03).

## Critical Issues

### c-CR-01: The logo admin gate reads the session twice, so a member can change another organization's logo by switching organization mid-request

**File:** `src/app/api/settings/branding/logo/route.ts:45-59` (with `src/lib/session.ts:12-41`, `src/lib/authz.ts:11-17`)
**Issue:** `requireLogoAdmin` takes `orgId` from `getScopedDb()` and then the role from `getOrgRole()`. Each helper calls `auth.api.getSession({ headers })` on its own; there is no request-level memo in a route handler. Both reads use `session.activeOrganizationId`, but nothing ties the second value to the first.

`src/lib/auth.ts:11` enables `cookieCache`, but a client can simply leave out the cache cookie. Better Auth then reads the session row from the database on each call. So between the two reads, the active organization can change.

Failure scenario: a user is an admin of organization A and a plain member of organization B. The active organization is B.
1. The user sends `POST /api/settings/branding/logo`, and also, concurrently, Better Auth's `organization/set-active` for A (the plugin endpoint exists even though the UI does not call it).
2. `getScopedDb()` reads B, so `gate.orgId = B`.
3. The set-active commits.
4. `getOrgRole()` reads A and returns `admin`.
5. `replaceLogo({ orgId: B })` runs, and B's sidebar and public pages show the member's image. `DELETE` works the same way.

The window is one database round trip. The upload route has no throttle, so the attacker can retry until the race is won. This breaks D-08 ("Only org owners and admins may upload or remove"). The unit tests mock both helpers separately, so they cannot see this.

The same two-read pattern exists in older server actions (`requireOrgAdmin()` followed by `getScopedDb()`). Those are outside part c, but they should get the same fix.
**Fix:** Read the session once, then look up the role for that exact organization:
```ts
async function requireLogoAdmin(): Promise<AdminGate> {
  const session = await getCurrentSession().catch(() => null);
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) return { ok: false, response: codeResponse("unauthorized", 401) };
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id, organizationId: orgId },
    select: { role: true },
  });
  if (!isAdminRole(member?.role)) return { ok: false, response: codeResponse("not_allowed", 403) };
  return { ok: true, orgId };
}
```
Better still, add `getOrgRoleFor(userId, orgId)` to `authz.ts` and use it here and in `requireOrgAdmin`. Add a unit test in which the two session reads return different organizations, and expect 403 or a write to the role-checked organization only.

## Warnings

### c-WR-01: Header-only validation accepts truncated or pixel-less images, and the Sparkles fallback then never triggers

**File:** `src/lib/branding/logo-validate.ts:64-69`, `:101-120`, `:146-151`; `src/components/brand-mark.tsx:28-33`
**Issue:** `validateLogo` reads only the signature and the dimension header. A PNG cut after IHDR, a JPEG cut after its SOF, or a WebP that holds a `VP8X` chunk and nothing else all pass as `ok`. The 09-07 SUMMARY (deviation 1) records the consequence: Chrome loads such a PNG "from its header (32 x 32, no pixels) without an error event". `naturalWidth` is then non-zero, so neither `onError` nor the `naturalWidth === 0` effect switches to the Sparkles box.

Failure scenario: an admin uploads a logo from an export that was interrupted, or from a partial download. The upload answers "Logo uploaded.". From then on, the sidebar of every member and both public pages show an empty 72 px box next to the name. This is exactly the case where the "unreadable" copy ("This image could not be read") should have shown.

The tests cannot catch it: the shared fixture `tests/support/logo-images.ts` (`pngBytes`) is itself header-only, so it pins acceptance of this shape.
**Fix:** Check that the file is structurally complete, still without decoding pixels:
- **PNG:** walk the chunks (length + type + CRC framing), require at least one `IDAT` and a final `IEND`, and refuse `acTL` (this also replaces the APNG reliance on file-type).
- **JPEG:** require an SOS segment after the frame header and `FF D9` at the end.
- **WebP:** require the RIFF size field to equal `length - 8`, and require the `VP8`/`VP8L` chunk (or the `ANMF`/`VP8` chunk after `VP8X`) to fit inside the buffer.

Change the fixtures to complete images, and add one "truncated after the header" refusal test per format.

### c-WR-02: Error states on routes without an `error.tsx` render no h1 and no `main`, against D-14

**File:** `src/app/(app)/` (no `error.tsx` above `kb/`, `kb/new`, `kb/[id]`, `kb/proposals*`, `insights/` or `settings/*`; no `src/app/error.tsx` either)
**Issue:** D-14 says "Each rendered app route state (normal, loading, error, empty) has exactly one `<h1>`". Only `tickets/`, `tickets/[id]/` and `contacts/` have error boundaries. The UI-SPEC Surface 5 table lists error rows only for those routes, and 09-09 implemented the table. A server error on any other app route is handled by Next's built-in error page. That page replaces the whole app shell and has no `<main>` and no `<h1>`.

Failure scenario: the database blips while an admin opens `/settings/backups` or `/kb`. The rendered state has zero h1, the screen-reader user loses the sidebar and the top bar, and there is no retry. AIDA-36 is recorded as closed although D-14's error clause holds for 4 of the 18 routes only. `single-h1.spec.ts` checks routes, not states (WR-03), so it stays green.
**Fix:** Add one `src/app/(app)/error.tsx` (client component). It should render an `sr-only` `<h1>` with the top-bar text for the current path (`usePathname`, mapped the way `TopBar` maps it), followed by the destructive callout pattern with a Retry link. Because it sits inside the `(app)` layout, the sidebar and top bar stay. Add an E2E fault point to at least one KB page and one settings page, plus error rows in the spec. Alternatively, record the narrowing of D-14 as an owner item and reopen the AIDA-36 row until that is decided.

### c-WR-03: The "every app route" E2E test uses a hand-kept list, so it cannot fail for a route added later

**File:** `tests/e2e/single-h1.spec.ts:50-71` (and its final "every listed route was rendered" case)
**Issue:** `APP_PAGE_ROUTES` is a literal array. It matches the 18 `page.tsx` files on disk today. The closing case only checks that each listed route was rendered at least once. A new `src/app/(app)/**/page.tsx` that renders two h1, or none, is therefore never visited, and the spec keeps passing. D-14 asks for "An E2E test [that] enumerates every app route". A literal list enumerates every route only as of the day it was written.
**Fix:** In the spec (Node side, before the cases), derive the list from disk and compare it with the literal list:
```ts
const onDisk = globSync("src/app/(app)/**/page.tsx", { cwd: repoRoot })
  .map((f) => "/" + path.dirname(path.relative("src/app/(app)", f)).replaceAll(path.sep, "/"))
  .map((r) => (r === "/." ? "/" : r)).sort();
expect(onDisk).toEqual([...APP_PAGE_ROUTES].sort());
```
That way a new page fails the spec until someone adds a case for it.

## Info

### c-IN-01: Any error in the admin gate becomes a silent 401 "unauthorized"

**File:** `src/app/api/settings/branding/logo/route.ts:50-55`
**Issue:** The `catch {}` maps every throw from `getScopedDb()` or `getOrgRole()` to 401 with no log line. That covers the expected redirect, but also a Prisma connection error in the member lookup. The UI shows the generic save failure, and the operator finds nothing in the log.
**Fix:** Treat only `isRedirectError(err)` and the no-active-organization throw as 401. For anything else, log `logFailure("auth", err)` and answer 500 `failed`. The CR-01 fix makes this simpler.

### c-IN-02: No test proves the logo route throttles before it validates parameters

**File:** `tests/integration/logo-routes.test.ts:111-133`
**Issue:** The 429 case uses well-formed parameters only. The test would still pass if the limiter moved below the `ORG_ID`/`VERSION` check, and then malformed requests would never be throttled. "Throttle first" (D-21 order, part of the brief) is correct in the code today, but nothing pins it.
**Fix:** Send 300 requests with malformed parameters (for example `"../x"`), then expect the 301st to answer 429.

### c-IN-03: A replace whose commit outcome is ambiguous discards a file that the committed setting may reference

**File:** `src/lib/branding/logo-store.ts:92-121`
**Issue:** Suppose `prisma.$transaction` throws after the database has committed, for example because the connection dropped while the COMMIT reply was in flight. The `catch` then calls `staged.discard()` on the key the new setting references, and the logo becomes a permanent 404. The Sparkles fallback hides it, but the UI said the upload failed while the setting changed. This is rare, but it contradicts the module's claim that "the setting therefore always names a stored file".
**Fix:** Before discarding, re-read the setting outside the transaction. Discard only if it does not name `key`. If it does name `key`, return success, or log and leave the file.

### c-IN-04: Animated WebP passes while APNG and GIF are refused

**File:** `src/lib/branding/logo-validate.ts:114-118`
**Issue:** A `VP8X` file with the animation flag (bit 1 of byte 20) and `ANMF` frames is accepted. The module header and the tests treat animated formats (APNG, GIF) as `not_image`, so the policy is inconsistent. An animated logo also loops in the sidebar of every member.
**Fix:** Refuse `VP8X` with flag `0x02` set as `not_image`, or document that animated WebP is allowed.

### c-IN-05: Removing when no logo exists still shows "Logo removed."

**File:** `src/app/(app)/settings/branding/logo-card.tsx:140-148`
**Issue:** `DELETE` answers `{ ok: true, removed: false }` when another admin has already removed the logo. The card ignores `removed` and shows the success toast anyway. This is harmless but inaccurate.
**Fix:** Read `removed`. When it is false, show a neutral "There was no logo to remove." and refresh.

### c-IN-06: The organization id in a valid status page's logo URL is acceptable

**File:** `src/lib/tickets/status-page-data.ts` (new `organizationId`); `src/app/(public)/status/[token]/page.tsx:52-61`; `src/lib/branding/public-brand.ts:35`
**Issue:** No change is needed. The id reaches the client only inside `logoPublicUrl`, only for a valid token, and only when a logo is set. It grants no access: the logo route also needs the 48-bit current version, and that version serves only the image already visible on the page. The full status object is not passed to a client component. The merge-provenance pin was updated, and it still asserts that the id is the source's own organization, which names nothing about a merge target.

The only new fact a customer learns is a stable tenant identifier. That matters only on a multi-tenant host, where two status links from different workspaces become distinguishable. Record that in `docs/SECURITY.md` next to the logo cache note.

### c-IN-07: The Backups tab shows instance-wide state to every organization's admins

**File:** `src/app/(app)/settings/backups/page.tsx:40-51`, `:133-141`
**Issue:** The role check is correct and runs before the read. But the record is a `SystemSetting`, so the admin of any workspace on a shared instance sees the operator's backup result, set id and failure category. The page also tells them to run `docker compose logs backup`, which only the server operator can do. Organizations are created by invitation only (`allowUserToCreateOrganization: false`), so this is low risk, and it matches D-04 as written.
**Fix:** Either note in D-04 and `docs/OPERATIONS.md` that every workspace admin sees the status, or gate the page on an instance-operator check once one exists.

### c-IN-08: The logo routes rely on SameSite=Lax only, because route handlers get no Origin check

**File:** `src/app/api/settings/branding/logo/route.ts:71-113`
**Issue:** This route was moved from a server action to a route handler because of the body limit, and route handlers do not get the Origin check that server actions have. A cross-site form POST does not carry the Lax session cookie, so this is safe across sites. A page on a sibling subdomain of the same site, which is common on self-hosted domains, is same-site, though. Such a page can POST a multipart logo upload with the admin's cookies.
**Fix:** Refuse requests whose `Origin` is present and differs from the app origin (or whose `Sec-Fetch-Site` is not `same-origin`), before the gate. Add one unit test for it.

---

_Reviewed: 2026-11-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
