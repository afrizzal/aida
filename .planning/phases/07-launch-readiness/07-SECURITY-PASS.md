# Phase 7 Security Pass

## Scope and method

**Audited:** the whole `src/`, `prisma/`, `scripts/`, and `.github/` surface at commit `89d4600` (branch `phase-07-wave-4-launch-readiness`), plus the five fix commits this same plan layered on top of that commit (`5a259d2`, `9cf38f4`, `4904bdb`, `85b867b`, `fc45522`).

**Not audited:** third-party SDK internals (verified only via static call-site/source analysis, not a live network capture — see Human verification items #1), and the operator's own hosting infrastructure (reverse proxy other than the shipped Caddyfile, host OS hardening, cloud network config).

**Date:** 2026-08-01.

**Method:** 8 parallel automated sweeps (Server Action authz, route-handler authz, secrets at rest/in logs, tenant isolation in raw SQL, network egress, Phase 7's own new surfaces, dependency audit, safeguard-test re-run) were each run, and every claimed finding from every sweep was independently re-examined by a separate verifier agent instructed to actively try to refute it (check whether the code reference was accurate, whether the described impact was real, whether a compensating control already existed elsewhere). Of 17 raw claimed findings across the 8 sweeps, **13 were refuted as false positives** — recorded in Evidence with the refutation reasoning, not silently dropped — and 4 were **confirmed** after surviving every refutation attempt. Separately, a **completeness critic** was run whose only job was to hunt for security-relevant surfaces none of the 8 sweeps had asked about; it found **5 additional issues (GAP 1-5)** and explicitly verified 8 other dimensions as clean (append-only audit trigger, XSS/sanitization, path traversal, MIME handling, status-token entropy, pg-boss payload trust boundary, Server Action CSRF, session cookie flags).

This report and the five FIX commits were produced by an execution agent applying the maintainer's explicitly pre-approved subset of fixes against that evidence. The sweeps themselves were **not** re-run by this agent; every line this agent edited was re-read and re-verified before and after its own change, and `tsc --noEmit` / the unit suite / the integration suite / `pnpm build` were re-run after every fix (see Fixed in phase).

## Summary

- **1 HIGH** finding (GAP 1 — unauthenticated self-registration causing an unrecoverable first-run lockout) — **FIXED**.
- **3 MEDIUM** findings confirmed by the sweeps or critic and **FIXED**: `setAiEnabled` missing `requireOrgAdmin()`; the rate-limit pepper falling through to an unsalted/public-default hash (GAP 3); 9 reachable `next@16.2.9` dependency advisories.
- **1 HIGH** dependency finding (sharp/libvips) left as a **known issue** per explicit maintainer instruction (not a plain patch — pinned by `next`'s own optional-dependency range).
- **1 MEDIUM** finding (containers running as root, GAP 2) left as a **known issue** per explicit maintainer instruction.
- Several **LOW** hygiene/defence-in-depth findings across authz, route abuse-controls, raw-SQL comments, and build/deploy-time egress — recorded as known issues, none of them fixed in this phase (out of the maintainer's approved-fixes list).
- **5 pre-existing Biome lint errors** that were blocking `pnpm lint` (and therefore every downstream CI step) — **FIXED**, `biome check .` now exits 0.
- **1 non-security product gap** — AIDA has no working invite flow, so there is currently no in-product way to add a second team member to a workspace — documented in Known issues and logged to `deferred-items.md`.
- The three human-verification items carried forward since Phases 4-6 are **not yet resolved** — Task 3 of this plan is the blocking checkpoint that collects the maintainer's verdicts on them; this execution stops before Task 3 by design (see Human verification items).
- All fixes verified: `tsc --noEmit` clean, unit suite 85/85 (17 files), integration suite 26/26 (11 files), `biome check .` exit 0, `pnpm build` succeeds, and a live end-to-end Playwright run (`tests/e2e/authz.spec.ts`, 2/2) proves the FIX 1b global-setup change genuinely still creates both the admin and the non-admin member user and that server-side authz still rejects the non-admin's mutation.

## Checklist results

| # | D-10 checklist item | Result | Evidence |
|---|---|---|---|
| 1 | Provider/email keys encrypted at rest | **PASS** | Evidence → Sweep 3(a): all 4 credential-bearing `Setting` keys (`email:imapPasswordEnc`, `email:smtpPasswordEnc`, `llm:apiKeyEnc`, `llm:embeddingApiKeyEnc`) write only via `encryptSecret()` and read only via `decryptSecret()`; one AES-256-GCM primitive (`secret-box.ts`); no plaintext round-trip to the client (E2E-asserted) |
| 2 | Server-side authorization on every mutating Server Action and route | **PASS (post-fix)** | Evidence → Sweep 1: 34/35 Server Actions correctly gated; the 1 exception (`setAiEnabled`) fixed in `9cf38f4`. Sweep 2: 8/8 route files, zero routes missing an authorization mechanism, zero guarded routes reachable without a session. Critic GAP 1 (self-registration bypassing every first-run gate) fixed in `5a259d2` |
| 3 | AIDA-20 safeguards (injection fence, redaction, append-only audit, no third-party egress) | **PASS** | Evidence → Sweep 8: 107/107 tests green including all four named AIDA-20 proofs (`triage-injection`, `audit-append-only`, `draft-generation` Cases A+B, `llm-redact` 7/7). Sweep 3(c): all 11 `recordAuditEvent` call sites trace to redacted or fixed-marker input, none raw. Sweep 5: zero hardcoded third-party call sites in application code (residual: SDK-internal telemetry cannot be proven by static analysis — Human verification item #1) |
| 4 | Public-surface abuse controls (honeypot, rate limit, validation, upload sniffing) | **PASS (post-fix; 1 residual documented)** | Evidence → Sweep 2: all 3 body-accepting public routes carry honeypot + `checkRateLimit` + zod + (where applicable) byte-sniffed MIME/size caps; 4 LOW hygiene gaps recorded, not fixed (out of approved scope). GAP 3 (rate-limit pepper effectively empty, falsifying the "raw IPs never persisted" claim) fixed in `4904bdb`. GAP 4 (XFF leftmost-token spoofability) verified **not exploitable under the shipped Caddyfile topology** but documented as a residual fragility — Known issues |
| 5 | Dependency audit | **PASS (post-fix; 1 known issue remains)** | Evidence → Sweep 7: 39 advisories total, 10 reachable in the shipped app/worker image (9 × `next@16.2.9`, 1 × `sharp@0.34.5`). The 9 `next` advisories fixed in `85b867b` (patch bump, no breaking change). `sharp` left as a known issue per explicit maintainer instruction — not a plain patch, pinned by `next`'s own dependency range |

## Findings

| ID | Severity | Area | Description | Disposition |
|---|---|---|---|---|
| F-01 | HIGH | Account provisioning / authz | Critic GAP 1 — `POST /api/auth/sign-up/email` was reachable by any anonymous caller; because every first-run gate keys on the same `prisma.user.count()`, one anonymous request permanently locks `/setup` behind `/login` with no in-product recovery | **FIXED** — `5a259d2` |
| F-02 | MEDIUM | Server Action authorization | Sweep 1 (S1-01) / Sweep 6 (finding 3) — `setAiEnabled` was the only mutating Settings Server Action with no `requireOrgAdmin()` gate; any authenticated non-admin member could flip the org-wide AI kill switch | **FIXED** — `9cf38f4` |
| F-03 | MEDIUM | Rate-limit / privacy claim | Critic GAP 3 — `RATE_LIMIT_PEPPER ?? "aida-default-pepper"` did not fall back on the empty string `docker-compose.yml` actually injects, so `ipHash` was an unsalted `sha256(ip)` reversible over the IPv4 space in minutes; falsified `docs/SECURITY.md`'s "raw IPs are never persisted" claim | **FIXED** — `4904bdb` |
| F-04 | MEDIUM | Dependency audit (production) | Sweep 7 — `next@16.2.9` carried 9 reachable advisories (4 high, 5 moderate) in the shipped app/worker image, including a middleware/proxy-bypass advisory against `src/proxy.ts`'s exact mechanism (precondition — single-locale i18n config — not met here) | **FIXED** — `85b867b` |
| F-05 | HIGH | Dependency audit (production) | Sweep 7 — `sharp@0.34.5` carries GHSA-f88m-g3jw-g9cj (4 inherited libvips CVEs), reachable via the unauthenticated `/_next/image` endpoint; fix requires `>=0.35.0`, a 0.x-minor pinned by `next`'s own optional-dependency range, not a plain patch | **Known issue** — not fixed, per explicit maintainer instruction |
| F-06 | MEDIUM | Container hardening | Critic GAP 2 — no `USER` line in the Dockerfile's runner stage; `app`/`worker`/`migrate` all run as uid 0 | **Known issue** — not fixed, per explicit maintainer instruction |
| F-07 | LOW | Rate-limit robustness | Critic GAP 4 — all three public routes key `checkRateLimit` off the leftmost `X-Forwarded-For` token (attacker-controlled in general); verified **not exploitable** under the shipped Caddyfile (no `trusted_proxies` configured → Caddy overwrites XFF with the real peer IP), but becomes fully bypassable the moment an operator fronts AIDA with another CDN/proxy or exposes `app:3000` directly | **Known issue** — documentation/hardening item |
| F-08 | LOW | Admin-authenticated SSRF error oracle | Critic GAP 5 — `testLlmConnection`/`testEmbeddingConnection` echo the raw connection-failure message (up to 200 chars) back to the admin, turning the operator-supplied Ollama base URL probe into a differentiated internal-network scanner for an org admin | **Known issue** — admin-only, self-host, low severity |
| F-09 | LOW | Secrets in logs | Sweep 3 — `prisma/seed.ts:59-60` prints the demo admin/agent password (including an operator-supplied `DEMO_ADMIN_PASSWORD` override) verbatim to stdout, re-emitted by `scripts/capture-demo-assets.ts:739`; contradicts the "never logs the password" invariant the sibling boot path honours | **Known issue** — not in approved-fixes scope; CLI-only, not app runtime |
| F-10 | MEDIUM | Demo seed ordering | Sweep 6 (finding 1) — `prisma/seed.ts` calls `ensureDemoIdentities()` (which can create a demo agent account with a publicly documented password) **before** its own non-empty-workspace refusal guard; running `pnpm db:seed` against a live instance plants a login-capable member account while reporting "refused to seed" | **Known issue** — not in approved-fixes scope; requires the operator to run a CLI script against a live DB, no default/automatic trigger |
| F-11 | LOW | Server Action gate ordering | Sweep 1 (S1-02) — `addTag`'s `getScopedDb()` call is the 3rd statement, preceded by two pure, side-effect-free validation statements (`.trim()` + empty-string early return) | **Known issue** — no exploitable impact, style/consistency note only |
| F-12 | LOW | Public route abuse controls | Sweep 2 (LOW-1..4) — `/api/health` and `/api/public/status/[token]/attachments/[id]` have no `checkRateLimit`; `/api/public/status/[token]/follow-up` lacks the combined request-size cap `intake` enforces; both status POST routes run their token lookup before the rate-limit check | **Known issue** — not in approved-fixes scope; externally bounded by Caddy/Next body-size ceilings and 192-bit token entropy |
| F-13 | LOW | Raw SQL / tenant isolation | Sweep 4 — the `sla-flag` worker's two `$executeRaw` statements carry no `organizationId` filter; verified **not a cross-tenant leak** (system cron, no result set, every predicate column is row-local) but is precedent risk for a future copy-paste | **Known issue** — a one-line clarifying comment was suggested, not a code change; not in approved-fixes scope |
| F-14 | MEDIUM | Build/deploy-time egress | Sweep 5 (F-5.1/F-5.2/F-5.3) — `next/font/google` fetches Inter from Google Fonts at `next build` time (self-hosted afterwards, zero runtime egress); Next.js build/dev telemetry to `telemetry.nextjs.org` is on by default; Prisma CLI checkpoint pings `checkpoint.prisma.io` on every `docker compose up` via the `migrate` service | **Known issue** — not in approved-fixes scope; no ticket/customer data in any of the three payloads |
| F-15 | LOW | Browser hardening | Sweep 5 (F-5.4) — no Content-Security-Policy / `connect-src` anywhere in the stack | **Known issue** — defence-in-depth only; every client `fetch()` found is same-origin |
| F-16 (product gap, not a vulnerability) | — | Team provisioning | Zero hits anywhere in `src/app`, `src/lib`, `src/components` for `inviteMember`/`createInvitation`/`acceptInvitation`; a self-registered user gets no `Member` row (`activeOrganizationId: null`, fails closed). AIDA currently has **no working way to add a second team member** to a workspace | **Known issue** — logged to `deferred-items.md`; product gap, not a security vulnerability |

Two informational sweep items are intentionally **not** in the table above because the verifiers concluded they describe correct, intentional design rather than a defect: Sweep 1 (S1-03) `completeSetup`'s lack of a session gate (correct — it is the first-run bootstrap, protected by a `prisma.user.count() > 0` race guard instead), and 13 other refuted claims listed in full in Evidence.

## Fixed in phase

| Fix | Commit | One-line diff |
|---|---|---|
| FIX 1 + 1b — block anonymous self-registration (GAP 1) | `5a259d2` | `src/proxy.ts`: added a `BLOCKED_PUBLIC_ROUTES` check (403 JSON) for `/api/auth/sign-up*`, evaluated *before* `PUBLIC_PREFIXES`; `tests/e2e/global-setup.ts`: converted the member-user creation from an HTTP `fetch("/api/auth/sign-up/email")` to the in-process `auth.api.signUpEmail()` + `prisma.member.create()` pattern already used by `src/lib/demo/identities.ts` |
| FIX 2 — gate `setAiEnabled` | `9cf38f4` | `src/app/(app)/settings/actions.ts`: added `await requireOrgAdmin();` as the first statement of `setAiEnabled`, matching its 5 siblings in the same file |
| FIX 3 — mandatory rate-limit pepper (GAP 3) | `4904bdb` | `src/lib/rate-limit/check-rate-limit.ts`: `??` → `||`, plus a lazy `getPepper()` guard (mirroring `secret-box.ts`'s `getKey()`) that throws a descriptive error if the pepper is empty at hash time, instead of silently falling back to an unsalted/public-constant hash |
| FIX 4 — `next` 16.2.9 → 16.2.11 | `85b867b` | `package.json` + `pnpm-lock.yaml`: patch bump within the same minor line, clearing 9 of the 10 reachable dependency advisories with no breaking change |
| FIX 5 — clear the 5 pre-existing Biome lint errors | `fc45522` | `poll-inbox.ts` optional chain (with an `\|\| undefined` type-compat fix biome's own suggestion didn't type-check); `composer.tsx` suppression relocated to actually attach to the flagged node (behaviour unchanged); `input-group.tsx` 2 justified a11y suppressions; `support/fixtures.ts` mechanical `void`→`undefined`/`{}`→named-param fixes plus a new `requireBrowser()` helper; 3 e2e specs' `!` non-null assertions replaced with explicit throws; 2 stale `noExplicitAny` suppressions removed; `biome.json` now excludes the gitignored `test-results/` artifact directory |

## Known issues (accepted for v1)

**sharp / libvips (HIGH, F-05).** `sharp@0.34.5` carries GHSA-f88m-g3jw-g9cj, a rollup of 4 libvips CVEs, and is present in the shipped app/worker image via `next`'s own optional dependency on it. The endpoint it backs, `/_next/image`, is excluded from the auth-proxy matcher and is therefore unauthenticated. **Why acceptable for v1:** the fix (`>=0.35.0`) is a 0.x-minor bump that is effectively breaking and is pinned by `next`'s own dependency range — it needs a `pnpm` override or an upstream `next` release, not a trivial patch, and the maintainer explicitly directed this plan not to touch it. Exploitability is materially limited: `next.config.ts` configures no `images.remotePatterns` (remote URLs rejected by default) and `dangerouslyAllowSVG` defaults to `false`, and `src/` contains **zero** `next/image` usages, so only files already inside `public/` (which ships empty except `.gitkeep`) can ever be optimized — an attacker cannot supply arbitrary image bytes through this path today. **What would change this:** an upstream `next` release that widens its `sharp` range, or a maintainer-approved `pnpm.overrides` pin to `sharp@>=0.35.0` with a compatibility check against `next`'s image-optimization code path.

**Containers run as root (MEDIUM, F-06).** No `USER` line in the Dockerfile's `runner` stage — `app`, `worker`, and `migrate` all execute as uid 0; the `uploads_data` volume (the one directory that receives attacker-supplied bytes, from the unauthenticated intake route) is written by root. **Why acceptable for v1:** secrets-in-build-args were checked and are clean (only a placeholder `DATABASE_URL` is passed as a build arg, and `.dockerignore` excludes `.env`/`.env.*`), so this is a "blast radius if something else goes wrong" hardening gap, not an independently exploitable vulnerability, and the maintainer explicitly directed this plan not to add a `USER` line. **What would change this:** a follow-up plan adding a non-root `USER` (mirroring upstream Next.js's own standalone Dockerfile pattern: `adduser`/`addgroup` + `USER nextjs`) plus a check that the `uploads_data` volume's ownership matches.

**XFF leftmost-token spoofability / Caddyfile fragility (LOW, F-07).** All three public routes derive the rate-limit identity from `x-forwarded-for`'s leftmost token, which is attacker-controlled in general. **Why acceptable for v1:** verified against the actual shipped topology — the `Caddyfile` sets no `trusted_proxies`, and Caddy's documented default is to overwrite incoming XFF values unless `trusted_proxies` is configured, so in the shipped `docker-compose.yml` topology (only `caddy` publishes ports; `app` does not) this is **not exploitable**. **What would change this:** any operator who fronts AIDA with another reverse proxy/CDN and sets `trusted_proxies`, swaps Caddy for a proxy that appends by default (e.g. nginx), or exposes `app:3000` directly — none of which is the shipped default, but all of which are mainstream self-host topologies for an OSS product. A `trusted_proxies`-aware, right-to-left XFF parse (or, at minimum, an explicit documented deployment constraint in `docs/OPERATIONS.md`) would close this permanently.

**Admin-authenticated SSRF error oracle on the Ollama base URL (LOW, F-08).** `testLlmConnection`/`testEmbeddingConnection` return the raw failure message (sliced to 200 chars) to the calling admin, and the Ollama base URL is a free string with no scheme/host validation. **Why acceptable for v1:** both entry points are `requireOrgAdmin()`-gated (admin-only, in-tenant, self-host — the "victim" network is the operator's own), and this is mostly by design (the base URL is deliberately operator-supplied). **What would change this:** generalizing the returned error message instead of echoing the raw failure text.

**Demo-mode documented credentials (assessment, not a numbered finding).** Demo mode ships publicly documented credentials (`DEMO_ADMIN_PASSWORD=aida-demo-2026`), by design. Compensating controls verified present: strictly opt-in via `DEMO_MODE === "true"` (strict string equality, first statement of `bootstrapDemoMode`); `.env.example` ships `DEMO_MODE=` blank; a loud `console.warn` naming "PUBLICLY DOCUMENTED credentials" fires before any DB work; an explicit "never expose this to the internet" instruction appears in `.env.example`, `docs/OPERATIONS.md`, and the README. **Verdict: sufficient for v1.** The one adjacent gap found (Sweep 6 / F-10 — `prisma/seed.ts`'s CLI path can plant the same documented-credential account in a *live, non-demo* workspace before its own refusal guard fires) is a distinct, lower-frequency issue (requires an operator to run `pnpm db:seed` by hand against a populated instance) and is recorded separately above rather than folded into this verdict.

**Non-security product gap — no invite flow (F-16).** There is no `inviteMember`/`createInvitation`/`acceptInvitation` code anywhere in `src/`, and a self-registered user (even before FIX 1 closed the anonymous path) gets no `Member` row and therefore no workspace access. **This is a product gap, not a vulnerability** — AIDA currently has no in-product way for an admin to add a second team member to a workspace after `/setup`. Logged to `deferred-items.md` for a future plan; not fixed here (architectural — a new invitation flow is out of this plan's scope per Rule 4).

**Other LOW/MEDIUM items (F-09, F-10, F-11, F-12, F-13, F-14, F-15)** are recorded in the Findings table above with their own acceptance rationale; none was in the maintainer's approved-fixes list for this plan, none is independently exploitable at more than LOW/MEDIUM severity, and none was fixed here to keep this plan's diff scoped to exactly what was approved.

## Human verification items

**Status: PENDING.** This execution stops before Task 3 (the blocking human-verification checkpoint) by design — Task 3 is a separate, later step that presents these items to the maintainer, records their verdicts in this section, and updates `04-VERIFICATION.md`/`05-HUMAN-UAT.md`/`06-HUMAN-UAT.md` in place. Nothing below is a verdict; it is the carry-forward context Task 3 will present.

1. **Live network-egress capture** (04-VERIFICATION.md item 2). Sweep 5's static analysis enumerated every outbound call site in `src/` and found no hardcoded third-party host — but static analysis cannot prove the absence of vendor-SDK-internal telemetry (`openai`, `@anthropic-ai/sdk`, `ollama`, `nodemailer`, `imapflow`, `better-auth`, or a transitive dependency, via a dynamically constructed URL or a native addon). This remains a genuine human-only item: configure a provider, trigger a Test Connection + one triage for OpenAI, Anthropic, and a local Ollama, and confirm under a network monitor that the only destinations are the operator's own Postgres and the configured LLM/SMTP/IMAP hosts.
2. **Live-provider smoke test** (04-VERIFICATION.md item 3 + 06-HUMAN-UAT.md item 3). Not closed by 07-08: that plan's hero GIF exercises a **real code path** (retrieval → groundedness gate → citation resolution → `complete()`) but against a **local Ollama-protocol stub**, not a real vendor or a real local Ollama model, and cannot judge semantic output quality. A genuine human pass with a real/local-Ollama provider — auto-triage a new ticket, generate a draft and check its citation, run Generate insights on the demo dataset and judge whether cluster labels/KB-gap matches/narrative are sensible and never contradict the SQL numbers — is still needed.
3. **DESIGN-SYSTEM §9 visual pass** (05-HUMAN-UAT.md item 3). **Partially closed** by 07-08's Task 3 sign-off, which the 07-08-SUMMARY explicitly states "discharges the DESIGN-SYSTEM.md §9 'Dark mode diuji' item that had been carried forward since Phases 4, 5 and 6" for the 5 surfaces it captured in light+dark (inbox, ticket-detail, insights, KB **list**, AI settings). What 07-08 did **not** capture: `/kb/new` (create-article form) and `/kb/[id]` (single-article detail view) are named explicitly in 05-HUMAN-UAT.md item 3 and were not among 07-08's five captured pages; and while `ticket-detail.png`/`ticket-detail-dark.png` show the **resolved** AI Activity trail (Triage → Draft generated → Draft approved), neither 07-08's screenshots nor its GIF (which shows the DraftCard only in motion, not as a static light/dark pair) give a maintainer a still image of the **in-flight, not-yet-inserted** draft card 05-HUMAN-UAT.md item 3 asks about. Task 3 should present these two remaining surfaces specifically, rather than re-asking about the five 07-08 already covered.

## Evidence

*The following is the paste-ready evidence produced by the 8 parallel sweeps plus the completeness critic, reproduced as supplied (raw command output, tables, and verdicts), at branch `phase-07-wave-4-launch-readiness` @ commit `89d46005066e191095650c12a9ebdb968589dc78`.*

### Sweep 1 — Server Action authorization coverage

**Scope:** every file in `src/` carrying a `"use server"` directive, every exported async function in those files, and the *first executable statement* of each — read in full, not grepped for presence.

#### Commands run

```console
$ git log --oneline -1 && git branch --show-current
89d4600 docs(07-08): complete launch-visuals plan — Task 3 approved, Wave 3 done
phase-07-wave-4-launch-readiness

$ grep -rl '"use server"' src/
src/app/(app)/contacts/[id]/actions.ts
src/app/(app)/insights/actions.ts
src/app/(app)/kb/actions.ts
src/app/(app)/settings/actions.ts
src/app/(app)/settings/branding/actions.ts
src/app/(app)/settings/custom-fields/actions.ts
src/app/(app)/settings/email/actions.ts
src/app/(app)/settings/sla/actions.ts
src/app/(app)/settings/tags/actions.ts
src/app/(app)/tickets/new-ticket-action.ts
src/app/(app)/tickets/[id]/actions.ts
src/app/(auth)/setup/actions.ts
```

Completeness check — the `-rl` set is not missing single-quoted or inline (function-body) directives:

```console
$ grep -rn "use server" src/
src/app/(app)/contacts/[id]/actions.ts:1:"use server";
src/app/(app)/insights/actions.ts:1:"use server";
src/app/(app)/kb/actions.ts:1:"use server";
src/app/(app)/settings/actions.ts:1:"use server";
src/app/(app)/settings/branding/actions.ts:1:"use server";
src/app/(app)/settings/custom-fields/actions.ts:1:"use server";
src/app/(app)/settings/email/actions.ts:1:"use server";
src/app/(app)/settings/sla/actions.ts:1:"use server";
src/app/(app)/settings/tags/actions.ts:1:"use server";
src/app/(app)/tickets/new-ticket-action.ts:1:"use server";
src/app/(app)/tickets/[id]/actions.ts:1:"use server";
src/app/(auth)/setup/actions.ts:1:"use server";
```

All 12 are file-level, line 1. No `'use server'` (single-quoted) and no inline directive inside any `.tsx` component. **12 files, 35 exported async functions.** No `export const` arrow-function actions and no `export default` actions exist; the only non-function exports are TypeScript types (`KbArticleActionInput`, `LlmSettingsInput`, `EmbeddingSettingsInput`, `EmailSettingsInput`, `SetupInput`, `SetupResult`), which are erased at compile time and are not callable action endpoints.

#### First-statement evidence (raw, trimmed to 6 lines after each signature)

```console
$ for f in <the 12 files>; do echo "=== $f ==="; grep -n -A6 "^export async function" "$f"; done

=== src/app/(app)/contacts/[id]/actions.ts ===
10:export async function saveContactNotes(contactId: string, notes: string): Promise<{ ok: boolean }> {
11-  const { db } = await getScopedDb();
13-  await db.contact.update({ where: { id: contactId }, data: { notes } });

=== src/app/(app)/insights/actions.ts ===
10:export async function generateInsightRun(
11-  periodDays: 7 | 30 | 90,
12-): Promise<{ ok: boolean; alreadyRunning?: boolean }> {
13-  const { db, orgId } = await getScopedDb();

=== src/app/(app)/kb/actions.ts ===
18:export async function createKbArticleAction(
20-): Promise<{ ok: boolean; id?: string }> {
21-  await requireOrgAdmin();
22-  const { orgId } = await getScopedDb();
--
41:export async function updateKbArticleAction(
44-): Promise<{ ok: boolean }> {
45-  await requireOrgAdmin();
46-  const { orgId } = await getScopedDb();

=== src/app/(app)/settings/actions.ts ===
21:export async function setAiEnabled(enabled: boolean): Promise<{ ok: boolean }> {
22-  const { db, orgId } = await getScopedDb();          <-- NO requireOrgAdmin()
24-  const existing = await db.setting.findFirst({ where: { key: "aiEnabled" } });
26-  if (existing) {
27-    await db.setting.update({
--
57:export async function saveLlmSettings(input: LlmSettingsInput): Promise<{ ok: boolean }> {
58-  await requireOrgAdmin();
59-  const { db, orgId } = await getScopedDb();
--
81:export async function testLlmConnection(
83-): Promise<{ ok: boolean; error?: string }> {
84-  await requireOrgAdmin();
85-  const { db } = await getScopedDb();
--
118:export async function saveEmbeddingSettings(
120-): Promise<{ ok: boolean }> {
121-  await requireOrgAdmin();
122-  const { db, orgId } = await getScopedDb();
--
144:export async function testEmbeddingConnection(
146-): Promise<{ ok: boolean; error?: string }> {
147-  await requireOrgAdmin();
148-  const { db } = await getScopedDb();
--
170:export async function reembedAllKb(): Promise<{ ok: boolean; count: number }> {
171-  await requireOrgAdmin();
172-  const { db, orgId } = await getScopedDb();

=== src/app/(app)/settings/branding/actions.ts ===
13:export async function saveBranding(input: {
15-}): Promise<{ ok: boolean; error?: string }> {
16-  await requireOrgAdmin();
17-  const { db, orgId } = await getScopedDb();

=== src/app/(app)/settings/custom-fields/actions.ts ===
25:export async function createCustomField(
27-): Promise<{ ok: boolean; error?: string }> {
28-  await requireOrgAdmin();
29-  const { db, orgId } = await getScopedDb();
--
55:export async function updateCustomField(
58-): Promise<{ ok: boolean; error?: string }> {
59-  await requireOrgAdmin();
60-  const { db } = await getScopedDb();
--
83:export async function deleteCustomField(id: string): Promise<{ ok: boolean }> {
84-  await requireOrgAdmin();
85-  const { db } = await getScopedDb();

=== src/app/(app)/settings/email/actions.ts ===
33:export async function saveEmailSettings(input: EmailSettingsInput): Promise<{ ok: boolean }> {
34-  await requireOrgAdmin();
35-  const { db, orgId } = await getScopedDb();
--
59:export async function setEmailChannelEnabled(enabled: boolean): Promise<{ ok: boolean }> {
60-  await requireOrgAdmin();
61-  const { db, orgId } = await getScopedDb();
--
78:export async function testImapConnection(
80-): Promise<{ ok: boolean; error?: string }> {
81-  await requireOrgAdmin();
82-  const { db } = await getScopedDb();
--
110:export async function testSmtpConnection(
112-): Promise<{ ok: boolean; error?: string }> {
113-  await requireOrgAdmin();
114-  const { db } = await getScopedDb();

=== src/app/(app)/settings/sla/actions.ts ===
21:export async function saveSlaTargets(input: SlaTargetInput[]): Promise<{ ok: boolean }> {
22-  await requireOrgAdmin();
23-  const { db, orgId } = await getScopedDb();

=== src/app/(app)/settings/tags/actions.ts ===
10:export async function renameTag(id: string, name: string): Promise<{ ok: boolean }> {
11-  await requireOrgAdmin();
12-  const { db } = await getScopedDb();
--
27:export async function deleteTag(id: string): Promise<{ ok: boolean }> {
28-  await requireOrgAdmin();
29-  const { db } = await getScopedDb();

=== src/app/(app)/tickets/new-ticket-action.ts ===
21:export async function createTicketAction(input: NewTicketInput): Promise<{ id: string }> {
22-  const { orgId, session } = await getScopedDb();

=== src/app/(app)/tickets/[id]/actions.ts ===
25:export async function changeStatus(ticketId, status: TicketStatus) {
29-  const { db } = await getScopedDb();
--
50:export async function changePriority(ticketId, priority: TicketPriority) {
54-  const { db } = await getScopedDb();
--
87:export async function retryOutboundSend(messageId: string): Promise<{ ok: boolean }> {
88-  const { db } = await getScopedDb();
--
112:export async function rerunTriage(ticketId: string): Promise<{ ok: boolean }> {
113-  const { db } = await getScopedDb();
--
137:export async function generateDraftReply(ticketId: string) {
140-  const { orgId } = await getScopedDb();
--
155:export async function setTriageCategory(ticketId, category: TriageCategory) {
159-  const { db } = await getScopedDb();
--
168:export async function setTriageSentiment(ticketId, sentiment: TriageSentiment) {
172-  const { db } = await getScopedDb();
--
184:export async function setTriageLanguage(ticketId, language: string) {
188-  const { db } = await getScopedDb();
--
198:export async function assignTicket(ticketId, assigneeId: string | null) {
202-  const { db } = await getScopedDb();
--
215:export async function addTag(ticketId: string, name: string): Promise<{ ok: boolean }> {
216-  const trimmed = name.trim();
217-  if (!trimmed) return { ok: false };
219-  const { db, orgId } = await getScopedDb();       <-- gate is 3rd stmt (pure validation precedes)
--
235:export async function removeTag(ticketId: string, tagId: string): Promise<{ ok: boolean }> {
236-  const { db } = await getScopedDb();
--
292:export async function setCustomFieldValue(ticketId, definitionId, value) {
297-  const { db, orgId } = await getScopedDb();

=== src/app/(auth)/setup/actions.ts ===
28:export async function completeSetup(input: SetupInput): Promise<SetupResult> {
30-  const parsed = setupSchema.safeParse(input);
31-  if (!parsed.success) { ... }
39-  const existingUserCount = await prisma.user.count();
40-  if (existingUserCount > 0) return { error: "Setup has already been completed. Please sign in." };
```

#### Supporting evidence

```console
$ grep -rn "requireOrgAdmin\|getOrgRole" src/app/ src/lib/ --include=*.tsx --include=*.ts
src/lib/authz.ts:10:export async function getOrgRole()
src/lib/authz.ts:23:export async function requireOrgAdmin()
src/app/(app)/kb/actions.ts:21, 45
src/app/(app)/settings/actions.ts:58, 84, 121, 147, 171      <-- 5 calls for 6 exports
src/app/(app)/settings/branding/actions.ts:16
src/app/(app)/settings/branding/page.tsx:18                  (getOrgRole — read-only UI hint)
src/app/(app)/settings/custom-fields/actions.ts:28, 59, 84
src/app/(app)/settings/email/actions.ts:34, 60, 81, 113
src/app/(app)/settings/sla/actions.ts:22
src/app/(app)/settings/tags/actions.ts:11, 28
```

No `page.tsx` or `layout.tsx` under `src/app/(app)/settings/` calls `requireOrgAdmin()` — `src/app/(app)/settings/layout.tsx` is an 11-line `<SettingsNav/>` wrapper. There is **no route-level admin guard** compensating for a missing action-level gate; the documented model (`03-UI-SPEC.md` §Authorization shape) is explicitly "admin-gated actions, not a page guard".

```console
$ grep -rn "authz\|admin\|Server Action" docs/SECURITY.md
24:- Server-side authorization on every mutating route (admin vs agent); UI hiding is never the only control.
```

`src/lib/authz.ts:20-22` (docstring): *"Every mutating Settings Server Action must call this first (SECURITY.md: server-side authz on every mutating route, not just hidden UI)."*

Gate primitives confirmed (`src/lib/session.ts`): `requireSession()` `redirect("/login")`s when unauthenticated (throws `NEXT_REDIRECT` inside an action, aborting it); `getScopedDb()` calls `requireSession()` and throws if `session.activeOrganizationId` is unset — so `getScopedDb()` is a genuine authentication + tenant-scope gate, but carries **no role check**.

#### Coverage table

| File | Export | Gate | Verdict |
|---|---|---|---|
| `src/app/(app)/contacts/[id]/actions.ts` | `saveContactNotes` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/insights/actions.ts` | `generateInsightRun` | `getScopedDb()` — stmt 1 | PASS (agent-allowed by design, documented lines 3-5) |
| `src/app/(app)/kb/actions.ts` | `createKbArticleAction` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/kb/actions.ts` | `updateKbArticleAction` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/actions.ts` | `setAiEnabled` | **`getScopedDb()` only — no `requireOrgAdmin()` anywhere in the body** | **FINDING (S1-01) — now FIXED (`9cf38f4`)** |
| `src/app/(app)/settings/actions.ts` | `saveLlmSettings` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/actions.ts` | `testLlmConnection` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/actions.ts` | `saveEmbeddingSettings` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/actions.ts` | `testEmbeddingConnection` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/actions.ts` | `reembedAllKb` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/branding/actions.ts` | `saveBranding` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/custom-fields/actions.ts` | `createCustomField` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/custom-fields/actions.ts` | `updateCustomField` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/custom-fields/actions.ts` | `deleteCustomField` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/email/actions.ts` | `saveEmailSettings` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/email/actions.ts` | `setEmailChannelEnabled` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/email/actions.ts` | `testImapConnection` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/email/actions.ts` | `testSmtpConnection` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/sla/actions.ts` | `saveSlaTargets` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/tags/actions.ts` | `renameTag` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/settings/tags/actions.ts` | `deleteTag` | `requireOrgAdmin()` — stmt 1 | PASS |
| `src/app/(app)/tickets/new-ticket-action.ts` | `createTicketAction` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `changeStatus` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `changePriority` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `retryOutboundSend` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `rerunTriage` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `generateDraftReply` | `getScopedDb()` — stmt 1 | PASS (agent-allowed by design, documented lines 132-133) |
| `src/app/(app)/tickets/[id]/actions.ts` | `setTriageCategory` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `setTriageSentiment` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `setTriageLanguage` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `assignTicket` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `addTag` | `getScopedDb()` — **stmt 3** (preceded by `name.trim()` + empty-string early return) | PASS with note (S1-02) |
| `src/app/(app)/tickets/[id]/actions.ts` | `removeTag` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(app)/tickets/[id]/actions.ts` | `setCustomFieldValue` | `getScopedDb()` — stmt 1 | PASS |
| `src/app/(auth)/setup/actions.ts` | `completeSetup` | **No session gate by design** — zod validation (stmt 1) then `prisma.user.count() > 0` bootstrap race guard before any write | PASS with note (S1-03) |

35/35 exports enumerated. 20 gated by `requireOrgAdmin()` as first statement; 13 gated by `getScopedDb()` (authentication + tenant scope) as first statement; 1 (`addTag`) gated by `getScopedDb()` after two pure, side-effect-free validation statements; **1 (`setAiEnabled`) is a mutating Settings action with no role gate**; 1 (`completeSetup`) is an intentionally-public first-run bootstrap.

#### Findings

**S1-01 (HIGH, calibrated to MEDIUM by the verifier) — `setAiEnabled` is a mutating Settings Server Action with no `requireOrgAdmin()` gate.**
`src/app/(app)/settings/actions.ts:21-41`. Its first and only gate is `getScopedDb()` (line 22), which authenticates and binds tenant scope but performs **no role check**. Any authenticated org member — Better Auth role `"member"`, i.e. a plain agent — can invoke it directly (Server Actions are POST endpoints reachable independently of the UI) and flip the org-wide `aiEnabled` Setting. `src/app/(app)/settings/ai-toggle.tsx:36` only *visually* disables the Switch via `disabled={!providerConfigured}`, which is exactly the "UI hiding is never the only control" case `docs/SECURITY.md:24` forbids, and there is no page/layout guard on `/settings` to compensate.
Impact: the `aiEnabled` key is the AI kill switch read by `src/lib/worker/jobs/ai-triage.ts:21`, `src/lib/tickets/create-ticket.ts:123`, and `src/lib/insight/run-insight.ts:77`. A non-admin can therefore (a) disable AI workspace-wide (feature DoS), or (b) **re-enable AI after an admin deliberately turned it off**, resuming outbound ticket-content flow to the configured LLM provider against admin policy — directly contrary to CLAUDE.md's "AI must be fully toggleable off" and privacy-first non-negotiables.
Caveat for calibration: requires an authenticated in-tenant account; there is no cross-tenant or unauthenticated exposure, and no data is read out by the action itself.
Root cause: `setAiEnabled` was written in Phase 01-06 (`.planning/phases/01-foundation/01-06-SUMMARY.md:27` — "getScopedDb → findFirst + conditional create/update") *before* `requireOrgAdmin()` existed (introduced in 02-07, `.planning/phases/02-core-ticketing/02-07-PLAN.md:107`), and was never retrofitted when the five sibling actions in the same file were gated. `grep -rn "setAiEnabled" src/ tests/ e2e/` finds no test asserting an admin gate.
**Fix applied (`9cf38f4`):** inserted `await requireOrgAdmin();` as line 22, before `getScopedDb()` — a one-line change matching the other 20 gated actions.

**S1-02 (LOW) — `addTag`'s gate is the third statement, not the first.**
`src/app/(app)/tickets/[id]/actions.ts:215-219`. `const trimmed = name.trim();` and `if (!trimmed) return { ok: false };` run before `await getScopedDb()`. Both are pure, side-effect-free input validation on a caller-supplied string: no DB access, no queue send, no filesystem or network I/O, and the early return leaks nothing an unauthenticated caller does not already know. **No exploitable impact** — recorded only because the sweep requires confirming the gate is *genuinely first*, and this is the single place in the codebase where it is not. Every other action in the file opens with `getScopedDb()`. Not fixed in this phase (out of approved scope; LOW/no impact).

**S1-03 (LOW / informational) — `completeSetup` has no session gate, by design.**
`src/app/(auth)/setup/actions.ts:28-72`. This is the first-run bootstrap that creates the first user and organization, so it cannot require a session. Its real server-side control is the race guard at lines 39-40 (`prisma.user.count() > 0` → bail) which runs **before every mutation** (`auth.api.signUpEmail`, `auth.api.createOrganization`, `systemSetting.upsert`), with zod validation ahead of it. `/setup` is in `PUBLIC_PREFIXES` (`src/proxy.ts:4-10`) as expected, and `src/app/(auth)/setup/page.tsx:10-11` redirects to `/login` once `userCount > 0` as defence-in-depth. Correct pattern; recorded for completeness, not as a defect. (Residual, non-blocking: the guard is a check-then-act, so two concurrent first-run requests could in principle race — the practical outcome is a failed second `signUpEmail`/`createOrganization` on the unique email/slug constraints, and the window exists only before any user exists.)

**VERDICT: FINDING** — 34 of 35 exported Server Actions carry a correct, genuinely-first authorization gate; `setAiEnabled` (`src/app/(app)/settings/actions.ts:21`) broke the documented invariant "`requireOrgAdmin()` must be the FIRST statement of every mutating Settings Server Action" and let any authenticated non-admin member toggle the org-wide AI kill switch — **fixed in `9cf38f4`**.


### Sweep 2 — Route handler authorization coverage

**Scope:** every `route.ts` under `src/app/api` at branch `phase-07-wave-4-launch-readiness`, commit `89d46005066e191095650c12a9ebdb968589dc78`. Read-only audit; no repository file was modified.

#### Commands run and raw output

**1. Enumerate route files (the sweep's mandated command) + confirm no handlers exist outside `src/app/api`**

```
$ git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && find src/app/api -name "route.ts" | sort
phase-07-wave-4-launch-readiness
89d46005066e191095650c12a9ebdb968589dc78
src/app/api/attachments/[id]/route.ts
src/app/api/auth/[...all]/route.ts
src/app/api/health/route.ts
src/app/api/public/intake/route.ts
src/app/api/public/status/[token]/attachments/[id]/route.ts
src/app/api/public/status/[token]/csat/route.ts
src/app/api/public/status/[token]/follow-up/route.ts
src/app/api/tickets/[id]/messages/route.ts

$ find src -type f \( -name "route.ts" -o -name "route.tsx" -o -name "route.js" -o -name "route.mjs" \) | sort
(identical 8-file list — there are no route handlers anywhere else in src/)
```

**2. HTTP methods exported by each file**

```
$ for f in $(find src/app/api -name "route.ts" | sort); do echo "--- $f"; grep -nE "^export (async function|const|\{)" "$f"; done
--- src/app/api/attachments/[id]/route.ts
6:export const runtime = "nodejs";
8:export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
--- src/app/api/auth/[...all]/route.ts
4:export const { GET, POST } = toNextJsHandler(auth);
--- src/app/api/health/route.ts
4:export const dynamic = "force-dynamic";
6:export async function GET() {
--- src/app/api/public/intake/route.ts
11:export const runtime = "nodejs";
20:export async function POST(request: Request) {
--- src/app/api/public/status/[token]/attachments/[id]/route.ts
6:export const runtime = "nodejs";
8:export async function GET(
--- src/app/api/public/status/[token]/csat/route.ts
6:export const runtime = "nodejs";
13:export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
--- src/app/api/public/status/[token]/follow-up/route.ts
11:export const runtime = "nodejs";
17:export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
--- src/app/api/tickets/[id]/messages/route.ts
13:export const runtime = "nodejs";
15:export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {

$ grep -rnE "export (async )?function (PUT|PATCH|DELETE|HEAD|OPTIONS)" src/app/api || echo "(none)"
(none)
```

No mutating verb is exported anywhere except `POST`. Every file-bearing route pins `runtime = "nodejs"` (never Edge).

**3. Mechanical `PUBLIC_PREFIXES` classification** — `src/proxy.ts` was read and its exact prefix list applied to each route path in a throwaway script (written to the scratchpad, not the repo):

```
$ node scratchpad/prefix-check.js
GUARDED /api/attachments/[id]                         no prefix match -> proxy 401 JSON if no session cookie
PUBLIC  /api/auth/[...all]                            matched prefix /api/auth
PUBLIC  /api/health                                   matched prefix /api/health
PUBLIC  /api/public/intake                            matched prefix /api/public
PUBLIC  /api/public/status/[token]/attachments/[id]   matched prefix /api/public
PUBLIC  /api/public/status/[token]/csat               matched prefix /api/public
PUBLIC  /api/public/status/[token]/follow-up          matched prefix /api/public
GUARDED /api/tickets/[id]/messages                    no prefix match -> proxy 401 JSON if no session cookie
```

`src/proxy.ts` verbatim, AS AUDITED (before this plan's FIX 1 — invariant confirmed at the time of the sweep — list and 401-JSON behavior are exactly as specified; FIX 1 subsequently added a `BLOCKED_PUBLIC_ROUTES` check evaluated before this list, see Sweep 1/Fixed in phase):

```ts
const PUBLIC_PREFIXES = ["/login","/setup","/api/auth","/api/health","/request","/status","/api/public"];
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

```
$ find src -maxdepth 2 -name "middleware.ts" -o -maxdepth 2 -name "middleware.js"; ls src/proxy.ts
(no middleware.ts / middleware.js found)
src/proxy.ts  919B
```

No stale `middleware.ts` shadows the renamed `proxy.ts`.

**4. Abuse-control primitives — every call site in the repo**

```
$ grep -rn "checkRateLimit(" src --include=*.ts --include=*.tsx
src/app/api/public/intake/route.ts:41:  if (!(await checkRateLimit("public-intake", ip))) {
src/app/api/public/status/[token]/csat/route.ts:41:  if (!(await checkRateLimit("status-csat", ip))) {
src/app/api/public/status/[token]/follow-up/route.ts:42:  if (!(await checkRateLimit("status-follow-up", ip))) {
src/lib/rate-limit/check-rate-limit.ts:12:export async function checkRateLimit(

$ grep -rn "company_website" src --include=*.ts --include=*.tsx
src/app/api/public/intake/route.ts:36:  if (((form.get("company_website") as string | null) ?? "") !== "") {
src/app/api/public/status/[token]/csat/route.ts:36:  if (((form.get("company_website") as string | null) ?? "") !== "") {
src/app/api/public/status/[token]/follow-up/route.ts:37:  if (((form.get("company_website") as string | null) ?? "") !== "") {
src/components/public/honeypot-field.tsx:1,10,15,17 (the shared trap field)

$ grep -rn "safeParse\|z.object" src/app/api
src/app/api/public/intake/route.ts:13,45
src/app/api/public/status/[token]/csat/route.ts:8,47
src/app/api/public/status/[token]/follow-up/route.ts:13,46

$ grep -rn "fileTypeFromBuffer" src/app/api
src/app/api/public/intake/route.ts:1,82
src/app/api/public/status/[token]/follow-up/route.ts:1,69
src/app/api/tickets/[id]/messages/route.ts:1,63
```

All three POST routes with a request body carry honeypot + rate limit + zod. All three file-accepting routes byte-sniff. `src/lib/rate-limit/check-rate-limit.ts` confirms the pepper invariant — `sha256(ip + RATE_LIMIT_PEPPER)` is stored, never the raw IP; defaults are `max = 5` per `windowMs = 60*60*1000`, and all three call sites pass no `opts`, so every public POST is 5 requests/hour/IP-hash. (See Critic GAP 3 below: at the time of this sweep, the pepper itself could silently be empty — fixed in `4904bdb`.)

**5. Size / MIME caps**

```
$ cat src/lib/attachments/constants.ts
MAX_BYTES = 10 * 1024 * 1024
ALLOWED_MIME = { image/jpeg, image/png, image/gif, image/webp, application/pdf, text/plain, text/csv }
MAX_TOTAL_REQUEST_BYTES = 30 * 1024 * 1024  // public intake combined cap

$ grep -rn "MAX_TOTAL_REQUEST_BYTES\|content-length" src --include=*.ts --include=*.tsx
src/app/api/public/intake/route.ts:4,21,22,77   <- the ONLY route with a combined-request cap
src/lib/attachments/constants.ts:11
next.config.ts:2,12
```

Outer ceilings that bound every route regardless of in-route checks:

```
next.config.ts:12   proxyClientMaxBodySize: MAX_TOTAL_REQUEST_BYTES   // 30 MB, applied at body-clone time
Caddyfile:9-11      request_body { max_size 12MB }
node_modules/next/dist/server/lib/router-utils/resolve-routes.js:124
    const bodySizeLimit = config.experimental.proxyClientMaxBodySize;
```

**6. Bearer-token authz strength (`/api/public/status/[token]/*`)**

```
$ cat -n src/lib/tickets/status-token.ts
7  export function generateStatusToken(): string {
8    return randomBytes(24).toString("base64url");   // 192 bits, unique-indexed (prisma/schema.prisma:259)
9  }
```

**7. `/api/auth` is library-owned — verifying better-auth's own controls actually engage** (better-auth 1.6.22; output trimmed to the three relevant lines out of a large bundle):

```
$ grep -rn "rateLimit" node_modules/better-auth/dist/context/create-context.mjs | grep -E "window|max|enabled"
171:  enabled: options.rateLimit?.enabled ?? isProduction,
172:  window: options.rateLimit?.window || 10,
173:  max: options.rateLimit?.max || 100,

$ sed -n '/function getDefaultSpecialRules/,/^}/p' node_modules/better-auth/dist/api/rate-limiter/index.mjs
  pathMatcher: path.startsWith("/sign-in") || path.startsWith("/sign-up")
             || path.startsWith("/change-password") || path.startsWith("/change-email")
  window: 10, max: 3
  pathMatcher: "/request-password-reset" | "/send-verification-email" | "/forget-password"* | email-otp sends
  window: 60, max: 3

$ grep -rn "NODE_ENV" Dockerfile docker-compose.yml .env.example
Dockerfile:57:ENV NODE_ENV=production

$ grep -n "DEFAULT_IP_HEADERS =" .../@better-auth/core/dist/utils/ip.mjs
194:const DEFAULT_IP_HEADERS = ["x-forwarded-for"];
```

`src/lib/auth.ts` does not configure `rateLimit`, but the default is `enabled: isProduction` and the shipped image sets `NODE_ENV=production`, so brute-force protection (3 sign-in attempts / 10 s, keyed on `x-forwarded-for`, which `Caddyfile` sets via `reverse_proxy`) is live in the deployed topology.

#### Coverage table

| Route | Methods | Public? | Authz | Abuse controls | Verdict |
|---|---|---|---|---|---|
| `/api/attachments/[id]` | `GET` | No — no `PUBLIC_PREFIXES` match; proxy returns 401 JSON without a session cookie | Session via `getScopedDb()` (L11, `try/catch` → 401 JSON L13); org-scoped `db.attachment.findFirst` → 404 | N/A (no request body, no upload). Serves `Cache-Control: private, no-store`; filename is `encodeURIComponent`-escaped | **PASS** |
| `/api/auth/[...all]` | `GET`, `POST` | Yes — `/api/auth` | This *is* the authentication surface (better-auth `toNextJsHandler`); issues the session cookie all other routes depend on. **This plan's FIX 1 added a `/api/auth/sign-up*` block evaluated before this prefix match** — see Findings/Fixed in phase | No repo-level honeypot/`checkRateLimit`/zod — library-owned. better-auth 1.6.22 validates its own payloads and enables rate limiting by default when `NODE_ENV=production` (Dockerfile:57): 3 req/10 s on `/sign-in`, `/sign-up`, `/change-password`, `/change-email`; 100 req/10 s otherwise; keyed on `x-forwarded-for` supplied by Caddy. No file uploads | **PASS** (library-owned; verified engaged) |
| `/api/health` | `GET` | Yes — `/api/health` | Explicitly public (liveness probe, `dynamic = "force-dynamic"`) | Honeypot / zod / sniff **N/A** (takes no input at all). **No `checkRateLimit`** — every unauthenticated hit runs a `systemSetting.findUnique`; response discloses DB reachability and the worker heartbeat timestamp | **FINDING (LOW)** |
| `/api/public/intake` | `POST` | Yes — `/api/public` | Explicitly public (anonymous ticket submission); single-org `organization.findFirstOrThrow` (L61, documented v1 decision) | Honeypot L36 (silent `200 {ok:true, token:null}`, no distinguishing status) · `checkRateLimit("public-intake", ip)` L41 · zod `safeParse` L45 · `content-length` pre-check vs `MAX_TOTAL_REQUEST_BYTES` L21-24 · per-file `MAX_BYTES` L73 · running `totalBytes` cap L77 · `fileTypeFromBuffer` + `ALLOWED_MIME` L82-85 · persists the **sniffed** MIME, never the client-declared one L92 | **PASS** (reference implementation) |
| `/api/public/status/[token]/attachments/[id]` | `GET` | Yes — `/api/public` | Bearer `statusToken` (192-bit `randomBytes(24)` base64url, `@unique`); attachment join requires `message: { ticketId, visibility: "PUBLIC" }` L26 — internal-note blind by construction | Honeypot / zod / sniff **N/A** (no body, download-only; `id` and `token` are used only as Prisma `where` values). **No `checkRateLimit`** — unbounded token probing and unbounded file reads per caller | **FINDING (LOW)** |
| `/api/public/status/[token]/csat` | `POST` | Yes — `/api/public` | Bearer `statusToken` L18; plus eligibility gate — 409 unless status is `RESOLVED`/`CLOSED` L24; `organizationId` set explicitly from `ticket.organizationId` on upsert L64 | Honeypot L36 · `checkRateLimit("status-csat", ip)` L41 · zod `safeParse` L47 (score int 1-5, comment ≤2000) · no files accepted, so sniff/size caps N/A. Ordering note: the `ticket.findUnique` at L18 and the 404/409 branch run **before** the rate-limit check | **PASS** (see LOW-4 on ordering) |
| `/api/public/status/[token]/follow-up` | `POST` | Yes — `/api/public` | Bearer `statusToken` L22; all writes stamp `ticket.organizationId` explicitly L93/L107/L110; auto-reopen and message insert share one `$transaction` L90 | Honeypot L37 · `checkRateLimit("status-follow-up", ip)` L42 · zod `safeParse` L46 · `fileTypeFromBuffer` + `ALLOWED_MIME` L69-72 · per-file `MAX_BYTES` L64. **No `content-length` pre-check and no combined `MAX_TOTAL_REQUEST_BYTES` accumulator** — unlike the intake precedent; externally bounded only by Caddy 12 MB / Next 30 MB | **FINDING (LOW)** — all four sweep-required controls present; the gap is an inconsistency with the intake precedent |
| `/api/tickets/[id]/messages` | `POST` | No — no prefix match; proxy 401 JSON without a session cookie | Session via `getScopedDb()` L20 (`try/catch` → 401 JSON L23); ticket fetched through the scoped client L29 → cross-org id returns 404. Author stamped from `session.user.id` L92, never from the body | Public-route controls N/A (authenticated). `fileTypeFromBuffer` + `ALLOWED_MIME` L63-66 · per-file `MAX_BYTES` L58 · sniffed MIME persisted L73. No combined cap (bounded by Caddy 12 MB / Next 30 MB); pg-boss enqueue happens after commit L124-127 | **PASS** |

**Coverage totals: 8 route files, 9 exported handlers (7 × `POST`/`GET` singletons + `GET`,`POST` from `toNextJsHandler`). 6 public, 2 guarded. Zero routes lack an authorization mechanism; zero guarded routes rely on the proxy alone — both `/api/attachments/[id]` and `/api/tickets/[id]/messages` re-derive authorization in-handler via `getScopedDb()`, so a proxy misconfiguration cannot silently expose them.**

#### Findings

**LOW-1 — `/api/health` has no rate limit** (`src/app/api/health/route.ts:6`). Unauthenticated `GET` that issues a DB query per request and returns `{status, db, worker:{lastRunAt}}`. Honeypot and zod are structurally inapplicable (no input), but the endpoint is an unmetered DB-touching public surface that also discloses worker liveness to anonymous callers. Suggested: `checkRateLimit("health", ip)` with a generous window, or restrict the `worker` detail to authenticated callers. Not fixed in this phase (out of approved scope).

**LOW-2 — `/api/public/status/[token]/attachments/[id]` has no rate limit** (`src/app/api/public/status/[token]/attachments/[id]/route.ts:8`). The only public route with an authorization decision (`statusToken` lookup) and **no** `checkRateLimit`. A caller can probe token validity and pull attachment bytes without any metering; each request costs two Prisma queries plus a filesystem read. Exploitability is low because the token is 192 bits of `randomBytes`, but the sibling `csat`/`follow-up` routes under the identical trust model are all metered — this one is the outlier. Not fixed in this phase (out of approved scope).

**LOW-3 — `/api/public/status/[token]/follow-up` lacks the combined request-size cap that intake enforces** (`src/app/api/public/status/[token]/follow-up/route.ts:63-72`). The loop checks `file.size > MAX_BYTES` per file but never accumulates a total and never pre-checks `content-length`, so N files are accepted per request, each buffered whole into memory via `Buffer.from(await file.arrayBuffer())` and written to disk. Exposure is capped externally at 12 MB by `Caddyfile` and 30 MB by `next.config.ts` `proxyClientMaxBodySize`, and at 5 requests/hour/IP-hash — hence LOW, not MEDIUM. The route still returns whatever the framework does on truncation rather than the clean `413 payload_too_large` intake produces. Not fixed in this phase (out of approved scope).

**LOW-4 — token-existence check precedes the rate-limit check on both status POST routes** (`src/app/api/public/status/[token]/csat/route.ts:18`, `src/app/api/public/status/[token]/follow-up/route.ts:22`). `prisma.ticket.findUnique` and its 404 (and, for CSAT, the 409 `not_eligible`) branch execute before `checkRateLimit`, so token probing is unmetered and the differing status codes form a validity oracle. Mitigated by 192-bit token entropy; moving `checkRateLimit` above the lookup would close it and also cap the per-request DB cost. Not fixed in this phase (out of approved scope).

No HIGH or MEDIUM issues were found. No route is missing an authorization mechanism, no guarded route is reachable without a session, no public route accepts files without the byte sniff and MIME allow-list, and all three body-accepting public routes carry honeypot + rate limit + zod.

**VERDICT: FINDING — 4 LOW issues (2 public routes with no `checkRateLimit`: `/api/health` and `/api/public/status/[token]/attachments/[id]`; 1 missing combined request-size cap on `/api/public/status/[token]/follow-up`; 1 rate-limit ordering issue on the two status POST routes). Authorization coverage itself is complete and correct across all 8 route files. None of the 4 LOW findings were in the maintainer's approved-fixes list for this plan.**


### Sweep 3 — Secrets at rest and in logs

Branch `phase-07-wave-4-launch-readiness` @ `89d4600`. Read-only: `git status --porcelain` returned 0 lines before and after the sweep.

#### Commands run (assigned)

```
$ grep -rn "encryptSecret\|decryptSecret" src/
src/lib/channels/email/settings.ts:8:import { decryptSecret, encryptSecret } from "../../crypto/secret-box";
src/lib/channels/email/settings.ts:100:    imapPassword: imapPasswordEnc ? decryptSecret(imapPasswordEnc) : "",
src/lib/channels/email/settings.ts:105:    smtpPassword: smtpPasswordEnc ? decryptSecret(smtpPasswordEnc) : "",
src/lib/channels/email/settings.ts:149:    writes.push([EMAIL_SETTING_KEYS.imapPasswordEnc, encryptSecret(input.imapPassword)]);
src/lib/channels/email/settings.ts:158:    writes.push([EMAIL_SETTING_KEYS.smtpPasswordEnc, encryptSecret(input.smtpPassword)]);
src/lib/crypto/secret-box.ts:32:export function encryptSecret(plaintext: string): string {
src/lib/crypto/secret-box.ts:41: * Decrypts a blob produced by `encryptSecret`. Throws (GCM auth-tag failure) on any tampering
src/lib/crypto/secret-box.ts:44:export function decryptSecret(packed: string): string {
src/lib/llm/settings.ts:7:import { decryptSecret, encryptSecret } from "../crypto/secret-box";
src/lib/llm/settings.ts:70:    apiKey: apiKeyEnc ? decryptSecret(apiKeyEnc) : "",
src/lib/llm/settings.ts:106:    writes.push([LLM_SETTING_KEYS.apiKeyEnc, encryptSecret(input.apiKey)]);
src/lib/rag/settings.ts:9:import { decryptSecret, encryptSecret } from "../crypto/secret-box";
src/lib/rag/settings.ts:82:    apiKey: apiKeyEnc ? decryptSecret(apiKeyEnc) : "",
src/lib/rag/settings.ts:118:    writes.push([EMBEDDING_SETTING_KEYS.apiKeyEnc, encryptSecret(input.apiKey)]);
```

```
$ grep -rn "PasswordEnc\|apiKeyEnc\|llm:" src/lib
src/lib/channels/email/settings.ts:19:  imapPasswordEnc: "email:imapPasswordEnc",
src/lib/channels/email/settings.ts:24:  smtpPasswordEnc: "email:smtpPasswordEnc",
src/lib/channels/email/settings.ts:90:  const imapPasswordEnc = map.get(EMAIL_SETTING_KEYS.imapPasswordEnc);
src/lib/channels/email/settings.ts:91:  const smtpPasswordEnc = map.get(EMAIL_SETTING_KEYS.smtpPasswordEnc);
src/lib/channels/email/settings.ts:100:    imapPassword: imapPasswordEnc ? decryptSecret(imapPasswordEnc) : "",
src/lib/channels/email/settings.ts:105:    smtpPassword: smtpPasswordEnc ? decryptSecret(smtpPasswordEnc) : "",
src/lib/channels/email/settings.ts:149:    writes.push([EMAIL_SETTING_KEYS.imapPasswordEnc, encryptSecret(input.imapPassword)]);
src/lib/channels/email/settings.ts:158:    writes.push([EMAIL_SETTING_KEYS.smtpPasswordEnc, encryptSecret(input.smtpPassword)]);
src/lib/llm/settings.ts:12:  provider: "llm:provider",
src/lib/llm/settings.ts:13:  model: "llm:model",
src/lib/llm/settings.ts:14:  apiKeyEnc: "llm:apiKeyEnc",
src/lib/llm/settings.ts:15:  ollamaBaseUrl: "llm:ollamaBaseUrl",
src/lib/llm/settings.ts:56: * Reads all llm:* Setting rows and returns a fully typed, decrypted LlmSettings object.
src/lib/llm/settings.ts:65:  const apiKeyEnc = map.get(LLM_SETTING_KEYS.apiKeyEnc);
src/lib/llm/settings.ts:70:    apiKey: apiKeyEnc ? decryptSecret(apiKeyEnc) : "",
src/lib/llm/settings.ts:106:    writes.push([LLM_SETTING_KEYS.apiKeyEnc, encryptSecret(input.apiKey)]);
src/lib/rag/settings.ts:14:  provider: "llm:embeddingProvider",
src/lib/rag/settings.ts:15:  model: "llm:embeddingModel",
src/lib/rag/settings.ts:16:  apiKeyEnc: "llm:embeddingApiKeyEnc",
src/lib/rag/settings.ts:17:  ollamaBaseUrl: "llm:embeddingOllamaBaseUrl",
src/lib/rag/settings.ts:65: * Reads all llm:embedding* Setting rows and returns a fully typed, decrypted EmbeddingSettings
src/lib/rag/settings.ts:77:  const apiKeyEnc = map.get(EMBEDDING_SETTING_KEYS.apiKeyEnc);
src/lib/rag/settings.ts:82:    apiKey: apiKeyEnc ? decryptSecret(apiKeyEnc) : "",
src/lib/rag/settings.ts:118:    writes.push([EMBEDDING_SETTING_KEYS.apiKeyEnc, encryptSecret(input.apiKey)]);
```

```
$ grep -rn "console\." src/lib/llm src/lib/rag src/lib/channels src/lib/crypto src/lib/demo src/lib/worker
src/lib/channels/email/poll-inbox.ts:46:            console.error("[poll] poisoned message skipped", { emailMessageId });
src/lib/demo/bootstrap-demo.ts:17:  console.warn(
src/lib/demo/bootstrap-demo.ts:24:      console.info("[demo] Demo data already present (%d tickets) — skipping seed.", existing);
src/lib/demo/bootstrap-demo.ts:38:    console.info("[demo] Seeded demo workspace in %dms: %o", Date.now() - started, summary);
src/lib/demo/bootstrap-demo.ts:39:    console.info(
src/lib/demo/bootstrap-demo.ts:45:    console.error(
src/lib/worker/index.ts:17:  boss.on("error", (err: Error) => console.error("[worker] pg-boss error:", err));
src/lib/worker/index.ts:100:  console.log("[worker] started");
src/lib/worker/index.ts:111:  console.error("[worker] fatal:", err);
src/lib/worker/jobs/email-outbound-send.ts:69:    console.error("[worker] email-outbound-send failed:", err instanceof Error ? err.message : err);
```
`src/lib/llm`, `src/lib/rag` and `src/lib/crypto` contain **zero** `console.*` calls.

```
$ grep -n "replace-me\|=$" .env.example
     7: BETTER_AUTH_SECRET=replace-me-with-a-32-byte-random-secret
    29: ADMIN_EMAIL=
    30: ADMIN_PASSWORD=
    31: ADMIN_NAME=
    44: DEMO_MODE=
    54: RATE_LIMIT_PEPPER=replace-me-with-a-random-pepper
    59: APP_ENCRYPTION_KEY=replace-me-with-a-random-32-byte-base64-key
```
*(the RTK shell wrapper reformats grep output with a `[file] … (7):` header; line numbers/text above are verbatim and were cross-checked against a full `Read` of `.env.example`.)*

#### Supplementary commands (exhaustiveness)

```
$ grep -rn "console\." src/ --include=*.ts --include=*.tsx        # widened past the 6 assigned dirs
src/lib/bootstrap.ts:24:    console.error("[bootstrap] Failed to create admin user for", email);
src/lib/bootstrap.ts:36:    console.error("[bootstrap] Failed to create organization for admin", email);
src/lib/bootstrap.ts:47:  console.info("[bootstrap] Created admin:", email);
src/lib/queue/boss-client.ts:16:  boss.on("error", (err: Error) => console.error("[app] pg-boss error:", err));
… + the 10 lines already listed above  → 14 console.* sites in all of src/

$ grep -rnE "process\.stdout\.write|process\.stderr\.write|pino|winston|logger\." src/ …
(only false positives on the fictional demo contact "winston.park@fernwood-realty.example")
→ console.* is the ONLY logging channel in src/; there is no logger abstraction to audit separately.

$ grep -rn "console\." prisma/ scripts/ --include=*.ts
prisma/seed.ts:58:    console.log("[seed] Demo workspace seeded. Log in with:");
prisma/seed.ts:59:    console.log(`[seed]   Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
prisma/seed.ts:60:    console.log(`[seed]   Agent: ${AGENT_EMAIL} / ${ADMIN_PASSWORD}`);
scripts/capture-demo-assets.ts:739:    console.log(seedOutput);
… (17 further non-credential log lines)

$ grep -rn "Enc" src/                                              # files_with_matches
src/lib/channels/email/settings.ts, src/lib/rag/settings.ts, src/lib/llm/settings.ts,
src/lib/crypto/secret-box.ts  (last one matches only the doc-comment word "Encrypts")
→ no *Enc Setting key is referenced anywhere outside the three typed settings modules.

$ grep -rnE "auditEvent\.(create|createMany|update|upsert)" src/ scripts/ prisma/ tests/ …
src/lib/audit/record-audit-event.ts:37   ← the ONLY AuditEvent write in product code
tests/integration/audit-append-only.test.ts:15,29  (deliberate raw write/update to prove the
                                                    aida_audit_event_immutable trigger rejects UPDATE)
src/generated/prisma/models/AuditEvent.ts:768…914  (generated JSDoc examples, not call sites)

$ git ls-files | grep -iE "(^|/)\.env"   →  .env.example        (only the example is tracked)
$ grep -n "env" .gitignore               →  15:.env  16:.env.*  17:!.env.example
$ grep -rn -i "INSERT INTO \"Setting\"\|apiKey\|password" prisma/migrations/
prisma/migrations/20260629020504_init/migration.sql:49:    "password" TEXT,   ← Better Auth Account column (hashed)
→ no migration inserts a Setting row or a plaintext credential.
```

---

#### (a) Credential-bearing Setting keys — write path and read path

Full key inventory from `grep -rnoE '"[a-zA-Z]+:[a-zA-Z]+"|key: "[a-zA-Z]+"' src/lib src/app`: **24 org-scoped `Setting` keys + 1 `SystemSetting` key**. Exactly **4** are credential-bearing.

| Setting key | Only write path | Only read path | Plaintext ever stored? |
|---|---|---|---|
| `email:imapPasswordEnc` | `src/lib/channels/email/settings.ts:149` — `encryptSecret(input.imapPassword)` | `settings.ts:100` — `decryptSecret(imapPasswordEnc)` | No |
| `email:smtpPasswordEnc` | `src/lib/channels/email/settings.ts:158` — `encryptSecret(input.smtpPassword)` | `settings.ts:105` — `decryptSecret(smtpPasswordEnc)` | No |
| `llm:apiKeyEnc` | `src/lib/llm/settings.ts:106` — `encryptSecret(input.apiKey)` | `src/lib/llm/settings.ts:70` — `decryptSecret(apiKeyEnc)` | No |
| `llm:embeddingApiKeyEnc` | `src/lib/rag/settings.ts:118` — `encryptSecret(input.apiKey)` | `src/lib/rag/settings.ts:82` — `decryptSecret(apiKeyEnc)` | No |

Non-credential keys (verified, for completeness): `email:enabled|fromAddress|imapHost|imapPort|imapSecure|imapUser|smtpHost|smtpPort|smtpSecure|smtpUser|lastPollAt|lastPollError`, `llm:provider|model|ollamaBaseUrl`, `llm:embeddingProvider|embeddingModel|embeddingOllamaBaseUrl`, `branding:workspaceName`, `aiEnabled`, and `SystemSetting.setupComplete`.

Supporting checks:
- **One primitive.** `src/lib/crypto/secret-box.ts` is the sole AES-256-GCM implementation: `node:crypto`, `IV_LENGTH = 12`, `TAG_LENGTH = 16`, packs `iv|authTag|ciphertext` base64 into `Setting.value` (lines 32-38); `decryptSecret` sets the auth tag before `final()` so tampering throws (lines 44-52). No second cipher exists in the repo.
- **Write-guard semantics.** All three modules write the `*Enc` key only when the input is a non-empty string (`if (input.apiKey)` / `if (input.imapPassword)`), so a blank form field means "keep the stored value" instead of overwriting with `""`.
- **Never round-tripped to the client.** `src/app/(app)/settings/page.tsx:33-45` and `src/app/(app)/settings/email/page.tsx:18-28` build explicit field-by-field object literals (`{provider, model, ollamaBaseUrl}` / the nine non-secret email fields) — no object spread — so no decrypted value can reach the RSC payload. E2E `tests/e2e/phase4-ai.spec.ts:537-547` asserts the reloaded API-key field is `""` and that the stored blob is byte-identical after a blank re-save.
- **Every decrypted-settings consumer traced** (`getEmailSettings|getLlmSettings|getEmbeddingSettings|resolveEmbeddingProvider|resolveActiveProvider`): `poll-inbox.ts:25` → IMAP client only; `email-outbound-send.ts:27` → SMTP transport only; `complete.ts:20,33-39` → adapter `apiKey` param only; `embed.ts:20` / `kb-embed-article.ts:39` → embed adapter only; `run-insight.ts:79` → boolean only; `messages/route.ts:81` → reads `.enabled` only; settings pages/actions as above. None serialises, logs, or returns a credential.
- **Raw SQL cannot bypass this.** All 22 `$queryRaw`/`$executeRaw` sites live in `insight/*`, `rag/retrieve.ts`, `tickets/search.ts`, `worker/jobs/{sla-flag,kb-embed-article}.ts`; none touches the `Setting` table.
- **Non-src writers are clean.** `scripts/capture-demo-assets.ts:422-433` writes only `llm:provider|model|ollamaBaseUrl` + embedding equivalents pointed at a local stub URL — no credential key.

**(a) → PASS.**

#### (b) `console.*` call sites — does any interpolate a secret?

All 14 `console.*` sites in `src/` (the 10 from the assigned grep plus 4 found by widening to all of `src/`):

| # | Site | What is interpolated | Secret? |
|---|---|---|---|
| 1 | `src/lib/channels/email/poll-inbox.ts:46` | `{ emailMessageId }` — a derived RFC Message-ID | No |
| 2 | `src/lib/demo/bootstrap-demo.ts:17` | static "DEMO MODE IS ACTIVE…" warning string | No |
| 3 | `src/lib/demo/bootstrap-demo.ts:24` | `existing` (ticket count) | No |
| 4 | `src/lib/demo/bootstrap-demo.ts:38` | elapsed ms + `summary` (row counts) | No |
| 5 | `src/lib/demo/bootstrap-demo.ts:39-42` | `adminEmail` only — text reads *"(password from DEMO_ADMIN_PASSWORD, default: the documented demo password)"*; the value is **not** interpolated | No |
| 6 | `src/lib/demo/bootstrap-demo.ts:45-48` | `error.message` from the seed | No |
| 7 | `src/lib/worker/index.ts:17` | pg-boss `Error` object | No |
| 8 | `src/lib/worker/index.ts:100` | static `"[worker] started"` | No |
| 9 | `src/lib/worker/index.ts:111` | fatal `err` (DATABASE_URL never interpolated; only `connectionString` is passed to `new PgBoss()` at line 16) | No |
| 10 | `src/lib/worker/jobs/email-outbound-send.ts:69` | `err.message` **only**, deliberately narrowed; line 68 comment: *"Never log settings.smtpPassword or full email bodies"* | No |
| 11 | `src/lib/bootstrap.ts:24` | `email` | No |
| 12 | `src/lib/bootstrap.ts:36` | `email` | No |
| 13 | `src/lib/bootstrap.ts:47` | `email` | No |
| 14 | `src/lib/queue/boss-client.ts:16` | pg-boss `Error` object | No |

No `Setting.value` is ever logged raw; `poll-inbox.ts:81` and `email-outbound-send.ts:68` carry explicit "never log the password" comments that the code honours. `console.*` is the only logging channel in `src/` (no pino/winston/logger, no `process.stdout.write`).

**Within the four assigned directories plus all of `src/`: clean.** However, widening the same criterion to the rest of the repo surfaced one violation:

| Site | What is interpolated | Secret? |
|---|---|---|
| `prisma/seed.ts:59` | `` `[seed]   Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}` `` where `ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD \|\| DEMO_PASSWORD_DEFAULT` (line 26) | **Yes — a password** |
| `prisma/seed.ts:60` | same `${ADMIN_PASSWORD}` for the agent account | **Yes — a password** |
| `scripts/capture-demo-assets.ts:739` | `console.log(seedOutput)` — re-emits the seed's captured stdout, including the two lines above | **Yes (propagation)** |

See the finding below (F-09, not fixed in this phase). **(b) → FINDING (LOW).**

#### (c) `AuditEvent.input` — all 11 `recordAuditEvent` call sites traced

`src/lib/audit/record-audit-event.ts:37` is the **only** `auditEvent.create` in product code (verified by grep), and its param doc states `input` "MUST be the already-redacted prompt". Redaction is structural: `src/lib/llm/complete.ts:19` runs `redactSecrets(params.prompt)` unconditionally with no opt-out flag, and returns that same string as `redactedPrompt`.

| # | Call site | `input:` expression | Verdict |
|---|---|---|---|
| 1 | `src/lib/triage/run-triage.ts:90` | `redactedPrompt` (from `complete()` at :38) | Redacted |
| 2 | `src/lib/rag/generate-draft.ts:74` | literal `"no relevant KB content retrieved for this query"` | Fixed marker |
| 3 | `src/lib/rag/generate-draft.ts:113` | `redactedPrompt` (from `complete()` at :81) | Redacted |
| 4 | `src/lib/insight/run-insight.ts:144` | `labelRes.redactedPrompt` | Redacted |
| 5 | `src/lib/insight/run-insight.ts:225` | `narrRes.redactedPrompt` | Redacted |
| 6 | `src/app/api/tickets/[id]/messages/route.ts:151` | literal `"draft approved and sent by agent"` | Fixed marker |
| 7 | `src/lib/demo/seed-demo-data.ts:342` | `` `[demo seed] redacted triage prompt for ticket #${created.number}` `` | Fixed marker + ticket number |
| 8 | `src/lib/demo/seed-demo-data.ts:501` | `` `[demo seed] redacted grounded-draft prompt for ticket #${ticket.number}` `` | Fixed marker + ticket number |
| 9 | `src/lib/demo/seed-demo-data.ts:517` | literal `"draft approved and sent by agent"` | Fixed marker |
| 10 | `src/lib/demo/seed-demo-data.ts:699` | `` `[demo seed] redacted cluster-labeling prompt for the ${periodDays}-day period` `` | Fixed marker + integer |
| 11 | `src/lib/demo/seed-demo-data.ts:710` | `` `[demo seed] redacted narrative-summary prompt for the ${periodDays}-day period` `` | Fixed marker + integer |

No call site passes raw ticket text, a `Setting.value`, or any credential. `src/lib/insight/excerpt.ts:12` additionally applies `redactSecrets()` to ticket bodies *before* they reach `embed()` (which, unlike `complete()`, has no built-in redaction) — closing the one path that could otherwise have carried unredacted text into an AI input.

Scope note (not a defect): `redactSecrets` (`src/lib/llm/redact.ts:8-14`) is a five-pattern "obvious secrets" scrubber (OpenAI/Anthropic key shapes, AWS `AKIA…`, bearer tokens, card-like digit runs), not a general PII redactor. That is exactly what `docs/SECURITY.md:19` claims ("Obvious secrets … are redacted"), so the honest-claims rule is satisfied.

**(c) → PASS.**

#### (d) `.env.example` — every one of the 20 assignments

| Line | Assignment | Classification |
|---|---|---|
| 4 | `BETTER_AUTH_URL=http://localhost` | Non-secret default |
| 5 | `NEXT_PUBLIC_APP_URL=http://localhost` | Non-secret default |
| 7 | `BETTER_AUTH_SECRET=replace-me-with-a-32-byte-random-secret` | Placeholder |
| 9 | `BETTER_AUTH_TRUSTED_ORIGINS=http://localhost,https://localhost` | Non-secret default |
| 12 | `DATABASE_URL=postgresql://aida:aida@localhost:5432/aida` | Local-dev default creds |
| 13 | `POSTGRES_USER=aida` | Local-dev default |
| 14 | `POSTGRES_PASSWORD=aida` | Local-dev default (see note) |
| 15 | `POSTGRES_DB=aida` | Non-secret |
| 19 | `DOMAIN=localhost` | Non-secret |
| 24 | `DB_POOL_MAX=10` | Non-secret |
| 29 | `ADMIN_EMAIL=` | Blank |
| 30 | `ADMIN_PASSWORD=` | Blank |
| 31 | `ADMIN_NAME=` | Blank |
| 44 | `DEMO_MODE=` | Blank (demo is opt-in and inert by default) |
| 45 | `DEMO_ADMIN_EMAIL=admin@demo.aida.test` | Fictional `.test` address |
| 46 | `DEMO_ADMIN_PASSWORD=aida-demo-2026` | Intentionally-published demo credential (see note) |
| 47 | `DEMO_AGENT_EMAIL=agent@demo.aida.test` | Fictional `.test` address |
| 51 | `UPLOADS_DIR=/data/uploads` | Non-secret |
| 54 | `RATE_LIMIT_PEPPER=replace-me-with-a-random-pepper` | Placeholder (fixed in `4904bdb` to be enforced as mandatory at hash time, not just documented) |
| 59 | `APP_ENCRYPTION_KEY=replace-me-with-a-random-32-byte-base64-key` | Placeholder |

**No live/real secret is present.** The two non-placeholder credential-shaped values are both by design and documented:
- `DEMO_ADMIN_PASSWORD=aida-demo-2026` matches `src/lib/demo/identities.ts:13` (`DEMO_PASSWORD_DEFAULT`) and is published in `docs/OPERATIONS.md:166`. It is inert unless `DEMO_MODE` is exactly `"true"` (`src/lib/demo/bootstrap-demo.ts:14`), which `.env.example:44` and `docker-compose.yml:54` (`${DEMO_MODE:-}`) both leave blank; `.env.example:41-42` and `docker-compose.yml:53` carry explicit "never expose to the internet" warnings.
- `POSTGRES_PASSWORD=aida` is a local-dev default. `docker-compose.yml` gives the `db` service **no** `ports:` mapping (only `caddy` publishes 80/443) and interpolates `${POSTGRES_PASSWORD}` with **no** `:-` fallback, so Postgres is never reachable off the compose network with this value. It is nevertheless the one credential-shaped line lacking a `replace-me` marker — worth a one-word doc nudge, not a security defect.

Also verified: `.env` and `.env.*` are gitignored (`.gitignore:15-17`) and `git ls-files` shows `.env.example` as the only tracked env file.

**(d) → PASS.**

#### Finding

| # | Sev | Area | Location | Description |
|---|---|---|---|---|
| 1 | LOW | Secrets in logs | `prisma/seed.ts:59` (and `:60`; re-emitted at `scripts/capture-demo-assets.ts:739`) | The `pnpm db:seed` CLI prints the demo account password to stdout: `` console.log(`[seed]   Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`) `` where `ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD \|\| DEMO_PASSWORD_DEFAULT` (line 26). When an operator overrides `DEMO_ADMIN_PASSWORD` with a value of their own, that operator-chosen password is written verbatim to stdout — and `scripts/capture-demo-assets.ts:725-739` executes the seed with `encoding: "utf-8"` and then `console.log(seedOutput)`, re-emitting those two credential lines into the capture run's log. The project's own sibling code path proves the intended standard: `src/lib/demo/bootstrap-demo.ts:39-42` deliberately prints only the email and the *phrase* "(password from `DEMO_ADMIN_PASSWORD`, default: the documented demo password)". `docs/SECURITY.md:10` claims secrets are "never logged". **Recorded as F-09 in this report's Findings table — not fixed in this phase (out of approved scope).** |

Mitigations on the record: default value is the publicly documented `aida-demo-2026`; the script is a manual operator CLI, not app runtime (compose never invokes it — `docker-compose.yml` has no seed service); no rendered credential line is committed anywhere in the repo (grep for `\[seed\]\s+Admin:` returns only the source line itself). Suggested fix mirrors the boot path: print the email plus a pointer to `DEMO_ADMIN_PASSWORD`, and print the literal default only when `process.env.DEMO_ADMIN_PASSWORD` is unset.

#### Non-finding observations (recorded, no action required for this sweep)

1. `src/app/(app)/settings/actions.ts:98,161` and `src/app/(app)/settings/email/actions.ts:102,133` return `String((e as Error).message).slice(0, 200)` from Test-Connection. AIDA never interpolates the key into that string; the only residual is that an upstream SDK 401 message can embed a *provider-masked* key fragment, shown to the org admin who supplied the key. Same shape at `src/lib/worker/jobs/insight-run.ts:25` (`error: String(err)` into `InsightRun.error`) and `src/lib/channels/email/poll-inbox.ts:54,83` (`String(err).slice(0,500)` into `EmailIngestFailure.lastError` / `email:lastPollError`).
2. `src/lib/rate-limit/check-rate-limit.ts:4` (at the time of this sweep) fell back to the literal pepper `"aida-default-pepper"` when `RATE_LIMIT_PEPPER` was unset. Confirmed for this sweep: only `sha256(ip + PEPPER)` is persisted (`:7-9,25`), the raw IP is never stored or logged, and the pepper itself is never logged. The weak-default aspect belonged to the rate-limiting sweep — see Critic GAP 3, **fixed in `4904bdb`**.
3. `docker-compose.yml:64,98` pass `APP_ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY:-}` to app and worker; `src/lib/crypto/secret-box.ts:13-23` throws a descriptive error (never a silent no-encryption fallback) when it is missing or not exactly 32 bytes after base64-decode.

---

**VERDICT: FINDING — 1 LOW.** Criteria (a) at-rest encryption, (c) redacted `AuditEvent.input`, and (d) `.env.example` placeholders all **PASS** with no exceptions. Criterion (b) **PASSES completely within the four assigned directories and across all 14 `console.*` sites in `src/`**, but is violated once outside them at `prisma/seed.ts:59-60`, which interpolates the demo admin password (including an operator-supplied `DEMO_ADMIN_PASSWORD` override) into stdout and has it re-emitted by `scripts/capture-demo-assets.ts:739`. Not fixed in this phase (out of approved scope) — recorded as F-09.


### Sweep 4 — Tenant isolation in raw SQL

**Scope:** every `$queryRaw` / `$executeRaw` / `$queryRawUnsafe` / `$executeRawUnsafe` call site under `src/`, at branch `phase-07-wave-4-launch-readiness` @ `89d4600`. `scopedDb(orgId)` injects `organizationId` via Prisma `$extends` **query** hooks only — those hooks never fire for raw SQL, so each statement must carry its own org predicate (AIDA-11).

#### Commands run

```console
$ git log --oneline -1 && git branch --show-current
89d4600 docs(07-08): complete launch-visuals plan — Task 3 approved, Wave 3 done
phase-07-wave-4-launch-readiness
```

```console
$ grep -rn '\$queryRaw\|\$executeRaw' src/
src/generated/prisma/internal/class.ts:129:   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
src/generated/prisma/internal/class.ts:134:  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;
src/generated/prisma/internal/class.ts:141:   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
src/generated/prisma/internal/class.ts:146:  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;
src/generated/prisma/internal/class.ts:152:   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
src/generated/prisma/internal/class.ts:157:  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;
src/generated/prisma/internal/class.ts:164:   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
src/generated/prisma/internal/class.ts:169:  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;
src/generated/prisma/internal/prismaNamespace.ts:2404:      $executeRaw: {
src/generated/prisma/internal/prismaNamespace.ts:2408:      $executeRawUnsafe: {
src/generated/prisma/internal/prismaNamespace.ts:2412:      $queryRaw: {
src/generated/prisma/internal/prismaNamespace.ts:2416:      $queryRawUnsafe: {
src/lib/insight/kb-gap.ts:21:  const rows = await prisma.$queryRaw<NearestKbMatch[]>`
src/lib/insight/sla-csat.ts:4:// (scopedDb does not intercept $queryRaw — 06-RESEARCH.md Pitfall 1). At-risk-only excludes
src/lib/insight/sla-csat.ts:26:    const [row] = await prisma.$queryRaw<DurationRow[]>`
src/lib/insight/sla-csat.ts:34:  const [row] = await prisma.$queryRaw<DurationRow[]>`
src/lib/insight/sla-csat.ts:73:  const [agg] = await prisma.$queryRaw<CsatAggRow[]>`
src/lib/insight/sla-csat.ts:79:  const distRows = await prisma.$queryRaw<CsatDistRow[]>`
src/lib/insight/ticket-embeddings.ts:18: * filter (scopedDb does NOT intercept $queryRaw).
src/lib/insight/ticket-embeddings.ts:25:  return prisma.$queryRaw<PeriodTicket[]>`
src/lib/insight/ticket-embeddings.ts:54:  const rows = await prisma.$queryRaw<TicketEmbeddingRow[]>`
src/lib/insight/ticket-embeddings.ts:94:        await tx.$executeRaw`
src/lib/insight/volume-drivers.ts:3:// filter — scopedDb's groupBy/$queryRaw are NOT auto-scoped (06-RESEARCH.md Pitfall 1), and the
src/lib/insight/volume-drivers.ts:25:  return prisma.$queryRaw<KeyCountRow[]>`
src/lib/insight/volume-drivers.ts:40:  return prisma.$queryRaw<KeyCountRow[]>`
src/lib/insight/volume-drivers.ts:58:  return prisma.$queryRaw<KeyCountRow[]>`
src/lib/rag/retrieve.ts:3:// NOT intercept $queryRaw, so this filter is mandatory, not optional).
src/lib/rag/retrieve.ts:27:  return prisma.$queryRaw<RetrievedChunk[]>`
src/lib/scoped-db.ts:13:// FTS precedent (scopedDb does not intercept $queryRaw).
src/lib/tickets/search.ts:2:// scopedDb does NOT intercept $queryRaw (cross-tenant leak otherwise).
src/lib/tickets/search.ts:18:  return prisma.$queryRaw<TicketSearchRow[]>`
src/lib/worker/jobs/kb-embed-article.ts:63:        await tx.$executeRaw`
src/lib/worker/jobs/sla-flag.ts:8:  await prisma.$executeRaw`
src/lib/worker/jobs/sla-flag.ts:20:  await prisma.$executeRaw`
```

Hits in `src/generated/prisma/**` are the generated Prisma client's own type declarations and JSDoc examples — not call sites. Hand-written call sites: **16 raw statements across 8 files.**

No unsafe variants and no fragment builders exist in hand-written source, so every `${...}` is a bound `$n` placeholder (an `orgId` value can never be smuggled in as SQL):

```console
$ grep -rn 'queryRawUnsafe\|executeRawUnsafe\|queryRawTyped' src/ | grep -v '^src/generated/'
(no output)

$ grep -rn 'Prisma\.raw\|Prisma\.sql\|Prisma\.join\|Prisma\.empty' src/ --include=*.ts --include=*.tsx | grep -v '^src/generated/'
src/lib/insight/sla-csat.ts:24:  // keep the SQL fully parameterized rather than reaching for Prisma.raw for a column name.
```

Mechanical count of raw statements vs. `organizationId` bindings per file:

```console
$ for f in src/lib/tickets/search.ts src/lib/rag/retrieve.ts src/lib/insight/kb-gap.ts \
         src/lib/insight/sla-csat.ts src/lib/insight/ticket-embeddings.ts \
         src/lib/insight/volume-drivers.ts src/lib/worker/jobs/kb-embed-article.ts \
         src/lib/worker/jobs/sla-flag.ts; do
    raw=$(grep -c 'await prisma\.\$queryRaw\|await prisma\.\$executeRaw\|await tx\.\$executeRaw\|return prisma\.\$queryRaw' "$f")
    org=$(grep -c '"organizationId" = ${orgId}\|"organizationId" = ${\|"organizationId",' "$f")
    printf '%-45s rawStmts=%s orgIdOccurrences=%s\n' "$f" "$raw" "$org"; done
src/lib/tickets/search.ts                     rawStmts=1 orgIdOccurrences=1
src/lib/rag/retrieve.ts                       rawStmts=1 orgIdOccurrences=1
src/lib/insight/kb-gap.ts                     rawStmts=1 orgIdOccurrences=1
src/lib/insight/sla-csat.ts                   rawStmts=4 orgIdOccurrences=4
src/lib/insight/ticket-embeddings.ts          rawStmts=3 orgIdOccurrences=3
src/lib/insight/volume-drivers.ts             rawStmts=3 orgIdOccurrences=3
src/lib/worker/jobs/kb-embed-article.ts       rawStmts=1 orgIdOccurrences=1
src/lib/worker/jobs/sla-flag.ts               rawStmts=2 orgIdOccurrences=0
```

15 of 16 statements bind an `organizationId`. The two in `sla-flag.ts` do not — analysed in full below.

#### Per-call-site table (all 16 statements)

| # | Location | Function | Tables touched | Explicit `organizationId` in WHERE? | `orgId` provenance | Verdict |
|---|---|---|---|---|---|---|
| 1 | `src/lib/tickets/search.ts:18` | `searchTickets` | `Ticket`, `Message` | **Yes** — `WHERE t."organizationId" = ${orgId}`; `Message` reached only via correlated `m."ticketId" = t.id` | `list-query.ts:109` `searchTickets(ctx.orgId, …)` ← `ticket-list-panel.tsx:26` `const { db, orgId, session } = await getScopedDb()` | PASS |
| 2 | `src/lib/rag/retrieve.ts:27` | `retrieveRelevantChunks` | `KbChunk`, `KbArticle` | **Yes** — `WHERE c."organizationId" = ${orgId} AND c."embeddingModel" = ${embeddingModel}`; `KbArticle` joined by `a.id = c."articleId"` | `generate-draft.ts:56` ← `generateDraftReply(orgId, ticketId)` ← `tickets/[id]/actions.ts:140` `const { orgId } = await getScopedDb()` | PASS |
| 3 | `src/lib/insight/kb-gap.ts:21` | `nearestKbChunk` | `KbChunk`, `KbArticle` | **Yes** — `WHERE c."organizationId" = ${orgId} AND c."embeddingModel" = ${embeddingModel}` | `run-insight.ts:179` with `orgId = run.organizationId` (`run-insight.ts:60`, read off the `InsightRun` row itself) | PASS |
| 4 | `src/lib/insight/sla-csat.ts:26` | `avgDurationSeconds` (firstRespondedAt) | `Ticket` | **Yes** — `WHERE "organizationId" = ${orgId} AND "createdAt" >= ${start} AND "createdAt" < ${end}` | `run-insight.ts:68` ← `orgId = run.organizationId` | PASS |
| 5 | `src/lib/insight/sla-csat.ts:34` | `avgDurationSeconds` (resolvedAt) | `Ticket` | **Yes** — same predicate as #4 | `run-insight.ts:69` ← `orgId = run.organizationId` | PASS |
| 6 | `src/lib/insight/sla-csat.ts:73` | `computeSlaCsat` (CSAT agg) | `CsatResponse`, `Ticket` | **Yes** — `WHERE cr."organizationId" = ${orgId} AND t."createdAt" >= … < …`; driving table filtered, `Ticket` reached by FK `t.id = cr."ticketId"` | `run-insight.ts:74` ← `orgId = run.organizationId` | PASS |
| 7 | `src/lib/insight/sla-csat.ts:79` | `computeSlaCsat` (CSAT distribution) | `CsatResponse`, `Ticket` | **Yes** — same predicate as #6, `GROUP BY cr.score` | `run-insight.ts:74` ← `orgId = run.organizationId` | PASS |
| 8 | `src/lib/insight/ticket-embeddings.ts:25` | `readPeriodTickets` | `Ticket`, `Message` | **Yes** — `WHERE t."organizationId" = ${orgId} AND t."createdAt" >= … < …`; `Message` only in a correlated subquery on `m."ticketId" = t.id` | `run-insight.ts:85` ← `orgId = run.organizationId` | PASS |
| 9 | `src/lib/insight/ticket-embeddings.ts:54` | `readCachedEmbeddings` | `TicketEmbedding`, `Ticket` | **Yes** — `WHERE te."organizationId" = ${orgId} AND te."embeddingModel" = … AND t."createdAt" …` | `run-insight.ts:101` / `:114` ← `orgId = run.organizationId` | PASS |
| 10 | `src/lib/insight/ticket-embeddings.ts:94` | `writeNewEmbeddings` (INSERT) | `TicketEmbedding` | **Yes (write)** — `INSERT INTO "TicketEmbedding" ("id","organizationId",…) VALUES (${id}, ${orgId}, …) ON CONFLICT … DO NOTHING` | `run-insight.ts:110` ← `orgId = run.organizationId` | PASS |
| 11 | `src/lib/insight/volume-drivers.ts:25` | `categoryCounts` | `Ticket` | **Yes** — `WHERE "organizationId" = ${orgId} AND "createdAt" >= ${start} AND "createdAt" < ${end}` | `run-insight.ts:67` ← `orgId = run.organizationId` | PASS |
| 12 | `src/lib/insight/volume-drivers.ts:40` | `tagCounts` | `TicketTag`, `Tag`, `Ticket` | **Equivalent org-scoped join** — `WHERE tk."organizationId" = ${orgId} AND tk."createdAt" …`; `TicketTag` has no `organizationId` by design, so scoping rides the `Ticket` join. Verified sound: the only write path `addTag` (`tickets/[id]/actions.ts:221-229`) resolves the `Tag` through `db.tag.findFirst` / `db.tag.create` on `scopedDb`, so a `TicketTag` row can never link a ticket to another org's tag | `run-insight.ts:67` ← `orgId = run.organizationId` | PASS |
| 13 | `src/lib/insight/volume-drivers.ts:58` | `companyCounts` | `Ticket`, `Contact` | **Yes** — `WHERE tk."organizationId" = ${orgId} AND tk."createdAt" …`; `Contact` reached by FK `c.id = tk."contactId"`, and `findOrCreateContact` (`src/lib/contacts/find-or-create-contact.ts:26,43`) only ever resolves/creates through `scopedDb`, so `contactId` is always same-org | `run-insight.ts:67` ← `orgId = run.organizationId` | PASS |
| 14 | `src/lib/worker/jobs/kb-embed-article.ts:63` | `kbEmbedArticleHandler` (INSERT) | `KbChunk` | **Yes (write)** — `INSERT INTO "KbChunk" ("id","organizationId",…) VALUES (${id}, ${article.organizationId}, …)` | Not caller-supplied: derived from the loaded `KbArticle` row (`:21`, `:24`). Job payload carries only `articleId`, so a forged payload embeds an article into **its own** org, never across | PASS |
| 15 | `src/lib/worker/jobs/sla-flag.ts:8` | `slaFlagHandler` pass 1 (breach) | `Ticket` | **No** — `UPDATE "Ticket" SET "isBreached"=true,"isAtRisk"=true WHERE "isBreached"=false AND status NOT IN ('RESOLVED','CLOSED') AND (("firstRespondedAt" IS NULL AND "firstResponseDueAt" < ${now}) OR ("resolvedAt" IS NULL AND "resolutionDueAt" < ${now}))` | No `orgId` parameter exists — handler signature is `slaFlagHandler(_data?: unknown)`, scheduled by the worker as a system cron `boss.schedule("sla-flag", "*/5 * * * *", {})` (`src/lib/worker/index.ts:32-36`) | FINDING (LOW) |
| 16 | `src/lib/worker/jobs/sla-flag.ts:20` | `slaFlagHandler` pass 2 (at-risk) | `Ticket` | **No** — `UPDATE "Ticket" SET "isAtRisk"=true WHERE "isAtRisk"=false AND status NOT IN ('RESOLVED','CLOSED') AND (("firstRespondedAt" IS NULL AND "firstResponseDueAt" > ${now} AND "firstResponseDueAt" - ${now} <= ("firstResponseTargetMinutes" * 0.2) * interval '1 minute') OR ("resolvedAt" IS NULL AND "resolutionDueAt" > ${now} AND "resolutionDueAt" - ${now} <= ("resolutionTargetMinutes" * 0.2) * interval '1 minute'))` | Same as #15 — no org input at all | FINDING (LOW) |

#### Provenance verification (orgId is session-bound, never caller-trusted)

Three distinct entry paths feed the 14 org-filtered statements; none accepts an `orgId` from client input:

```console
$ grep -rn 'fetchTicketList' src/ | grep -v 'list-query.ts'
src/app/(app)/tickets/ticket-list-panel.tsx:30:    fetchTicketList(filters, { db, orgId, userId: session.user.id }),
# ticket-list-panel.tsx:26 →  const { db, orgId, session } = await getScopedDb();

$ grep -rn 'generateDraftReply' src/ | grep -v 'generate-draft.ts'
src/app/(app)/tickets/[id]/actions.ts:137:export async function generateDraftReply(ticketId: string)
# actions.ts:140 →  const { orgId } = await getScopedDb();
# actions.ts:143 →  const draft = await runGenerateDraft(orgId, ticketId);
# NOTE: the Server Action takes ONLY ticketId — orgId is never in the client-controlled signature.

$ grep -rn 'runInsight\|insightRun.create' src/ | grep -v generated
src/app/(app)/insights/actions.ts:26:  const run = await db.insightRun.create({   # db from getScopedDb() at actions.ts:13
src/lib/insight/run-insight.ts:56:export async function runInsight(insightRunId: string)
src/lib/worker/jobs/insight-run.ts:17:    await runInsight(run.id);
# run-insight.ts:57-61 → const run = await prisma.insightRun.findUnique({ where: { id: insightRunId } });
#                        const orgId = run.organizationId;
```

`getScopedDb()` (`src/lib/session.ts:38-43`) calls `requireSession()` and reads `session.session.activeOrganizationId`, throwing when absent. The insight worker never receives an `orgId` on the wire — its payload is `{ insightRunId }`, and the org is read back off the `InsightRun` row, which was created through the org-scoped client. All 10 insight statements therefore inherit an org that a job-queue payload cannot forge into another tenant's data.

#### Analysis of the two unfiltered statements (`sla-flag.ts`)

This is the single deviation from the "every raw statement filters `organizationId`" invariant, and it is **not a cross-tenant data path**:

- It is a **system cron**, not a user-reachable entry point: registered at `src/lib/worker/index.ts:32-36` with `boss.schedule("sla-flag", "*/5 * * * *", {})`; the handler signature `slaFlagHandler(_data?: unknown)` ignores its payload entirely, so there is no `orgId` to pass unchecked or to tamper with.
- Both statements are **writes with no result set** — nothing is returned to any request, so no tenant can observe another tenant's rows through them.
- Every predicate column is **row-local** (`isBreached`, `isAtRisk`, `status`, `firstRespondedAt`, `firstResponseDueAt`, `firstResponseTargetMinutes`, `resolvedAt`, `resolutionDueAt`, `resolutionTargetMinutes`, all denormalised onto `Ticket`). Org A's data can never influence the flag computed for an org B row; the update is mathematically identical to running the same statement once per org.
- The whole-table shape is **deliberate and documented** in `.planning/phases/02-core-ticketing/02-RESEARCH.md:508`: *"keeping the scan cheap (two set-based `UPDATE`s over the whole `Ticket` table, no per-tenant loop)"*.

It is recorded as LOW rather than HIGH because it cannot leak or corrupt data across tenants; it is recorded at all because it is the one raw statement a future reader could copy as precedent without noticing that its safety rests on the predicate being row-local, not on an org filter. The suggested remedy is a one-line comment at `src/lib/worker/jobs/sla-flag.ts:4` stating that the cross-org scope is intentional — no code change. Not fixed in this phase (out of approved scope) — recorded as F-13.

#### Out-of-scope raw SQL noted for completeness

```console
$ grep -rn 'queryRaw\|executeRaw' --include=*.ts --include=*.tsx . \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=worktrees \
    | grep -v 'src/generated/' | grep -v '^./src/lib/'
./tests/e2e/phase4-ai.spec.ts:154   $queryRawUnsafe — count of applied _prisma_migrations rows
./tests/e2e/phase4-ai.spec.ts:161   $queryRawUnsafe — "SELECT name FROM pgboss.queue"
./tests/integration/draft-generation.test.ts:88   $executeRaw — test fixture vector insert
./tests/integration/insight-run.test.ts:64        $executeRaw — test fixture vector insert
./tests/integration/kb-embed.test.ts:52           $queryRaw  — asserts KbChunk dims + organizationId
(plus ./dist/worker-verify.mjs — the esbuild worker bundle, i.e. generated output of the src/ files above)
```

The two `*Unsafe` calls are test-only, use static literal SQL with no interpolation, and touch infrastructure tables (`_prisma_migrations`, `pgboss.queue`) that hold no tenant data. `.claude/worktrees/**` copies were excluded as stale agent scratch checkouts, not shipped source.

#### Verdict

**FINDING — 1 LOW.** All 14 raw statements that read or write tenant data on behalf of a user carry an explicit `organizationId` predicate (or an equivalent org-scoped join proven sound at every write path), and in every case the bound `orgId` traces back to `getScopedDb()` → `requireSession()` or to a row's own `organizationId` — never to a client-supplied argument. The only unfiltered statements are the two set-based `UPDATE`s in the `sla-flag` system cron, which return no rows and compute purely row-local flags; they are a documented deliberate design, not a cross-tenant leak. **No HIGH or MEDIUM issue found; nothing here blocks launch. Not fixed in this phase (out of approved scope).**


### Sweep 5 — Network egress

**Scope:** every outbound network call site in the AIDA application, classified by destination; plus `package.json` dependency phone-home behaviour and `next.config.ts` external image domains / remote fonts.
**Branch / commit:** `phase-07-wave-4-launch-readiness` @ `89d4600`. Read-only audit — no repository file was modified.

---

#### 5.1 The mandated grep

```console
$ git log --oneline -1 && git branch --show-current
89d4600 docs(07-08): complete launch-visuals plan — Task 3 approved, Wave 3 done
phase-07-wave-4-launch-readiness

$ grep -rn "fetch(\|axios\|got(\|new OpenAI\|new Anthropic\|Ollama(\|createTransport\|ImapFlow" src/ --include=*.ts
src/app/api/tickets/[id]/messages/route.ts:18:  // rather than letting a raw redirect response reach the composer's fetch() call.
src/lib/channels/email/imap-client.ts:1:import { ImapFlow } from "imapflow";
src/lib/channels/email/imap-client.ts:4: * Thin ImapFlow factory from decrypted EmailSettings (D-01). Worker-bundleable —
src/lib/channels/email/imap-client.ts:20:): ImapFlow {
src/lib/channels/email/imap-client.ts:21:  return new ImapFlow({
src/lib/channels/email/smtp-client.ts:23:  return nodemailer.createTransport({
src/lib/llm/complete.ts:39:      output = await completeOllama({ baseUrl: s.ollamaBaseUrl, ...base });
src/lib/llm/providers/anthropic.ts:21:  const client = new Anthropic({ apiKey: params.apiKey, timeout: 30_000, maxRetries: 0 });
src/lib/llm/providers/ollama.ts:25:  const client = new Ollama({ host: params.baseUrl });
src/lib/llm/providers/openai.ts:20:  const client = new OpenAI({ apiKey: params.apiKey, timeout: 30_000, maxRetries: 0 });
src/lib/llm/test-connection.ts:21:      const client = new OpenAI({ apiKey: config.apiKey, timeout: 10_000, maxRetries: 0 });
src/lib/llm/test-connection.ts:26:      const client = new Anthropic({ apiKey: config.apiKey, timeout: 10_000, maxRetries: 0 });
src/lib/llm/test-connection.ts:31:      const client = new Ollama({ host: config.ollamaBaseUrl });
src/lib/rag/embed-test-connection.ts:22:      const client = new OpenAI({ apiKey: config.apiKey, timeout: 10_000, maxRetries: 0 });
src/lib/rag/embed-test-connection.ts:27:      const client = new Ollama({ host: config.ollamaBaseUrl });
src/lib/rag/embed.ts:28:      embeddings = await embedOllama({ baseUrl: r.ollamaBaseUrl, model: r.model, input: texts });
src/lib/rag/providers/ollama-embed.ts:11:export async function embedOllama(params: EmbedOllamaParams): Promise<number[][]> {
src/lib/rag/providers/ollama-embed.ts:12:  const client = new Ollama({ host: params.baseUrl });
src/lib/rag/providers/openai-embed.ts:14:  const client = new OpenAI({ apiKey: params.apiKey, timeout: 30_000, maxRetries: 0 });
```

The mandated grep only covers `*.ts`, so it misses browser-side `fetch()` in React components. Widened for completeness:

```console
$ grep -rn "fetch(\|axios\|got(\|new OpenAI\|new Anthropic\|Ollama(\|createTransport\|ImapFlow\|XMLHttpRequest\|WebSocket\|navigator.sendBeacon\|EventSource" src/ --include=*.tsx --include=*.jsx --include=*.js --include=*.mjs
src/app/(public)/request/request-form.tsx:91:    const res = await fetch("/api/public/intake", { method: "POST", body });
src/app/(public)/status/[token]/csat-form.tsx:47:      const res = await fetch(`/api/public/status/${token}/csat`, {
src/app/(public)/status/[token]/follow-up-form.tsx:68:      const res = await fetch(`/api/public/status/${token}/follow-up`, {
src/components/tickets/composer.tsx:83:      const res = await fetch(`/api/tickets/${ticketId}/messages`, { method: "POST", body: form });
```

Every literal URL anywhere in `src/` (ripgrep, `-o`, whole tree):

```console
$ rg -o "https?://[^\s\"'`)]+" src/
src\app\(app)\settings\llm-provider-form.tsx:272:http://localhost:11434
src\app\(app)\settings\embedding-provider-form.tsx:275:http://localhost:11434
src\lib\demo\fixtures.ts:1184:https://api.huddlebase.example/v1/tickets/export?format=csv&status=RESOLVED
```

Three hits, none of them call sites: two are `placeholder=` strings on the Ollama base-URL inputs, one is inert prose inside a demo KB article (fictional `.example` TLD).

---

#### 5.2 Complete call-site enumeration

Every site is listed — nothing summarised as "etc.".

| # | Location | Construct | Destination | Classification |
|---|---|---|---|---|
| 1 | `src/lib/llm/providers/openai.ts:20` | `new OpenAI({apiKey})` → `chat.completions.parse()` | `api.openai.com` (SDK default; no `baseURL` passed) | Operator-configured LLM endpoint |
| 2 | `src/lib/llm/providers/anthropic.ts:21` | `new Anthropic({apiKey})` → `messages.parse()` | `api.anthropic.com` (SDK default) | Operator-configured LLM endpoint |
| 3 | `src/lib/llm/providers/ollama.ts:25` | `new Ollama({host: params.baseUrl})` → `chat()` | `Setting["llm:ollamaBaseUrl"]` | Operator-configured LLM base URL |
| 4 | `src/lib/llm/complete.ts:39` | dispatch → `completeOllama({baseUrl: s.ollamaBaseUrl})` | same as #3 | Operator-configured LLM base URL |
| 5 | `src/lib/llm/test-connection.ts:21` | `new OpenAI(...)` → `models.list()` | `api.openai.com` | Operator-configured LLM endpoint |
| 6 | `src/lib/llm/test-connection.ts:26` | `new Anthropic(...)` → `models.list()` | `api.anthropic.com` | Operator-configured LLM endpoint |
| 7 | `src/lib/llm/test-connection.ts:31` | `new Ollama({host: config.ollamaBaseUrl})` → `list()` | `Setting["llm:ollamaBaseUrl"]` | Operator-configured LLM base URL |
| 8 | `src/lib/rag/embed-test-connection.ts:22` | `new OpenAI(...)` → `embeddings.create()` | `api.openai.com` | Operator-configured LLM endpoint |
| 9 | `src/lib/rag/embed-test-connection.ts:27` | `new Ollama({host: config.ollamaBaseUrl})` → `embed()` | `Setting["llm:embeddingOllamaBaseUrl"]` | Operator-configured LLM base URL |
| 10 | `src/lib/rag/embed.ts:28` | dispatch → `embedOllama({baseUrl: r.ollamaBaseUrl})` | same as #9 | Operator-configured LLM base URL |
| 11 | `src/lib/rag/providers/ollama-embed.ts:12` | `new Ollama({host: params.baseUrl})` → `embed()` | operator Setting | Operator-configured LLM base URL |
| 12 | `src/lib/rag/providers/openai-embed.ts:14` | `new OpenAI({apiKey})` → `embeddings.create()` | `api.openai.com` | Operator-configured LLM endpoint |
| 13 | `src/lib/channels/email/imap-client.ts:21` | `new ImapFlow({host: s.imapHost, port, secure, auth})` | operator `EmailSettings.imapHost` (decrypted at use) | Operator-configured IMAP host |
| 14 | `src/lib/channels/email/smtp-client.ts:23` | `nodemailer.createTransport({host: s.smtpHost, ...})` | operator `EmailSettings.smtpHost` | Operator-configured SMTP host |
| 15 | `src/app/api/tickets/[id]/messages/route.ts:18` | the token `fetch()` inside a `//` comment | — | **Not a call site** (grep artefact) |
| 16 | `src/app/(public)/request/request-form.tsx:91` | `fetch("/api/public/intake")` | relative path | Same-origin |
| 17 | `src/app/(public)/status/[token]/csat-form.tsx:47` | `fetch(\`/api/public/status/${token}/csat\`)` | relative path | Same-origin |
| 18 | `src/app/(public)/status/[token]/follow-up-form.tsx:68` | `fetch(\`/api/public/status/${token}/follow-up\`)` | relative path | Same-origin |
| 19 | `src/components/tickets/composer.tsx:83` | `fetch(\`/api/tickets/${ticketId}/messages\`)` | relative path | Same-origin |
| 20 | `src/lib/auth-client.ts:5` | `createAuthClient({ baseURL: process.env.NEXT_PUBLIC_APP_URL })` | the operator's own public URL | Same-origin |

**No fourth category exists.** There is no call site in `src/` whose destination is a hardcoded third-party host — no telemetry, analytics, CDN, or error-reporting endpoint.

Base URLs are genuinely operator-owned, not defaulted to some vendor host:

```console
$ grep -rn "ollamaBaseUrl" src/lib/llm/settings.ts src/lib/rag/settings.ts
src/lib/llm/settings.ts:15:  ollamaBaseUrl: "llm:ollamaBaseUrl",
src/lib/llm/settings.ts:71:    ollamaBaseUrl: map.get(LLM_SETTING_KEYS.ollamaBaseUrl) ?? "",
src/lib/rag/settings.ts:17:  ollamaBaseUrl: "llm:embeddingOllamaBaseUrl",
src/lib/rag/settings.ts:83:    ollamaBaseUrl: map.get(EMBEDDING_SETTING_KEYS.ollamaBaseUrl) ?? "",
```

The fallback is `""` (empty), never a host. For OpenAI/Anthropic the destination is the SDK's own default vendor API host, reached only because the operator explicitly selected that provider and supplied their own key — the honest classification is "operator-selected vendor endpoint". Side note (not a defect): no `baseURL` override is exposed, so an operator cannot currently point AIDA at an OpenAI-compatible proxy.

Test/tooling call sites outside `src/` (never shipped): `tests/e2e/global-setup.ts:53,139,175` and `tests/e2e/phase4-ai.spec.ts:151` hit `http://localhost:3100`; `scripts/capture-demo-assets.ts:96` hits the locally spawned server. All localhost.

---

#### 5.3 `next.config.ts` — external image domains and remote fonts

```console
$ cat next.config.ts
import type { NextConfig } from "next";
import { MAX_TOTAL_REQUEST_BYTES } from "./src/lib/attachments/constants";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: MAX_TOTAL_REQUEST_BYTES,
  },
};

export default nextConfig;

$ grep -n "images\|remotePatterns\|domains" next.config.ts
(exit 1 — no matches)

$ grep -rn 'next/image' src/
src/proxy.ts:29:export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

- **External image domains: NONE.** There is no `images` key at all, so `images.domains` / `images.remotePatterns` are empty and Next's Image Optimizer cannot fetch a remote origin. The single `next/image` textual hit is the proxy matcher's exclusion string, not a component usage — there are zero `<Image>` usages in the app.
- **Remote fonts: ONE, build-time.**

```console
$ grep -rn "next/font\|fonts.googleapis\|fonts.gstatic\|cdn\.\|unpkg\|jsdelivr\|<script src\|<link rel=\"stylesheet\"\|@import url(" src/ public/
src/app/layout.tsx:2:import { Inter } from "next/font/google";

$ ls node_modules/next/dist/compiled/@next/font/dist/google/
fetch-css-from-google-fonts.js   fetch-font-file.js   fetch-resource.js   find-font-files-in-css.js   font-data.json ...

$ grep -rhoE "fonts\.(googleapis|gstatic)\.com" node_modules/next/dist/compiled/@next/font/dist/google/*.js | sort -u
fonts.googleapis.com
fonts.gstatic.com
```

`public/` contains only `.gitkeep`; there is no `<script src>`, `<link rel="stylesheet">`, `@import url()`, or cdn/unpkg/jsdelivr reference anywhere in `src/` or `public/`. See **F-5.1**.

---

#### 5.4 `package.json` dependency phone-home audit

```console
$ grep -inE 'sentry|posthog|datadog|segment|mixpanel|amplitude|plausible|umami|google-analytics|@vercel/analytics|newrelic|bugsnag|rollbar|logrocket|hotjar|fullstory' package.json
(exit 1 — none)

$ grep -rn "TELEMETRY\|CHECKPOINT_DISABLE\|DO_NOT_TRACK\|telemetry" Dockerfile docker-compose.yml .env.example next.config.ts
(exit 1 — none)

$ grep -rn "telemetry" src/
(exit 1 — none)
```

| Dependency | Phone-home present? | Endpoint | Default | Reachable in AIDA? |
|---|---|---|---|---|
| `next@16.2.9` | **Yes** | `https://telemetry.nextjs.org/api/v1/record` | **ON** (`storage.js:293` → `true` unless `NEXT_TELEMETRY_DISABLED`) | **Yes at build/dev**; NO at runtime (`start-server.js:353 if (isDev)`) → **F-5.2** |
| `prisma@7.8.0` (CLI) | **Yes** | `https://checkpoint.prisma.io` | **ON** (only `CHECKPOINT_DISABLE` suppresses) | **Yes** — `Dockerfile:25` and the compose `migrate` service on every `up` → **F-5.3** |
| `@prisma/client@7.8.0`, `@prisma/adapter-pg@7.8.0` | No | — | — | `grep -Rl -F "checkpoint.prisma.io"` → exit 1. Runtime containers clean. |
| `better-auth@1.6.22` | Code path exists (`@better-auth/telemetry`) | **No hardcoded endpoint** — `ENV.BETTER_AUTH_TELEMETRY_ENDPOINT`; returns `{publish: noop}` when unset | **OFF** (`options.telemetry?.enabled ?? false`, `BETTER_AUTH_TELEMETRY` default `false`) | **No.** `src/lib/auth.ts` sets no `telemetry` option; no `BETTER_AUTH_TELEMETRY*` in `.env.example` or compose. Doubly inert. |
| `openai@6.45.0` | No telemetry | `api.openai.com` default; `auth.openai.com/oauth`, `management.azure.com`, `*.azure.openai.com` present for the Azure/OAuth helpers | — | Vendor API only. `grep` for `AzureOpenAI\|baseURL\|OPENAI_BASE_URL` in `src/` → only `src/lib/auth-client.ts:5` (own origin). |
| `@anthropic-ai/sdk@0.110.0` | No telemetry | `api.anthropic.com` default; all other hosts are docs/GitHub links in comments | — | Vendor API only. |
| `ollama@0.6.3` | **Hardcoded `ollama.com`** in `src/browser.ts:352` (`/api/web_search`) and `:368` (`/api/web_fetch`), plus an `OLLAMA_API_KEY` auto-attach when `hostname === 'ollama.com'` (`src/utils.ts:168-184`) | `https://ollama.com/api/*` | — | **No.** Reachable only via `client.webSearch()` / `client.webFetch()`; `grep -rn "webSearch\|webFetch" src/` → no matches. AIDA calls only `chat()`, `embed()`, `list()` with an explicit operator `host`. Latent, not reachable. |
| `nodemailer@9.0.3` | `api.nodemailer.com` / `ethereal.email` (`createTestAccount`), `accounts.google.com` + `mail.google.com` (`lib/xoauth2/index.js`) | — | — | **No.** `createSmtpTransport` uses plain `auth:{user,pass}`; `grep -rn "createTestAccount\|OAuth2\|xoauth2" src/` → no matches. |
| `imapflow@1.4.6` | No | Only `example.com`, `proxy.example.com`, `getpino.io`, `tools.ietf.org`, `www.iana.org` in docs/comments | — | No. |
| `shadcn@^4.12.0` | CLI contacts `ui.shadcn.com` registry when invoked | — | — | Never imported by app code, never invoked by any `package.json` script. Observation: it sits in `dependencies` rather than `devDependencies` (image bloat / supply-chain surface), not egress. |
| `@playwright/test`, `testcontainers`, `@testcontainers/postgresql` | Browser/image downloads at install & test time | — | — | devDependencies only; not in the runtime image. |
| Analytics / RUM / error-reporting SDKs | **None** | — | — | Grep above returns nothing. |

Infra egress (not `package.json`, listed for completeness): `Caddyfile` uses `{$DOMAIN:localhost}` — a real `DOMAIN` triggers Let's Encrypt ACME (operator-configured, documented in the Caddyfile header); `docker-compose.yml` pulls `pgvector/pgvector:pg16`, `caddy:2`, and `node:22-alpine` from Docker Hub at install time (operator-visible).

---

#### 5.5 Findings

| ID | Severity | Area | Location |
|---|---|---|---|
| F-5.1 | MEDIUM | Build-time third-party CDN — `next/font/google` downloads Inter from `fonts.googleapis.com` + `fonts.gstatic.com` during `next build`, which `docker compose up` runs on the operator's own host. Self-hosted into `.next/static/media` afterwards, so **zero runtime egress**; impact is builder-IP exposure to Google and a broken air-gapped build. *Grading note: the sweep rubric's literal wording ("hardcoded third-party CDN = HIGH") would grade this HIGH; graded MEDIUM here because it was empirically confirmed build-time-only with no data exposure.* | `src/app/layout.tsx:2` |
| F-5.2 | MEDIUM | Next.js build/dev telemetry to `https://telemetry.nextjs.org/api/v1/record` is on by default and `NEXT_TELEMETRY_DISABLED` is set nowhere in `Dockerfile` / `docker-compose.yml` / `.env.example`. Production runtime (`node server.js`) is unaffected (`if (isDev)` guard). No ticket data in the payload. | `Dockerfile:27` |
| F-5.3 | MEDIUM | Prisma CLI checkpoint to `https://checkpoint.prisma.io` fires for every subcommand and is gated only by `CHECKPOINT_DISABLE`, set nowhere. Hits at build (`Dockerfile:25 pnpm prisma generate`) **and recurrently at runtime** — the compose `migrate` service runs `pnpm prisma migrate deploy` on every `docker compose up`. Payload is `project_hash`, schema providers/preview-features, command string, `cli_path`. Prisma runtime packages are clean. | `docker-compose.yml:24` |
| F-5.4 | LOW | No Content-Security-Policy anywhere (`next.config.ts` has no `headers()`, `src/` sets none, Caddyfile adds none) → no browser-enforced `connect-src`. Defense-in-depth only; every client fetch found is same-origin. | `next.config.ts:4` |

None of F-5.1 through F-5.4 were in the maintainer's approved-fixes list for this plan — all recorded as known issues (see Known issues F-14, F-15).

---

#### 5.6 Residual risk — explicit statement

**Static analysis cannot prove the absence of vendor-SDK-internal telemetry.** This sweep verified what the source tree calls and what host literals exist in the installed dependency code. It cannot rule out that `openai`, `@anthropic-ai/sdk`, `ollama`, `nodemailer`, `imapflow`, `better-auth`, `pg-boss`, or a transitive dependency performs an outbound request via a dynamically constructed URL, an obfuscated/minified literal, a native addon, or a server-side redirect — nor can it prove what an LLM vendor does with a request once it arrives. Equally, no build was produced in this session (`.next/` is absent), so the self-hosting behaviour of `next/font/google` was verified from the loader source rather than from a built artefact.

**Human verification item (carry forward — see Human verification items #1):** run the stack under a network monitor — e.g. `docker compose up` behind a default-deny egress firewall, or `tcpdump`/mitmproxy on the app + worker containers — exercise login, ticket create/reply, AI triage, AI draft, Insight, and email poll/send, and confirm the only destinations observed are the operator's Postgres, the operator's configured LLM base URL, and the operator's configured SMTP/IMAP hosts. Additionally confirm on a built image that the served HTML references only `/_next/static/media/*` for fonts and never `fonts.gstatic.com`.

---

**VERDICT: FINDING** — no hardcoded third-party host is called from application source (all 20 call sites are operator-configured LLM/SMTP/IMAP or same-origin, and there is no analytics, error-reporting, or RUM SDK anywhere), but four issues stand: three third-party build/deploy-path egress points that the privacy-first posture should close (**F-5.1** Google Fonts at build, **F-5.2** Next telemetry, **F-5.3** Prisma checkpoint on every `docker compose up`), plus **F-5.4** the absent CSP `connect-src`. All are one-line fixes (`next/font/local`; `ENV NEXT_TELEMETRY_DISABLED=1`; `ENV CHECKPOINT_DISABLE=1`; a `headers()` block) but none was in the maintainer's approved-fixes list for this plan, so none was applied here.


### Sweep 6 — Phase 7's own new surfaces

**Scope:** branch `phase-07-wave-4-launch-readiness` @ `89d46005066e191095650c12a9ebdb968589dc78`. Read-only audit; working tree verified clean before and after (`git status --porcelain` → empty).

---

#### 6.1 `src/app/(app)/settings/branding/actions.ts` begins with `await requireOrgAdmin()`

```
$ sed -n '13,18p' "src/app/(app)/settings/branding/actions.ts"
export async function saveBranding(input: {
  workspaceName: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();
```

`requireOrgAdmin()` is imported at line 4 from `@/lib/authz` and is literally the first statement of the function body (line 16), ahead of `getScopedDb()` (line 17). `saveBranding` is the only exported action in the file. **PASS.**

For completeness, every mutating Settings Server Action in the tree was enumerated:

```
$ rg -n "requireOrgAdmin|getScopedDb|^export async function" "src/app/(app)/settings/**/actions.ts"
settings/actions.ts:21  setAiEnabled            -> :22 getScopedDb()      <-- NO requireOrgAdmin()
settings/actions.ts:57  saveLlmSettings         -> :58 requireOrgAdmin()
settings/actions.ts:81  testLlmConnection       -> :84 requireOrgAdmin()
settings/actions.ts:118 saveEmbeddingSettings   -> :121 requireOrgAdmin()
settings/actions.ts:144 testEmbeddingConnection -> :147 requireOrgAdmin()
settings/actions.ts:170 reembedAllKb            -> :171 requireOrgAdmin()
settings/branding/actions.ts:13      saveBranding       -> :16 requireOrgAdmin()
settings/custom-fields/actions.ts:25 createCustomField  -> :28 requireOrgAdmin()
settings/custom-fields/actions.ts:55 updateCustomField  -> :59 requireOrgAdmin()
settings/custom-fields/actions.ts:83 deleteCustomField  -> :84 requireOrgAdmin()
settings/tags/actions.ts:10  renameTag              -> :11 requireOrgAdmin()
settings/tags/actions.ts:27  deleteTag              -> :28 requireOrgAdmin()
settings/sla/actions.ts:21   saveSlaTargets         -> :22 requireOrgAdmin()
settings/email/actions.ts:33 saveEmailSettings      -> :34 requireOrgAdmin()
settings/email/actions.ts:59 setEmailChannelEnabled -> :60 requireOrgAdmin()
settings/email/actions.ts:78 testImapConnection     -> :81 requireOrgAdmin()
settings/email/actions.ts:110 testSmtpConnection    -> :113 requireOrgAdmin()
```

15 of 16 gate correctly; `setAiEnabled` does not — see **Finding 3** (out of this sweep's scope, Phase 4 surface, reported because it was found here). **Fixed in `9cf38f4`** — see Sweep 1 / Fixed in phase.

---

#### 6.2 `src/lib/demo/bootstrap-demo.ts` — strict gate, loud warning, no password value

```
$ sed -n '13,20p' src/lib/demo/bootstrap-demo.ts
export async function bootstrapDemoMode(): Promise<void> {
  if (process.env.DEMO_MODE !== "true") return;

  // Logged before anything else so the warning appears even if seeding below fails.
  console.warn(
    "[demo] DEMO MODE IS ACTIVE. This instance auto-creates accounts with PUBLICLY DOCUMENTED credentials and loads fictional data. Never expose it to the internet or use it for real tickets.",
  );
```

- STRICT `!==` comparison against the string `"true"`, and it is the first statement of the function body (line 14). **PASS.**
- Warning contains the exact phrase `PUBLICLY DOCUMENTED credentials`, emitted via `console.warn` before any DB work, so it survives a later seed failure. **PASS.**
- Password print check:

```
$ grep -n -i "password" src/lib/demo/bootstrap-demo.ts
40:      "[demo] Sign in at / with %s (password from DEMO_ADMIN_PASSWORD, default: the documented demo password).",
```

The single hit is a literal format string; the only `%s` argument is `adminEmail` (line 41). No password variable is ever interpolated or logged. **PASS.**

Call-site confinement — the only importer is the Node-runtime instrumentation hook, and the module is imported lazily so demo fixtures never load in a normal boot:

```
$ cat src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapFromEnv } = await import("@/lib/bootstrap");
    await bootstrapFromEnv();
    // Demo mode is a no-op unless DEMO_MODE === "true"; imported lazily so the demo
    // fixtures never load in a normal production boot.
    const { bootstrapDemoMode } = await import("@/lib/demo/bootstrap-demo");
    await bootstrapDemoMode();
  }
}
```

---

#### 6.3 `.env.example` ships `DEMO_MODE=` blank

```
$ grep -n "DEMO" .env.example
34:# Set DEMO_MODE=true on a FRESH database to auto-create a demo workspace and load a
44:DEMO_MODE=
45:DEMO_ADMIN_EMAIL=admin@demo.aida.test
46:DEMO_ADMIN_PASSWORD=aida-demo-2026
47:DEMO_AGENT_EMAIL=agent@demo.aida.test

$ sed -n '44p' .env.example | od -c
0000000   D   E   M   O   _   M   O   D   E   =  \n
0000013
```

Byte-exact: `DEMO_MODE=` followed by a newline — no value, no trailing whitespace, no `false`. **PASS.** The surrounding comment block (lines 33-43) carries the explicit "never enable it on an internet-facing instance" warning. Line 46's `aida-demo-2026` is the publicly documented demo password (also in the README/docs) and is inert while `DEMO_MODE` is blank — it is not a leaked secret, but it is the value that makes Finding 1 (GAP 1 / critic) concrete.

---

#### 6.4 `prisma/seed.ts` and `src/lib/demo/*` write no `llm:*` / `email:*` credential keys and never set `aiEnabled`

```
$ rg -n -i "aiEnabled|ai\.enabled|llm:|email:[a-z]|llm\.|smtp|imap|apiKey|api_key" --glob '{prisma/seed.ts,src/lib/demo/*.ts}'
src/lib/demo/fixtures.ts:1183:curl -H "Authorization: Bearer $HUDDLEBASE_API_KEY" \\
```

The lone hit is prose inside a fictional KB article body (a shell variable in a sample curl command), not a stored key.

```
$ rg -n "prisma\.setting|db\.setting|\.setting\." --glob '{prisma/**/*.ts,src/lib/demo/**/*.ts,scripts/**/*.ts}'
scripts/capture-demo-assets.ts:431:    await prisma.setting.create({ data: { organizationId: orgId, key, value } });
```

Zero `Setting` writes in `prisma/seed.ts` and zero in `src/lib/demo/*`. Every write in `seedDemoData` is enumerated below and none touches `Setting`:

```
$ rg -n "\.(create|createMany|upsert|update|updateMany)\(" src/lib/demo/seed-demo-data.ts
197: prisma.slaPolicy.create        216: prisma.customFieldDefinition.create
210: prisma.tag.create              310: prisma.ticket.update
354: prisma.message.update          360: prisma.ticketTag.create
442: prisma.contact.update          532: prisma.csatResponse.create
671: prisma.insightRun.create
```

The exclusion is deliberate and documented in the module header (`seed-demo-data.ts:14-16`): *"The AI-toggle Setting key is NEVER written. Leaving it unset keeps AI off, which is what makes the demo honest and stops createTicket from enqueuing ai-triage jobs for every seeded ticket."* **PASS.**

*Informational (outside the stated scope, no finding):* `scripts/capture-demo-assets.ts:417-433` does write six `llm:*` keys — `llm:provider`, `llm:model`, `llm:ollamaBaseUrl`, `llm:embeddingProvider`, `llm:embeddingModel`, `llm:embeddingOllamaBaseUrl`. None is a credential (no `llm:apiKey`; the base URLs point at an in-process loopback stub server), and the script runs exclusively against a disposable Testcontainers Postgres (`PostgreSqlContainer("pgvector/pgvector:pg16").withDatabase("aida_capture").withUsername("capture").withPassword("capture")`, line 706-710) with the child server env pinned to `ADMIN_EMAIL: ""`, `ADMIN_PASSWORD: ""`, `ADMIN_NAME: ""`, `DEMO_MODE: ""` (lines 809-812). It cannot touch a real instance.

---

#### 6.5 `scripts/backup.sh` / `scripts/restore.sh` — no hardcoded password

```
$ grep -n "PGPASSWORD\|password" scripts/*.sh
0 matches for 'PGPASSWORD\|password'
EXIT=1

$ grep -n -i "pgpassword\|password\|passwd\|secret\|token" scripts/backup.sh scripts/restore.sh
EXIT=1

$ grep -c "" scripts/backup.sh scripts/restore.sh
scripts/backup.sh:70
scripts/restore.sh:105
```

Zero matches, including the case-insensitive superset, across all 175 lines of both scripts (line counts confirm the greps covered the whole files, not truncated input). Both scripts obtain credentials only by sourcing an operator-provided `.env` and defaulting: `DB_USER="${POSTGRES_USER:-aida}"`, `DB_NAME="${POSTGRES_DB:-aida}"` (backup.sh:31-32, restore.sh:47-48). Authentication itself is delegated to `docker compose exec -T db pg_dump/pg_restore`, which runs inside the container as a trusted local socket connection — so no password ever needs to be materialised in the shell environment. **PASS.**

---

#### 6.6 `.github/workflows/*.yml` — no `secrets.` echoing into logs, no committed credentials

```
$ ls -R .github/
.github/: ISSUE_TEMPLATE  SECURITY.md  pull_request_template.md  workflows
.github/ISSUE_TEMPLATE: bug_report.yml  config.yml  feature_request.yml
.github/workflows: ci.yml  docs.yml  integration.yml

$ grep -rn "secrets\." .github/
EXIT=1

$ grep -rn "env:\|GITHUB_TOKEN\|API_KEY\|PASSWORD\|TOKEN" .github/
EXIT=1

$ grep -rn -E "(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12}|BEGIN [A-Z ]*PRIVATE KEY|secrets\.)" .github/
EXIT=1
```

All three workflows were read in full. Summary of every step:

| Workflow | Secret usage | Notes |
|---|---|---|
| `ci.yml` | none | `checkout@v5`, `pnpm/action-setup@v4`, `setup-node@v5` (`node-version-file: .nvmrc`), `pnpm install --frozen-lockfile`, `cp .env.example .env`, `db:generate`, `lint`, `typecheck`, `test`, `build`. No `env:` block, no `with:` secret. Does not run `db:seed` and never sets `DEMO_MODE`. |
| `docs.yml` | none | Least-privilege `permissions: {contents: read, pages: write, id-token: write}` — OIDC for Pages, no PAT. `withastro/action@v6` + `actions/deploy-pages@v5`. The only `${{ }}` expression is `steps.deployment.outputs.page_url` (a public URL, not a secret). `concurrency: {group: pages, cancel-in-progress: false}`. |
| `integration.yml` | none | Nightly `cron: "0 3 * * *"` + `workflow_dispatch`. Same setup chain, `cp .env.example .env`, `db:generate`, `test:integration`. Testcontainers supplies its own throwaway Postgres credentials at runtime. |

The `cp .env.example .env` step in `ci.yml` and `integration.yml` copies only the placeholder values audited in 6.3 (`BETTER_AUTH_SECRET=replace-me-...`, `POSTGRES_PASSWORD=aida`, `APP_ENCRYPTION_KEY=replace-me-...`) — no real secret enters a runner. **PASS.** (This plan's own FIX 5 additionally made `pnpm lint` — the first gate in `ci.yml` — exit 0, so typecheck/test/build now genuinely run on the runner for the first time; see Sweep 8 and Fixed in phase.)

---

#### 6.7 Assessment: `src/lib/demo/identities.ts` — can it run outside the demo/seed paths?

Complete caller set (whole repo, all of `src`, `prisma`, `scripts`, `tests`):

```
$ grep -rn "ensureDemoIdentities(" src prisma scripts tests
src/lib/demo/bootstrap-demo.ts:28:    const ids = await ensureDemoIdentities();
src/lib/demo/identities.ts:29:export async function ensureDemoIdentities(): Promise<DemoIdentities> {
prisma/seed.ts:31:    const ids = await ensureDemoIdentities();
```

Exactly two call sites, both intended: the `DEMO_MODE`-gated boot path and the `pnpm db:seed` CLI. **No HTTP route, Server Action, worker job, or test reaches it.** That half is clean. (This plan's FIX 1b additionally reuses this exact `auth.api.signUpEmail()` + `prisma.member.create()` pattern for the e2e test suite's own member-user creation, now that the HTTP route is blocked — see Sweep 1 / Fixed in phase.)

The residual risk is *inside* the seed path. `ensureDemoIdentities()` runs **before** the guard that is supposed to protect a real workspace:

```
$ sed -n '29,40p' prisma/seed.ts
async function main(): Promise<void> {
  try {
    const ids = await ensureDemoIdentities();          // <-- writes users/members FIRST

    // Guard (D-01): refuse on a non-empty workspace instead of duplicating data.
    const existingTicketCount = await prisma.ticket.count({
      where: { organizationId: ids.orgId },
    });
    if (existingTicketCount > 0) {
      console.log(`[seed] Refusing to seed: workspace already has ${existingTicketCount} tickets.`);
```

and what `ensureDemoIdentities()` writes when an org already exists:

```
$ sed -n '11,13p;74,101p' src/lib/demo/identities.ts
export const DEMO_ADMIN_EMAIL_DEFAULT = "admin@demo.aida.test";
export const DEMO_AGENT_EMAIL_DEFAULT = "agent@demo.aida.test";
export const DEMO_PASSWORD_DEFAULT = "aida-demo-2026";
...
    const agentSignUp = await auth.api.signUpEmail({
      body: { name: DEMO_AGENT_NAME, email: agentEmail, password: adminPassword },
    });
...
    await prisma.member.create({
      data: { id: randomUUID(), organizationId: orgId, userId: agentUserId,
              role: "member", createdAt: new Date() },
    });
```

Neither entrypoint is `DEMO_MODE`-gated (`package.json:24 "db:seed": "tsx prisma/seed.ts"`; `prisma.config.ts:6 migrations: { seed: "tsx prisma/seed.ts" }`). The boot path has the **opposite, correct** ordering (`bootstrap-demo.ts:22-28` counts tickets and returns at line 26 before reaching `ensureDemoIdentities()` at line 28), so the two paths *do* drift on exactly the property that matters. See **Finding 1**. Verdict for this item: **FINDING** — confined to the two intended callers, but not safe within the seed caller. Not fixed in this phase (out of approved scope) — recorded as F-10.

---

#### Required verdict table

| # | Item | Verdict | Evidence anchor |
|---|---|---|---|
| 6.1 | `settings/branding/actions.ts` opens with `await requireOrgAdmin()` | **PASS** | `branding/actions.ts:16` (first statement of `saveBranding`) |
| 6.2a | `bootstrap-demo.ts` returns unless `DEMO_MODE === "true"` (strict, first statement) | **PASS** | `bootstrap-demo.ts:14` `if (process.env.DEMO_MODE !== "true") return;` |
| 6.2b | Logs loud warning containing `PUBLICLY DOCUMENTED credentials` | **PASS** | `bootstrap-demo.ts:17-19` `console.warn(...)` before any DB work |
| 6.2c | Never prints a password value | **PASS** | `bootstrap-demo.ts:40` literal string only; `%s` arg is `adminEmail` |
| 6.3 | `.env.example` ships exactly `DEMO_MODE=` (blank) | **PASS** | `od -c` → `D E M O _ M O D E = \n` |
| 6.4a | `prisma/seed.ts` + `src/lib/demo/*` write no `llm:*` / `email:*` credential keys | **PASS** | 0 hits for `.setting.` in both; only `fixtures.ts:1183` prose hit |
| 6.4b | Never set the `aiEnabled` Setting | **PASS** | 0 `Setting` writes; documented exclusion `seed-demo-data.ts:14-16` |
| 6.5 | `scripts/*.sh` contain no hardcoded password | **PASS** | `grep -n "PGPASSWORD\|password" scripts/*.sh` → 0 matches (EXIT=1) |
| 6.6 | `.github/workflows/*.yml` no `secrets.` echo, no committed credentials | **PASS** | `grep -rn "secrets\." .github/` → EXIT=1; secret-pattern scan → EXIT=1 |
| 6.7 | `identities.ts` cannot run outside demo/seed paths | **FINDING** | 2 callers only, but `prisma/seed.ts:31` runs it before the `:37` guard |
| — | *(bonus)* `prisma/seed.ts` password echo vs. "NEVER logs the password" invariant | **FINDING (LOW)** | `prisma/seed.ts:59-60` |
| — | *(bonus, out of scope)* `setAiEnabled` missing `requireOrgAdmin()` | **FINDING (MEDIUM) — FIXED (`9cf38f4`)** | `settings/actions.ts:21-22` |

#### Findings

1. **MEDIUM — `prisma/seed.ts:31`: demo agent with published credentials is created in a real org before the refusal guard fires.** Running `pnpm db:seed` against a populated (production) instance attaches to the existing `Organization`, creates `agent@demo.aida.test` with password `aida-demo-2026` via `auth.api.signUpEmail`, and inserts a `Member` row with `role: "member"` — *then* counts tickets and prints `[seed] Refusing to seed: ...` and `exit 1`. The operator sees a refusal and reasonably concludes nothing was written, while a login-capable account with publicly documented credentials now holds member-level access to real ticket and contact data. The `DEMO_MODE` boot path orders these correctly; the CLI path does not, contradicting the "so the two paths cannot drift" contract in both file headers. Suggested fix: move the ticket-count guard ahead of `ensureDemoIdentities()` (resolving `orgId` via `prisma.organization.findFirst()` first), matching `bootstrap-demo.ts:22-28`. **Not fixed in this phase (out of approved scope) — recorded as F-10.**
2. **LOW — `prisma/seed.ts:59`: the effective password is echoed to stdout.** `ADMIN_PASSWORD` is `process.env.DEMO_ADMIN_PASSWORD || DEMO_PASSWORD_DEFAULT`, so an operator-supplied non-default password is written verbatim to the terminal and any captured log. This breaks the invariant asserted twice in-tree — `src/lib/bootstrap.ts:10` "NEVER logs the password" and `src/lib/demo/identities.ts:28` "Never logs the password" — and diverges from `bootstrap-demo.ts:39-42`, which prints only the email plus a pointer to the env var. **Not fixed in this phase (out of approved scope) — recorded as F-09 (duplicate discovery with Sweep 3).**
3. **MEDIUM (outside Sweep 6's scope — Phase 4 surface, reported because it surfaced while enumerating Settings actions) — `src/app/(app)/settings/actions.ts:22`: `setAiEnabled` has no `requireOrgAdmin()`.** Its first statement is `await getScopedDb()`, which enforces only `requireSession()`. Any authenticated non-admin member can toggle the org-wide `aiEnabled` Setting on or off. Every one of its five siblings in the same file, and all ten mutating actions under `settings/{branding,custom-fields,tags,sla,email}`, gate correctly — this one action is the sole exception, and it violates the stated invariant that `requireOrgAdmin()` be the first statement of every mutating Settings Server Action. **Fixed in `9cf38f4`** (duplicate discovery with Sweep 1 S1-01 — recorded once as F-02).

**VERDICT: FINDING** — six of the seven assigned checks pass cleanly (6.1, 6.2a-c, 6.3, 6.4a-b, 6.5, 6.6). Check 6.7 fails: `ensureDemoIdentities()` is correctly confined to two callers, but `prisma/seed.ts` invokes it ahead of the non-empty-workspace guard, so an accidental `pnpm db:seed` against a live instance plants a member account with publicly documented credentials in a real organization while reporting that it refused to seed. Two additional findings (one LOW in-scope, one MEDIUM out-of-scope) are recorded above; the out-of-scope MEDIUM (`setAiEnabled`) is fixed, the other two are known issues.


### Sweep 7 — Dependency audit

**Scope:** every advisory returned by `pnpm audit --audit-level=moderate`, each classified as production vs devDependency and reachable vs unreachable from the shipped Docker image, plus upgrade class (trivial patch/minor vs major bump). Read-only — no upgrade was applied, no file was modified, **at sweep time** (this plan subsequently applied the `next` bump as FIX 4 — `85b867b`).

**Environment:** `pnpm 10.34.4`, `node v22.23.1`, branch `phase-07-wave-4-launch-readiness`, HEAD `89d4600`.

---

#### 1. Commands run

```
$ pnpm audit --audit-level=moderate
$ pnpm audit --audit-level=moderate --json      # machine-readable re-derivation of the same run
$ pnpm audit --audit-level=low --json           # to recover the 1 low the moderate gate suppresses
$ pnpm why <each vulnerable package>
$ ls .next/standalone/node_modules/.pnpm
$ node scan-bundle.cjs .next/standalone/.next/server  <needles>
$ node scan-bundle.cjs dist/ <needles>
```

`pnpm audit` was **not** blocked — it reached the registry and returned a full advisory set, so the `npm audit --package-lock-only` fallback was not needed.

#### 2. Raw output

The human-readable table form is **82.6 KB** (36 box-drawn advisory tables). Reproduced verbatim below: the first box, the last box, and the summary footer. The middle is trimmed **only for size** — every trimmed advisory is reproduced field-for-field from the `--json` run in §3, and the counts reconcile exactly.

```
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ critical            │ Better Auth: OAuth refresh-token replay via missing    │
│                     │ client authentication on oidc-provider and mcp plugins │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Package             │ better-auth                                            │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Vulnerable versions │ <1.6.11                                                │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Patched versions    │ >=1.6.11                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Paths               │ .>@better-auth/cli>better-auth                         │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ More info           │ https://github.com/advisories/GHSA-pw9m-5jxm-xr6h      │
└─────────────────────┴────────────────────────────────────────────────────────┘

        ...  [34 further advisory boxes trimmed — 82.6 KB total; all reproduced in §3]  ...

┌─────────────────────┬────────────────────────────────────────────────────────┐
│ moderate            │ Valibot: record() issue paths can make flatten() throw │
│                     │ for inherited Object property names                    │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Package             │ valibot                                                │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Vulnerable versions │ <=1.4.1                                                │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Patched versions    │ >=1.4.2                                                │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Paths               │ .>prisma>@prisma/dev>valibot                           │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ More info           │ https://github.com/advisories/GHSA-5qjj-4xww-7phc      │
└─────────────────────┴────────────────────────────────────────────────────────┘
39 vulnerabilities found
Severity: 1 low | 13 moderate | 24 high | 1 critical
EXITCODE=1
```

**Reconciling "39":** the JSON payload holds **36 advisory objects** spanning **38 finding-paths** (advisory 1124288 / postcss resolves through 3 distinct paths, and pnpm counts per path). The 39th is a **low** advisory that `--audit-level=moderate` *counts in the footer but suppresses from the table*. Recovered with `--audit-level=low`:

```
=== [LOW] better-auth (advisory 1122756)
    title    : Better Auth: Stale sessions persist after user deletion across admin, anonymous, and SCIM flows
    vulnerable: >=0.3.4 <1.6.11   patched: >=1.6.11
    url      : https://github.com/advisories/GHSA-2vg6-77g8-24mp
    path     : 1.4.21 @ .>@better-auth/cli>better-auth
```

`1 + 24 + 13 + 1 = 39`. Fully accounted for.

#### 3. How "reachable from the shipped Docker image" was determined

Not assumed — measured against the actual artifacts.

The `runner` stage (Dockerfile stage 4) copies **only** `public/`, `.next/standalone`, `.next/static`, `dist/`, `/tmp/prisma-scope → node_modules/@prisma`, and `prisma/`. It performs **no** `pnpm install`, so no devDependency tree exists in it. The copied `@prisma` scope was verified locally to contain exactly `client/` and `client-runtime-utils` — **no `@prisma/dev`, no `prisma` CLI**.

Two things ship, and both were scanned:

**(a) The traced `node_modules` in `.next/standalone` — 41 package dirs, complete listing:**

```
@anthropic-ai+sdk@0.110.0_zod@4.4.3   @img+colour@1.1.0                @img+sharp-win32-x64@0.34.5
@next+env@16.2.9                      @pinojs+redact@0.4.0             @prisma+client-runtime-utils@7.8.0
@prisma+client@7.8.0_prisma_8e5f85…   @swc+helpers@0.5.15              atomic-sleep@1.0.0
client-only@0.0.1                     detect-libc@2.1.2                next@16.2.9_@babel+core@7.2_f5a013…
on-exit-leak-free@2.1.2               pg-cloudflare@1.4.0              pg-connection-string@2.14.0
pg-int8@1.0.1                         pg-pool@3.14.0_pg@8.22.0         pg-protocol@1.15.0
pg-types@2.2.0                        pg@8.22.0                        pgpass@1.0.5
pino-std-serializers@7.1.0            pino@10.3.1                      postgres-array@2.0.0
postgres-array@3.0.4                  postgres-bytea@1.0.1             postgres-date@1.0.7
postgres-interval@1.2.0               quick-format-unescaped@4.0.4     react-dom@19.2.7_react@19.2.7
react@19.2.7                          real-require@0.2.0               real-require@1.0.0
safe-stable-stringify@2.5.0           semver@7.8.5                     sharp@0.34.5
sonic-boom@4.2.1                      split2@4.2.0                     styled-jsx@5.1.6_…
thread-stream@4.2.0                   xtend@4.0.2
```

`next@16.2.9` and `sharp@0.34.5` are present. Every other vulnerable package is absent. *(Post-FIX-4, `next` resolves to `16.2.11`; `sharp@0.34.5` is unchanged — see Known issues.)*

**(b) The 15.6 MB of *bundled* server code** — necessary because Next inlines most deps into `.next/server/**` instead of tracing them, so absence from (a) alone proves nothing:

```
SCANNED files=508 bytes=15601371  (.next/standalone/.next/server)
  "drizzle-orm"        hits=7      "entityKind"  hits=0   <-- drizzle-orm's universal runtime symbol absent
  "postcss"            hits=5      (only inside *.nft.json manifests)
  "brace-expansion" 0 | "protobufjs" 0 | "valibot" 0 | "@hono/node-server" 0 | "fast-uri" 0 | "lodash" 0

SCANNED files=1 bytes=6530451  (dist/ — the esbuild worker bundle)
  "drizzle-orm" hits=1 | "sharp" hits=1 | all other needles 0
```

Both non-zero hits are **false positives**, disambiguated by printing surrounding bytes:

```
drizzle-orm (server chunk) → …"@prisma/client":"prisma",mongoose:"mongodb","drizzle-orm":"drizzle"})…
                              = better-auth's adapter-NAME lookup map. No drizzle code (entityKind = 0 hits).
postcss     (nft.json)     → …"../../../../../../pnpm-lock.yaml","../../../../../../postcss.config.mjs"…
                              = the repo's own config file, not the postcss package.
drizzle-orm (worker)       → …"cross-env":"^10.1.0","drizzle-orm":"^1.0.0-beta.22",eslint:"^9.39.4"…
                              = an embedded package.json blob from a bundled dep.
sharp       (worker)       → …[0,"&natural;"],[0,"&sharp;"],[163,"&check;"]…
                              = HTML-entity tables from html-to-text/mailparser.
```

**Conclusion:** the app and worker containers contain exactly two vulnerable packages — `next@16.2.9` and `sharp@0.34.5`. All 27 other advisories are unreachable from them.

**One honest caveat.** `docker compose up` also builds a third container from `target: builder`, which *does* carry the full devDependency tree:

```
20:  migrate:
23:      target: builder
24:    command: ["pnpm", "prisma", "migrate", "deploy"]
```

Those packages are therefore **on disk** in the migrate container (including the critical `better-auth@1.4.21`), but that container binds no port, receives no untrusted input, runs one command against the local DB, and exits (`restart: "no"`). "Not in the shipped image" is precise for the app/worker runner stage; for `migrate` the accurate statement is "present on disk, not executed."

#### 4. Advisory classification table

All 37 unique advisories (36 at moderate+, plus the suppressed low). "In runner image?" = present in the app/worker container per §3. "Dep class" is the **declared** class in `package.json`.

| # | Sev | Package @ resolved | Advisory | Declared dep class (path) | In runner image? | Upgrade class |
|---|-----|--------------------|----------|---------------------------|------------------|---------------|
| 1 | **critical** | better-auth 1.4.21 | GHSA-pw9m-5jxm-xr6h | **dev** — `@better-auth/cli` | No | Trivial minor: `@better-auth/cli` 1.4.21 → ≥1.6.22 |
| 2 | high | better-auth 1.4.21 | GHSA-9h47-pqcx-hjr4 | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 3 | high | better-auth 1.4.21 | GHSA-86j7-9j95-vpqj | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 4 | high | better-auth 1.4.21 | GHSA-7w99-5wm4-3g79 | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 5 | high | better-auth 1.4.21 | GHSA-392p-2q2v-4372 | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 6 | high | better-auth 1.4.21 | GHSA-g38m-r43w-p2q7 | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 7 | high | better-auth 1.4.21 | GHSA-fmh4-wcc4-5jm3 | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 8 | high | better-auth 1.4.21 | GHSA-qq9h-g4jm-xgf3 | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 9 | mod | better-auth 1.4.21 | GHSA-wxw3-q3m9-c3jr | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 10 | low | better-auth 1.4.21 | GHSA-2vg6-77g8-24mp | **dev** — `@better-auth/cli` | No | Trivial minor (same bump) |
| 11 | high | brace-expansion 2.1.1 | GHSA-3jxr-9vmj-r5cp | **dev** — `testcontainers>archiver` | No | Trivial patch → ≥2.1.3 (override) |
| 12 | high | brace-expansion 2.1.1 | GHSA-mh99-v99m-4gvg | **dev** — `testcontainers>archiver` | No | Trivial patch → ≥2.1.3 (override) |
| 13 | high | brace-expansion 5.0.6 | GHSA-3jxr-9vmj-r5cp | **prod** — `shadcn>ts-morph` | No | Trivial patch → ≥5.0.8 (override) |
| 14 | high | brace-expansion 5.0.6 | GHSA-mh99-v99m-4gvg | **prod** — `shadcn>ts-morph` | No | Trivial patch → ≥5.0.8 (override) |
| 15 | high | drizzle-orm 0.41.0 | GHSA-gpj5-g38j-94v9 | **dev** (`@better-auth/cli`) **and prod** (`better-auth@1.6.22 > @better-auth/drizzle-adapter`) | No — `entityKind` 0 hits | 0.x minor 0.41 → ≥0.45.2; dev path clears with the CLI bump, prod path needs an override or upstream widening |
| 16 | high | fast-uri 3.1.2 | GHSA-v2hh-gcrm-f6hx | **prod** — `prisma>@prisma/dev>ajv` **and** `shadcn>@modelcontextprotocol/sdk>ajv` | No | Trivial patch → ≥3.1.4 (override) |
| 17 | high | fast-uri 3.1.2 | GHSA-4c8g-83qw-93j6 | **prod** — same two paths | No | Trivial patch → ≥3.1.4 (override) |
| 18 | high | lodash 4.17.21 | GHSA-r5fr-rjxr-66jc | **dev** — `@better-auth/cli>@mrleebo/prisma-ast>chevrotain` | No | Minor → ≥4.18.0 (4.18.1 already resolves elsewhere in the tree) |
| 19 | mod | lodash 4.17.21 | GHSA-f23m-r3pf-42rh | **dev** — same path | No | Minor → ≥4.18.0 |
| 20 | mod | lodash 4.17.21 | GHSA-xxjr-mmjv-4gpg | **dev** — same path | No | Trivial patch → ≥4.17.23 |
| 21 | high | **next 16.2.9** | GHSA-6gpp-xcg3-4w24 (proxy bypass) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 22 | high | **next 16.2.9** | GHSA-m99w-x7hq-7vfj (Server Actions DoS) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 23 | high | **next 16.2.9** | GHSA-89xv-2m56-2m9x (SSRF, custom servers) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 24 | high | **next 16.2.9** | GHSA-p9j2-gv94-2wf4 (SSRF via rewrites) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 25 | mod | **next 16.2.9** | GHSA-68g3-v927-f742 (cache confusion) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 26 | mod | **next 16.2.9** | GHSA-4633-3j49-mh5q (cache confusion, bad UTF-8) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 27 | mod | **next 16.2.9** | GHSA-4c39-4ccg-62r3 (unbounded Edge payload) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 28 | mod | **next 16.2.9** | GHSA-q8wf-6r8g-63ch (image-opt SVG DoS) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 29 | mod | **next 16.2.9** | GHSA-955p-x3mx-jcvp (Server Function disclosure) | **prod** — direct | **YES** | **Trivial patch → 16.2.11 — FIXED (`85b867b`)** |
| 30 | high | postcss 8.4.31 | GHSA-6g55-p6wh-862q | **prod** — `next>postcss` | No (build-time only) | Trivial minor → ≥8.5.18 (pinned by next; override) |
| 31 | high | postcss 8.4.31 / 8.5.15 / 8.5.16 (3 paths) | GHSA-r28c-9q8g-f849 | **prod** `next>postcss`; **dev** `@tailwindcss/postcss>postcss`; **dev** direct `postcss` | No (build-time only) | Trivial patch → ≥8.5.18 |
| 32 | mod | postcss 8.4.31 | GHSA-qx2v-qp2m-jg93 | **prod** — `next>postcss` | No (build-time only) | Trivial minor → ≥8.5.10 |
| 33 | high | **sharp 0.34.5** | GHSA-f88m-g3jw-g9cj (libvips CVEs) | **prod** — `next>sharp` | **YES** | **0.x minor 0.34 → ≥0.35.0 — pinned by next's optional-dep range; needs an override or a next release that widens it. Not a plain patch — left as a known issue (F-05) per explicit maintainer instruction.** |
| 34 | mod | @hono/node-server 1.19.11 | GHSA-92pp-h63x-v22m | **prod** — `prisma>@prisma/dev` **and** `shadcn>@modelcontextprotocol/sdk` | No | Trivial patch → ≥1.19.13 |
| 35 | mod | @hono/node-server 1.19.11 | GHSA-frvp-7c67-39w9 | **prod** — same two paths | No | **MAJOR bump required → ≥2.0.5**; upstream-blocked (both parents pin 1.x) |
| 36 | mod | protobufjs 7.6.4 | GHSA-j3f2-48v5-ccww | **dev** — `testcontainers>dockerode` | No | Trivial patch → ≥7.6.5 |
| 37 | mod | valibot 1.2.0 | GHSA-5qjj-4xww-7phc | **prod** — `prisma>@prisma/dev` | No | Trivial minor → ≥1.4.2 (override) |

**Totals:** 37 advisories. **10 reachable** in the shipped app/worker image (9 × `next`, 1 × `sharp`); **27 unreachable**. By declared class: 16 dev-only paths, 21 production paths. By upgrade class: **35 trivial patch/minor**, **1 requiring a major bump** (#35, `@hono/node-server` → 2.0.5, upstream-blocked), **1 a 0.x minor that is effectively breaking** (#33, `sharp` 0.34 → 0.35, pinned by next). **9 of the 10 reachable advisories were fixed in this phase (`85b867b`); the 10th (`sharp`) was not, per explicit maintainer instruction — see Known issues F-05.** None of the 27 unreachable advisories were in the maintainer's approved-fixes list.

#### 5. Notable observations

1. **The direct production `better-auth@1.6.22` is already clean.** All 10 better-auth advisories hit a *second, nested* copy at `1.4.21` pulled in by the `@better-auth/cli` devDependency. Advisory #8 (`GHSA-qq9h-g4jm-xgf3`, patched `>=1.6.22`) is satisfied by exactly the pinned version — the prod dep sits precisely on the fix line, so any future pin below 1.6.22 silently reintroduces it.
2. **The audit table under-reports production exposure.** `pnpm audit` prints one representative path per advisory. `pnpm why` shows `drizzle-orm`, `fast-uri`, and `@hono/node-server` each *also* reach the root through **production** declarations (`better-auth > @better-auth/drizzle-adapter`, `shadcn > @modelcontextprotocol/sdk`) that the table never displays. Reading the table alone would have mislabelled three advisories as dev-only.
3. **`shadcn@4.12.0` is declared in `dependencies`, not `devDependencies`** (`package.json:60`). It is a scaffolding CLI, never imported by `src/` (verified: 0 import sites), yet it drags `ts-morph`, `@modelcontextprotocol/sdk`, and `@dotenvx/dotenvx` into the production graph and owns 4 advisory paths.
4. **The `next` patch is the whole story.** A single `16.2.9 → 16.2.11` bump clears 9 of the 10 reachable advisories — 4 high, 5 moderate — with no breaking change. **This is exactly what FIX 4 (`85b867b`) did.**
5. **Exploitability nuance on the two reachable packages** (stated so the report is not read as more alarming than the evidence supports):
   - `GHSA-6gpp-xcg3-4w24` (proxy bypass) targets the exact mechanism this repo relies on for auth — `src/proxy.ts` is the sole gate — but its stated precondition is an App Router app **with a single-locale i18n config**. `next.config.ts` declares **no `i18n` block at all** (grep over `*.ts|*.mjs|*.json|*.js`: 0 config hits). The version was in range; the documented precondition was not met. Fixed anyway (`85b867b`).
   - `sharp` and `GHSA-q8wf-6r8g-63ch` are both driven through `/_next/image`, which `src/proxy.ts:29` explicitly **excludes from the matcher** — it is unauthenticated. Mitigating: no `images.remotePatterns` is configured (remote URLs are rejected by default) and `dangerouslyAllowSVG` defaults to `false`, so an attacker cannot supply arbitrary image bytes; only files already in `public/` can be optimized. Present and exposed, but not attacker-fed.

---

**VERDICT: FINDING** — `pnpm audit --audit-level=moderate` exited 1 with 39 vulnerabilities (1 critical / 24 high / 13 moderate / 1 low) at sweep time. The critical and 8 of the highs are dev-only and unreachable from the app and worker containers. However, **10 advisories — 4 high and 5 moderate in `next@16.2.9`, plus 1 high in `sharp@0.34.5` — were verifiably present in the shipped runtime image**, including a middleware/proxy-bypass advisory against the exact component (`src/proxy.ts`) that is this application's only authentication gate. **9 of the 10 were fixed in this phase by the `next@16.2.11` patch bump (`85b867b`); the 10th (`sharp`) is a known issue (F-05), not fixed, per explicit maintainer instruction.**


### Sweep 8 — Safeguard tests re-run

**Scope.** Re-run the full unit and integration safeguard suites on `phase-07-wave-4-launch-readiness` @ `89d4600`, record pass counts verbatim, and confirm by name that the four AIDA-20 proof tests pass. Read-only: no repository file was created, modified, or deleted; no commit was made. *(This plan subsequently re-ran both suites again, several times, after each of its own five fix commits — see the plan's own reported gate results, which post-fix stand at unit 85/85 across 17 files and integration 26/26 across 11 files, both green.)*

#### 0. Environment / preflight

```
$ git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && git status --porcelain
phase-07-wave-4-launch-readiness
89d46005066e191095650c12a9ebdb968589dc78
                      # (git status --porcelain produced no output = clean tree)

$ node -v
v22.23.1

$ volta -v
2.0.2

$ volta list node
runtime node@20.20.2 (default)
runtime node@22.23.0
runtime node@22.23.1 (current @ D:\Aff\proj\aida\package.json)
runtime node@24.10.0

$ docker version --format '{{.Server.Version}}'
29.5.2
```

Volta **was** available, so no PATH workaround was needed — `volta run --node 22.23.1` was used exactly as assigned. Docker Server 29.5.2 was up, and Testcontainers started `pgvector/pgvector:pg16` successfully (see §2).

Test configs confirm the two suites are disjoint:

- `vitest.config.ts` → `include: ["tests/unit/**/*.test.ts"]`, `environment: "node"`
- `vitest.integration.config.ts` → `include: ["tests/integration/**/*.test.ts"]`, `globalSetup: "./tests/integration/global-setup.ts"`, `fileParallelism: false`, `hookTimeout: 120_000`, `testTimeout: 60_000`

#### 1. Unit suite — assigned command

```
$ node node_modules/vitest/vitest.mjs run tests/unit

 RUN  v4.1.9 D:/Aff/proj/aida

 Test Files  16 passed (16)
      Tests  81 passed (81)
   Start at  08:36:15
   Duration  16.16s (transform 16.44s, setup 0ms, import 65.65s, tests 4.22s, environment 13ms)
```

**Unit result: 16 test files passed (16), 81 tests passed (81). 0 failed, 0 skipped.**

The default reporter emits only the summary, so the suite was re-run with `--reporter=verbose` to obtain per-test names. Identical counts (16/81). All 16 unit files passed: `secret-box`, `rag-embed`, `insight-cluster`, `smoke`, `email-parse-body`, `triage-prompt`, `health`, `email-thread-match`, `llm-redact`, `chunk-markdown`, `insight-aggregates`, `insight-prompts`, `proxy`, `sanitize-email-html`, `markdown-render`, `compose-outbound`.

Verbatim `llm-redact` block from the verbose run (proof test #4):

```
 ✓ tests/unit/llm-redact.test.ts > redactSecrets > redacts an OpenAI-style API key (sk-proj-...) 9ms
 ✓ tests/unit/llm-redact.test.ts > redactSecrets > redacts an Anthropic-style API key (sk-ant-...) 2ms
 ✓ tests/unit/llm-redact.test.ts > redactSecrets > redacts an AWS access key id (AKIA + 16 uppercase/digits) 1ms
 ✓ tests/unit/llm-redact.test.ts > redactSecrets > redacts a Bearer token (>=20 chars) 1ms
 ✓ tests/unit/llm-redact.test.ts > redactSecrets > redacts a 16-digit card-like sequence 1ms
 ✓ tests/unit/llm-redact.test.ts > redactSecrets > redacts a card-like sequence with dashes/spaces 1ms
 ✓ tests/unit/llm-redact.test.ts > redactSecrets > leaves ordinary ticket prose untouched (idempotent on clean text) 1ms
```

#### 2. Integration suite — assigned command

```
$ volta run --node 22.23.1 pnpm test:integration

> aida@ test:integration D:\Aff\proj\aida
> vitest run --config vitest.integration.config.ts

 RUN  v4.1.9 D:/Aff/proj/aida

 WARN  Unsupported engine: wanted: {"node":">=22"} (current: {"node":"v20.20.2","pnpm":"10.34.4"})
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "aida_test", schema "public" at "localhost:32813"

7 migrations found in prisma/migrations

Applying migration `20260629020504_init`
Applying migration `20260701234550_core_ticketing`
Applying migration `20260701234808_ticket_search`
Applying migration `20260706025051_email_channel`
Applying migration `20260707053633_ai_foundation`
Applying migration `20260721154325_rag_kb`
Applying migration `20260724171144_insight_aida`

All migrations have been successfully applied.
 WARN  Unsupported engine: wanted: {"node":">=22"} (current: {"node":"v20.20.2","pnpm":"10.34.4"})
Loaded Prisma config from prisma.config.ts.
✔ Generated Prisma Client (7.8.0) to .\src\generated\prisma in 2.67s

 Test Files  11 passed (11)
      Tests  26 passed (26)
   Start at  08:37:26
   Duration  242.92s (transform 2.82s, setup 0ms, import 49.18s, tests 19.86s, environment 12ms)

EXIT CODE 0
```

*(The migration listing block that repeats each `migration.sql` path was trimmed for length — nothing else was removed. Testcontainers bound the ephemeral Postgres on `localhost:32813`.)*

**Integration result: 11 test files passed (11), 26 tests passed (26). 0 failed, 0 skipped. Process exit code 0.**

**Note on the `Unsupported engine` WARN (benign, not a finding).** The parent vitest process ran on Node **v22.23.1** (pinned via `volta run --node 22.23.1`; `package.json` `volta.node = 22.23.1`). The warning comes from the nested `execSync("pnpm prisma migrate deploy && pnpm prisma generate")` inside `tests/integration/global-setup.ts:33`, where the pnpm standalone resolves its own bundled Node 20.20.2. It is pnpm's advisory engine check on that child only — all 7 migrations applied successfully and the Prisma Client generated cleanly, so it has no effect on correctness. This is the already-documented AIDA environment quirk, not a regression introduced by Wave 4.

#### 3. Integration suite — verbose re-run (per-test names)

The default reporter printed no per-test lines, so the suite was re-run verbose to name every test. Counts reproduced exactly (11 files / 26 tests), giving two independent green runs.

```
$ volta run --node 22.23.1 node node_modules/vitest/vitest.mjs run \
    --config vitest.integration.config.ts --reporter=verbose

 ✓ tests/integration/kb-embed.test.ts > kb-embed-article pipeline: save -> chunk -> embed -> store (AIDA-15) > embeds a saved KB article into org-scoped 768-dim KbChunk rows and is idempotent on re-embed 3637ms
 ✓ tests/integration/insight-run.test.ts > insight-run orchestrator: end-to-end + reproducibility + AI-off (AIDA-17) > computes labeled+cited clusters, KB gaps, volume drivers, SLA/CSAT, reproducibly, and degrades cleanly with AI off 3729ms
 ✓ tests/integration/create-ticket.test.ts > createTicket > assigns sequential numbers 1593ms
 ✓ tests/integration/create-ticket.test.ts > createTicket > assigns no duplicate numbers under concurrency 2071ms
 ✓ tests/integration/create-ticket.test.ts > createTicket > links contact by normalized email 218ms
 ✓ tests/integration/draft-generation.test.ts > draft generation groundedness + injection defense (05-04) > Case A: grounded draft with resolved citations, fenced kb_source, escaped injection, one audit row 2241ms
 ✓ tests/integration/draft-generation.test.ts > draft generation groundedness + injection defense (05-04) > Case B: zero-result groundedness gate skips the LLM call and still audits the zero-result 259ms
 ✓ tests/integration/triage-injection.test.ts > triage prompt-injection defense (D-15) > holds against tag-breakout, secret leakage, and injected side effects 2184ms
 ✓ tests/integration/email-ingest.test.ts > email-ingest > 1. new email with no thread headers creates a ticket 898ms
 ✓ tests/integration/email-ingest.test.ts > email-ingest > 2. reply via In-Reply-To threads onto the existing ticket (no new ticket) 202ms
 ✓ tests/integration/email-ingest.test.ts > email-ingest > 3. re-ingesting the same fixture buffer is deduped (no new message) 21ms
 ✓ tests/integration/email-ingest.test.ts > email-ingest > 4. subject [#N] token threads onto the ticket when header match misses 117ms
 ✓ tests/integration/email-ingest.test.ts > email-ingest > 5. auto-generated email with no thread match is dropped (no ticket created) 37ms
 ✓ tests/integration/email-ingest.test.ts > email-ingest > 6. reply to a RESOLVED ticket reopens it (triggeredReopen marker) 199ms
 ✓ tests/integration/sla-flag-handler.test.ts > slaFlagHandler > marks a ticket breached (and implicitly at-risk) once firstResponseDueAt has passed 1747ms
 ✓ tests/integration/sla-flag-handler.test.ts > slaFlagHandler > marks a ticket breached via resolutionDueAt once the first response is already in 120ms
 ✓ tests/integration/sla-flag-handler.test.ts > slaFlagHandler > marks a ticket at-risk (not breached) when due within 20% of the target duration 132ms
 ✓ tests/integration/sla-flag-handler.test.ts > slaFlagHandler > leaves a comfortably-on-track ticket untouched 89ms
 ✓ tests/integration/sla-flag-handler.test.ts > slaFlagHandler > excludes RESOLVED and CLOSED tickets even when their due timestamps are long past 112ms
 ✓ tests/integration/search-isolation.test.ts > AIDA-02: searchTickets tenant isolation > subject match: orgA search never returns orgB's ticket and vice-versa 1407ms
 ✓ tests/integration/search-isolation.test.ts > AIDA-02: searchTickets tenant isolation > message-body match: a ticket surfaces via its message content, still org-scoped 218ms
 ✓ tests/integration/workspace-isolation.test.ts > AIDA-11: workspace isolation > scopedDb read isolation: orgA never sees orgB rows and vice-versa 1396ms
 ✓ tests/integration/workspace-isolation.test.ts > AIDA-11: workspace isolation > scopedDb create auto-injects organizationId without explicit field 67ms
 ✓ tests/integration/audit-append-only.test.ts > AuditEvent append-only > allows INSERT but rejects UPDATE and DELETE at the DB level 1518ms
 ✓ tests/integration/scoped-tx.test.ts > Wave-0 smoke test: scopedDb organizationId injection inside $transaction > injects organizationId into a Setting created inside an interactive $transaction 1115ms
 ✓ tests/integration/scoped-tx.test.ts > Wave-0 smoke test: scopedDb organizationId injection inside $transaction > injects organizationId into a TicketCounter upserted inside the same interactive $transaction 202ms

 Test Files  11 passed (11)
      Tests  26 passed (26)
   Duration  238.65s (transform 3.01s, setup 0ms, import 63.72s, tests 26.93s, environment 14ms)
```

*(Only the `✓` / summary lines are shown; the run produced no `×`, `FAIL`, or stack-trace lines to omit.)*

#### 4. Pass counts

| Suite | Command | Test files | Tests | Failed | Skipped | Duration | Exit |
|---|---|---|---|---|---|---|---|
| Unit | `node node_modules/vitest/vitest.mjs run tests/unit` | 16 passed (16) | **81 passed (81)** | 0 | 0 | 16.16s | 0 |
| Integration | `volta run --node 22.23.1 pnpm test:integration` | 11 passed (11) | **26 passed (26)** | 0 | 0 | 242.92s | 0 |
| **Total** | — | **27 passed (27)** | **107 passed (107)** | **0** | **0** | ~259s | 0 |

#### 5. The four AIDA-20 proof tests — named confirmation

| # | Proof test | File | Test name(s) | Result |
|---|---|---|---|---|
| 1 | **triage-injection** | `tests/integration/triage-injection.test.ts` | `triage prompt-injection defense (D-15) > holds against tag-breakout, secret leakage, and injected side effects` | ✓ **PASS** (2184ms) |
| 2 | **audit-append-only** | `tests/integration/audit-append-only.test.ts` | `AuditEvent append-only > allows INSERT but rejects UPDATE and DELETE at the DB level` | ✓ **PASS** (1518ms) |
| 3 | **draft-generation** | `tests/integration/draft-generation.test.ts` | `draft generation groundedness + injection defense (05-04) > Case A: grounded draft with resolved citations, fenced kb_source, escaped injection, one audit row` | ✓ **PASS** (2241ms) |
| 3b | **draft-generation** | `tests/integration/draft-generation.test.ts` | `… > Case B: zero-result groundedness gate skips the LLM call and still audits the zero-result` | ✓ **PASS** (259ms) |
| 4 | **llm-redact** | `tests/unit/llm-redact.test.ts` | `redactSecrets` — all 7 cases (OpenAI `sk-proj-`, Anthropic `sk-ant-`, AWS `AKIA…`, `Bearer` ≥20 chars, 16-digit card, dashed/spaced card, clean-prose idempotence) | ✓ **PASS** (7/7) |

**All four are real assertions, not stubs.** Spot-checked source confirms substance:

- `triage-injection.test.ts:62-83` asserts the escaped-tag marker is present, that `capturedPrompt.split("</ticket_content>").length - 1 === 1` (single real fence, breakout escaped), that `[redacted]` is present while `FAKE_SECRET` is absent, that the attacker-demanded `URGENT` did **not** land (`priority === "NORMAL"`), and that exactly one `AuditEvent` row exists with no secret and no leaked system prompt.
- `audit-append-only.test.ts:28-31` asserts `prisma.auditEvent.update(...)` **and** `prisma.auditEvent.delete(...)` both `rejects.toThrow()` — enforced at the DB level, not in application code.
- `draft-generation.test.ts:113-131` asserts both untrusted surfaces are fenced (`<kb_source id="1">`, `<ticket_content>`), that a KB-embedded `</kb_source>` breakout was escaped (occurrence count `=== 1`), secret redaction before the provider call, and that the single `DRAFT_GENERATED` audit row stores the **redacted** prompt. Case B (`:173`) asserts `completeOpenAi` was **not** called on the zero-source path while the audit row is still written.
- `llm-redact.test.ts:4-42` asserts exact `[redacted]` substitution per secret class plus non-mangling of ordinary ticket prose.

#### 6. Read-only confirmation

```
$ git status --porcelain      # post-run
                              # (no output)
$ git rev-parse HEAD
89d46005066e191095650c12a9ebdb968589dc78
$ git rev-parse --abbrev-ref HEAD
phase-07-wave-4-launch-readiness
```

Working tree clean before and after; HEAD unchanged. Test runs touched only the ephemeral Testcontainers Postgres and the generated Prisma Client under `src/generated/prisma` (gitignored, regenerated by `global-setup.ts` — not a tracked-file mutation).

---

**VERDICT: PASS** — 107/107 tests green (unit 81/81 across 16 files; integration 26/26 across 11 files), zero failures and zero skips, both suites exiting 0. All four AIDA-20 proof tests pass by name: **triage-injection**, **audit-append-only**, **draft-generation** (Cases A and B), and **llm-redact** (7/7). Integration counts reproduced identically across two independent runs. No finding.

**Post-fix re-runs by this plan (not part of the original sweep, added for completeness):** after each of the five fix commits, `node node_modules/typescript/bin/tsc --noEmit` and `node node_modules/vitest/vitest.mjs run tests/unit` were re-run (both stayed clean throughout, ending at 17 files / 85 tests after FIX 5 added a small pepper-guard test and 2 proxy tests); the full integration suite was re-run once after all five fixes and stayed green at 26/26 across 11 files; `node node_modules/@biomejs/biome/bin/biome check .` was brought from failing to exit 0; and `pnpm build` was run twice (after FIX 4 and again after FIX 5) and succeeded both times. A live end-to-end Playwright run (`tests/e2e/authz.spec.ts`, 2/2 passing in 3.3 minutes) additionally confirmed FIX 1b's global-setup change still creates both the admin and non-admin member users correctly, and that `requireOrgAdmin()` still rejects the non-admin member's `saveSlaTargets` mutation with "Forbidden: admin role required".


### Completeness critic

Scope: I treated the eight sweeps' verdicts as given and hunted only for **surfaces no sweep named**. All work read-only on `phase-07-wave-4-launch-readiness` @ `89d4600`. Raw command output cited inline.

---

## GAP 1 — [HIGH] Unauthenticated self-registration is open on every deployment; one anonymous request permanently bricks first-run setup — **FIXED (`5a259d2`)**

No sweep audited **account provisioning** as an attack surface. Sweep 1 examined `completeSetup` and even analysed its check-then-act race guard, but only asked "can this action be abused?" — never "can the first user be created by a *different* route?"

`/api/auth` is explicitly public (`src/proxy.ts:8`), and `src/lib/auth.ts:9` enables email/password with no sign-up gate:

```
$ grep -n "disableSignUp|trustedProxies|ipAddressHeaders|allowedOrigins" -r src/
No matches found
```

`src/lib/auth.ts:9` is `emailAndPassword: { enabled: true },` — nothing more. Better Auth's own endpoint gate (`node_modules/better-auth/dist/api/routes/sign-up.mjs:143`) rejects only when the feature is off or `disableSignUp` is set:

```js
if (!ctx.context.options.emailAndPassword?.enabled || ctx.context.options.emailAndPassword?.disableSignUp) throw APIError.from("BAD_REQUEST", {
```

So `POST /api/auth/sign-up/email` was reachable by anyone on the internet on every AIDA install.

**The damaging consequence is not the account — it is the bootstrap lockout.** All four first-run gates key on the same global `prisma.user.count()`:

| gate | file:line | behaviour once any user exists |
|---|---|---|
| headless env bootstrap | `src/lib/bootstrap.ts:66-67` | `if (existingCount > 0) return;` |
| setup page | `src/app/(auth)/setup/page.tsx:10-11` | `if (userCount > 0) redirect("/login")` |
| setup Server Action | `src/app/(auth)/setup/actions.ts:39-42` | `return { error: "Setup has already been completed." }` |
| login page | `src/app/(auth)/login/page.tsx:14-15` | `if (userCount === 0) redirect("/setup")` |

An anonymous attacker who signs up before the operator finishes the wizard becomes the sole user. `/setup` then redirects to `/login` forever; `completeSetup` refuses; `organization({ allowUserToCreateOrganization: false })` (`src/lib/auth.ts:23`) means the attacker cannot create an org either. **Recovery requires a manual `DELETE FROM "user"` in Postgres — there is no in-product path.**

Honest scoping, verified rather than assumed:
- **Not privilege escalation.** Mass-assignment self-elevation via the admin plugin is blocked — `node_modules/better-auth/dist/plugins/admin/schema.mjs` declares `role`, `banned`, `banReason`, `banExpires` all with `input: false`.
- **Not data access.** A self-registered user has no `Member` row, so `databaseHooks.session.create.before` (`src/lib/auth.ts:14-17`) sets `activeOrganizationId: null`; `src/app/(app)/layout.tsx:14-22` fails closed with a "No workspace found" message, and every API route wraps `getScopedDb()` in try/catch → 401.
- **The headless path is safe.** `src/instrumentation.ts:4` awaits `bootstrapFromEnv()` before the server listens, so an `ADMIN_EMAIL`-configured install closes the window. The vulnerable path is the **documented default** — `.env.example:31` says "Leave blank to use the interactive `/setup` wizard instead."
- Flood rate is bounded: Better Auth's default special rule caps `/sign-up` at 3 req/10s (`node_modules/better-auth/dist/api/rate-limiter/index.mjs:370-377`). Irrelevant to the lockout, which needs one request.

Fix considered and rejected: `emailAndPassword: { enabled: true, disableSignUp: true }` — the executing plan verified this would also break the three server-side callers that go through the same handler (`src/app/(auth)/setup/actions.ts:45`, `src/lib/bootstrap.ts:19`, `src/lib/demo/identities.ts:79`).

**Fix actually applied (`5a259d2`):** block the HTTP route in `src/proxy.ts` with a `BLOCKED_PUBLIC_ROUTES` check matching the `/api/auth/sign-up` prefix, evaluated *before* the `PUBLIC_PREFIXES` allow-list so `/api/auth`'s own public-prefix match cannot short-circuit past it. `auth.api.signUpEmail()` is an in-process call that never traverses the proxy, so all three legitimate bootstrap paths keep working — verified live end-to-end (`tests/e2e/authz.spec.ts`, 2/2 passing) after also converting the e2e test suite's own second-user creation (`tests/e2e/global-setup.ts`) off the now-blocked HTTP route and onto the same in-process pattern.

---

## GAP 2 — [MEDIUM] Every container runs as root — **Known issue, not fixed (explicit maintainer instruction)**

Sweep 7 audited what packages are *inside* the builder image but never the image's **runtime posture**. The task brief named this ("runs as root? secrets in build args?") and no sweep answered it.

```
$ grep -c "^USER" Dockerfile
0 matches for '^USER'
```

`grep -n "USER|adduser|addgroup|chown" Dockerfile` → `0 matches`. The runner stage (`Dockerfile:60`) is `FROM node:22-alpine AS runner` with no user drop, so `app` (`node server.js`), `worker` (`node dist/worker.mjs`), and `migrate` all execute as uid 0. The `uploads_data` volume mounted at `/data/uploads` (`docker-compose.yml:70`) is written by root, and it is the one directory that receives attacker-supplied bytes from the unauthenticated intake route. Any RCE in the Node process is uid-0 in-container. Upstream Next.js's own standalone Dockerfile creates `nextjs:nodejs` and sets `USER nextjs`; this one omits it.

Secrets-in-build-args, checked and **clean**: `Dockerfile:19` passes only a placeholder `DATABASE_URL`, and `.dockerignore` excludes `.env` / `.env.*` (with `!.env.example`), so the `COPY . .` at `Dockerfile:24` cannot bake an operator's real secrets into the builder layer that `migrate` ships from.

---

## GAP 3 — [MEDIUM] The rate-limit pepper is empty in the shipped Compose path — `ipHash` is an unsalted SHA-256 of a raw IP — **FIXED (`4904bdb`)**

This directly falsifies an invariant the audit was handed ("Rate-limit hits store `sha256(ip + RATE_LIMIT_PEPPER)`; raw IPs are never persisted"). Sweep 2 checked *whether* `checkRateLimit` is called; Sweep 3 checked secrets in logs. Nobody checked the pepper itself.

`src/lib/rate-limit/check-rate-limit.ts:5` (before this plan's fix):
```ts
const PEPPER = process.env.RATE_LIMIT_PEPPER ?? "aida-default-pepper";
```

Two independent defects:
1. `??` only falls back on `undefined`/`null`. `docker-compose.yml:76` injects `RATE_LIMIT_PEPPER: ${RATE_LIMIT_PEPPER:-}` — an operator who doesn't set it gets the variable **defined as empty string**, which `??` does not replace. Demonstrated:

```
$ node scratchpad/pepper.js
PEPPER resolved to: ""
stored ipHash     : d861b7e91033ebc1c1e8e7af3929010158b3241b54ca87ef73e79c32f26400ec
plain sha256(ip)  : d861b7e91033ebc1c1e8e7af3929010158b3241b54ca87ef73e79c32f26400ec
identical?        : true
```
2. Even when the fallback *does* fire (bare `next dev`, no env), the "pepper" is the string `aida-default-pepper` — a public constant in an Apache-2.0 repo, i.e. no secret at all.

Either way `RateLimitHit.ipHash` (`prisma/schema.prisma:466`) was a reversible encoding of a visitor IP: the IPv4 preimage space is 2³² and unsalted SHA-256 inverts in minutes on commodity GPU. For a product whose `docs/SECURITY.md` leads with "privacy-first", a DB dump of `RateLimitHit` was a de-facto raw visitor-IP log. There was no boot-time guard requiring the pepper (unlike `getKey()` in `src/lib/crypto/secret-box.ts:15-16`, which throws when `APP_ENCRYPTION_KEY` is absent — the correct precedent, already in this codebase).

**Fix applied (`4904bdb`):** `||` instead of `??`, plus a lazy `getPepper()` guard (mirroring `secret-box.ts`) that throws a descriptive error if the pepper is empty at hash time, so a build or a test that never calls `checkRateLimit` is unaffected but any real invocation without a real pepper now fails loudly instead of silently degrading to an unsalted or public-constant hash.

---

## GAP 4 — [LOW] Rate-limit keys use the spoofable leftmost `X-Forwarded-For` token; safety is an undocumented property of the shipped Caddyfile — **Known issue, not fixed (not in approved-fixes list)**

All three public routes derive the client identity identically:

```
src\app\api\public\intake\route.ts:40:            const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
src\app\api\public\status\[token]\csat\route.ts:40:      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
src\app\api\public\status\[token]\follow-up\route.ts:41:  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
```

The leftmost XFF token is the classic attacker-controlled position — the vendored dependency's own source says so verbatim (`@better-auth/core@1.6.22/src/utils/ip.ts`, `getIPFromHeader` docblock): *"The leftmost token is spoofable, so with `trustedProxies` the chain is stripped from the right to the first untrusted hop."*

**I initially graded this HIGH and then refuted it against upstream docs — reporting the correction rather than the first impression.** Caddy's documented default (caddyserver/website, `reverse_proxy.md` → Headers → Defaults) is: *"To prevent spoofing, Caddy ignores incoming values for these headers unless `trusted_proxies` are configured globally."* The shipped `Caddyfile:14-17` sets no `trusted_proxies`, and `docker-compose.yml` publishes ports only on the `caddy` service (`:110-112`) — `app` has no `ports:` block. So **in the default topology this is not exploitable**: Caddy overwrites XFF with the real peer IP.

What remains real is the fragility: the sole abuse control on the unauthenticated ticket-creation endpoint is safe *only* by an implicit property of one specific reverse proxy, asserted nowhere in code, `docs/SECURITY.md`, or `docs/OPERATIONS.md`. It silently becomes fully bypassable (rotate a header → new bucket every request → unlimited ticket creation and unlimited `statusToken` probing) the moment an operator does any of: front AIDA with Cloudflare/ALB and set Caddy `trusted_proxies`; swap Caddy for nginx (which appends by default); or expose `app:3000` directly. Those are mainstream self-host topologies for an OSS product. A `trusted_proxies`/right-to-left parse, or at minimum a documented deployment constraint, is warranted.

Same root cause, second instance: `src/lib/auth.ts` sets no `advanced.ipAddress.trustedProxies`. Behind a multi-hop chain, `getIPFromHeader` returns `null` and Better Auth collapses to a **single shared per-path bucket** (`rate-limiter/index.mjs:284-287`, `NO_TRUSTED_IP_KEY`) — at 3 req/10s on `/sign-in`, one attacker could deny login to every agent instance-wide. Conditional on a CDN topology; not reachable behind the shipped Caddyfile.

---

## GAP 5 — [LOW] Admin-authenticated SSRF via the Ollama base URL, with a response oracle — **Known issue, not fixed (not in approved-fixes list)**

Named in the brief, unexamined by any sweep. `ollamaBaseUrl` is stored as a free string with no scheme/host validation (`src/lib/llm/settings.ts:110-112` writes `input.ollamaBaseUrl` verbatim; there is no zod schema on `saveLlmSettings`/`testLlmConnection` inputs, unlike the public routes). It is passed straight to `new Ollama({ host: params.baseUrl })` at `src/lib/llm/providers/ollama.ts:26` and `src/lib/llm/test-connection.ts:31`.

Mostly by design — the base URL is deliberately operator-supplied (`ollama.ts:2-3`), and both entry points are correctly gated by `requireOrgAdmin()` (`src/app/(app)/settings/actions.ts:57`, `:80`). The one avoidable detail: `testLlmConnection` returns the raw failure text to the caller (`actions.ts:93` — `error: String((e as Error).message).slice(0, 200)`), turning the probe into an internal-network scanner with differentiated responses for an org admin. Low severity (admin-only, self-host, operator's own network), but the error should be generalised rather than echoed.

---

## Dimensions the audit was genuinely complete on — verified, no gap

These I checked specifically because the brief flagged them; each is correctly implemented and needs no finding. Stating plainly rather than padding:

- **Append-only `AuditEvent` trigger actually exists in a migration.** `prisma/migrations/20260707053633_ai_foundation/migration.sql:48-57` — `CREATE OR REPLACE FUNCTION aida_audit_event_immutable()` raising unconditionally, wired as `CREATE TRIGGER aida_audit_event_no_update_delete BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW`. Role-independent (not a `REVOKE`), so it survives a `POSTGRES_USER` change — the comment at `:45-47` explains exactly that trade-off. Matches the `docs/SECURITY.md` claim.
- **XSS / `dangerouslySetInnerHTML`.** Exactly one call site (`src/components/tickets/thread-message.tsx:77`). I traced **every** write to `bodyHtml` in `src/`, `prisma/`, `scripts/` — all 8 producers route through `renderMarkdown()` or `sanitizeEmailHtml()` (`create-ticket.ts:103`, `messages/route.ts:93`, `follow-up/route.ts:99`, `create-article.ts:62`/`:99`, `ingest-message.ts:170`/`:177`, `seed-demo-data.ts:408`). `src/lib/markdown/render.ts` is one shared `hast-util-sanitize` schema for both pipelines, and the `input.bodyHtml ?? …` escape hatch at `create-ticket.ts:103` is fed only by `ingest-message.ts:241`, which passes already-sanitized output.
- **Attachment path traversal.** `src/lib/attachments/local-file-storage.ts:11-14` — `safeKey()` enforces `/^[a-z0-9]+\.[a-z0-9]{1,8}$/i` on every read/write/delete, keys are `randomBytes(16)` server-generated (`:33`), and the original filename is metadata only. No user-controlled component ever reaches `path.join`.
- **Attachment MIME handling.** Both upload paths byte-sniff and store the *sniffed* type, never the client-declared one — `intake/route.ts` and `messages/route.ts:65-67` and `ingest-message.ts:131-132`, all checking `ALLOWED_MIME` (which correctly excludes `image/svg+xml`). Serving uses `Content-Disposition: attachment` on both routes, so the stored `mimeType` cannot drive inline rendering.
- **Public status-token entropy/enumeration.** `src/lib/tickets/status-token.ts:7` — `randomBytes(24).toString("base64url")` = 192 bits, with a documented rationale for not reusing the cuid. Not enumerable.
- **pg-boss job payload trust boundary.** Clean by construction: every handler accepts only an opaque ID and re-derives tenancy from the database — `ai-triage.ts:11-19` (`ticketId` → `prisma.ticket.findUnique` → `scopedDb(ticket.organizationId)`), `insight-run.ts:10-12`, `kb-embed-article.ts:20`, `email-outbound-send` (`messageId`). No handler accepts an `orgId` from its payload, so a forged job cannot cross tenants.
- **Server Action CSRF.** `next.config.ts` sets no `experimental.serverActions.allowedOrigins`, which is the *secure* default (Next's built-in Origin↔Host check stays strict); `Caddyfile:16` forwards `X-Forwarded-Host` so the comparison resolves correctly behind the proxy.
- **Session cookie flags.** `secure` is derived from the dynamic request protocol first (`better-auth/dist/cookies/index.mjs:21`), which `Caddyfile:15` supplies via `X-Forwarded-Proto`, so cookies are `Secure` + `SameSite=Lax` behind the shipped stack even though `.env.example` ships `BETTER_AUTH_URL=http://localhost`. `BETTER_AUTH_TRUSTED_ORIGINS` is not referenced in `src/lib/auth.ts`, but Better Auth reads it directly from env (`dist/context/helpers.mjs:83`), so the documented variable is genuinely wired.

---

### Verdict

**FINDING — 5 gaps, none of which any of the eight sweeps named.**

Launch-blocking recommendation: **GAP 1** (open self-registration → unrecoverable first-run lockout on the default install path, fixed by one option) and **GAP 3** (the pepper invariant this audit was handed is false in the shipped Compose path). **GAP 2** should ship-block for a container product on principle — a `USER` line is a two-line diff. **GAP 4** and **GAP 5** are documentation/hardening items, not blockers, and the critic explicitly downgraded GAP 4 after upstream docs refuted its initial HIGH grading.

**Disposition applied by this plan:** GAP 1 and GAP 3 fixed (`5a259d2`, `4904bdb`). GAP 2 left as a known issue per explicit maintainer instruction (do not add a Dockerfile `USER` line in this plan). GAP 4 and GAP 5 left as known issues (not in the maintainer's approved-fixes list).



