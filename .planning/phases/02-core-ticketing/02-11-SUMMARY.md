---
phase: 02-core-ticketing
plan: 11
subsystem: api
tags: [nextjs, route-handler, multipart, prisma, react-hook-form, zod, rate-limiting, file-upload, docker, caddy]

# Dependency graph
requires:
  - phase: 02-core-ticketing (plan 03)
    provides: createTicket(orgId, input) — single ticket-creation code path
  - phase: 02-core-ticketing (plan 04)
    provides: localFileStorage/buildStorageKey + FileStorage interface, Attachment model
  - phase: 02-core-ticketing (plan 05)
    provides: checkRateLimit(scope, ip) — Postgres-backed per-IP rate limiter
provides:
  - "(public) route group: unauthenticated layout mirroring (auth)'s decoration"
  - "PublicPageShell (brand mark + Card, maxWidth 640/720) and HoneypotField (visually-hidden spam trap) shared components"
  - "/request public intake form: Name/Email/Subject/Message/Attachments, honeypot, client-side pre-check, success state with status link"
  - "POST /api/public/intake Route Handler: honeypot silent-success, rate-limit, single-org resolution, createTicket(INBOUND), server-validated attachments"
  - "uploads_data Docker volume mounted on app service; Caddy 12MB request_body ceiling; UPLOADS_DIR/RATE_LIMIT_PEPPER env vars"
affects: [02-12 (tokenized public status page reuses PublicPageShell + HoneypotField), phase-03 (email intake will parallel this createTicket(INBOUND) call path)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Public unauthenticated routes live under an (public) route group; the layout renders decoration only, pages compose PublicPageShell + Card content (mirrors the (auth) group's split)."
    - "Multipart file-bearing endpoints are always Route Handlers (never Server Actions), `runtime = \"nodejs\"`, one `request.formData()` call covering text fields + honeypot + N files in a single POST."
    - "Client forms that must submit files alongside react-hook-form-validated fields build the outgoing FormData from the native <form> element (`new FormData(event.target)`) rather than re-serializing values — the honeypot's native input and any selected files ride along automatically."
    - "Honeypot spam guard: a normal-looking, visually-hidden (off-screen position, not `type=\"hidden\"`/`aria-hidden`) text field; a non-empty value returns HTTP 200 with a null token and creates nothing (never a different status code)."
    - "Single-org v1 resolution: `prisma.organization.findFirstOrThrow()` with a comment pointing at RESEARCH.md's Open Q2 for future multi-org public intake."

key-files:
  created:
    - src/app/(public)/layout.tsx
    - src/components/public/public-page-shell.tsx
    - src/components/public/honeypot-field.tsx
    - src/app/(public)/request/page.tsx
    - src/app/(public)/request/request-form.tsx
    - src/app/api/public/intake/route.ts
  modified:
    - src/middleware.ts
    - docker-compose.yml
    - Caddyfile
    - .env.example
    - .planning/phases/02-core-ticketing/deferred-items.md

key-decisions:
  - "Attachment dropzone is a <button type=\"button\"> (not a <div role=\"button\">) wrapping a visually-hidden sibling <input type=\"file\">, so click-to-browse + drag-and-drop (DataTransfer.files assigned onto the input ref) both work without any custom keyboard-handling code — biome's a11y rules are satisfied by using the real semantic element instead of retrofitting one."
  - "PublicPageShell's maxWidth prop is constrained to the literal union `640 | 720` and the Card's max-width class is chosen via a static ternary (`max-w-[640px]` / `max-w-[720px]`) rather than an interpolated arbitrary value, so Tailwind's build-time class scanner reliably picks up both classes."

requirements-completed: [AIDA-08]

# Metrics
duration: 55min
completed: 2026-07-02
---

# Phase 02 Plan 11: Public Web Intake Channel Summary

**Unauthenticated `/request` form + `POST /api/public/intake` Route Handler that honeypot-guards, rate-limits, resolves the single org, calls the shared `createTicket`, byte-sniffs and stores attachments on a new `uploads_data` volume, and returns a tokenized status link — no third-party CAPTCHA, no egress.**

## Performance

- **Duration:** 55 min (including a worktree fast-forward from a stale base + `pnpm install`/`prisma generate`)
- **Started:** 2026-07-02T01:05:00Z
- **Completed:** 2026-07-02T02:00:00Z
- **Tasks:** 3
- **Files modified:** 10 (6 created, 4 modified) + 1 deferred-items.md log entry

## Accomplishments
- A stranger can load `/request`, submit Name/Email/Subject/Message (+ optional attachments) with zero auth, and land on a "Request received" success state carrying a real `/status/{token}` link.
- The intake route is a single multipart POST that: silently no-ops on honeypot trip, hard-stops at 5 requests/hour/IP via the existing Postgres rate limiter, validates every attached file server-side against a 10MB cap + `file-type` magic-byte MIME allowlist (never trusting the browser's `Content-Type`), and creates the ticket + contact + initial inbound Message + Attachment rows through the one shared `createTicket` transaction.
- Middleware, Docker volume, and Caddy body-size ceiling are all wired so this works end-to-end in the one-command self-host compose stack, not just in dev.

## Task Commits

Each task was committed atomically:

1. **Task 1: (public) route group layout + PublicPageShell + HoneypotField + middleware exemptions** - `7bc3f2e` (feat)
2. **Task 2: /request intake form page + success state** - `91ee2c7` (feat)
3. **Task 3: POST /api/public/intake route + uploads volume + Caddy + env** - `24bc3e2` (feat)

**Plan metadata:** (this commit) - docs: complete plan

## Files Created/Modified
- `src/app/(public)/layout.tsx` - Decorative unauthenticated wrapper (dotted grid + primary glow), no `requireSession`; renders `{children}` only.
- `src/components/public/public-page-shell.tsx` - Brand mark (sidebar.tsx box reused verbatim) + `Card` wrapper; `maxWidth` prop (640 default / 720 for plan 12's status page).
- `src/components/public/honeypot-field.tsx` - Visually-hidden `company_website` trap field; not `type="hidden"`, not `aria-hidden`.
- `src/app/(public)/request/page.tsx` - `force-dynamic`; renders `PublicPageShell` + `RequestForm`.
- `src/app/(public)/request/request-form.tsx` - react-hook-form + zod form; honeypot wired in; drag-or-click attachment zone with client pre-check; success state; 429 banner.
- `src/app/api/public/intake/route.ts` - The intake Route Handler (honeypot, rate-limit, validation, org resolution, attachment storage, `createTicket`).
- `src/middleware.ts` - `PUBLIC_PREFIXES` extended with `/request`, `/status`, `/api/public`.
- `docker-compose.yml` - `app` service mounts `uploads_data:/data/uploads`; adds `UPLOADS_DIR`/`RATE_LIMIT_PEPPER` env; declares the `uploads_data` volume.
- `Caddyfile` - `request_body { max_size 12MB }` defense-in-depth ceiling.
- `.env.example` - Documents `UPLOADS_DIR` and `RATE_LIMIT_PEPPER`.
- `.planning/phases/02-core-ticketing/deferred-items.md` - Logged a pre-existing (plan 04) Turbopack NFT-trace build warning surfaced by this plan's new import.

## Decisions Made
- Attachment control is a real `<button type="button">` (dropzone) + sibling hidden `<input type="file">`, not a `<div role="button">` — avoids retrofitting keyboard handlers and satisfies biome's `useSemanticElements` rule for free.
- Client submission builds `FormData` from the live `<form>` DOM node (`new FormData(event.target)`) inside react-hook-form's `handleSubmit` callback rather than reconstructing it from validated values — the honeypot input and any selected files are automatically included without extra plumbing.
- `PublicPageShell`'s `maxWidth` is a `640 | 720` literal union resolved via a static ternary to `max-w-[640px]` / `max-w-[720px]`, so both Tailwind classes are guaranteed to be present in the compiled CSS (a plain `style={{maxWidth}}` or fully dynamic template-literal class would risk Tailwind's JIT scanner missing it).

## Deviations from Plan

None — plan executed exactly as written. (Two small implementation choices worth surfacing are captured above under "Decisions Made" — neither changed the plan's scope, files, or acceptance criteria.)

## Issues Encountered
- The worktree's base branch was stale (still at Phase 1's last commit; Wave 1+2 of Phase 2 — plans 02-01 through 02-07 — existed only on `master`). Fast-forwarded the branch onto `master` (`git merge --ff-only master`, verified as a safe ancestor merge first), then ran `pnpm install` and `DATABASE_URL=... pnpm prisma generate` (a placeholder `DATABASE_URL` is required for `prisma generate` to load `prisma.config.ts`, consistent with the existing Docker-build decision already recorded in `STATE.md`) before any plan work began.
- `pnpm run build` surfaces a Turbopack "unexpected file in NFT list" warning once the new intake route imports `local-file-storage.ts` (a pre-existing plan-04 file). Build still compiles, typechecks, and generates all routes successfully — logged to `deferred-items.md` rather than touched, since the flagged file is out of this plan's scope.

## User Setup Required

None - no external service configuration required. (`RATE_LIMIT_PEPPER` has a safe development default in code; operators should set a real one in production per `.env.example`, but nothing blocks local/dev use.)

## Next Phase Readiness
- Plan 12 (tokenized public status page) can reuse `PublicPageShell` (at `maxWidth={720}`) and `HoneypotField` (for the status page's follow-up composer) unchanged.
- Phase 3's email intake will want to call the same `createTicket(orgId, { ..., direction: "INBOUND" })` path this plan already exercises for the web form — no new ticket-creation logic should be needed there.
- No blockers.

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 10 claimed files found on disk; all 3 task commits (`7bc3f2e`, `91ee2c7`, `24bc3e2`) verified present in git history.
