// Phase 14 isolation of every member and team operation (contract section 17, review C2 and C5,
// K69, AIDA-71, SC3). Isolation TARGET (the eight project-scoped operations): on a private
// project the manager succeeds, the member reads and gets NOT_ALLOWED on the writes (except their
// own leave), teamMember (team only, K69), nonMember, orgAdmin and outsider get a result deep-equal
// to the call with missingId(), and the outsider with organization A gets MEMBERSHIP_ENDED.
// Isolation TEAM (the seven team operations): decided by organization membership or organization
// admin, never by a project link; the outsider with organization B gets the result of the call
// with missingId() for organization A's team ids; the outsider with organization A gets
// MEMBERSHIP_ENDED; two teams that differ only by a hidden private link give identical results.
// Every refused write leaves projectTableSnapshot and the ProjectActivity count unchanged.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { ProjectActor } from "@/lib/projects/contract";
import {
  addProjectMember,
  listEligibleAssignees,
  listProjectMembers,
  removeProjectMember,
  setProjectMemberRole,
} from "@/lib/projects/members";
import { getProject } from "@/lib/projects/projects";
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
  missingId,
  type PrivacyWorld,
  projectActivityCounts,
  projectTableSnapshotAll,
  seedPrivacyWorld,
  seedTeam,
} from "../support/project-fixtures";

type Call = (actor: ProjectActor, id: string) => Promise<unknown>;

const refusedActors = (w: PrivacyWorld) => [
  w.actors.teamMember,
  w.actors.nonMember,
  w.actors.orgAdmin,
  w.actors.outsider,
];
const plainMembersOfA = (w: PrivacyWorld) => [
  w.actors.manager,
  w.actors.member,
  w.actors.teamMember,
  w.actors.nonMember,
];
const activeMembersOfA = (w: PrivacyWorld) => [...plainMembersOfA(w), w.actors.orgAdmin];
const outsiderInA = (w: PrivacyWorld) => actorOf(w.users.outsider, w.orgA);

/** Calls a refused write and checks that organization A changed nowhere. */
async function refusedWrite(w: PrivacyWorld, run: () => Promise<unknown>): Promise<unknown> {
  const before = await projectTableSnapshotAll(prisma, [w.orgA, w.orgB]);
  const count = await projectActivityCounts(prisma, [w.orgA, w.orgB]);
  const result = await run();
  expect(await projectTableSnapshotAll(prisma, [w.orgA, w.orgB])).toEqual(before);
  expect(await projectActivityCounts(prisma, [w.orgA, w.orgB])).toEqual(count);
  return result;
}

/** TARGET read: manager and member read; refused actors deep-equal missingId(). */
async function expectTargetRead(w: PrivacyWorld, call: Call): Promise<void> {
  const id = w.project.id;
  expect(await call(w.actors.manager, id)).toMatchObject({ ok: true });
  expect(await call(w.actors.member, id)).toMatchObject({ ok: true });
  for (const actor of refusedActors(w)) {
    const result = await call(actor, id);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(result).toEqual(await call(actor, missingId()));
  }
  expect(await call(outsiderInA(w), id)).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
}

/** TARGET MANAGE write: member NOT_ALLOWED, refused actors missingId(), then the manager succeeds. */
async function expectTargetWrite(w: PrivacyWorld, call: Call): Promise<void> {
  const id = w.project.id;
  expect(await refusedWrite(w, () => call(w.actors.member, id))).toEqual({
    ok: false,
    code: "NOT_ALLOWED",
  });
  for (const actor of refusedActors(w)) {
    const result = await refusedWrite(w, () => call(actor, id));
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(result).toEqual(await refusedWrite(w, () => call(actor, missingId())));
  }
  expect(await refusedWrite(w, () => call(outsiderInA(w), id))).toEqual({
    ok: false,
    code: "MEMBERSHIP_ENDED",
  });
  expect(await call(w.actors.manager, id)).toMatchObject({ ok: true, changed: true });
}

/**
 * TEAM write by an organization admin: plain members of A get NOT_ALLOWED, the outsider with
 * organization B gets the result of the call with missingId(), the outsider with organization A
 * MEMBERSHIP_ENDED, all without a change; then the orgAdmin succeeds.
 */
async function expectTeamWrite(
  w: PrivacyWorld,
  call: Call,
  teamId: string,
  success: unknown,
): Promise<void> {
  for (const actor of plainMembersOfA(w)) {
    expect(await refusedWrite(w, () => call(actor, teamId))).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
  }
  const outsider = await refusedWrite(w, () => call(w.actors.outsider, teamId));
  expect(outsider).toEqual(await refusedWrite(w, () => call(w.actors.outsider, missingId())));
  expect(await refusedWrite(w, () => call(outsiderInA(w), teamId))).toEqual({
    ok: false,
    code: "MEMBERSHIP_ENDED",
  });
  expect(await refusedWrite(w, () => call(w.actors.orgAdmin, missingId()))).toEqual({
    ok: false,
    code: "NOT_FOUND",
  });
  expect(await call(w.actors.orgAdmin, teamId)).toEqual(success);
}

/**
 * Hidden private link world (review C2): teams T1 and T2 of organization A with the same members
 * (one fresh user); only T1 is assigned by the private project's manager to the private project,
 * which the orgAdmin and nonMember cannot read.
 */
async function hiddenLinkWorld() {
  const w = await seedPrivacyWorld(prisma);
  const shared = await addOrgMember(prisma, w.orgA, "member");
  const joiner = await addOrgMember(prisma, w.orgA, "member");
  const t1 = await seedTeam(prisma, w.orgA, {
    name: "Hidden link one",
    memberUserIds: [shared.id],
  });
  const t2 = await seedTeam(prisma, w.orgA, {
    name: "Hidden link two",
    memberUserIds: [shared.id],
  });
  expect(await assignTeamToProject(w.actors.manager, w.project.id, t1.id)).toMatchObject({
    ok: true,
    changed: true,
  });
  /** The value with only the given team's id and name replaced by fixed placeholders. */
  const mask = (value: unknown, team: { id: string; name: string }): unknown =>
    JSON.parse(
      JSON.stringify(value).replaceAll(team.id, "<team-id>").replaceAll(team.name, "<team-name>"),
    );
  return { w, t1, t2, shared: shared.id, joiner: joiner.id, mask };
}

describe("listProjectMembers (TARGET)", () => {
  it("manager and member read, refused actors get the missingId() result, outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetRead(w, (a, id) => listProjectMembers(a, id));
  });
});

describe("listEligibleAssignees (TARGET)", () => {
  it("manager and member read, refused actors get the missingId() result, outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetRead(w, (a, id) => listEligibleAssignees(a, id));
    const result = await listEligibleAssignees(w.actors.manager, w.project.id);
    expect(result.ok && result.assignees.map((p) => p.userId).sort()).toEqual(
      [w.users.manager, w.users.member].sort(),
    );
  });
});

describe("addProjectMember (TARGET)", () => {
  it("only the manager adds; every refusal changes nothing and matches missingId()", async () => {
    const w = await seedPrivacyWorld(prisma);
    const fresh = await addOrgMember(prisma, w.orgA, "member");
    await expectTargetWrite(w, (a, id) => addProjectMember(a, id, { userId: fresh.id }));
  });
});

describe("removeProjectMember (TARGET)", () => {
  it("only the manager removes others, a member may leave; every refusal changes nothing and matches missingId()", async () => {
    const w = await seedPrivacyWorld(prisma);
    const extra = await addOrgMember(prisma, w.orgA, "member");
    await prisma.projectMember.create({
      data: { organizationId: w.orgA, projectId: w.project.id, userId: extra.id },
    });
    await expectTargetWrite(w, (a, id) => removeProjectMember(a, id, extra.id));
    expect(await removeProjectMember(w.actors.member, w.project.id, w.users.member)).toEqual({
      ok: true,
      changed: true,
    });
  });
});

describe("setProjectMemberRole (TARGET)", () => {
  it("only the manager changes roles; every refusal changes nothing and matches missingId()", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetWrite(w, (a, id) => setProjectMemberRole(a, id, w.users.member, "MANAGER"));
  });
});

describe("listProjectTeams (TARGET)", () => {
  it("manager and member read, refused actors get the missingId() result, outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetRead(w, (a, id) => listProjectTeams(a, id));
  });
});

describe("assignTeamToProject (TARGET)", () => {
  it("only the manager assigns; every refusal changes nothing and matches missingId()", async () => {
    const w = await seedPrivacyWorld(prisma);
    const team = await seedTeam(prisma, w.orgA, { memberUserIds: [w.users.nonMember] });
    await expectTargetWrite(w, (a, id) => assignTeamToProject(a, id, team.id));
    expect(await getProject(w.actors.nonMember, w.project.id)).toMatchObject({ ok: true });
  });
});

describe("unassignTeamFromProject (TARGET)", () => {
  it("only the manager unassigns; every refusal changes nothing and matches missingId()", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetWrite(w, (a, id) => unassignTeamFromProject(a, id, w.team.id));
  });
});

describe("listTeams (TEAM)", () => {
  it("every active member of A gets the same list with no project data; outsider sees its own organization; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    const expected = {
      ok: true,
      teams: [{ id: w.team.id, name: w.team.name, memberCount: 1 }],
      hasMore: false,
      nextCursor: null,
    };
    for (const actor of activeMembersOfA(w)) expect(await listTeams(actor)).toEqual(expected);
    expect(await listTeams(w.actors.outsider)).toEqual({
      ok: true,
      teams: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(await listTeams(outsiderInA(w))).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });

  it("listTeams: hidden private link gives identical entries", async () => {
    const { w, t1, t2, mask } = await hiddenLinkWorld();
    for (const actor of [w.actors.orgAdmin, w.actors.nonMember]) {
      const result = await listTeams(actor);
      if (!result.ok) throw new Error("listTeams refused");
      const one = result.teams.find((team) => team.id === t1.id);
      const two = result.teams.find((team) => team.id === t2.id);
      expect(one).toBeDefined();
      expect(mask(one, t1)).toEqual(mask(two, t2));
    }
  });
});

describe("getTeam (TEAM)", () => {
  it("every active member of A reads the team; the private project is listed only to its readers; outsider gets the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const actor of [w.actors.teamMember, w.actors.nonMember, w.actors.orgAdmin]) {
      const result = await getTeam(actor, w.team.id);
      expect(result).toMatchObject({ ok: true, team: { id: w.team.id, projects: [] } });
      expect(JSON.stringify(result)).not.toContain(w.project.id);
    }
    for (const actor of [w.actors.manager, w.actors.member]) {
      const result = await getTeam(actor, w.team.id);
      expect(result.ok && result.team.projects.map((p) => p.id)).toEqual([w.project.id]);
    }
    const outsider = await getTeam(w.actors.outsider, w.team.id);
    expect(outsider).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(outsider).toEqual(await getTeam(w.actors.outsider, missingId()));
    expect(JSON.stringify(outsider)).not.toContain(w.project.id);
    expect(await getTeam(outsiderInA(w), w.team.id)).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
  });

  it("getTeam: hidden private link gives identical results", async () => {
    const { w, t1, t2, mask } = await hiddenLinkWorld();
    for (const actor of [w.actors.orgAdmin, w.actors.nonMember]) {
      const one = await getTeam(actor, t1.id);
      expect(one).toMatchObject({ ok: true });
      expect(mask(one, t1)).toEqual(mask(await getTeam(actor, t2.id), t2));
    }
  });
});

describe("createTeam (TEAM)", () => {
  it("the orgAdmin creates; plain members and the outsider get NOT_ALLOWED without a change; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const actor of plainMembersOfA(w)) {
      expect(await refusedWrite(w, () => createTeam(actor, { name: "Nope" }))).toEqual({
        ok: false,
        code: "NOT_ALLOWED",
      });
    }
    expect(await refusedWrite(w, () => createTeam(w.actors.outsider, { name: "Nope" }))).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await refusedWrite(w, () => createTeam(outsiderInA(w), { name: "Nope" }))).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
    expect(await createTeam(w.actors.orgAdmin, { name: "Created" })).toMatchObject({
      ok: true,
      team: { name: "Created" },
    });
  });
});

describe("renameTeam (TEAM)", () => {
  it("only the orgAdmin renames; refusals change nothing; outsider gets the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTeamWrite(w, (a, id) => renameTeam(a, id, { name: "Renamed" }), w.team.id, {
      ok: true,
      changed: true,
    });
  });

  it("renameTeam: hidden private link gives identical results", async () => {
    const { w, t1, t2, mask } = await hiddenLinkWorld();
    const one = await renameTeam(w.actors.orgAdmin, t1.id, { name: "Renamed one" });
    const two = await renameTeam(w.actors.orgAdmin, t2.id, { name: "Renamed two" });
    expect(one).toEqual({ ok: true, changed: true });
    expect(mask(one, t1)).toEqual(mask(two, t2));
  });
});

describe("deleteTeam (TEAM)", () => {
  it("only the orgAdmin deletes; refusals change nothing; outsider gets the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTeamWrite(w, (a, id) => deleteTeam(a, id), w.team.id, { ok: true });
  });

  it("deleteTeam: hidden private link gives identical results", async () => {
    const { w, t1, t2, mask } = await hiddenLinkWorld();
    const one = await deleteTeam(w.actors.orgAdmin, t1.id);
    const two = await deleteTeam(w.actors.orgAdmin, t2.id);
    expect(one).toEqual({ ok: true });
    expect(mask(one, t1)).toEqual(mask(two, t2));
    const deletedRow = async (team: { id: string; name: string }) => {
      const row = await prisma.projectActivity.findFirstOrThrow({
        where: { organizationId: w.orgA, teamId: team.id, verb: "TEAM_DELETED" },
        select: { projectId: true, verb: true, entityType: true, entityId: true, before: true },
      });
      return mask(row, team);
    };
    expect(await deletedRow(t1)).toEqual(await deletedRow(t2));
  });
});

describe("addTeamMember (TEAM)", () => {
  it("only the orgAdmin adds; refusals change nothing; outsider gets the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTeamWrite(w, (a, id) => addTeamMember(a, id, w.users.nonMember), w.team.id, {
      ok: true,
      changed: true,
    });
    expect(await getProject(w.actors.nonMember, w.project.id)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("addTeamMember: hidden private link gives identical results and grants nothing", async () => {
    const { w, t1, t2, joiner, mask } = await hiddenLinkWorld();
    const one = await addTeamMember(w.actors.orgAdmin, t1.id, joiner);
    const two = await addTeamMember(w.actors.orgAdmin, t2.id, joiner);
    expect(one).toEqual({ ok: true, changed: true });
    expect(mask(one, t1)).toEqual(mask(two, t2));
    expect(await getProject(actorOf(joiner, w.orgA), w.project.id)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe("removeTeamMember (TEAM)", () => {
  it("only the orgAdmin removes; refusals change nothing; outsider gets the missingId() result; outsider in A MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTeamWrite(w, (a, id) => removeTeamMember(a, id, w.users.teamMember), w.team.id, {
      ok: true,
      changed: true,
    });
  });

  it("removeTeamMember: hidden private link gives identical results", async () => {
    const { w, t1, t2, shared, mask } = await hiddenLinkWorld();
    const one = await removeTeamMember(w.actors.orgAdmin, t1.id, shared);
    const two = await removeTeamMember(w.actors.orgAdmin, t2.id, shared);
    expect(one).toEqual({ ok: true, changed: true });
    expect(mask(one, t1)).toEqual(mask(two, t2));
  });
});
