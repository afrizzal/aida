// Phase 14 project operations (contract sections 1, 6, 8, 14 and 15; AIDA-64, AIDA-68, AIDA-100,
// AIDA-104). Relative imports only, no Next.js import. Every operation takes the actor from the
// server context and checks it itself: membership first, then the policy of access.ts. Every
// successful mutation writes exactly one activity row through recordProjectActivity in its own
// transaction; a no-op or a refusal writes none. Every query writes the organization term (C1).
import { renderTaskMarkdown } from "../markdown/render";
import { requireMembership, requireProject } from "./access";
import { recordProjectActivity } from "./activity";
import {
  type CalendarDate,
  codePointLength,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_STATUS,
  fromCalendarDate,
  hasNul,
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
import { appendRank } from "./rank";
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
  if (raw.trim().length === 0) return null;
  if (codePointLength(raw.trim()) > PROJECT_DESCRIPTION_MAX) refuse("INVALID_INPUT", "description");
  return raw;
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
