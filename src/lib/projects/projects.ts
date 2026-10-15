// Phase 14 project operations (contract sections 1, 6, 8, 14 and 15; AIDA-64, AIDA-68, AIDA-100,
// AIDA-104). Relative imports only, no Next.js import. Every operation takes the actor from the
// server context and checks it itself: membership first, then the policy of access.ts. Every
// successful mutation writes exactly one activity row through recordProjectActivity in its own
// transaction; a no-op or a refusal writes none. Every query writes the organization term (C1).
import type { Prisma } from "../../generated/prisma/client";
import { renderTaskMarkdown } from "../markdown/render";
import {
  type AccessProject,
  readableProjectIds,
  readableProjectWhere,
  requireMembership,
  requireProject,
} from "./access";
import { changedValues, recordProjectActivity } from "./activity";
import {
  type ActivityScalar,
  type ActivityVerb,
  type CalendarDate,
  codePointLength,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_STATUS,
  fromCalendarDate,
  hasNul,
  LIST_DEFAULT,
  LIST_MAX,
  normalizePrefix,
  PROJECT_COLORS,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_ICONS,
  PROJECT_NAME_MAX,
  PROJECT_STATUSES,
  type ProjectActor,
  type ProjectColor,
  type ProjectIcon,
  type ProjectMemberRole,
  type ProjectResult,
  type ProjectStatus,
  parseCalendarDate,
  RANK_MAX,
  toCalendarDate,
} from "./contract";
import { activeOrgUserIds } from "./members";
import { appendRank, rankBetween, rebalancedRanks } from "./rank";
import {
  afterLock,
  newBatchId,
  type ProjectDb,
  refuse,
  runProjectRead,
  runProjectTransaction,
} from "./service";

// ---------------------------------------------------------------------------------------------
// Input validation (contract section 15)

function validName(raw: unknown): string {
  if (typeof raw !== "string" || hasNul(raw)) refuse("INVALID_INPUT", "name");
  const name = raw.trim();
  const length = codePointLength(name);
  if (length < 1 || length > PROJECT_NAME_MAX) refuse("INVALID_INPUT", "name");
  return name;
}

function validDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || hasNul(raw)) refuse("INVALID_INPUT", "description");
  // The stored value is the validated one (review a-WR-05): the CHECK measures what is stored.
  const text = raw.trim();
  if (text.length === 0) return null;
  if (codePointLength(text) > PROJECT_DESCRIPTION_MAX) refuse("INVALID_INPUT", "description");
  return text;
}

function validColor(raw: unknown): ProjectColor {
  if (typeof raw !== "string" || !(PROJECT_COLORS as readonly string[]).includes(raw)) {
    refuse("INVALID_INPUT", "color");
  }
  return raw as ProjectColor;
}

function validIcon(raw: unknown): ProjectIcon | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || !(PROJECT_ICONS as readonly string[]).includes(raw)) {
    refuse("INVALID_INPUT", "icon");
  }
  return raw as ProjectIcon;
}

function validStatus(raw: unknown): ProjectStatus {
  if (typeof raw !== "string" || !(PROJECT_STATUSES as readonly string[]).includes(raw)) {
    refuse("INVALID_INPUT", "status");
  }
  return raw as ProjectStatus;
}

function validDueDate(raw: unknown): CalendarDate | null {
  if (raw === null || raw === undefined) return null;
  const date = parseCalendarDate(raw);
  if (date === null) refuse("INVALID_INPUT", "dueDate");
  return date;
}

function validPrefix(raw: unknown): string {
  const prefix = typeof raw === "string" && !hasNul(raw) ? normalizePrefix(raw) : null;
  if (prefix === null) refuse("PREFIX_INVALID");
  return prefix;
}

function validVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    refuse("INVALID_INPUT", "expectedVersion");
  }
  return raw;
}

function validBoolean(raw: unknown, field: string): boolean {
  if (typeof raw !== "boolean") refuse("INVALID_INPUT", field);
  return raw;
}

/**
 * Reserves a prefix for a project (contract section 6, D-08): INSERT ... ON CONFLICT DO NOTHING
 * on ProjectKeyPrefix, then a re-read. Reserved by another project: PREFIX_TAKEN. Reservations
 * are never deleted, so a project may always return to a prefix it reserved itself.
 */
async function reservePrefix(
  tx: ProjectDb,
  orgId: string,
  projectId: string,
  prefix: string,
): Promise<void> {
  await tx.projectKeyPrefix.createMany({
    data: [{ organizationId: orgId, prefix, projectId }],
    skipDuplicates: true,
  });
  const row = await tx.projectKeyPrefix.findFirst({
    where: { organizationId: orgId, prefix },
    select: { projectId: true },
  });
  if (!row || row.projectId !== projectId) refuse("PREFIX_TAKEN");
}

/** LAST_MANAGER unless a MANAGER row of the project belongs to an active organization member. */
async function assertActiveManager(tx: ProjectDb, orgId: string, projectId: string): Promise<void> {
  const managers = await tx.projectMember.findMany({
    where: { organizationId: orgId, projectId, role: "MANAGER" },
    select: { userId: true },
  });
  const active = await activeOrgUserIds(
    tx,
    orgId,
    managers.map((row) => row.userId),
  );
  if (active.size === 0) refuse("LAST_MANAGER");
}

// ---------------------------------------------------------------------------------------------
// createProject and getProject

export interface CreateProjectInput {
  name: string;
  keyPrefix: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  isPrivate?: boolean;
  dueDate?: CalendarDate | null;
}

/**
 * Any active member creates a project (MEMBER, no lock): the Project at the end of the
 * organization's order, its prefix reservation, its task counter, the creator's MANAGER row and
 * one PROJECT_CREATED row, all through scalar foreign keys (C1).
 */
export async function createProject(
  actor: ProjectActor,
  input: CreateProjectInput,
): Promise<ProjectResult<{ projectId: string; keyPrefix: string }>> {
  return runProjectTransaction(actor, "createProject", async (tx) => {
    await requireMembership(tx, actor);
    const name = validName(input?.name);
    const keyPrefix = validPrefix(input?.keyPrefix);
    const descriptionMarkdown = validDescription(input?.description);
    const color = input?.color === undefined ? DEFAULT_PROJECT_COLOR : validColor(input.color);
    const icon = validIcon(input?.icon);
    const isPrivate =
      input?.isPrivate === undefined ? false : validBoolean(input.isPrivate, "isPrivate");
    const dueDate = validDueDate(input?.dueDate);
    await afterLock(tx, "createProject");
    const largest = await tx.project.aggregate({
      where: { organizationId: actor.orgId },
      _max: { position: true },
    });
    const max = largest._max.position;
    // No project lock here, so never a rebalance (contract section 8).
    const position = appendRank(max) ?? Math.min((max ?? 0) + 1, RANK_MAX);
    const project = await tx.project.create({
      data: {
        organizationId: actor.orgId,
        name,
        descriptionMarkdown,
        color,
        icon,
        isPrivate,
        keyPrefix,
        status: DEFAULT_PROJECT_STATUS,
        dueDate: dueDate ? fromCalendarDate(dueDate) : null,
        position,
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    await tx.projectMember.create({
      data: {
        organizationId: actor.orgId,
        projectId: project.id,
        userId: actor.userId,
        role: "MANAGER",
      },
    });
    await tx.projectTaskCounter.create({
      data: { organizationId: actor.orgId, projectId: project.id },
    });
    await reservePrefix(tx, actor.orgId, project.id, keyPrefix);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: project.id,
      actorUserId: actor.userId,
      verb: "PROJECT_CREATED",
      entityType: "PROJECT",
      entityId: project.id,
      before: null,
      after: {
        name,
        keyPrefix,
        isPrivate,
        status: DEFAULT_PROJECT_STATUS,
        color,
        managerUserId: actor.userId,
      },
      batchId: newBatchId(),
    });
    return { projectId: project.id, keyPrefix };
  });
}

export interface ProjectView {
  id: string;
  name: string;
  descriptionMarkdown: string | null;
  descriptionHtml: string;
  color: string;
  icon: string | null;
  status: ProjectStatus;
  dueDate: CalendarDate | null;
  isPrivate: boolean;
  keyPrefix: string;
  position: number;
  archivedAt: Date | null;
  version: number;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One project for a reader (READ): its fields, descriptionHtml, the reader's role and canManage. */
export async function getProject(
  actor: ProjectActor,
  projectId: string,
): Promise<
  ProjectResult<{ project: ProjectView; myRole: ProjectMemberRole | null; canManage: boolean }>
> {
  return runProjectRead(actor, "getProject", async (db) => {
    const access = await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    const p = access.project;
    return {
      project: {
        id: p.id,
        name: p.name,
        descriptionMarkdown: p.descriptionMarkdown,
        descriptionHtml: p.descriptionMarkdown ? renderTaskMarkdown(p.descriptionMarkdown) : "",
        color: p.color,
        icon: p.icon,
        status: p.status,
        dueDate: p.dueDate ? toCalendarDate(p.dueDate) : null,
        isPrivate: p.isPrivate,
        keyPrefix: p.keyPrefix,
        position: p.position,
        archivedAt: p.archivedAt,
        version: p.version,
        createdByUserId: p.createdByUserId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
      myRole: access.projectRole,
      canManage: access.canManage,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Edits under MANAGE with a version (contract sections 1 and 14)

type ActivityRecord = Record<string, ActivityScalar>;

interface ProjectEdit {
  verb: ActivityVerb;
  data: Prisma.ProjectUpdateManyMutationInput;
  before: ActivityRecord;
  after: ActivityRecord;
  /** Writes that must precede the project update (the prefix reservation). */
  beforeWrite?: (tx: ProjectDb) => Promise<void>;
}

/**
 * A conditional update's miss, classified by an explicit re-read through the read predicate:
 * gone or unreadable NOT_FOUND, archived ARCHIVED, else CONFLICT (the missRefusal pattern).
 */
async function classifyMiss(tx: ProjectDb, actor: ProjectActor, projectId: string): Promise<never> {
  const row = await tx.project.findFirst({
    where: { AND: [readableProjectWhere(actor), { id: projectId }] },
    select: { archivedAt: true },
  });
  if (!row) refuse("NOT_FOUND");
  if (row.archivedAt) refuse("ARCHIVED");
  return refuse("CONFLICT");
}

/**
 * The shared skeleton of the MANAGE edits: MANAGE under PROJECT_UPDATE, afterLock, the version
 * check (stale: CONFLICT, also when the values equal the stored ones), no-op detection before any
 * write, a conditional update on (id, organizationId, version) that
 * increments version, and one activity row with the changed keys only.
 */
async function editProject(
  actor: ProjectActor,
  operation: string,
  projectId: string,
  expectedVersionRaw: unknown,
  plan: (project: AccessProject) => ProjectEdit | null,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return runProjectTransaction(actor, operation, async (tx) => {
    const expectedVersion = validVersion(expectedVersionRaw);
    const access = await requireProject(tx, actor, projectId, { lock: "update", level: "MANAGE" });
    await afterLock(tx, operation);
    // The row is locked FOR UPDATE: a stale version is CONFLICT before the no-op test (a-IN-02).
    if (access.project.version !== expectedVersion) refuse("CONFLICT");
    const edit = plan(access.project);
    if (!edit) return { changed: false };
    const diff = changedValues(edit.before, edit.after);
    if (!diff) return { changed: false };
    await edit.beforeWrite?.(tx);
    const updated = await tx.project.updateMany({
      where: { id: projectId, organizationId: actor.orgId, version: expectedVersion },
      data: { ...edit.data, version: { increment: 1 } },
    });
    if (updated.count !== 1) await classifyMiss(tx, actor, projectId);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: edit.verb,
      entityType: "PROJECT",
      entityId: projectId,
      before: diff.before,
      after: diff.after,
      batchId: newBatchId(),
    });
    return { changed: true, version: expectedVersion + 1 };
  });
}

export interface UpdateProjectPatch {
  name?: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  dueDate?: CalendarDate | null;
}

/**
 * Edits name, description, color, icon and dueDate (MANAGE). A description change is recorded
 * as descriptionChanged, never the text. The same values again are { changed: false }.
 */
export async function updateProject(
  actor: ProjectActor,
  projectId: string,
  expectedVersion: number,
  patch: UpdateProjectPatch,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return editProject(actor, "updateProject", projectId, expectedVersion, (p) => {
    const data: Prisma.ProjectUpdateManyMutationInput = {};
    const before: ActivityRecord = {};
    const after: ActivityRecord = {};
    if (patch?.name !== undefined) {
      const name = validName(patch.name);
      if (name !== p.name) {
        data.name = name;
        before.name = p.name;
        after.name = name;
      }
    }
    if (patch?.description !== undefined) {
      const description = validDescription(patch.description);
      if (description !== p.descriptionMarkdown) {
        data.descriptionMarkdown = description;
        before.descriptionChanged = false;
        after.descriptionChanged = true;
      }
    }
    if (patch?.color !== undefined) {
      const color = validColor(patch.color);
      if (color !== p.color) {
        data.color = color;
        before.color = p.color;
        after.color = color;
      }
    }
    if (patch?.icon !== undefined) {
      const icon = validIcon(patch.icon);
      if (icon !== p.icon) {
        data.icon = icon;
        before.icon = p.icon;
        after.icon = icon;
      }
    }
    if (patch?.dueDate !== undefined) {
      const dueDate = validDueDate(patch.dueDate);
      const stored = p.dueDate ? toCalendarDate(p.dueDate) : null;
      if (dueDate !== stored) {
        data.dueDate = dueDate ? fromCalendarDate(dueDate) : null;
        before.dueDate = stored;
        after.dueDate = dueDate;
      }
    }
    return { verb: "PROJECT_UPDATED", data, before, after };
  });
}

/** Sets the project status (MANAGE; AIDA-100, D-11): independent of progress. */
export async function setProjectStatus(
  actor: ProjectActor,
  projectId: string,
  expectedVersion: number,
  status: ProjectStatus,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return editProject(actor, "setProjectStatus", projectId, expectedVersion, (p) => {
    const next = validStatus(status);
    return {
      verb: "PROJECT_STATUS_CHANGED",
      data: { status: next },
      before: { status: p.status },
      after: { status: next },
    };
  });
}

/**
 * Makes a project private or non-private (MANAGE). Copies nothing (K69). Making it private needs at
 * least one MANAGER row of an active organization member (review a-WR-04): owners and admins do
 * not bypass privacy, so without one nobody could reach the project afterwards; LAST_MANAGER.
 */
export async function setProjectPrivacy(
  actor: ProjectActor,
  projectId: string,
  expectedVersion: number,
  isPrivate: boolean,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return editProject(actor, "setProjectPrivacy", projectId, expectedVersion, (p) => {
    const next = validBoolean(isPrivate, "isPrivate");
    return {
      verb: "PROJECT_PRIVACY_CHANGED",
      data: { isPrivate: next },
      before: { isPrivate: p.isPrivate },
      after: { isPrivate: next },
      beforeWrite: next ? (tx) => assertActiveManager(tx, actor.orgId, projectId) : undefined,
    };
  });
}

/**
 * Changes the key prefix (MANAGE; D-08): the new prefix is reserved like createProject does and
 * the old reservation stays, so no other project can take it and this one may return to it.
 */
export async function changeProjectKeyPrefix(
  actor: ProjectActor,
  projectId: string,
  expectedVersion: number,
  prefix: string,
): Promise<ProjectResult<{ changed: boolean; version?: number }>> {
  return editProject(actor, "changeProjectKeyPrefix", projectId, expectedVersion, (p) => {
    const next = validPrefix(prefix);
    return {
      verb: "PROJECT_UPDATED",
      data: { keyPrefix: next },
      before: { keyPrefix: p.keyPrefix },
      after: { keyPrefix: next },
      beforeWrite: (tx) => reservePrefix(tx, actor.orgId, projectId, next),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Order (contract section 8, AIDA-64)

/**
 * Places a project right after another one (null: first) in the organization-wide order (MANAGE,
 * ORG_PROJECTS_UPDATE). When no integer lies between the neighbours, every project of the
 * organization is renumbered in its current order with the moved one at its new place. Position
 * is not a content field, so version stays. One PROJECT_REORDERED row.
 */
export async function moveProjectPosition(
  actor: ProjectActor,
  projectId: string,
  opts: { placeAfterProjectId: string | null },
): Promise<ProjectResult<{ changed: boolean }>> {
  return runProjectTransaction(actor, "moveProjectPosition", async (tx) => {
    const placeAfter = opts?.placeAfterProjectId ?? null;
    if (placeAfter !== null && typeof placeAfter !== "string") {
      refuse("INVALID_INPUT", "placeAfterProjectId");
    }
    const access = await requireProject(tx, actor, projectId, {
      lock: "org-update",
      level: "MANAGE",
    });
    if (placeAfter === projectId) refuse("INVALID_INPUT", "placeAfterProjectId");
    if (
      placeAfter !== null &&
      !(await readableProjectIds(tx, actor, [placeAfter])).has(placeAfter)
    ) {
      refuse("NOT_FOUND");
    }
    await afterLock(tx, "moveProjectPosition");
    const ordered = await tx.project.findMany({
      where: { organizationId: actor.orgId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, position: true },
    });
    const currentIndex = ordered.findIndex((row) => row.id === projectId);
    const currentPrev = currentIndex > 0 ? (ordered[currentIndex - 1]?.id ?? null) : null;
    if (currentPrev === placeAfter) return { changed: false };
    const others = ordered.filter((row) => row.id !== projectId);
    const index = placeAfter === null ? 0 : others.findIndex((row) => row.id === placeAfter) + 1;
    const prev = index > 0 ? (others[index - 1] ?? null) : null;
    const next = others[index] ?? null;
    const oldPosition = access.project.position;
    let newPosition = rankBetween(prev?.position ?? null, next?.position ?? null);
    if (newPosition === null) {
      const target = [...others.slice(0, index), { id: projectId }, ...others.slice(index)];
      const ranks = rebalancedRanks(target.length);
      const ids = target.map((row) => row.id);
      newPosition = ranks[index] as number;
      await tx.$executeRaw`
        UPDATE "Project" AS p
        SET "position" = v.pos, "updatedAt" = now()
        FROM unnest(${ids}::text[], ${ranks}::int[]) AS v(id, pos)
        WHERE p."id" = v.id AND p."organizationId" = ${actor.orgId}`;
    } else {
      await tx.$executeRaw`
        UPDATE "Project" SET "position" = ${newPosition}, "updatedAt" = now()
        WHERE "id" = ${projectId} AND "organizationId" = ${actor.orgId}`;
    }
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      verb: "PROJECT_REORDERED",
      entityType: "PROJECT",
      entityId: projectId,
      before: { position: oldPosition },
      after: { position: newPosition },
      batchId: newBatchId(),
    });
    return { changed: true };
  });
}

// ---------------------------------------------------------------------------------------------
// listProjects (READ, list predicate)

export interface ProjectListItem {
  id: string;
  name: string;
  keyPrefix: string;
  color: string;
  icon: string | null;
  status: ProjectStatus;
  isPrivate: boolean;
  dueDate: CalendarDate | null;
  archivedAt: Date | null;
  position: number;
  version: number;
}

function encodeProjectCursor(row: { position: number; id: string }): string {
  return Buffer.from(JSON.stringify([row.position, row.id]), "utf8").toString("base64url");
}

function decodeProjectCursor(cursor: unknown): { position: number; id: string } {
  try {
    if (typeof cursor !== "string") throw new Error("cursor");
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [position, id] = parsed as unknown[];
      if (
        typeof position === "number" &&
        Number.isSafeInteger(position) &&
        typeof id === "string"
      ) {
        return { position, id };
      }
    }
  } catch {
    // falls through to the refusal
  }
  return refuse("INVALID_INPUT", "cursor");
}

/**
 * The projects the actor can read now (non-private or a direct ProjectMember row), ordered by
 * (position, id), archived ones only with archived "only" or "include", keyset-paged (limit at
 * most LIST_MAX).
 */
export async function listProjects(
  actor: ProjectActor,
  opts: { archived?: "exclude" | "only" | "include"; cursor?: string | null; limit?: number } = {},
): Promise<
  ProjectResult<{ projects: ProjectListItem[]; hasMore: boolean; nextCursor: string | null }>
> {
  return runProjectRead(actor, "listProjects", async (db) => {
    const archived = opts.archived ?? "exclude";
    if (!["exclude", "only", "include"].includes(archived)) refuse("INVALID_INPUT", "archived");
    const rawLimit = opts.limit ?? LIST_DEFAULT;
    if (!Number.isInteger(rawLimit) || rawLimit < 1) refuse("INVALID_INPUT", "limit");
    const limit = Math.min(rawLimit, LIST_MAX);
    const terms: Prisma.ProjectWhereInput[] = [readableProjectWhere(actor)];
    if (archived === "exclude") terms.push({ archivedAt: null });
    if (archived === "only") terms.push({ archivedAt: { not: null } });
    if (opts.cursor !== undefined && opts.cursor !== null) {
      const c = decodeProjectCursor(opts.cursor);
      terms.push({
        OR: [{ position: { gt: c.position } }, { position: c.position, id: { gt: c.id } }],
      });
    }
    const found = await db.project.findMany({
      where: { AND: terms },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        color: true,
        icon: true,
        status: true,
        isPrivate: true,
        dueDate: true,
        archivedAt: true,
        position: true,
        version: true,
      },
    });
    const hasMore = found.length > limit;
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    return {
      projects: page.map((row) => ({
        ...row,
        dueDate: row.dueDate ? toCalendarDate(row.dueDate) : null,
      })),
      hasMore,
      nextCursor: hasMore && last ? encodeProjectCursor(last) : null,
    };
  });
}
