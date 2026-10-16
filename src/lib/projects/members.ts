// Phase 14 project membership (contract sections 1, 2, 3, 5 and 14; D-04, C14, K59, K69,
// AIDA-64). Relative imports only, no Next.js import (the worker reaches these modules too).
//
// A project's direct members are managed under MANAGE with the project FOR UPDATE (PROJECT_UPDATE),
// so every membership change serializes with every content write of the project (those hold it
// FOR SHARE and re-read access after the lock): a revocation either commits first and the waiting
// write ends in NOT_FOUND, or waits for the write. Only users with an organization member row,
// read conservatively (findConservativeMembership), can be added (NOT_ELIGIBLE). The `member`
// table is never locked here (contract section 3).
import { randomUUID } from "node:crypto";
import { findConservativeMembership } from "../membership";
import { requireProject } from "./access";
import { recordProjectActivity } from "./activity";
import {
  PROJECT_MEMBER_ROLES,
  type ProjectActor,
  type ProjectMemberRole,
  type ProjectResult,
} from "./contract";
import {
  afterLock,
  isPlausibleId,
  type ListPageOpts,
  newBatchId,
  type ProjectDb,
  pageInMemory,
  refuse,
  runProjectRead,
  runProjectTransaction,
} from "./service";

export interface ProjectMemberView {
  userId: string;
  name: string;
  role: ProjectMemberRole;
}

export interface PersonView {
  userId: string;
  name: string;
}

/** Plain code-unit order (never localeCompare). */
function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byNameThenId(a: PersonView, b: PersonView): number {
  return codeUnitCompare(a.name, b.name) || codeUnitCompare(a.userId, b.userId);
}

/**
 * The subset of userIds that still have a member row in the organization (C14): one read with the
 * organization term. Every list of people and every manager count goes through it.
 */
/** Code-unit comparison of two string keys, element by element (the sort order of the lists). */
function compareStringKeys(a: (string | number)[], b: (string | number)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = codeUnitCompare(String(a[i]), String(b[i]));
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

export async function activeOrgUserIds(
  db: ProjectDb,
  orgId: string,
  userIds: Iterable<string>,
): Promise<Set<string>> {
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return new Set();
  const rows = await db.member.findMany({
    where: { organizationId: orgId, userId: { in: wanted } },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}

function validRole(raw: unknown, fallback?: ProjectMemberRole): ProjectMemberRole {
  if (raw === undefined && fallback) return fallback;
  if (typeof raw !== "string" || !(PROJECT_MEMBER_ROLES as readonly string[]).includes(raw)) {
    refuse("INVALID_INPUT", "role");
  }
  return raw as ProjectMemberRole;
}

function validUserId(raw: unknown): string {
  if (typeof raw !== "string") refuse("INVALID_INPUT", "userId");
  return raw;
}

/** True while the user has a member row in the organization (conservative read, K59). */
async function isActiveOrgMember(tx: ProjectDb, orgId: string, userId: string): Promise<boolean> {
  if (!isPlausibleId(userId)) return false;
  return (await findConservativeMembership(tx, userId, orgId)) !== null;
}

/**
 * MANAGE under PROJECT_UPDATE: adds a direct member (role MEMBER by default). The user must have
 * an organization member row (NOT_ELIGIBLE). Adding an existing member again is a no-op.
 * MEMBER_ADDED (entity PROJECT_MEMBER, after { userId, role }).
 */
export async function addProjectMember(
  actor: ProjectActor,
  projectId: string,
  input: { userId: unknown; role?: unknown },
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "addProjectMember", async (tx) => {
    const userId = validUserId(input?.userId);
    const role = validRole(input?.role, "MEMBER");
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    if (!(await isActiveOrgMember(tx, actor.orgId, userId))) refuse("NOT_ELIGIBLE");
    await afterLock(tx, "addProjectMember");
    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "ProjectMember" (id, "organizationId", "projectId", "userId", role)
      VALUES (${id}, ${actor.orgId}, ${projectId}, ${userId}, ${role}::"ProjectMemberRole")
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      const existing = await tx.projectMember.findFirst({
        where: { organizationId: actor.orgId, projectId, userId },
        select: { id: true },
      });
      if (existing) return { changed: false };
      throw new Error("addProjectMember: insert refused without an existing member row");
    }
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "MEMBER_ADDED",
      entityType: "PROJECT_MEMBER",
      entityId: id,
      after: { userId, role },
      batchId: newBatchId(),
    });
    return { changed: true };
  });
}

/**
 * READ: the project's direct members with role and name, managers first, then by name and user
 * id. A user whose organization member row is gone is left out (C14); the stale row stays.
 */
export async function listProjectMembers(
  actor: ProjectActor,
  projectId: string,
  opts: ListPageOpts = {},
): Promise<
  ProjectResult<{ members: ProjectMemberView[]; hasMore: boolean; nextCursor: string | null }>
> {
  return runProjectRead(actor, "listProjectMembers", async (db) => {
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    const rows = await db.projectMember.findMany({
      where: { organizationId: actor.orgId, projectId },
      select: { userId: true, role: true, user: { select: { name: true } } },
    });
    const active = await activeOrgUserIds(
      db,
      actor.orgId,
      rows.map((row) => row.userId),
    );
    const members = rows
      .filter((row) => active.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        name: row.user.name,
        role: row.role as ProjectMemberRole,
      }))
      .sort((a, b) => codeUnitCompare(a.role, b.role) || byNameThenId(a, b));
    // Keyset (role, name, userId), review a-WR-07.
    const page = pageInMemory(
      members,
      opts ?? {},
      (m) => [m.role, m.name, m.userId],
      compareStringKeys,
      ["string", "string", "string"],
    );
    return { members: page.rows, hasMore: page.hasMore, nextCursor: page.nextCursor };
  });
}

/**
 * READ: who a task of the project may be assigned to (C14, K69): every active organization member
 * for a non-private project; for a private project the active direct members only (a member of an
 * assigned team without a direct row is not eligible). By name, then user id.
 */
export async function listEligibleAssignees(
  actor: ProjectActor,
  projectId: string,
  opts: ListPageOpts = {},
): Promise<
  ProjectResult<{ assignees: PersonView[]; hasMore: boolean; nextCursor: string | null }>
> {
  return runProjectRead(actor, "listEligibleAssignees", async (db) => {
    const access = await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    const people = new Map<string, string>();
    if (access.project.isPrivate) {
      const rows = await db.projectMember.findMany({
        where: { organizationId: actor.orgId, projectId },
        select: { userId: true, user: { select: { name: true } } },
      });
      // isEligibleAssignee's rule for a private project, for all rows in one read.
      const active = await activeOrgUserIds(
        db,
        actor.orgId,
        rows.map((row) => row.userId),
      );
      for (const row of rows) if (active.has(row.userId)) people.set(row.userId, row.user.name);
    } else {
      const rows = await db.member.findMany({
        where: { organizationId: actor.orgId },
        select: { userId: true, user: { select: { name: true } } },
      });
      for (const row of rows) people.set(row.userId, row.user.name);
    }
    const assignees = [...people].map(([userId, name]) => ({ userId, name })).sort(byNameThenId);
    // Keyset (name, userId), review a-WR-07.
    const page = pageInMemory(assignees, opts ?? {}, (p) => [p.name, p.userId], compareStringKeys, [
      "string",
      "string",
    ]);
    return { assignees: page.rows, hasMore: page.hasMore, nextCursor: page.nextCursor };
  });
}

/**
 * Last-manager rule (contract section 2, open point 8): refuses with LAST_MANAGER when taking the
 * MANAGER role from targetUserId would leave no manager that still has an organization member
 * row. A target that has no member row any more does not count, so removing it never refuses.
 */
async function assertNotLastManager(
  tx: ProjectDb,
  orgId: string,
  projectId: string,
  targetUserId: string,
): Promise<void> {
  const managers = await tx.projectMember.findMany({
    where: { organizationId: orgId, projectId, role: "MANAGER" },
    select: { userId: true },
  });
  const active = await activeOrgUserIds(
    tx,
    orgId,
    managers.map((row) => row.userId),
  );
  if (!active.has(targetUserId)) return;
  const others = [...active].filter((userId) => userId !== targetUserId);
  if (others.length === 0) refuse("LAST_MANAGER");
}

/**
 * SELF_OR_MANAGE under PROJECT_UPDATE: a member leaves (their own row; the project must be
 * readable and not archived) or a manager removes a member. The last active manager is never
 * removed (LAST_MANAGER). A user without a row is a no-op. MEMBER_REMOVED (before { userId, role }).
 */
export async function removeProjectMember(
  actor: ProjectActor,
  projectId: string,
  userIdRaw: unknown,
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "removeProjectMember", async (tx) => {
    const userId = validUserId(userIdRaw);
    const self = userId === actor.userId;
    await requireProject(tx, actor, projectId, {
      lock: "update",
      level: self ? "CONTENT" : "MANAGE",
    });
    await afterLock(tx, "removeProjectMember");
    if (!isPlausibleId(userId)) return { changed: false };
    const row = await tx.projectMember.findFirst({
      where: { organizationId: actor.orgId, projectId, userId },
      select: { id: true, role: true },
    });
    if (!row) return { changed: false };
    if (row.role === "MANAGER") await assertNotLastManager(tx, actor.orgId, projectId, userId);
    await tx.projectMember.deleteMany({ where: { id: row.id, organizationId: actor.orgId } });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "MEMBER_REMOVED",
      entityType: "PROJECT_MEMBER",
      entityId: row.id,
      before: { userId, role: row.role },
      batchId: newBatchId(),
    });
    return { changed: true };
  });
}

/**
 * MANAGE under PROJECT_UPDATE: promotes or demotes a direct member. Promoting a user without an
 * organization member row is NOT_ELIGIBLE; demoting the last active manager is LAST_MANAGER; a
 * user without a project row is NOT_FOUND; the same role is a no-op. MEMBER_ROLE_CHANGED (before
 * { role }, after { role }).
 */
export async function setProjectMemberRole(
  actor: ProjectActor,
  projectId: string,
  userIdRaw: unknown,
  roleRaw: unknown,
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "setProjectMemberRole", async (tx) => {
    const userId = validUserId(userIdRaw);
    const role = validRole(roleRaw);
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "setProjectMemberRole");
    if (!isPlausibleId(userId)) refuse("NOT_FOUND");
    const row = await tx.projectMember.findFirst({
      where: { organizationId: actor.orgId, projectId, userId },
      select: { id: true, role: true },
    });
    if (!row) refuse("NOT_FOUND");
    if (row.role === role) return { changed: false };
    // A stale row of a user without a member row is never promoted (C14, review a-IN-04): such a
    // manager would never count for LAST_MANAGER and could never act.
    if (role === "MANAGER" && !(await activeOrgUserIds(tx, actor.orgId, [userId])).has(userId)) {
      refuse("NOT_ELIGIBLE");
    }
    if (row.role === "MANAGER") await assertNotLastManager(tx, actor.orgId, projectId, userId);
    await tx.projectMember.updateMany({
      where: { id: row.id, organizationId: actor.orgId },
      data: { role },
    });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "MEMBER_ROLE_CHANGED",
      entityType: "PROJECT_MEMBER",
      entityId: row.id,
      before: { role: row.role },
      after: { role },
      batchId: newBatchId(),
    });
    return { changed: true };
  });
}
