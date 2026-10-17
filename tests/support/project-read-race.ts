// Phase 14 fix batch F4 (run decision K73): the shared harness of the read races. One world per
// case, the four access changes, and describeReadRaces, which parks each read right after its
// access check (afterReadCheck; createServiceRace.holdAt resolves with the parked read's own
// backend PID), applies the change while it waits, then lets the read run its content queries.
// No timed waits. Every case first runs the read without a change and asserts the content is
// there, so an empty result after the change is not vacuous.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { removeProjectMember } from "@/lib/projects/members";
import { moveTask } from "@/lib/projects/move";
import { setProjectPrivacy } from "@/lib/projects/projects";
import {
  actorOf,
  removeOrgMember,
  seedActivity,
  seedAttachment,
  seedComment,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
} from "./project-fixtures";
import { createServiceRace, type ServiceRace } from "./project-race";

export type Change = "orgMember" | "projectMember" | "privacy" | "move";

/**
 * One world per case: the target project P holds a task T (label, milestone, subtask, comment,
 * attachment, favorite) and a team linked to P, with activity rows for P, T and the team. P is
 * private with the reader as a member for "projectMember", else public. HID is private without
 * the reader (the move target).
 */
export async function world(change: Change) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
  const orgId = org.orgId;
  const readerId = org.users[1]?.id as string;
  const managerId = org.users[2]?.id as string;
  const reader = actorOf(readerId, orgId);
  const manager = actorOf(managerId, orgId);
  const p = await seedProject(prisma, orgId, {
    createdByUserId: managerId,
    isPrivate: change === "projectMember",
    managerUserIds: [managerId],
    memberUserIds: change === "projectMember" ? [readerId] : [],
  });
  const hid = await seedProject(prisma, orgId, {
    createdByUserId: managerId,
    isPrivate: true,
    managerUserIds: [managerId],
  });
  const label = await seedLabel(prisma, orgId, p.id);
  const milestone = await seedMilestone(prisma, orgId, p.id, { date: "2026-12-01" });
  const task = await seedTask(prisma, orgId, p.id, {
    labelIds: [label.id],
    milestoneId: milestone.id,
    dueDate: "2026-12-02",
    assigneeUserId: managerId,
  });
  await seedTask(prisma, orgId, p.id, { parentId: task.id, status: "DONE" });
  await seedComment(prisma, orgId, task.id, { authorUserId: managerId, body: "content" });
  const attachment = await seedAttachment(prisma, orgId, task.id, { uploadedByUserId: managerId });
  const team = await seedTeam(prisma, orgId, { memberUserIds: [managerId], projectIds: [p.id] });
  await prisma.projectFavorite.create({
    data: { organizationId: orgId, userId: readerId, projectId: p.id },
  });
  await prisma.taskFavorite.create({
    data: { organizationId: orgId, userId: readerId, taskId: task.id },
  });
  await seedActivity(prisma, orgId, { projectId: p.id, actorUserId: managerId });
  await seedActivity(prisma, orgId, {
    projectId: p.id,
    taskId: task.id,
    actorUserId: managerId,
    verb: "TASK_UPDATED",
    entityType: "TASK",
    entityId: task.id,
  });
  await seedActivity(prisma, orgId, {
    projectId: p.id,
    teamId: team.id,
    actorUserId: managerId,
    verb: "TEAM_ASSIGNED",
    entityType: "TEAM",
    entityId: team.id,
  });
  return {
    orgId,
    reader,
    manager,
    projectId: p.id,
    hiddenId: hid.id,
    taskId: task.id,
    taskKey: task.key,
    attachmentId: attachment.id,
    teamId: team.id,
  };
}

export type World = Awaited<ReturnType<typeof world>>;

export async function applyChange(change: Change, w: World): Promise<void> {
  if (change === "orgMember") {
    await removeOrgMember(prisma, w.orgId, w.reader.userId);
  } else if (change === "projectMember") {
    expect(await removeProjectMember(w.manager, w.projectId, w.reader.userId)).toMatchObject({
      ok: true,
      changed: true,
    });
  } else if (change === "privacy") {
    expect(await setProjectPrivacy(w.manager, w.projectId, 0, true)).toMatchObject({
      ok: true,
      changed: true,
    });
  } else {
    expect(await moveTask(w.manager, w.taskId, w.hiddenId, 0)).toMatchObject({ ok: true });
  }
}

/** The refusal of a single-object read once access is gone. */
export const gone = (change: Change) => ({
  ok: false,
  code: change === "orgMember" ? "MEMBERSHIP_ENDED" : "NOT_FOUND",
});
export const emptyPage = { hasMore: false, nextCursor: null };

export interface ReadCase {
  name: string;
  operation: string;
  changes: Change[];
  read: (w: World) => Promise<unknown>;
  /** The result without a change: asserts that the content is there. */
  // biome-ignore lint/suspicious/noExplicitAny: one table covers results of many shapes
  before: (result: any, w: World) => void;
  /** The exact result after the change. */
  after: (change: Change, w: World) => unknown;
}

export const PROJECT_CHANGES: Change[] = ["orgMember", "projectMember", "privacy"];
export const TASK_CHANGES: Change[] = ["orgMember", "projectMember", "privacy", "move"];

export const CHANGE_NAMES: Record<Change, string> = {
  orgMember: "the reader's organization member row is removed",
  projectMember: "the reader's project member row is removed",
  privacy: "the project becomes private",
  move: "the task moves into a private project",
};

/** Defines one describe per family and one case per read and change. */
export function describeReadRaces(families: Record<string, ReadCase[]>): void {
  let race: ServiceRace | null = null;

  afterEach(() => {
    race?.clear();
    race = null;
  });

  for (const [family, cases] of Object.entries(families)) {
    describe(`K73 ${family}: nothing after access is gone while the read waits`, () => {
      for (const c of cases) {
        for (const change of c.changes) {
          it(`${c.name}: ${CHANGE_NAMES[change]}`, async () => {
            const w = await world(change);
            c.before(await c.read(w), w);
            race = createServiceRace();
            const parked = race.holdAt(c.operation);
            const pending = c.read(w);
            expect(await parked).toBeGreaterThan(0);
            await applyChange(change, w);
            race.release();
            expect(await pending).toEqual(c.after(change, w));
          });
        }
      }
    });
  }
}
