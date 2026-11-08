---
phase: 10-team
plan: 03
subsystem: workspace-members, tickets
status: complete
tags: [membership, row-lock, owner-floor, deactivation, reassignment, race, audit]
requires:
  - "10-01: org-lock.ts (lockOrganization, FOR NO KEY UPDATE), member-rights.ts (readMemberRights, countOwners, MEMBER_ROLES), member-audit.ts (recordMemberAudit), errors.ts (MemberAdminError)"
  - "10-02: the membership inventory (readMemberRights recognised as a membership reader)"
provides:
  - "src/lib/workspace-members/member-admin.ts: listMembers, changeMemberRole, deactivateMember, reassignOpenTickets, countOpenAssignedTickets, assertOwnerFloor, conservativeRole"
  - "src/lib/tickets/mutations.ts: assignee read with shareLockActiveMembership; assign op onlyIfAssignedTo; ok result skipped (conditional assignments only); FINISHED_STATE_GROUPS"
  - "tests/unit/member-writers.test.ts: static allowlist of member-table writers under src"
affects: [10-05, 10-06, 10-10, 10-12, 10-13]
tech-stack:
  added: []
  patterns:
    - "Organization lock first, then actor and target rights re-read under it, then the write on every member row of the user"
    - "Reassignment after commit through runTicketMutation with a condition read from the locked ticket row"
    - "Assignee member rows FOR SHARE before the ticket lock, so assignment and deactivation serialise without a cycle"
key-files:
  created:
    - src/lib/workspace-members/member-admin.ts
    - tests/integration/team-member-admin.test.ts
    - tests/integration/deactivation-race.test.ts
    - tests/unit/member-writers.test.ts
  modified:
    - src/lib/tickets/mutations.ts
    - src/lib/membership.ts
decisions:
  - "assertOwnerFloor throws LAST_OWNER only when the change removes an owner and would leave none, so admin-right actions still work in an organization whose owner count is 0 because its only owner holds mixed rows (O-4)"
  - "A role change whose every target row already holds the new role writes nothing and adds no audit row"
  - "The ok result of runTicketMutation carries skipped only for a conditional assignment (onlyIfAssignedTo), so the existing toEqual assertions of the Phase 11 and 12.1 suites keep passing unchanged"
  - "reassignOpenTickets requires admin rights (NOT_ALLOWED) and different from and to users (INVALID_REASSIGNEE); a thrown error in one batch is counted as failed (UNEXPECTED) and later batches still run"
  - "Open ticket = current state group not RESOLVED and not CLOSED (FINISHED_STATE_GROUPS in mutations.ts); no group constant existed in the ticket-state module"
metrics:
  duration: "about 72 minutes (2026-11-12T19:49Z to 21:01Z)"
  completed: 2026-11-13
  tasks: 3
  files: 6
estimate:
  tokens: 80000
  tasks: 3
actuals:
  tokens: 25900
  tasks: 3
  commits: 4
commits: 4
plan_head_before: bc64fb4ab21ca63820e19c6cf3ac421a55ba5c0a
---

# Phase 10 Plan 03: Team administration service with the owner floor, deactivation and safe reassignment Summary

`member-admin.ts` lists members, changes roles and deactivates members. Each write runs in one transaction that takes the organization lock first and re-reads actor and target rights over every member row (V-26). It writes every row of the target and one MemberAuditEvent per change. Reassigning a deactivated member's open tickets happens after the commit, through `runTicketMutation` with an `onlyIfAssignedTo` condition. `runTicketMutation` now share-locks the assignee's member rows. Forced-order races prove all of this on Testcontainers in both commit orders, with no deadlock.

## What was built

- **`changeMemberRole({ orgId, actorUserId, targetUserId, newRole }, hooks?)`**: rejects a role outside owner, admin and member with INVALID_ROLE before any query. Then: `lockOrganization`, actor `readMemberRights` (not isAdmin → NOT_ALLOWED), target (no row → NOT_A_MEMBER), SELF_CHANGE, any `owner` row on the target with a non-owner actor → NOT_ALLOWED, new role `owner` with a non-owner actor → NOT_ALLOWED, `assertOwnerFloor` on `countOwners`. After that it runs `updateMany` on every target row not yet holding the new role. When the target's rights drop, it cancels the pending invitations the target sent and writes one INVITATION_REVOKED row each. Last comes ROLE_CHANGED with the old conservative role. It returns `{ ok: true, owners, admins }`, counted after the change; `admins` means plain admins, so owners are not counted twice.
- **`deactivateMember({ orgId, actorUserId, targetUserId }, hooks?)`** with hooks `beforeLock`, `afterLock` and `afterDelete`. Order: lock, the same check order, the floor, then one `deleteMany` of every target row in the organization. Next, `afterDelete`, then the target's sessions on this organization move to the organization of the oldest remaining member row (createdAt, then id), or to null. Then it cancels pending invitations in this organization: those sent by the target and those addressed to the target's email (trimmed, case-insensitive), with INVITATION_REVOKED rows. Last is MEMBER_DEACTIVATED. It locks and writes no ticket. It changes no ProjectMember or TeamMember row. The user row and the target's other memberships stay. It returns `owners`, `admins`, `sessionsMoved` and `invitationsRevoked`.
- **`reassignOpenTickets({ orgId, actorUserId, fromUserId, toUserId }, hooks?)`**: lists the open tickets assigned to `fromUserId` in id order. For each chunk of at most `MAX_BULK_TICKETS` it calls `runTicketMutation` (mode bulk, `{ kind: "assign", assigneeId: toUserId, onlyIfAssignedTo: fromUserId }`). It returns `reassigned`, `skipped`, `failed` and `batchErrors`. A refused batch does not stop the later ones, and calling it again retries what is still assigned. **`countOpenAssignedTickets(orgId, userId)`** uses the same open definition.
- **`listMembers(orgId)`**: one entry per distinct user (`userId, name, email, image, role, joinedAt`) with the conservative role. Order: owners, admins, members, then name case-insensitively, then userId.
- **`mutations.ts`**: step 3 reads the assignee with `shareLockActiveMembership` (every row FOR SHARE, in id order) instead of `findActiveMembership`, keeping MEMBER_NOT_ACTIVE. The assign op gains the optional `onlyIfAssignedTo`. When it is set, groups are also read in step 6. A ticket whose locked row is no longer assigned to that user, or whose current group is RESOLVED or CLOSED, is skipped: no update, no audit row, no afterItem. The result then carries `skipped`. The header comment names both changes. The step order of `:6-24` is unchanged, and the actor read stays a plain `findActiveMembership`.
- **`member-writers.test.ts`**: walks the src AST. It flags `<receiver>.member.<write method>(…)` calls, string or template literals with `INSERT INTO "member"`, `UPDATE "member"` or `DELETE FROM "member"`, and `….api.<createOrganization|addMember|removeMember|updateMemberRole|leaveOrganization|acceptInvitation>(…)`. The allowlist is by file, with reasons: `src/lib/bootstrap.ts`, `src/app/(auth)/setup/actions.ts`, `src/lib/demo/identities.ts` and `src/lib/workspace-members/member-admin.ts`. Fixtures cover a flagged `prisma.member.create`, every write method, raw SQL, the auth API writers, and a stale or empty allowlist entry.

## Verification

All Docker steps ran with `AIDA_TEST_RUN_ID=mwdyj6p4-818dcfc6068a77a1`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. Before each task's Docker step, `colima status` exited 0 and `docker info` exited 0 (server 29.5.2, colima).

| Command | Exit | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/member-writers.test.ts` (Task 1) | 0 | 1 file, 10 passed |
| `pnpm test tests/unit/member-writers.test.ts` (the script runs all of `tests/unit`), after each task | 0 | 104 files, 1834 passed |
| `pnpm test:integration tests/integration/team-member-admin.test.ts` (Task 1) | 0 | 1 file, 15 passed |
| RED, Task 2: `pnpm test:integration tests/integration/team-member-admin.test.ts` before the code | 1 | 17 failed, 16 passed ("deactivateMember is not a function"; the invitation case on role change already passed on the Task 1 code) |
| GREEN, Task 2: `pnpm test:integration tests/integration/team-member-admin.test.ts tests/integration/ticket-mutations.test.ts` | 0 | 2 files, 73 passed |
| Task 3: `pnpm test:integration tests/integration/team-member-admin.test.ts tests/integration/deactivation-race.test.ts` | 0 | 2 files, 45 passed (41 and 4) |
| Phase 12.1 race suites: `pnpm test:integration` on ticket-mutations, sla-pause-race, snooze-race, triage-priority-race, ticket-state-delete-race, merge-race-coverage, merge-reply-race, reply-reopen-race and create-ticket-state-race (one command) | 0 | **9 files, 99 passed** (the reporter printed only totals) |
| `pnpm typecheck` (after each task and at the end) | 0 | clean |
| `pnpm lint` | 0 | 703 files, 1 warning, pre-existing in `tests/unit/container-config.test.ts:160` (not touched) |

Acceptance greps: `lockOrganization` 3 in member-admin.ts, and `FOR NO KEY UPDATE` appears on 1 non-comment line of org-lock.ts. `readMemberRights` 4, `countOwners` 6, `recordMemberAudit` 3, `@/` 0. `member-admin.ts` appears 3 times in member-writers.test.ts. `shareLockActiveMembership` 3 and `onlyIfAssignedTo` 11 in mutations.ts. In member-admin.ts: `activeOrganizationId` 2, `canceled` 4, `runTicketMutation` 7, `MAX_BULK_TICKETS` 4, and `FOR UPDATE|"Ticket"` (case-insensitive) 0. `it(` 44 in team-member-admin.test.ts. `waitForBlockedBy` 12 in team-member-admin.test.ts and 6 in deactivation-race.test.ts. In deactivation-race.test.ts: `assertNoDeadlock` 6, `MEMBER_NOT_ACTIVE` 4. `NOT_ALLOWED` 25 in team-member-admin.test.ts. `lock-barrier` 0 in both files. No race case expects LAST_OWNER; only the direct `assertOwnerFloor` cases do.

**How the races are proven.** They use `deferred`, `backendPid` and `waitForBlockedBy` from `tests/support/lock-wait.ts`, and `createObserverClient`, `settleAll` and `assertNoDeadlock` from `tests/support/project-race.ts`. They never use a lock barrier or a sleep. The holder records its PID from inside its own transaction through a service hook: `afterLock` for the team services, `afterDelete` for deactivation first, `afterItem` for the assignment first. It then parks on a deferred. The waiter records its PID through `beforeLock` (team services) or `onTransactionStart` (`runTicketMutation`). Each race passes `waitForBlockedBy(observer.client, holderPid, [waiterPid])`, which must resolve before the holder is released. Each race asserts the loser's error code and the final rows: roles, member rows, MemberAuditEvent rows, ticket assignee and TicketAuditEvent rows. It ends with `assertNoDeadlock`. In the assignment races the commit order is recorded too (`["assignment", "deactivation"]`).

Race outcomes:
- Owners A and B deactivate each other: A ok, B NOT_ALLOWED, one owner, one MEMBER_DEACTIVATED. Demoting each other gives the same result: A owner, B admin.
- O deactivates admin X while X deactivates M: X NOT_ALLOWED, M stays. The variant where X is demoted ends the same way.
- O deactivates X and Y in a forced order: both ok, owner count 1.
- Two admins deactivate one member (two rows): one ok, one NOT_A_MEMBER, one audit row.
- Duplicate rows, no real owner: the mixed owner's grant of owner, queued behind their own held change, is NOT_ALLOWED, and countOwners stays 0. With a real owner: the owner's change of the mixed user to owner makes both rows `owner`. The mixed user's grant queued behind it then re-reads under the lock and succeeds.
- Assignment against deactivation of the assignee: assignment first, the ticket is assigned to X and then X is removed. Deactivation first, the result is MEMBER_NOT_ACTIVE and the ticket is unchanged. Bulk 100 in both orders matches the single cases.

## Callers checked for `onlyIfAssignedTo`

- `src/app/(app)/tickets/bulk-actions.ts`: `bulkOpSchema` is a zod `z.object` with `kind` and `assigneeId` only, and zod strips unknown keys, so a client-sent `onlyIfAssignedTo` never reaches the service.
- `src/app/(app)/tickets/[id]/actions.ts` (`assignTicket`): passes the literal `{ kind: "assign", assigneeId }`.
- `src/app/(app)/tickets/bulk-action-bar.tsx`: a client component that builds `{ kind: "assign", assigneeId }` for `bulkUpdateTickets`.
- The only setter is `reassignOpenTickets` in `src/lib/workspace-members/member-admin.ts`.

## O-8 risk note (owner item 14-o1)

Deactivation is not blocked by private projects and changes no project access rule. ProjectMember and TeamMember rows stay inert, and project access re-reads organization membership. A test proves the ProjectMember row of a deactivated manager stays and the deactivation succeeds. **Risk:** deactivating the last manager of a private project can leave that project unreachable for everyone else under the 14-o1 default. It stays the owner's item; this plan only names it.

## Deviations from Plan

### Auto-fixed and adjusted

1. **[Rule 1 - compatibility] `skipped` only on conditional assignments.** The plan says the ok result carries `skipped` "0 when unused". Nine Phase 11 and 12.1 integration files assert `toEqual({ ok: true, count, batchId })`, which an extra `skipped: 0` would break, and the plan also requires "runTicketMutation without onlyIfAssignedTo behaves exactly as before". So `skipped` is present (0 included) only when `onlyIfAssignedTo` is set. `count` is then the number of tickets changed. Commit f8cd90d.
2. **[Rule 3 - missing reference] No state-group constants in the ticket-state module.** None exist (`ticket-states.ts` exports only types and readers). `FINISHED_STATE_GROUPS = ["RESOLVED", "CLOSED"]` is exported once from `mutations.ts` and imported by `member-admin.ts`, so the skip rule, the list and the count share one definition. Commit f8cd90d.
3. **[Docs] `src/lib/membership.ts` comment** (file not in `files_modified`). Its comment said only `publishProposal` uses `shareLockActiveMembership`. It now also names `runTicketMutation` (V-25). The comment is the only change in that file. Commit f8cd90d.
4. **[Helper] `createServiceRace` not used.** It is bound to the projects service observer (`setProjectServiceObserverForTests`), and neither the team services nor `runTicketMutation` report to it. The races use the services' own hooks with `deferred` and `backendPid` instead. `createObserverClient`, `settleAll` and `assertNoDeadlock` from `project-race.ts` are used.
5. **[Rule 2 - authorization] `reassignOpenTickets`** refuses an actor without admin rights (NOT_ALLOWED) and equal from and to users (INVALID_REASSIGNEE). The plan does not list these checks. A `beforeBatch` test seam was added so the "changed between list and batch" cases can be forced.
6. **[Interpretation] `assertOwnerFloor`** throws only when the change removes an owner. Without this, an organization whose owner count is 0 because of mixed duplicate rows would refuse every admin-right action with LAST_OWNER. The plan's direct cases all hold.
7. **[Interpretation] Role change no-op.** When every row already holds the new role, nothing is written and no ROLE_CHANGED row is added.
8. **[Extra fields]** `deactivateMember` also returns `sessionsMoved` and `invitationsRevoked`, and `listMembers` entries also carry `image` and `joinedAt` (for 10-10 and 10-12). Additive.

### Not in this plan

- V-25's "SLA pass against deactivation" race belongs to plan 10-06 (its Task list names it). It is not run here.

## Owner items and defaults used

- O-4: no member constraint. Writes act on every row of the user. An owner with an extra `admin` row is not an owner, so with no other owner countOwners is 0 and owner-right actions fail NOT_ALLOWED (fail-closed, tested).
- O-7 (b) default: a ticket whose assignee was deactivated keeps the former member as assignee, and reassignment is offered, never forced.
- O-8 (14-o1) default: see the risk note above.
- O-10 default: the claim is "the organization keeps at least one owner, who holds every admin right".

## Ledger rows applied

- R3-3 / V-16 supersede Round 2's `pidRecorder` and `waitForLockWaiter`, and the races use `backendPid` and `waitForBlockedBy`. R2-4 is applied: the races expect NOT_ALLOWED and NOT_A_MEMBER, and LAST_OWNER is proven only by direct `assertOwnerFloor` cases. R2-6 is applied: the lock SQL lives in `org-lock.ts`. C3 is applied: owners and admins are counted and returned.
- V-25 is applied: lock strength from 10-01, deactivation order, no ticket lock, reassignment after commit with the "still assigned and still open" condition, share-locked assignee read, both orders and bulk 100 with assertNoDeadlock, and the 12.1 suites re-run. V-26 (1) to (6) are applied, and V-14's folder name is used.
- The Phase 12.1 lock order at `mutations.ts:6-24` is unchanged. Only step 3's assignee read changed (plain read to FOR SHARE, still before the ticket lock), along with the step 6 and 7 additions for conditional assignments. The 10-01 migration is untouched.

## Prohibitions

- "MUST NOT leave an organization without an owner": tested by the owner-pair deactivation and demotion races, the adjacency cases (with one owner, an admin on the owner gets NOT_ALLOWED and the owner on themselves gets SELF_CHANGE), the duplicate-row cases and the direct floor cases.
- "MUST NOT overwrite an assignment made after a deactivation committed": tested by "a ticket reassigned or resolved between the list and the batch is skipped and counted". The other user's assignment stays, and no audit row is written for that ticket.

## Threat Flags

None. No new endpoint or route; the service has no caller yet (10-10 adds the actions).

## Known Stubs

None.

## Run notes

- `.next` was not touched. No Docker resource was created by hand. Testcontainers ran under the run id, and `pnpm test:docker-cleanup --apply` was not run.
- Scratch directory `${TMPDIR}/aida-10-03-58nFTa` (logs only) is removed at the end of the run.
- `prisma generate` ran inside the integration global setup into the ignored `src/generated`. No tracked file changed.
- `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` were not edited, and no `state.*`, `roadmap` or `requirements` command was run.

## Self-Check: PASSED

- FOUND: src/lib/workspace-members/member-admin.ts, tests/integration/team-member-admin.test.ts, tests/integration/deactivation-race.test.ts, tests/unit/member-writers.test.ts
- FOUND commits: dbeaffe, f2ca874, f8cd90d, ad8c197
