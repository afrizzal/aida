// Phase 14 fix batch F5, Codex diff critique round 3 (R3D-1): a feed page query requires the
// project each row is filtered by to exist now and be readable now, row by row, in the paged
// statement itself. A deleted project's activity is never returned, and a project that becomes
// unreadable never blanks rows of projects that are still readable. Each case parks the feed
// right after its access check (afterReadCheck; createServiceRace.holdAt resolves with the
// parked read's own backend PID), changes the world while it waits, then lets the page query
// run. No timed waits. Every case first runs the same read without a change and asserts the
// content is there.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listTaskActivity, listTeamActivity } from "@/lib/projects/activity";
import { archiveProject } from "@/lib/projects/archive";
import { REDACTED_SIDE } from "@/lib/projects/contract";
import { deleteProject } from "@/lib/projects/delete";
import { moveTask } from "@/lib/projects/move";
import { setProjectPrivacy } from "@/lib/projects/projects";
import {
  actorOf,
  seedActivity,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
} from "../support/project-fixtures";
import { createServiceRace, type ServiceRace } from "../support/project-race";

let race: ServiceRace | null = null;

afterEach(() => {
  race?.clear();
  race = null;
});

/** Two public projects A and B (manager: MANAGER of both); the reader is an organization member only. */
async function world() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
  const orgId = org.orgId;
  const reader = actorOf(org.users[1]?.id as string, orgId);
  const managerId = org.users[2]?.id as string;
  const manager = actorOf(managerId, orgId);
  const opts = { createdByUserId: managerId, isPrivate: false, managerUserIds: [managerId] };
  const a = await seedProject(prisma, orgId, opts);
  const b = await seedProject(prisma, orgId, opts);
  return { orgId, reader, manager, managerId, aId: a.id, bId: b.id };
}

type World = Awaited<ReturnType<typeof world>>;

/** B becomes private (version 0 to 1). */
async function makePrivate(w: World, projectId: string) {
  expect(await setProjectPrivacy(w.manager, projectId, 0, true)).toMatchObject({
    ok: true,
    changed: true,
  });
}

/** Archive (version 1 to 2), then hard delete. */
async function archiveAndDelete(w: World, projectId: string) {
  expect(await archiveProject(w.manager, projectId, 1)).toMatchObject({ ok: true });
  const { name } = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true },
  });
  expect(await deleteProject(w.manager, projectId, { confirmName: name })).toMatchObject({
    ok: true,
  });
}

/** A team linked to A and B, with a project-less row and one TEAM_ASSIGNED row per project. */
async function teamWorld() {
  const w = await world();
  const team = await seedTeam(prisma, w.orgId, {
    memberUserIds: [w.managerId],
    projectIds: [w.aId, w.bId],
  });
  const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, s));
  const created = await seedActivity(prisma, w.orgId, {
    teamId: team.id,
    actorUserId: w.managerId,
    verb: "TEAM_CREATED",
    entityType: "TEAM",
    entityId: team.id,
    createdAt: at(1),
  });
  const assigned = (projectId: string, s: number) =>
    seedActivity(prisma, w.orgId, {
      projectId,
      teamId: team.id,
      actorUserId: w.managerId,
      verb: "TEAM_ASSIGNED",
      entityType: "PROJECT_TEAM",
      entityId: team.id,
      createdAt: at(s),
    });
  const onA = await assigned(w.aId, 2);
  const onB = await assigned(w.bId, 3);
  return { ...w, teamId: team.id, createdId: created.id, onAId: onA.id, onBId: onB.id };
}

/** A task created in B (one TASK_UPDATED row there), then moved to A (TASK_MOVED in A). */
async function taskWorld() {
  const w = await world();
  const task = await seedTask(prisma, w.orgId, w.bId, {});
  const inB = await seedActivity(prisma, w.orgId, {
    projectId: w.bId,
    taskId: task.id,
    actorUserId: w.managerId,
    verb: "TASK_UPDATED",
    entityType: "TASK",
    entityId: task.id,
    createdAt: new Date(Date.UTC(2026, 10, 1)),
  });
  expect(await moveTask(w.manager, task.id, w.aId, 0)).toMatchObject({ ok: true });
  const moved = await prisma.projectActivity.findFirstOrThrow({
    where: { organizationId: w.orgId, taskId: task.id, verb: "TASK_MOVED" },
    select: { id: true },
  });
  return { ...w, taskId: task.id, inBId: inB.id, movedId: moved.id };
}

const ids = (result: unknown) =>
  ((result as { rows: { id: string }[] }).rows ?? []).map((row) => row.id).sort();

/** Parks `operation` after its access check, runs `change` while it waits, returns the result. */
async function parked<T>(operation: string, read: () => Promise<T>, change: () => Promise<void>) {
  race = createServiceRace();
  const hold = race.holdAt(operation);
  const pending = read();
  expect(await hold).toBeGreaterThan(0);
  await change();
  race.release();
  return pending;
}

describe("R3D-1 a deleted project's activity is never returned", () => {
  it("listTeamActivity: B becomes private, private activity is written, B is deleted", async () => {
    const w = await teamWorld();
    const read = () => listTeamActivity(w.reader, w.teamId);
    expect(ids(await read())).toEqual([w.createdId, w.onAId, w.onBId].sort());
    const result = await parked("listTeamActivity", read, async () => {
      await makePrivate(w, w.bId);
      await seedActivity(prisma, w.orgId, {
        projectId: w.bId,
        teamId: w.teamId,
        actorUserId: w.managerId,
        verb: "MEMBER_ADDED",
        entityType: "PROJECT_MEMBER",
        entityId: w.managerId,
      });
      await archiveAndDelete(w, w.bId);
    });
    expect(result).toMatchObject({ ok: true, hasMore: false, nextCursor: null });
    expect(ids(result)).toEqual([w.createdId, w.onAId].sort());
  });

  it("listTeamActivity (limit 1): no hasMore or cursor from the deleted project's rows", async () => {
    const w = await teamWorld();
    const read = () => listTeamActivity(w.reader, w.teamId, { limit: 1 });
    expect(await read()).toMatchObject({ ok: true, hasMore: true, rows: [{ id: w.onBId }] });
    const result = await parked("listTeamActivity", read, async () => {
      await makePrivate(w, w.bId);
      await seedActivity(prisma, w.orgId, {
        projectId: w.bId,
        teamId: w.teamId,
        actorUserId: w.managerId,
        verb: "MEMBER_ADDED",
        entityType: "PROJECT_MEMBER",
        entityId: w.managerId,
      });
      await archiveAndDelete(w, w.bId);
    });
    expect(result).toMatchObject({ ok: true, hasMore: true, rows: [{ id: w.onAId }] });
  });

  it("listTaskActivity: the moved task's origin becomes private, private activity is written, the origin is deleted", async () => {
    const w = await taskWorld();
    const read = () => listTaskActivity(w.reader, w.taskId);
    expect(ids(await read())).toEqual([w.inBId, w.movedId].sort());
    const result = await parked("listTaskActivity", read, async () => {
      await makePrivate(w, w.bId);
      await seedActivity(prisma, w.orgId, {
        projectId: w.bId,
        taskId: w.taskId,
        actorUserId: w.managerId,
        verb: "TASK_UPDATED",
        entityType: "TASK",
        entityId: w.taskId,
      });
      await archiveAndDelete(w, w.bId);
    });
    expect(result).toMatchObject({
      ok: true,
      hasMore: false,
      nextCursor: null,
      rows: [{ id: w.movedId, projectId: w.aId, relatedProjectId: null, before: REDACTED_SIDE }],
    });
    expect(ids(result)).toEqual([w.movedId]);
  });
});

describe("R3D-1 a project that becomes unreadable never blanks rows that are still readable", () => {
  it("listTeamActivity: B becomes private while the feed waits; A's rows and project-less rows stay", async () => {
    const w = await teamWorld();
    const read = () => listTeamActivity(w.reader, w.teamId);
    expect(ids(await read())).toEqual([w.createdId, w.onAId, w.onBId].sort());
    const result = await parked("listTeamActivity", read, () => makePrivate(w, w.bId));
    expect(result).toMatchObject({ ok: true, hasMore: false, nextCursor: null });
    expect(ids(result)).toEqual([w.createdId, w.onAId].sort());
  });

  it("listTaskActivity: the moved task's origin becomes private while the feed waits; the current project's row stays", async () => {
    const w = await taskWorld();
    const read = () => listTaskActivity(w.reader, w.taskId);
    expect(ids(await read())).toEqual([w.inBId, w.movedId].sort());
    const result = await parked("listTaskActivity", read, () => makePrivate(w, w.bId));
    expect(result).toMatchObject({
      ok: true,
      hasMore: false,
      nextCursor: null,
      rows: [{ id: w.movedId, projectId: w.aId, relatedProjectId: null, before: REDACTED_SIDE }],
    });
    expect(ids(result)).toEqual([w.movedId]);
  });
});
