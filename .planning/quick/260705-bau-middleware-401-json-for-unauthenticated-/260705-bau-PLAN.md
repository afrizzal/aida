---
quick_id: 260705-bau
description: middleware 401 JSON for unauthenticated /api/* + truly-anonymous e2e context
date: 2026-07-05
mode: quick
execution: inline (fixes were developed and verified interactively before this quick task was opened; this run commits them with GSD guarantees)
---

# Quick Task 260705-bau — Plan

Origin: the deliberately-red E2E test from `test(phase-2)` commit `c917c4f` (`tests/e2e/attachments.spec.ts` — anonymous `GET /api/attachments/[id]` expected 401, observed 200). The test-generation agent diagnosed Next.js response caching and prescribed `export const dynamic = "force-dynamic"`. Investigation falsified that (dev server; Next 15+ GET handlers uncached by default; route reads headers so it is dynamic; response is `private, no-store`) and surfaced TWO real, stacked defects instead.

## Task 1 — Middleware: machine-readable 401 for unauthenticated API requests

- **files:** `src/middleware.ts`
- **action:** For requests with no session cookie whose pathname starts with `/api/` (and not in `PUBLIC_PREFIXES`), return `NextResponse.json({ error: "unauthorized" }, { status: 401 })` instead of the 307 redirect to `/login`. Pages keep the redirect. Route-level auth (`getScopedDb()`) unchanged — middleware only checks cookie presence, so it remains the doorman, not the gate.
- **verify:** `tests/e2e/attachments.spec.ts` line asserting anon 401 passes; `pnpm exec tsc --noEmit` clean; `pnpm exec biome check src/middleware.ts` clean.
- **done:** Anonymous `/api/*` callers receive 401 JSON; anonymous page visitors still redirect to `/login` (covered by `authz.spec.ts`).

## Task 2 — E2E: make the "anonymous" context actually anonymous

- **files:** `tests/e2e/attachments.spec.ts`
- **action:** `browser.newContext()` under `@playwright/test` inherits the config/test.use options — including this file's `test.use({ storageState: admin.json })` — so the bare `context.browser()!.newContext()` was authenticated (that inheritance, not caching, produced every observed 200). Create the context with the documented reset `storageState: { cookies: [], origins: [] }`, acquired via the `browser` fixture (drops the `noNonNullAssertion` lint warning).
- **verify:** `volta run --node 22 pnpm exec playwright test attachments` green; full `volta run --node 22 pnpm test:e2e` 24/24 green.
- **done:** The anon request is cookie-less, meets the middleware 401, and the suite is fully green with the original `expect(401)` assertion untouched.

## must_haves

- truths: anonymous `/api/*` → 401 JSON; anonymous app pages → redirect to `/login`; attachments spec anon context carries zero cookies.
- artifacts: `src/middleware.ts` 401 branch; `tests/e2e/attachments.spec.ts` empty-storageState context.
- key_links: `tests/e2e/attachments.spec.ts` → `src/middleware.ts` (the 401 the assertion demands is now produced at the middleware layer).
