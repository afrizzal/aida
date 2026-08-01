# Deferred Items — Phase 07 (launch-readiness)

Out-of-scope discoveries logged during plan execution. Not fixed per SCOPE BOUNDARY rule (pre-existing, not caused by the current plan's changes).

## From 07-01 (repo-hygiene pass — .gitattributes/LF renormalization) — RESOLVED by 07-09

All 6 items below were fixed by 07-09's FIX 5 (`fc45522`): `biome check .` now exits 0. Kept here for history rather than deleted — see `.planning/phases/07-launch-readiness/07-SECURITY-PASS.md` "Fixed in phase" for the per-item disposition (fixed vs. justified suppression) and reasoning.


Once the CRLF-vs-LF noise was eliminated (`.gitattributes` + working-tree renormalization) and Biome's own SAFE mechanical fixes (`biome check --write .`: formatting + import order, 35 files, zero logic change) were applied, `biome check .` surfaced 14 PRE-EXISTING lint-rule findings that were previously masked by the sheer volume of CRLF diagnostics. None are in files this plan's tasks touch (`.gitattributes`; `src/proxy.ts`/`src/middleware.ts`/`tests/unit/proxy.test.ts`/`tests/unit/middleware.test.ts`/`src/components/tickets/sla-due-chip.tsx`/`src/lib/worker/index.ts`). Left unfixed — several touch behavior-sensitive code (the AI draft-insertion human-approval gate, a shared UI primitive) where a blind mechanical fix risks a real behavior change, which is out of scope for a line-ending hygiene plan:

1. **`src/components/tickets/composer.tsx:39` `lint/correctness/useExhaustiveDependencies` (+ `:46` stale `suppressions/unused`)** — the existing `biome-ignore` comment no longer silences the rule as written; the effect governs the human-approval draft-insertion flow (05-07). Needs a deliberate review of whether `onInsertedConsumed` belongs in the dependency array, not a mechanical fix.
2. **`src/components/ui/input-group.tsx:14,49,50` `lint/a11y/useSemanticElements` / `lint/a11y/useKeyWithClickEvents`** — shadcn-generated shared primitive; Biome suggests replacing `role="group"` divs with `<fieldset>`. Touches a widely-reused UI primitive — needs a visual/behavioral check, not a blind swap.
3. **`src/lib/channels/email/poll-inbox.ts:35` `lint/complexity/useOptionalChain` (FIXABLE, low-risk)** — `if (!msg || !msg.source)` → `if (!msg?.source)`. Purely mechanical, safe to pick up in a future lint-cleanup plan or the next time this file is touched substantively.
4. **`tests/e2e/public-intake.spec.ts:20,58` / `tests/e2e/public-status.spec.ts:62` `lint/style/noNonNullAssertion` (FIXABLE)** and **`tests/e2e/public-intake.spec.ts:46` (not auto-fixable)** — `context.browser()!` / `ticketHref!`. Biome's suggested fix (`?.`) subtly changes behavior (silent `undefined` vs. a hard assertion failure on an unexpected null) — a judgment call for whoever next touches these E2E specs, not a mechanical rewrite.
5. **`tests/e2e/support/fixtures.ts:7` `lint/suspicious/noConfusingVoidType` (FIXABLE) and `:9` `lint/correctness/noEmptyPattern`** — low-risk, mechanical; safe to pick up alongside item 3.
6. **`tests/integration/scoped-tx.test.ts:23` / `tests/integration/workspace-isolation.test.ts:59` stale `suppressions/unused` (`biome-ignore lint/suspicious/noExplicitAny`)** — the ignore comments no longer match what Biome expects to suppress; needs investigation into why (rule config change vs. code drift), not a blind removal.

**Net effect for later Phase 7 plans:** the line-ending/formatting noise that made `biome check .` unusable as a gate (the literal target of 07-01) is fully eliminated — `git status --porcelain` is empty and zero formatting diffs remain. These 14 residual findings are stable, pre-existing, file-scoped lint debt that any future plan touching those exact files will need to address (or explicitly continue to defer) — they do not reintroduce repo-wide noise for untouched files.

## From 07-03 (branding settings)

D-16's fallback clause is explicit — if logo upload is disproportionately heavy, "name-only ships in 7". This plan shipped exactly one field (the workspace display name) and deferred two ideas:

1. **Logo upload.** Deferred per D-16's planner's-call clause. Reason: a new unauthenticated `GET /api/branding/logo` serving route + a `PUBLIC_PREFIXES` entry in `src/proxy.ts` + an admin multipart upload with image byte-sniffing + storage-key lifecycle management + three fallback render sites (sidebar, public request page, public status page) — a plan's worth of work that also widens the public attack surface immediately before this phase's security pass. `src/lib/attachments/local-file-storage.ts` (`buildStorageKey` + `safeKey`) is the intended storage primitive when this is picked up.
2. **Public tagline.** A short subtitle under the brand mark on the public request/status pages. Considered during planning and cut: D-16's locked fallback is name-only, and a second field is unrequested scope. If it is ever picked up it is a small addition — one more key in `BRANDING_SETTING_KEYS`, one more `Input`, and one optional `<p>` in `PublicPageShell`.

## From 07-07 (demo mode)

1. **`POSTGRES_PASSWORD` is never URL-encoded into `DATABASE_URL`.** `docker-compose.yml` interpolates it raw into `postgresql://${POSTGRES_USER:-aida}:${POSTGRES_PASSWORD}@db:5432/...` in three places (db, app, worker). A password containing a URL-reserved character (`/`, `@`, `:`, `#`, `?`) silently produces an unparseable connection string — hit for real during 07-07's cold boot when a `openssl rand -base64 32` password contained `/`. **Not currently triggered by our own docs**: `.env.example` ships `POSTGRES_PASSWORD=aida` and the `openssl rand -base64 32` guidance is attached only to `BETTER_AUTH_SECRET`/`RATE_LIMIT_PEPPER`/`APP_ENCRYPTION_KEY`, none of which go into a URL. Left unfixed as out of scope for a demo-mode plan. **Reviewed at 07-09's security pass, still not fixed** — this specific item was not in the maintainer's approved-fixes list for that plan (its 8 sweeps did not name it either, and it was not raised as a critic gap). Remains open: the cheapest fix is a one-line note in `.env.example`/`docs/OPERATIONS.md` telling self-hosters to use a URL-safe password (`openssl rand -hex 24`), rather than encoding logic in compose.
2. **Third `auth.api.signUpEmail` call site is pre-existing and legitimate.** 07-07's acceptance criterion asked for exactly two call sites (`src/lib/bootstrap.ts`, `src/lib/demo/identities.ts`). A third exists at `src/app/(auth)/setup/actions.ts:45` — the interactive `/setup` wizard, whose contract differs (human-chosen org name/slug vs. `createFirstOrgAndAdmin`'s hardcoded `"AIDA"`/`"aida"`). Not in 07-07's `files_modified`, so untouched. Both of the plan's *own* entrypoints (CLI seed + demo boot) do share `ensureDemoIdentities()`. Noted so 07-09 does not re-flag it as a duplicate-identity-logic finding.

## From 07-08 correction round (SLA data reconciliation + GIF pre-roll trim)

1. **Hero GIF: ticket #11's header `SlaDueChip` ("At risk") is not visible for roughly the first
   4-5s after the ticket opens (recording viewport 1280px), then appears and stays visible for the
   rest of the clip.** Discovered while frame-by-frame verifying the defect-B pre-roll trim (fully
   sequential decode of every GIF frame, ruling out a `select`-filter compositing artifact first).
   Confirmed NOT a rendering-logic bug: the fully-settled static `ticket-detail.png` (1440px
   viewport, same ticket, same data) shows the "At risk" chip correctly and legibly. In the video
   recording specifically, frames from roughly the ticket-open moment through the early
   thread-scroll step show the sidebar starting flush at the left edge with the header's trailing
   SLA chip apparently pushed past the 1280px viewport edge; frames from partway through the
   thread-scroll step onward show the identical content shifted — sidebar text clipped
   ("ts"/"dge Base") on the left, chip now visible on the right — consistent with a real (if
   narrow) horizontal viewport/content-width event mid-recording, not a data or SSR bug. Does not
   match any of the plan's explicit GIF-reject criteria (no loading skeleton, no error toast, no
   blank screen — the page is fully rendered and correct throughout, just missing one badge for a
   few seconds at a viewport width narrower than the app's normal 1440px screenshot capture width).
   Not touched: neither `ticket-meta-header.tsx`/`sla-due-chip.tsx` nor the recording's viewport/
   choreography were modified by this round's defect A (fixtures/seed data) or defect B (ffmpeg
   `-ss` pre-roll trim) — out of scope to chase further or fix here. Flagged for the maintainer to
   weigh in on at the Task 3 checkpoint; if it recurs and matters, the cheapest next step is
   probably reproducing it live in a headed browser at exactly 1280x800 to find the real trigger
   (likely a horizontal-overflow/scrollbar interaction) before touching any component.

## From 07-06 (docs site)

- Enable GitHub Pages with Source = GitHub Actions (repo Settings > Pages) — one-time, human-only.
- Verify `https://afrizzal.github.io/aida` renders with working CSS after the first deploy (a mismatch between the Pages URL and `base` shows as an unstyled page).

## From 07-09 (security pass)

The full evidence-backed detail for every item below lives in `.planning/phases/07-launch-readiness/07-SECURITY-PASS.md` (Findings + Known issues sections) — summarized here only for the deferred-items index.

1. **[Non-security product gap] No invite flow exists anywhere in the codebase.** Zero hits for `inviteMember`/`createInvitation`/`acceptInvitation` across `src/app`, `src/lib`, `src/components`. A self-registered user gets no `Member` row (`activeOrganizationId: null`, fails closed with "No workspace found"). **AIDA currently has no in-product way to add a second team member to a workspace** after `/setup` completes. This is a product gap, not a vulnerability — a new invitation flow is architectural (new DB model + admin UI + accept-invite public route) and out of this plan's scope (Rule 4). Needs its own future plan.
2. **`prisma/seed.ts:31` creates the demo agent (published-credential account) before its own non-empty-workspace refusal guard fires** (Sweep 6 finding 1, MEDIUM) — running `pnpm db:seed` against a live instance plants a login-capable member account while reporting "refused to seed". Fix: move the ticket-count guard ahead of `ensureDemoIdentities()`, matching `bootstrap-demo.ts`'s correct ordering. Not fixed in 07-09 (out of the maintainer's approved-fixes list for that plan).
3. **`prisma/seed.ts:59-60` echoes the effective demo password to stdout**, including an operator-supplied `DEMO_ADMIN_PASSWORD` override (Sweep 3, LOW) — re-emitted by `scripts/capture-demo-assets.ts:739`. Fix mirrors `bootstrap-demo.ts`'s pattern (print the email + a pointer to the env var, never the value). Not fixed in 07-09.
4. **sharp@0.34.5 libvips CVEs (HIGH, dependency audit)** — fix needs `>=0.35.0`, a 0.x-minor pinned by `next`'s own optional-dependency range, not a plain patch. Explicitly left unfixed per maintainer instruction; mitigated by no `images.remotePatterns`, `dangerouslyAllowSVG: false`, and zero `next/image` usages in `src/`.
5. **Containers run as root (MEDIUM)** — no `USER` line in the Dockerfile's runner stage. Explicitly left unfixed per maintainer instruction. Follow-up: add a non-root `USER` (mirroring upstream Next.js's own standalone Dockerfile) plus an `uploads_data` ownership check.
6. **XFF leftmost-token spoofability / undocumented Caddyfile dependency (LOW)** — safe only because the shipped Caddyfile sets no `trusted_proxies`; becomes fully bypassable if an operator fronts AIDA with another proxy/CDN or exposes `app:3000` directly. Fix: a `trusted_proxies`-aware right-to-left XFF parse, or at minimum a documented deployment constraint in `docs/OPERATIONS.md`.
7. **Ollama Test-Connection SSRF error oracle (LOW)** — `testLlmConnection`/`testEmbeddingConnection` echo the raw failure message back to the admin. Fix: generalize the returned error instead of echoing raw text.
8. **`/api/health` and `/api/public/status/[token]/attachments/[id]` have no `checkRateLimit`; `/api/public/status/[token]/follow-up` lacks a combined request-size cap; both status POST routes check the rate limit after the token lookup (all LOW, Sweep 2).**
9. **Build/deploy-time third-party egress (MEDIUM): Google Fonts at `next build`, Next.js telemetry, Prisma CLI checkpoint on every `docker compose up` (Sweep 5, F-5.1/F-5.2/F-5.3).** One-line fixes each (`next/font/local`, `NEXT_TELEMETRY_DISABLED=1`, `CHECKPOINT_DISABLE=1`) but none was in the approved-fixes list.
10. **No Content-Security-Policy / `connect-src` anywhere in the stack (LOW, F-5.4).**

**Partial resolution update (07-09.1):** item 9's Prisma-checkpoint sub-issue is now FIXED — `docker-compose.egress-test.yml`'s deny-all-network egress test (Task 1) caught `checkpoint.prisma.io` being pinged on every `migrate deploy` at runtime (not just build-time as originally scoped), and `CHECKPOINT_DISABLE=1` was added to both that compose file and the real `docker-compose.yml:35`. The Google Fonts (`next build`-time) and Next.js telemetry sub-issues remain open, unchanged.

## From 07-09.1 (automated egress/honesty/contrast tests, gap closure on 07-09)

1. **[Reported, not fixed — systemic semantic/brand-color contrast gap] `--primary` (both themes) and `--success` (light theme) fall short of WCAG AA 4.5:1 in several first-class, high-traffic usages.** `tests/e2e/a11y-contrast.spec.ts` (Task 3) found, and left genuinely failing (not allowlisted — see the test file's own comments and 07-09.1-SUMMARY.md):
   - **Case B — `--success` (light mode, `oklch(0.58 0.14 155)`) as badge text on its own `bg-success/10` tint**: `KbEmbeddingStatusChip`'s "Indexed" badge, ratio 3.47:1 (needs 4.5:1). Dark mode's `--success` (`oklch(0.72 0.15 155)`) does NOT reproduce this — only light mode is affected.
   - **Case C — `--primary` (dark mode, `oklch(0.585 0.215 278)` / `#6563f7`) used AS TEXT on dark surfaces**: the sidebar avatar-initials fallback (`bg-sidebar-primary/10 text-sidebar-primary`), the "AI Draft" label and KB citation links (`text-primary`), and the `bg-primary/10 text-primary` filter-pill/tab pattern ("All", "Public Reply") — ratio 3.86-4.1:1, dark theme only.
   - **Case D — `--primary` used as a SOLID button/badge background with `--primary-foreground` (near-white) text** — light mode ratio 3.98:1 (`#716ee4` bg), dark mode ratio 4.29:1 (`#6563f7` bg). Affects every default-variant `Button` (Insert into reply, Create/Save article, Send Reply, the sidebar's own primary CTAs) and `StatusChip`'s `NEW` state.

   **Why not fixed:** `--primary` is DESIGN-SYSTEM.md §1's locked "Brand Identity" (Indigo-violet, hue family 277-280) and `--success` is one of four documented semantic status colors (§4.7) — both are used identically across dozens of components in both themes. A numeric lightness/chroma adjustment large enough to clear 4.5:1 (roughly a 10-25% relative shortfall depending on the case) is a genuine brand-color decision with wide, immediately-visible blast radius across the whole product in both themes, not a narrow, safe, single-component fix — squarely the kind of call CLAUDE.md's Rule 4 (architectural/design decisions) and this plan's own D-3/D-4 reserve for the maintainer, not an autonomous executor. Per this plan's critical constraint ("FIX it when the fix is small and safe, or REPORT it as a finding... Report honestly if axe finds violations you could not fix"), this is reported, not silently allowlisted — 7 of 8 `a11y-contrast.spec.ts` tests remain RED, honestly reflecting this real, pre-existing gap.
   **Reason:** brand/semantic color values were chosen in an earlier phase (the "Indigo-violet brand overhaul") for visual identity, not audited against WCAG contrast math at the time.
   **Owner:** maintainer (Afrizzal) — needs a deliberate decision: accept the gap, adopt slightly darker/lighter `--primary`/`--success` values (same hue, tuned L/C) with a full visual re-review and re-capture of all `docs/assets/` screenshots, or introduce a second "legible-on-X" token tier for text-on-dark/text-on-tint usages specifically.
   **What was fixed instead (genuinely safe, narrow, non-brand-color bugs the same test run surfaced):** the sidebar footer email's `/60`-opacity muted text (bumped to `/70`, matching the already-documented inactive-nav-item value); four `Badge` call sites (`triage-category-chip.tsx`, `ticket-meta-header.tsx`'s language badge, `priority-chip.tsx`'s LOW/NORMAL, `triage-sentiment-chip.tsx`'s NEUTRAL) that omitted `variant="outline"` and so silently inherited the Badge default variant's `bg-primary`, pairing it with `text-foreground`/`text-muted-foreground` instead of the correct `text-primary-foreground` — a real, isolated, non-brand-color bug, not a brand decision.

2. **[Pre-existing, not caused by this plan] Every `(app)` page renders two `<h1>` elements with the same text.** `src/components/top-bar.tsx`'s `TopBar` renders a page-title `<h1>` in the sticky header (role `banner`) for every route (via its own `pageTitles` lookup), and each page (e.g. `src/app/(app)/kb/page.tsx`) ALSO renders its own `<h1>` with the same text in `<main>`. Discovered via a Playwright strict-mode collision while writing `a11y-contrast.spec.ts` (not an axe finding) — the test now scopes its heading assertion to `getByRole("main")` to disambiguate. Not fixed: this is a repo-wide, pre-existing structural pattern (every page does it), out of this plan's scope (SCOPE BOUNDARY). Not currently flagged by axe's `wcag2a`/`wcag2aa` rule sets (duplicate-`<h1>` isn't itself a WCAG 2 AA failure), but is a heading-hierarchy smell worth a future pass (likely: demote the TopBar's title to a visually-hidden `<span>` or drop the per-page `<h1>` in favor of the TopBar's).
