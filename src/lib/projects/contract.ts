// Projects (Phase 14, AIDA-64 to AIDA-71 and AIDA-100 to AIDA-105): the frozen contract every
// later plan of the phase implements (D-17, freeze first). The full text, with every rule and its
// reason, is .planning/phases/14-projects-foundation/14-CONTRACT.md; this module holds the parts
// that are data or pure code. Pure and client-safe: no runtime Prisma import, no Node-only module,
// relative imports only, so the services, the worker job and the later UI can import it. A change
// needs one commit that edits 14-CONTRACT.md and this module together.
//
// Access (section 2): a malformed id is NOT_FOUND; the actor's organization membership is read
// conservatively (every member row, admin only when every row is owner or admin) before any
// project lookup (no row: MEMBERSHIP_ENDED); the operation's lock is taken on the project with an
// explicit organization term; membership is read again after the lock; read access is a
// non-private project or a direct ProjectMember row. Run decision K69: a team grants nothing on a
// private project by itself; assigning a team to a private project copies the team's current
// active members into direct ProjectMember rows, and later team changes change no project's
// access. No read access is NOT_FOUND, identical to a missing id. Archive state is checked on the
// locked rows; MANAGE is a MANAGER row, or an organization owner or admin on a non-private project.
//
// Lock order (section 3), never going back to an earlier class: team rows (id order), project
// rows (id order), task rows (a parent before its own subtasks, otherwise id order; review C3: a
// write to a subtask locks the parent FOR SHARE before the subtask, a tree lock takes the root
// first and its subtasks in a second statement), the ProjectTaskCounter row, TaskKey and
// ProjectKeyPrefix rows, ProjectFileCleanup inserts, ProjectActivity inserts last. Content writes
// hold the project FOR SHARE and never update the project row.
//
// Activity redaction (section 5, review C1 and R2-1): in a two-project row (TASK_MOVED,
// PROJECT_DUPLICATED, TASK_DUPLICATED of a project duplicate) before is the related project's
// side and after the row project's side. A side whose project the reader cannot read now becomes
// REDACTED_SIDE as a whole, and the row keeps a value only in id, verb, entityType, createdAt,
// actorUserId, redacted and the readable side; the unreadable project's id column and every key
// of REDACTED_ROW_NULLED_KEYS are null. Redaction covers the two-project row only (review R3-1).
// Feed pages (review R3-3): task history and the team feed apply their access filter inside the
// paged query, before the limit and the keyset cursor, so unreadable rows change no page, no
// hasMore and no cursor.
//
// Favorites (section 10, review R2-2 and P4): the four toggles run at READ and are an explicit
// archive exception; they hold the project FOR SHARE (the task toggles also lock the task FOR
// SHARE, a subtask's parent first), so they serialize with deleteTask and deleteProject in either
// order and return NOT_FOUND after a committed delete.
//
// duplicateProject (section 11, review R3-2) locks its source FOR UPDATE at READ access, so every
// content write of the source commits before the copy or waits for it, and the copy reflects one
// committed state of the source.
//
// Delete order (section 12, review R2-3): every lock first (deleteProject also its tasks and its
// counter row), then collect storage keys, tombstone TaskKey rows, insert ProjectFileCleanup rows,
// delete rows in foreign-key order (leaves first), and write activity last.
//
// Recurrence exactly once (section 7): the successor is created only in the transaction that
// moves the task into DONE from another status, under the task's row lock, and only when the
// predecessor's recurrenceSpawned is false (set true by a conditional update in the same
// transaction); a partial unique index on recurrencePredecessorId is the database fence.

// ---------------------------------------------------------------------------------------------
// Sets (sections 5, 14, 15)

export const TASK_STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "AT_RISK", "ON_HOLD", "COMPLETED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_PRIORITIES = ["NONE", "LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PROJECT_MEMBER_ROLES = ["MANAGER", "MEMBER"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const RECURRENCE_RULES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type RecurrenceRule = (typeof RECURRENCE_RULES)[number];

export const TASK_KEY_KINDS = ["ACTIVE", "ALIAS", "TOMBSTONE"] as const;
export type TaskKeyKind = (typeof TASK_KEY_KINDS)[number];

export const ACTIVITY_VERBS = [
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "PROJECT_STATUS_CHANGED",
  "PROJECT_PRIVACY_CHANGED",
  "PROJECT_REORDERED",
  "PROJECT_ARCHIVED",
  "PROJECT_RESTORED",
  "PROJECT_DUPLICATED",
  "PROJECT_DELETED",
  "MEMBER_ADDED",
  "MEMBER_REMOVED",
  "MEMBER_ROLE_CHANGED",
  "TEAM_ASSIGNED",
  "TEAM_UNASSIGNED",
  "TEAM_CREATED",
  "TEAM_UPDATED",
  "TEAM_DELETED",
  "TEAM_MEMBER_ADDED",
  "TEAM_MEMBER_REMOVED",
  "TASK_CREATED",
  "TASK_UPDATED",
  "TASK_STATUS_CHANGED",
  "TASK_PARENT_CHANGED",
  "TASK_REORDERED",
  "TASK_ARCHIVED",
  "TASK_RESTORED",
  "TASK_MOVED",
  "TASK_DUPLICATED",
  "TASK_DELETED",
  "TASK_RECURRED",
  "COMMENT_ADDED",
  "COMMENT_EDITED",
  "COMMENT_DELETED",
  "ATTACHMENT_ADDED",
  "ATTACHMENT_DELETED",
  "LABEL_CREATED",
  "LABEL_UPDATED",
  "LABEL_DELETED",
  "MILESTONE_CREATED",
  "MILESTONE_UPDATED",
  "MILESTONE_DELETED",
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

export const ACTIVITY_ENTITY_TYPES = [
  "PROJECT",
  "TASK",
  "COMMENT",
  "ATTACHMENT",
  "LABEL",
  "MILESTONE",
  "PROJECT_MEMBER",
  "PROJECT_TEAM",
  "TEAM",
  "TEAM_MEMBER",
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export const PROJECT_REFUSAL_CODES = [
  "NOT_FOUND",
  "MEMBERSHIP_ENDED",
  "NOT_ALLOWED",
  "ARCHIVED",
  "CONFLICT",
  "INVALID_INPUT",
  "INVALID_DATE_RANGE",
  "PREFIX_INVALID",
  "PREFIX_TAKEN",
  "KEY_SPACE_EXHAUSTED",
  "NAME_TAKEN",
  "NOT_ELIGIBLE",
  "LAST_MANAGER",
  "SUBTASK_DEPTH",
  "SUBTASK_MOVE",
  "RECURRENCE_ON_SUBTASK",
  "TOO_MANY",
  "CONFIRMATION_REQUIRED",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
] as const;
export type ProjectRefusalCode = (typeof PROJECT_REFUSAL_CODES)[number];

// Palette keys only, never hex or oklch; Phase 15 maps them to design tokens.
export const PROJECT_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

// Kebab-case lucide-react icon names (ISC, already a dependency); stored as text, null default.
export const PROJECT_ICONS = [
  "folder",
  "briefcase",
  "rocket",
  "target",
  "flag",
  "calendar",
  "book-open",
  "code",
  "wrench",
  "bug",
  "lightbulb",
  "megaphone",
  "users",
  "heart",
  "star",
  "shield",
  "globe",
  "package",
  "layers",
  "compass",
  "palette",
  "zap",
  "bell",
  "map",
] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];

export const ACCESS_LEVELS = [
  "MEMBER",
  "READ",
  "CONTENT",
  "CONTENT_ARCHIVED_TASK",
  "MANAGE",
  "MANAGE_ARCHIVED",
  "ORG_ADMIN",
  "AUTHOR",
  "AUTHOR_OR_MANAGE",
  "UPLOADER_OR_MANAGE",
  "CREATOR_OR_MANAGE",
  "SELF_OR_MANAGE",
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const LOCK_MODES = [
  "NONE",
  "PROJECT_SHARE",
  "PROJECT_UPDATE",
  "PROJECTS_UPDATE",
  "ORG_PROJECTS_UPDATE",
  "TEAM_UPDATE",
  "TEAM_UPDATE_THEN_PROJECTS",
  "TEAM_SHARE_THEN_PROJECT",
] as const;
export type LockMode = (typeof LOCK_MODES)[number];

// Section 17 defines the expectation of each class (review C5).
export const ISOLATION_EXPECTATIONS = ["TARGET", "CREATE", "LIST", "KEY", "TEAM"] as const;
export type IsolationExpectation = (typeof ISOLATION_EXPECTATIONS)[number];

// Service modules of src/lib/projects/ named by the operation table (section 1).
export const PROJECT_MODULES = [
  "projects",
  "activity",
  "keys",
  "tasks",
  "labels",
  "milestones",
  "comments",
  "attachments",
  "members",
  "teams",
  "recurrence",
  "archive",
  "favorites",
  "delete",
  "duplicate",
  "move",
  "ordering",
  "bulk",
  "progress",
] as const;
export type ProjectModule = (typeof PROJECT_MODULES)[number];

// ---------------------------------------------------------------------------------------------
// Defaults (section 15, section 7)

export const DEFAULT_TASK_STATUS: TaskStatus = "TODO";
export const DEFAULT_PROJECT_STATUS: ProjectStatus = "PLANNING";
export const DEFAULT_TASK_PRIORITY: TaskPriority = "NONE";
export const DEFAULT_PROJECT_COLOR: ProjectColor = "blue";
export const DEFAULT_LABEL_COLOR: ProjectColor = "gray";
export const DEFAULT_TIME_ZONE = "UTC";

// ---------------------------------------------------------------------------------------------
// Bounds (sections 5, 6, 8, 12, 15)

export const TASK_NUMBER_MAX = 999_999_999;
export const TASK_KEY_SEPARATOR = "-";
export const RANK_GAP = 1024;
export const RANK_MAX = 2_147_483_647;
export const BULK_MAX = 100;
export const MAX_UPLOAD_FILES = 10;
export const MAX_TASK_LABELS = 20;
export const LIST_DEFAULT = 50;
export const LIST_MAX = 200;
export const ACTIVITY_LIST_DEFAULT = 50;
export const ACTIVITY_LIST_MAX = 100;
export const ACTIVITY_VALUE_MAX_KEYS = 16;
export const ACTIVITY_VALUE_MAX_BYTES = 4096;
export const ACTIVITY_TEXT_MAX = 200;
export const ACTIVITY_ARRAY_MAX_ITEMS = 50;
export const ACTIVITY_ARRAY_TEXT_MAX = 80;
export const ACTIVITY_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,39}$/;
export const ACTIVITY_FORBIDDEN_KEYS = [
  "description",
  "descriptionMarkdown",
  "body",
  "bodyMarkdown",
  "content",
] as const;
export const ESTIMATE_MAX_MINUTES = 1_000_000;
export const TIME_ZONE_MAX_LENGTH = 64;
export const ID_MAX_LENGTH = 64;

// Lengths in code points after trim (section 15).
export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 5000;
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 20_000;
export const COMMENT_BODY_MAX = 10_000;
export const LABEL_NAME_MAX = 40;
export const MILESTONE_NAME_MAX = 80;
export const MILESTONE_DESCRIPTION_MAX = 2000;
export const TEAM_NAME_MAX = 60;
export const FILE_NAME_MAX = 255;

export const TEXT_LENGTHS = {
  projectName: { min: 1, max: PROJECT_NAME_MAX },
  projectDescription: { min: 0, max: PROJECT_DESCRIPTION_MAX },
  taskTitle: { min: 1, max: TASK_TITLE_MAX },
  taskDescription: { min: 0, max: TASK_DESCRIPTION_MAX },
  commentBody: { min: 1, max: COMMENT_BODY_MAX },
  labelName: { min: 1, max: LABEL_NAME_MAX },
  milestoneName: { min: 1, max: MILESTONE_NAME_MAX },
  milestoneDescription: { min: 0, max: MILESTONE_DESCRIPTION_MAX },
  teamName: { min: 1, max: TEAM_NAME_MAX },
  fileName: { min: 1, max: FILE_NAME_MAX },
} as const;

export const PROJECT_FILE_CLEANUP_QUEUE = "project-file-cleanup";
export const PROJECT_FILE_CLEANUP_CRON = "* * * * *";
export const PROJECT_FILE_CLEANUP_BATCH = 100;
export const PROJECT_FILE_CLEANUP_MAX_BACKOFF_MINUTES = 60;
/** Review b-IN-05: a row that failed this many times is no longer selected; it stays as a report. */
export const PROJECT_FILE_CLEANUP_MAX_ATTEMPTS = 20;
/** Review b-IN-05: file I/O of one run stops after this many ms, under the 30 s transaction timeout. */
export const PROJECT_FILE_CLEANUP_IO_BUDGET_MS = 20_000;

export const TRANSACTION_OPTIONS = Object.freeze({ maxWait: 10_000, timeout: 30_000 });

// ---------------------------------------------------------------------------------------------
// Activity feed shape (section 5, review C1 and R2-1)

export const REDACTED_SIDE: Readonly<{ redacted: true }> = Object.freeze({ redacted: true });

export const ACTIVITY_FEED_ROW_KEYS = [
  "id",
  "projectId",
  "relatedProjectId",
  "taskId",
  "teamId",
  "actorUserId",
  "verb",
  "entityType",
  "entityId",
  "before",
  "after",
  "batchId",
  "createdAt",
  "redacted",
] as const;
export type ActivityFeedRowKey = (typeof ACTIVITY_FEED_ROW_KEYS)[number];

export const REDACTED_ROW_NULLED_KEYS = ["entityId", "taskId", "teamId", "batchId"] as const;

// ---------------------------------------------------------------------------------------------
// Types (sections 0, 5, 7, 14)

export type ProjectActor = { userId: string; orgId: string };

// A real date from 1970-01-01 to 2999-12-31 written YYYY-MM-DD; obtain one through
// parseCalendarDate or toCalendarDate.
export type CalendarDate = string;

export type ProjectRefusal = { ok: false; code: ProjectRefusalCode; field?: string };
export type ProjectResult<T extends object = object> = ({ ok: true } & T) | ProjectRefusal;

export type ActivityScalar = string | number | boolean | null;
export type ActivityValue = { [key: string]: ActivityScalar | readonly string[] } | null;

// ---------------------------------------------------------------------------------------------
// Operation table: the access matrix as data (section 1). Plan 14-13 checks the code against it.

export type ProjectOperationSpec = {
  readonly module: ProjectModule;
  readonly access: AccessLevel;
  readonly lock: LockMode;
  readonly verbs: readonly ActivityVerb[];
  readonly isolation: IsolationExpectation;
};

function op(
  module: ProjectModule,
  access: AccessLevel,
  lock: LockMode,
  verbs: readonly ActivityVerb[],
  isolation: IsolationExpectation,
): ProjectOperationSpec {
  return Object.freeze({ module, access, lock, verbs: Object.freeze([...verbs]), isolation });
}

export const PROJECT_OPERATIONS = Object.freeze({
  createProject: op("projects", "MEMBER", "NONE", ["PROJECT_CREATED"], "CREATE"),
  getProject: op("projects", "READ", "NONE", [], "TARGET"),
  listProjects: op("projects", "READ", "NONE", [], "LIST"),
  updateProject: op("projects", "MANAGE", "PROJECT_UPDATE", ["PROJECT_UPDATED"], "TARGET"),
  setProjectStatus: op(
    "projects",
    "MANAGE",
    "PROJECT_UPDATE",
    ["PROJECT_STATUS_CHANGED"],
    "TARGET",
  ),
  setProjectPrivacy: op(
    "projects",
    "MANAGE",
    "PROJECT_UPDATE",
    ["PROJECT_PRIVACY_CHANGED"],
    "TARGET",
  ),
  changeProjectKeyPrefix: op("projects", "MANAGE", "PROJECT_UPDATE", ["PROJECT_UPDATED"], "TARGET"),
  // K71 (review a-CR-01): the stored organization-wide position is internal. moveProjectPosition
  // decides its no-op from the caller's readable order, and its PROJECT_REORDERED row has before
  // and after null; no read returns the position or a cursor that holds it.
  moveProjectPosition: op(
    "projects",
    "MANAGE",
    "ORG_PROJECTS_UPDATE",
    ["PROJECT_REORDERED"],
    "TARGET",
  ),
  listProjectActivity: op("activity", "READ", "NONE", [], "TARGET"),
  listTaskActivity: op("activity", "READ", "NONE", [], "TARGET"),
  listTeamActivity: op("activity", "MEMBER", "NONE", [], "TEAM"),
  // K72 (Codex diff D3): an ALIAS resolves only while its origin project is readable; otherwise,
  // and when that project was deleted, NOT_FOUND identical to a missing key.
  resolveTaskKey: op("keys", "READ", "NONE", [], "KEY"),
  createTask: op("tasks", "CONTENT", "PROJECT_SHARE", ["TASK_CREATED"], "TARGET"),
  getTask: op("tasks", "READ", "NONE", [], "TARGET"),
  listProjectTasks: op("tasks", "READ", "NONE", [], "TARGET"),
  listWorkspaceTasks: op("tasks", "READ", "NONE", [], "LIST"),
  updateTask: op("tasks", "CONTENT", "PROJECT_SHARE", ["TASK_UPDATED"], "TARGET"),
  setTaskDates: op("tasks", "CONTENT", "PROJECT_SHARE", ["TASK_UPDATED"], "TARGET"),
  setTaskStatus: op(
    "tasks",
    "CONTENT",
    "PROJECT_UPDATE",
    ["TASK_STATUS_CHANGED", "TASK_RECURRED"],
    "TARGET",
  ),
  setTaskParent: op("tasks", "CONTENT", "PROJECT_UPDATE", ["TASK_PARENT_CHANGED"], "TARGET"),
  listLabels: op("labels", "READ", "NONE", [], "TARGET"),
  createLabel: op("labels", "MANAGE", "PROJECT_UPDATE", ["LABEL_CREATED"], "TARGET"),
  updateLabel: op("labels", "MANAGE", "PROJECT_UPDATE", ["LABEL_UPDATED"], "TARGET"),
  deleteLabel: op("labels", "MANAGE", "PROJECT_UPDATE", ["LABEL_DELETED"], "TARGET"),
  setTaskLabels: op("labels", "CONTENT", "PROJECT_SHARE", ["TASK_UPDATED"], "TARGET"),
  listProjectMilestones: op("milestones", "READ", "NONE", [], "TARGET"),
  listWorkspaceMilestones: op("milestones", "READ", "NONE", [], "LIST"),
  createMilestone: op("milestones", "MANAGE", "PROJECT_UPDATE", ["MILESTONE_CREATED"], "TARGET"),
  updateMilestone: op("milestones", "MANAGE", "PROJECT_UPDATE", ["MILESTONE_UPDATED"], "TARGET"),
  deleteMilestone: op("milestones", "MANAGE", "PROJECT_UPDATE", ["MILESTONE_DELETED"], "TARGET"),
  setTaskMilestone: op("milestones", "CONTENT", "PROJECT_SHARE", ["TASK_UPDATED"], "TARGET"),
  listTaskComments: op("comments", "READ", "NONE", [], "TARGET"),
  addTaskComment: op("comments", "CONTENT", "PROJECT_SHARE", ["COMMENT_ADDED"], "TARGET"),
  editTaskComment: op("comments", "AUTHOR", "PROJECT_SHARE", ["COMMENT_EDITED"], "TARGET"),
  deleteTaskComment: op(
    "comments",
    "AUTHOR_OR_MANAGE",
    "PROJECT_SHARE",
    ["COMMENT_DELETED"],
    "TARGET",
  ),
  listTaskAttachments: op("attachments", "READ", "NONE", [], "TARGET"),
  listProjectAttachments: op("attachments", "READ", "NONE", [], "TARGET"),
  getTaskAttachmentForDownload: op("attachments", "READ", "NONE", [], "TARGET"),
  uploadTaskAttachments: op(
    "attachments",
    "CONTENT",
    "PROJECT_SHARE",
    ["ATTACHMENT_ADDED"],
    "TARGET",
  ),
  deleteTaskAttachment: op(
    "attachments",
    "UPLOADER_OR_MANAGE",
    "PROJECT_SHARE",
    ["ATTACHMENT_DELETED"],
    "TARGET",
  ),
  listProjectMembers: op("members", "READ", "NONE", [], "TARGET"),
  listEligibleAssignees: op("members", "READ", "NONE", [], "TARGET"),
  addProjectMember: op("members", "MANAGE", "PROJECT_UPDATE", ["MEMBER_ADDED"], "TARGET"),
  removeProjectMember: op(
    "members",
    "SELF_OR_MANAGE",
    "PROJECT_UPDATE",
    ["MEMBER_REMOVED"],
    "TARGET",
  ),
  setProjectMemberRole: op(
    "members",
    "MANAGE",
    "PROJECT_UPDATE",
    ["MEMBER_ROLE_CHANGED"],
    "TARGET",
  ),
  listTeams: op("teams", "MEMBER", "NONE", [], "TEAM"),
  getTeam: op("teams", "MEMBER", "NONE", [], "TEAM"),
  createTeam: op("teams", "ORG_ADMIN", "NONE", ["TEAM_CREATED"], "TEAM"),
  renameTeam: op("teams", "ORG_ADMIN", "TEAM_UPDATE", ["TEAM_UPDATED"], "TEAM"),
  deleteTeam: op(
    "teams",
    "ORG_ADMIN",
    "TEAM_UPDATE_THEN_PROJECTS",
    ["TEAM_DELETED", "TEAM_UNASSIGNED"],
    "TEAM",
  ),
  addTeamMember: op("teams", "ORG_ADMIN", "TEAM_UPDATE", ["TEAM_MEMBER_ADDED"], "TEAM"),
  removeTeamMember: op("teams", "ORG_ADMIN", "TEAM_UPDATE", ["TEAM_MEMBER_REMOVED"], "TEAM"),
  listProjectTeams: op("teams", "READ", "NONE", [], "TARGET"),
  assignTeamToProject: op(
    "teams",
    "MANAGE",
    "TEAM_SHARE_THEN_PROJECT",
    ["TEAM_ASSIGNED", "MEMBER_ADDED"],
    "TARGET",
  ),
  unassignTeamFromProject: op(
    "teams",
    "MANAGE",
    "TEAM_SHARE_THEN_PROJECT",
    ["TEAM_UNASSIGNED"],
    "TARGET",
  ),
  setTaskRecurrence: op("recurrence", "CONTENT", "PROJECT_SHARE", ["TASK_UPDATED"], "TARGET"),
  clearTaskRecurrence: op("recurrence", "CONTENT", "PROJECT_SHARE", ["TASK_UPDATED"], "TARGET"),
  archiveProject: op("archive", "MANAGE", "PROJECT_UPDATE", ["PROJECT_ARCHIVED"], "TARGET"),
  restoreProject: op(
    "archive",
    "MANAGE_ARCHIVED",
    "PROJECT_UPDATE",
    ["PROJECT_RESTORED"],
    "TARGET",
  ),
  archiveTask: op("archive", "CONTENT", "PROJECT_SHARE", ["TASK_ARCHIVED"], "TARGET"),
  restoreTask: op("archive", "CONTENT_ARCHIVED_TASK", "PROJECT_SHARE", ["TASK_RESTORED"], "TARGET"),
  favoriteProject: op("favorites", "READ", "PROJECT_SHARE", [], "TARGET"),
  unfavoriteProject: op("favorites", "READ", "PROJECT_SHARE", [], "TARGET"),
  favoriteTask: op("favorites", "READ", "PROJECT_SHARE", [], "TARGET"),
  unfavoriteTask: op("favorites", "READ", "PROJECT_SHARE", [], "TARGET"),
  listFavorites: op("favorites", "READ", "NONE", [], "LIST"),
  deleteTask: op("delete", "CREATOR_OR_MANAGE", "PROJECT_SHARE", ["TASK_DELETED"], "TARGET"),
  deleteProject: op("delete", "MANAGE_ARCHIVED", "PROJECT_UPDATE", ["PROJECT_DELETED"], "TARGET"),
  duplicateTask: op("duplicate", "CONTENT", "PROJECT_UPDATE", ["TASK_DUPLICATED"], "TARGET"),
  duplicateProject: op(
    "duplicate",
    "READ",
    "PROJECT_UPDATE",
    ["PROJECT_DUPLICATED", "TASK_DUPLICATED"],
    "TARGET",
  ),
  moveTask: op("move", "CONTENT", "PROJECTS_UPDATE", ["TASK_MOVED"], "TARGET"),
  reorderTask: op(
    "ordering",
    "CONTENT",
    "PROJECT_UPDATE",
    ["TASK_REORDERED", "TASK_STATUS_CHANGED", "TASK_RECURRED"],
    "TARGET",
  ),
  bulkUpdateTasks: op(
    "bulk",
    "CONTENT",
    "PROJECTS_UPDATE",
    ["TASK_UPDATED", "TASK_STATUS_CHANGED", "TASK_RECURRED"],
    "TARGET",
  ),
  getProjectProgress: op("progress", "READ", "NONE", [], "TARGET"),
  getProjectsProgress: op("progress", "READ", "NONE", [], "LIST"),
  getTaskProgress: op("progress", "READ", "NONE", [], "TARGET"),
});

export type ProjectOperationName = keyof typeof PROJECT_OPERATIONS;

// ---------------------------------------------------------------------------------------------
// Pure helpers

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const TASK_KEY_PATTERN = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]{0,8})$/;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const CALENDAR_DATE_MIN = "1970-01-01";
export const CALENDAR_DATE_MAX = "2999-12-31";

/** Section 2 step 1: a well-formed id is 1 to 64 characters of A-Z, a-z, 0-9, underscore, hyphen. */
export function isWellFormedId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Trim and uppercase; the result when it matches ^[A-Z][A-Z0-9]{1,9}$, else null. */
export function normalizePrefix(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  return PREFIX_PATTERN.test(value) ? value : null;
}

export function isValidPrefix(raw: string): boolean {
  return normalizePrefix(raw) !== null;
}

export function formatTaskKey(prefix: string, taskNumber: number): string {
  return `${prefix}${TASK_KEY_SEPARATOR}${taskNumber}`;
}

/** Parse after trim and uppercase; numbers 1 to TASK_NUMBER_MAX without leading zero. */
export function parseTaskKey(raw: string): { prefix: string; number: number } | null {
  if (typeof raw !== "string") return null;
  const match = TASK_KEY_PATTERN.exec(raw.trim().toUpperCase());
  if (!match) return null;
  const taskNumber = Number(match[2]);
  if (!Number.isSafeInteger(taskNumber) || taskNumber < 1 || taskNumber > TASK_NUMBER_MAX) {
    return null;
  }
  return { prefix: match[1], number: taskNumber };
}

export function normalizeTaskKey(raw: string): string | null {
  const parsed = parseTaskKey(raw);
  return parsed ? formatTaskKey(parsed.prefix, parsed.number) : null;
}

/** A real YYYY-MM-DD date from 1970-01-01 to 2999-12-31, else null. */
export function parseCalendarDate(raw: unknown): CalendarDate | null {
  if (typeof raw !== "string") return null;
  const match = CALENDAR_DATE_PATTERN.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || year > 2999 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return raw;
}

export function isCalendarDate(raw: unknown): raw is CalendarDate {
  return parseCalendarDate(raw) !== null;
}

/** The Date at UTC midnight of a calendar date (how Prisma reads a @db.Date column). */
export function fromCalendarDate(value: CalendarDate): Date {
  const parsed = parseCalendarDate(value);
  if (parsed === null) throw new RangeError("Invalid calendar date");
  return new Date(`${parsed}T00:00:00.000Z`);
}

/** The UTC calendar date of a Date (a @db.Date value read by Prisma). */
export function toCalendarDate(date: Date): CalendarDate {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** An IANA time zone name Intl accepts, at most TIME_ZONE_MAX_LENGTH characters. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > TIME_ZONE_MAX_LENGTH) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date of `now` in the given time zone, from formatToParts (no locale parsing). */
export function todayInTimeZone(timeZone: string, now: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    calendar: "gregory",
    numberingSystem: "latn",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day"): string => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new RangeError(`Missing ${type} in formatted date`);
    return found.value;
  };
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/** Length in Unicode code points, not UTF-16 units. */
export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

export function hasNul(value: string): boolean {
  return value.includes("\u0000");
}
