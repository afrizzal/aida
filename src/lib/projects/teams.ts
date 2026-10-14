// Phase 14 teams (contract sections 1, 2, 3, 5 and 14; D-04, D-15, C14, K69, review C2, AIDA-69).
// Relative imports only, no Next.js import (the worker reaches these modules too).
//
// Teams belong to one organization and are managed by organization owners and admins, read
// conservatively (isAdminRole on the deciding row). K69: a team never grants access to a private
// project. assignTeamToProject on a private project copies the team's current active members into
// direct ProjectMember rows in the same transaction; later team changes (addTeamMember,
// removeTeamMember, unassignTeamFromProject, deleteTeam) change no project's access.
//
// Review C2: no team operation depends on a link to a private project the caller cannot read.
// addTeamMember, removeTeamMember and renameTeam lock the team only and read no project;
// listTeams and deleteTeam return no project information; getTeam lists only readable projects.
//
// Lock order (contract section 3): the team row always comes before project rows. deleteTeam
// locks the team FOR UPDATE, then its assigned projects FOR UPDATE in id order; assignment locks
// the team FOR SHARE, then the project FOR UPDATE, and reads the team's members under that lock,
// so a concurrent addTeamMember either commits before the copy (and is in it) or waits.
import { randomUUID } from "node:crypto";
import { isAdminRole } from "../membership";
import {
  lockProjectsInIdOrder,
  lockTeam,
  readableProjectIds,
  requireMembership,
  requireProject,
} from "./access";
import { recordProjectActivity } from "./activity";
import {
  codePointLength,
  hasNul,
  LIST_MAX,
  type ProjectActor,
  type ProjectResult,
  TEAM_NAME_MAX,
} from "./contract";
import { activeOrgUserIds, type PersonView } from "./members";
import {
  afterLock,
  isPlausibleId,
  newBatchId,
  type ProjectDb,
  refuse,
  runProjectRead,
  runProjectTransaction,
} from "./service";

export interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
}

export interface TeamDetail {
  id: string;
  name: string;
  members: PersonView[];
  projects: { id: string; name: string }[];
}

/** Plain code-unit order (never localeCompare). */
function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validName(raw: unknown): string {
  if (typeof raw !== "string" || hasNul(raw)) refuse("INVALID_INPUT", "name");
  const name = raw.trim();
  const length = codePointLength(name);
  if (length < 1 || length > TEAM_NAME_MAX) refuse("INVALID_INPUT", "name");
  return name;
}

function validUserId(raw: unknown): string {
  if (typeof raw !== "string") refuse("INVALID_INPUT", "userId");
  return raw;
}

/** ORG_ADMIN: an active member whose deciding row is owner or admin (conservative), else NOT_ALLOWED. */
async function requireOrgAdmin(tx: ProjectDb, actor: ProjectActor): Promise<void> {
  const membership = await requireMembership(tx, actor);
  if (!isAdminRole(membership.role)) refuse("NOT_ALLOWED");
}

/** The team locked in the given mode (organization term), or NOT_FOUND. */
async function requireTeamLock(
  tx: ProjectDb,
  actor: ProjectActor,
  teamId: string,
  mode: "share" | "update",
): Promise<{ id: string; name: string }> {
  if (!(await lockTeam(tx, actor.orgId, teamId, mode))) refuse("NOT_FOUND");
  const team = await tx.team.findFirst({
    where: { id: teamId, organizationId: actor.orgId },
    select: { id: true, name: true },
  });
  return team ?? refuse("NOT_FOUND");
}

/** The active members of a team (C14): TeamMember rows whose user still has a member row. */
async function activeTeamMembers(
  db: ProjectDb,
  orgId: string,
  teamId: string,
): Promise<PersonView[]> {
  const rows = await db.teamMember.findMany({
    where: { organizationId: orgId, teamId },
    select: { userId: true, user: { select: { name: true } } },
  });
  const active = await activeOrgUserIds(
    db,
    orgId,
    rows.map((row) => row.userId),
  );
  return rows
    .filter((row) => active.has(row.userId))
    .map((row) => ({ userId: row.userId, name: row.user.name }))
    .sort((a, b) => codeUnitCompare(a.name, b.name) || codeUnitCompare(a.userId, b.userId));
}

/** MEMBER: the organization's teams with id, name and active member count; no project data. */
export async function listTeams(
  actor: ProjectActor,
): Promise<ProjectResult<{ teams: TeamSummary[] }>> {
  return runProjectRead(actor, "listTeams", async (db) => {
    const teams = await db.team.findMany({
      where: { organizationId: actor.orgId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: LIST_MAX,
      select: { id: true, name: true },
    });
    const rows = await db.teamMember.findMany({
      where: { organizationId: actor.orgId, teamId: { in: teams.map((team) => team.id) } },
      select: { teamId: true, userId: true },
    });
    const active = await activeOrgUserIds(
      db,
      actor.orgId,
      rows.map((row) => row.userId),
    );
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (active.has(row.userId)) counts.set(row.teamId, (counts.get(row.teamId) ?? 0) + 1);
    }
    return {
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        memberCount: counts.get(team.id) ?? 0,
      })),
    };
  });
}

/**
 * MEMBER: one team with its active members and the assigned projects the caller can read now
 * (review C2: a project the caller cannot read leaves no trace). Another organization's team id
 * is NOT_FOUND.
 */
export async function getTeam(
  actor: ProjectActor,
  teamId: string,
): Promise<ProjectResult<{ team: TeamDetail }>> {
  return runProjectRead(actor, "getTeam", async (db) => {
    if (!isPlausibleId(teamId)) refuse("NOT_FOUND");
    const team = await db.team.findFirst({
      where: { id: teamId, organizationId: actor.orgId },
      select: { id: true, name: true },
    });
    if (!team) refuse("NOT_FOUND");
    const members = await activeTeamMembers(db, actor.orgId, teamId);
    const links = await db.projectTeam.findMany({
      where: { organizationId: actor.orgId, teamId },
      select: { projectId: true },
    });
    const readable = await readableProjectIds(
      db,
      actor,
      links.map((link) => link.projectId),
    );
    const projects =
      readable.size === 0
        ? []
        : await db.project.findMany({
            where: { organizationId: actor.orgId, id: { in: [...readable] } },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            select: { id: true, name: true },
          });
    return { team: { id: team.id, name: team.name, members, projects } };
  });
}

/** ORG_ADMIN: creates a team (names unique case-insensitively, NAME_TAKEN). TEAM_CREATED. */
export async function createTeam(
  actor: ProjectActor,
  input: { name: unknown },
): Promise<ProjectResult<{ team: { id: string; name: string } }>> {
  return runProjectTransaction(actor, "createTeam", async (tx) => {
    const name = validName(input?.name);
    await requireOrgAdmin(tx, actor);
    await afterLock(tx, "createTeam");
    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "Team" (id, "organizationId", name, "updatedAt")
      VALUES (${id}, ${actor.orgId}, ${name}, now())
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      const clash = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Team"
        WHERE "organizationId" = ${actor.orgId} AND lower(name) = lower(${name})
      `;
      if (clash.length > 0) refuse("NAME_TAKEN");
      throw new Error("createTeam: insert refused without a name clash");
    }
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: null,
      teamId: id,
      actorUserId: actor.userId,
      verb: "TEAM_CREATED",
      entityType: "TEAM",
      entityId: id,
      after: { name },
      batchId: newBatchId(),
    });
    return { team: { id, name } };
  });
}

/** ORG_ADMIN under TEAM_UPDATE: renames a team (NAME_TAKEN on a clash). TEAM_UPDATED. */
export async function renameTeam(
  actor: ProjectActor,
  teamId: string,
  input: { name: unknown },
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "renameTeam", async (tx) => {
    const name = validName(input?.name);
    await requireOrgAdmin(tx, actor);
    const team = await requireTeamLock(tx, actor, teamId, "update");
    await afterLock(tx, "renameTeam");
    if (team.name === name) return { changed: false };
    const clash = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Team"
      WHERE "organizationId" = ${actor.orgId} AND lower(name) = lower(${name}) AND id <> ${teamId}
    `;
    if (clash.length > 0) refuse("NAME_TAKEN");
    await tx.team.updateMany({
      where: { id: teamId, organizationId: actor.orgId },
      data: { name },
    });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: null,
      teamId,
      actorUserId: actor.userId,
      verb: "TEAM_UPDATED",
      entityType: "TEAM",
      entityId: teamId,
      before: { name: team.name },
      after: { name },
      batchId: newBatchId(),
    });
    return { changed: true };
  });
}

/**
 * ORG_ADMIN under TEAM_UPDATE_THEN_PROJECTS: deletes a team with its members and assignments.
 * TEAM_UNASSIGNED per assigned project (in that project's feed) and TEAM_DELETED (projectId null,
 * the team name and member count only). Copied project members stay (K69). Returns no project data.
 */
export async function deleteTeam(
  actor: ProjectActor,
  teamId: string,
): Promise<ProjectResult<Record<never, never>>> {
  return runProjectTransaction(actor, "deleteTeam", async (tx) => {
    await requireOrgAdmin(tx, actor);
    const team = await requireTeamLock(tx, actor, teamId, "update");
    const links = await tx.projectTeam.findMany({
      where: { organizationId: actor.orgId, teamId },
      orderBy: { projectId: "asc" },
      select: { id: true, projectId: true },
    });
    if (links.length > 0) {
      await lockProjectsInIdOrder(
        tx,
        actor.orgId,
        links.map((link) => link.projectId),
        "update",
      );
    }
    await afterLock(tx, "deleteTeam");
    const memberCount = await tx.teamMember.count({
      where: { organizationId: actor.orgId, teamId },
    });
    await tx.projectTeam.deleteMany({ where: { organizationId: actor.orgId, teamId } });
    await tx.teamMember.deleteMany({ where: { organizationId: actor.orgId, teamId } });
    await tx.team.deleteMany({ where: { id: teamId, organizationId: actor.orgId } });
    const batchId = newBatchId();
    for (const link of links) {
      await recordProjectActivity(tx, {
        orgId: actor.orgId,
        projectId: link.projectId,
        teamId,
        actorUserId: actor.userId,
        verb: "TEAM_UNASSIGNED",
        entityType: "PROJECT_TEAM",
        entityId: link.id,
        before: { teamId, teamName: team.name },
        batchId,
      });
    }
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: null,
      teamId,
      actorUserId: actor.userId,
      verb: "TEAM_DELETED",
      entityType: "TEAM",
      entityId: teamId,
      before: { name: team.name, memberCount },
      batchId,
    });
    return {};
  });
}

/**
 * ORG_ADMIN under TEAM_UPDATE: adds an active organization member to a team (NOT_ELIGIBLE
 * otherwise). Locks the team only and reads no project (K69, review C2): joining a team grants
 * nothing on a private project. A repeat is a no-op. TEAM_MEMBER_ADDED (projectId null).
 */
export async function addTeamMember(
  actor: ProjectActor,
  teamId: string,
  userIdRaw: unknown,
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "addTeamMember", async (tx) => {
    const userId = validUserId(userIdRaw);
    await requireOrgAdmin(tx, actor);
    await requireTeamLock(tx, actor, teamId, "update");
    const eligible =
      isPlausibleId(userId) && (await activeOrgUserIds(tx, actor.orgId, [userId])).has(userId);
    if (!eligible) refuse("NOT_ELIGIBLE");
    await afterLock(tx, "addTeamMember");
    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "TeamMember" (id, "organizationId", "teamId", "userId")
      VALUES (${id}, ${actor.orgId}, ${teamId}, ${userId})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) return { changed: false };
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: null,
      teamId,
      actorUserId: actor.userId,
      verb: "TEAM_MEMBER_ADDED",
      entityType: "TEAM_MEMBER",
      entityId: id,
      after: { userId },
      batchId: newBatchId(),
    });
    return { changed: true };
  });
}

/**
 * ORG_ADMIN under TEAM_UPDATE: removes a user from a team. Locks the team only and reads no
 * project; changes no project's access (K69). A user without a row is a no-op.
 * TEAM_MEMBER_REMOVED (projectId null).
 */
export async function removeTeamMember(
  actor: ProjectActor,
  teamId: string,
  userIdRaw: unknown,
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "removeTeamMember", async (tx) => {
    const userId = validUserId(userIdRaw);
    await requireOrgAdmin(tx, actor);
    await requireTeamLock(tx, actor, teamId, "update");
    await afterLock(tx, "removeTeamMember");
    if (!isPlausibleId(userId)) return { changed: false };
    const row = await tx.teamMember.findFirst({
      where: { organizationId: actor.orgId, teamId, userId },
      select: { id: true },
    });
    if (!row) return { changed: false };
    await tx.teamMember.deleteMany({ where: { id: row.id, organizationId: actor.orgId } });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: null,
      teamId,
      actorUserId: actor.userId,
      verb: "TEAM_MEMBER_REMOVED",
      entityType: "TEAM_MEMBER",
      entityId: row.id,
      before: { userId },
      batchId: newBatchId(),
    });
    return { changed: true };
  });
}

/** READ: the teams assigned to a project, by name then id. */
export async function listProjectTeams(
  actor: ProjectActor,
  projectId: string,
): Promise<ProjectResult<{ teams: { id: string; name: string }[] }>> {
  return runProjectRead(actor, "listProjectTeams", async (db) => {
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    const links = await db.projectTeam.findMany({
      where: { organizationId: actor.orgId, projectId },
      select: { teamId: true },
    });
    const teams =
      links.length === 0
        ? []
        : await db.team.findMany({
            where: { organizationId: actor.orgId, id: { in: links.map((link) => link.teamId) } },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take: LIST_MAX,
            select: { id: true, name: true },
          });
    return { teams };
  });
}

/**
 * MANAGE under TEAM_SHARE_THEN_PROJECT: assigns a team to a project. K69: on a private project
 * the team's current active members without a direct row are copied into ProjectMember rows
 * (role MEMBER) in the same transaction, TEAM_ASSIGNED plus one MEMBER_ADDED per copied member
 * (one batch), and their ids come back as copiedUserIds. On a non-private project nothing is
 * copied. Assigning an assigned team is a no-op.
 */
export async function assignTeamToProject(
  actor: ProjectActor,
  projectId: string,
  teamId: string,
): Promise<ProjectResult<{ changed: boolean; copiedUserIds?: string[] }>> {
  return runProjectTransaction(actor, "assignTeamToProject", async (tx) => {
    await requireMembership(tx, actor);
    const team = await requireTeamLock(tx, actor, teamId, "share");
    const access = await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "assignTeamToProject");
    const linkId = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "ProjectTeam" (id, "organizationId", "projectId", "teamId")
      VALUES (${linkId}, ${actor.orgId}, ${projectId}, ${teamId})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) return { changed: false };
    const copied: { id: string; userId: string }[] = [];
    if (access.project.isPrivate) {
      const teamRows = await tx.teamMember.findMany({
        where: { organizationId: actor.orgId, teamId },
        select: { userId: true },
      });
      const userIds = teamRows.map((row) => row.userId);
      const active = await activeOrgUserIds(tx, actor.orgId, userIds);
      const direct = await tx.projectMember.findMany({
        where: { organizationId: actor.orgId, projectId, userId: { in: userIds } },
        select: { userId: true },
      });
      const already = new Set(direct.map((row) => row.userId));
      const candidates = userIds
        .filter((userId) => active.has(userId) && !already.has(userId))
        .sort(codeUnitCompare);
      for (const userId of candidates) {
        const id = randomUUID();
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "ProjectMember" (id, "organizationId", "projectId", "userId", role)
          VALUES (${id}, ${actor.orgId}, ${projectId}, ${userId}, 'MEMBER'::"ProjectMemberRole")
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        if (rows.length > 0) copied.push({ id, userId });
      }
    }
    const batchId = newBatchId();
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      teamId,
      actorUserId: actor.userId,
      verb: "TEAM_ASSIGNED",
      entityType: "PROJECT_TEAM",
      entityId: linkId,
      after: { teamId, teamName: team.name },
      batchId,
    });
    for (const row of copied) {
      await recordProjectActivity(tx, {
        orgId: actor.orgId,
        projectId,
        teamId,
        actorUserId: actor.userId,
        verb: "MEMBER_ADDED",
        entityType: "PROJECT_MEMBER",
        entityId: row.id,
        after: { userId: row.userId, role: "MEMBER", teamId },
        batchId,
      });
    }
    return { changed: true, copiedUserIds: copied.map((row) => row.userId) };
  });
}

/**
 * MANAGE under TEAM_SHARE_THEN_PROJECT: removes a team's assignment only; members copied by the
 * assignment stay direct members (K69). TEAM_UNASSIGNED. A team that is not assigned is a no-op.
 */
export async function unassignTeamFromProject(
  actor: ProjectActor,
  projectId: string,
  teamId: string,
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "unassignTeamFromProject", async (tx) => {
    await requireMembership(tx, actor);
    const team = await requireTeamLock(tx, actor, teamId, "share");
    await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, "unassignTeamFromProject");
    const link = await tx.projectTeam.findFirst({
      where: { organizationId: actor.orgId, projectId, teamId },
      select: { id: true },
    });
    if (!link) return { changed: false };
    await tx.projectTeam.deleteMany({ where: { id: link.id, organizationId: actor.orgId } });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      teamId,
      actorUserId: actor.userId,
      verb: "TEAM_UNASSIGNED",
      entityType: "PROJECT_TEAM",
      entityId: link.id,
      before: { teamId, teamName: team.name },
      batchId: newBatchId(),
    });
    return { changed: true };
  });
}
