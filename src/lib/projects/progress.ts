// Phase 14: derived progress (contract sections 1 and 9; D-11; AIDA-66, AIDA-100). Relative imports
// only, no Next.js import. Reads only (READ, no lock): computed on every read with count and
// groupBy queries that carry the organization term explicitly (groupBy and count are not scoped by
// scopedDb), never stored. Project progress is top-level DONE tasks over top-level non-archived
// tasks; task progress is DONE subtasks over non-archived subtasks; percent is
// floor(done * 100 / total), 0 when total is 0. A DONE parent with open subtasks keeps its subtask
// progress as it is: nothing completes automatically.
import { readableProjectWhere, refuseUnreadable, requireProject, requireTask } from "./access";
import { LIST_MAX, type ProjectActor, type ProjectResult } from "./contract";
import { afterReadCheck, isPlausibleId, type ProjectDb, refuse, runProjectRead } from "./service";

export interface Progress {
  done: number;
  total: number;
  percent: number;
}

export interface ProjectProgressEntry extends Progress {
  projectId: string;
}

function progressOf(done: number, total: number): Progress {
  return { done, total, percent: total > 0 ? Math.floor((done * 100) / total) : 0 };
}

/**
 * K73: both counts carry the current read predicate, and the last statement re-reads the anchor
 * (the project, or the task in its project) under it, so a count is returned only while the
 * reader can still read it.
 */
async function countProgress(
  db: ProjectDb,
  actor: ProjectActor,
  where: { projectId: string; parentId: string | null },
): Promise<Progress> {
  const readable = readableProjectWhere(actor);
  const base = { organizationId: actor.orgId, ...where, archivedAt: null, project: readable };
  const total = await db.task.count({ where: base });
  const done = await db.task.count({ where: { ...base, status: "DONE" } });
  const anchor =
    where.parentId === null
      ? await db.project.count({ where: { AND: [readable, { id: where.projectId }] } })
      : await db.task.count({
          where: {
            id: where.parentId,
            organizationId: actor.orgId,
            projectId: where.projectId,
            project: readable,
          },
        });
  if (anchor === 0) return refuseUnreadable(db, actor);
  return progressOf(done, total);
}

/** READ: the project's top-level progress. */
export async function getProjectProgress(
  actor: ProjectActor,
  projectId: string,
): Promise<ProjectResult<Progress>> {
  return runProjectRead(actor, "getProjectProgress", async (db) => {
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    await afterReadCheck(db, "getProjectProgress");
    return countProgress(db, actor, { projectId, parentId: null });
  });
}

/**
 * READ per project (Isolation class LIST): the progress of every readable project among the
 * given ids, in the given order (deduplicated); unreadable and missing ids are left out. K73: the
 * counts carry the current read predicate, and the projects returned are those still readable
 * at the last statement.
 */
export async function getProjectsProgress(
  actor: ProjectActor,
  projectIds: readonly string[],
): Promise<ProjectResult<{ projects: ProjectProgressEntry[] }>> {
  return runProjectRead(actor, "getProjectsProgress", async (db) => {
    if (!Array.isArray(projectIds)) refuse("INVALID_INPUT", "projectIds");
    const wanted = [...new Set(projectIds as unknown[])];
    if (wanted.length > LIST_MAX) refuse("TOO_MANY");
    const ids = (wanted as string[]).filter((id) => isPlausibleId(id));
    await afterReadCheck(db, "getProjectsProgress");
    if (ids.length === 0) return { projects: [] };
    const readable = readableProjectWhere(actor);
    const groups = await db.task.groupBy({
      by: ["projectId", "status"],
      where: {
        organizationId: actor.orgId,
        projectId: { in: ids },
        project: readable,
        parentId: null,
        archivedAt: null,
      },
      _count: { _all: true },
    });
    const totals = new Map<string, { done: number; total: number }>();
    for (const group of groups) {
      const entry = totals.get(group.projectId) ?? { done: 0, total: 0 };
      entry.total += group._count._all;
      if (group.status === "DONE") entry.done += group._count._all;
      totals.set(group.projectId, entry);
    }
    const still = await db.project.findMany({
      where: { AND: [readable, { id: { in: ids } }] },
      select: { id: true },
    });
    const present = new Set(still.map((row) => row.id));
    return {
      projects: ids
        .filter((projectId) => present.has(projectId))
        .map((projectId) => {
          const entry = totals.get(projectId) ?? { done: 0, total: 0 };
          return { projectId, ...progressOf(entry.done, entry.total) };
        }),
    };
  });
}

/** READ: the progress of a task's non-archived subtasks. */
export async function getTaskProgress(
  actor: ProjectActor,
  taskId: string,
): Promise<ProjectResult<Progress>> {
  return runProjectRead(actor, "getTaskProgress", async (db) => {
    const access = await requireTask(db, actor, taskId, { lock: "none", level: "READ" });
    await afterReadCheck(db, "getTaskProgress");
    return countProgress(db, actor, { projectId: access.task.projectId, parentId: taskId });
  });
}
