// Phase 14 access revocation and team races (contract section 3, D-04, K69, AIDA-71) on a real
// Postgres through Testcontainers, bound to backend PIDs (tests/support/lock-wait.ts) on a
// one-connection observer client, never a timer. Every path runs in both orders:
// - removeProjectMember and setProjectPrivacy(true) hold the project FOR UPDATE: a waiting
//   updateTask by the affected user ends in NOT_FOUND; a content write that commits first is
//   followed by the revocation.
// - unassignTeamFromProject and deleteTeam serialize with a content write by a member copied by
//   assignTeamToProject and leave that member's access unchanged (K69).
// - addTeamMember and assignTeamToProject serialize on the team row: the copy holds exactly the
//   members committed before it.
// Every race ends with assertNoDeadlock (no 40P01).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addTaskComment } from "@/lib/projects/comments";
import { removeProjectMember } from "@/lib/projects/members";
import { getProject, setProjectPrivacy } from "@/lib/projects/projects";
import { updateTask } from "@/lib/projects/tasks";
import {
  addTeamMember,
  assignTeamToProject,
  deleteTeam,
  unassignTeamFromProject,
} from "@/lib/projects/teams";
import { waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  addOrgMember,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
} from "../support/project-fixtures";
import {
  assertNoDeadlock,
  createObserverClient,
  createServiceRace,
  type ServiceRace,
  settleAll,
} from "../support/project-race";

let observer: PrismaClient;
let closeObserver: () => Promise<void>;
let race: ServiceRace | null = null;
const racePids: { race: string; holder: number; waiter: number }[] = [];

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-access-race PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
});

/**
 * Organization with owner, manager, member and nonMember; a private project (manager, member) and
 * a non-private one, each with a task; team T whose member `copied` was copied into the private
 * project by assignTeamToProject (K69), not by a fixture row.
 */
async function world() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member", "member"]);
  const [admin, manager, member, nonMember, copied] = org.users.map((u) => u.id) as [
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
  const task = await seedTask(prisma, org.orgId, project.id, { createdByUserId: manager });
  const openTask = await seedTask(prisma, org.orgId, openProject.id, { createdByUserId: manager });
  const team = await seedTeam(prisma, org.orgId, { memberUserIds: [copied] });
  const a = (id: string) => actorOf(id, org.orgId);
  const assigned = await assignTeamToProject(a(manager), project.id, team.id);
  expect(assigned).toEqual({ ok: true, changed: true, copiedUserIds: [copied] });
  return {
    orgId: org.orgId,
    users: { admin, manager, member, nonMember, copied },
    admin: a(admin),
    manager: a(manager),
    member: a(member),
    nonMember: a(nonMember),
    copied: a(copied),
    project,
    openProject,
    task,
    openTask,
    team,
  };
}

const verbCount = (orgId: string, verb: string) =>
  prisma.projectActivity.count({
    where: { organizationId: orgId, verb: verb as never },
  });
const taskRow = (id: string) => prisma.task.findFirstOrThrow({ where: { id } });

/** Holds `holderOp` after its lock, starts the waiter and proves it blocked by the holder's PID. */
async function holdAndBlock<H, W>(
  name: string,
  holderOp: string,
  runHolder: () => Promise<H>,
  waiterOp: string,
  runWaiter: () => Promise<W>,
): Promise<PromiseSettledResult<H | W>[]> {
  race = createServiceRace();
  const held = race.holdAt(holderOp);
  const holding = runHolder();
  const holder = await held;
  const started = race.nextStartPid(waiterOp);
  const waiting = runWaiter();
  const waiter = await started;
  await waitForBlockedBy(observer, holder, [waiter]);
  racePids.push({ race: name, holder, waiter });
  race.release();
  const results = await settleAll<H | W>([holding, waiting]);
  assertNoDeadlock(results);
  return results;
}

describe("removeProjectMember against updateTask by the removed member", () => {
  it("removeProjectMember: revocation first", async () => {
    const w = await world();
    const results = await holdAndBlock(
      "removeProjectMember then updateTask",
      "removeProjectMember",
      () => removeProjectMember(w.manager, w.project.id, w.users.member),
      "updateTask",
      () => updateTask(w.member, w.task.id, 0, { title: "Too late" }),
    );
    expect(results[0]).toEqual({ status: "fulfilled", value: { ok: true, changed: true } });
    expect(results[1]).toEqual({ status: "fulfilled", value: { ok: false, code: "NOT_FOUND" } });
    const task = await taskRow(w.task.id);
    expect(task.version).toBe(0);
    expect(task.title).not.toBe("Too late");
    expect(await verbCount(w.orgId, "TASK_UPDATED")).toBe(0);
  });

  it("removeProjectMember: content write first", async () => {
    const w = await world();
    const results = await holdAndBlock(
      "updateTask then removeProjectMember",
      "updateTask",
      () => updateTask(w.member, w.task.id, 0, { title: "In time" }),
      "removeProjectMember",
      () => removeProjectMember(w.manager, w.project.id, w.users.member),
    );
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: { ok: true, changed: true, version: 1 },
    });
    expect(results[1]).toEqual({ status: "fulfilled", value: { ok: true, changed: true } });
    expect((await taskRow(w.task.id)).title).toBe("In time");
    expect(await updateTask(w.member, w.task.id, 1, { title: "Again" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe("setProjectPrivacy against updateTask by a non-member", () => {
  it("setProjectPrivacy: revocation first", async () => {
    const w = await world();
    const results = await holdAndBlock(
      "setProjectPrivacy then updateTask",
      "setProjectPrivacy",
      () => setProjectPrivacy(w.manager, w.openProject.id, 0, true),
      "updateTask",
      () => updateTask(w.nonMember, w.openTask.id, 0, { title: "Too late" }),
    );
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: { ok: true, changed: true, version: 1 },
    });
    expect(results[1]).toEqual({ status: "fulfilled", value: { ok: false, code: "NOT_FOUND" } });
    expect((await taskRow(w.openTask.id)).version).toBe(0);
  });

  it("setProjectPrivacy: content write first", async () => {
    const w = await world();
    const results = await holdAndBlock(
      "updateTask then setProjectPrivacy",
      "updateTask",
      () => updateTask(w.nonMember, w.openTask.id, 0, { title: "In time" }),
      "setProjectPrivacy",
      () => setProjectPrivacy(w.manager, w.openProject.id, 0, true),
    );
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: { ok: true, changed: true, version: 1 },
    });
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { ok: true, changed: true, version: 1 },
    });
    expect(await updateTask(w.nonMember, w.openTask.id, 1, { title: "Again" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe("unassignTeamFromProject against updateTask by a copied member (K69: access unchanged)", () => {
  it("unassignTeamFromProject: assignment change first", async () => {
    const w = await world();
    const results = await holdAndBlock(
      "unassignTeamFromProject then updateTask",
      "unassignTeamFromProject",
      () => unassignTeamFromProject(w.manager, w.project.id, w.team.id),
      "updateTask",
      () => updateTask(w.copied, w.task.id, 0, { title: "Still a member" }),
    );
    expect(results[0]).toEqual({ status: "fulfilled", value: { ok: true, changed: true } });
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { ok: true, changed: true, version: 1 },
    });
    expect(await verbCount(w.orgId, "TEAM_UNASSIGNED")).toBe(1);
    expect(await verbCount(w.orgId, "TASK_UPDATED")).toBe(1);
    expect(await updateTask(w.copied, w.task.id, 1, { title: "Again" })).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
  });

  it("unassignTeamFromProject: content write first", async () => {
    const w = await world();
    const results = await holdAndBlock(
      "updateTask then unassignTeamFromProject",
      "updateTask",
      () => updateTask(w.copied, w.task.id, 0, { title: "Still a member" }),
      "unassignTeamFromProject",
      () => unassignTeamFromProject(w.manager, w.project.id, w.team.id),
    );
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: { ok: true, changed: true, version: 1 },
    });
    expect(results[1]).toEqual({ status: "fulfilled", value: { ok: true, changed: true } });
    expect(await updateTask(w.copied, w.task.id, 1, { title: "Again" })).toMatchObject({
      ok: true,
      changed: true,
    });
  });
});

describe("deleteTeam against addTaskComment by a copied member (K69: access unchanged)", () => {
  it("deleteTeam: assignment change first", async () => {
    const w = await world();
    const results = await holdAndBlock(
      "deleteTeam then addTaskComment",
      "deleteTeam",
      () => deleteTeam(w.admin, w.team.id),
      "addTaskComment",
      () => addTaskComment(w.copied, w.task.id, { body: "Waiting comment" }),
    );
    expect(results[0]).toEqual({ status: "fulfilled", value: { ok: true } });
    expect(results[1]).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(await verbCount(w.orgId, "COMMENT_ADDED")).toBe(1);
    expect(await verbCount(w.orgId, "TEAM_DELETED")).toBe(1);
    expect(await verbCount(w.orgId, "TEAM_UNASSIGNED")).toBe(1);
    expect(await prisma.taskComment.count({ where: { taskId: w.task.id } })).toBe(1);
    expect(await addTaskComment(w.copied, w.task.id, { body: "Again" })).toMatchObject({
      ok: true,
    });
  });

  it("deleteTeam: content write first", async () => {
    const w = await world();
    const results = await holdAndBlock(
      "addTaskComment then deleteTeam",
      "addTaskComment",
      () => addTaskComment(w.copied, w.task.id, { body: "First comment" }),
      "deleteTeam",
      () => deleteTeam(w.admin, w.team.id),
    );
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(results[1]).toEqual({ status: "fulfilled", value: { ok: true } });
    expect(await verbCount(w.orgId, "COMMENT_ADDED")).toBe(1);
    expect(await verbCount(w.orgId, "TEAM_DELETED")).toBe(1);
    expect(await addTaskComment(w.copied, w.task.id, { body: "Again" })).toMatchObject({
      ok: true,
    });
  });
});

describe("addTeamMember against assignTeamToProject (review C2, K69: the copy holds the committed team)", () => {
  async function copyWorld() {
    const w = await world();
    const existing = await addOrgMember(prisma, w.orgId, "member");
    const joiner = await addOrgMember(prisma, w.orgId, "member");
    const team = await seedTeam(prisma, w.orgId, { memberUserIds: [existing.id] });
    return { ...w, team2: team, existing: existing.id, joiner: joiner.id };
  }

  it("addTeamMember before assignTeamToProject", async () => {
    const w = await copyWorld();
    const results = await holdAndBlock(
      "addTeamMember then assignTeamToProject",
      "addTeamMember",
      () => addTeamMember(w.admin, w.team2.id, w.joiner),
      "assignTeamToProject",
      () => assignTeamToProject(w.manager, w.project.id, w.team2.id),
    );
    expect(results[0]).toEqual({ status: "fulfilled", value: { ok: true, changed: true } });
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { ok: true, changed: true, copiedUserIds: [w.existing, w.joiner].sort() },
    });
    expect(await getProject(actorOf(w.joiner, w.orgId), w.project.id)).toMatchObject({
      ok: true,
      myRole: "MEMBER",
    });
  });

  it("assignTeamToProject before addTeamMember", async () => {
    const w = await copyWorld();
    const results = await holdAndBlock(
      "assignTeamToProject then addTeamMember",
      "assignTeamToProject",
      () => assignTeamToProject(w.manager, w.project.id, w.team2.id),
      "addTeamMember",
      () => addTeamMember(w.admin, w.team2.id, w.joiner),
    );
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: { ok: true, changed: true, copiedUserIds: [w.existing] },
    });
    expect(results[1]).toEqual({ status: "fulfilled", value: { ok: true, changed: true } });
    expect(await prisma.teamMember.count({ where: { teamId: w.team2.id, userId: w.joiner } })).toBe(
      1,
    );
    expect(
      await prisma.projectMember.count({ where: { projectId: w.project.id, userId: w.joiner } }),
    ).toBe(0);
    expect(await getProject(actorOf(w.joiner, w.orgId), w.project.id)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
