# Phase 7: Launch Readiness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 07-launch-readiness
**Mode:** `--auto` — user delegated all gray-area decisions to Claude ("saya percayakan kepada anda untuk menentukan isi"). Every selection below is the recommended default, chosen without AskUserQuestion.
**Areas discussed:** Demo data & demo mode, Docs site approach, Hero GIF & demo assets, Backup/restore & ops, Security-pass scope, Repo hygiene & launch mechanics, Branding settings (AIDA-12 remainder)

---

## Demo data & demo mode (AIDA-22)

| Option | Description | Selected |
|--------|-------------|----------|
| TS seed script + boot-time demo flag | `pnpm db:seed` + env flag auto-seeds empty DB on `docker compose up`; pre-computed AI artifacts stored as data | ✓ |
| SQL dump fixture | Fast to load but brittle against migrations, opaque to review | |
| Hosted public demo | Ops burden, conflicts with self-host positioning | |

**Choice rationale:** Seed script survives schema evolution, reuses the single write paths (`createTicket`/`createKbArticle`), and is reviewable. Pre-computed AI artifacts (triage fields, audit rows, COMPLETED InsightRun) make every AI surface render without an LLM key — honest (stored results, no faked live calls).

---

## Docs site approach (AIDA-23)

| Option | Description | Selected |
|--------|-------------|----------|
| Astro Starlight on GitHub Pages | Separate `website/` dir, GH Actions deploy; maintainer already knows Astro (blog) | ✓ |
| Plain `docs/` markdown only | Zero infra but does not satisfy the requirement's literal "docs site" | |
| Docusaurus/VitePress | Equivalent capability, no familiarity advantage | |

**Choice rationale:** AIDA-23 explicitly requires a docs site. Starlight is purpose-built for docs, low-maintenance, and the maintainer's blog is already Astro. Product app stack untouched.

---

## Hero GIF & demo assets (AIDA-23)

| Option | Description | Selected |
|--------|-------------|----------|
| Golden-path walkthrough on seeded demo | inbox → triage chips → cited draft → approve/send → /insights | ✓ |
| Feature-montage of separate clips | More editing work, less narrative | |

**Choice rationale:** One continuous golden path tells the product story (the AI wedge) in one asset. Final capture/approval = human-verification item.

---

## Backup/restore & ops (AIDA-24)

| Option | Description | Selected |
|--------|-------------|----------|
| Scripts + docs (pg_dump + uploads volume), cron example | `scripts/backup.sh`/`restore.sh`, no scheduler service | ✓ |
| Docs-only commands | Cheaper but error-prone for operators | |
| Automated backup sidecar in compose | New moving part, violates minimal-stack rule | |

**Choice rationale:** Requirement says "guidance" — scripts make guidance executable without adding a service. Uploads volume included (DB-only backup is incomplete).

---

## Security-pass scope (AIDA-24)

| Option | Description | Selected |
|--------|-------------|----------|
| Checklist audit + written report + fix small findings + GH SECURITY.md policy | Sweeps: encrypted keys, authz on every mutating action, AIDA-20 safeguards, rate limits, `pnpm audit`; absorbs open 04/05/06 human-verification items | ✓ |
| Informal re-read of docs/SECURITY.md | Not evidence-producing | |
| External pentest | Out of budget/scope for v1 launch | |

---

## Repo hygiene & launch mechanics (criterion 4)

| Option | Description | Selected |
|--------|-------------|----------|
| CI (typecheck+unit+build) + community files + fold all deferred hygiene items + v1.0.0 tag | Phase 7 is the long-promised repo-hygiene pass (.gitattributes eol=lf, REQUIREMENTS.md restructure, middleware→proxy, SlaDueChip locale, 02-07 dedup) | ✓ |
| CI only, defer hygiene again | Hygiene items were explicitly deferred "to a repo-hygiene pass" — this is it | |

---

## Branding settings (AIDA-12 remainder)

| Option | Description | Selected |
|--------|-------------|----------|
| Settings → Branding tab: display name + optional logo upload | Applied to public pages, sidebar brand block, email from-name; closes AIDA-12 | ✓ |
| Name-only (no logo) | Fallback if logo upload proves heavy during planning — planner's call | |
| Skip branding in Phase 7 | Would leave AIDA-12 permanently incomplete (coverage table maps it to 2,4,7) | |

**Note:** This area was surfaced by the coverage-table cross-check (AIDA-12 → "2,4,7"; grep confirmed zero branding code exists), not by the Phase 7 requirements line alone.

---

## Claude's Discretion

GIF tooling/asset location; seed volumes/prose; CI matrix details; docs IA; comparison-table rows (within honest-claims rules); CODE_OF_CONDUCT; LAUNCH.md; demo env-var naming; seed idempotency mechanism.

## Deferred Ideas

Hosted public demo; automated backup sidecar; logo upload (conditional); AIDA-18 KB autogen (backlog); i18n docs.
