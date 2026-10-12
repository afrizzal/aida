// Test-only (Phase 14, contract section 17, review R2-1): hardDeleteProjectRowsForTest reproduces
// only the END STATE of a project hard delete, for read-path tests of plans that run before or
// beside plan 14-10. The redaction read path depends only on the Project row being gone. This is
// not deleteProject and proves nothing about it (plan 14-10 proves deleteProject).
//
// In one transaction, with the organization term on every statement, it turns the TaskKey rows of
// the project's tasks into TOMBSTONE and then deletes leaves first: the task favorites, label
// links, comments and attachments of the project's tasks, the project's tasks in one statement,
// then the project's labels, milestones, members, team links, favorites, its task counter and the
// project row. Like a real delete it never touches the activity table, the prefix reservations,
// the file-cleanup outbox or the AI audit table. Relative imports only.
import type { PrismaClient } from "../../src/generated/prisma/client";

export async function hardDeleteProjectRowsForTest(
  prisma: PrismaClient,
  orgId: string,
  projectId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({
      where: { organizationId: orgId, projectId },
      select: { id: true },
    });
    const taskIds = tasks.map((t) => t.id);
    await tx.taskKey.updateMany({
      where: { organizationId: orgId, taskId: { in: taskIds } },
      data: { kind: "TOMBSTONE" },
    });
    const byTask = { organizationId: orgId, taskId: { in: taskIds } };
    await tx.taskFavorite.deleteMany({ where: byTask });
    await tx.taskLabel.deleteMany({ where: byTask });
    await tx.taskComment.deleteMany({ where: byTask });
    await tx.taskAttachment.deleteMany({ where: byTask });
    await tx.$executeRaw`
      DELETE FROM "Task" WHERE "organizationId" = ${orgId} AND "projectId" = ${projectId}`;
    const byProject = { organizationId: orgId, projectId };
    await tx.projectLabel.deleteMany({ where: byProject });
    await tx.projectMilestone.deleteMany({ where: byProject });
    await tx.projectMember.deleteMany({ where: byProject });
    await tx.projectTeam.deleteMany({ where: byProject });
    await tx.projectFavorite.deleteMany({ where: byProject });
    await tx.projectTaskCounter.deleteMany({ where: byProject });
    await tx.project.deleteMany({ where: { organizationId: orgId, id: projectId } });
  });
}
