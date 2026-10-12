// Phase 14 isolation of every project and activity operation (contract section 17, review C5,
// AIDA-71, SC3): each section 17 actor calls each operation on a private project with the
// expectation of its Isolation class. TARGET: manager succeeds, member reads and gets NOT_ALLOWED
// on MANAGE writes, teamMember (team only, K69), nonMember, orgAdmin and outsider get a result
// deep-equal to the call with missingId(). CREATE: every active member creates in the actor's
// organization. LIST: the private project never appears for those four. TEAM: decided by
// organization membership with private rows left out. The outsider with organization A gets
// MEMBERSHIP_ENDED everywhere; every refused write leaves projectTableSnapshot and the
// ProjectActivity count unchanged. Unmocked; every case seeds fresh organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listProjectActivity, listTaskActivity, listTeamActivity } from "@/lib/projects/activity";
import type { ProjectActor } from "@/lib/projects/contract";
import {
  changeProjectKeyPrefix,
  createProject,
  getProject,
  listProjects,
  moveProjectPosition,
  setProjectPrivacy,
  setProjectStatus,
  updateProject,
} from "@/lib/projects/projects";
import {
  actorOf,
  missingId,
  type PrivacyWorld,
  projectTableSnapshot,
  seedActivity,
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
const outsiderInA = (w: PrivacyWorld) => actorOf(w.users.outsider, w.orgA);

async function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

/** Calls a refused write and checks that organization A changed nowhere. */
async function refusedWrite(w: PrivacyWorld, run: () => Promise<unknown>): Promise<unknown> {
  const before = await projectTableSnapshot(prisma, w.orgA);
  const count = await activityCount(w.orgA);
  const result = await run();
  expect(await projectTableSnapshot(prisma, w.orgA)).toEqual(before);
  expect(await activityCount(w.orgA)).toBe(count);
  return result;
}

/** TARGET read: refused actors deep-equal missingId(), outsider in A MEMBERSHIP_ENDED. */
async function expectTargetRead(w: PrivacyWorld, call: Call, id: string): Promise<void> {
  expect(await call(w.actors.manager, id)).toMatchObject({ ok: true });
  expect(await call(w.actors.member, id)).toMatchObject({ ok: true });
  for (const actor of refusedActors(w)) {
    const result = await call(actor, id);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(result).toEqual(await call(actor, missingId()));
  }
  expect(await call(outsiderInA(w), id)).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
}

/** TARGET MANAGE write: every refusal changes nothing; then the manager succeeds. */
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

describe("createProject (CREATE)", () => {
  it("every active member creates in the actor's organization; the outsider with organization A gets MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    for (const [i, actor] of [
      w.actors.nonMember,
      w.actors.teamMember,
      w.actors.orgAdmin,
    ].entries()) {
      const created = await createProject(actor, { name: `Own ${i}`, keyPrefix: `OWN${i}` });
      expect(created).toMatchObject({ ok: true, keyPrefix: `OWN${i}` });
      if (!created.ok) throw new Error("unreachable");
      expect(
        await prisma.projectActivity.count({
          where: { organizationId: w.orgA, projectId: created.projectId, verb: "PROJECT_CREATED" },
        }),
      ).toBe(1);
    }
    const inB = await createProject(w.actors.outsider, { name: "Theirs", keyPrefix: "THEIRS" });
    expect(inB).toMatchObject({ ok: true });
    if (!inB.ok) throw new Error("unreachable");
    expect(
      await prisma.project.count({ where: { organizationId: w.orgB, id: inB.projectId } }),
    ).toBe(1);
    expect(
      await refusedWrite(w, () =>
        createProject(outsiderInA(w), { name: "Intruder", keyPrefix: "INTRUDE" }),
      ),
    ).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});

describe("getProject (TARGET)", () => {
  it("manager and member read; refused actors equal a missing id", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetRead(w, (actor, id) => getProject(actor, id), w.project.id);
  });
});

describe("listProjects (LIST)", () => {
  it("the private project appears for manager and member only; the outsider with organization A gets MEMBERSHIP_ENDED", async () => {
    const w = await seedPrivacyWorld(prisma);
    const ids = async (actor: ProjectActor) => {
      const r = await listProjects(actor, { archived: "include" });
      if (!r.ok) throw new Error(r.code);
      return r.projects.map((p) => p.id);
    };
    expect(await ids(w.actors.manager)).toContain(w.project.id);
    expect(await ids(w.actors.member)).toContain(w.project.id);
    for (const actor of refusedActors(w)) {
      expect(await ids(actor)).not.toContain(w.project.id);
    }
    expect(await ids(w.actors.nonMember)).toContain(w.openProject.id);
    expect(await listProjects(outsiderInA(w))).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});

describe("updateProject (TARGET)", () => {
  it("refusals change nothing; the manager updates", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetWrite(w, (actor, id) => updateProject(actor, id, 0, { name: "Renamed" }));
  });
});

describe("setProjectStatus (TARGET)", () => {
  it("refusals change nothing; the manager sets the status", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetWrite(w, (actor, id) => setProjectStatus(actor, id, 0, "ACTIVE"));
  });
});

describe("setProjectPrivacy (TARGET)", () => {
  it("refusals change nothing; the manager changes privacy", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetWrite(w, (actor, id) => setProjectPrivacy(actor, id, 0, false));
  });
});

describe("changeProjectKeyPrefix (TARGET)", () => {
  it("refusals change nothing; the manager changes the prefix", async () => {
    const w = await seedPrivacyWorld(prisma);
    await expectTargetWrite(w, (actor, id) => changeProjectKeyPrefix(actor, id, 0, "ISOLATED"));
  });
});

describe("moveProjectPosition (TARGET)", () => {
  it("refusals change nothing; the manager moves the project", async () => {
    const w = await seedPrivacyWorld(prisma);
    // The private project (position 0) is first; the manager places it after the open one.
    await prisma.project.updateMany({
      where: { id: w.openProject.id, organizationId: w.orgA },
      data: { position: 5 },
    });
    await expectTargetWrite(w, (actor, id) =>
      moveProjectPosition(actor, id, { placeAfterProjectId: w.openProject.id }),
    );
  });
});

describe("listProjectActivity (TARGET)", () => {
  it("manager and member read the feed; refused actors equal a missing id", async () => {
    const w = await seedPrivacyWorld(prisma);
    await seedActivity(prisma, w.orgA, { projectId: w.project.id });
    await expectTargetRead(w, (actor, id) => listProjectActivity(actor, id), w.project.id);
  });
});

describe("listTaskActivity (TARGET)", () => {
  it("manager and member read the history; refused actors equal a missing id", async () => {
    const w = await seedPrivacyWorld(prisma);
    await seedActivity(prisma, w.orgA, {
      projectId: w.project.id,
      taskId: w.task.id,
      verb: "TASK_UPDATED",
      entityType: "TASK",
      entityId: w.task.id,
    });
    await expectTargetRead(w, (actor, id) => listTaskActivity(actor, id), w.task.id);
  });
});

async function seedTeamRows(w: PrivacyWorld, team: { id: string; name: string }) {
  await seedActivity(prisma, w.orgA, {
    teamId: team.id,
    actorUserId: w.users.orgAdmin,
    verb: "TEAM_CREATED",
    entityType: "TEAM",
    entityId: team.id,
    after: { name: team.name },
    createdAt: new Date(Date.UTC(2026, 0, 1)),
  });
}

async function seedPrivateTeamRow(w: PrivacyWorld) {
  await seedActivity(prisma, w.orgA, {
    projectId: w.project.id,
    teamId: w.team.id,
    actorUserId: w.users.manager,
    verb: "TEAM_ASSIGNED",
    entityType: "PROJECT_TEAM",
    entityId: w.team.id,
    after: { teamId: w.team.id },
    createdAt: new Date(Date.UTC(2026, 0, 2)),
  });
}

describe("listTeamActivity (TEAM)", () => {
  it("organization members get the team's rows without the private ones; the outsider equals a missing id", async () => {
    const w = await seedPrivacyWorld(prisma);
    await seedTeamRows(w, w.team);
    await seedPrivateTeamRow(w);
    for (const actor of [w.actors.nonMember, w.actors.teamMember, w.actors.orgAdmin]) {
      const r = await listTeamActivity(actor, w.team.id);
      if (!r.ok) throw new Error(r.code);
      expect(r.rows.map((row) => row.verb)).toEqual(["TEAM_CREATED"]);
      expect(JSON.stringify(r)).not.toContain(w.project.id);
    }
    const managerFeed = await listTeamActivity(w.actors.manager, w.team.id);
    if (!managerFeed.ok) throw new Error(managerFeed.code);
    expect(managerFeed.rows.map((row) => row.verb)).toEqual(["TEAM_ASSIGNED", "TEAM_CREATED"]);
    const outsider = await listTeamActivity(w.actors.outsider, w.team.id);
    expect(outsider).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(outsider).toEqual(await listTeamActivity(w.actors.outsider, missingId()));
    expect(await listTeamActivity(outsiderInA(w), w.team.id)).toEqual({
      ok: false,
      code: "MEMBERSHIP_ENDED",
    });
  });

  it("hidden private link: a team linked to the private project and an unlinked twin give equal feeds", async () => {
    const w = await seedPrivacyWorld(prisma);
    const twin = await seedTeam(prisma, w.orgA, { memberUserIds: [w.users.teamMember] });
    await seedTeamRows(w, w.team);
    await seedTeamRows(w, twin);
    await seedPrivateTeamRow(w);
    const normalize = async (actor: ProjectActor, team: { id: string; name: string }) => {
      const r = await listTeamActivity(actor, team.id);
      if (!r.ok) throw new Error(r.code);
      const text = JSON.stringify(r).split(team.id).join("TEAM").split(team.name).join("NAME");
      const parsed = JSON.parse(text) as { rows: Record<string, unknown>[] };
      return {
        ...parsed,
        rows: parsed.rows.map((row, i) => ({ ...row, id: `row:${i}`, batchId: "batch" })),
      };
    };
    for (const actor of [w.actors.nonMember, w.actors.orgAdmin]) {
      expect(await normalize(actor, w.team)).toEqual(await normalize(actor, twin));
    }
  });
});
