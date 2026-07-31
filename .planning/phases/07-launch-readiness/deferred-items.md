# Deferred Items — Phase 07 (launch-readiness)

Out-of-scope discoveries logged during plan execution. Not fixed per SCOPE BOUNDARY rule (pre-existing, not caused by the current plan's changes).

## From 07-01 (repo-hygiene pass — .gitattributes/LF renormalization)

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

1. **`POSTGRES_PASSWORD` is never URL-encoded into `DATABASE_URL`.** `docker-compose.yml` interpolates it raw into `postgresql://${POSTGRES_USER:-aida}:${POSTGRES_PASSWORD}@db:5432/...` in three places (db, app, worker). A password containing a URL-reserved character (`/`, `@`, `:`, `#`, `?`) silently produces an unparseable connection string — hit for real during 07-07's cold boot when a `openssl rand -base64 32` password contained `/`. **Not currently triggered by our own docs**: `.env.example` ships `POSTGRES_PASSWORD=aida` and the `openssl rand -base64 32` guidance is attached only to `BETTER_AUTH_SECRET`/`RATE_LIMIT_PEPPER`/`APP_ENCRYPTION_KEY`, none of which go into a URL. Left unfixed as out of scope for a demo-mode plan. **Flagged for 07-09's security pass** — the cheapest fix is a one-line note in `.env.example`/`docs/OPERATIONS.md` telling self-hosters to use a URL-safe password (`openssl rand -hex 24`), rather than encoding logic in compose.
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
