---
id: SEED-010
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions repo health, onboarding friction, install experience, release process, community, or stars
scope: S (2-3 plans, or a series of quick tasks)
---

# SEED-010: Repo-health borrowings — one-liner installer, version-bump CI gate, social-proof widgets, AGENTS.md

## Why This Matters

CLAUDE.md says repo health is a feature. Plane's repo shows a few cheap moves AIDA does not have yet: (1) `install.sh` that `curl`s the release `docker-compose.yml` + `variables.env` from GitHub Releases and offers upgrade / backup / restore / logs from one menu — turning "clone the repo" into `curl -fsSL … | sh`; (2) a `check-version` workflow that fails a PR unless `package.json`'s version was bumped, which keeps releases honest; (3) Repobeats activity graph + contrib.rocks contributor wall in the README (social proof for visitors deciding whether to star); (4) `AGENTS.md` with the exact commands AI coding agents should run (AIDA already has CLAUDE.md — an AGENTS.md alias helps non-Claude contributors); (5) `CODEOWNERS`.

## When to Surface

**Trigger:** new milestone scope mentions repo health, onboarding friction, install experience, release process, community, or stars.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**S** — `scripts/install.sh` (download compose + `.env.example` from the tagged release, generate the three secrets with `openssl rand -base64 32`, run `docker compose up -d`, print the URL; sub-commands wrapping the existing `backup.sh`/`restore.sh`), README quick-start updated to the one-liner, `.github/workflows/check-version.yml`, README widgets, `AGENTS.md`, `CODEOWNERS`. Verify the installer on a clean VM before advertising it.

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 10 (Plane `deployments/cli/community/install.sh`, `.github/workflows/check-version.yml`, `README.md`, `AGENTS.md`).
- Existing scripts to wrap: `scripts/backup.sh`, `scripts/restore.sh` (07-04); runbook `docs/OPERATIONS.md`.
- Existing CI: `.github/workflows/ci.yml`, `integration.yml`, Pages workflow (07-05/07-06).
- README quick start + badges: `README.md` (07-10); launch steps: `LAUNCH.md`.
- Known gap the installer must handle: `docker-compose.yml`'s `DATABASE_URL` does not URL-encode `POSTGRES_PASSWORD` (deferred item from 07-07) — generate a URL-safe password or encode it.

## Notes

The installer must not phone home (privacy-first claim); downloading from GitHub Releases is the only network call and should be stated in the docs.
