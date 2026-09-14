# Phase 9: Operations - Context

**Gathered:** 2026-11-08, by hand under `run-loop/PIAGAM.md` (not `/gsd-discuss-phase`)
**Status:** Ready for UI design contract, then planning
**Sources:** facts checked against the code at `1e276dc`; Codex brainstorm in `run-loop/codex/fase09-tanya.md` and `fase09-jawab.md`. Every Codex claim used below was re-checked in the code unless marked *unverified*.

<domain>
## Phase Boundary

A self-hoster can run AIDA unattended: backups happen on their own, the known boot and seed traps are fixed and pinned by tests, and the planning records tell the truth. Requirements AIDA-33 to AIDA-41 in `.planning/REQUIREMENTS.md`. No feature beyond those requirements.

Phase 8 is **parked** (`08-REVIEWS.md` → Outcome). Its code changes do not exist: no trusted client-IP helper, the limiter is still `count` then `create`, containers run as root, no CSP. Phase 9 must not assume any of them.

</domain>

<decisions>
## Implementation Decisions

Format: decision, then source. "Codex agreed" means the Codex brainstorm recommended the same thing.

### Backups (AIDA-33)

- **D-01:** Backups run as a dedicated compose service `backup` built from the image the `db` service already uses (`pgvector/pgvector:pg16`, which ships `pg_dump` and `pg_restore`): no new image, no Redis, no managed service. It reaches the database with libpq parameters and `PGPASSWORD` (never a URL), mounts the uploads volume read-only, and writes to a new `backups_data` volume. Enabled by default, daily, keeping the 7 newest successful sets; schedule, retention and `BACKUP_ENABLED=false` are documented operator settings. Source: Codex (service option); defaults are Claude's discretion.
- **D-02:** Consistency protocol. (1) Storage keys are immutable: an upload or replacement always writes a new key, never overwrites one. (2) Before `pg_dump` starts, the backup takes a **lease** (a committed `SystemSetting` row with an expiry). (3) Every code path that deletes or replaces a stored file first commits its database change, then checks the lease: while a lease is active the physical unlink is deferred to a durable record and performed later by a worker job that runs only when no lease is active; the same check guards that job. (4) The backup archives every file present under uploads after the dump, then verifies the dump's attachment and logo keys against the archive (every referenced key present with a recorded checksum); a missing file fails the set. (5) The lease is released at the end, and an expired lease never blocks deletion forever (crash safety). Rationale: because deletions are deferred while the lease exists and the DB change commits before the lease check, every record in the dump still has its file when the archive is taken, without exporting a snapshot across two processes. Source: Claude, refining the Codex recommendation (immutable keys, deferred deletion during an active backup, reference check against the dump); Codex reviews it at plan review. Verified: `local-file-storage.ts` writes with `writeFile` and deletes with `unlink` under `<orgId>/<key>`; public intake stores files before `createMany`.
- **D-03:** A set is written to a temporary directory and published by an atomic rename only after the dump, the archive and the manifest (checksums, counts, app version, timestamp) all validate. A failed part marks the whole run failed; retention prunes whole successful sets and stale temporary directories. Source: Codex.
- **D-04:** Each run records its outcome (time, result, set id, a failure category without data) in a `SystemSetting` row that admins see in Settings, and logs it. The record never contains secrets or tenant data. Source: Codex agreed on persistent, admin-visible reporting.
- **D-05:** `scripts/restore.sh` restores a published set: it validates the manifest and every archive path before touching the target, stops `app` and `worker` while it runs, and documents what a partial failure leaves behind. `docs/OPERATIONS.md` states that backups contain tenant data, that off-host copies are the operator's job, and that `APP_ENCRYPTION_KEY` must be backed up separately or encrypted settings cannot be read after a restore. The seed refusal text stops recommending `docker compose down -v`. Source: Codex (restore, key, shared VM).
- **D-06:** Permanent tests (AIDA-38) run on Testcontainers Postgres and temporary directories, not on a compose stack: lease and deferred deletion, add, replace and delete at synchronised points mid-backup, failure of each part, retention, and a restore whose attachment records are compared with file contents. The stack-level proof (the real `backup` service in compose, and a restore into an isolated stack) is planned and written, but it is **not run** until the owner decides how container tests may run on the shared Docker VM (the open question from Phase 8, `run-loop/LAPORAN.md`). Until then the stack clauses of AIDA-33 stay open. Source: Codex (component tests are necessary but not sufficient).

### Logo (AIDA-34)

- **D-07:** The logo is an immutable file in the uploads volume under the organization's directory, referenced by a `branding:logo` `Setting` (storage key, MIME type, version). Replace writes the new file, updates the setting, then deletes the old file through the D-02 protocol. Backups include it. Source: Codex.
- **D-08:** Accept PNG, JPEG and WebP by byte sniffing with `file-type` (already a dependency); reject SVG and everything else; maximum 1 MiB; a dimension cap read from the image header (planner chooses how, preferring no new package). Only org owners and admins may upload or remove. Source: Codex.
- **D-09:** A public route serves only the currently referenced logo, is listed in `PUBLIC_PREFIXES` in `src/proxy.ts`, sends the stored MIME type with `X-Content-Type-Options: nosniff` and long-lived caching behind a versioned URL, and answers 404 when there is no logo. It is throttled with the existing `checkRateLimit` under its own scope, the limiter the v1 public routes use; the docs state that its identity and atomicity limits (v1 findings F-07, F-12) apply until Phase 8 lands. Source: Claude; Codex warned not to claim the current limiter is spoof-proof or atomic, which this decision does not.
- **D-10:** Which organization: signed-in pages use the active organization; `/request` keeps today's `organization.findFirst()` resolution; `/status/[token]` uses the ticket's organization for a valid token and shows no organization branding for an invalid one, so an invalid token reveals nothing. Source: Codex.
- **D-11:** UI: the branding settings page gains upload, replace and remove; the sidebar brand slot shows the logo in a bounded box with `object-contain`, keeps the workspace name visible, and falls back to the Sparkles box. `.planning/DESIGN-SYSTEM.md` is amended in the same plan (Sparkles becomes the default and fallback). The UI contract comes from `/gsd-ui-phase 9`. An E2E test covers upload, replace, remove and fallback. Source: Codex; DESIGN-SYSTEM §4 and line 184.

### Database password (AIDA-35)

- **D-12:** Contract: (1) a `POSTGRES_PASSWORD` containing `/ @ : # ?` works for `migrate`, `app` and `worker`; (2) existing installs whose password is already URL-safe keep working with no new variable; (3) the URL the services use is the one `docker compose config` resolves, with the password percent-encoded, produced from one password by a documented generator (`scripts/` and the installer); (4) `app`, `worker` and `migrate` refuse to start, without printing either value, when the URL's decoded password and `POSTGRES_PASSWORD` are both present and differ; (5) user and database name are encoded too. The exact compose mechanism is the planner's, verified with `docker compose config`. Source: Codex recommended a separate encoded URL with validation; the backward-compatibility rule (2) is Claude's.
- **D-13:** The test parses `docker compose config` output in memory for every service that has `DATABASE_URL`, compares the decoded components, and prints only service names and pass/fail; no password reaches a log, a trace or recorded evidence. The stack boot test (all three services connect, with a positive database proof from `worker`) is written but **not run** until the owner's container decision, like D-06; that clause of AIDA-35 stays open until then. `backup.sh`, `restore.sh` and the backup service use `PGPASSWORD`; the egress compose file keeps its own fixture URL. Source: Codex; verified compose lines 29, 49, 101.

### Single h1 (AIDA-36)

- **D-14:** Each rendered app route state (normal, loading, error, empty) has exactly one `<h1>`, owned by the page inside `<main>`. The top-bar title becomes non-heading text with unchanged appearance. Pages that relied on the top-bar heading get their own `<h1>` (visible or visually hidden, per the UI contract). An E2E test enumerates every app route, dynamic ones with fixtures. Source: Codex. Verified: `top-bar.tsx` renders an `<h1>` and 12 app pages plus `ticket-meta-header.tsx` render their own; the two `<h1>` in the public status page are in different branches, so that page is not a violation.

### Seed and demo guards (AIDA-37, AIDA-38)

- **D-15:** Literal definitions from AIDA-37: infrastructure data never counts (`_prisma_migrations`, the `pgboss` schema, `SystemSetting`, `RateLimitHit`, and any infrastructure table this phase adds, such as the D-02 deferred-deletion records, listed explicitly); tenant data is any `organization` or `user` row. Source: AIDA-37.
- **D-16:** `pnpm db:seed` checks before any write (`ensureDemoIdentities()` moves after the guard) and refuses when tenant data exists. Source: AIDA-37, F-10; verified `prisma/seed.ts` lines 31 and 34.
- **D-17:** The `DEMO_MODE` boot seeds when no tenant data exists, skips when the only organization is the demo one (stable identity: the demo organization slug) and every user is a configured demo identity, and refuses otherwise, with a log line and no write. `bootstrapFromEnv()` runs first in `src/instrumentation.ts` and may create a real organization, after which the demo boot refuses. Check and write share a Postgres transaction-level advisory lock between the seed CLI and the demo boot; "race-free" is claimed only for paths that take it. Source: AIDA-37; Codex on stable identity and the race; verified `instrumentation.ts`.
- **D-18:** No password is printed by `prisma/seed.ts`, `scripts/capture-demo-assets.ts` or the boot path; tests scan stdout and stderr. Source: AIDA-37, F-09.
- **D-19:** Integration tests (Testcontainers): fresh demo boot; repeated boot after a simulated heartbeat; refusal by both paths on a database holding a non-demo organization or user with zero tickets, comparing the row count of every table (inventory from `information_schema`) before and after, with infrastructure writers controlled. Source: AIDA-37, AIDA-38, Codex.

### Records (AIDA-39, AIDA-41)

- **D-20:** `01-VERIFICATION.md` in `milestones/v1.0.0-phases/01-foundation/` maps each Phase 1 criterion to evidence, separating "historical, recorded in `01-UAT.md` or a SUMMARY" from "re-run now at commit X" (commands and exit codes), and leaves human-only checks open. Source: AIDA-39, Codex.
- **D-21:** Every open todo and caveat in `STATE.md` is re-checked against the repository and corrected or removed; owner-only items stay as owner items. Source: AIDA-41.

### Repo health (AIDA-40)

- **D-22:** `scripts/install.sh` downloads only the tagged source archive of the canonical repository (the slug already used in `README.md`, overridable by a variable), generates secrets with `openssl` (the database password as random hex, so it is URL-safe), never overwrites existing secrets on a rerun, and wraps upgrade, backup, restore and logs. No other network call. Tests use a local fixture release and fake `curl` and `docker` executables that record arguments and fail on any unexpected call. A clean-VM run stays a manual item. Plane's installer is AGPL-3.0: patterns only, no code (`research/plane-inspiration.md` §1). Source: SEED-010, Codex.
- **D-23:** `.github/workflows/check-version.yml` ships with fixture tests. Adding a `version` to `package.json`, and the bump policy before release, are owner decisions; until then the workflow reports the missing field as a notice and does not fail. Source: Codex (owner decision).
- **D-24:** `AGENTS.md` ships with the commands AI agents should run, mirroring `CLAUDE.md`, with no personal names. Source: SEED-010.
- **D-25:** `CODEOWNERS` needs a person's GitHub handle and the README widgets load third-party images (Repobeats also needs an account): both are recorded as manual owner items, not added. Source: Codex; charter rule on names in tracked files.

### Phase 8 coordination

- **D-26:** Phase 9 records, in each SUMMARY, its final contract for every file Phase 8's plans also touch (`docker-compose.yml` services, volumes and variables; `docs/OPERATIONS.md` sections; `src/proxy.ts` `PUBLIC_PREFIXES`; new public routes). The Phase 8 plans that must be replanned before any unpark are: 08-09, 08-14, 08-22, 08-23 (non-root ownership of `backups_data` and logo files; the new `backup` service), 08-07 and 08-08 (CSP `img-src`: the logo is same-origin), 08-10 and 08-11 (identity and limiter for the logo route), 08-05 and 08-15 (docs), 08-16 (the gate's stack now includes `backup`). Source: Codex.

### Plan shape

- **D-27:** Suggested waves; the planner may split further, never drop scope. Wave 1: password contract and generator; seed and demo guards with tests; `STATE.md` audit and `01-VERIFICATION.md`; repo-health files. Wave 2: immutable storage, deferred deletion and the logo; the backup service and scheduler; single `<h1>`. Wave 3: restore, the installer against final artifacts, the stack-level tests (written, run only after the owner decision), the phase gate and the §9 design checklist. One test process at a time. Source: Codex.

### Claude's Discretion

- Exact schedule format, retention count and lease expiry within D-01 and D-02.
- Logo dimension cap and how it is read (D-08).
- Visible versus visually hidden `<h1>` per page, within the UI contract (D-14).

</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` AIDA-33 to AIDA-41; `.planning/ROADMAP.md` Phase 9 and Cross-phase risks; `.planning/seeds/SEED-010-repo-health-installer-version-gate.md`
- `.planning/run-loop/PIAGAM.md`; `.planning/run-loop/codex/fase09-jawab.md`; `.planning/phases/08-security-hardening/08-REVIEWS.md` (container-safety findings that also bind Phase 9 stack tests)
- `.planning/DESIGN-SYSTEM.md` (sidebar brand box, top bar, empty state, §9 checklist)
- `.planning/milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md` and `07-SECURITY-PASS.md` (F-09, F-10, F-07, F-12); `.planning/milestones/v1.0.0-phases/01-foundation/`
- Code: `scripts/backup.sh`, `scripts/restore.sh`, `docker-compose.yml`, `prisma.config.ts`, `src/lib/attachments/local-file-storage.ts`, `src/app/api/public/intake/route.ts`, `src/lib/branding/settings.ts`, `src/app/(app)/settings/branding/`, `src/components/top-bar.tsx`, the sidebar component, `src/app/(public)/`, `src/proxy.ts`, `src/lib/rate-limit/check-rate-limit.ts`, `prisma/seed.ts`, `src/lib/demo/`, `src/lib/bootstrap.ts`, `src/instrumentation.ts`, `src/lib/worker/jobs/heartbeat.ts`, `scripts/capture-demo-assets.ts`, `docs/OPERATIONS.md`, `README.md`, `.github/workflows/`

</canonical_refs>

<deferred>
## Deferred Ideas

- Off-host backup copies: the operator's job, documented.
- CODEOWNERS, README widgets, the `package.json` version baseline: owner items (D-23, D-25).
- Stack-level proofs for AIDA-33 and AIDA-35: written, run after the owner's container decision (D-06, D-13).

</deferred>

## Human boundary

From the charter's phase table: the Phase 5 visual pass and the Phase 6 real-LLM Insight quality check stay open for a human. Added here: the clean-VM installer run, the owner items in D-23 and D-25, and approval of the logo's look in the sidebar (no visual pass is claimed).

## Instruction for the planner

Do not create `checkpoint:human-verify` tasks. Write every human verification as a manual item in the plan and in the SUMMARY, and leave it open. Do not reduce scope: if a plan is too big, split it. Every executor dispatch includes the charter's "Aturan eksekutor" section.

## Owner rules of 2026-11-08 (binding, summary)

- **D:** all code is written by Claude (Opus 5.5); Codex reviews only. GSD agents inherit the session model (`model_profile: inherit`); no `model` parameter on dispatch.
- **C:** `workflow.use_worktrees` is `false`; plans run in the main checkout. Temporary exports are deleted only by the round that made them.
- **G:** no push.
- **A and B:** disk and Docker health are checked every round; Docker is never stopped, restarted or deleted.
- **Container rule:** only projects `aida` and `aida-dev-db`, plus the charter-mandated Testcontainers and `pnpm test:egress` suites. New stack-level tests are written but not run until the owner decides (D-06, D-13).

## Larangan dari piagam (verbatim, binding)

- Dilarang `git push`, `gh pr`, `gh release`, `gh workflow run`, dan apa pun yang memindahkan commit ke remote. Jangan melepas kunci `pushurl`.
- Dilarang commit ke `master`, `git merge`, `git rebase`, `git reset --hard`, `git clean`, `git stash`, `git tag`, dan `--no-verify`.
- Dilarang menyentuh `~/Public/aff/recruitment` dan project lain.
- Dilarang menghentikan, menghapus, atau mengubah container dan volume selain milik project `aida` dan `aida-dev-db`. Dilarang `docker system prune` dan `docker volume prune`.
- Dilarang memanggil API LLM berbayar sungguhan, mengirim email nyata, dan memakai kredensial asli. Test memakai fake dan server tiruan.
- Dilarang menaruh API key di `.env` dan mengubah aturan izin Claude Code.
- Dilarang `--auto` dan `--chain`, dan dilarang menyalakan `workflow.auto_advance`.
- Dilarang `/gsd-autonomous`, `/gsd-discuss-phase`, `/gsd-new-milestone`, `/gsd-verify-work`, `/gsd-audit-milestone`, `/gsd-complete-milestone`, `/gsd-cleanup`, `/gsd-ship`, dan `/gsd-update`.
- Dilarang `/gsd-review`, `/gsd-plan-review-convergence`, `--codex`, `--all`, `--converge`, dan `--cross-ai`. Jalur itu menjalankan reviewer di repo asli, bukan di ekspor.
- Dilarang mengisi hasil UAT, visual pass, atau penilaian manusia rekaan. Kosong tetap kosong.
- Dilarang menulis backslash ke `last_activity_desc` di `STATE.md`.

---

*Phase: 09-operations*
*Context gathered: 2026-11-08*
