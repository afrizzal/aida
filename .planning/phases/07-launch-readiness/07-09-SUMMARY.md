---
phase: 07-launch-readiness
plan: 09
subsystem: security
tags: [security-audit, authz, egress, secrets, dependency-audit, wcag]

requires:
  - phase: 07-launch-readiness (07-02, 07-03, 07-04, 07-05, 07-07, 07-08)
    provides: "the surfaces this pass audits — seed, branding action, backup scripts, CI workflows, demo mode, captured screenshots"
provides:
  - ".planning/phases/07-launch-readiness/07-SECURITY-PASS.md — the evidence-backed security report ROADMAP Phase 7 success criterion 3 requires"
  - "docs/SECURITY.md reconciled claim-by-claim against the code and dated"
  - "1 HIGH + 3 MEDIUM findings fixed in-phase; CI unblocked for the first time"
affects: [07-10-readme, 07-11-docs-site, 07-12-launch-checklist]

key-files:
  created:
    - .planning/phases/07-launch-readiness/07-SECURITY-PASS.md
  modified:
    - src/proxy.ts
    - src/app/(app)/settings/actions.ts
    - src/lib/rate-limit/check-rate-limit.ts
    - tests/e2e/global-setup.ts
    - package.json
    - docs/SECURITY.md
    - deferred-items.md

requirements-completed: [AIDA-24]
completed: 2026-08-01
---

# 07-09 — Pre-launch security pass

## Method

Eight sweeps run as **26 parallel agents**, with every claimed finding handed to an independent agent whose sole job was to *refute* it (defaulting to refuted when uncertain), plus a completeness critic hunting for surfaces no sweep named.

**17 findings were claimed; 13 were refuted as false positives.** That ratio is the headline methodological result: an unverified sweep report would have been ~76% noise, and a report that cries wolf is worse than a terse one. The refutations are preserved in the report's Evidence section with their reasoning.

The completeness critic turned out to be the highest-value component — it found the single HIGH-severity issue, which no sweep had looked for because none of them audited **account provisioning** as an attack surface.

## Checklist results

| D-10 item | Verdict |
|---|---|
| Provider keys encrypted at rest | PASS — every credential-bearing Setting key round-trips through `secret-box.ts`; no plaintext write or log |
| Server-side authz on every mutating action and route | **FAIL → FIXED** — `setAiEnabled` was the one ungated mutating Settings action of six |
| AIDA-20 safeguards (fence, redaction, append-only audit, no egress) | PASS — all four proof tests green; append-only trigger confirmed present in `20260707053633_ai_foundation/migration.sql` |
| Public-surface abuse controls | PASS — honeypot + rate limit + zod + byte-sniff on every public route |
| Dependency audit | **FAIL → PARTLY FIXED** — `next` patched; `sharp` accepted as a known issue |

## Findings fixed in phase

| Sev | Finding | Commit |
|---|---|---|
| **HIGH** | Anonymous `POST /api/auth/sign-up/email` was open on every deployment. One request before the operator finished `/setup` made the attacker the sole user; all four first-run gates key on `prisma.user.count()`, so `/setup` redirected to `/login` forever and recovery required a manual `DELETE FROM "user"`. | `5a259d2` |
| MEDIUM | `setAiEnabled` lacked `requireOrgAdmin()` — any authenticated member could flip the org-wide AI kill switch, including re-enabling AI after an admin disabled it. | `9cf38f4` |
| MEDIUM | `RATE_LIMIT_PEPPER` was effectively absent: `??` does not replace an empty string and compose injects `${RATE_LIMIT_PEPPER:-}`, so `ipHash` was an unsalted SHA-256 of a raw IP — reversible over the IPv4 space in minutes, **falsifying `docs/SECURITY.md`'s privacy claim**. | `4904bdb` |
| MEDIUM | `next@16.2.9` carried 9 advisories, all cleared by a patch bump. | `85b867b` |
| — | 5 pre-existing Biome lint errors that made CI fail at its first step, so `typecheck`/`test`/`build` had **never once run on the runner** despite the badge shipping since 07-05. | `fc45522` |

### Correction made during execution

The critic's recommended fix for the HIGH finding — `disableSignUp: true` — was **rejected after verification**. Three server-side callers (`setup/actions.ts:45`, `bootstrap.ts:19`, `demo/identities.ts:79`) go through the same Better Auth handler and would all have broken, bricking the setup wizard, headless bootstrap, and demo mode. Blocking the **HTTP route** in `src/proxy.ts` instead closes the anonymous path while leaving in-process calls untouched, because `auth.api.signUpEmail()` never traverses the proxy. The check is placed *before* the `PUBLIC_PREFIXES` allow-list — `/api/auth` is itself a public prefix and would otherwise short-circuit past it.

This required `tests/e2e/global-setup.ts` to stop creating its member user over HTTP; it now uses the in-process pattern. Verified live: `authz.spec.ts` 2/2.

## Known issues accepted for v1

- **HIGH — `sharp@0.34.5`** (GHSA-f88m-g3jw-g9cj, 4 libvips CVEs) is in the shipped image behind the unauthenticated `/_next/image`. Not trivially patchable: the fix is `>=0.35.0`, a 0.x minor pinned by next's optional-dependency range. Exploitability is materially limited — no `images.remotePatterns`, `dangerouslyAllowSVG` defaults false, and zero `next/image` usages in `src/`, so only files already in `public/` can be optimised.
- **MEDIUM — every container runs as root.** No `USER` in the Dockerfile. Secrets-in-build-args was checked and is clean.
- **LOW — leftmost `X-Forwarded-For`** is spoofable; safe only as an undocumented property of the shipped Caddyfile, and silently bypassable behind Cloudflare/nginx or a directly-exposed `app:3000`.
- **LOW — admin-authenticated SSRF** via the unvalidated Ollama base URL, with `testLlmConnection` echoing raw error text as a response oracle.
- **Product gap, not a vulnerability:** there is **no invite flow** anywhere in `src/app`, `src/lib`, `src/components`, and a self-registered user gets no `Member` row. AIDA currently has no working way to add a second team member. Now materially more visible since sign-up is closed.

## Demo mode assessment

Demo mode ships publicly documented credentials. Compensating controls: strictly opt-in on `DEMO_MODE === "true"` (strict equality, first statement), blank in `.env.example`, a loud boot warning naming the risk, and a "never expose to the internet" instruction in `.env.example`, `docs/OPERATIONS.md` and the README. It writes no real secret and never enables AI. **Verdict: sufficient.** The controls are defence-in-depth and the failure mode requires an operator to deliberately set a flag documented as evaluation-only.

## Human verification items

All three items carried since Phase 4 were **delegated to plan 07-09.1**, which replaced them with automated tests rather than asking for one-off manual checks. See `07-09.1-SUMMARY.md`. Dispositions were written into `04-VERIFICATION.md`, `05-HUMAN-UAT.md` and `06-HUMAN-UAT.md` in place, so no item remains open in two places.

Worth recording: 07-09's own Sweep 5 reported the Prisma CLI's `checkpoint.prisma.io` phone-home and the adversarial refuter **dismissed it as "not a defect in this repository"**. 07-09.1's runtime egress test then observed it happening on every `migrate deploy`, and it was fixed in the real `docker-compose.yml`. That is a genuine limit of static analysis plus adversarial refutation: a refuter reasoning about intent can talk itself out of a defect that a runtime probe simply observes.

## Verification

`tsc --noEmit` clean · unit 85/85 (90/90 after 07-09.1) · integration 26/26 · `biome check .` **exit 0** · `pnpm build` succeeds · CI green for the first time on run `30683769907`.
