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
  newBatchId,
  type ProjectDb,
  refuse,
  runProjectTransaction,
} from "./service";

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
