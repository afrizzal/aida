# Playwright E2E Brief — Phase 2 UAT Automation

Input for `/gsd:add-tests 2`. Goal: automate the Phase 2 UAT checklist as a Playwright E2E suite so `/gsd:verify-work` can be a short review + visual pass instead of a full manual walkthrough. This suite is also the regression net for Phases 3–7.

## Framework setup

- Add `@playwright/test` as devDependency (do NOT run Playwright through Vitest — Vitest stays for unit/integration).
- `playwright.config.ts` with `webServer` booting the Next.js app against a **disposable Postgres** (reuse the Testcontainers pattern from `tests/integration`, or a dedicated compose service) — never the dev database.
- `workers: 1` — the app is effectively single-org (public intake resolves the org via `findFirstOrThrow`), parallel specs would contaminate each other.
- Global setup: fresh DB → migrations → complete the `/setup` wizard once (creates owner user + org) → save `storageState` for authenticated specs.
- The worker (pg-boss) does NOT need to run for E2E (see SLA note below); if booted, pin its schedule out of the way.
- Rate limiter: add a test-only env override to relax `checkRateLimit`, or truncate `RateLimitHit` between specs — all E2E traffic comes from one IP and will trip the limiter otherwise.
- Add `pnpm test:e2e` script; suite must pass headless on a clean clone (document any new env vars in `.env.example`).

## UAT scenarios to cover

1. **Public intake:** `/request` → submit name/email/subject/message + attachment → success state shows `/status/{token}` link; ticket appears in agent inbox as NEW with the INBOUND initial message + attachment chip.
2. **Honeypot:** filling the visually-hidden `company_website` field returns silent success but creates NO ticket. (All other specs must NOT touch this field.)
3. **Inbox:** view pills (Unassigned/Mine), status multi-select, tag filter, custom-field filter, debounced full-text search finds a seeded ticket by body text.
4. **Reading pane:** open ticket → thread renders; post a Public Reply (markdown renders as sanitized HTML) and an Internal Note; the note is visually distinct (warning/amber styling + Lock icon) and NEVER appears on the public status page.
5. **Mutations:** status transitions new→open→pending→resolved→closed persist across reload; priority change updates SLA due chips; assign to self; add/remove tag; set a custom-field value.
6. **SLA:** after creation, `SlaDueChip` renders on-track with plausible due times. Do NOT wait for the 5-min worker cron — breach/at-risk logic belongs in Vitest integration by invoking `slaFlagHandler` directly (add that test if missing).
7. **Contacts:** `A@X.com` and `a@x.com` dedupe to one contact; `/contacts` search finds it; detail shows ticket history; Notes autosave survives reload.
8. **Public status page:** `/status/{token}` shows PUBLIC messages only; follow-up on a RESOLVED ticket auto-reopens it (agent view shows OPEN + system event row); invalid token shows the dead-end state.
9. **Attachments:** authenticated download via `/api/attachments/[id]` works; the public page serves attachments only via its token-scoped route, and internal-note attachments are unreachable from it.
10. **Authz:** unauthenticated `/tickets` redirects to `/login`; a non-admin member is rejected from Settings mutations (SLA/tags/custom fields) server-side, not just hidden UI.

## Constraints

- Reuse selectors/roles accessibly (`getByRole`, `getByLabel`) — no brittle CSS-class selectors except where the assertion IS the styling (scenario 4).
- Keep the E2E DB lifecycle isolated and repeatable; no dependence on leftover state.
- CI-ready: this suite will later run in GitHub Actions as part of Phase 7 repo health.
