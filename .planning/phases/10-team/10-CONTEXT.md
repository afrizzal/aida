# Phase 10: Team - Context

**Gathered:** 2026-11-08, by hand under `run-loop/PIAGAM.md` (not `/gsd-discuss-phase`)
**Status:** Ready for UI design contract, then planning
**Sources:** facts checked against the code at `626588a`; Codex brainstorm in `run-loop/codex/fase10-tanya.md` and `fase10-jawab.md`. Every Codex claim used below was re-checked in the code unless marked *unverified*.

<domain>
## Phase Boundary

A workspace can grow past one person, and its members hear about what concerns them: invitations, roles and deactivation, in-app notifications, mentions in internal notes, and a batched email digest. Requirements AIDA-42 to AIDA-46 in `.planning/REQUIREMENTS.md`. No feature beyond those requirements. AI stays out of this phase: nothing here calls `lib/llm/`.

Phases 8 and 9 are **parked** (`08-REVIEWS.md` and `09-REVIEWS.md` → Outcome). Their code does not exist: `better-auth` is still 1.6.22, there is no trusted client-IP helper, no CSP, no immutable-storage protocol and no `backup` service. Phase 10 must not assume any of them, and adds no inline script (ROADMAP → Cross-phase risks, CSP row).

Later phases build on this one: AIDA-83 (Phase 16) extends the AIDA-44 notification system rather than adding a second one, and AIDA-87 (Phase 16) reuses AIDA-42 and AIDA-43. The models here are therefore entity-generic, and the membership helper is the one every later data path must use (Cross-phase risks, deactivation row).

</domain>

<decisions>
## Implementation Decisions

Format: decision, then source. "Codex agreed" means the Codex brainstorm recommended the same thing.

### Better Auth baseline

- **D-01:** Build on `better-auth` 1.6.22 as installed. Record in the phase SUMMARY that a later upgrade (Phase 8 when it returns) must rerun every invitation and membership test of this phase. `@better-auth/cli` is 1.4.21, which does not match the library; do not use the CLI to generate schema in this phase. Schema changes go through hand-written Prisma migrations (D-27). Source: ROADMAP → Cross-phase risks (invitation row); verified `package.json`.

### Invitations (AIDA-42)

- **D-02:** Invitations live in the existing Better Auth `invitation` table (verified in `prisma/schema.prisma`), but AIDA owns the flow: create, revoke and accept are AIDA server actions that enforce every rule below. The organization plugin's own HTTP endpoints that create, accept, cancel or reject invitations, or add, update or remove members, are closed by default (the same way `/api/auth/sign-up` is closed today in `src/proxy.ts`, or by plugin configuration; the planner picks and tests the mechanism). An endpoint may stay open only if a test on 1.6.22 proves it cannot bypass D-03, D-08 or D-09. Reason: two paths to one invariant is how the last-admin rule and role ceilings get bypassed, and the plugin's internal guarantees are *unverified*. Source: Codex recommended the plugin first and closing bypasses when an invariant cannot be enforced; Claude chose app-owned flow with plugin endpoints closed by default (charter decision rule 4: the conservative option on authorization).
- **D-03:** Accept rules, all checked on the server inside one transaction: the invitation is `pending`, not expired, and belongs to this organization; the signed-in user's email equals the invited email (trimmed, case-insensitive); the role is at most the inviter's role, and the inviter is still a member with that role at accept time; the status moves from `pending` to `accepted` with a conditional update, so of two concurrent accepts exactly one creates the membership. Role ceilings at creation: an admin may invite `member` or `admin`; only an owner may invite `owner`. A reused, expired, revoked or mismatched-email token fails with a message that reveals nothing about other organizations. Source: AIDA-42, SEED-007, Codex.
- **D-04:** The link token must be unguessable. If the plugin's invitation id on 1.6.22 is not at least 128 bits of randomness (*unverified*), add a separate token whose hash is stored, and compare hashes. Expiry defaults to 7 days. Tokens never appear in logs, and the accept page sends `Referrer-Policy: no-referrer`. Source: Codex (no token in logs or referrer); expiry is Claude's discretion.
- **D-05:** A person with no account accepts through `/invite/[token]`: the page lets them create an account whose email is fixed to the invited address, then accepts. Holding the emailed link proves control of that address. General sign-up stays closed (`/api/auth/sign-up` remains in `BLOCKED_PUBLIC_ROUTES`), and `allowUserToCreateOrganization: false` stays. `/invite` is added to `PUBLIC_PREFIXES`. A signed-in user whose email differs is told to sign out; nothing is accepted. Source: Codex (onboarding without opening sign-up); verified `src/lib/auth.ts`, `src/proxy.ts`.
- **D-06:** The link's base URL comes from configuration (the app URL setting the deployment already uses; the planner names it, *unverified* which variable), never from the request `Host` header. The invitation email goes through the existing SMTP path in `src/lib/channels/email/`. When SMTP is not configured or the send fails, the inviting admin sees a copyable link, shown only to owners and admins of that organization. Tests use a fake SMTP server; no real email is sent. Source: AIDA-42, Codex.

### Deactivation, roles and audit (AIDA-43)

- **D-07:** Deactivation deletes the `member` row; the global user account is untouched, because the person may belong to other organizations. Coming back means a new invitation. Assigned tickets keep their assignee reference; the Team page offers reassignment but does not force it. Sessions whose `activeOrganizationId` points at the removed organization are moved to another membership of that user or set to null, in the same transaction. Source: Codex; Claude (ticket handling).
- **D-08:** One membership-checking helper. `getScopedDb` (`src/lib/session.ts:38-43`, verified to check only the session and `activeOrganizationId`) and `getOrgRole` re-read the `member` row for (user, active organization) from the database on every call, never trusting the 5-minute cookie cache for membership (verified `cookieCache` in `src/lib/auth.ts`). The `(app)` layout, which today calls only `requireSession` (verified), uses it too. With no membership: pages redirect to a no-access page, server actions and API routes answer 403, and `/api/attachments/[id]` (verified to use `getScopedDb`) answers 404. The planner inventories every caller of `requireSession`, `getCurrentSession`, bare `prisma` and `auth.api` under `src/app` and `src/lib`, routes each through the helper or records why it is exempt, and adds a static test that fails when a new protected path skips it. Source: AIDA-43, Codex.
- **D-09:** Any change that can reduce the number of owners or admins (role change, deactivation, leaving) runs in one transaction that locks the organization row (`SELECT … FOR UPDATE`), re-checks the actor's role, counts owners and admins, applies the change, revokes the pending invitations the target sent, and writes the audit row. Rules: the organization keeps at least one owner; an admin may change or deactivate only `member` and `admin`, never an owner; only an owner may grant or remove `owner`; nobody raises their own role. A Testcontainers test fires two concurrent removals of the last two admins and proves one fails. Source: AIDA-43, Codex.
  *Amended 2026-11-08 after Codex plan review cycle 2, R2-4:* the invariant is "the organization keeps at least one owner". Owners hold every admin right, so it also keeps at least one member with admin rights. "Counts owners and admins" means the transaction counts both, and the floor it enforces is on owners only; there is no floor on plain admins, so an owner may remove the last plain admins. "Two concurrent removals of the last two admins" means two concurrent removals between the last two owners (each removing or demoting the other): exactly one succeeds, the other fails, and one owner remains. Under the rules above the losing call fails because its actor is no longer an owner after the first commits (it is re-read under the lock), not on the owner count; the owner-count check stays as a second guard.
- **D-10:** Deactivation also revokes pending invitations addressed to the removed person's email in that organization, so an old link cannot silently bring them back. Source: Codex (*unverified* risk; Claude adopted it as a rule).
- **D-11:** Add a unique constraint on `member (organizationId, userId)` (verified absent: only two single-column indexes). The migration first checks for duplicates and aborts with a clear message if any exist; it never deletes rows on its own. Source: Codex.
- **D-12:** Team changes are audited in a **new** append-only model `MemberAuditEvent` (organization, actor user id, target user id or invitation id, action, old and new role, timestamp; no email body, no token), with the same database-level append-only protection as `AuditEvent`, and listed in `DOMAIN_MODELS`. `AuditEvent` is not extended: it is AI-shaped (verified: required `provider`, `model`, `input`, `output`, and an AI-only `AuditActionType` enum), and loosening those columns would weaken the AI audit trail. Source: Claude; Codex recommended extending `AuditEvent`.
- **D-13:** No third role. The roles stay `owner`, `admin`, `member` (`src/lib/authz.ts`, verified). Reason: no acceptance criterion in AIDA-42 to AIDA-46 needs one; AIDA-110 (Phase 16) defines a guest role with its own semantics, and a `viewer` now could conflict with it; every extra role multiplies the authorization and deactivation test matrix. Source: AIDA-43 hands this to the CONTEXT; SEED-007 calls the role optional; Codex agreed.

### Notifications (AIDA-44)

- **D-14:** Model `Notification`: `organizationId`, `recipientUserId`, `type` (`ASSIGNED`, `CUSTOMER_REPLY`, `MENTION`, `SLA_AT_RISK`, `SLA_BREACHED`), a stable `eventKey`, a generic `entityType` and `entityId` (ticket now, task in AIDA-83), `readAt`, `archivedAt`, `digestedAt`, `createdAt`. Unique on (`organizationId`, `recipientUserId`, `type`, `eventKey`), so a retry never duplicates and two different replies on one ticket stay two notifications. Listed in `DOMAIN_MODELS`. Source: SEED-008, Codex.
- **D-15:** `scopedDb` injects the organization only for some operations (verified: not `findUnique`, `createMany`, `aggregate`, `groupBy` or raw SQL). So every read and write of notifications goes through one module that uses only scoped operations and always filters `recipientUserId` as well. The unmocked isolation test covers both organization and recipient: another org's notifications and another member's notifications are invisible and immutable. Source: Codex; verified `src/lib/scoped-db.ts`.
- **D-16:** Notifications are created synchronously, in the same transaction as the change that causes them; no pg-boss hop for creation. Recipients: assignment → the new assignee, unless they assigned themselves; customer reply → the current assignee; SLA at-risk or breach → the current assignee; mention → each mentioned member. Recipients who are not current members are skipped. Unassigned tickets produce no reply or SLA notification in this phase (see owner item O-2). Source: Codex; Claude (scope kept to the requirement).
- **D-17:** `assignTicket` (`src/app/(app)/tickets/[id]/actions.ts`, verified to update `assigneeId` with no membership check) validates on the server that the assignee is a current member of the organization. Source: Codex.
- **D-18:** The SLA job (`src/lib/worker/jobs/sla-flag.ts`, verified: two global raw `UPDATE`s) returns the rows it actually flipped (`RETURNING`) and creates the notifications for exactly those rows in the same transaction, with an `eventKey` that identifies the transition; a ticket that breaches directly gets one breach notification. Every path that creates an inbound customer message (email ingest in `src/lib/channels/email/ingest-message.ts`, the public pages under `src/app/(public)/`, and any other the planner finds) emits the customer-reply notification. Source: Codex; the SEED-008 breadcrumb `src/lib/tickets/jobs/` is stale, the job lives in `src/lib/worker/jobs/`.
- **D-19:** A bell in the top bar shows the unread count (unread and not archived), opens a list, and supports mark read, mark all read and archive; archived items leave the bell and the count, read state persists. Updates by polling at a fixed interval; no realtime claim. The UI contract comes from `/gsd-ui-phase 10` and follows `.planning/DESIGN-SYSTEM.md` (top bar §4.2, empty state §4.3). Source: AIDA-44, Codex.

### Mentions (AIDA-45)

- **D-20:** The internal-note composer offers autocomplete from current members of the active organization only, served through the D-08 helper. The client sends the mentioned user ids as structured data next to the body. The server validates each id as a current member, deduplicates, stores them in an org-scoped `MessageMention` model (unique on message and user), and creates one `MENTION` notification each. The body carries a readable `@Name` that renders through `renderMarkdown` in `src/lib/markdown/render.ts` (verified as the sanitized path); no raw HTML, and the mention markup never contains an email address. The exact serialization is the planner's, within these limits. Source: Codex, SEED-008.
- **D-21:** Mentions exist only on `visibility = INTERNAL`. A message with any other visibility that carries structured mention data is rejected by the server, whatever the composer mode was; plain `@text` in a public reply stays plain text and notifies nobody. Leak tests cover a direct HTTP payload, a composer mode switch, the public status page (verified to filter `PUBLIC` in `src/app/(public)/status/[token]/page.tsx`), and the body captured by the fake SMTP from the outbound worker (verified to send only `PUBLIC` in `email-outbound-send.ts`). Whether notes are editable today is *unverified*; this phase adds no note editing. Source: AIDA-45, Codex.

### Preferences and digest (AIDA-46)

- **D-22:** `NotificationPreference` per organization, member and event type, with explicit defaults (in-app on, digest on); a missing row means the default. Turning a type off removes it from the digest; the UI contract may show one or two switches per type. Settings page per DESIGN-SYSTEM. Source: AIDA-46, SEED-008.
- **D-23:** A scheduled pg-boss job builds digests. One transaction claims a batch per recipient: it selects that recipient's unread, unarchived, undigested notifications whose type is enabled, with `FOR UPDATE SKIP LOCKED`, and records a `NotificationDigest` row (organization, recipient, frozen notification ids, status, lease expiry). Before sending, membership and preferences are re-checked. The lease is longer than the SMTP client's explicit connection and send timeouts, so a live sender finishes or aborts before another worker may claim. The batch is marked sent and its notifications stamped `digestedAt` only after the SMTP server accepts the message; a failure before handoff releases the batch for retry. The window "accepted but not recorded" (crash between SMTP acceptance and the commit) is documented in `docs/OPERATIONS.md`; exactly-once is not claimed. Source: AIDA-46, Codex.
- **D-24:** The subject is one constant English string (for example "Your AIDA updates"); the body carries per-type counts, ticket numbers and links into the app only: no customer name, email, ticket subject, message text or `AuditEvent.input`. Digest frequency is an operator setting with a documented default; no digest is attempted when SMTP is off. Tests: two workers racing, a failure before handoff, a failure after handoff, a preference change mid-batch, and a deactivation mid-batch, all with fake SMTP. Source: AIDA-46, SEED-008; Codex proposed an Indonesian subject, but the UI is English and i18n is out of scope (`REQUIREMENTS.md` → Out of scope).
- **D-25:** A deactivated member gets no new notifications (D-16) and no digest (D-23 re-check); their remaining rows in that organization stay inert. Source: AIDA-43.

### Security, egress and docs

- **D-26:** Invitation and digest emails reuse the configured SMTP transport: no new egress destination. `docs/SECURITY.md` records both send paths, and `tests/integration/egress-isolation.test.ts` is extended if it enumerates send paths (the planner checks). `README.md`'s admission that no invite flow exists is corrected only after AIDA-42 closes on evidence. Source: charter → Aturan teknis AIDA; SEED-007.

### Migrations and tests

- **D-27:** Schema changes only through migrations: `prisma migrate dev --create-only`, edited by hand if needed, applied on a fresh database inside the `aida-dev-db` container on `127.0.0.1:55432`, with `DATABASE_URL` passed in the command's environment. Never `prisma db push`, never edit `.env`, never create or remove any other container. Source: charter → Test dan bukti.
- **D-28:** Every new model (`Notification`, `NotificationPreference`, `NotificationDigest`, `MessageMention`, `MemberAuditEvent`) is org-scoped through `scopedDb` with an unmocked Testcontainers isolation test. Source: charter → Aturan teknis AIDA.

### Plan shape

- **D-29:** Suggested waves; the planner may split further, never drop scope. Wave 1: plugin-endpoint closure, the membership helper and its inventory, the last-admin lock, `MemberAuditEvent`, the `member` unique constraint, with concurrency tests. Wave 2: invitations and onboarding; in parallel, the notification model and its organization-and-recipient isolation tests. Wave 3: emitters (assignment with the membership check, every customer-reply path, SLA transitions); mentions with leak tests. Wave 4: the bell and the Team page, preferences, the digest with fake SMTP. Wave 5: E2E acceptance (accept, expiry, org isolation, deactivation, bell, mention), the phase gate and the §9 design checklist. Each plan states its dependencies and fixtures. Source: Codex.

### Claude's Discretion

- Invitation expiry (D-04 default 7 days), polling interval (D-19) and digest default frequency (D-24).
- Where the no-access page lives and its wording (D-08).
- Mention serialization within D-20's limits; one or two preference switches per type (D-22).

</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` AIDA-42 to AIDA-46 (and AIDA-83, AIDA-87, AIDA-110 that build on or border them); `.planning/ROADMAP.md` Phase 10 and Cross-phase risks; `.planning/seeds/SEED-007-team-invite-flow-roles.md`, `SEED-008-notifications-mentions.md`
- `.planning/run-loop/PIAGAM.md`; `.planning/run-loop/codex/fase10-tanya.md`, `fase10-jawab.md`; `.planning/phases/08-security-hardening/08-REVIEWS.md`, `.planning/phases/09-operations/09-REVIEWS.md` (why both are parked)
- `.planning/DESIGN-SYSTEM.md` (§4.2 top bar, §4.3 empty state, §4.4 auth pages for `/invite/[token]`, §9 checklist); `.planning/research/plane-inspiration.md` §4 rows 7 and 8 (behaviour only)
- `.planning/milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md` and `07-SECURITY-PASS.md` (F-16)
- Code: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/session.ts`, `src/lib/authz.ts`, `src/lib/scoped-db.ts`, `src/lib/bootstrap.ts`, `src/proxy.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/tickets/[id]/actions.ts`, the composer in `src/app/(app)/tickets/[id]/`, `src/app/api/attachments/[id]/route.ts`, `src/app/(public)/status/[token]/page.tsx`, `src/lib/markdown/render.ts`, `src/lib/channels/email/`, `src/lib/worker/jobs/sla-flag.ts`, `src/lib/worker/jobs/email-outbound-send.ts`, `src/components/top-bar.tsx`, `prisma/schema.prisma`, `prisma/migrations/` (append-only trigger pattern), `docs/SECURITY.md`, `docs/OPERATIONS.md`, `tests/integration/egress-isolation.test.ts`

</canonical_refs>

<deferred>
## Deferred Ideas

- A third role (`viewer` or light agent): not added (D-13); the guest role is AIDA-110 in Phase 16.
- Notification retention or automatic cleanup: none in this phase; rows are removed with their organization.
- The notification center with categories, unread filter and detail panel: AIDA-83, Phase 16.
- Multi-address invitations and the Members page: AIDA-87, Phase 16.
- Snoozing notifications (SEED-008 mentions `snoozed_till`): not in AIDA-44.

</deferred>

## Owner items (not decided here)

- **O-1:** The pending decision from Phase 8 on how container tests may run on the shared Docker VM. This phase writes no compose-stack test, so it is not blocked; if a charter-mandated gate suite is blocked by that decision, it is recorded as blocked, never as passed.
- **O-2:** Whether customer replies and SLA alerts on **unassigned** tickets should notify someone (for example all admins). That widens AIDA-44 and is a scope decision; until then D-16 notifies the assignee only, and the limitation is documented.
- **O-3:** Adding a third role later (D-13) would change `REQUIREMENTS.md` scope.

## Human boundary

From the charter's phase table: a test with real email stays open for a human. Added here: approval of the look of the bell, the Team page, the invitation page and the preferences page (no visual pass is claimed), and the owner items O-1 to O-3.

## Instruction for the planner

Do not create `checkpoint:human-verify` tasks. Write every human verification as a manual item in the plan and in the SUMMARY, and leave it open. Do not reduce scope: if a plan is too big, split it. Every executor dispatch includes the charter's "Aturan eksekutor" section.

Lessons from the two parked phases, binding here:

- No test may run a real compose stack; the owner's decision on container tests is still pending (O-1).
- Prefer simple mechanisms that Testcontainers can prove: row locks, conditional updates, unique constraints and one transaction, not multi-process protocols. Testcontainers is charter-mandated and needs the Colima socket environment that the orchestrator supplies.
- One test process at a time; long commands write to a log, and exit codes are read without a pipe.
- Email only through a fake SMTP server; no real email, no real credentials, no paid LLM call.
- A mention must never reach a public reply or a customer email; prove it with the D-21 leak tests, not by reading the UI.

## Owner rules of 2026-11-08 (binding, summary)

- **D:** all code is written by Claude (Opus 5.5); Codex reviews only. GSD agents inherit the session model (`model_profile: inherit`); no `model` parameter on dispatch.
- **C:** `workflow.use_worktrees` is `false`; plans run in the main checkout. Temporary exports are deleted only by the round that made them.
- **F:** owner-only decisions (scope, licences, anything that changes `PROJECT.md` or `REQUIREMENTS.md`) are not chosen here; they are O-1 to O-3.
- **G:** no push.
- **A and B:** disk and Docker health are checked every round; Docker is never stopped, restarted or deleted.
- **Container rule:** only projects `aida` and `aida-dev-db`, plus the charter-mandated Testcontainers and `pnpm test:egress` suites.

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

*Phase: 10-team*
*Context gathered: 2026-11-08*
