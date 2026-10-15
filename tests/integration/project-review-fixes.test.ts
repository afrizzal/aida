// Phase 14 code review fixes, batch F1 (14-REVIEW.md dispositions), on a real Postgres through
// Testcontainers. Each describe names the finding it proves. Every case seeds fresh organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setProjectMemberRole } from "@/lib/projects/members";
import {
  createProject,
  getProject,
  setProjectPrivacy,
  setProjectStatus,
  updateProject,
} from "@/lib/projects/projects";
import { createTask, getTask, updateTask } from "@/lib/projects/tasks";
import {
  actorOf,
  addOrgMember,
  projectTableSnapshot,
  removeOrgMember,
  seedOrgWithMembers,
  seedProject,
} from "../support/project-fixtures";

async function managerWorld() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const managerId = org.users[1]?.id as string;
  const manager = actorOf(managerId, org.orgId);
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: managerId,
    managerUserIds: [managerId],
  });
  return { org, orgId: org.orgId, managerId, manager, project };
}

describe("a-WR-05, b-WR-02: descriptions are stored as the trimmed text that was validated", () => {
  it("a project description at the limit plus surrounding whitespace is accepted and stored trimmed", async () => {
    const w = await managerWorld();
    const atLimit = "d".repeat(5000);
    const created = await createProject(w.manager, {
      name: "Trimmed",
      keyPrefix: "TRIM",
      description: `  ${atLimit}\n`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const read = await getProject(w.manager, created.projectId);
    expect(read.ok && read.project.descriptionMarkdown).toBe(atLimit);

    const updated = await updateProject(w.manager, created.projectId, 0, {
      description: `\n${atLimit}\n\n`,
    });
    // The trimmed value equals the stored one: a no-op.
    expect(updated).toEqual({ ok: true, changed: false });
    const shorter = await updateProject(w.manager, created.projectId, 0, {
      description: " short \n",
    });
    expect(shorter).toEqual({ ok: true, changed: true, version: 1 });
    const row = await prisma.project.findFirst({
      where: { id: created.projectId, organizationId: w.orgId },
      select: { descriptionMarkdown: true },
    });
    expect(row?.descriptionMarkdown).toBe("short");
    expect(
      await updateProject(w.manager, created.projectId, 1, { description: `${atLimit}d` }),
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "description" });
  });

  it("a task description at the limit plus a trailing newline is accepted and stored trimmed", async () => {
    const w = await managerWorld();
    const atLimit = "t".repeat(20000);
    const created = await createTask(w.manager, w.project.id, {
      title: "Long",
      description: `${atLimit}\n`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const read = await getTask(w.manager, created.taskId);
    expect(read.ok && read.task.descriptionMarkdown).toBe(atLimit);

    const updated = await updateTask(w.manager, created.taskId, created.version, {
      description: ` ${atLimit} `,
    });
    expect(updated).toEqual({ ok: true, changed: false });
    const shorter = await updateTask(w.manager, created.taskId, created.version, {
      description: "\n body \n",
    });
    expect(shorter.ok).toBe(true);
    const row = await prisma.task.findFirst({
      where: { id: created.taskId, organizationId: w.orgId },
      select: { descriptionMarkdown: true },
    });
    expect(row?.descriptionMarkdown).toBe("body");
  });
});

describe("a-IN-02: editProject checks expectedVersion before the no-op test", () => {
  it("a stale version with values equal to the stored ones is CONFLICT, not a no-op", async () => {
    const w = await managerWorld();
    const first = await updateProject(w.manager, w.project.id, 0, { name: "Renamed" });
    expect(first).toEqual({ ok: true, changed: true, version: 1 });
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await updateProject(w.manager, w.project.id, 0, { name: "Renamed" })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await setProjectStatus(w.manager, w.project.id, 0, "PLANNING")).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    // The current version with the same values stays a no-op.
    expect(await updateProject(w.manager, w.project.id, 1, { name: "Renamed" })).toEqual({
      ok: true,
      changed: false,
    });
  });
});

describe("a-WR-04: setProjectPrivacy(true) needs an active manager to remain", () => {
  it("an org admin cannot make a project private when no MANAGER row belongs to an active member", async () => {
    const w = await managerWorld();
    const admin = actorOf(w.org.users[0]?.id as string, w.orgId);
    await removeOrgMember(prisma, w.orgId, w.managerId);
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await setProjectPrivacy(admin, w.project.id, 0, true)).toEqual({
      ok: false,
      code: "LAST_MANAGER",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    // Making it non-private again, or a project with an active manager, is unaffected.
    const other = await managerWorld();
    expect(await setProjectPrivacy(other.manager, other.project.id, 0, true)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await setProjectPrivacy(other.manager, other.project.id, 1, false)).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
  });
});

describe("a-IN-04: setProjectMemberRole to MANAGER requires an active organization member", () => {
  it("promoting a stale ProjectMember row whose member row is gone is NOT_ELIGIBLE", async () => {
    const w = await managerWorld();
    const leaver = await addOrgMember(prisma, w.orgId, "member");
    await prisma.projectMember.create({
      data: { organizationId: w.orgId, projectId: w.project.id, userId: leaver.id, role: "MEMBER" },
    });
    await removeOrgMember(prisma, w.orgId, leaver.id);
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await setProjectMemberRole(w.manager, w.project.id, leaver.id, "MANAGER")).toEqual({
      ok: false,
      code: "NOT_ELIGIBLE",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    // An active member is still promoted.
    const active = await addOrgMember(prisma, w.orgId, "member");
    await prisma.projectMember.create({
      data: { organizationId: w.orgId, projectId: w.project.id, userId: active.id, role: "MEMBER" },
    });
    expect(await setProjectMemberRole(w.manager, w.project.id, active.id, "MANAGER")).toEqual({
      ok: true,
      changed: true,
    });
  });
});
