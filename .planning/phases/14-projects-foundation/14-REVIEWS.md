# Phase 14: Projects Foundation — Plan Reviews

Reviews run under `run-loop/PIAGAM.md` step 5: Codex reads a `git archive` export of `HEAD` and gives opinions only. The orchestrator re-checked the factual claims before setting a disposition. The planner must carry every accepted item into the relevant PLAN.md, with a `## Review Dispositions Ledger` / `### Round 1 — <REVIEWS sha>` block in each changed plan.

## Plan checker (before Codex)

- Iteration 1 (three slices): 1 blocker (composite relations to Project and Team not stated for ProjectMember, ProjectTeam, ProjectLabel, ProjectMilestone, ProjectFavorite, no cross-organization tests for some), 9 warnings, 5 info; all verified and fixed in `10b43e0`. Orchestrator decision there: an archived project may still be deleted (hard delete K64 is the clean-up path), recorded as a D-12 deviation in contract section 16.
- Iteration 2: all closed; 3 warnings carried here as P1 to P3.

| ID | Severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| P1 | MEDIUM | 14-04 Task 3 does not state the contract section 17 test shape the 14-13 inventory checks | Verified at 14-04 lines 153, 159, 167 | accept: add the acceptance lines (describe title per operation, call, `missingId()` except createProject and listProjects, MEMBERSHIP_ENDED, write blocks compare `projectTableSnapshot()` and the ProjectActivity count, each verb asserted in an `it` that calls its operation) |
| P2 | MEDIUM | Same gap in 14-10 Task 3 | Verified at 14-10 lines 137, 149 | accept: same lines for its eleven operations (listFavorites exempt from `missingId()`), verbs asserted per operation |
| P3 | MEDIUM | Same gap in 14-12 Task 3; reorderTask has no write check; read_first lacks contract section 5 | Verified at 14-12 lines 123, 129, 140 | accept: same lines; reorderTask and bulkUpdateTasks compare snapshot and activity count; getProjectsProgress exempt from `missingId()`; add section 5 to read_first |

## Codex

### Cycle 1

- Question: `run-loop/codex/fase14-plan-tanya.md` (commit `789fc5f`); answer: `run-loop/codex/fase14-plan-jawab.md`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`.
- Codex verdict: not ready (2 HIGH, 5 MEDIUM).

| ID | Severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| C1 | HIGH | `TASK_MOVED` shows in both project feeds with each side's labelNames, milestoneId and assigneeUserId; redaction covers only project id, name and task key, so a reader of one side sees the other side's private data | Verified: 14-01 line 239 (before and after carry `projectId, taskKey, milestoneId, labelNames, assigneeUserId`); 14-11 line 104 tests only id and key redaction | accept (CONTEXT amendment): every unreadable side is reduced to a fixed safe projection without identifiers, names, labels, milestone or assignee; tests in both directions with distinct secret values on each side and a deep comparison of the whole feed response |
| C2 | HIGH | `addTeamMember` by an organization admin returns NOT_ALLOWED only when the team serves a private project the admin does not manage, while `getTeam` hides that project: the refusal reveals the hidden link | Verified: 14-01 line 199 and 14-08 line 103 | accept (K69, CONTEXT amendment): team membership never grants private-project access; assigning a team to a private project copies its current members into direct ProjectMember rows (manager action, activity recorded); later team changes never change private access; `addTeamMember` no longer depends on private links; tests that two states differing only by a hidden private link give identical results |
| C3 | MEDIUM | Writes to a subtask check its parent's archive state without holding a lock on the parent, so a parent archive can commit between the check and the write | Verified: 14-01 line 189; 14-10 line 107 (archiveTask holds project `FOR SHARE` and locks the archived task only) | accept: every subtask write locks the parent `FOR SHARE` (parent before child, consistent with the global order) and rechecks archive under the lock; archiveTask locks the task `FOR UPDATE`; PID-bound race in both orders with a 40P01 check |
| C4 | MEDIUM | `projectTableSnapshot` orders every table by `id`, but `ProjectTaskCounter` (`projectId @id`) and `TaskLabel` (`@@id([taskId, labelId])`) have no `id` | Verified: 14-02 lines 90 and 125 | accept: each table ordered by its primary key, composite where needed; every table and ProjectActivity stay in the snapshot |
| C5 | MEDIUM | 14-04 asks nonMember and orgAdmin to get a missing-id result for every operation, but `createProject` and `listProjects` do not target a project and `listTeamActivity` uses the team MEMBER level | Verified: 14-04 line 153; 14-01 line 98 | accept: per-operation expectations (create by organization membership; list without private entries; team feed by team policy with private project information filtered), listed in the inventory |
| C6 | MEDIUM | `duplicateTask` must place the copy right after the source but holds the project only `FOR SHARE`, while a rebalance needs `FOR UPDATE` | Verified: 14-11 line 125; 14-01 line 265 | accept: `duplicateTask` uses the PROJECT_UPDATE lock mode, rebalances when no integer fits; tests for adjacent ranks and a duplicate racing a reorder |
| C7 | MEDIUM | The 14-13 inventory checks text co-occurrence and the gate calls that proof of isolation and activity | Verified: 14-13 line 78 | accept: the gate calls the inventory a completeness check only; proof stays in the behaviour tests, which assert per actor the result, snapshot equality and verb values; negative unit tests for the inventory parser |
| C8 | note | Revocation against a Better Auth member delete is narrowed by re-reading membership, not serialized | Verified: 14-01 line 213 | accept as a stated limitation (CONTEXT amendment, tied to 12.2-o4); no claim that every revocation race is closed |
