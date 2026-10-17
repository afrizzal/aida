// Phase 14 project activity (contract section 5; D-05, C8, AIDA-68). Relative imports only.
//
// Single write path: recordProjectActivity(tx, entry) is the only code that inserts a
// ProjectActivity row (append-only in the database: trigger aida_project_activity_no_update_delete).
// It validates the value bounds before the insert (at most 16 camelCase keys, no description,
// body or content key, scalars, strings cut to 200 code points, string arrays of at most 50 items
// of 80 code points, 4096 bytes serialized) and throws a plain Error on a violation (a
// programming error, rethrown by the runner). It writes the organization term explicitly.
//
// Read path: listProjectActivity, listTaskActivity and listTeamActivity apply current access
// first. Task history and the team feed leave out rows naming a project the reader cannot read
// now, and do so inside the one paged statement (organization term, task or team term, access
// term, keyset cursor, limit + 1), so hidden rows change no page, no hasMore and no cursor (review
// R3-3). Every returned row passes through redactActivityRow (review C1 and R2-1): a before or
// after value of a project the reader cannot read becomes REDACTED_SIDE, and the row becomes the
// redacted projection of contract section 5.
import { Prisma } from "../../generated/prisma/client";
import { readableProjectIds, readableProjectSql, requireProject, requireTask } from "./access";
import {
  ACTIVITY_ARRAY_MAX_ITEMS,
  ACTIVITY_ARRAY_TEXT_MAX,
  ACTIVITY_FEED_ROW_KEYS,
  ACTIVITY_FORBIDDEN_KEYS,
  ACTIVITY_KEY_PATTERN,
  ACTIVITY_LIST_DEFAULT,
  ACTIVITY_LIST_MAX,
  ACTIVITY_TEXT_MAX,
  ACTIVITY_VALUE_MAX_BYTES,
  ACTIVITY_VALUE_MAX_KEYS,
  ACTIVITY_VERBS,
  type ActivityEntityType,
  type ActivityScalar,
  type ActivityValue,
  type ActivityVerb,
  codePointLength,
  type ProjectActor,
  type ProjectResult,
  REDACTED_ROW_NULLED_KEYS,
  REDACTED_SIDE,
} from "./contract";
import {
  afterReadCheck,
  isPlausibleId,
  listLimit,
  type ProjectDb,
  refuse,
  runProjectRead,
} from "./service";

export interface ActivityEntry {
  orgId: string;
  projectId?: string | null;
  relatedProjectId?: string | null;
  taskId?: string | null;
  teamId?: string | null;
  actorUserId: string;
  verb: ActivityVerb;
  entityType: ActivityEntityType;
  entityId: string;
  before?: ActivityValue;
  after?: ActivityValue;
  batchId: string;
}

const FORBIDDEN = new Set<string>(ACTIVITY_FORBIDDEN_KEYS);

function cutToCodePoints(value: string, max: number): string {
  return codePointLength(value) > max ? Array.from(value).slice(0, max).join("") : value;
}

/**
 * The byte length of the value as `jsonb::text`, which the size CHECKs measure (review a-IN-03):
 * compact JSON plus the space PostgreSQL prints after every ':' and ',' (one per key, one between
 * keys, one between array items). String escapes are the same in both forms.
 */
function jsonbTextBytes(value: Record<string, ActivityScalar | readonly string[]>): number {
  const entries = Object.values(value);
  let spaces = entries.length + Math.max(0, entries.length - 1);
  for (const item of entries) if (Array.isArray(item)) spaces += Math.max(0, item.length - 1);
  return Buffer.byteLength(JSON.stringify(value), "utf8") + spaces;
}

/** Validates one before or after value and returns it with long strings cut (section 5). */
function boundedValue(value: ActivityValue | undefined, side: string): ActivityValue {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`recordProjectActivity: ${side} must be an object or null`);
  }
  const keys = Object.keys(value);
  if (keys.length > ACTIVITY_VALUE_MAX_KEYS) {
    throw new Error(`recordProjectActivity: ${side} has more than ${ACTIVITY_VALUE_MAX_KEYS} keys`);
  }
  const out: Record<string, ActivityScalar | readonly string[]> = {};
  for (const key of keys) {
    if (!ACTIVITY_KEY_PATTERN.test(key)) {
      throw new Error(`recordProjectActivity: ${side} key "${key}" is not camelCase`);
    }
    if (FORBIDDEN.has(key)) throw new Error(`recordProjectActivity: ${side} key "${key}" refused`);
    const item = value[key];
    if (item === null || typeof item === "boolean") {
      out[key] = item;
    } else if (typeof item === "number") {
      if (!Number.isSafeInteger(item)) {
        throw new Error(`recordProjectActivity: ${side}.${key} is not a safe integer`);
      }
      out[key] = item;
    } else if (typeof item === "string") {
      out[key] = cutToCodePoints(item, ACTIVITY_TEXT_MAX);
    } else if (Array.isArray(item)) {
      if (item.length > ACTIVITY_ARRAY_MAX_ITEMS) {
        throw new Error(`recordProjectActivity: ${side}.${key} has too many items`);
      }
      for (const entry of item) {
        if (typeof entry !== "string" || codePointLength(entry) > ACTIVITY_ARRAY_TEXT_MAX) {
          throw new Error(`recordProjectActivity: ${side}.${key} holds an invalid item`);
        }
      }
      out[key] = [...item];
    } else {
      throw new Error(`recordProjectActivity: ${side}.${key} has an unsupported value`);
    }
  }
  if (jsonbTextBytes(out) > ACTIVITY_VALUE_MAX_BYTES) {
    throw new Error(`recordProjectActivity: ${side} exceeds ${ACTIVITY_VALUE_MAX_BYTES} bytes`);
  }
  return out;
}

/** The only writer of ProjectActivity (contract section 5). Returns the new row's id. */
export async function recordProjectActivity(
  tx: ProjectDb,
  entry: ActivityEntry,
): Promise<{ id: string }> {
  const before = boundedValue(entry.before, "before");
  const after = boundedValue(entry.after, "after");
  return tx.projectActivity.create({
    data: {
      organizationId: entry.orgId,
      projectId: entry.projectId ?? null,
      relatedProjectId: entry.relatedProjectId ?? null,
      taskId: entry.taskId ?? null,
      teamId: entry.teamId ?? null,
      actorUserId: entry.actorUserId,
      verb: entry.verb,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ...(before ? { before: before as Prisma.InputJsonObject } : {}),
      ...(after ? { after: after as Prisma.InputJsonObject } : {}),
      batchId: entry.batchId,
    },
    select: { id: true },
  });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/**
 * Update verbs carry only the changed keys (contract section 5): the keys whose value differs,
 * on both sides. null when nothing changed.
 */
export function changedValues(
  before: Record<string, ActivityScalar | readonly string[]>,
  after: Record<string, ActivityScalar | readonly string[]>,
): { before: ActivityValue; after: ActivityValue } | null {
  const b: Record<string, ActivityScalar | readonly string[]> = {};
  const a: Record<string, ActivityScalar | readonly string[]> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const left = before[key] ?? null;
    const right = after[key] ?? null;
    if (!sameValue(left, right)) {
      b[key] = left;
      a[key] = right;
    }
  }
  return Object.keys(a).length === 0 ? null : { before: b, after: a };
}

/** One feed row: exactly the keys of ACTIVITY_FEED_ROW_KEYS (organizationId never returned). */
export interface ActivityFeedRow {
  id: string;
  projectId: string | null;
  relatedProjectId: string | null;
  taskId: string | null;
  teamId: string | null;
  actorUserId: string;
  verb: ActivityVerb;
  entityType: ActivityEntityType;
  entityId: string | null;
  before: unknown;
  after: unknown;
  batchId: string | null;
  createdAt: Date;
  redacted: boolean;
}

function inOrder(row: ActivityFeedRow): ActivityFeedRow {
  const out = {} as Record<string, unknown>;
  for (const key of ACTIVITY_FEED_ROW_KEYS) out[key] = row[key];
  return out as unknown as ActivityFeedRow;
}

function valueProjectId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).projectId;
  return typeof id === "string" ? id : null;
}

function sideUnreadable(ids: (string | null)[], readable: ReadonlySet<string>): boolean {
  return ids.some((id) => id !== null && !readable.has(id));
}

/**
 * The one redaction of every feed (review C1 and R2-1). The before side belongs to the row's
 * relatedProjectId (and the projectId inside before), the after side to the row's projectId (and
 * the projectId inside after). An unreadable side becomes REDACTED_SIDE as a whole; then only id,
 * verb, entityType, createdAt, actorUserId, redacted and the readable side keep a value, and the
 * unreadable project's id column and every REDACTED_ROW_NULLED_KEYS key are null. Otherwise the
 * row comes back unchanged with redacted false. Returns a new object; the input is not mutated.
 */
export function redactActivityRow(
  row: Omit<ActivityFeedRow, "redacted"> & { redacted?: boolean },
  readable: ReadonlySet<string>,
): ActivityFeedRow {
  const beforeHidden = sideUnreadable([row.relatedProjectId, valueProjectId(row.before)], readable);
  const afterHidden = sideUnreadable([row.projectId, valueProjectId(row.after)], readable);
  if (!beforeHidden && !afterHidden) return inOrder({ ...row, redacted: false });
  const projected: ActivityFeedRow = {
    ...row,
    projectId: afterHidden ? null : row.projectId,
    relatedProjectId: beforeHidden ? null : row.relatedProjectId,
    before: beforeHidden ? { ...REDACTED_SIDE } : row.before,
    after: afterHidden ? { ...REDACTED_SIDE } : row.after,
    redacted: true,
  };
  for (const key of REDACTED_ROW_NULLED_KEYS) projected[key] = null;
  return inOrder(projected);
}

/** The opaque keyset cursor of a feed row (its createdAt and id only). */
export function encodeActivityCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id]), "utf8").toString(
    "base64url",
  );
}

/** The decoded cursor, or null when it does not decode. */
export function decodeActivityCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [iso, id] = parsed as unknown[];
    if (typeof iso !== "string" || !isPlausibleId(id)) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export interface ActivityPageOpts {
  cursor?: string | null;
  limit?: number;
}

export interface ActivityPage {
  rows: ActivityFeedRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

function pageLimit(limit: number | undefined): number {
  return listLimit(limit, ACTIVITY_LIST_MAX, ACTIVITY_LIST_DEFAULT);
}

function cursorSql(cursor: string | null | undefined): Prisma.Sql[] {
  if (cursor === undefined || cursor === null) return [];
  const decoded = typeof cursor === "string" ? decodeActivityCursor(cursor) : null;
  if (!decoded) refuse("INVALID_INPUT", "cursor");
  return [
    Prisma.sql`(a."createdAt" < ${decoded.createdAt}
      OR (a."createdAt" = ${decoded.createdAt} AND a.id < ${decoded.id}))`,
  ];
}

/** SQL: the actor's organization member row exists now (K73). */
function actorMemberSql(actor: ProjectActor): Prisma.Sql {
  return Prisma.sql`EXISTS (SELECT 1 FROM "member" m
    WHERE m."organizationId" = ${actor.orgId} AND m."userId" = ${actor.userId})`;
}

/**
 * SQL: the project with id `projectId` (a parameter or a column of the activity row `a`) exists
 * now and the actor can read it now (R3D-1). Evaluated per row inside the paged statement, so a
 * deleted project or one that became unreadable drops only its own rows.
 */
function projectReadableSql(projectId: Prisma.Sql, actor: ProjectActor): Prisma.Sql {
  return Prisma.sql`EXISTS (SELECT 1 FROM "Project" rp
    WHERE rp.id = ${projectId} AND ${readableProjectSql("rp", actor)})`;
}

const ROW_PROJECT = Prisma.sql`a."projectId"`;

type RawFeedRow = Omit<ActivityFeedRow, "redacted">;

/**
 * One paged statement (review R3-3, K73, R3D-1): the organization term, the actor's membership,
 * the given terms (each feed's access terms among them) and the cursor, (createdAt, id)
 * descending, limit + 1. Which rows, hasMore and the cursor are decided here alone; the
 * redaction afterwards only replaces values inside the returned rows.
 */
async function readPage(
  db: ProjectDb,
  actor: ProjectActor,
  terms: Prisma.Sql[],
  opts: ActivityPageOpts,
): Promise<ActivityPage> {
  const limit = pageLimit(opts.limit);
  const where = Prisma.join(
    [
      Prisma.sql`a."organizationId" = ${actor.orgId}`,
      actorMemberSql(actor),
      ...terms,
      ...cursorSql(opts.cursor),
    ],
    " AND ",
  );
  const found = await db.$queryRaw<RawFeedRow[]>`
    SELECT a.id, a."projectId", a."relatedProjectId", a."taskId", a."teamId", a."actorUserId",
      a.verb::text AS verb, a."entityType"::text AS "entityType", a."entityId", a.before, a.after,
      a."batchId", a."createdAt"
    FROM "ProjectActivity" a
    WHERE ${where}
    ORDER BY a."createdAt" DESC, a.id DESC
    LIMIT ${limit + 1}`;
  const hasMore = found.length > limit;
  const page = found.slice(0, limit);
  const named: (string | null)[] = [];
  for (const row of page) {
    named.push(row.projectId, row.relatedProjectId, valueProjectId(row.before));
    named.push(valueProjectId(row.after));
  }
  const readable = await readableProjectIds(db, actor, named);
  const rows = page.map((row) => redactActivityRow(row, readable));
  const last = page[page.length - 1];
  return { rows, hasMore, nextCursor: hasMore && last ? encodeActivityCursor(last) : null };
}

const VERB_SET = new Set<string>(ACTIVITY_VERBS);

/**
 * A project's feed (READ on the project): rows with projectId = P or relatedProjectId = P, newest
 * first, filtered by verbs and actorUserId when given, each redacted for the reader.
 */
export async function listProjectActivity(
  actor: ProjectActor,
  projectId: string,
  opts: ActivityPageOpts & { verbs?: readonly ActivityVerb[]; actorUserId?: string } = {},
): Promise<ProjectResult<ActivityPage>> {
  return runProjectRead(actor, "listProjectActivity", async (db) => {
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    await afterReadCheck(db, "listProjectActivity");
    // K73, R3D-1: the paged statement holds only while the feed's project exists and is readable.
    const terms: Prisma.Sql[] = [
      Prisma.sql`(a."projectId" = ${projectId} OR a."relatedProjectId" = ${projectId})`,
      projectReadableSql(Prisma.sql`${projectId}`, actor),
    ];
    if (opts.verbs !== undefined) {
      if (!Array.isArray(opts.verbs) || opts.verbs.some((v) => !VERB_SET.has(v))) {
        refuse("INVALID_INPUT", "verbs");
      }
      terms.push(
        opts.verbs.length === 0
          ? Prisma.sql`FALSE`
          : Prisma.sql`a.verb::text IN (${Prisma.join([...opts.verbs])})`,
      );
    }
    if (opts.actorUserId !== undefined) {
      if (!isPlausibleId(opts.actorUserId)) refuse("INVALID_INPUT", "actorUserId");
      terms.push(Prisma.sql`a."actorUserId" = ${opts.actorUserId}`);
    }
    return readPage(db, actor, terms, opts);
  });
}

/**
 * A task's history (READ on the task's current project): rows with taskId = the task whose
 * projectId names a project that exists and the reader can read now; the access terms sit inside
 * the paged statement, per row.
 */
export async function listTaskActivity(
  actor: ProjectActor,
  taskId: string,
  opts: ActivityPageOpts = {},
): Promise<ProjectResult<ActivityPage>> {
  return runProjectRead(actor, "listTaskActivity", async (db) => {
    await requireTask(db, actor, taskId, { lock: "none", level: "READ" });
    await afterReadCheck(db, "listTaskActivity");
    // K73, R3D-1: the task's current project is readable now, and each row's own project exists
    // and is readable now (a deleted or unreadable project drops only its own rows).
    return readPage(
      db,
      actor,
      [
        Prisma.sql`a."taskId" = ${taskId}`,
        Prisma.sql`EXISTS (SELECT 1 FROM "Task" t JOIN "Project" tp ON tp.id = t."projectId"
          WHERE t.id = ${taskId} AND t."organizationId" = ${actor.orgId}
            AND ${readableProjectSql("tp", actor)})`,
        projectReadableSql(ROW_PROJECT, actor),
      ],
      opts,
    );
  });
}

/**
 * A team's feed (MEMBER and the team in the organization, review C2 and C5): rows with teamId =
 * the team whose projectId is null or names a project that exists and the reader can read now;
 * the access terms sit inside the paged statement, per row.
 */
export async function listTeamActivity(
  actor: ProjectActor,
  teamId: string,
  opts: ActivityPageOpts = {},
): Promise<ProjectResult<ActivityPage>> {
  return runProjectRead(actor, "listTeamActivity", async (db) => {
    if (!isPlausibleId(teamId)) refuse("NOT_FOUND");
    const team = await db.team.findFirst({
      where: { id: teamId, organizationId: actor.orgId },
      select: { id: true },
    });
    if (!team) refuse("NOT_FOUND");
    await afterReadCheck(db, "listTeamActivity");
    // K73, R3D-1: the actor's current membership (readPage), and each row with a project needs
    // that project to exist and be readable now (a deleted or unreadable project drops only its
    // own rows).
    return readPage(
      db,
      actor,
      [
        Prisma.sql`a."teamId" = ${teamId}`,
        Prisma.sql`(a."projectId" IS NULL OR ${projectReadableSql(ROW_PROJECT, actor)})`,
      ],
      opts,
    );
  });
}
