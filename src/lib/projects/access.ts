// Phase 14 access policy (contract section 2; D-04, D-15, K59, K62, K69, 14-o1 default): the one
// place every projects service decides who may read, write and manage. Relative imports only.
//
// Order of a single-entity check, inside the caller's transaction: (1) a malformed id is
// NOT_FOUND; (2) the actor's organization membership is read conservatively
// (findConservativeMembership, K59), no row is MEMBERSHIP_ENDED, before any project lookup; (3)
// the operation's lock is taken on the project row with an explicit organization term, missing is
// NOT_FOUND; (4) membership is read again after the lock; (5) read access is a non-private
// project or the actor's own ProjectMember row. K69: membership of a team assigned to the project
// is never looked up here and grants nothing; no read access is NOT_FOUND, identical to a missing
// id; (6) archive state for CONTENT and MANAGE levels; (7) MANAGE is a MANAGER row, or an
// organization owner or admin on a non-private project; (8) row-level rules (author, uploader,
// creator) are a predicate the caller passes.
//
// Task resolution (review C3): a write locks a subtask's parent FOR SHARE before the subtask's own
// row lock and checks the archive state of the task and its parent on the rows those locking
// reads return, so a parent archive committed first is seen and one that starts later waits.
//
// scopedDb does not scope raw SQL, findUnique, aggregate or nested filters (C1): every statement
// here writes the organization term itself.
import type { Prisma } from "../../generated/prisma/client";
import { type ActiveMembership, findConservativeMembership, isAdminRole } from "../membership";
import type { AccessLevel, ProjectActor, ProjectMemberRole, ProjectStatus } from "./contract";
import { isPlausibleId, type ProjectDb, refuse } from "./service";

export type RowLockMode = "share" | "update";
/** The project lock of an operation: none (reads), the row FOR SHARE or FOR UPDATE, or every project of the organization FOR UPDATE (ORG_PROJECTS_UPDATE). */
export type ProjectLock = "none" | RowLockMode | "org-update";

/** The project row requireProject returns (read after the lock). */
export interface AccessProject {
  id: string;
  organizationId: string;
  name: string;
  descriptionMarkdown: string | null;
  color: string;
  icon: string | null;
  status: ProjectStatus;
  dueDate: Date | null;
  isPrivate: boolean;
  keyPrefix: string;
  position: number;
  archivedAt: Date | null;
  version: number;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectAccess {
  project: AccessProject;
  membership: ActiveMembership;
  projectRole: ProjectMemberRole | null;
  isOrgAdmin: boolean;
  canManage: boolean;
}

const PROJECT_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  descriptionMarkdown: true,
  color: true,
  icon: true,
  status: true,
  dueDate: true,
  isPrivate: true,
  keyPrefix: true,
  position: true,
  archivedAt: true,
  version: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Step 2 (and 4): the conservative membership read. No row: MEMBERSHIP_ENDED. */
export async function requireMembership(
  client: ProjectDb,
  actor: ProjectActor,
): Promise<ActiveMembership> {
  const membership = await findConservativeMembership(client, actor.userId, actor.orgId);
  if (!membership) refuse("MEMBERSHIP_ENDED");
  return membership;
}

/** One SELECT ... FOR SHARE or FOR UPDATE on the project row, with the organization term. */
export async function lockProject(
  tx: ProjectDb,
  orgId: string,
  projectId: string,
  mode: RowLockMode,
): Promise<{ id: string } | null> {
  const rows =
    mode === "update"
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Project"
          WHERE "id" = ${projectId} AND "organizationId" = ${orgId}
          FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Project"
          WHERE "id" = ${projectId} AND "organizationId" = ${orgId}
          FOR SHARE`;
  return rows[0] ?? null;
}

/**
 * Several projects locked in one statement ordered by id (PROJECTS_UPDATE). A missing id (absent
 * or of another organization) is NOT_FOUND.
 */
export async function lockProjectsInIdOrder(
  tx: ProjectDb,
  orgId: string,
  ids: readonly string[],
  mode: RowLockMode,
): Promise<{ id: string }[]> {
  const wanted = [...new Set(ids)];
  if (wanted.some((id) => !isPlausibleId(id))) refuse("NOT_FOUND");
  const rows =
    mode === "update"
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Project"
          WHERE "organizationId" = ${orgId} AND "id" = ANY(${wanted}::text[])
          ORDER BY "id"
          FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Project"
          WHERE "organizationId" = ${orgId} AND "id" = ANY(${wanted}::text[])
          ORDER BY "id"
          FOR SHARE`;
  if (rows.length !== wanted.length) refuse("NOT_FOUND");
  return rows;
}

/** Every project of the organization FOR UPDATE in one statement ordered by id. */
export async function lockAllOrgProjects(
  tx: ProjectDb,
  orgId: string,
): Promise<{ id: string; position: number }[]> {
  return tx.$queryRaw<{ id: string; position: number }[]>`
    SELECT "id", "position" FROM "Project"
    WHERE "organizationId" = ${orgId}
    ORDER BY "id"
    FOR UPDATE`;
}

/** The team row FOR SHARE or FOR UPDATE, with the organization term (null when missing). */
export async function lockTeam(
  tx: ProjectDb,
  orgId: string,
  teamId: string,
  mode: RowLockMode,
): Promise<{ id: string } | null> {
  if (!isPlausibleId(teamId)) return null;
  const rows =
    mode === "update"
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Team"
          WHERE "id" = ${teamId} AND "organizationId" = ${orgId}
          FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Team"
          WHERE "id" = ${teamId} AND "organizationId" = ${orgId}
          FOR SHARE`;
  return rows[0] ?? null;
}

const PROJECT_LEVELS = new Set<AccessLevel>(["READ", "CONTENT", "MANAGE", "MANAGE_ARCHIVED"]);

/**
 * Steps 1 to 7 of contract section 2 for one project, at READ, CONTENT, MANAGE or
 * MANAGE_ARCHIVED, with the operation's lock. Returns the project read after the lock, the
 * membership, the actor's project role, isOrgAdmin and canManage.
 */
export async function requireProject(
  client: ProjectDb,
  actor: ProjectActor,
  projectId: string,
  opts: { lock: ProjectLock; level: AccessLevel },
): Promise<ProjectAccess> {
  if (!PROJECT_LEVELS.has(opts.level)) {
    throw new Error(`requireProject: unsupported level ${opts.level}`);
  }
  if (!isPlausibleId(projectId)) refuse("NOT_FOUND");
  let membership = await requireMembership(client, actor);
  if (opts.lock !== "none") {
    if (opts.lock === "org-update") {
      const rows = await lockAllOrgProjects(client, actor.orgId);
      if (!rows.some((row) => row.id === projectId)) refuse("NOT_FOUND");
    } else if (!(await lockProject(client, actor.orgId, projectId, opts.lock))) {
      refuse("NOT_FOUND");
    }
    membership = await requireMembership(client, actor);
  }
  const project = await client.project.findFirst({
    where: { id: projectId, organizationId: actor.orgId },
    select: PROJECT_SELECT,
  });
  if (!project) refuse("NOT_FOUND");
  const own = await client.projectMember.findFirst({
    where: { organizationId: actor.orgId, projectId, userId: actor.userId },
    select: { role: true },
  });
  if (project.isPrivate && !own) refuse("NOT_FOUND");
  const isOrgAdmin = isAdminRole(membership.role);
  const projectRole = (own?.role ?? null) as ProjectMemberRole | null;
  const canManage = projectRole === "MANAGER" || (!project.isPrivate && isOrgAdmin);
  if (opts.level !== "READ" && opts.level !== "MANAGE_ARCHIVED" && project.archivedAt) {
    refuse("ARCHIVED");
  }
  if ((opts.level === "MANAGE" || opts.level === "MANAGE_ARCHIVED") && !canManage) {
    refuse("NOT_ALLOWED");
  }
  return { project: project as AccessProject, membership, projectRole, isOrgAdmin, canManage };
}

/** The task row requireTask returns (from the locking read for a write). */
export interface AccessTask {
  id: string;
  projectId: string;
  parentId: string | null;
  archivedAt: Date | null;
  createdByUserId: string | null;
}

export interface TaskAccess extends ProjectAccess {
  task: AccessTask;
  parent: AccessTask | null;
}

const TASK_LEVELS = new Set<AccessLevel>([
  "READ",
  "CONTENT",
  "CONTENT_ARCHIVED_TASK",
  "AUTHOR",
  "AUTHOR_OR_MANAGE",
  "UPLOADER_OR_MANAGE",
  "CREATOR_OR_MANAGE",
]);

export interface RequireTaskOpts {
  /** The project lock (contract section 1, Lock column). */
  lock: ProjectLock;
  level: AccessLevel;
  /** A write's task lock: the parent FOR SHARE first, then the task in this mode. */
  taskLock?: RowLockMode;
  /** Row-level part of AUTHOR, AUTHOR_OR_MANAGE, UPLOADER_OR_MANAGE and CREATOR_OR_MANAGE. */
  allow?: (access: TaskAccess) => boolean | Promise<boolean>;
}

async function lockTaskRow(
  tx: ProjectDb,
  orgId: string,
  taskId: string,
  projectId: string | null,
  mode: RowLockMode,
): Promise<AccessTask | null> {
  const rows =
    projectId === null
      ? mode === "update"
        ? await tx.$queryRaw<AccessTask[]>`
            SELECT "id", "projectId", "parentId", "archivedAt", "createdByUserId" FROM "Task"
            WHERE "id" = ${taskId} AND "organizationId" = ${orgId}
            FOR UPDATE`
        : await tx.$queryRaw<AccessTask[]>`
            SELECT "id", "projectId", "parentId", "archivedAt", "createdByUserId" FROM "Task"
            WHERE "id" = ${taskId} AND "organizationId" = ${orgId}
            FOR SHARE`
      : await tx.$queryRaw<AccessTask[]>`
          SELECT "id", "projectId", "parentId", "archivedAt", "createdByUserId" FROM "Task"
          WHERE "id" = ${taskId} AND "organizationId" = ${orgId} AND "projectId" = ${projectId}
          FOR SHARE`;
  return rows[0] ?? null;
}

const TASK_FIELDS = {
  id: true,
  projectId: true,
  parentId: true,
  archivedAt: true,
  createdByUserId: true,
} as const;

/**
 * Task resolution of contract section 2 (review C3): reads the task's projectId and parentId,
 * runs requireProject on that project, then for a write (taskLock given) locks the parent FOR
 * SHARE (organization and project terms) and then the task in taskLock mode; a changed projectId
 * or parentId starts over once, then CONFLICT. Archive checks use the locked rows.
 */
export async function requireTask(
  client: ProjectDb,
  actor: ProjectActor,
  taskId: string,
  opts: RequireTaskOpts,
): Promise<TaskAccess> {
  if (!TASK_LEVELS.has(opts.level)) throw new Error(`requireTask: unsupported level ${opts.level}`);
  if (!isPlausibleId(taskId)) refuse("NOT_FOUND");
  await requireMembership(client, actor);
  for (let attempt = 0; attempt < 2; attempt++) {
    const plain = await client.task.findFirst({
      where: { id: taskId, organizationId: actor.orgId },
      select: { projectId: true, parentId: true },
    });
    if (!plain) refuse("NOT_FOUND");
    const access = await requireProject(client, actor, plain.projectId, {
      lock: opts.lock,
      level: opts.level === "READ" ? "READ" : "CONTENT",
    });
    let task: AccessTask | null;
    let parent: AccessTask | null = null;
    if (opts.taskLock) {
      if (plain.parentId) {
        parent = await lockTaskRow(client, actor.orgId, plain.parentId, plain.projectId, "share");
        if (!parent) continue;
      }
      task = await lockTaskRow(client, actor.orgId, taskId, null, opts.taskLock);
      if (!task) refuse("NOT_FOUND");
      if (task.projectId !== plain.projectId || task.parentId !== plain.parentId) continue;
    } else {
      task = await client.task.findFirst({
        where: { id: taskId, organizationId: actor.orgId, projectId: plain.projectId },
        select: TASK_FIELDS,
      });
      if (!task) refuse("NOT_FOUND");
      if (task.parentId) {
        parent = await client.task.findFirst({
          where: { id: task.parentId, organizationId: actor.orgId, projectId: task.projectId },
          select: TASK_FIELDS,
        });
      }
    }
    if (opts.level !== "READ") {
      if (task.archivedAt && opts.level !== "CONTENT_ARCHIVED_TASK") refuse("ARCHIVED");
      if (parent?.archivedAt) refuse("ARCHIVED");
    }
    const result: TaskAccess = { ...access, task, parent };
    if (opts.level === "AUTHOR") {
      if (!opts.allow || !(await opts.allow(result))) refuse("NOT_ALLOWED");
    } else if (
      opts.level === "AUTHOR_OR_MANAGE" ||
      opts.level === "UPLOADER_OR_MANAGE" ||
      opts.level === "CREATOR_OR_MANAGE"
    ) {
      if (!result.canManage && !(opts.allow && (await opts.allow(result)))) refuse("NOT_ALLOWED");
    }
    return result;
  }
  return refuse("CONFLICT");
}

/**
 * The typed list predicate (reads): a non-private project or one with a ProjectMember row of the
 * actor, always with the organization term (K69: no other branch).
 */
export function readableProjectWhere(actor: ProjectActor): Prisma.ProjectWhereInput {
  return {
    organizationId: actor.orgId,
    OR: [
      { isPrivate: false },
      { members: { some: { organizationId: actor.orgId, userId: actor.userId } } },
    ],
  };
}

/** The subset of projectIds the actor can read now (missing and deleted projects never are). */
export async function readableProjectIds(
  client: ProjectDb,
  actor: ProjectActor,
  projectIds: Iterable<string | null | undefined>,
): Promise<Set<string>> {
  const wanted = [...new Set([...projectIds].filter((id): id is string => isPlausibleId(id)))];
  if (wanted.length === 0) return new Set();
  const rows = await client.project.findMany({
    where: { AND: [readableProjectWhere(actor), { id: { in: wanted } }] },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * Eligibility (C14, K69): the user has a member row in the organization, and on a private project
 * also a direct ProjectMember row.
 */
export async function isEligibleAssignee(
  client: ProjectDb,
  orgId: string,
  projectId: string,
  userId: string,
): Promise<boolean> {
  if (!isPlausibleId(projectId) || !isPlausibleId(userId)) return false;
  const member = await client.member.findFirst({
    where: { organizationId: orgId, userId },
    select: { id: true },
  });
  if (!member) return false;
  const project = await client.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { isPrivate: true },
  });
  if (!project) return false;
  if (!project.isPrivate) return true;
  const row = await client.projectMember.findFirst({
    where: { organizationId: orgId, projectId, userId },
    select: { id: true },
  });
  return row !== null;
}
