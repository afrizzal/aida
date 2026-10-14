// Phase 14 project membership and teams (contract sections 1, 2, 3, 5 and 14; D-04, D-15, C14,
// K69, AIDA-64, AIDA-69) on a real Postgres through Testcontainers: managers add, remove and
// re-role direct members (only active organization members, never the last active manager),
// organization owners and admins manage teams, a team never opens a private project by itself
// (K69), and every list of people leaves out users whose organization member row is gone.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addProjectMember,
  listEligibleAssignees,
  listProjectMembers,
  removeProjectMember,
  setProjectMemberRole,
} from "@/lib/projects/members";
import { getProject, setProjectPrivacy, updateProject } from "@/lib/projects/projects";
import { createTask, updateTask } from "@/lib/projects/tasks";
import {
  addTeamMember,
  assignTeamToProject,
  createTeam,
  deleteTeam,
  getTeam,
  listProjectTeams,
  listTeams,
  removeTeamMember,
  renameTeam,
  unassignTeamFromProject,
} from "@/lib/projects/teams";
import {
  actorOf,
  addOrgMember,
  removeOrgMember,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
} from "../support/project-fixtures";

/** One organization: owner (admin), manager, member and two plain organization members. */
async function world() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member", "member"]);
  const [admin, manager, member, other, extra] = org.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    isPrivate: true,
    managerUserIds: [manager],
    memberUserIds: [member],
  });
  const openProject = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    isPrivate: false,
    managerUserIds: [manager],
  });
  return {
    orgId: org.orgId,
    users: { admin, manager, member, other, extra },
    admin: actorOf(admin, org.orgId),
    manager: actorOf(manager, org.orgId),
    member: actorOf(member, org.orgId),
    other: actorOf(other, org.orgId),
    extra: actorOf(extra, org.orgId),
    project,
    openProject,
  };
}

const activityCount = (orgId: string) =>
  prisma.projectActivity.count({ where: { organizationId: orgId } });
const activityRows = (orgId: string) =>
  prisma.projectActivity.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

describe("addProjectMember (tracer)", () => {
  it("a manager adds a member to a private project, who can then read it and create a task in it", async () => {
    const w = await world();
    expect(await getProject(w.other, w.project.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    const before = await activityCount(w.orgId);
    expect(await addProjectMember(w.manager, w.project.id, { userId: w.users.other })).toEqual({
      ok: true,
      changed: true,
    });
    const rows = await activityRows(w.orgId);
    expect(rows).toHaveLength(before + 1);
    const row = await prisma.projectMember.findFirstOrThrow({
      where: { organizationId: w.orgId, projectId: w.project.id, userId: w.users.other },
    });
    expect(rows.at(-1)).toMatchObject({
      verb: "MEMBER_ADDED",
      entityType: "PROJECT_MEMBER",
      entityId: row.id,
      projectId: w.project.id,
      teamId: null,
      actorUserId: w.users.manager,
      before: null,
      after: { userId: w.users.other, role: "MEMBER" },
    });
    expect(await getProject(w.other, w.project.id)).toMatchObject({ ok: true, myRole: "MEMBER" });
    const created = await createTask(w.other, w.project.id, { title: "From the new member" });
    expect(created).toMatchObject({ ok: true, key: `${w.project.keyPrefix}-1` });
  });

  it("refuses a user without a member row (NOT_ELIGIBLE), a repeat is a no-op and a member is NOT_ALLOWED", async () => {
    const w = await world();
    const stranger = await seedOrgWithMembers(prisma, ["member"]);
    const strangerId = stranger.users[0]?.id as string;
    const before = await activityCount(w.orgId);
    expect(await addProjectMember(w.manager, w.project.id, { userId: strangerId })).toEqual({
      ok: false,
      code: "NOT_ELIGIBLE",
    });
    expect(await addProjectMember(w.manager, w.project.id, { userId: w.users.member })).toEqual({
      ok: true,
      changed: false,
    });
    const fresh = await addOrgMember(prisma, w.orgId, "member");
    expect(await addProjectMember(w.member, w.project.id, { userId: fresh.id })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await activityCount(w.orgId)).toBe(before);
    expect(
      await prisma.projectMember.count({
        where: { organizationId: w.orgId, projectId: w.project.id },
      }),
    ).toBe(2);
  });
});

const memberIds = (result: Awaited<ReturnType<typeof listProjectMembers>>) =>
  result.ok ? result.members.map((m) => m.userId) : [];
const assigneeIds = (result: Awaited<ReturnType<typeof listEligibleAssignees>>) =>
  result.ok ? result.assignees.map((a) => a.userId) : [];
const sorted = (ids: string[]) => [...ids].sort();

describe("removeProjectMember", () => {
  it("a manager removes, a member leaves, a member cannot remove others and the last manager stays", async () => {
    const w = await world();
    await addProjectMember(w.manager, w.project.id, { userId: w.users.other });
    const before = await activityCount(w.orgId);
    expect(await removeProjectMember(w.member, w.project.id, w.users.other)).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await removeProjectMember(w.manager, w.project.id, w.users.manager)).toEqual({
      ok: false,
      code: "LAST_MANAGER",
    });
    expect(await activityCount(w.orgId)).toBe(before);
    const otherRow = await prisma.projectMember.findFirstOrThrow({
      where: { projectId: w.project.id, userId: w.users.other },
    });
    expect(await removeProjectMember(w.manager, w.project.id, w.users.other)).toEqual({
      ok: true,
      changed: true,
    });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "MEMBER_REMOVED",
      entityType: "PROJECT_MEMBER",
      entityId: otherRow.id,
      projectId: w.project.id,
      before: { userId: w.users.other, role: "MEMBER" },
      after: null,
    });
    expect(await getProject(w.other, w.project.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await removeProjectMember(w.member, w.project.id, w.users.member)).toEqual({
      ok: true,
      changed: true,
    });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "MEMBER_REMOVED",
      actorUserId: w.users.member,
      before: { userId: w.users.member, role: "MEMBER" },
    });
    expect(await getProject(w.member, w.project.id)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("only managers who are still organization members count: demoting the remaining active manager is LAST_MANAGER", async () => {
    const w = await world();
    expect(
      await addProjectMember(w.manager, w.project.id, { userId: w.users.other, role: "MANAGER" }),
    ).toEqual({ ok: true, changed: true });
    expect(
      await setProjectMemberRole(w.manager, w.project.id, w.users.other, "MEMBER"),
    ).toMatchObject({ ok: true, changed: true });
    await setProjectMemberRole(w.manager, w.project.id, w.users.other, "MANAGER");
    await removeOrgMember(prisma, w.orgId, w.users.other);
    const before = await activityCount(w.orgId);
    expect(await setProjectMemberRole(w.manager, w.project.id, w.users.manager, "MEMBER")).toEqual({
      ok: false,
      code: "LAST_MANAGER",
    });
    expect(await removeProjectMember(w.manager, w.project.id, w.users.manager)).toEqual({
      ok: false,
      code: "LAST_MANAGER",
    });
    expect(await activityCount(w.orgId)).toBe(before);
  });
});

describe("setProjectMemberRole", () => {
  it("promotes and demotes with MEMBER_ROLE_CHANGED, refuses the last manager and treats the same role as a no-op", async () => {
    const w = await world();
    const row = await prisma.projectMember.findFirstOrThrow({
      where: { projectId: w.project.id, userId: w.users.member },
    });
    expect(await setProjectMemberRole(w.manager, w.project.id, w.users.member, "MANAGER")).toEqual({
      ok: true,
      changed: true,
    });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "MEMBER_ROLE_CHANGED",
      entityType: "PROJECT_MEMBER",
      entityId: row.id,
      before: { role: "MEMBER" },
      after: { role: "MANAGER" },
    });
    expect(await setProjectMemberRole(w.member, w.project.id, w.users.manager, "MEMBER")).toEqual({
      ok: true,
      changed: true,
    });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "MEMBER_ROLE_CHANGED",
      before: { role: "MANAGER" },
      after: { role: "MEMBER" },
    });
    const before = await activityCount(w.orgId);
    expect(await setProjectMemberRole(w.member, w.project.id, w.users.member, "MEMBER")).toEqual({
      ok: false,
      code: "LAST_MANAGER",
    });
    expect(await setProjectMemberRole(w.member, w.project.id, w.users.member, "MANAGER")).toEqual({
      ok: true,
      changed: false,
    });
    expect(await setProjectMemberRole(w.manager, w.project.id, w.users.member, "MEMBER")).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await activityCount(w.orgId)).toBe(before);
  });
});

describe("people lists", () => {
  it("listProjectMembers and listEligibleAssignees leave out removed users; a private project lists direct members only (K69)", async () => {
    const w = await world();
    await addProjectMember(w.manager, w.project.id, { userId: w.users.other });
    await seedTeam(prisma, w.orgId, { memberUserIds: [w.users.extra], projectIds: [w.project.id] });
    const members = await listProjectMembers(w.member, w.project.id);
    expect(members).toMatchObject({ ok: true });
    expect(members.ok && members.members[0]).toMatchObject({
      userId: w.users.manager,
      role: "MANAGER",
      name: expect.any(String),
    });
    expect(sorted(memberIds(members))).toEqual(
      sorted([w.users.manager, w.users.member, w.users.other]),
    );
    expect(sorted(assigneeIds(await listEligibleAssignees(w.member, w.project.id)))).toEqual(
      sorted([w.users.manager, w.users.member, w.users.other]),
    );
    expect(sorted(assigneeIds(await listEligibleAssignees(w.member, w.openProject.id)))).toEqual(
      sorted(Object.values(w.users)),
    );
    await removeOrgMember(prisma, w.orgId, w.users.other);
    expect(sorted(memberIds(await listProjectMembers(w.manager, w.project.id)))).toEqual(
      sorted([w.users.manager, w.users.member]),
    );
    expect(sorted(assigneeIds(await listEligibleAssignees(w.manager, w.project.id)))).toEqual(
      sorted([w.users.manager, w.users.member]),
    );
    expect(assigneeIds(await listEligibleAssignees(w.manager, w.openProject.id))).not.toContain(
      w.users.other,
    );
    expect(
      await prisma.projectMember.count({
        where: { projectId: w.project.id, userId: w.users.other },
      }),
    ).toBe(1);
  });

  it("a user removed from the organization whose TeamMember and ProjectMember rows remain gets MEMBERSHIP_ENDED", async () => {
    const w = await world();
    await seedTeam(prisma, w.orgId, {
      memberUserIds: [w.users.member],
      projectIds: [w.project.id],
    });
    await removeOrgMember(prisma, w.orgId, w.users.member);
    expect(await getProject(w.member, w.project.id)).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await getProject(w.member, w.openProject.id)).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
  });
});

describe("team management", () => {
  it("createTeam, NAME_TAKEN, renameTeam, addTeamMember, NOT_ELIGIBLE and removeTeamMember with their activity rows", async () => {
    const w = await world();
    let count = await activityCount(w.orgId);
    expect(await createTeam(w.member, { name: "Ops" })).toEqual({ ok: false, code: "NOT_ALLOWED" });
    expect(await activityCount(w.orgId)).toBe(count);
    const created = await createTeam(w.admin, { name: "Ops" });
    expect(created).toMatchObject({ ok: true, team: { name: "Ops" } });
    if (!created.ok) throw new Error("no team");
    const teamId = created.team.id;
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "TEAM_CREATED",
      entityType: "TEAM",
      entityId: teamId,
      projectId: null,
      teamId,
      after: { name: "Ops" },
    });
    count = await activityCount(w.orgId);
    expect(await createTeam(w.admin, { name: "ops" })).toEqual({ ok: false, code: "NAME_TAKEN" });
    const second = await createTeam(w.admin, { name: "Support" });
    if (!second.ok) throw new Error("no team");
    expect(await renameTeam(w.admin, second.team.id, { name: "OPS" })).toEqual({
      ok: false,
      code: "NAME_TAKEN",
    });
    expect(await activityCount(w.orgId)).toBe(count + 1);
    expect(await renameTeam(w.admin, teamId, { name: "Operations" })).toEqual({
      ok: true,
      changed: true,
    });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "TEAM_UPDATED",
      projectId: null,
      teamId,
      before: { name: "Ops" },
      after: { name: "Operations" },
    });
    expect(await renameTeam(w.admin, teamId, { name: "Operations" })).toEqual({
      ok: true,
      changed: false,
    });
    expect(await renameTeam(w.member, teamId, { name: "Mine" })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await addTeamMember(w.admin, teamId, w.users.other)).toEqual({
      ok: true,
      changed: true,
    });
    const tm = await prisma.teamMember.findFirstOrThrow({
      where: { teamId, userId: w.users.other },
    });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "TEAM_MEMBER_ADDED",
      entityType: "TEAM_MEMBER",
      entityId: tm.id,
      projectId: null,
      teamId,
      after: { userId: w.users.other },
    });
    count = await activityCount(w.orgId);
    const stranger = await seedOrgWithMembers(prisma, ["member"]);
    expect(await addTeamMember(w.admin, teamId, stranger.users[0]?.id as string)).toEqual({
      ok: false,
      code: "NOT_ELIGIBLE",
    });
    expect(await addTeamMember(w.member, teamId, w.users.extra)).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await addTeamMember(w.admin, teamId, w.users.other)).toEqual({
      ok: true,
      changed: false,
    });
    expect(await activityCount(w.orgId)).toBe(count);
    expect(await removeTeamMember(w.admin, teamId, w.users.other)).toEqual({
      ok: true,
      changed: true,
    });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "TEAM_MEMBER_REMOVED",
      entityType: "TEAM_MEMBER",
      entityId: tm.id,
      projectId: null,
      teamId,
      before: { userId: w.users.other },
    });
  });

  it("listTeams and getTeam work for every active member, show no hidden project and leave out removed users; deleteTeam returns no project data", async () => {
    const w = await world();
    const team = await seedTeam(prisma, w.orgId, {
      name: "Alpha",
      memberUserIds: [w.users.other, w.users.extra],
      projectIds: [w.project.id, w.openProject.id],
    });
    await removeOrgMember(prisma, w.orgId, w.users.extra);
    for (const actor of [w.admin, w.manager, w.member, w.other]) {
      expect(await listTeams(actor)).toEqual({
        ok: true,
        teams: [{ id: team.id, name: "Alpha", memberCount: 1 }],
      });
    }
    const asOther = await getTeam(w.other, team.id);
    expect(asOther).toEqual({
      ok: true,
      team: {
        id: team.id,
        name: "Alpha",
        members: [{ userId: w.users.other, name: expect.any(String) }],
        projects: [{ id: w.openProject.id, name: expect.any(String) }],
      },
    });
    const asManager = await getTeam(w.manager, team.id);
    expect(asManager.ok && asManager.team.projects.map((p) => p.id).sort()).toEqual(
      [w.project.id, w.openProject.id].sort(),
    );
    const otherOrg = await seedOrgWithMembers(prisma, ["owner"]);
    const foreign = await seedTeam(prisma, otherOrg.orgId, { name: "Foreign" });
    expect(await getTeam(w.admin, foreign.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await renameTeam(w.admin, foreign.id, { name: "Mine" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await deleteTeam(w.admin, team.id)).toEqual({ ok: true });
    expect(await listTeams(w.member)).toEqual({ ok: true, teams: [] });
  });
});

// K69 (14-CONTEXT.md, "Amendments after Codex plan review cycle 1", amends D-04 and D-15): a team
// never grants access to a private project by itself. A manager's assignTeamToProject copies the
// team's current active members into direct ProjectMember rows; later team changes, an
// unassignment or a team delete change no project's access.
describe("K69: team assignment copies members, a team grants nothing on a private project", () => {
  async function k69World() {
    const w = await world();
    const u1 = await addOrgMember(prisma, w.orgId, "member");
    const u2 = await addOrgMember(prisma, w.orgId, "member");
    const u3 = await addOrgMember(prisma, w.orgId, "member");
    const u4 = await addOrgMember(prisma, w.orgId, "member");
    await addProjectMember(w.manager, w.project.id, { userId: u2.id });
    const team = await seedTeam(prisma, w.orgId, { memberUserIds: [u1.id, u2.id, u3.id] });
    await removeOrgMember(prisma, w.orgId, u3.id);
    const task = await seedTask(prisma, w.orgId, w.project.id, {
      createdByUserId: w.users.manager,
    });
    return {
      ...w,
      team,
      task,
      u1: actorOf(u1.id, w.orgId),
      u3: actorOf(u3.id, w.orgId),
      u4: actorOf(u4.id, w.orgId),
      ids: { u1: u1.id, u2: u2.id, u3: u3.id, u4: u4.id },
    };
  }

  it("assignTeamToProject on a private project copies the active members without a direct row (TEAM_ASSIGNED and MEMBER_ADDED, one batch)", async () => {
    const w = await k69World();
    expect(await getProject(w.u1, w.project.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    const before = await activityCount(w.orgId);
    expect(await assignTeamToProject(w.manager, w.project.id, w.team.id)).toEqual({
      ok: true,
      changed: true,
      copiedUserIds: [w.ids.u1],
    });
    const rows = (await activityRows(w.orgId)).slice(before);
    expect(rows).toHaveLength(2);
    const assigned = rows.find((row) => row.verb === "TEAM_ASSIGNED");
    const added = rows.find((row) => row.verb === "MEMBER_ADDED");
    const copiedRow = await prisma.projectMember.findFirstOrThrow({
      where: { projectId: w.project.id, userId: w.ids.u1 },
    });
    expect(copiedRow.role).toBe("MEMBER");
    expect(assigned).toMatchObject({
      verb: "TEAM_ASSIGNED",
      entityType: "PROJECT_TEAM",
      projectId: w.project.id,
      teamId: w.team.id,
      actorUserId: w.users.manager,
    });
    expect(added).toMatchObject({
      verb: "MEMBER_ADDED",
      entityType: "PROJECT_MEMBER",
      entityId: copiedRow.id,
      projectId: w.project.id,
      teamId: w.team.id,
      after: { userId: w.ids.u1, role: "MEMBER", teamId: w.team.id },
    });
    expect(added?.batchId).toBe(assigned?.batchId);
    expect(await getProject(w.u1, w.project.id)).toMatchObject({ ok: true, myRole: "MEMBER" });
    expect(await updateTask(w.u1, w.task.id, 0, { title: "Copied member edit" })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    const project = await prisma.project.findFirstOrThrow({ where: { id: w.project.id } });
    expect(await updateProject(w.u1, w.project.id, project.version, { name: "Taken" })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(
      await prisma.projectMember.count({ where: { projectId: w.project.id, userId: w.ids.u3 } }),
    ).toBe(0);
    const again = await activityCount(w.orgId);
    expect(await assignTeamToProject(w.manager, w.project.id, w.team.id)).toEqual({
      ok: true,
      changed: false,
    });
    expect(await activityCount(w.orgId)).toBe(again);
    expect(await listProjectTeams(w.u1, w.project.id)).toEqual({
      ok: true,
      teams: [{ id: w.team.id, name: w.team.name }],
    });
  });

  it("later team changes change no access: a later team member gets nothing, removal, unassignment and deleteTeam keep copied members", async () => {
    const w = await k69World();
    const other = await seedTeam(prisma, w.orgId, { memberUserIds: [w.users.extra] });
    await assignTeamToProject(w.manager, w.project.id, w.team.id);
    await assignTeamToProject(w.manager, w.project.id, other.id);
    expect(await addTeamMember(w.admin, w.team.id, w.ids.u4)).toEqual({ ok: true, changed: true });
    expect(await getProject(w.u4, w.project.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(assigneeIds(await listEligibleAssignees(w.manager, w.project.id))).not.toContain(
      w.ids.u4,
    );
    expect(await removeTeamMember(w.admin, w.team.id, w.ids.u1)).toEqual({
      ok: true,
      changed: true,
    });
    expect(await getProject(w.u1, w.project.id)).toMatchObject({ ok: true });
    expect(await unassignTeamFromProject(w.manager, w.project.id, w.team.id)).toEqual({
      ok: true,
      changed: true,
    });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "TEAM_UNASSIGNED",
      entityType: "PROJECT_TEAM",
      projectId: w.project.id,
      teamId: w.team.id,
    });
    expect(await getProject(w.u1, w.project.id)).toMatchObject({ ok: true });
    expect(await unassignTeamFromProject(w.manager, w.project.id, w.team.id)).toEqual({
      ok: true,
      changed: false,
    });
    const before = await activityCount(w.orgId);
    expect(await deleteTeam(w.admin, other.id)).toEqual({ ok: true });
    const rows = (await activityRows(w.orgId)).slice(before);
    expect(rows.map((row) => row.verb).sort()).toEqual(["TEAM_DELETED", "TEAM_UNASSIGNED"]);
    const deleted = rows.find((row) => row.verb === "TEAM_DELETED");
    expect(deleted).toMatchObject({ projectId: null, teamId: other.id, entityType: "TEAM" });
    expect(deleted?.before).toEqual({ name: other.name, memberCount: 1 });
    expect(JSON.stringify(deleted)).not.toContain(w.project.id);
    expect(rows.find((row) => row.verb === "TEAM_UNASSIGNED")).toMatchObject({
      projectId: w.project.id,
      teamId: other.id,
      batchId: deleted?.batchId,
    });
    for (const actor of [w.u1, w.extra]) {
      expect(await getProject(actor, w.project.id)).toMatchObject({ ok: true });
    }
  });

  it("on a non-private project an assignment copies nothing, setProjectPrivacy copies nothing, and the orgAdmin cannot assign on a private project", async () => {
    const w = await k69World();
    const before = await activityCount(w.orgId);
    expect(await assignTeamToProject(w.admin, w.openProject.id, w.team.id)).toEqual({
      ok: true,
      changed: true,
      copiedUserIds: [],
    });
    const rows = (await activityRows(w.orgId)).slice(before);
    expect(rows.map((row) => row.verb)).toEqual(["TEAM_ASSIGNED"]);
    expect(await getProject(w.u1, w.openProject.id)).toMatchObject({ ok: true, myRole: null });
    expect(await setProjectPrivacy(w.manager, w.openProject.id, 0, true)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await getProject(w.u1, w.openProject.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    const count = await activityCount(w.orgId);
    expect(await assignTeamToProject(w.admin, w.project.id, w.team.id)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await activityCount(w.orgId)).toBe(count);
  });

  it("no private-link refusal (review C2): the orgAdmin adds and removes members of a team serving a private project, which grants nothing", async () => {
    const w = await k69World();
    await assignTeamToProject(w.manager, w.project.id, w.team.id);
    expect(await addTeamMember(w.admin, w.team.id, w.ids.u4)).toEqual({ ok: true, changed: true });
    expect((await activityRows(w.orgId)).at(-1)).toMatchObject({
      verb: "TEAM_MEMBER_ADDED",
      projectId: null,
      after: { userId: w.ids.u4 },
    });
    expect(await getProject(w.u4, w.project.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await removeTeamMember(w.admin, w.team.id, w.ids.u4)).toEqual({
      ok: true,
      changed: true,
    });
  });
});
