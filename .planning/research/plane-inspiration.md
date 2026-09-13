# Plane (makeplane/plane) — what AIDA can and cannot take from it

**Date:** 2026-09-13 · **Status:** brainstorm / knowledge capture for v2 (nothing here is scheduled)
**Source:** https://github.com/makeplane/plane — shallow clone inspected on 2026-09-13
(root `package.json` 1.4.2, `apps/api/pyproject.toml` 0.24.0). Every claim below cites a path in that repo.
**Seeds:** each candidate idea is also planted as `.planning/seeds/SEED-001…010` so it surfaces at `/gsd-new-milestone`.

---

## 1. Verdict in three lines

| Option | Feasible? | Why |
|---|---|---|
| **A. Reuse Plane's code inside AIDA** | **No** | License (AGPL-3.0-only vs our Apache-2.0), language (Django/Python + MobX/React-Router vs Next.js/Prisma), and footprint (13 containers vs our single-Postgres compose). |
| **B. Run Plane next to AIDA and bridge them via API** | **Yes — and it is a real helpdesk feature** | "Escalate ticket → work item, sync status back" is the Zendesk↔Jira pattern. Plane exposes a public REST API + HMAC-signed webhooks. Build it as an *adapter* (Plane, GitHub Issues, later Linear/Jira) — same philosophy as `src/lib/llm/`. |
| **C. Re-implement the useful *ideas* in TypeScript** | **Yes (clean-room)** | Ideas are not copyrightable; code, CSS, and assets are. Reimplement from the descriptions in this doc, never from Plane's source. |

**Recommendation:** do **not** turn AIDA into a project-management tool (a helpdesk with a half-PM module loses to both Plane and Zendesk). Do B + the helpdesk-relevant subset of C.

---

## 2. Hard constraints (read before any "let's just copy it")

1. **License.** Plane is **AGPL-3.0-only** for the whole repo (`LICENSE.txt`, `COPYRIGHT.txt` SPDX header, every `package.json`). AIDA is Apache-2.0 and `PROJECT.md` explicitly keeps that door open. Copying any Plane source — including `@plane/editor`, `@plane/ui`, CSS, icons, or screenshots — would force AIDA to AGPL or be a violation. **Rule: no Plane code, ever. Patterns only, written from this doc.**
2. **Stack.** Backend Django 5.2 + DRF + Celery + RabbitMQ + Valkey (Redis) + MinIO; frontend React Router v7 (Vite) + MobX + Tiptap; realtime server Hocuspocus (`apps/api/requirements/base.txt`, `apps/web/package.json`, `apps/live/`). Nothing is drop-in for Next.js 16 + Prisma + pg-boss.
3. **Footprint.** A CE self-host is **13 containers** (`docker-compose.yml`: web, admin, space, live, api, worker, beat-worker, migrator, postgres, valkey, rabbitmq, minio, proxy). AIDA's "one compose, Postgres does queue + vectors" stance (CLAUDE.md) is a genuine differentiator — protect it. Plane's own answer to this pain is an AIO supervisor image (`deployments/aio/community/`), which is itself a hint that the footprint hurts adoption.

---

## 3. Plane vs AIDA at a glance

| Dimension | Plane | AIDA today |
|---|---|---|
| Domain | Project management (work items, cycles, modules, pages) | Customer-support helpdesk (tickets, contacts, KB, SLA, AI) |
| Tenancy | Workspace → Project | Organization (single-level) |
| Work unit | `Issue` with `PROJ-123` sequence, sub-issues, relations, drafts, versions | `Ticket` with per-org `TicketCounter`, no relations/merge |
| Workflow states | Custom `State` per project grouped into `backlog/unstarted/started/completed/cancelled/triage` | Fixed `TicketStatus` enum |
| Intake | `Intake` + `IntakeIssue` (pending/accepted/rejected/snoozed/duplicate) in a hidden triage state | Web form + email → straight into inbox; AI triage sets category/priority/sentiment |
| Views | Saved `IssueView` (private/public, filters JSON), 5 layouts (list/kanban/spreadsheet/calendar/gantt) | Inbox filters (view/status/tag/custom field/FTS), not persisted |
| Collaboration | Notifications inbox, mentions, reactions, subscribers, comments internal/external | Public replies + internal notes; no notifications/mentions |
| Integrations | Public REST `/api/v1/` + API tokens + HMAC webhooks + GitHub/Slack | None (LLM/SMTP/IMAP egress only) |
| Editor | Tiptap + Yjs realtime | Markdown composer (`renderMarkdown`) |
| AI | One `ai-assistant` endpoint (OpenAI-compatible only), "rephrase grammar" in editor, no RAG, no local adapter (`apps/api/plane/app/views/external/base.py`) | Model-agnostic triage + cited RAG drafts + Insight, human gate, egress tests |
| Team | Admin(20)/Member(15)/Guest(5), JWT invite flow, project-level invites | admin/agent; **no invite flow** (deferred item from 07-09) |

Takeaway: AIDA is far ahead on AI and simplicity; Plane is ahead on *inbox ergonomics and collaboration plumbing*. That is exactly the list worth borrowing.

---

## 4. Borrowable patterns (helpdesk-relevant), ranked

Value/cost are relative judgements for a solo maintainer; "Seed" links the GSD seed file.

| # | Pattern (Plane evidence) | AIDA gap it closes | Value | Cost | Seed |
|---|---|---|---|---|---|
| 1 | **Public API + API tokens + signed webhooks.** `/api/v1/` via drf-spectacular (`apps/api/plane/urls.py:22-37`); `X-Api-Key` auth with `expired_at`, `last_used`, per-key rate limit default `60/min` (`api/middleware/api_authentication.py`, `api/rate_limit.py`, `db/models/api.py:23`); webhooks with `X-Plane-Signature` = HMAC-SHA256(secret, body), `X-Plane-Delivery`, `X-Plane-Event`, retry backoff ×5 with jitter, **auto-deactivate + email owner after 5 failures**, SSRF guard (`bgtasks/webhook_task.py:235-390`, `db/models/webhook.py:33`), delivery log with `retry_count`. | No API, no webhooks → AIDA cannot plug into n8n/Zapier/Slack/anything. Prerequisite for #2. | High | M | SEED-002 |
| 2 | **Issue-tracker bridge** (Option B). Plane public API supports create work item, lookup by `PROJ-seq`, relations; webhooks fire on `issue` events. | "Escalate to engineering" from a ticket, status flows back as an internal note. Adapter interface → Plane, GitHub Issues, later Linear/Jira. | High (OSS audience already uses GitHub Issues/Plane) | M | SEED-001 |
| 3 | **Relations + duplicate + snooze.** `IssueRelation.relation_type ∈ {duplicate, relates_to, blocked_by, …}` with a reverse map (`db/models/issue.py:284-296`); `IntakeIssue.status ∈ {pending, rejected, snoozed, accepted, duplicate}` + `snoozed_till` + `duplicate_to` (`db/models/intake.py:40-73`). | No "duplicate of", no merge, no snooze/"waiting on customer until". ITSM angle: many incidents → one problem ticket. | High | M | SEED-003 |
| 4 | **Custom workflow states with state groups.** `State.group` + `sequence` + `default` (`db/models/state.py:14-79`); code reasons about the *group*, users name the *state*; triage states hidden by the default manager (`issue.py:92`). | `TicketStatus` is a fixed enum. Teams want "Waiting on customer", "Escalated", etc. SLA clock should pause on the *pending* group. | Med-High | L (enum → table migration touches SLA, filters, insight SQL) | SEED-004 |
| 5 | **Saved views + bulk operations.** `IssueView` (filters/display JSON, private/public, `is_locked`, `view.py:58`); per-user persisted filter props (`WorkspaceUserProperties`); bulk endpoints (`app/urls/issue.py:89-101`) + `components/issues/bulk-operations`. | Inbox filters are not persisted or shareable; no multi-select actions. | High | S-M | SEED-005 |
| 6 | **Command palette + keyboard-driven inbox ("Power K").** Command registry, context detector, chorded shortcuts with timeout, ignores keystrokes inside inputs/ProseMirror, shortcuts help modal (`apps/web/core/components/power-k/core/{registry,shortcut-handler,context-detector}.ts`). | No shortcuts at all. shadcn `command` (cmdk) is already installed (`src/components/ui/command.tsx`, 02-02). | High (delight, "Linear-feel") | M | SEED-006 |
| 7 | **Invite flow + roles.** `WorkspaceMemberInvite` (email, role, JWT token, accepted) → email task → `…/invitations/<pk>/join/` validates token+email, creates member with invited role; inviter cannot grant a role above their own; pending-invites list for logged-in users (`app/views/workspace/invite.py:52-236`). | **Known v1 gap** (`deferred-items.md`, 07-09): admins cannot onboard a second agent through the UI. Better Auth's `invitation` model already exists in `prisma/schema.prisma:134`. | High (blocks any team using AIDA) | S-M | SEED-007 |
| 8 | **Notifications inbox + mentions.** `Notification` with `read_at/snoozed_till/archived_at`, `UserNotificationPreference`, batched email digest every 5 min (`db/models/notification.py:13-121`); `IssueMention`, editor mention extension. | Agents are not told about assignments, replies, or notes that name them. | Med | M | SEED-008 |
| 9 | **Lifecycle automations.** `Project.archive_in/close_in` (months) + daily Celery beat task auto-archive/close (`bgtasks/issue_automation_task.py`, `celery.py:59`). | No "auto-close RESOLVED after N days of silence". pg-boss cron already runs the SLA flag job. | High | S | SEED-009 |
| 10 | **Repo-health tricks.** `deployments/cli/community/install.sh` (one-liner that pulls compose + env from GitHub releases, with upgrade/backup/restore/logs menu); `.github/workflows/check-version.yml` (PR must bump version); Repobeats + contrib.rocks wall in README; `AGENTS.md` for AI coding agents; `CODEOWNERS`; SPDX header check. | AIDA has CI/templates/docs; missing the one-liner installer, version gate, and social proof widgets. | Med (star-driver) | S | SEED-010 |

### Also noted (no seed — small or debatable)
- **Unified activity timeline**: `IssueActivity` (`verb/field/old_value/new_value/actor`) shares one timeline with comments (`issue.py:415-451`). AIDA's `AuditEvent` covers AI; a per-ticket "status changed by X / assigned to Y" feed would ride on the same table pattern. Fold into SEED-003 or SEED-008.
- **"Polish my reply"** editor AI action (`services/ai.service.ts` → `rephrase-grammar/`). Cheap, popular; must stay inside `lib/llm/` and the human gate. Plane's consent notice UX ("you are sharing with a 3rd-party service") is a good honesty touch for cloud providers.
- **Conditional-unique soft deletes** (`deleted_at IS NULL` in unique constraints, `mixins.py:48-85`). Only if AIDA ever needs "archive ticket"; today hard-delete + append-only audit is fine.
- **Advisory-lock sequence IDs** (`issue.py:186-212`): AIDA already solves this with `TicketCounter.upsert` inside the create transaction (02-03, 20-way concurrency test) — nothing to do.
- **Getting-started checklist** on `WorkspaceMember` (onboarding progress JSON) — nice first-run UX for self-hosters.

### Explicitly *not* worth borrowing for a helpdesk
Cycles/sprints, Modules, Gantt/calendar layouts, Estimates, Pages+Yjs realtime editing (`apps/live` is a whole extra server + Redis), Issue Types/Epics (EE-gated anyway), Stickies, Analytics dashboards (AIDA Insight is the differentiated answer), Plane's AI (thinner than ours; OpenAI-compatible only).

---

## 5. Bridge design sketch (Option B) — for when SEED-001 is picked up

```
Ticket ──"Escalate"──▶ IssueTrackerAdapter.create({title, body, backlink}) ──▶ Plane /api/v1/…/work-items/
   │                                                                          │
   └── TicketExternalLink {provider, externalId, url, lastState}  ◀── webhook (HMAC verified) ◀──┘
                     │
                     └── internal note "Work item PROJ-42 moved to Done" (+ optional AI-drafted customer update, human gate)
```
- Adapter interface in `src/lib/integrations/issue-tracker/` mirroring `src/lib/llm/`: `create`, `getStatus`, `parseWebhook(signature, body)`, `verifySignature`. Secrets encrypted via the existing `src/lib/crypto/` secret-box.
- Inbound webhook route is public → add to `PUBLIC_PREFIXES` in `src/proxy.ts`, rate-limit with `src/lib/rate-limit/`, verify HMAC before parsing, treat payload as **untrusted input** (same prompt-injection rules as ticket text).
- Egress to the tracker is a *new* operator-configured endpoint → update `docs/SECURITY.md`'s egress list and extend `tests/integration/egress-isolation.test.ts`.
- First adapters: Plane (self-host peers) and GitHub Issues (OSS audience). Plane specifics: `X-Api-Key`, per-key rate limit 60/min by default, lookup by `PROJ-seq`, webhook headers `X-Plane-Signature`/`X-Plane-Event`/`X-Plane-Delivery`.

---

## 6. Clean-room rule for everything in §4

When a seed is implemented: the executor reads **this document and the seed**, not Plane's repository. If a detail is missing, describe the *behaviour* here first, then implement. Never paste Plane code, copy CSS/tokens, or reuse its icons/screenshots. Cite this rule in the phase CONTEXT.md.

---

## 7. Suggested v2 grouping (if all of this were a milestone)

1. **Team & inbox ergonomics** — SEED-007 invite flow, SEED-005 saved views + bulk, SEED-006 command palette, SEED-009 auto-close.
2. **Ticket lifecycle** — SEED-003 relations/merge/snooze, SEED-004 custom states + SLA pause, SEED-008 notifications/mentions.
3. **Integrations** — SEED-002 API/tokens/webhooks, then SEED-001 issue-tracker bridge (Plane + GitHub Issues).
4. **Repo health** — SEED-010, any time.

AIDA-18 (KB auto-generation from resolved tickets, the existing backlog item) fits naturally next to group 2.
