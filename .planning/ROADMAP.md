# Roadmap — AIDA (Open-Source AI-Native Helpdesk)

## Milestones

- ✅ **v1.0.0 Minimum Lovable Helpdesk** — Phases 1–7 (shipped 2026-09-13; archive: [`milestones/v1.0.0-ROADMAP.md`](milestones/v1.0.0-ROADMAP.md))
- ⏭ **Next milestone** — not yet defined. Run `/gsd-new-milestone`; the ten dormant seeds in `seeds/` and AIDA-18 surface there. Phase numbering continues at 08.

## Phases

<details>
<summary>✅ v1.0.0 Minimum Lovable Helpdesk (Phases 1–7) — SHIPPED 2026-09-13</summary>

- [x] Phase 1: Foundation (8/8 plans) — completed 2026-06-29
- [x] Phase 2: Core Ticketing (12/12 plans) — completed 2026-07-02
- [x] Phase 3: Email Channel (6/6 plans) — completed 2026-07-06
- [x] Phase 4: AI Foundation (7/7 plans) — completed 2026-07-18
- [x] Phase 5: RAG & Drafted Replies (7/7 plans) — completed 2026-07-22
- [x] Phase 6: AIDA Insight (7/7 plans) — completed 2026-07-24
- [x] Phase 7: Launch Readiness (13/13 plans, incl. inserted gap-closure 07-09.1) — completed 2026-09-03

Coverage: 23/23 MVP requirements validated (AIDA-18 stretch → backlog). Closeout 2026-09-13 as override_closeout (23 acknowledged items — `STATE.md` → Deferred Items); git tag left to `LAUNCH.md`. Full phase goals, plan lists and success criteria: `milestones/v1.0.0-ROADMAP.md`. Phase artifacts: `milestones/v1.0.0-phases/`.

</details>

## Backlog

- **AIDA-18** `Stretch` — AIDA proposes a new KB article drafted from one or more resolved tickets, for admin review/approval. Never scheduled in v1; carried into the next milestone's requirements discussion.
- **Seeds** (auto-surface at `/gsd-new-milestone`; details in `seeds/` and `research/plane-inspiration.md`):
  - SEED-001 issue-tracker bridge (Plane / GitHub Issues) · SEED-002 public API + tokens + signed webhooks · SEED-003 ticket relations / merge / snooze · SEED-004 custom workflow states + SLA pause · SEED-005 saved views + bulk actions · SEED-006 command palette + keyboard inbox · SEED-007 team invite flow + roles · SEED-008 notifications + @mentions · SEED-009 lifecycle automations (auto-close) · SEED-010 repo-health installer + version gate
- Longer-horizon (PROJECT.md Out of Scope until a milestone pulls them in): live chat widget, more channels (WhatsApp/social/voice), i18n UI, SSO/SAML + advanced RBAC, hosted offering.
