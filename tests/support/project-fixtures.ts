// Test-only seed helpers shared by every Phase 14 (projects) test. Relative imports only. Each
// call creates fresh, uniquely named rows so cases stay independent. Rows are inserted directly
// (no service exists in plan 14-02), with scalar foreign keys only (C1), so only the database's
// own CHECKs, triggers and foreign keys apply. Later plans import this file and keep any extra
// helper inside their own test file; it is not edited again in Phase 14.
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type {
  Prisma,
  PrismaClient,
  ProjectActivityEntity,
  ProjectActivityVerb,
  ProjectStatus,
  RecurrenceRule,
  TaskStatus,
} from "../../src/generated/prisma/client";
import {
  type CalendarDate,
  fromCalendarDate,
  type ProjectActor,
  RANK_GAP,
} from "../../src/lib/projects/contract";
import { type MemberRole, type SeededMember, seedOrgWithMembers } from "./inbox-fixtures";

export { seedOrgWithMembers } from "./inbox-fixtures";

/** The actor shape every Phase 14 service takes. */
export function actorOf(userId: string, orgId: string): ProjectActor {
  return { userId, orgId };
}

/** A well-formed id that exists nowhere (the NOT_FOUND comparison of contract section 17). */
export function missingId(): string {
  return randomUUID();
}

const compactId = (): string => randomUUID().replace(/-/g, "");

/** A fresh key prefix matching ^[A-Z][A-Z0-9]{1,9}$ ("P" and eight upper-case hex characters). */
function freshPrefix(): string {
  return `P${compactId().slice(0, 8).toUpperCase()}`;
}

/** Creates a new user and a member row of the given role in the organization. */
export async function addOrgMember(
  prisma: PrismaClient,
  orgId: string,
  role: MemberRole,
): Promise<SeededMember> {
  const now = new Date();
  const id = randomUUID();
  const memberId = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: `Fixture ${role}`,
      email: `fx-${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.member.create({
    data: { id: memberId, organizationId: orgId, userId: id, role, createdAt: now },
  });
  return { id, role, memberId };
}

/** Deletes the user's member rows in the organization (the user row stays). */
export async function removeOrgMember(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
): Promise<void> {
  await prisma.member.deleteMany({ where: { organizationId: orgId, userId } });
}

export interface SeedProjectOpts {
  createdByUserId: string;
  name?: string;
  keyPrefix?: string;
  isPrivate?: boolean;
  status?: ProjectStatus;
  archivedAt?: Date | null;
  position?: number;
  managerUserIds?: readonly string[];
  memberUserIds?: readonly string[];
}

/** Inserts a Project, its ProjectKeyPrefix reservation, its counter and its ProjectMember rows. */
export async function seedProject(
  prisma: PrismaClient,
  orgId: string,
  opts: SeedProjectOpts,
): Promise<{ id: string; keyPrefix: string }> {
  const keyPrefix = opts.keyPrefix ?? freshPrefix();
  const project = await prisma.project.create({
    data: {
      organizationId: orgId,
      name: opts.name ?? `Project ${keyPrefix}`,
      keyPrefix,
      isPrivate: opts.isPrivate ?? false,
      status: opts.status,
      archivedAt: opts.archivedAt ?? null,
      position: opts.position ?? 0,
      createdByUserId: opts.createdByUserId,
    },
    select: { id: true },
  });
  await prisma.projectKeyPrefix.create({
    data: { organizationId: orgId, prefix: keyPrefix, projectId: project.id },
  });
  await prisma.projectTaskCounter.create({
    data: { organizationId: orgId, projectId: project.id },
  });
  const rows = [
    ...(opts.managerUserIds ?? []).map((userId) => ({ userId, role: "MANAGER" as const })),
    ...(opts.memberUserIds ?? []).map((userId) => ({ userId, role: "MEMBER" as const })),
  ];
  for (const row of rows) {
    await prisma.projectMember.create({
      data: { organizationId: orgId, projectId: project.id, userId: row.userId, role: row.role },
    });
  }
  return { id: project.id, keyPrefix };
}

export interface SeedTaskOpts {
  title?: string;
  status?: TaskStatus;
  parentId?: string | null;
  assigneeUserId?: string | null;
  createdByUserId?: string | null;
  startDate?: CalendarDate | null;
  dueDate?: CalendarDate | null;
  archivedAt?: Date | null;
  rank?: number;
  milestoneId?: string | null;
  labelIds?: readonly string[];
  recurrence?: { rule: RecurrenceRule; anchor: CalendarDate; timeZone: string };
}

const dateOrNull = (value: CalendarDate | null | undefined): Date | null =>
  value ? fromCalendarDate(value) : null;

/**
 * Takes the next number from the project's counter with the contract's UPDATE ... RETURNING
 * (section 6), then inserts the Task, its ACTIVE TaskKey row and any TaskLabel rows.
 */
export async function seedTask(
  prisma: PrismaClient,
  orgId: string,
  projectId: string,
  opts: SeedTaskOpts = {},
): Promise<{ id: string; key: string; number: number }> {
  const project = await prisma.project.findFirstOrThrow({
    where: { id: projectId, organizationId: orgId },
    select: { keyPrefix: true },
  });
  const counter = await prisma.$queryRaw<{ lastNumber: number }[]>`
    UPDATE "ProjectTaskCounter" SET "lastNumber" = "lastNumber" + 1
    WHERE "projectId" = ${projectId} AND "organizationId" = ${orgId} AND "lastNumber" < 999999999
    RETURNING "lastNumber"`;
  const number = Number(counter[0]?.lastNumber);
  if (!Number.isInteger(number) || number < 1) throw new Error("seedTask: no counter row");
  const key = `${project.keyPrefix}-${number}`;
  const task = await prisma.task.create({
    data: {
      organizationId: orgId,
      projectId,
      parentId: opts.parentId ?? null,
      number,
      key,
      title: opts.title ?? `Task ${key}`,
      status: opts.status,
      assigneeUserId: opts.assigneeUserId ?? null,
      createdByUserId: opts.createdByUserId ?? null,
      startDate: dateOrNull(opts.startDate),
      dueDate: dateOrNull(opts.dueDate),
      archivedAt: opts.archivedAt ?? null,
      rank: opts.rank ?? number * RANK_GAP,
      milestoneId: opts.milestoneId ?? null,
      recurrenceRule: opts.recurrence?.rule ?? null,
      recurrenceAnchor: opts.recurrence ? fromCalendarDate(opts.recurrence.anchor) : null,
      recurrenceTimeZone: opts.recurrence?.timeZone ?? null,
    },
    select: { id: true },
  });
  await prisma.taskKey.create({
    data: { organizationId: orgId, normalizedKey: key, taskId: task.id, projectId },
  });
  for (const labelId of opts.labelIds ?? []) {
    await prisma.taskLabel.create({
      data: { organizationId: orgId, projectId, taskId: task.id, labelId },
    });
  }
  return { id: task.id, key, number };
}

/** Inserts a Team, its TeamMember rows and a ProjectTeam row per given project. */
export async function seedTeam(
  prisma: PrismaClient,
  orgId: string,
  opts: { name?: string; memberUserIds?: readonly string[]; projectIds?: readonly string[] } = {},
): Promise<{ id: string; name: string }> {
  const name = opts.name ?? `Team ${compactId().slice(0, 8)}`;
  const team = await prisma.team.create({
    data: { organizationId: orgId, name },
    select: { id: true },
  });
  for (const userId of opts.memberUserIds ?? []) {
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, userId } });
  }
  for (const projectId of opts.projectIds ?? []) {
    await prisma.projectTeam.create({
      data: { organizationId: orgId, projectId, teamId: team.id },
    });
  }
  return { id: team.id, name };
}

export async function seedLabel(
  prisma: PrismaClient,
  orgId: string,
  projectId: string,
  opts: { name?: string; color?: string } = {},
): Promise<{ id: string; name: string }> {
  const name = opts.name ?? `Label ${compactId().slice(0, 8)}`;
  const label = await prisma.projectLabel.create({
    data: { organizationId: orgId, projectId, name, color: opts.color },
    select: { id: true },
  });
  return { id: label.id, name };
}

export async function seedMilestone(
  prisma: PrismaClient,
  orgId: string,
  projectId: string,
  opts: { name?: string; date?: CalendarDate } = {},
): Promise<{ id: string; name: string }> {
  const name = opts.name ?? `Milestone ${compactId().slice(0, 8)}`;
  const milestone = await prisma.projectMilestone.create({
    data: {
      organizationId: orgId,
      projectId,
      name,
      date: fromCalendarDate(opts.date ?? "2026-12-31"),
    },
    select: { id: true },
  });
  return { id: milestone.id, name };
}

export async function seedComment(
  prisma: PrismaClient,
  orgId: string,
  taskId: string,
  opts: { authorUserId: string; body?: string },
): Promise<{ id: string }> {
  return prisma.taskComment.create({
    data: {
      organizationId: orgId,
      taskId,
      authorUserId: opts.authorUserId,
      bodyMarkdown: opts.body ?? "A fixture comment",
    },
    select: { id: true },
  });
}

export async function seedAttachment(
  prisma: PrismaClient,
  orgId: string,
  taskId: string,
  opts: { uploadedByUserId: string; storageKey?: string; originalFilename?: string },
): Promise<{ id: string; storageKey: string }> {
  const storageKey = opts.storageKey ?? `${compactId()}.png`;
  const row = await prisma.taskAttachment.create({
    data: {
      organizationId: orgId,
      taskId,
      storageKey,
      originalFilename: opts.originalFilename ?? "fixture.png",
      mimeType: "image/png",
      sizeBytes: 128,
      uploadedByUserId: opts.uploadedByUserId,
    },
    select: { id: true },
  });
  return { id: row.id, storageKey };
}

export interface SeedActivityRow {
  projectId?: string | null;
  relatedProjectId?: string | null;
  taskId?: string | null;
  teamId?: string | null;
  actorUserId?: string;
  verb?: ProjectActivityVerb;
  entityType?: ProjectActivityEntity;
  entityId?: string;
  before?: Prisma.InputJsonObject | null;
  after?: Prisma.InputJsonObject | null;
  batchId?: string;
  createdAt?: Date;
}

/** Inserts one ProjectActivity row for read and redaction tests (give projectId or teamId). */
export async function seedActivity(
  prisma: PrismaClient,
  orgId: string,
  row: SeedActivityRow,
): Promise<{ id: string }> {
  return prisma.projectActivity.create({
    data: {
      organizationId: orgId,
      projectId: row.projectId ?? null,
      relatedProjectId: row.relatedProjectId ?? null,
      taskId: row.taskId ?? null,
      teamId: row.teamId ?? null,
      actorUserId: row.actorUserId ?? randomUUID(),
      verb: row.verb ?? "PROJECT_UPDATED",
      entityType: row.entityType ?? "PROJECT",
      entityId: row.entityId ?? row.projectId ?? row.teamId ?? randomUUID(),
      before: row.before ?? undefined,
      after: row.after ?? undefined,
      batchId: row.batchId ?? randomUUID(),
      createdAt: row.createdAt,
    },
    select: { id: true },
  });
}

export async function seedFileCleanup(
  prisma: PrismaClient,
  orgId: string,
  storageKey: string,
  opts: { nextAttemptAt?: Date; attempts?: number } = {},
): Promise<{ id: string }> {
  return prisma.projectFileCleanup.create({
    data: {
      organizationId: orgId,
      storageKey,
      nextAttemptAt: opts.nextAttemptAt,
      attempts: opts.attempts ?? 0,
    },
    select: { id: true },
  });
}

// Snapshot order per model (review C4): each table ordered by its own primary key, so two
// snapshots of an unchanged organization are deep-equal. ProjectTaskCounter has no id column
// (primary key projectId); TaskLabel's primary key is the composite (taskId, labelId).
const SNAPSHOT_ORDER = {
  Project: [{ id: "asc" }],
  ProjectMember: [{ id: "asc" }],
  Team: [{ id: "asc" }],
  TeamMember: [{ id: "asc" }],
  ProjectTeam: [{ id: "asc" }],
  ProjectLabel: [{ id: "asc" }],
  ProjectMilestone: [{ id: "asc" }],
  Task: [{ id: "asc" }],
  TaskLabel: [{ taskId: "asc" }, { labelId: "asc" }],
  TaskComment: [{ id: "asc" }],
  TaskAttachment: [{ id: "asc" }],
  ProjectFavorite: [{ id: "asc" }],
  TaskFavorite: [{ id: "asc" }],
  ProjectTaskCounter: [{ projectId: "asc" }],
  ProjectKeyPrefix: [{ id: "asc" }],
  TaskKey: [{ id: "asc" }],
  ProjectActivity: [{ id: "asc" }],
  ProjectFileCleanup: [{ id: "asc" }],
} as const;

export type ProjectSnapshotModel = keyof typeof SNAPSHOT_ORDER;
export type ProjectTableSnapshot = Record<ProjectSnapshotModel, unknown[]>;

type SnapshotDelegate = {
  findMany(args: { where: { organizationId: string }; orderBy: unknown }): Promise<unknown[]>;
};

/** All 18 Phase 14 tables of one organization, each ordered by its primary key (review C4). */
export async function projectTableSnapshot(
  prisma: PrismaClient,
  orgId: string,
): Promise<ProjectTableSnapshot> {
  const delegates = prisma as unknown as Record<string, SnapshotDelegate>;
  const snapshot = {} as ProjectTableSnapshot;
  for (const [model, orderBy] of Object.entries(SNAPSHOT_ORDER) as [
    ProjectSnapshotModel,
    (typeof SNAPSHOT_ORDER)[ProjectSnapshotModel],
  ][]) {
    const delegate = delegates[model.charAt(0).toLowerCase() + model.slice(1)];
    if (!delegate) throw new Error(`projectTableSnapshot: no delegate for ${model}`);
    snapshot[model] = await delegate.findMany({ where: { organizationId: orgId }, orderBy });
  }
  return snapshot;
}

export interface PrivacyWorld {
  orgA: string;
  orgB: string;
  users: {
    manager: string;
    member: string;
    teamMember: string;
    nonMember: string;
    orgAdmin: string;
    outsider: string;
  };
  actors: {
    manager: ProjectActor;
    member: ProjectActor;
    teamMember: ProjectActor;
    nonMember: ProjectActor;
    orgAdmin: ProjectActor;
    outsider: ProjectActor;
  };
  project: { id: string; keyPrefix: string };
  openProject: { id: string; keyPrefix: string };
  projectB: { id: string; keyPrefix: string };
  team: { id: string; name: string };
  label: { id: string; name: string };
  milestone: { id: string; name: string };
  task: { id: string; key: string; number: number };
  subtask: { id: string; key: string; number: number };
  comment: { id: string };
  attachment: { id: string; storageKey: string };
}

/**
 * The world of contract section 17. Organization A: manager (project MANAGER), member (project
 * MEMBER), teamMember (TeamMember of a team linked to the project by a ProjectTeam row, with no
 * ProjectMember row: the state K69 leaves for a user who joined the team after its assignment, so
 * on a private project it is refused exactly like nonMember), nonMember (plain member) and
 * orgAdmin (owner, no project row). Organization B: outsider. In A one project (private by
 * default) with a label, a milestone, a top-level task carrying both, one subtask, a comment and an
 * attachment row, plus one non-private project; in B one project.
 */
export async function seedPrivacyWorld(
  prisma: PrismaClient,
  opts: { isPrivate?: boolean } = {},
): Promise<PrivacyWorld> {
  const isPrivate = opts.isPrivate ?? true;
  const a = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member", "member"]);
  const b = await seedOrgWithMembers(prisma, ["member"]);
  const [orgAdmin, manager, member, teamMember, nonMember] = a.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const outsider = b.users[0]?.id as string;
  const project = await seedProject(prisma, a.orgId, {
    createdByUserId: manager,
    isPrivate,
    managerUserIds: [manager],
    memberUserIds: [member],
  });
  const team = await seedTeam(prisma, a.orgId, {
    memberUserIds: [teamMember],
    projectIds: [project.id],
  });
  const label = await seedLabel(prisma, a.orgId, project.id);
  const milestone = await seedMilestone(prisma, a.orgId, project.id);
  const task = await seedTask(prisma, a.orgId, project.id, {
    createdByUserId: manager,
    assigneeUserId: member,
    milestoneId: milestone.id,
    labelIds: [label.id],
  });
  const subtask = await seedTask(prisma, a.orgId, project.id, {
    createdByUserId: manager,
    parentId: task.id,
  });
  const comment = await seedComment(prisma, a.orgId, task.id, { authorUserId: member });
  const attachment = await seedAttachment(prisma, a.orgId, task.id, { uploadedByUserId: member });
  const openProject = await seedProject(prisma, a.orgId, {
    createdByUserId: manager,
    isPrivate: false,
    managerUserIds: [manager],
  });
  const projectB = await seedProject(prisma, b.orgId, {
    createdByUserId: outsider,
    managerUserIds: [outsider],
  });
  const users = { manager, member, teamMember, nonMember, orgAdmin, outsider };
  return {
    orgA: a.orgId,
    orgB: b.orgId,
    users,
    actors: {
      manager: actorOf(manager, a.orgId),
      member: actorOf(member, a.orgId),
      teamMember: actorOf(teamMember, a.orgId),
      nonMember: actorOf(nonMember, a.orgId),
      orgAdmin: actorOf(orgAdmin, a.orgId),
      outsider: actorOf(outsider, b.orgId),
    },
    project,
    openProject,
    projectB,
    team,
    label,
    milestone,
    task,
    subtask,
    comment,
    attachment,
  };
}

/**
 * Every file under `dir`, recursively, as paths relative to `dir`, sorted (reviews c-WR-01 and
 * c-WR-02). Only a missing directory (ENOENT) counts as empty: any other error is thrown, so a
 * "no file on disk" assertion can never pass because the directory could not be read.
 */
export async function filesUnder(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      for (const inner of await filesUnder(path.join(dir, entry.name))) {
        files.push(path.join(entry.name, inner));
      }
    } else {
      files.push(entry.name);
    }
  }
  return files.sort();
}
