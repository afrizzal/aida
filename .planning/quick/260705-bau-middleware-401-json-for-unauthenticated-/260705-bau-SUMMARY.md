---
quick_id: 260705-bau
description: middleware 401 JSON for unauthenticated /api/* + truly-anonymous e2e context
date: 2026-07-05
status: complete
verification: full `volta run --node 22 pnpm test:e2e` 24/24 green; `tsc --noEmit` clean; biome clean on both files
---

# Quick Task 260705-bau — Summary

## What shipped

1. **`src/middleware.ts`** — unauthenticated requests to `/api/*` (outside `PUBLIC_PREFIXES`) now get `401 {"error":"unauthorized"}` instead of a 307 redirect to `/login`. The redirect previously landed machine clients on the login page's HTML with a final 200 — wrong semantics for every authenticated API route (e.g. `POST /api/tickets/[id]/messages`), not just attachments. Pages keep the redirect; route-level `getScopedDb()` auth is unchanged (middleware checks cookie *presence* only — still the doorman, not the gate).
2. **`tests/e2e/attachments.spec.ts`** — the "anonymous" context is now created as `browser.newContext({ storageState: { cookies: [], origins: [] } })`. Root cause of the original red test: `@playwright/test`'s `browser.newContext()` inherits `use` options — including this file's `test.use({ storageState: admin.json })` — so the bare `newContext()` was authenticated, and every observed 200 was a legitimate authenticated download (NOT Next.js caching, and NOT the middleware redirect either). Also switched to the `browser` fixture (drops the `noNonNullAssertion` warning) and biome-formatted the file.

## Key learnings (for future sessions)

- `pnpm test:e2e` requires Node 22, same as `test:integration` — system Node 20 crashes testcontainers' `undici@8` at import (`webidl.util.markAsUncloneable is not a function`). Run via `volta run --node 22 pnpm test:e2e`; consider encoding this into the package.json script.
- Next 16 logs a deprecation: the `middleware` file convention is being replaced by `proxy` (dev-server timing lines already label it `proxy.ts`). Rename `src/middleware.ts` → `src/proxy.ts` in a future task.
- Any Playwright spec that sets `test.use({ storageState })` at file level and then wants an unauthenticated context MUST pass an explicit empty `storageState` — a bare `newContext()` silently inherits the auth. Grep for `newContext()` when writing future authz tests.
- Watch item (unexplained, observed once in 3 runs of the assertion): `GET /api/public/status/[token]/attachments/[id]` returned 404 for a valid token + public attachment, then passed twice. The route's two 404 branches return identical bodies, so the occurrence couldn't be attributed post-hoc. If it recurs: give the branches distinct error reasons (`not_found_ticket` vs `not_found_attachment`) so the failure self-diagnoses.

## Commits

- `fix(quick-260705-bau)` — middleware 401 JSON for unauthenticated `/api/*`
- `test(quick-260705-bau)` — truly-anonymous context in attachments spec
- `docs(quick-260705-bau)` — planning artifacts + STATE.md

## Verification record

- `volta run --node 22 pnpm exec playwright test attachments` → 1 passed (after each change)
- `volta run --node 22 pnpm test:e2e` → **24 passed (2.9m)**
- `pnpm exec tsc --noEmit` → clean; `pnpm exec biome check` → clean on both modified files
