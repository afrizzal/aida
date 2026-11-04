---
phase: 09-operations
plan: 05
subsystem: api
tags: [logo, uploads, file-type, advisory-lock, rate-limit, file-cleanup, testcontainers]

requires:
  - phase: 09-operations plan 09-04
    provides: "fenced ProjectFileCleanup sweep, exclusive-create saves, saveStagedFiles EEXIST rule, tests/support/file-fence-fixtures.ts (testUploadsDir, testFenceProvider, trackFence, backupEmulator), the static callers list"
  - phase: 09-operations plan 09-02
    provides: "Setting-key conventions next to branding:* (demo:seed-complete); no code dependency"
  - phase: 08-security-hardening (Part A)
    provides: "consumeRateLimit, getRateLimitIdentity, PUBLIC_RATE_LIMITS, rateLimitedResponse, readBoundedFormData with maxParts, the nonce CSP with img-src 'self'"
provides:
  - "src/lib/branding/logo-validate.ts: validateLogo(bytes), LOGO_MAX_BYTES, LOGO_MAX_PIXELS, LOGO_EXTENSIONS, LogoRefusalCode, LogoValidation"
  - "src/lib/branding/logo-store.ts: replaceLogo, removeLogo, readCurrentLogo, LOGO_LOCK_PREFIX, LogoStoreHooks, ReplaceLogoResult"
  - "src/lib/branding/settings.ts: BRANDING_SETTING_KEYS.logo, LOGO_MIME_TYPES, LogoMimeType, LogoSetting, isLogoMimeType, parseLogoSetting, getLogoSetting, logoPublicUrl"
  - "POST and DELETE /api/settings/branding/logo (owner or admin)"
  - "GET /api/public/logo/<orgId>/<version> (public, public-logo limiter)"
  - "PUBLIC_RATE_LIMITS.logo = { scope: public-logo, max: 300, windowMs: 60000 }"
  - "tests/support/logo-images.ts: pngBytes, jpegBytes, webpVp8Bytes, webpVp8lBytes, webpVp8xBytes, padTo"
affects: [09-07 logo UI, public pages and E2E, 09-06 and 09-10 backup verification of logo keys, Phase 8.1 replan (docs/SECURITY.md, src/proxy.ts, CSP)]

actuals:
  tokens: 18675
  tasks: 3
  commits: 3
plan_head_before: 88e7294f5965f29120a3181d22fdbdd9181ca6f5

tech-stack:
  added: []
  patterns:
    - "Image header dimensions read by hand (PNG IHDR, JPEG SOF walk, WebP VP8, VP8L, VP8X); no decode, no package"
    - "A per-organization transaction-level advisory lock taken first in every write of one Setting key, with the dereferenced storage key enqueued in the same transaction"
    - "Forced interleavings through store test hooks (afterStaged, beforeLock, afterLock) and waitForBlockedBy on recorded backend PIDs"

key-files:
  created:
    - src/lib/branding/logo-validate.ts
    - src/lib/branding/logo-store.ts
    - src/app/api/settings/branding/logo/route.ts
    - src/app/api/public/logo/[orgId]/[version]/route.ts
    - tests/support/logo-images.ts
    - tests/unit/logo-validate.test.ts
    - tests/unit/logo-upload-route.test.ts
    - tests/integration/logo-store.test.ts
    - tests/integration/logo-routes.test.ts
  modified:
    - src/lib/branding/settings.ts
    - src/lib/rate-limit/public-limits.ts
    - docs/SECURITY.md
    - tests/unit/proxy.test.ts
    - tests/unit/file-delete-callers.test.ts

key-decisions:
  - "A file whose sniff fails but that starts like PNG, JPEG or RIFF is unreadable (a truncated file), not not_image; safety is unchanged because only the three sniffed types pass"
  - "APNG (sniffed image/apng) is refused as not_image; only image/png, image/jpeg and image/webp are allowed"
  - "replaced is true only when a valid previous reference existed; a malformed stored value counts as no logo and nothing is enqueued for it"
  - "readCurrentLogo treats a referenced file that is gone (ENOENT) as a miss (404); any other read error propagates"
  - "The logo MIME allow-set lives in settings.ts (client- and worker-safe), so the validator imports it and settings.ts never imports file-type"
  - "Store hooks beforeLock and afterLock were added next to afterStaged, so the P10 tests can prove the lock by recorded PIDs instead of by timing"

patterns-established:
  - "Every write of branding:logo goes through logo-store.ts under the organization's logo lock and enqueues the dereferenced key; nothing in it deletes a file"

requirements-completed: []
requirements-partial: [AIDA-34]

coverage:
  - id: D1
    description: "Byte-sniffed PNG, JPEG and WebP accepted with header dimensions; SVG, GIF, PDF, APNG and noise refused; empty and truncated input unreadable; 1,048,576 bytes accepted, 1,048,577 refused; 1024 x 1024 accepted, 1025 on either side refused"
    requirement: AIDA-34
    verification:
      - kind: unit
        ref: "tests/unit/logo-validate.test.ts (25 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Replace stores an immutable new key and enqueues the previous key in the same transaction; remove deletes the setting and enqueues its key; failed transactions leave the setting, write no queue row and discard the staged file"
    requirement: AIDA-34
    verification:
      - kind: integration
        ref: "tests/integration/logo-store.test.ts (replace and remove, 6 cases; tracer)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fence held: the sweep leaves a replaced or removed logo's file while a backup holds the fence and removes it after release"
    requirement: AIDA-34
    verification:
      - kind: integration
        ref: "tests/integration/logo-store.test.ts#fence held (2 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "P10: two replaces in both orders and remove during replace (both holders) leave the referenced key with its file and a queue row for every other stored key"
    requirement: AIDA-34
    verification:
      - kind: integration
        ref: "tests/integration/logo-store.test.ts#both orders (2) and remove during replace (2)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Public route: current version served with stored MIME, nosniff, inline and immutable caching; other version, unknown organization, no logo and malformed parameters answer one 404; the 301st request of one identity answers 429 with Retry-After"
    requirement: AIDA-34
    verification:
      - kind: integration
        ref: "tests/integration/logo-routes.test.ts (6 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Admin route order and codes: 401 without a session, 403 not_allowed for a member or no member row before any body read, 413 too_large, 400 with the refusal code, 500 failed with no raw text, revalidation on success"
    requirement: AIDA-34
    verification:
      - kind: unit
        ref: "tests/unit/logo-upload-route.test.ts (12 cases, session, role and store replaced)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Member and unauthenticated upload and remove through the real UI session"
    requirement: AIDA-34
    verification: []
    human_judgment: true
    rationale: "Plan 09-07's E2E, as the plan states; not run here"
  - id: D8
    description: "Proxy: /api/public/logo/a/b is public, /api/settings/branding/logo is authenticated; src/proxy.ts unchanged"
    requirement: AIDA-34
    verification:
      - kind: unit
        ref: "tests/unit/proxy.test.ts#X and #Y"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-11-12
status: complete
---

# Phase 9 Plan 05: Logo backend Summary

**The workspace logo backend is in place. Bytes are byte-sniffed (PNG, JPEG or WebP only, SVG refused) and checked against 1 MiB and against 1024 x 1024 pixels read from a hand-written header reader. Each logo is an immutable file referenced by `branding:logo`. Replace and remove run under a per-organization advisory lock and enqueue the old key in the single deletion queue in the same transaction. Uploads go through an owner/admin-only route handler with a bounded one-part body. A throttled public route (`public-logo`, 300 per 60 s) serves only the current version with nosniff and immutable caching, without touching `src/proxy.ts` or the CSP.**

## Performance

- **Duration:** about 18 min (2026-11-12T08:50:17Z to 2026-11-12T09:07:53Z, before the SUMMARY)
- **Tasks:** 3 of 3
- **Files:** 9 created, 5 modified (14 in the plan diff)

## Accomplishments

- `validateLogo` checks in this order: empty (unreadable), more than 1,048,576 bytes (too_large), SVG text after an optional BOM and whitespace (svg), the `file-type` sniff with an allow-set of three types (not_image, or unreadable for a truncated file of an allowed format), then the header dimensions (unreadable or too_many_pixels). The JPEG walker skips DHT (0xC4), JPG (0xC8) and DAC (0xCC), and it stops with unreadable at SOS or EOI before a frame header. Dimensions are 32-bit for PNG, so no width wraps.
- `replaceLogo` validates the bytes and stages them under `buildStorageKey("logo.<ext>")`, with the extension taken from the sniffed type. Then, in one transaction, it takes `pg_advisory_xact_lock(hashtextextended('aida:branding-logo:' || orgId, 0))`, reads the current row by organization id and key, writes the new JSON with a fresh 12-hex version (update or create), and enqueues the previous key. Any throw discards the staged file. `removeLogo` takes the same lock, deletes the row and enqueues its key. Neither deletes a file.
- `readCurrentLogo` is a bare prisma read selected by organization id and key. It returns the bytes only for the exact current version, and treats ENOENT as a miss.
- The public route limits first and checks the parameters with `^[A-Za-z0-9_-]{1,64}$` and `^[0-9a-f]{12}$`. Every miss gets the same 404 `{ error: "not_found" }`, without caching headers.
- `POST /api/settings/branding/logo` and `DELETE` check the session first (`getScopedDb`, 401 `unauthorized`) and the role second (`getOrgRole` plus `isAdminRole`, 403 `not_allowed`). Only then does POST read `readBoundedFormData(request, LOGO_MAX_BYTES + 65_536, { maxParts: 1 })`. Error mapping: an oversized body is 413 `too_large`; a missing or non-file `file` field, a second part or a non-form body is 400 `unreadable`; a validation refusal is 400 with its code; a thrown error is 500 `failed`, logged with the error code only. Success revalidates `/settings/branding` and the `/` layout and returns `{ ok: true, replaced, version }` or `{ ok: true, removed }`.

## Task Commits

1. **Task 1 (tracer): validation, immutable store and throttled public logo route** - `a6c95d2` (feat)
2. **Task 2: admin logo route, validation matrix, fenced cleanup and P10 interleavings** - `b1be34c` (feat)
3. **Task 3: logo upload and public logo route in SECURITY.md** - `1b34cfb` (docs)

Tracer gate (`end-of-phase`, automated verify only): the Task 1 verify was green on the final Task 1 code (re-run after formatting) before Task 2 started.

## U-02 contract

This is the final contract for the Phase 8.1 replan.

| Item | Contract |
|---|---|
| Public route | `GET /api/public/logo/<orgId>/<version>`, `src/app/api/public/logo/[orgId]/[version]/route.ts`, `runtime = "nodejs"` |
| Parameters | `orgId` `^[A-Za-z0-9_-]{1,64}$`, `version` `^[0-9a-f]{12}$`; anything else is the 404 |
| 200 headers | `Content-Type` = stored sniffed MIME (`image/png`, `image/jpeg` or `image/webp`), `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: public, max-age=31536000, immutable` (the proxy also adds its own `nosniff`, `X-Frame-Options` and CSP on the way through) |
| Misses | 404 JSON `{ "error": "not_found" }` for an unknown organization, no logo, another version, malformed parameters or a referenced file that is gone |
| Limiter | `consumeRateLimit("public-logo", getRateLimitIdentity(request), { max: 300, windowMs: 60000 })` before any other work; 429 `{ "error": "rate_limited" }` with `Retry-After` from `rateLimitedResponse` |
| URL builder | `logoPublicUrl(orgId, version)` in `src/lib/branding/settings.ts` |
| Authenticated route | `POST` and `DELETE /api/settings/branding/logo`, `src/app/api/settings/branding/logo/route.ts`: 401 `{code:"unauthorized"}`, 403 `{code:"not_allowed"}`, 413 `{code:"too_large"}`, 400 `{code:"unreadable"|"svg"|"too_large"|"too_many_pixels"|"not_image"}`, 500 `{code:"failed"}`; form field `file`, one part, body bound `LOGO_MAX_BYTES + 65536` |
| Storage | `<UPLOADS_DIR>/<orgId>/<32 hex>.<png|jpg|webp>`, written with exclusive create (09-04); the old file is removed only by the fenced `ProjectFileCleanup` sweep |
| Setting | `branding:logo` = `{"storageKey","mimeType","version"}` per organization |
| `src/proxy.ts` | **not changed**; the route is public through the existing `/api/public` entry of `PUBLIC_PREFIXES` (`git diff --quiet HEAD -- src/proxy.ts` exit 0 after every task) |
| CSP | **not changed**; `img-src 'self' data: blob:` already allows the same-origin logo |
| `docs/SECURITY.md` | one new bullet in "AuthZ & tenancy" (Workspace logo); line 8 (build-time egress) unchanged, no advisory list added (owner item 08-o4) |
| Container ownership | logo files are written by the app process like attachments (default modes, `node` in the container); no compose change in this plan |

## Verification (exit codes read without a pipe)

Every Docker run used `AIDA_TEST_RUN_ID=mwdazqvv-9162d7a49f46bce6`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, one process at a time. `colima status` and `docker info` both exited 0 before the first Docker step.

| Command | Code state | Exit | Counts |
|---|---|---|---|
| `pnpm test:integration tests/integration/logo-store.test.ts tests/integration/logo-routes.test.ts`, RED | tests only, no implementation | 1 | 2 files failed (module `@/lib/branding/logo-store` missing), 7 skipped |
| same (Task 1 verify) | Task 1 | 0 | 2 files, 7 passed |
| `pnpm test:integration tests/integration/logo-routes.test.ts`, RED: nosniff header dropped, limiter max x1000, version check removed | mutated | 1 | 3 failed (headers, other version, 429), 3 passed |
| Task 1 verify, re-run after formatting (tracer gate) | final Task 1 | 0 | 7 passed |
| `pnpm typecheck` (Task 1) | Task 1 | 0 | 0 errors |
| `pnpm exec vitest run tests/unit/logo-validate.test.ts` | Task 1 validator | 0 | 25 passed (the validator came with Task 1, so red is by mutation below) |
| same, RED run A: DHT not skipped, VP8L without +1, BOM not skipped, byte limit `>=` | mutated | 1 | 8 failed, 17 passed |
| same, RED run B: pixel limit `>=`, truncated-prefix rule off, zero size allowed, VP8 start code unchecked, any JPEG segment read as a frame | mutated | 1 | 7 failed, 18 passed |
| `pnpm exec vitest run tests/unit/file-delete-callers.test.ts`, RED | after Task 1, old list | 1 | 1 failed (caller set gained `src/lib/branding/logo-store.ts`), 4 passed |
| `pnpm test:integration tests/integration/logo-store.test.ts` | Task 2 | 0 | 13 passed |
| same, RED run 1: current reference read before the lock (the P10 race) in replace and remove | mutated | 1 | 4 failed (both orders x2, remove during replace x2; the invariant found an unreferenced key with no queue row), 9 passed |
| same, RED run 2: no enqueue in replace and remove, no staged discard | mutated | 1 | 9 failed, 4 passed |
| `pnpm exec vitest run tests/unit/logo-upload-route.test.ts` | Task 2 | 0 | 12 passed |
| same, RED: body read before the gate, member treated as admin, raw error text in the 500 | mutated | 1 | 4 failed, 8 passed |
| `pnpm exec vitest run tests/unit/proxy.test.ts`, RED: `/api/public` removed from `PUBLIC_PREFIXES` | mutated (restored, `git diff --quiet HEAD -- src/proxy.ts` exit 0) | 1 | 1 failed (X), 28 passed |
| `pnpm exec vitest run tests/unit/logo-validate.test.ts tests/unit/proxy.test.ts tests/unit/file-delete-callers.test.ts tests/unit/logo-upload-route.test.ts` (Task 2 verify plus the route test) | final | 0 | 4 files, 72 passed |
| `pnpm test:integration tests/integration/logo-store.test.ts` (Task 2 verify) | final | 0 | 13 passed |
| `grep -n "public-logo" docs/SECURITY.md` | final | 0 | 1 line |
| `pnpm lint` | final | 0 | 647 files, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`, `noTemplateCurlyInString`) |
| `pnpm typecheck` | final | 0 | 0 errors |
| `pnpm test` (full unit) | final | 0 | 85 files, 1520 passed |
| `pnpm test:integration` (full, once) | final | 0 | 109 files, 1455 passed, 243 s |

Every mutation was made in place on a file backed up to the session scratch directory and restored with `cp`. A `cmp` against the backup confirmed each restore. No `git stash` was used.

### Acceptance criteria

- Task 1: `git diff --quiet HEAD -- src/proxy.ts` exit 0; the public route matches `consumeRateLimit`, `getRateLimitIdentity` and `rateLimitedResponse`, and also `nosniff`; `"public-logo"` matches in `public-limits.ts`; `git diff --quiet HEAD -- package.json pnpm-lock.yaml` exit 0; `from "@/` in `settings.ts` prints nothing; the verify exits 0. PASS.
- Task 2: `logo-validate.test.ts` has 25 cases (at least 16 required). `logo-store.test.ts` names "fence held" (2), "both orders" (2) and "remove during replace" (2). `readBoundedFormData` with `maxParts: 1` matches in the admin route. Both verify commands exit 0. PASS.
- Task 3: SECURITY.md names the cache non-revocation and the 404 for old versions; this SUMMARY has the "U-02 contract" section. PASS.

## Decisions Made

See `key-decisions` in the front matter. In short: truncated files of an allowed format are `unreadable`; APNG is refused; a malformed stored reference counts as no logo; a missing referenced file is a 404; the MIME allow-set lives in the client-safe `settings.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Test coverage] Unit test for the admin route's gate and codes**
- **Found during:** Task 2
- **Issue:** the plan proves the member and session cases of the admin route only through 09-07's E2E, so this plan would ship the 401, 403-before-body, 413, 400 and 500 mapping with no test and no red-before-green evidence (a run rule).
- **Fix:** `tests/unit/logo-upload-route.test.ts` replaces `getScopedDb`, `getOrgRole`, the store and `revalidatePath`, and uses the real `readBoundedFormData` and `isAdminRole`. It also checks that a refused caller's body is never read (`request.bodyUsed === false`). The real-session E2E stays with 09-07.
- **Files:** `tests/unit/logo-upload-route.test.ts` (outside `files_modified`)
- **Commit:** `b1be34c`

**2. [Rule 3 - Shared test helper] `tests/support/logo-images.ts`**
- **Issue:** the unit and integration files both need byte-built PNG, JPEG and WebP headers, and the plan forbids committed binary fixtures.
- **Fix:** one support module with CRC-correct PNG chunks, a JPEG with APP0, DHT and SOF, and the three WebP chunk types.
- **Commit:** `a6c95d2`

**3. [Precision] Extra store hooks and extra exports**
- `LogoStoreHooks` has `beforeLock` and `afterLock` besides the planned `afterStaged`. They let the P10 tests record each run's backend PID and wait on `waitForBlockedBy` instead of timing. Production callers pass no hooks.
- Extra exports: `LOGO_EXTENSIONS`, `LogoRefusalCode`, `LogoValidation` (validator); `LOGO_LOCK_PREFIX`, `LogoStoreHooks`, `ReplaceLogoResult` (store); `LOGO_MIME_TYPES`, `LogoMimeType`, `LogoSetting`, `isLogoMimeType`, `parseLogoSetting` (settings).
- `replaceLogo` returns `{ ok: true, version, replaced } | { ok: false, code }`, so the route can map a refusal without a throw.
- The static callers test gained one more case: the logo store has no FileStorage delete, two enqueue calls and a `saveStagedFiles` call.

**4. [Bookkeeping] `requirements-completed` is empty**
- AIDA-34 is only half done here (the UI, the public pages and the E2E are plan 09-07), so it is listed under `requirements-partial`, as 09-04 did, not as completed.

---

**Total deviations:** 4 (1 Rule 2 test addition, 1 Rule 3 helper, 2 precision or bookkeeping notes). **Impact:** no scope added to production behaviour; more evidence for the admin route.

## Issues Encountered

- Biome reformatted two long expressions in the validator and four test files. The unit tests and the Task 1 and Task 2 integration verifies were re-run after formatting, all green.

## Stated limits

- **Cache non-revocation (D-09, P10):** a removed or replaced logo stays in browser and proxy caches for up to a year under its old URL. New requests for that URL get 404. This is documented in `docs/SECURITY.md`.
- **CSRF posture:** the admin route relies on the session cookie (Better Auth's default `SameSite=Lax`, so a cross-site form POST carries no cookie), like `POST /api/tickets/[id]/messages`. No route handler in the repo checks `Origin`, and this plan adds no new mechanism.
- **Staged rollback after an ambiguous commit:** if the database commits but the client sees an error (for example the connection drops at commit), `discard()` removes the new file while the setting may reference it. The public route then answers 404 until the next upload. This is the same accepted staged-rollback path as every other upload (09-04 caller table).
- **APNG:** refused, although browsers render it as PNG.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-public-endpoint | `src/app/api/public/logo/[orgId]/[version]/route.ts` | Planned (T-09-16, T-09-18): unauthenticated file read, limited first, selected by organization id and exact current version only |
| threat_flag: new-upload-endpoint | `src/app/api/settings/branding/logo/route.ts` | Planned (T-09-14, T-09-15, T-09-17): session and role before the bounded one-part body |

No surface beyond the plan's threat model.

## Not run

- Member and unauthenticated upload and remove through the real UI session: plan 09-07's E2E (not run here).
- `pnpm test:egress`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --prod`: not run (phase gate, outside this plan's verify).

## Manual items (open)

- Visual check of the logo in the sidebar and on the public pages: plan 09-07 and the human visual pass. No visual result is claimed.

## User Setup Required

None.

## Next Phase Readiness

- Plan 09-07 can build the Logo card on `POST` and `DELETE /api/settings/branding/logo` (form field `file`) and map the codes above to the UI-SPEC copy (`not_image` has no copy line of its own; the UI-SPEC "unknown" line covers it). The sidebar and public pages read `getLogoSetting(scopedDb(orgId))` (or `parseLogoSetting` with a bare read on `/request` and `/status/[token]`) and render `logoPublicUrl(orgId, version)`.
- Plans 09-06 and 09-10 find logo keys in `Setting` rows with key `branding:logo`, `value::json->>'storageKey'`.

---
*Phase: 09-operations*
*Completed: 2026-11-12*

## Self-Check: PASSED

All 9 created files exist; commits a6c95d2, b1be34c and 1b34cfb are in the log; no home path in the tracked files of this plan.
