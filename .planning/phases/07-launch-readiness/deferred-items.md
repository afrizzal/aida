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

## From 07-06 (docs site)

- Enable GitHub Pages with Source = GitHub Actions (repo Settings > Pages) — one-time, human-only.
- Verify `https://afrizzal.github.io/aida` renders with working CSS after the first deploy (a mismatch between the Pages URL and `base` shows as an unstyled page).
