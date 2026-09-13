---
phase: 07-launch-readiness
reviewed: 2026-09-04T00:00:00Z
depth: standard
files_reviewed: 118
files_reviewed_list:
  - .dockerignore
  - .gitattributes
  - .github/ISSUE_TEMPLATE/bug_report.yml
  - .github/ISSUE_TEMPLATE/config.yml
  - .github/ISSUE_TEMPLATE/feature_request.yml
  - .github/SECURITY.md
  - .github/pull_request_template.md
  - .github/workflows/ci.yml
  - .github/workflows/docs.yml
  - .github/workflows/integration.yml
  - .gitignore
  - biome.json
  - docker-compose.egress-test.yml
  - docker-compose.yml
  - package.json
  - prisma.config.ts
  - prisma/seed.ts
  - scripts/backup.sh
  - scripts/capture-demo-assets.ts
  - scripts/restore.sh
  - src/app/(app)/contacts/[id]/page.tsx
  - src/app/(app)/contacts/page.tsx
  - src/app/(app)/insights/kb-gaps-card.tsx
  - src/app/(app)/insights/period-tabs.tsx
  - src/app/(app)/insights/recurring-issues-card.tsx
  - src/app/(app)/insights/sla-csat-card.tsx
  - src/app/(app)/kb/page.tsx
  - src/app/(app)/layout.tsx
  - src/app/(app)/settings/actions.ts
  - src/app/(app)/settings/branding/actions.ts
  - src/app/(app)/settings/branding/branding-form.tsx
  - src/app/(app)/settings/branding/page.tsx
  - src/app/(app)/settings/email/actions.ts
  - src/app/(app)/settings/email/email-channel-toggle.tsx
  - src/app/(app)/settings/email/email-settings-form.tsx
  - src/app/(app)/settings/settings-nav.tsx
  - src/app/(app)/tickets/filter-chip-row.tsx
  - src/app/(app)/tickets/ticket-list-row.tsx
  - src/app/(auth)/login/login-form.tsx
  - src/app/(auth)/login/page.tsx
  - src/app/(auth)/setup/page.tsx
  - src/app/(public)/request/page.tsx
  - src/app/(public)/status/[token]/page.tsx
  - src/app/globals.css
  - src/components/public/public-page-shell.tsx
  - src/components/sidebar.tsx
  - src/components/tickets/ai-activity-section.tsx
  - src/components/tickets/assignee-avatar.tsx
  - src/components/tickets/composer-toggle.tsx
  - src/components/tickets/composer.tsx
  - src/components/tickets/draft-card.tsx
  - src/components/tickets/draft-citation-list.tsx
  - src/components/tickets/priority-chip.tsx
  - src/components/tickets/sla-due-chip.tsx
  - src/components/tickets/status-chip.tsx
  - src/components/tickets/ticket-meta-header.tsx
  - src/components/tickets/triage-category-chip.tsx
  - src/components/tickets/triage-sentiment-chip.tsx
  - src/components/tickets/triage-status-chip.tsx
  - src/components/ui/badge.tsx
  - src/components/ui/button.tsx
  - src/components/ui/input-group.tsx
  - src/components/ui/select.tsx
  - src/instrumentation.ts
  - src/lib/bootstrap.ts
  - src/lib/branding/settings.ts
  - src/lib/channels/email/ingest-message.ts
  - src/lib/channels/email/parse-body.ts
  - src/lib/channels/email/poll-inbox.ts
  - src/lib/channels/email/settings.ts
  - src/lib/channels/email/smtp-client.ts
  - src/lib/channels/email/thread-match.ts
  - src/lib/demo/bootstrap-demo.ts
  - src/lib/demo/fixtures.ts
  - src/lib/demo/identities.ts
  - src/lib/demo/seed-demo-data.ts
  - src/lib/rate-limit/check-rate-limit.ts
  - src/lib/tickets/create-ticket.ts
  - src/lib/worker/jobs/email-outbound-send.ts
  - src/lib/worker/jobs/kb-embed-article.ts
  - src/proxy.ts
  - tests/e2e/a11y-contrast.spec.ts
  - tests/e2e/global-setup.ts
  - tests/e2e/honesty-invariants.spec.ts
  - tests/e2e/phase5-rag.spec.ts
  - tests/e2e/public-intake.spec.ts
  - tests/e2e/public-status.spec.ts
  - tests/e2e/support/db.ts
  - tests/e2e/support/fixtures.ts
  - tests/e2e/support/llm-stub.ts
  - tests/integration/audit-append-only.test.ts
  - tests/integration/draft-generation.test.ts
  - tests/integration/egress-fixtures/dns-logger/Dockerfile
  - tests/integration/egress-fixtures/dns-logger/logger.mjs
  - tests/integration/egress-fixtures/probe.ts
  - tests/integration/egress-fixtures/stub-llm/Dockerfile
  - tests/integration/egress-fixtures/stub-llm/server.mjs
  - tests/integration/egress-isolation.test.ts
  - tests/integration/insight-run.test.ts
  - tests/integration/scoped-tx.test.ts
  - tests/integration/sla-flag-handler.test.ts
  - tests/integration/workspace-isolation.test.ts
  - tests/unit/chunk-markdown.test.ts
  - tests/unit/compose-outbound.test.ts
  - tests/unit/design-tokens.test.ts
  - tests/unit/email-thread-match.test.ts
  - tests/unit/health.test.ts
  - tests/unit/insight-cluster.test.ts
  - tests/unit/proxy.test.ts
  - tests/unit/rate-limit-pepper.test.ts
  - vitest.egress.config.ts
  - website/astro.config.mjs
  - website/package.json
  - website/pnpm-workspace.yaml
  - website/src/content.config.ts
  - website/tsconfig.json
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-09-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 118 (of 120 listed; `.env.example` was excluded from every read/grep tool by the sandbox's own dotenv-shaped-filename guard — could not be inspected even though it holds only placeholders; see note under WR-02)
**Status:** issues_found

## Summary

This phase (launch readiness: CI/CD, docs site, demo mode, backup/restore, security hardening, contrast fixes, branding) is broad but shallow per-file — most of the diff is new scaffolding (GitHub workflows, the Starlight docs site, `scripts/capture-demo-assets.ts`, `src/lib/demo/*`) or mechanical fixes (WCAG contrast, biome formatting, `text-[Npx]` token compliance) that were traced back to their stated root causes and verified correct. Two structurally important changes were specifically traced end-to-end:

- **`middleware.ts` → `proxy.ts` rename** (Next.js 16's own convention — corroborated by `next.config.ts`'s `experimental.proxyClientMaxBodySize` key) plus the new `BLOCKED_PUBLIC_ROUTES` anonymous-sign-up gate. Verified against `tests/unit/proxy.test.ts`'s 7 cases; behavior is correct.
- **`RATE_LIMIT_PEPPER` becoming mandatory** (`||` not `??`, throws on empty string) in `src/lib/rate-limit/check-rate-limit.ts`. The fix itself is correct and tested, but it introduces an operational gap — see WR-02.

No critical/security-blocking defects were found in the reviewed diff. Findings below are all quality/maintainability items plus one operational-robustness gap worth fixing before calling self-host "friction-free" per this project's own `CLAUDE.md` mandate.

## Warnings

### WR-01: Public branding-name lookup duplicated verbatim across two unauthenticated routes

**File:** `src/app/(public)/request/page.tsx:10-19` and `src/app/(public)/status/[token]/page.tsx:24-33`
**Issue:** Both files independently re-implement the identical 6-line "find the org, look up the `branding:workspaceName` Setting row via bare `prisma`, trim, fall back to `org.name`, fall back to `"AIDA"`" sequence, instead of reusing `getBrandingSettings()` from `src/lib/branding/settings.ts` (which every authenticated surface — `(app)/layout.tsx`, `(app)/settings/branding/page.tsx`, the outbound-email worker job — already calls). Both unauthenticated routes could call `scopedDb(org.id)` (which needs no session, only an orgId) and get the exact same fallback/trim semantics from the one canonical implementation. As written, any future change to the branding fallback logic (e.g. a second branding field, a different empty-string rule) has to be remembered and applied in three separate places instead of one, and the two copies can silently drift from each other over time.
**Fix:**
```ts
// src/app/(public)/request/page.tsx and status/[token]/page.tsx
import { getBrandingSettings } from "@/lib/branding/settings";
import { scopedDb } from "@/lib/scoped-db";

const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
const { workspaceName: brandName } = org
  ? await getBrandingSettings(scopedDb(org.id), org.name)
  : { workspaceName: "AIDA" };
```

### WR-02: `RATE_LIMIT_PEPPER` is validated lazily, only when a public route is first hit — no boot-time or health-check signal

**File:** `src/lib/rate-limit/check-rate-limit.ts:19-27`, `docker-compose.yml:67`
**Issue:** The 07-09 security fix correctly makes `RATE_LIMIT_PEPPER` mandatory (throws instead of silently hashing IPs with an empty pepper). However, `docker-compose.yml` still injects `RATE_LIMIT_PEPPER: ${RATE_LIMIT_PEPPER:-}` (defaults to `""` if unset in `.env`), and nothing validates this at boot: `src/instrumentation.ts`'s `register()` never calls `getPepper()`, and `/api/health` (`tests/unit/health.test.ts`) doesn't touch the rate-limit module either. The container will report healthy and every authenticated page will work fine; only `/api/public/intake`, `/api/public/status/[token]/follow-up`, and `/api/public/status/[token]/csat` will 500 on every call — discoverable only when a real customer tries to submit a ticket or a status follow-up. Given this project's explicit "one-command self-host is a first-class feature… keep setup friction near zero" mandate (`CLAUDE.md`), a forgotten env var that silently breaks the public intake form (the customer-facing entry point of a helpdesk) is exactly the kind of launch-blocking surprise that mandate exists to prevent. (I could not confirm whether `.env.example` documents `RATE_LIMIT_PEPPER` as required — that file was unreadable in this review environment; if it already documents this clearly, downgrade the severity of this finding accordingly.)
**Fix:** Add an eager check in `src/instrumentation.ts`'s `register()` (mirroring how `APP_ENCRYPTION_KEY` could similarly be checked) so a misconfigured deployment fails loudly at container start instead of on the first customer request:
```ts
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.RATE_LIMIT_PEPPER) {
      console.error(
        "[boot] RATE_LIMIT_PEPPER is not set — public routes (intake, status follow-up, CSAT) will fail. " +
          "Generate one with: openssl rand -base64 32",
      );
    }
    const { bootstrapFromEnv } = await import("@/lib/bootstrap");
    await bootstrapFromEnv();
    ...
```
(A loud log line is enough here — the existing design deliberately keeps `bootstrapFromEnv`'s own failures non-fatal, so this shouldn't crash the process either, just surface the misconfiguration immediately instead of on first public request.)

### WR-03: `docker-compose.egress-test.yml`'s `migrate` service duplicates `CHECKPOINT_DISABLE` fix but the comment attributing the fix's *discovery* only lives in one file

**File:** `docker-compose.egress-test.yml:84` / `docker-compose.yml:32`
**Issue:** Minor — not a functional bug, since both files correctly set `CHECKPOINT_DISABLE: "1"`. Flagged only because the two nearly-identical multi-line explanatory comments (one in each compose file) are another instance of the WR-01 duplication pattern: if a future engineer updates the reasoning in one file (e.g. Prisma changes the env var name), the other copy is easy to miss. Low priority — a `# see docker-compose.yml's matching fix` one-liner (which `docker-compose.egress-test.yml` already partially does) is sufficient; just make sure future edits touch both.
**Fix:** No code change required; flagging for awareness only. Consider a single `# CHECKPOINT_DISABLE: see docker-compose.yml` cross-reference to avoid comment drift.

## Info

### IN-01: `saveBranding` performs `.trim()` on unvalidated input before entering its `try/catch`

**File:** `src/app/(app)/settings/branding/actions.ts:19`
**Issue:** `saveBranding(input: { workspaceName: string })` calls `input.workspaceName.trim()` and checks `.length` *before* the `try { ... } catch { return { ok: false, ... } }` block below it. Next.js Server Actions are reachable as direct HTTP endpoints and are not runtime-type-checked — TypeScript's `workspaceName: string` annotation is not enforced at the network boundary. A malformed direct POST (e.g. `workspaceName: null`) would throw an uncaught `TypeError` instead of returning the `{ ok: false, error }` shape every other branch of this function (and its sibling actions) uses, surfacing as a generic Next.js error rather than a handled failure. Low practical risk since `requireOrgAdmin()` runs first (an attacker would need an existing admin session), but it's an inconsistency worth closing since the rest of the function is otherwise carefully defensive.
**Fix:**
```ts
export async function saveBranding(input: { workspaceName: string }) {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();

  if (typeof input.workspaceName !== "string") {
    return { ok: false, error: "Invalid workspace name." };
  }
  const workspaceName = input.workspaceName.trim();
  ...
```

### IN-02: `.env.example` could not be reviewed in this pass

**File:** `.env.example`
**Issue:** Every read/grep attempt against this exact filename was denied by the review sandbox's own permission layer (dotenv-shaped filenames are blocked outright, even for a file that — per `.gitignore`/`.dockerignore` — is explicitly the *placeholder-only* template meant to be safe to read). This is a reviewer-environment limitation, not a code defect, but it means this review could not verify that `.env.example` documents `RATE_LIMIT_PEPPER` (WR-02), `APP_ENCRYPTION_KEY`, and the other now-mandatory secrets as required, nor that it contains no accidental real-looking secrets. Recommend a follow-up pass (or a human `cat .env.example`) to close this gap.
**Fix:** N/A — process note for the next reviewer/human, not a code change.

---

_Reviewed: 2026-09-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
