// Phase 14 favorites (contract sections 1, 2, 3 and 10; D-05, D-12, AIDA-70, AIDA-103; reviews
// R2-2 and P4). Relative imports only, no Next.js import.
//
// A favorite is a per-user preference: it changes no project content and writes no activity
// (D-05). The four toggles run at READ, so they are the explicit archive exception of sections 10
// and 16 (allowed on an archived project, an archived task and a task whose parent is archived),
// and each takes a share lock so it serializes with a hard delete in either order:
// - favoriteProject and unfavoriteProject hold the project FOR SHARE (PROJECT_SHARE through
//   requireProject, review P4); deleteProject holds the project FOR UPDATE, so a toggle that
//   waits for a committed delete finds no project (NOT_FOUND, nothing written) and a delete that
//   waits for a committed toggle removes the favorite with the project. No insert ever meets a
//   deleted project, so no RESTRICT foreign-key error.
// - favoriteTask and unfavoriteTask hold the project FOR SHARE and lock the task FOR SHARE through
//   requireTask (a subtask's parent FOR SHARE first, review R2-2), so they serialize the same way
//   with deleteTask (the tree FOR UPDATE, root first) and deleteProject.
// Toggles are idempotent: INSERT ... ON CONFLICT DO NOTHING and a delete, each with the
// organization term; a repeated call is `{ changed: false }`. listFavorites returns only what the
// actor can read now (the read predicate of section 2), archived entries only on request.
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { readableProjectWhere, requireProject } from "./access";
import { LIST_DEFAULT, LIST_MAX, type ProjectActor, type ProjectResult } from "./contract";
import { afterLock, refuse, runProjectRead, runProjectTransaction } from "./service";

// ---------------------------------------------------------------------------------------------
// Project favorites

/** Favorites a project (READ under PROJECT_SHARE; archived allowed; no activity). */
export async function favoriteProject(
  actor: ProjectActor,
  projectId: string,
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "favoriteProject", async (tx) => {
    await requireProject(tx, actor, projectId, { lock: "share", level: "READ" });
    await afterLock(tx, "favoriteProject");
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "ProjectFavorite" ("id", "organizationId", "userId", "projectId")
      VALUES (${randomUUID()}, ${actor.orgId}, ${actor.userId}, ${projectId})
      ON CONFLICT ("organizationId", "userId", "projectId") DO NOTHING
      RETURNING "id"`;
    return { changed: inserted.length === 1 };
  });
}

/** Removes the actor's favorite of a project (READ under PROJECT_SHARE; archived allowed). */
export async function unfavoriteProject(
  actor: ProjectActor,
  projectId: string,
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "unfavoriteProject", async (tx) => {
    await requireProject(tx, actor, projectId, { lock: "share", level: "READ" });
    await afterLock(tx, "unfavoriteProject");
    const removed = await tx.projectFavorite.deleteMany({
      where: { organizationId: actor.orgId, userId: actor.userId, projectId },
    });
    return { changed: removed.count > 0 };
  });
}

// ---------------------------------------------------------------------------------------------
// listFavorites (READ, list predicate)

export interface FavoriteProjectItem {
  projectId: string;
  name: string;
  keyPrefix: string;
  archivedAt: Date | null;
  favoritedAt: Date;
}

export interface FavoriteTaskItem {
  taskId: string;
  projectId: string;
  parentId: string | null;
  key: string;
  title: string;
  archivedAt: Date | null;
  favoritedAt: Date;
}

export interface ListFavoritesOpts {
  /** Also return favorites of archived projects and tasks (default false). */
  includeArchived?: boolean;
  /** At most this many projects and this many tasks (default LIST_DEFAULT, at most LIST_MAX). */
  limit?: number;
}

/**
 * The actor's favorite projects and tasks that the actor can read now, newest first. Favorite rows
 * of projects the actor can no longer read stay in the table and are left out here. Without
 * includeArchived, archived projects, archived tasks, tasks of archived projects and subtasks of
 * archived parents are left out. Each list holds at most `limit` entries; hasMoreProjects and
 * hasMoreTasks say whether more exist.
 */
export async function listFavorites(
  actor: ProjectActor,
  opts: ListFavoritesOpts = {},
): Promise<
  ProjectResult<{
    projects: FavoriteProjectItem[];
    tasks: FavoriteTaskItem[];
    hasMoreProjects: boolean;
    hasMoreTasks: boolean;
  }>
> {
  return runProjectRead(actor, "listFavorites", async (db) => {
    const includeArchived = opts?.includeArchived ?? false;
    if (typeof includeArchived !== "boolean") refuse("INVALID_INPUT", "includeArchived");
    const rawLimit = opts?.limit ?? LIST_DEFAULT;
    if (typeof rawLimit !== "number" || !Number.isInteger(rawLimit) || rawLimit < 1) {
      refuse("INVALID_INPUT", "limit");
    }
    const limit = Math.min(rawLimit, LIST_MAX);
    const orgId = actor.orgId;

    const projectWhere: Prisma.ProjectWhereInput = includeArchived
      ? readableProjectWhere(actor)
      : { AND: [readableProjectWhere(actor), { archivedAt: null }] };
    const projectRows = await db.projectFavorite.findMany({
      where: { organizationId: orgId, userId: actor.userId, project: projectWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        createdAt: true,
        project: { select: { id: true, name: true, keyPrefix: true, archivedAt: true } },
      },
    });

    const taskTerms: Prisma.TaskWhereInput[] = [{ organizationId: orgId, project: projectWhere }];
    if (!includeArchived) {
      taskTerms.push({ archivedAt: null });
      taskTerms.push({
        OR: [{ parentId: null }, { parent: { organizationId: orgId, archivedAt: null } }],
      });
    }
    const taskRows = await db.taskFavorite.findMany({
      where: { organizationId: orgId, userId: actor.userId, task: { AND: taskTerms } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        createdAt: true,
        task: {
          select: {
            id: true,
            projectId: true,
            parentId: true,
            key: true,
            title: true,
            archivedAt: true,
          },
        },
      },
    });

    return {
      projects: projectRows.slice(0, limit).map((row) => ({
        projectId: row.project.id,
        name: row.project.name,
        keyPrefix: row.project.keyPrefix,
        archivedAt: row.project.archivedAt,
        favoritedAt: row.createdAt,
      })),
      tasks: taskRows.slice(0, limit).map((row) => ({
        taskId: row.task.id,
        projectId: row.task.projectId,
        parentId: row.task.parentId,
        key: row.task.key,
        title: row.task.title,
        archivedAt: row.task.archivedAt,
        favoritedAt: row.createdAt,
      })),
      hasMoreProjects: projectRows.length > limit,
      hasMoreTasks: taskRows.length > limit,
    };
  });
}
