---
phase: 03-email-channel
plan: 02
subsystem: infra
tags: [crypto, aes-256-gcm, node-crypto, settings, encryption-at-rest, vitest]

# Dependency graph
requires:
  - phase: 02-core-ticketing
    provides: "Setting key/value model + scopedDb findFirst+create/update pattern (settings/actions.ts)"
provides:
  - "src/lib/crypto/secret-box.ts — encryptSecret()/decryptSecret() AES-256-GCM helper, reusable verbatim by Phase 4 LLM provider keys"
  - "src/lib/channels/email/settings.ts — getEmailSettings/saveEmailSettings/updateEmailHealth typed module over the 14 email:* Setting keys"
  - "Documented APP_ENCRYPTION_KEY in .env.example"
affects: [03-email-channel plans 01/03/04/05/06, phase-04-ai (LLM provider key encryption)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AES-256-GCM secret-box: fresh 12-byte IV per call, iv|authTag(16B)|ciphertext packed into one base64 blob stored in Setting.value (zero schema change)"
    - "Email settings module imports crypto via a RELATIVE path (not @/) so it is bundleable by both Next.js webpack (app) and esbuild (worker)"
    - "Password fields: empty/undefined on save = keep existing stored value (never round-trips plaintext to the UI)"

key-files:
  created:
    - src/lib/crypto/secret-box.ts
    - tests/unit/secret-box.test.ts
    - src/lib/channels/email/settings.ts
  modified:
    - .env.example

key-decisions:
  - "secret-box.ts imports ONLY node:crypto (no project imports) — safely bundleable by both webpack and esbuild, matching Phase 4's future reuse"
  - "settings.ts imports secret-box via the relative path \"../../crypto/secret-box\" (not @/) since it will be imported by the worker's poll job in plan 04"
  - "getEmailSettings/saveEmailSettings/updateEmailHealth all use findFirst + conditional create/update, never .upsert() — scopedDb's upsert hook breaks on this project's compound unique keys (established 02-01 pitfall)"

patterns-established:
  - "Credential encryption at rest: any future secret stored in Setting.value must go through encryptSecret()/decryptSecret(), never stored as plaintext"

requirements-completed: [AIDA-09]

# Metrics
duration: ~15min
completed: 2026-07-06
---

# Phase 03 Plan 02: Credential Encryption + Email Settings Module Summary

**AES-256-GCM `secret-box` encrypt/decrypt helper (fresh IV per call, auth-tag verified) plus a typed `email:*` settings module over the existing `Setting` key/value store — the two pure-infrastructure pieces the email channel needs before any IMAP/SMTP wiring.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-06T09:46Z (approx, first commit)
- **Completed:** 2026-07-06T09:51Z
- **Tasks:** 2 completed (Task 1 was TDD: RED → GREEN)
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- Built `src/lib/crypto/secret-box.ts`: `encryptSecret()`/`decryptSecret()` using `node:crypto`'s `createCipheriv("aes-256-gcm", ...)`. Fresh `randomBytes(12)` IV per call; blob layout is `iv (12B) | authTag (16B) | ciphertext`, base64-encoded, fitting the existing `Setting.value: String` column with zero schema change.
- Wrote `tests/unit/secret-box.test.ts` (TDD RED then GREEN): round-trip (including unicode), fresh-IV-per-call (two ciphertexts differ), tamper-throws (byte-flipped ciphertext region), missing-key-throws, and wrong-length-key-throws. All 5 assertions green.
- Documented `APP_ENCRYPTION_KEY` in `.env.example`, matching the existing `BETTER_AUTH_SECRET`/`RATE_LIMIT_PEPPER` `openssl rand -base64 32` convention. The app boots fine without it (key is read lazily inside `getKey()`, only invoked when a credential is actually encrypted/decrypted).
- Built `src/lib/channels/email/settings.ts`: exports `EMAIL_SETTING_KEYS` (the 14 `email:*` keys), the `EmailSettings` type, `getEmailSettings(db)`, `saveEmailSettings(db, orgId, input)`, and `updateEmailHealth(db, orgId, health)`. Passwords are encrypted via `encryptSecret()` on write and decrypted via `decryptSecret()` on read; all other fields are coerced to their typed shape (booleans/numbers parsed from string Setting values, with sane defaults: `imapPort` 993, `smtpPort` 587, `*Secure` true).

## Task Commits

Each task was committed atomically:

1. **Task 1: AES-256-GCM secret-box helper (TDD)** — RED `af3a78b` (test), GREEN `a4dc840` (feat, includes `.env.example` doc)
2. **Task 2: Typed email-settings module** — `6315b76` (feat)

_Note: Task 1 was TDD (RED → GREEN); no REFACTOR commit was needed — the implementation matched the research-provided reference shape exactly on the first pass._

## Files Created/Modified

- `src/lib/crypto/secret-box.ts` — AES-256-GCM `encryptSecret()`/`decryptSecret()`, `node:crypto`-only (no project imports), bundleable by both webpack (app) and esbuild (worker)
- `tests/unit/secret-box.test.ts` — round-trip/fresh-IV/tamper-throws/key-validation tests (5 assertions)
- `src/lib/channels/email/settings.ts` — `EMAIL_SETTING_KEYS`, `EmailSettings`, `getEmailSettings`, `saveEmailSettings`, `updateEmailHealth`
- `.env.example` — added `APP_ENCRYPTION_KEY` section (Credential encryption at rest)

## Decisions Made

- **Blob layout locked:** `iv (12 bytes) || authTag (16 bytes) || ciphertext`, all base64-encoded into one opaque string. Any future decrypt/encrypt-adjacent code (Phase 4 LLM keys) must use this exact layout via `secret-box.ts` — never re-derive it.
- **The 14 `email:*` Setting keys are locked** exactly as specified in 03-RESEARCH.md's "Settings key scheme": `enabled`, `fromAddress`, `imapHost`, `imapPort`, `imapSecure`, `imapUser`, `imapPasswordEnc`, `smtpHost`, `smtpPort`, `smtpSecure`, `smtpUser`, `smtpPasswordEnc`, `lastPollAt`, `lastPollError`.
- **"Empty password = keep existing stored value" semantics are load-bearing for the settings UI (plan 06):** `saveEmailSettings` only calls `encryptSecret()` and writes `*PasswordEnc` when the input password is a non-empty string. This means the Email Settings form (plan 06) can safely leave the password field blank on every re-save (after the initial set) without ever needing to fetch/redisplay the plaintext password.
- **`getEmailSettings`/`saveEmailSettings`/`updateEmailHealth` all take a loosely-typed `SettingDb` param** (`{ setting: { findMany, findFirst, create, update } }` with `unknown` args) rather than the full generated `scopedDb` return type — this avoids coupling the module to Prisma's generated types across the two different bundling contexts (Next.js webpack vs. worker esbuild) it will be imported from.

## Deviations from Plan

None — plan executed exactly as written. No architectural changes, no bugs found, no missing critical functionality beyond what the plan already specified.

## Issues Encountered

- Local dev environment setup: this plan was executed in a worktree (`agent-ac26979002f089dba`) that was branched before Phase 3's planning commits landed on `master`. Fast-forward merged `master` into the worktree branch to pick up the `03-*-PLAN.md`/`03-RESEARCH.md`/`03-CONTEXT.md` files (clean fast-forward, no conflicts, no other in-flight worktree work pulled in). Ran `cp .env.example .env`, `pnpm install`, and `pnpm prisma generate` to bring the worktree to a runnable state (these directories don't inherit `node_modules`/`.env`/generated Prisma client from the main checkout).
- `pnpm test`/`pnpm exec tsc` emit a `WARN Unsupported engine: wanted: {"node":">=22"} (current: v20.20.2)` from pnpm's own engine check even though the invoking shell's `node --version` reports v22.23.1 (matches the previously-documented Node 20/22 PATH-resolution quirk for this project, `aida-e2e-node-path` memory) — cosmetic warning only, all commands still executed successfully against the correct toolchain and exited 0.

## User Setup Required

None — no external service configuration required. `APP_ENCRYPTION_KEY` is documented in `.env.example` for the operator to generate (`openssl rand -base64 32`) before saving email credentials in Settings (plan 06), but the app boots and runs fully without it (D-26).

## Next Phase Readiness

- `src/lib/crypto/secret-box.ts` is ready for Phase 4 to reuse verbatim for LLM provider key encryption.
- `src/lib/channels/email/settings.ts` is ready for: plan 01 (Prisma schema/deps, independent), plan 03/04 (IMAP poll job — reads `getEmailSettings`, writes `updateEmailHealth`), plan 05 (SMTP outbound — reads `getEmailSettings`), and plan 06 (Settings "Email" tab UI — calls `saveEmailSettings`/`getEmailSettings`, relies on the empty-password-keeps-existing-value semantics).
- No blockers. This plan was fully independent of 03-01 (touches neither `package.json` nor new schema fields) and ran in Wave 1 alongside it as planned.

---
*Phase: 03-email-channel*
*Completed: 2026-07-06*

## Self-Check: PASSED

- FOUND: src/lib/crypto/secret-box.ts
- FOUND: tests/unit/secret-box.test.ts
- FOUND: src/lib/channels/email/settings.ts
- FOUND: APP_ENCRYPTION_KEY in .env.example
- FOUND commit: af3a78b (test)
- FOUND commit: a4dc840 (feat)
- FOUND commit: 6315b76 (feat)
