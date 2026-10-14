// Phase 14 project membership and teams (contract sections 1, 2, 3, 5 and 14; D-04, D-15, C14,
// K69, AIDA-64, AIDA-69) on a real Postgres through Testcontainers: managers add, remove and
// re-role direct members (only active organization members, never the last active manager),
// organization owners and admins manage teams, a team never opens a private project by itself
// (K69), and every list of people leaves out users whose organization member row is gone.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addProjectMember } from "@/lib/projects/members";
import { getProject } from "@/lib/projects/projects";
import { createTask } from "@/lib/projects/tasks";
import {
  actorOf,
  addOrgMember,
  seedOrgWithMembers,
  seedProject,
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
