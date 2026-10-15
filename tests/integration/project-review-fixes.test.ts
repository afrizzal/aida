// Phase 14 code review fixes, batch F1 (14-REVIEW.md dispositions), on a real Postgres through
// Testcontainers. Each describe names the finding it proves. Every case seeds fresh organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject, getProject, updateProject } from "@/lib/projects/projects";
import { createTask, getTask, updateTask } from "@/lib/projects/tasks";
import { actorOf, seedOrgWithMembers, seedProject } from "../support/project-fixtures";

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
