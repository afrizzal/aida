// Phase 14: derived progress (contract sections 1 and 9; D-11; AIDA-66, AIDA-100). Relative imports
// only, no Next.js import. Reads only (READ, no lock): computed on every read with count and
// groupBy queries that carry the organization term explicitly (groupBy and count are not scoped by
// scopedDb), never stored. Project progress is top-level DONE tasks over top-level non-archived
// tasks; task progress is DONE subtasks over non-archived subtasks; percent is
// floor(done * 100 / total), 0 when total is 0. A DONE parent with open subtasks keeps its subtask
// progress as it is: nothing completes automatically.
import { readableProjectIds, requireProject, requireTask } from "./access";
import { LIST_MAX, type ProjectActor, type ProjectResult } from "./contract";
import { type ProjectDb, refuse, runProjectRead } from "./service";

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

async function countProgress(
  db: ProjectDb,
  orgId: string,
  where: { projectId: string; parentId: string | null },
): Promise<Progress> {
  const base = { organizationId: orgId, ...where, archivedAt: null };
  const total = await db.task.count({ where: base });
  const done = await db.task.count({ where: { ...base, status: "DONE" } });
  return progressOf(done, total);
}

/** READ: the project's top-level progress. */
export async function getProjectProgress(
  actor: ProjectActor,
  projectId: string,
): Promise<ProjectResult<Progress>> {
  return runProjectRead(actor, "getProjectProgress", async (db) => {
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    return countProgress(db, actor.orgId, { projectId, parentId: null });
  });
}

/**
 * READ per project (Isolation class LIST): the progress of every readable project among the
 * given ids, in the given order (deduplicated); unreadable and missing ids are left out.
 */
export async function getProjectsProgress(
  actor: ProjectActor,
  projectIds: readonly string[],
): Promise<ProjectResult<{ projects: ProjectProgressEntry[] }>> {
  return runProjectRead(actor, "getProjectsProgress", async (db) => {
    if (!Array.isArray(projectIds)) refuse("INVALID_INPUT", "projectIds");
    const wanted = [...new Set(projectIds as unknown[])];
    if (wanted.length > LIST_MAX) refuse("TOO_MANY");
    const readable = await readableProjectIds(db, actor, wanted as string[]);
    const ids = (wanted as string[]).filter((id) => readable.has(id));
    if (ids.length === 0) return { projects: [] };
    const groups = await db.task.groupBy({
      by: ["projectId", "status"],
      where: {
        organizationId: actor.orgId,
        projectId: { in: ids },
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
    return {
      projects: ids.map((projectId) => {
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
    return countProgress(db, actor.orgId, { projectId: access.task.projectId, parentId: taskId });
  });
}
