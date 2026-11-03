# Phase 9: Operations - Pattern Map

**Mapped:** 2026-11-12 (for the replan; analogs read in the current checkout of branch `v2/run-loop`)
**Files analyzed:** 96 entries from the `files_modified` lists of 09-01 to 09-11, corrected by CONTEXT "Update 2026-11-12" (U-01 to U-18)
**Analogs found:** 84 / 96 (the rest are listed under "No Analog Found")

Every analog path below was checked with `git ls-files` (all tracked source; no install or runtime mirror). Line numbers are for the current checkout.

---

## 0. Drift since the plans were written (read this first)

The plans were written against `1e276dc`. These facts change what the planner may copy.

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D1 | 09-04 adds a new `PendingFileDeletion` outbox, a `file-deletion-sweep` job and `src/lib/storage/file-deletion.ts` | `ProjectFileCleanup` exists (`prisma/schema.prisma:1346-1359`, migration `prisma/migrations/20261113100000_projects_foundation/migration.sql:298-308, 422, 425, 554, 648-651`), with `enqueueFileCleanupInTx` (`src/lib/projects/file-cleanup.ts:44-60`) and `sweepProjectFileCleanup` (`:149-219`), job `src/lib/worker/jobs/project-file-cleanup.ts:14-16`, registered `src/lib/worker/index.ts:138-146` every minute (`PROJECT_FILE_CLEANUP_CRON = "* * * * *"`, `src/lib/projects/contract.ts:324`) | U-11: drop `PendingFileDeletion`, `file-deletion-sweep.ts`, the trigger outbox and its 12-case matrix as written. Extend the existing queue and sweep. `ProjectFileCleanup` is already in `DOMAIN_MODELS` (`src/lib/scoped-db.ts:57`), so review P3's scoping is already met |
| D2 | 09-04 says the worker lacks the uploads mount and 09-08 adds it | `worker` already mounts `uploads_data` and sets `UPLOADS_DIR` (`docker-compose.yml:111-115`, K68); pinned by `tests/unit/compose-uploads.test.ts:41-60` | Remove the 09-08 mount task; keep the test as the regression |
| D3 | 09-04 Q1: trigger INSERTs need a DB-generated id | `ProjectFileCleanup.id` is `@default(cuid())` (Prisma side only, DDL `"id" TEXT NOT NULL` with no default, migration line 299); `enqueueFileCleanupInTx` supplies `randomUUID()` ids itself (`file-cleanup.ts:51-58`) | If any enqueue moves into a SQL trigger, the trigger must supply the id (`gen_random_uuid()::text`) or a non-destructive migration adds a DB default. Keep the app-side `enqueueFileCleanupInTx` call as the default path |
| D4 | P4 wanted rows to outlive an organization delete | `ProjectFileCleanup.organization` is `onDelete: Cascade` (`schema.prisma:1355`, FK migration line 554); U-11 says keep the cascade | An organization delete removes its queue rows, so its files are never swept. No org delete path exists in `src/` today (`git grep deleteOrganization` is empty), so record this as a documented limit, or have the audit (U-13) show it is unreachable |
| D5 | Sweep "ENOENT counts as done only after mount verification" | `sweepProjectFileCleanup` counts ENOENT as done unconditionally (`file-cleanup.ts:193-200`) and runs all deletes inside ONE transaction with `TRANSACTION_OPTIONS` `{ maxWait: 10_000, timeout: 30_000 }` (`contract.ts:332`) | The fence (U-12) and any mount check go inside this function, not a new job |
| D6 | U-12: a timed-out delete may still finish | `withinBudget` (`file-cleanup.ts:120-130`) races the delete against a timer and rejects with `ETIMEDOUT`; the `storage.delete` promise keeps running after the transaction ends. Proven by the hanging-delete test (`tests/integration/project-file-cleanup.test.ts:452-474`) | A transaction-scoped advisory lock is released at commit while the timed-out unlink can still run. The fence must cover the whole `storage.delete` promise, not the transaction |
| D7 | 09-05 adds `/api/public/logo/...` to `PUBLIC_PREFIXES` | `PUBLIC_PREFIXES` already contains `/api/public` (`src/proxy.ts:6-14`); CSP `img-src 'self' data: blob:` (`src/lib/security/csp.ts:58`); proxy sets `X-Content-Type-Options: nosniff` on every exit (`csp.ts:73-80`, `proxy.ts:63-68`) | U-02: no `src/proxy.ts` edit. `tests/unit/proxy.test.ts` may only gain an assertion that the logo path is public |
| D8 | 09-05 uses `checkRateLimit` + "identity limits F-07/F-12 until Phase 8 lands" | Public routes now call `consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs })` and `rateLimitedResponse` (`src/app/api/public/status/[token]/attachments/[id]/route.ts:17-22`); scopes live in `PUBLIC_RATE_LIMITS` (`src/lib/rate-limit/public-limits.ts:7-14`) | Copy that route. Drop the "until Phase 8 lands" docs caveat; Phase 8 Part A is in (U-01) |
| D9 | 09-02 "stable identity: the demo organization slug" | `createFirstOrgAndAdmin` hardcodes `name: "AIDA", slug: "aida"` for BOTH the real `bootstrapFromEnv` path and the demo path (`src/lib/bootstrap.ts:31-33`, called from `src/lib/demo/identities.ts:62-66`) | The slug cannot tell a demo org from a real one. The completion marker (U-17) is the discriminator, plus "every user is a configured demo identity" |
| D10 | 09-02 `recoverDemoPartial()` | U-04 and U-17 forbid it | Remove all deletion. Refusal = one log line, no write |
| D11 | Seed guard reads ticket count after `ensureDemoIdentities()` | Still so: `prisma/seed.ts:31` creates identities, then `:34-48` counts tickets and prints `docker compose down -v` (`:45`); passwords printed at `:59-60` | D-16 and D-18 still apply as written |
| D12 | Demo boot skips on any ticket | `bootstrapDemoMode` checks `prisma.ticket.count()` before `ensureDemoIdentities()` and swallows every error (`src/lib/demo/bootstrap-demo.ts:21-49`) | Keep the never-block catch (U-17). Replace the ticket-count guard |
| D13 | 09-01 compose lines 29, 49, 101 | `DATABASE_URL` is now at `docker-compose.yml:32` (migrate), `:52` (app), `:107` (worker). `migrate` uses `target: builder` and calls `node node_modules/prisma/build/index.js migrate deploy` (`:20-27`) | Re-anchor 09-01 on these lines |
| D14 | 09-09 h1 inventory "12 app pages plus ticket-meta-header" | 15 page files under `src/app/(app)` render an `<h1>`, plus `src/components/tickets/ticket-meta-header.tsx:388` and `src/components/top-bar.tsx:55`. New since the plans: `kb/new`, `kb/proposals`, `kb/proposals/[id]` (`page.tsx:98`), `settings/statuses`. The top bar maps only `/tickets`, `/contacts`, `/kb`, `/settings` (`top-bar.tsx:21-26`); `/insights` falls back to "AIDA". No `/projects` UI route exists | Re-enumerate the route list from `find src/app/(app) -name page.tsx` at execution |
| D15 | DESIGN-SYSTEM "line 184" | The Sparkles rule is at `.planning/DESIGN-SYSTEM.md:204` ("Sidebar brand box: `Sparkles`, do not change except for a rebrand"); brand header sample at `:102` | Amend line 204 and the §4 sample |
| D16 | 09-11 project `aida`, `assertStackRunAllowed`, `rm -r .next` | Rule-J helpers exist (section 6 below) | U-15: write specifications only, recorded `not run (waiting for the Phase 8.1 harness and the owner)` |
| D17 | 09-04 dev migration in `aida-dev-db` | 08-02 now forbids touching `aida-dev-db`; it uses its own `aida-test-devdb-<runId>-<6 hex>` container (section 6) | Copy 08-02's procedure for any `prisma migrate dev --create-only` |
| D18 | New migrations | Latest migration folder is `20261113100000_projects_foundation` | A new folder name must sort after it |
| D19 | `.github/workflows/integration.yml` | Has `schedule:` (`:8-11`), so it breaks rule I | Phase 9 must not edit it (editing it would bring it under U-06). Copy `audit.yml` instead |

---

## File Classification

Grouped by plan. "Match": exact = same role and data flow; role = same role; flow = same data flow; partial = one aspect only.

### 09-01 Database URL (AIDA-35)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/db-url.ts` (new) | utility | transform | `src/lib/rate-limit/pepper-check.ts` (pure boot check, no project imports, never logs value) | role |
| `scripts/database-url.sh` (new) | utility (shell) | transform | `scripts/backup.sh` (bash header, `set -euo pipefail`) | partial |
| `scripts/check-database-url.ts` (new) | utility (CLI) | transform | `scripts/part-a-gate-check.ts:1-28` (tsx CLI header, `pathToFileURL` main guard) | role |
| `docker-compose.yml` | config | n/a | itself, `:32`, `:52`, `:107` | exact |
| `.env.example` | config | n/a | itself `:12-15` | exact |
| `src/instrumentation.ts` | middleware (boot) | event-driven | itself `:1-13` (pepper check is the first boot step) | exact |
| `src/lib/worker/index.ts` | service (boot) | event-driven | itself `:18-25` (`DATABASE_URL` required check) | exact |
| `docs/OPERATIONS.md`, `website/src/content/docs/configuration/environment.md` | docs | n/a | `docs/OPERATIONS.md:310-336` env table | exact |
| `tests/unit/db-url.test.ts` | test | transform | `tests/unit/rate-limit-pepper-boot.test.ts:1-30` | role |
| `tests/integration/compose-database-url.test.ts` | test | file-I/O | `tests/unit/compose-uploads.test.ts:1-60` (static compose read) | role |

### 09-02 Seed and demo guards (AIDA-37, AIDA-38)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/demo/tenant-guard.ts` (new) | service | request-response (DB read + lock) | `src/lib/rate-limit/check-rate-limit.ts:270-280` (tx advisory lock via `$executeRaw`) | flow |
| `src/lib/demo/bootstrap-demo.ts` | service (boot) | event-driven | itself `:13-50` | exact |
| `src/lib/demo/seed-demo-data.ts` | service | batch | itself `:342+` | exact |
| `src/lib/demo/identities.ts` | service | CRUD | itself `:29-104` | exact |
| `src/lib/bootstrap.ts` | service | CRUD | itself `:12-75` | exact |
| `prisma/seed.ts` | utility (CLI) | batch | itself `:29-72` | exact |
| `scripts/capture-demo-assets.ts` | utility (CLI) | batch | itself `:805-810` (prints the seed's stdout) | exact |
| `docs/SECURITY.md` | docs | n/a | itself, "Secrets & keys" `:10` | exact |
| `tests/integration/seed-guard.test.ts`, `tests/integration/demo-boot.test.ts` | test | CRUD | `tests/integration/project-file-cleanup.test.ts:1-90` (Testcontainers, dynamic import after env) + `tests/support/console-capture.ts:1-30` | role |
| `tests/integration/helpers/table-inventory.ts` | test helper | CRUD | `tests/integration/support/isolated-database.ts:1-80` (pg client, no `src/` import). Note: the folder is `tests/integration/support/`, not `helpers/` | role |

### 09-03 Records and repo health (AIDA-39, AIDA-40, AIDA-41)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `.planning/milestones/v1.0.0-phases/01-foundation/01-VERIFICATION.md` (new) | docs | n/a | `.planning/milestones/v1.0.0-phases/02-core-ticketing/02-VERIFICATION.md:1-30` | exact |
| `.planning/STATE.md` | docs | n/a | itself (sections `:23`, `:31`, `:38`, `:112`, `:122`) | exact |
| `scripts/check-version.mjs` (new) | utility (CLI) | transform | `scripts/part-a-gate-check.ts` (pure module + `main`); repo scripts are `.ts` run by tsx | role |
| `.github/workflows/check-version.yml` (new) | config (CI) | event-driven | `.github/workflows/audit.yml:1-41` | exact |
| `tests/unit/check-version.test.ts` + `tests/unit/fixtures/check-version/` | test | transform | `tests/unit/part-a-gate-check.test.ts:1-40` (fixtures in temp dirs, no process spawn) | role |
| `AGENTS.md` (new) | docs | n/a | `CLAUDE.md` (mirror the commands) | partial |
| `LAUNCH.md` | docs | n/a | itself | exact |
| `package.json` (version `1.0.0`, U-05) | config | n/a | itself `:1-8` (no `version` field today) | exact |
| `CODEOWNERS` (new, U-05) | config | n/a | none in repo | none |

### 09-04 Deletion queue and backup fence (AIDA-33, AIDA-38), rewritten by U-11 to U-14

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `prisma/schema.prisma` | model | CRUD | `ProjectFileCleanup` `:1346-1359` | exact |
| `prisma/migrations/<after 20261113100000>_.../migration.sql` (new) | migration | n/a | `prisma/migrations/20261113100000_projects_foundation/migration.sql:298-308, 648-651`; trigger style `prisma/migrations/20261110100000_ticket_states/migration.sql:293-320` | exact |
| `src/lib/projects/file-cleanup.ts` (extend; rename only by non-destructive migration) | service | batch | itself | exact |
| `src/lib/storage/backup-lease.ts` (new) | service | request-response (DB lock) | `src/lib/projects/file-cleanup.ts` (relative imports, raw SQL, db clock) + `check-rate-limit.ts:270-280` (advisory xact lock) | role |
| `src/lib/attachments/local-file-storage.ts` | service | file-I/O | itself `:16-29` | exact |
| `src/lib/attachments/staged-files.ts` | utility | file-I/O | itself `:43-61` | exact |
| `src/lib/attachments/validate-uploads.ts` | utility | file-I/O | itself `:66-94` | exact |
| `src/lib/worker/jobs/project-file-cleanup.ts` | service (job) | batch | itself `:14-16` | exact |
| `src/lib/worker/index.ts` | config (job registry) | event-driven | itself `:138-146` | exact |
| `src/app/api/public/intake/route.ts`, `src/app/api/public/status/[token]/follow-up/route.ts`, `src/app/api/tickets/[id]/messages/route.ts`, `src/lib/channels/email/ingest-message.ts`, `src/lib/projects/attachments.ts`, `src/lib/projects/delete.ts` | controller / service | file-I/O | themselves (call sites, section 2) | exact |
| `tests/integration/deferred-deletion.test.ts` (rename suggested: extend `project-file-cleanup.test.ts` or a sibling) | test | batch | `tests/integration/project-file-cleanup.test.ts` | exact |
| `tests/integration/file-lifecycle-inventory.test.ts` | test | file-I/O | `tests/integration/project-file-cleanup.test.ts:73-90` + `tests/unit/staged-files.test.ts:57-90` | role |
| `tests/unit/backup-lease.test.ts` | test | transform | `tests/unit/rate-limit-pepper.test.ts` style; pure parse cases | role |
| ~~`src/lib/scoped-db.ts`~~ | | | already lists `ProjectFileCleanup` (`:57`); no edit unless the table is renamed | n/a |
| ~~`src/lib/storage/file-deletion.ts`, `src/lib/worker/jobs/file-deletion-sweep.ts`~~ | | | dropped by U-11 | n/a |

### 09-05 Logo backend (AIDA-34)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/branding/logo-validate.ts` (new) | utility | transform | `src/lib/attachments/validate-upload.ts:53-76` | exact |
| `src/lib/branding/logo-store.ts` (new) | service | file-I/O + CRUD | `src/lib/projects/attachments.ts:219-298` (stage, transaction, discard) + `:323-349` (delete row + enqueue in same tx) | exact |
| `src/lib/branding/settings.ts` | service | CRUD | itself `:12-90` | exact |
| `src/app/(app)/settings/branding/logo-actions.ts` (new) | controller (server action) | request-response | `src/app/(app)/settings/branding/actions.ts:1-35` | exact |
| `src/app/api/public/logo/[orgId]/[version]/route.ts` (new) | route | request-response (file read) | `src/app/api/public/status/[token]/attachments/[id]/route.ts:1-45` | exact |
| `src/proxy.ts` | middleware | request-response | no edit needed (D7) | n/a |
| `docs/SECURITY.md` | docs | n/a | itself | exact |
| `tests/unit/logo-validate.test.ts` | test | transform | `tests/unit/validate-upload.test.ts` | exact |
| `tests/unit/proxy.test.ts` | test | request-response | itself | exact |
| `tests/integration/logo-store.test.ts` | test | file-I/O | `tests/integration/project-comments-attachments.test.ts`, `project-file-cleanup.test.ts:24-41` (temp `UPLOADS_DIR`) | role |

### 09-06 and 09-08 Backup service, scheduler, status (AIDA-33)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `scripts/backup/aida-backup.sh`, `scripts/backup/lib.sh`, `scripts/backup/scheduler.sh` (new) | utility (shell) | batch, file-I/O | `scripts/backup.sh:16-70`, `scripts/restore.sh:39-80` | role |
| `scripts/backup.sh` | utility (shell) | batch | itself | exact |
| `docker-compose.yml` (`backup` service, `backups_data`) | config | n/a | `db` `:3-16` (image), `worker` `:98-120` (env, volume, restart); volumes `:138-146` | role |
| `.env.example`, `docs/OPERATIONS.md` (`## Backups` `:5`, `### Automating backups (cron)` `:35`, `## Restore` `:47`, root-owned volume `:105-152`), `website/.../environment.md` | docs | n/a | themselves | exact |
| `src/lib/backup/status.ts` (new) | service | CRUD (read SystemSetting) | `src/lib/worker/jobs/heartbeat.ts:3-10` (SystemSetting key/value) + `src/lib/branding/settings.ts:31-60` (typed parse with fallback) | role |
| `src/app/(app)/settings/backups/page.tsx` (new) | component (server page) | request-response | `src/app/(app)/settings/branding/page.tsx:1-38`, `settings/tags/page.tsx:1-32` | exact |
| `src/app/(app)/settings/settings-nav.tsx` | component | n/a | itself `:7-15` | exact |
| `tests/integration/backup-consistency.test.ts`, `tests/integration/helpers/backup-runner.ts` | test | batch | `tests/integration/project-file-cleanup.test.ts` (interleaving with `onLocked` and `deferred`) + `tests/support/lock-wait.ts` | role |
| `tests/unit/backup-status.test.ts`, `tests/unit/backup-scheduler.test.ts` | test | transform | `tests/unit/test-image-check.test.ts:1-30` (scripted fakes, no daemon) | role |
| `tests/e2e/backups-status.spec.ts` | test (E2E) | request-response | `tests/e2e/attachments.spec.ts:1-30` | role |
| `.gitignore` | config | n/a | itself | exact |

### 09-07 Logo UI (AIDA-34)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/components/brand-mark.tsx` (new) | component | n/a | `src/components/sidebar.tsx:46-54` and `src/components/public/public-page-shell.tsx:20-25` (two copies of the brand box) | exact |
| `src/components/sidebar.tsx` | component | n/a | itself `:16-21`, `:41-54` | exact |
| `src/app/(app)/layout.tsx` | component (layout) | request-response | itself `:32-38`, `:51` | exact |
| `src/app/(app)/settings/branding/page.tsx`, `branding-form.tsx`, `logo-card.tsx` (new) | component | request-response | `branding-form.tsx:45-114` (react-hook-form + server action + toast + preview) | exact |
| `src/components/public/public-page-shell.tsx` | component | n/a | itself | exact |
| `src/app/(public)/request/page.tsx`, `src/app/(public)/status/[token]/page.tsx` | component (server page) | request-response | themselves (`status/[token]/page.tsx:26-35` brand lookup) | exact |
| `.planning/DESIGN-SYSTEM.md` | docs | n/a | itself `:102`, `:204` | exact |
| `tests/e2e/logo.spec.ts` | test (E2E) | file-I/O | `tests/e2e/attachments.spec.ts` (+ `tests/e2e/fixtures/sample.png`) | exact |

### 09-09 Single h1 (AIDA-36)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/components/top-bar.tsx` | component | n/a | itself `:21-33`, `:55` | exact |
| `src/components/empty-state.tsx` | component | n/a | itself `:9-27` (uses `<h2>`) | exact |
| `src/app/(app)/layout.tsx` | component | n/a | itself `:53-54` | exact |
| page and error files under `src/app/(app)/tickets`, `contacts`, `kb` (+ any page found at execution) | component | n/a | `src/app/(app)/kb/page.tsx:32`, `insights/page.tsx:59` (visible h1); `src/app/(app)/kb/page.tsx:40` (`sr-only`) | exact |
| `src/app/(app)/tickets/ticket-list-panel.tsx` | component | n/a | itself | exact |
| `src/lib/testing/e2e-fault.ts` (new) | utility | n/a | none (see No Analog) | none |
| `tests/unit/e2e-fault.test.ts` | test | transform | `tests/unit/rate-limit-pepper-boot.test.ts` (env stubs) | role |
| `tests/e2e/global-setup.ts` | config (test) | n/a | itself `:85-104` (server env incl. `TRUSTED_PROXY_HOPS: "0"` `:96`) | exact |
| `tests/e2e/single-h1.spec.ts` | test (E2E) | request-response | `tests/e2e/csp.spec.ts`, `tests/e2e/a11y-contrast.spec.ts` (route sweeps) | role |

### 09-10 Restore and installer (AIDA-33, AIDA-38, AIDA-40)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `scripts/backup/aida-restore-set.sh`, `scripts/restore.sh` | utility (shell) | batch, file-I/O | `scripts/restore.sh:12-105` | exact |
| `scripts/install.sh` (new) | utility (shell) | file-I/O | `scripts/backup.sh` header and preflight | partial |
| `tests/unit/restore-script.test.ts`, `tests/unit/install-script.test.ts`, `tests/unit/fixtures/restore/docker`, `tests/unit/fixtures/install/fake-curl.sh`, `fake-docker.sh` | test | file-I/O | `tests/unit/test-image-check.test.ts:349-430` (scripted fake daemon recording calls) | flow |
| `tests/integration/backup-restore-roundtrip.test.ts` | test | file-I/O | `tests/integration/project-file-cleanup.test.ts` | role |
| `tests/integration/egress-isolation.test.ts` | test | event-driven | itself `:1-45`, `:197` | exact |
| `README.md`, `docs/OPERATIONS.md`, `docs/SECURITY.md` (`## Data residency & egress` `:5`) | docs | n/a | themselves | exact |

### 09-11 Stack proofs (specification only, U-15) and gate

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `tests/stack/*` specs (written as specification, not run) | test spec | n/a | `tests/integration/egress-isolation.test.ts:1-45` (the only rule-J stack suite) | role |
| ~~`tests/stack/bin/docker`, `tests/stack/guard.ts`, `tests/unit/stack-guard.test.ts`, `vitest.stack.config.ts`~~ | | | U-15: no own harness; the 08-14 harness comes with Phase 8.1 | n/a |
| `vitest.config.ts`, `vitest.integration.config.ts`, `package.json` | config | n/a | `vitest.integration.config.ts:1-15` (egress excluded `:7`) | exact |
| `.planning/phases/09-operations/09-GATE.md` | docs | n/a | `.planning/phases/08-security-hardening/08-GATE-A.md` + `scripts/part-a-gate-check.ts` | exact |
| `.planning/STATE.md` | docs | n/a | itself | exact |

---

## Pattern Assignments

### 1. The single deletion queue (U-11, U-12, U-13, U-14)

**Analog:** `src/lib/projects/file-cleanup.ts` (tracked, 219 lines). Header `:1-25` states the contract: enqueue inside the caller's delete transaction; the sweep is the one cross-organization reader; logs carry key and error code only; relative imports only because the worker bundles it.

**Imports** (`:26-35`):
```typescript
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { FileStorage } from "../attachments/file-storage";
import {
  PROJECT_FILE_CLEANUP_BATCH,
  PROJECT_FILE_CLEANUP_IO_BUDGET_MS,
  PROJECT_FILE_CLEANUP_MAX_ATTEMPTS,
  PROJECT_FILE_CLEANUP_MAX_BACKOFF_MINUTES,
  TRANSACTION_OPTIONS,
} from "./contract";
```

**Enqueue in the caller's transaction** (`:44-60`), the pattern every new delete path (ticket attachments, logo replace and remove) must call:
```typescript
export async function enqueueFileCleanupInTx(
  tx: Prisma.TransactionClient,
  orgId: string,
  storageKeys: readonly string[],
): Promise<number> {
  const keys = [...new Set(storageKeys)];
  if (keys.length === 0) return 0;
  const ids = keys.map(() => randomUUID());
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "ProjectFileCleanup" (id, "organizationId", "storageKey")
    SELECT k.id, ${orgId}, k.key
    FROM unnest(${ids}::text[], ${keys}::text[]) AS k(id, key)
    ON CONFLICT ("organizationId", "storageKey") DO NOTHING
    RETURNING id
  `;
  return inserted.length;
}
```

**Sweep core** (`:156-218`): one `$transaction` with `TRANSACTION_OPTIONS`; reads the database clock (`databaseNow`, `:142-146`); selects due rows `FOR UPDATE SKIP LOCKED` (`:160-167`); the test hook `onLocked` runs after the select (`:169-173`); per row `withinBudget(storage.delete(...), remaining)` (`:184-187`); success or ENOENT deletes the row (`:193-200`); any other code sets `attempts + 1`, `lastErrorCode`, `nextAttemptAt` with back-off `min(2^attempts, 60)` minutes (`:203-214`); an `IoBudgetExceeded` stops the batch (`:215`). Every statement after the select names the row's `organizationId`.

**Where the fence must go (U-12):** around the `storage.delete` at `:184-187`, held until that promise settles, including after `withinBudget` rejects. `withinBudget` (`:120-130`) does not cancel the work promise. A transaction-scoped advisory lock alone does not satisfy U-12 (released at commit and lost when the session drops).

**Callers today:**
- `src/lib/projects/attachments.ts:323-349` `deleteTaskAttachment`: `tx.taskAttachment.deleteMany` then `enqueueFileCleanupInTx(tx, actor.orgId, [row.storageKey])` in the same `runProjectTransaction`.
- `src/lib/projects/delete.ts:91-102`: collect `storageKeys`, `enqueueFileCleanupInTx(tx, orgId, storageKeys)` (step 4) before the `taskAttachment.deleteMany` (step 5).
- Job: `src/lib/worker/jobs/project-file-cleanup.ts:14-16` `sweepProjectFileCleanup({ client: prisma, storage: localFileStorage })`.
- Registration: `src/lib/worker/index.ts:142-146`:
```typescript
  await boss.createQueue(PROJECT_FILE_CLEANUP_QUEUE, { policy: "singleton" });
  await boss.work(PROJECT_FILE_CLEANUP_QUEUE, async (jobs: Job[]) => {
    await projectFileCleanupHandler(jobs);
  });
  await boss.schedule(PROJECT_FILE_CLEANUP_QUEUE, PROJECT_FILE_CLEANUP_CRON, {});
```

**Schema** (`prisma/schema.prisma:1346-1359`):
```prisma
// K66: the file cleanup outbox; no relation except organization.
model ProjectFileCleanup {
  id             String       @id @default(cuid())
  organizationId String
  storageKey     String
  attempts       Int          @default(0)
  lastErrorCode  String?
  nextAttemptAt  DateTime     @default(now())
  createdAt      DateTime     @default(now())
  organization   organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, storageKey])
  @@index([nextAttemptAt, createdAt])
}
```
DB checks (`migration.sql:648-651`): `"storageKey" ~ '^[a-z0-9]+\.[a-z0-9]{1,8}$'` and `attempts >= 0`. The same key shape is the path guard in `local-file-storage.ts:11-14`. A rename needs `ALTER TABLE ... RENAME` plus renamed constraints and indexes (non-destructive, U-11) and a matching change in `DOMAIN_MODELS` (`scoped-db.ts:57`) and `tests/unit/project-schema-parity.test.ts`.

**Every caller of `FileStorage.delete` (U-13 audit list):**

| Site | Line | When it deletes | Committed reference? |
|---|---|---|---|
| `src/lib/projects/file-cleanup.ts` | `:185` | queue sweep | no (row already deleted in an earlier tx) |
| `src/lib/attachments/staged-files.ts` `deleteEach` | `:50` | save failure (`:79-81`) and `discard()` (`:88-92`) | no |
| `src/lib/attachments/validate-uploads.ts` `removeStoredUploads` | `:83` (function `:80-94`) | intake failure (`src/app/api/public/intake/route.ts:120-126`), follow-up `discard` (`src/app/api/public/status/[token]/follow-up/route.ts:98-104`, called `:150`, `:158`) | no |
| `discard()` callers of `saveStagedFiles` | `src/app/api/tickets/[id]/messages/route.ts:100-104`, `:164`, `:169`; `src/lib/projects/attachments.ts:242-246`, `:293`, `:296` | refusal or thrown error | no |
| Organization cascade to `Attachment`, `TaskAttachment`, `ProjectFileCleanup` | `schema.prisma:475`, `:1241`, `:1355` | no `src/` path deletes an organization today | n/a |

Not a delete but relevant: `src/lib/channels/email/ingest-message.ts:146` saves with `localFileStorage.save` directly, with no staged rollback, so a failure after some saves leaves unreferenced files (U-13 says such files may be deleted at any time; the backup must tolerate them).

**Storage** (`src/lib/attachments/local-file-storage.ts:16-29`): `save` does `mkdir(recursive)` then `writeFile` (overwrites today; D-02(1) asks for `flag: "wx"`), `read` is `readFile`, `delete` is `unlink`, all under `ROOT/<orgId>/<safeKey(key)>`. `ROOT` is read when the module loads (`:6`), so tests set `UPLOADS_DIR` before a dynamic import (see test pattern below). Keys come only from `buildStorageKey` (`:33-42`).

**Test pattern** (`tests/integration/project-file-cleanup.test.ts`):
- Setup `:24-41`: `mkdtemp` an uploads dir, set `process.env.UPLOADS_DIR`, then `await import("@/lib/attachments/local-file-storage")`.
- Table ownership `:43-52`: `beforeEach` wipes `"ProjectFileCleanup"`; safe only because `vitest.integration.config.ts:13` sets `fileParallelism: false`.
- Interleaving `:255-330`: park sweep 1 inside `storage.delete` with a `deferred()`, record its PID with `backendPid(tx)` in `onLocked`, and run a watchdog on `pg_blocking_pids` (helpers in `tests/support/lock-wait.ts:17-50`). Reuse this for the U-12 cases (paused backup, dropped DB session, I/O timeout).
- Timeout `:452-474`: a storage whose delete never settles plus `ioBudgetMs: 300` gives `ETIMEDOUT`. This is the base for the U-12 "timed-out delete still finishes" case.
- Fixtures: `seedFileCleanup` (`tests/support/project-fixtures.ts:336`), `seedOrgWithMembers`.

### 2. Backup lease and fence: `src/lib/storage/backup-lease.ts` (new)

**Analogs:** `src/lib/rate-limit/check-rate-limit.ts:270-280` (transaction-scoped advisory lock through `$executeRaw`, since `pg_advisory_xact_lock` returns void) and `src/lib/tickets/relations.ts:214` (`hashtextextended('aida:...' || orgId, 0)` keyed lock):
```typescript
await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${RATE_LIMIT_LOCK_TIMEOUT_MS}ms`}, true)`;
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;
```
Lease row: `SystemSetting` (`schema.prisma:206-211`, `key String @unique`, `value String`), already used by `heartbeat.ts:5-9` and `bootstrap.ts:41-45` (upsert). Only `SystemSetting`, `RateLimitHit`, `_prisma_migrations` and `pgboss` are infrastructure (D-15). `ProjectFileCleanup` is org-scoped.
Relative imports only (worker bundle), as `file-cleanup.ts:25`.

### 3. Logo route: `src/app/api/public/logo/[orgId]/[version]/route.ts`

**Analog:** `src/app/api/public/status/[token]/attachments/[id]/route.ts:1-45`.

Imports and limit-first (`:1-22`):
```typescript
import { NextResponse } from "next/server";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit/public-limits";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.statusAttachment;
  const limit = await consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs });
  if (!limit.allowed) {
    return rateLimitedResponse(limit.retryAfterSeconds);
  }
```
Not found (`:28-31`): `NextResponse.json({ error: "not_found" }, { status: 404 })`. File response (`:33-44`): `new Response(new Uint8Array(buffer), { headers: { "Content-Type": ..., "Cache-Control": ... } })`.
Add a scope `logo` to `PUBLIC_RATE_LIMITS` (`src/lib/rate-limit/public-limits.ts:7-14`); route files may export only Next.js route fields (`:2`). `getRateLimitIdentity` (`client-ip.ts:132-134`) = `rateLimitKeyForIp(getClientIp(request))`, which collapses IPv6 to /64. Use it rather than raw `getClientIp`, as every public route does. `nosniff` is already set by the proxy (`csp.ts:76`); setting it on the route response too is harmless and makes it explicit (D-09).

### 4. Logo validation, store and actions

**Validation analog:** `src/lib/attachments/validate-upload.ts:53-76`: size check before reading, check bytes read, `fileTypeFromBuffer` sniff, refusal codes:
```typescript
if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_BYTES) {
  return { ok: false, code: "FILE_TOO_LARGE" };
}
const buffer = Buffer.from(await file.arrayBuffer());
if (buffer.length > MAX_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };
const sniffed = buffer.length === 0 ? undefined : await fileTypeFromBuffer(buffer);
if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) {
  return { ok: false, code: "UNSUPPORTED_FILE_TYPE" };
}
```
For the logo: its own allow-set (PNG, JPEG, WebP), 1 MiB, plus a header dimension read (no analog, see below).

**Store analog (stage, commit, discard; replace enqueues the old key):** `src/lib/projects/attachments.ts:241-297`: `saveStagedFiles` before the transaction, `discard()` on a refusal or a throw. Then `:330-336`: delete the row and `enqueueFileCleanupInTx` in the same transaction. Logo replace = save the new key (staged), then in one transaction lock the org's `branding:logo` setting row (P10: per-org serialization; `SELECT ... FOR UPDATE` on `Setting` by `(organizationId, key)`), write the new value, and `enqueueFileCleanupInTx(tx, orgId, [oldKey])`.

**Settings analog:** `src/lib/branding/settings.ts:12-14` (key registry), `:31` (`SettingDb` narrow type), `:62-75` (`findFirst` + update/create, never `.upsert()` on scopedDb). This file must keep relative imports (`:4-8`; the worker imports it).

**Server action analog:** `src/app/(app)/settings/branding/actions.ts:13-35`:
```typescript
"use server";
export async function saveBranding(input: { workspaceName: string }): Promise<{ ok: boolean; error?: string }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();
  ...
  try {
    await saveBrandingSettings(db, orgId, { workspaceName });
    revalidatePath("/settings/branding");
    revalidatePath("/", "layout"); // the sidebar brand block lives in the (app) layout
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save branding settings." };
  }
}
```
`requireOrgAdmin` is `src/lib/authz.ts:24` (owner or admin). A file upload through a server action is limited by Next's server-action body limit (no `serverActions.bodySizeLimit` in `next.config.ts`; only `proxyClientMaxBodySize` at `:17`). For a 1 MiB logo, the planner should check that limit, or use a route with `readBoundedFormData(request, maxBytes, { maxParts })` (`src/lib/http/read-bounded-form-data.ts:149`; use as in `src/app/api/public/intake/route.ts:31-45`).

### 5. Backup status page and settings nav

**Page analog:** `src/app/(app)/settings/branding/page.tsx:1-38`: `export const dynamic = "force-dynamic"`, `getScopedDb()`, `getOrgRole()` + `isAdminRole`, own `<h1 className="text-[18px] font-semibold">`. Nav: add one entry to `navItems` in `settings-nav.tsx:7-15`.
**Status read analog:** `src/lib/worker/jobs/heartbeat.ts:5-9` (SystemSetting key and value as an ISO string). A typed parse with a safe fallback, as `getBrandingSettings` (`settings.ts:50-60`).

### 6. Rule-J Docker test helpers and the disposable dev database (U-07, U-15)

- `tests/support/docker-test-labels.ts:13-16` constants `TEST_LABEL = "aida.test"`, `RUN_LABEL = "aida.test.run"`, `TEST_NAME_PREFIX = "aida-test-"`, `RUN_ID_ENV = "AIDA_TEST_RUN_ID"`; `testRunId()` `:42-51`; `testLabels()` `:53-56`; `testResourceName(kind, runId)` `:59-68` gives `aida-test-<kind>-<runId>-<6 hex>`; `recordResource` ledger `:86-95`; `dockerNotFound` `:107-116`. No Docker import, safe for unit tests.
- `tests/support/docker-test-preflight.ts`: `MIN_FREE_BYTES = 20 * 1024 ** 3` `:18`; `assertEnoughSpace` `:84`; `assertProjectAbsent` `:197`; `assertTagsFree` `:186`; `acquireLock` `:305`; `assertComposeFollowsRuleJ(config, project, runId)` `:367-418` (labels on every service, build, network and volume; image tag `<project>-<service>:<runId>`; no anonymous volume; Postgres data on tmpfs); `runBuildPreflight` `:432-439`.
- `tests/support/docker-test-resources.ts:14-58`: `startLabeledPostgres({ kind, database, username, password })` with Ryuk off (`:12`) and tmpfs data. Used by `tests/integration/global-setup.ts:17-22`.
- `scripts/test-docker-cleanup.ts:1-23`: `pnpm test:docker-cleanup --run <runId>` (dry run), `--apply`, `planExact()` for suites that know their refs. Used by `tests/integration/egress-isolation.test.ts:26-41` (`applyCleanup`, `planExact`, `teardownRefs`, `acquireLock`, `assertComposeFollowsRuleJ`, `runBuildPreflight`).
- Disposable dev database: `.planning/phases/08-security-hardening/08-02-PLAN.md:309-393` ("Docker health rule", "Disposable dev database (rule J)", "Dev database teardown"). Key steps: use the orchestrator's `AIDA_TEST_RUN_ID` (never create one, `:346`); scratch dir via `mktemp -d` (`:347-351`); image check, no pull (`:352-355`); free port 55433 to 55452, never 55432 (`:356-359`); `docker run -d --pull never --name "$DEVDB_NAME" --label aida.test=1 --label "aida.test.run=$AIDA_TEST_RUN_ID" --tmpfs /var/lib/postgresql/data:rw -p "127.0.0.1:$DEVDB_PORT:5432" ... pgvector/pgvector:pg16` (`:366`); label guard, readiness, port identity (`:371-373`); teardown only by cleanup dry run, `--apply`, dry run with 0 (`:385-392`). For a Phase 9 migration: `prisma migrate dev --create-only` there, edit, then the Testcontainers suite applies it with `migrate deploy` (`global-setup.ts:38`); `isolated-database.ts:54-66` shows a `migrate deploy` on a fresh database.

### 7. Compose and Dockerfile (U-08, U-16)

- Non-root: `Dockerfile:87-94` (`RUN mkdir -p /data/uploads && chown node:node /data/uploads`, `USER node`; UID/GID 1000 documented at `:88`). Builder stage also ends `USER node` (`:60`).
- `db` service `docker-compose.yml:3-16` is the image the `backup` service reuses (`pgvector/pgvector:pg16`, which has no `node` account, hence `user: "1000:1000"`).
- Comment style for a written reason: `docker-compose.yml:24-26` (migrate as `node`), `:111-113` (worker mount, K68), `:79-82` (healthcheck path refused by Caddy).
- Static compose tests: `tests/unit/compose-uploads.test.ts:13-36` (`serviceBlock`, `topLevelVolumes` line parsers) and `tests/unit/container-config.test.ts:1-40` (Dockerfile stage parser). Copy these for "backup runs as 1000:1000", "uploads_data mounted `:ro` in backup", "backups_data declared".
- The root-owned-volume procedure `docs/OPERATIONS.md:105-152` is the tone for the one-mount-point `backups_data` preparation (no recursive chown, U-16).

### 8. Seed and demo guard

- Boot order: `src/instrumentation.ts:1-13`: pepper warning, `bootstrapFromEnv()`, then `bootstrapDemoMode()`.
- Demo boot never blocks: `src/lib/demo/bootstrap-demo.ts:21-49` (`try { ... } catch (error) { console.error("[demo] Demo seeding failed:", message) }`). Keep this shape; replace `:22-26` with the tenant guard.
- The org trigger `aida_organization_ticket_states` (`prisma/migrations/20261110100000_ticket_states/migration.sql:301-303`) writes `TicketState` and `TicketStateConfig` rows in the same transaction as every organization insert. The D-19 table inventory must expect those rows with a demo org and must not count them as foreign tenant data.
- Writes that are not one transaction (U-17): `createFirstOrgAndAdmin` = `signUpEmail` (`bootstrap.ts:19-21`), `createOrganization` (`:31-33`), `systemSetting.upsert setupComplete` (`:41-45`); agent `signUpEmail` (`identities.ts:79-81`) and `member.create` (`:92-100`); then `seedDemoData` (`seed-demo-data.ts:342+`, `createTicket` commits per ticket, `:163` comment). The completion marker goes last.
- Advisory lock for check and write: copy `check-rate-limit.ts:279` (`$executeRaw` + `pg_advisory_xact_lock(hashtext(...))`). Because the seed spans many transactions, a transaction-level lock covers only the check and the marker write. The planner must state which part is "race-free" (D-17).
- No password output: remove `prisma/seed.ts:59-60`. `scripts/capture-demo-assets.ts:810` prints the seed's stdout. Log-scan assertions: `tests/support/console-capture.ts:18-30` (`serializeLogArg`, `spyOnConsole`).
- Refusal text: replace `prisma/seed.ts:43-46` (`docker compose down -v`), and `docs/OPERATIONS.md` "Demo mode" (`:338-348`, reset paragraph) and the env table row for `DEMO_MODE` (`:333`, "database has zero tickets") with the U-17 text. The compose comment `docker-compose.yml:60-62` says "AND the database has no tickets"; update it too.

### 9. Database URL guard

**Analog:** `src/lib/rate-limit/pepper-check.ts:13-42`: no project imports, a pure classifier (`rateLimitPepperProblem`), a once-per-process logger that names the setting and never the value, and a test reset hook. Called first in `instrumentation.ts:4-5`. For the worker, place the check before `new PgBoss(connectionString)` at `src/lib/worker/index.ts:18-25`. For `migrate`, there is no Node entry today (`docker-compose.yml:27` runs the Prisma CLI directly), so 09-01's `scripts/check-database-url.ts` must run inside the builder image before `migrate deploy`. The builder has tsx and `node_modules`. The CLI is called through node, not pnpm (`:24-26`).
**Test analog:** `tests/unit/rate-limit-pepper-boot.test.ts:1-30` (mocks bootstrap and demo, `vi.stubEnv("NEXT_RUNTIME", "nodejs")`, spies on `console.error`).

### 10. Top bar, sidebar, brand mark (09-07, 09-09)

- Brand box markup (copy verbatim into `BrandMark`), `src/components/sidebar.tsx:47-54`:
```tsx
<div className="flex h-14 items-center gap-2.5 px-4">
  <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary shadow-sm">
    <Sparkles className="size-4 text-sidebar-primary-foreground" />
  </div>
  <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground">
    {brandName}
  </span>
</div>
```
  Second copy: `src/components/public/public-page-shell.tsx:20-25` (no `shrink-0`, no `truncate`); third: the preview in `branding-form.tsx:91-98`. `BrandMark` replaces all three.
- Data flow: `src/app/(app)/layout.tsx:32-38` resolves `workspaceName` via `getBrandingSettings(scopedDb(orgId), org?.name ?? "AIDA")` and passes `brandName` to `<Sidebar>` (`:51`). The logo reference (key, MIME, version) is resolved there too and passed as a prop; `Sidebar` is a client component (`sidebar.tsx:1`).
- Public pages: `src/app/(public)/status/[token]/page.tsx:26-35` uses `prisma.organization.findFirst()` for branding even for a valid token; D-10 changes this to the ticket's organization for a valid token and no org branding for an invalid one. `request/page.tsx:12-16` keeps `findFirst()`.
- Top bar: `src/components/top-bar.tsx:55` `<h1 className="text-[18px] font-semibold">{title}</h1>` becomes non-heading text with the same classes; the header shell (`:54`) already matches DESIGN-SYSTEM (`sticky top-0 z-10 ... backdrop-blur-sm`).
- Visible page h1 pattern: `src/app/(app)/kb/page.tsx:32` / `insights/page.tsx:59` `text-[18px] font-semibold tracking-tight text-foreground`; visually hidden pattern: `className="sr-only"` (`kb/page.tsx:40`). `EmptyState` uses `<h2>` (`empty-state.tsx:22`), so it adds no h1. The error boundaries (`tickets/error.tsx:11-20`) render no heading today.

### 11. Workflow `check-version.yml` (U-06, U-18)

**Analog:** `.github/workflows/audit.yml:1-41`:
```yaml
on:
  push:
    branches: [master]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: audit-${{ github.ref }}
  cancel-in-progress: false

env:
  NEXT_TELEMETRY_DISABLED: "1"
  CHECKPOINT_DISABLE: "1"

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
```
For U-18 the checkout needs `fetch-depth: 0` (or a fetch of `github.event.pull_request.base.sha`) so the base `package.json` can be read; a base that cannot be read must fail loudly. Header comment style: `audit.yml:1-5` (cites rule I). Do not copy `integration.yml` (it has `schedule:`, `:8-11`).

### 12. Shell scripts (backup, restore, install)

**Analog:** `scripts/backup.sh:1-70` and `scripts/restore.sh:1-105`: header comment with usage, `set -euo pipefail`, `COMPOSE="${COMPOSE_CMD:-docker compose}"`, `[backup]` / `[restore]` log prefixes, refuse on an empty output (`backup.sh:54-62`), interactive `restore` confirmation with `--yes` (`restore.sh:31-37`), stop writers first (`:52-53`), the known-benign `pgboss.job_common` `pg_restore` error filter (`:56-80`).
Drift to fix in the rewrite: `restore.sh:91` waits on `/api/health` while the container healthcheck now uses `/api/health/probe` (`docker-compose.yml:82`); `restore.sh:83` extracts uploads through the `app` image, which now runs as `node`, so the U-16 `--no-same-owner` and the ownership check apply; both scripts `source .env` (`backup.sh:24-30`), and the in-compose `backup` service must use libpq variables instead (D-01).

### 13. Verification record (`01-VERIFICATION.md`)

**Analog:** `.planning/milestones/v1.0.0-phases/02-core-ticketing/02-VERIFICATION.md:1-30`: YAML front matter (`phase`, `verified`, `status`, `score`), "Observable Truths" table `| # | Truth | Status | Evidence |`. D-20 adds a column or split for "historical (01-UAT.md or SUMMARY)" and "re-run now at commit X (command, exit code)".

---

## Shared Patterns

### Relative imports in worker-reachable modules
**Source:** `src/lib/projects/file-cleanup.ts:25`, `src/lib/branding/settings.ts:4-9`, `src/lib/worker/jobs/project-file-cleanup.ts:8`, `src/lib/attachments/staged-files.ts:18`.
**Apply to:** `backup-lease.ts`, any change to `file-cleanup.ts`, `settings.ts`, `local-file-storage.ts`, the logo store if the worker reaches it. `validate-uploads.ts` uses `@/` (`:9-17`) and is app-only.

### Logging without data
**Source:** `file-cleanup.ts:107-113` (`[project-file-cleanup] file delete failed: key=${key} code=${code}`, wrapped in try/catch so logging never changes the outcome); `staged-files.ts:54-58`; `pepper-check.ts:33-37` (names the setting, never the value); `client-ip.ts:19-23` (no address logged).
**Apply to:** backup status, sweep fence messages, the DB URL guard, demo refusal lines.

### Org scoping
**Source:** `src/lib/scoped-db.ts:14-58` (`DOMAIN_MODELS`; `ProjectFileCleanup` at `:57`); system jobs use bare `prisma` and name `organizationId` in every statement (`file-cleanup.ts:19-21`, `:194-211`). Better Auth models use bare `prisma` (`(app)/layout.tsx:33-37`).
**Apply to:** the logo store (Setting via `scopedDb`), the sweep, the backup status read (`SystemSetting` is global).

### Errors with codes
**Source:** `errorCode(err)` duplicated in `file-cleanup.ts:94-100` and `staged-files.ts:34-40`; `validate-uploads.ts:85` inline. Result unions instead of throws: `validate-upload.ts:31` (`{ ok: false, code }`), `validate-uploads.ts:28-34`, `read-bounded-form-data.ts:39-41`.

### Public route order
**Source:** `src/app/api/public/intake/route.ts:23-45`: rate limit first, then bounded body read, then validation, then work. Applies to the logo GET (limit, then lookup, then read).

### Security headers and CSP
**Source:** `src/proxy.ts:46-68` (every exit gets `securityHeadersFor`), `src/lib/security/csp.ts:48-80`. Same-origin images are allowed; no CSP change for the logo.

### Static config tests
**Source:** `tests/unit/compose-uploads.test.ts:13-36`, `tests/unit/container-config.test.ts:18-40`. Text checks only, no Docker. Apply to every compose, Dockerfile and workflow change (backup service user, volumes, `check-version.yml` triggers with no `schedule:`).

### One test process at a time
**Source:** `vitest.integration.config.ts:13` (`fileParallelism: false`), `tests/integration/project-file-cleanup.test.ts:43-49` (comment). Any new integration file that wipes the queue table must carry the same comment.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Backup fence that survives a dropped DB session (U-12), for example an advisory file lock on the shared volume | service | file-I/O | Every lock in the repo is a Postgres advisory or row lock (`check-rate-limit.ts:279`, `relations.ts:214`, `FOR UPDATE SKIP LOCKED` in `file-cleanup.ts:166`). No filesystem lock exists. The only cross-process file lock is the test-only `acquireLock` (`tests/support/docker-test-preflight.ts:305`), which is a host temp-dir lock, not a volume lock |
| Logo dimension read from the image header (D-08) | utility | transform | `file-type` gives the MIME type only; no image-size code or package in the repo |
| `src/lib/testing/e2e-fault.ts` (09-09 fault hook) | utility | n/a | No test-only fault hook exists in `src/`; the nearest are the `...ForTests` setters (`check-rate-limit.ts:63`, `:166`, `:174`) and the `onLocked` hook (`file-cleanup.ts:84`) |
| Shell-script tests with fake `curl` and `docker` on `PATH` (`tests/unit/install-script.test.ts`, `restore-script.test.ts`, fixtures) | test | file-I/O | No test spawns a shell script; the nearest is the scripted fake daemon in `tests/unit/test-image-check.test.ts:349-430`, which fakes in-process, not on `PATH` |
| `scripts/install.sh` | utility | file-I/O | No installer or download script exists; only `backup.sh` and `restore.sh` give the shell conventions |
| `scripts/backup/scheduler.sh` | utility | event-driven | No in-container scheduler; scheduled work is pg-boss in the worker (`worker/index.ts:36-37`) |
| `CODEOWNERS` | config | n/a | None in the repo; the content is the owner's handle as written in owner item 13 (not repeated here) |
| `AGENTS.md` | docs | n/a | None; mirror the commands in `CLAUDE.md` with no personal names (D-24) |
| Stack-level proof specifications (09-11, U-15) | test spec | n/a | The only stack suite is the egress test; the 08-14 container harness does not exist yet (owner-gated Phase 8.1) |
| Serializing a logo replace per organization (P10) | service | CRUD | No `Setting` row lock exists; nearest pattern is `SELECT ... FOR UPDATE` / `FOR SHARE` via `runProjectTransaction` and `requireTask(..., { lock: "share" })` in `src/lib/projects/attachments.ts:250-255` |
| SemVer comparison for `check-version` | utility | transform | No version parsing code in the repo; `package.json` has no `version` field yet |
| `src/lib/backup/status.ts` admin-visible run record parsing | service | CRUD | Nearest is `heartbeat.ts` (write only); no reader of a JSON `SystemSetting` exists |

## Metadata

**Analog search scope:** `src/lib/{projects,attachments,rate-limit,http,security,branding,demo,worker}`, `src/app/api/public`, `src/app/api/attachments`, `src/app/(app)`, `src/app/(public)`, `src/components`, `src/proxy.ts`, `src/instrumentation.ts`, `prisma/schema.prisma`, `prisma/migrations`, `prisma/seed.ts`, `scripts/`, `tests/{unit,integration,support,e2e}`, `docker-compose*.yml`, `Dockerfile`, `.github/workflows/`, `docs/OPERATIONS.md`, `docs/SECURITY.md`, `.planning/phases/08-security-hardening/08-02-PLAN.md`, `.planning/DESIGN-SYSTEM.md`, `.planning/milestones/v1.0.0-phases/`
**Files scanned:** about 75
**Pattern extraction date:** 2026-11-12
