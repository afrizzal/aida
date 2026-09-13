---
id: SEED-007
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions team, members, onboarding, invitations, roles, RBAC, or "second agent"
scope: S-M (1 phase, ~4 plans)
---

# SEED-007: Team invite flow + roles (closes the deferred "no invite flow" gap)

## Why This Matters

This is the one v1 gap that blocks real adoption: an admin cannot onboard a second agent from the UI (`07-09` security pass logged it in `deferred-items.md`, README's "When AIDA is not the right choice" admits it). Plane's flow is the standard shape worth mirroring: invitation row (email, role, signed token, accepted flag) → email with link → accept endpoint validates token **and** that the signed-in email matches → member created with the invited role; an inviter can never grant a role above their own; signed-in users see their pending invites. AIDA already carries Better Auth's `invitation` model in the schema, so most of the plumbing may already exist server-side.

## When to Surface

**Trigger:** new milestone scope mentions team, members, onboarding, invitations, roles, RBAC, or "second agent".

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**S-M** — Settings → Team page (members list, role change, deactivate, invite by email + role), invitation email via the existing SMTP path (falls back to a copyable link when email is off), `/invite/[token]` accept page, role check "cannot grant above own role", audit events, E2E (isolation + accept + expired token). Optional: a third `viewer`/light-agent role.

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 7 (Plane `app/views/workspace/invite.py:52-236`, `db/models/workspace.py:234`).
- Existing schema: `prisma/schema.prisma` (`model invitation`, `model member`, `model organization`) — Better Auth org + admin plugins (01-02).
- Auth wiring: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/authz.ts`; bootstrap of first org/admin: `src/lib/bootstrap.ts` (`createFirstOrgAndAdmin`).
- Outbound email job to reuse: SMTP send path from 03-05 (`src/lib/channels/email/`).
- Where the gap is recorded: `.planning/phases/07-launch-readiness/deferred-items.md` ("From 07-09"), `README.md` comparison footnote.

## Notes

Should be the first seed picked up in v2 — it is cheap and unblocks everything team-related (SEED-005 shared views, SEED-008 mentions).
