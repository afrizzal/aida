---
phase: 07-launch-readiness
plan: 10
subsystem: docs
tags: [readme, docs, honesty-audit, comparison-table, github-pages, launch-readiness]

# Dependency graph
requires:
  - phase: 07-launch-readiness (07-05)
    provides: "CI badge URL, CONTRIBUTING.md, CODE_OF_CONDUCT.md, .github/SECURITY.md — the files this README now links to instead of a 'coming soon' placeholder"
  - phase: 07-launch-readiness (07-06)
    provides: "docs site target URL (https://afrizzal.github.io/aida) this README's Docs badge and Documentation section link to"
  - phase: 07-launch-readiness (07-07)
    provides: "DEMO_MODE=true boot flow + demo credentials (.env.example) the new 'Try the demo' section documents"
  - phase: 07-launch-readiness (07-08)
    provides: "docs/assets/aida-demo.gif + ten screenshots, the human-approved lead screenshot (inbox.png), and the caption obligation (local Ollama-protocol stub disclosure) this README's hero and screenshot gallery fulfil"
  - phase: 07-launch-readiness (07-09)
    provides: "docs/SECURITY.md's reconciled egress claim ('the only application-runtime egress is to the operator-configured LLM endpoint plus SMTP/IMAP') — the evidence behind this README's softened 'tickets stay on your server' claim"
provides:
  - "README.md rewritten top to bottom: hero GIF + honest caption, real CI/license/docs badges, extended features table, corrected quick start (http://localhost, not :3000), 'Try the demo' section, a hedged category-level comparison table, a screenshots gallery, tech stack, documentation links, v1 status, working Contributing/License sections"
  - "docs/BRIEF.md reconciled: honesty-guardrail sentence reworded to avoid the literal 'trained'/'fine-tuned' words, dated reconciliation note appended"
affects: [07-11-docs-site, 07-12-launch-checklist]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Comparison-table honesty pattern: 3 columns (AIDA / hosted-SaaS category / OSS category), qualitative rows only, every non-AIDA cell carries an explicit hedge word (typically/commonly/usually/varies/depends) so no cell reads as a definite claim about a named competitor's current pricing or feature set"
    - "Claim-qualification pattern: any 'data never leaves your server'-shaped claim in marketing copy must name its actual boundary (the LLM/SMTP/IMAP endpoints the operator configures) in the same sentence or the next one, not just in a separate security doc"

key-files:
  created:
    - .planning/phases/07-launch-readiness/07-10-SUMMARY.md
  modified:
    - README.md
    - docs/BRIEF.md

key-decisions:
  - "Comparison table's 'Licence' and 'Where your ticket data lives' rows deviate from the plan's own suggested cell text by adding a hedge word ('Typically proprietary and hosted-only', 'Varies by project — your server if self-hosted') to every non-AIDA cell — the plan's row-content examples for those two rows didn't include a hedge word, but the task's own acceptance criteria explicitly required 'every non-AIDA cell contains a hedging word', so the stricter acceptance criterion was followed over the softer example prose."
  - "docs/BRIEF.md's existing competitor pricing/star-count figures (Intercom Fin ~$0.99/resolution, Zendesk ~$1.50-$2.00/resolution + $50/agent/mo, Chatwoot ~33.6k stars, etc.) were left untouched. They are pre-existing, footnoted '3-vote-verified research claims' about competitors, not fabricated claims about AIDA, and the plan's Task 3 explicitly says 'do not rewrite it wholesale.' Task 3's trigger list ('a number not derivable from this repository') is read as guidance for corrections, not a mandate to strip externally-sourced, already-caveated competitor research from a positioning brief that CLAUDE.md's rules don't reach (those rules govern claims about AIDA)."
  - "Softened both instances of the 'tickets never leave your server' claim (hero tagline + Why AIDA paragraph) rather than just one, even though the plan's acceptance criteria only explicitly named the hero-adjacent instance — the same absolute claim appeared twice, and qualifying only one would have left a literal contradiction two paragraphs later."

requirements-completed: [AIDA-23]

# Metrics
duration: ~35min (context-gathering + drafting + 3 task commits; git commit span alone was 18:12:54-18:18:17+07:00, ~6 minutes, not counting the read-heavy research phase beforehand)
completed: 2026-08-03
---

# Phase 7 Plan 10: README Rewrite Into Star-Ready Landing Page Summary

**README.md rewritten into a full star-ready landing page — hero GIF with an honest stub-model caption, corrected `http://localhost` quick start, a "Try the demo" section, a hedged/number-free comparison table, and a screenshot gallery led by the human-approved `inbox.png` — closing AIDA-23.**

## Performance

- **Duration:** ~35 min total (see frontmatter). Commit span: 2026-08-03T18:12:54+07:00 to 2026-08-03T18:18:17+07:00.
- **Tasks:** 3 of 3 complete
- **Files modified:** 2 (README.md, docs/BRIEF.md)

## Accomplishments

- Rewrote `README.md` in the exact D-05 section order: hero (title/pitch/badges/GIF+caption) → Why AIDA → Features → Quick start → Try the demo → How AIDA compares → Screenshots → Tech stack → Documentation → Status → Contributing → License.
- Replaced the `<!-- TODO: hero demo GIF here -->` comment with a real embed of `docs/assets/aida-demo.gif`, plus a caption disclosing the recorded "Generate draft" segment used a local Ollama-protocol stub and that AIDA itself works with OpenAI, Anthropic, or a real local Ollama model — the exact caption obligation carried forward from 07-08's sign-off.
- Fixed the quick start's `http://localhost:3000` dead-end: now `http://localhost` (Caddy, ports 80/443) with the `:3000` URL only appearing once, explicitly labeled as the `pnpm dev` URL — verified via `grep -c "localhost:3000" README.md` = 1.
- Added the three secret-generation lines (`openssl rand -base64 32` → `BETTER_AUTH_SECRET`, `RATE_LIMIT_PEPPER`, `APP_ENCRYPTION_KEY`) and a health-check command, sourced from `.env.example`/`docker-compose.yml`/`Caddyfile`, not guessed.
- New "Try the demo" section: `DEMO_MODE=true`, the stored-vs-live AI honesty note, and the never-expose warning.
- New "How AIDA compares" section: 3 columns × 7 qualitative rows, zero numbers/percentages/prices, every non-AIDA cell hedged, a footnote disclaiming a vendor-specific audit, and a "When AIDA is not the right choice" subsection with 5 honest limitations (including the no-invite-flow gap the 07-09 security pass found).
- Screenshot gallery leads with `docs/assets/inbox.png` (07-08's named default), plus `ticket-detail.png`, `insights.png`, `knowledge-base.png`.
- Status rewritten from stale "🚧 Early development" to an accurate v1-shipped statement linking `.planning/ROADMAP.md`.
- Contributing section now links the real `CONTRIBUTING.md`/`CODE_OF_CONDUCT.md`/`.github/SECURITY.md` (all exist as of 07-05) instead of "coming soon."
- Verified every relative link target in `README.md` resolves on disk with a real `test -f`/`test -d` check (table below), and every absolute URL points at `afrizzal/aida` or `afrizzal.github.io/aida`.
- Ran the claim-sweep grep and softened the two unqualified "tickets never leave your server" claims to name the actual egress boundary (operator-configured LLM/SMTP/IMAP endpoints), per `docs/SECURITY.md`'s 07-09-reconciled egress claim.
- Reconciled `docs/BRIEF.md`: reworded its honesty-guardrail sentence so it no longer contains the literal words "trained"/"fine-tuned" (it previously used them in a negation — "not 'trained/fine-tuned'" — which still matched a literal grep), and appended a dated reconciliation note.

## Task Commits

1. **Task 1: README structural rewrite** - `b96120b` (feat)
2. **Task 2: Honest comparison table** - `87cd6dc` (feat)
3. **Task 3: Link, claim and consistency sweep across README and docs/** - `554995b` (docs)

## Files Created/Modified

- `README.md` — full rewrite (hero, badges, features, quick start, demo, comparison table, screenshots, stack, docs, status, contributing, license)
- `docs/BRIEF.md` — honesty-guardrail sentence reworded; dated reconciliation note appended

## Final Section Order Shipped

1. Hero (`<div align="center">`: title, pitch, badges, GIF + caption)
2. Why AIDA
3. Features (9-row table)
4. Quick start
5. Try the demo
6. How AIDA compares
7. Screenshots
8. Tech stack
9. Documentation
10. Status
11. Contributing
12. License

Matches D-05/the plan's Task 1 numbered list exactly (badges live inside the hero block per the plan's own instruction, not as a separate top-level section).

## Asset Filenames Embedded

- `docs/assets/aida-demo.gif` (hero, with caption)
- `docs/assets/inbox.png` (lead screenshot — 07-08's default)
- `docs/assets/ticket-detail.png`
- `docs/assets/insights.png`
- `docs/assets/knowledge-base.png`
- `docs/assets/` (linked as a directory, for the dark variants + the two additional screenshots — `kb-article.png`/`kb-new.png` and their dark variants — not individually embedded, per the plan's "3-4 screenshots" gallery-size guidance)

## Link Resolution Table (Task 3a — every relative target, `test -f`/`test -d` result)

| Link target | Type | Result |
|---|---|---|
| `LICENSE` | file | FOUND |
| `docs/assets/aida-demo.gif` | file | FOUND |
| `docs/assets/inbox.png` | file | FOUND |
| `docs/assets/ticket-detail.png` | file | FOUND |
| `docs/assets/insights.png` | file | FOUND |
| `docs/assets/knowledge-base.png` | file | FOUND |
| `docs/assets/` | dir | FOUND |
| `docs/ARCHITECTURE.md` | file | FOUND |
| `docs/OPERATIONS.md` | file | FOUND |
| `docs/SECURITY.md` | file | FOUND |
| `docs/BRIEF.md` | file | FOUND |
| `.planning/ROADMAP.md` | file | FOUND |
| `CONTRIBUTING.md` | file | FOUND |
| `CODE_OF_CONDUCT.md` | file | FOUND |
| `.github/SECURITY.md` | file | FOUND |

Absolute URLs checked for syntax + repo target (not liveness, per the plan's own instruction not to "fix" the Pages 404): `https://github.com/afrizzal/aida/actions/workflows/ci.yml/badge.svg`, `https://github.com/afrizzal/aida/actions/workflows/ci.yml`, `https://img.shields.io/badge/License-Apache_2.0-blue.svg`, `https://img.shields.io/badge/docs-afrizzal.github.io%2Faida-blue`, `https://afrizzal.github.io/aida` (×2), `https://github.com/afrizzal/aida.git` — all syntactically correct and target `afrizzal/aida` / `afrizzal.github.io/aida`. The Pages URL (`https://afrizzal.github.io/aida`) will 404 until Plan 07-12's launch checklist enables GitHub Pages (a known human-only step per the verified facts this plan was given) — left in place, not removed.

## Claim-Sweep Verdicts (Task 3b)

Ran `grep -nEi "never|always|no data|zero|only|fully|complete|automatic" README.md`. Per-hit verdict:

| Line (post-fix) | Hit | Verdict |
|---|---|---|
| 8-9 (hero) | "Your tickets never leave your server. No per-resolution fees." | **Softened.** Rewritten to "Your tickets stay on your server — the only egress is to the LLM, SMTP, or IMAP endpoints you configure yourself. No per-resolution fees from AIDA." Matches `docs/SECURITY.md`'s 07-09-reconciled egress claim. |
| 30 (Why AIDA) | "no per-resolution fees, no data leaving your control" | **Softened** (same claim, second occurrence — not explicitly named by the plan's acceptance criteria but qualified anyway to avoid a literal contradiction with the hero two paragraphs later). Now: "the only network egress is to the LLM provider and mail server you configure yourself. AIDA charges no per-resolution fees; your own LLM provider may still bill you directly for API usage." |
| 39 | "every AI action is written to an append-only audit log" | **Kept.** True of shipped code — `AuditEvent` is append-only (AIDA-19, verified in 07-09's security pass). |
| 43 | "Turn AI fully off anytime — the helpdesk keeps working" | **Kept.** A real, verified feature (AI toggle; helpdesk degrades gracefully per CLAUDE.md's non-negotiable rule). |
| 60 | "complete the `/setup` wizard" | **Kept.** Not a claim about the product's properties — an instruction. |
| 75 | "Never enable demo mode on an internet-facing instance" | **Kept.** An imperative warning, not a claim; matches `.env.example`'s own warning text verbatim in spirit. |
| 82-88 (comparison table) | Various "typically"/"usually"/"varies"/"commonly"/"depends" hedges + AIDA-column claims | **Kept.** All AIDA-column claims are true of shipped code; all non-AIDA cells hedged (see spot-check below). |
| 96 | "fully managed SaaS" | **Kept.** Descriptive of the competitor category, not a claim about AIDA. |

"No per-resolution fees" specifically double-checked against the plan's own instruction ("true: AIDA charges nothing; the user's own LLM provider may bill them. Say that.") — now stated explicitly in the Why AIDA paragraph and in the comparison table's "Per-resolution AI fees" row ("None; you pay your LLM provider directly").

## Comparison-Table Hedging Spot-Check (Task 2 acceptance criterion)

All 14 non-AIDA cells (2 competitor columns × 7 rows) individually checked for a hedge word:

| Row | Hosted SaaS cell | Hedge word | OSS cell | Hedge word |
|---|---|---|---|---|
| Licence | "Typically proprietary and hosted-only" | typically | "Varies by project (most are open source)" | varies |
| Where data lives | "Typically the vendor's cloud" | typically | "Varies by project — your server if self-hosted" | varies |
| AI in core product | "Typically a paid add-on or higher tier" | typically | "Typically an add-on or paid tier" | typically |
| Choice of LLM | "Usually the vendor's own model" | usually | "Usually a fixed vendor integration" | usually |
| Per-resolution fees | "Commonly metered per AI resolution" | commonly | "Varies" | varies |
| AI can be turned off | "Depends on the plan" | depends | "Varies" | varies |
| Setup | "Typically a vendor-hosted sign-up, no install" | typically | "Typically self-host, though hosted options exist for some projects" | typically |

14/14 hedged. `grep -Eci "trained|fine-tuned" README.md` = 0. `grep -Ec "[0-9]+%|[0-9]+x |[$][0-9]" README.md` = 0.

## Decisions Made

See `key-decisions` in the frontmatter. Most notable: the comparison table's first two rows were written with an explicit hedge word even though the plan's own example prose for those two rows lacked one — the task's acceptance criteria ("every non-AIDA cell contains a hedging word") is more specific than the illustrative row text, so the acceptance criteria governed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, self-introduced during Task 3] `docs/BRIEF.md`'s reconciliation note itself used the literal words "trained"/"fine-tuned"**
- **Found during:** Task 3, re-running the `grep -Eic "trained|fine-tuned" docs/BRIEF.md` verification after the first edit
- **Issue:** The first draft of the new reconciliation footnote said `removing literal "trained/fine-tuned" wording above`, which itself contains the two disallowed words and made the automated check fail against its own fix
- **Fix:** Reworded the footnote to describe the change ("no longer names the two disallowed words it was itself warning against") without repeating them
- **Files modified:** `docs/BRIEF.md`
- **Verification:** `grep -Eic "trained|fine-tuned" docs/BRIEF.md` → 0 (confirmed via a real grep, not assumed)
- **Committed in:** `554995b` (Task 3 commit — caught before commit, so only the final, correct text was ever committed)

---

**Total deviations:** 1 auto-fixed (self-caught during the same task, before any commit)
**Impact on plan:** None on the shipped repo — the incorrect intermediate text was never committed. Worth noting because it's a small illustration of why the automated `grep`-based acceptance criteria matter: prose *describing* a banned phrase can accidentally match the same banned-phrase check.

## Issues Encountered

None beyond the self-caught deviation above.

## User Setup Required

None. This plan only edits Markdown files; no external service configuration is required. The one open external dependency — GitHub Pages not yet being enabled, so `https://afrizzal.github.io/aida` 404s — is explicitly a Plan 07-12 launch-checklist item, not something this plan could or should fix, and the plan's own instructions say not to remove the link over it.

## Next Phase Readiness

- AIDA-23 marked complete: it spanned seven Phase-7 plans (07-01/05/06/08/10/11/12) per the STATE.md split-requirement precedent, and this plan (07-10) is the one that finishes the README half of its substance. Note: 07-11 (docs site content) still owns the rest of AIDA-23's remaining surface (the Starlight site's actual pages) — do not mark AIDA-23 fully "Validated" in PROJECT.md until 07-11/07-12 also land, per the same precedent used for AIDA-05/AIDA-09.
- 07-11 (docs site, parallel plan) was explicitly out of scope for this plan (owns `website/**`, never touched here) — no file conflicts expected; both plans touch entirely disjoint path sets (`README.md`/`docs/BRIEF.md` vs `website/**`).
- 07-12 (launch checklist) can now tag `v1.0.0` and add the release badge at the HTML comment marker (`<!-- release badge: add once v1.0.0 is tagged (Plan 07-12) -->`) left in the hero block; and should enable GitHub Pages so the Docs badge/link stop 404ing.
- No blockers.

---
*Phase: 07-launch-readiness*
*Completed: 2026-08-03*

## Self-Check: PASSED
