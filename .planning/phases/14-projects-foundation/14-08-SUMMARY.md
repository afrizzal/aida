---
phase: 14-projects-foundation
plan: 08
subsystem: projects
tags: [members, teams, k69, privacy, races, isolation, activity]
status: complete
requires: [14-06, 14-07]
provides:
  - "members.ts: listProjectMembers, listEligibleAssignees, addProjectMember, removeProjectMember, setProjectMemberRole, activeOrgUserIds"
  - "teams.ts: listTeams, getTeam, createTeam, renameTeam, deleteTeam, addTeamMember, removeTeamMember, listProjectTeams, assignTeamToProject, unassignTeamFromProject"
affects: [14-09, 14-10, 14-11, 14-13, phase-15]
tech-stack:
  added: []
  patterns:
    - "team row locked before project rows (lockTeam, then requireProject or lockProjectsInIdOrder)"
    - "people lists re-read `member` in one statement (activeOrgUserIds) and drop users without a row"
    - "K69 copy: TeamMember rows read under the team FOR SHARE lock, INSERT ... ON CONFLICT DO NOTHING per copied user, one batch"
key-files:
  created:
    - src/lib/projects/members.ts
    - src/lib/projects/teams.ts
    - tests/integration/project-members-teams.test.ts
    - tests/integration/project-access-race.test.ts
    - tests/integration/project-members-isolation.test.ts
  modified: []
decisions:
  - "removeProjectMember checks the actor's own leave at CONTENT (readable, not archived) and every other removal at MANAGE, both under PROJECT_UPDATE; removing a user without a row is a no-op { changed: false }"
  - "Last-manager rule: refused only when the target is an active manager and no other manager has a member row; removing or demoting a manager whose member row is gone never refuses"
  - "setProjectMemberRole on a user without a ProjectMember row is NOT_FOUND; MEMBER_ROLE_CHANGED carries only { role } before and after (update verbs carry changed keys only)"
  - "Organization-admin team operations check the conservative admin role before looking up the team, so a non-admin learns nothing about team ids; assignment and unassignment read membership first (MEMBERSHIP_ENDED), then lock the team FOR SHARE (missing NOT_FOUND), then requireProject at MANAGE with the update lock"
  - "Activity values: TEAM_ASSIGNED after { teamId, teamName }; TEAM_UNASSIGNED before { teamId, teamName }; TEAM_DELETED before { name, memberCount } (all TeamMember rows), projectId null; TEAM_MEMBER_ADDED and TEAM_MEMBER_REMOVED carry { userId } only"
  - "renameTeam checks a clash under the team lock; the lower(name) index stays the fence through mapDatabaseError"
  - "listProjectMembers, listEligibleAssignees, listTeams and listProjectTeams return at most LIST_MAX rows without a cursor (the 14-07 milestone list precedent)"
metrics:
  duration: "about 40 minutes"
  completed: 2026-11-09
estimate:
  tokens: 125000
actuals:
  tokens: 21650
  tasks: 3
  commits: 3
plan_head_before: 9fca02d5f5b67da40da409a3173efae6525cae9a
---

# Phase 14 Plan 08: Project members and teams under K69 Summary

Managers manage direct project members. Every change locks the project FOR UPDATE, and the last manager who still has an organization member row cannot be removed or demoted. Organization admins manage teams, which lock only their own row. Under K69, assigning a team to a private project copies the team's current active members into direct rows, and no later team change touches access. Backend-PID races prove both orders for every revocation path and every team path.

## What was built

- `src/lib/projects/members.ts`:
  - addProjectMember: MANAGE. Eligibility through findConservativeMembership (NOT_ELIGIBLE). INSERT ... ON CONFLICT DO NOTHING with a no-op re-read. Writes MEMBER_ADDED.
  - removeProjectMember: SELF_OR_MANAGE. Writes MEMBER_REMOVED.
  - setProjectMemberRole: writes MEMBER_ROLE_CHANGED.
  - LAST_MANAGER: only managers who still have a member row count.
  - listProjectMembers and listEligibleAssignees leave out users whose member row is gone. On a private project, only active direct members are eligible (K69).
  - The shared `activeOrgUserIds` helper does the member re-read.
- `src/lib/projects/teams.ts`, the ten team operations:
  - addTeamMember, removeTeamMember and renameTeam lock the team only and read no project.
  - deleteTeam locks the team FOR UPDATE, then the assigned projects FOR UPDATE in id order. It writes one TEAM_UNASSIGNED per project plus TEAM_DELETED (no project data) and returns `{ ok: true }`.
  - assignTeamToProject and unassignTeamFromProject lock the team FOR SHARE, then the project FOR UPDATE at MANAGE.
  - The K69 copy reads TeamMember rows under the team lock, keeps active users without a direct row, and writes TEAM_ASSIGNED plus one MEMBER_ADDED per copied user in one batch, returning `copiedUserIds`. Assigning an already-assigned team is a no-op `{ ok: true, changed: false }`.
  - getTeam lists only readable projects. listTeams returns id, name and active member count only.
- Tests:
  - `project-members-teams.test.ts` has 13 cases, including the tracer, the last-manager cases, the people lists, team management, four K69 cases and MEMBERSHIP_ENDED for a removed user.
  - `project-access-race.test.ts` has 10 PID-bound races: both orders for removeProjectMember, setProjectPrivacy, unassignTeamFromProject and deleteTeam, plus the addTeamMember / assignTeamToProject copy race. Every race calls assertNoDeadlock, and none uses a timer.
  - `project-members-isolation.test.ts` has 21 cases: one describe block per operation for all 15, plus 6 "hidden private link" comparisons.

## Verification

| Command | Exit | Result |
|---|---|---|
| Task 1 verify: `pnpm test:integration tests/integration/project-members-teams.test.ts` (Colima variables) | 0 | 2 passed |
| Task 2 verify: same command | 0 | 13 passed |
| Task 3 verify: the three integration files, `pnpm exec next typegen`, `pnpm typecheck`, `pnpm exec biome check src/lib/projects` and the three test files, the 15-describe loop and the hidden-link count (run inside `bash -c`) | 0 | 44 passed in 3 files; biome checked 19 files clean; 6 hidden private link cases |
| Task 3 acceptance greps (race words, `setTimeout|sleep\(` count, both-order loop) | n/a | count 0, loop printed nothing |
| `pnpm typecheck` before each commit | 0 | clean |

## Deviations from Plan

None in behaviour. Notes:
- Acceptance greps for a single-line `export async function <name>(actor` were checked with an equivalent multiline match (perl `-0`), because biome wraps the signatures over several lines.
- The Task 3 verify command was run inside `bash -c` as a precaution. The command itself is unchanged.
- listEligibleAssignees on a private project applies isEligibleAssignee's rule (an active member row and a direct ProjectMember row) to all rows in one member read, so it does not call isEligibleAssignee once per row.

## Threat Flags

None. The new surface is the operations named in the plan's threat register: T-14-38 and T-14-38b (K69, hidden-link comparisons), T-14-39 and T-14-41 (both-order races), and T-14-40 (people-list filtering, with the stated Better Auth limitation of review C8 unchanged).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/projects/members.ts, src/lib/projects/teams.ts, tests/integration/project-members-teams.test.ts, tests/integration/project-access-race.test.ts, tests/integration/project-members-isolation.test.ts
- FOUND commits: 3058056, a8d75e1, 4e2f8b6
