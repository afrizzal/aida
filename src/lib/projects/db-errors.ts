// Database errors as refusals (contract section 14, the second fence; review a-IN-07). Pure: no
// database client, relative imports only.
//
// The mapping reads SQLSTATE and the constraint or index name only, never free text: a row's
// detail (which holds user values) and Prisma's message are never searched. The pg driver
// adapter of Prisma 7 reports the server error as `{ originalCode, originalMessage, ... }`, either
// as `cause` of a DriverAdapterError or under `meta.driverAdapterError.cause` of a
// PrismaClientKnownRequestError (P2002, P2010); a bare pg DatabaseError carries `code`,
// `severity` and `constraint`. PostgreSQL's own messages for 23505 and 23514 have a fixed shape
// that names the constraint and holds no row value, so the name is read from that shape.
import type { ProjectRefusalCode, ProjectRefusal as ProjectRefusalResult } from "./contract";

function refusalResult(code: ProjectRefusalCode, field?: string): ProjectRefusalResult {
  return code === "INVALID_INPUT" && field !== undefined
    ? { ok: false, code, field }
    : { ok: false, code };
}

/** Unique indexes (23505) and their refusal. */
const UNIQUE_INDEXES: Readonly<Record<string, ProjectRefusalCode>> = {
  ProjectKeyPrefix_organizationId_prefix_key: "PREFIX_TAKEN",
  Project_organizationId_keyPrefix_key: "PREFIX_TAKEN",
  ProjectLabel_project_lower_name_key: "NAME_TAKEN",
  ProjectMilestone_project_lower_name_key: "NAME_TAKEN",
  Team_organizationId_lower_name_key: "NAME_TAKEN",
};

/** CHECK constraints (23514) and their refusal; length checks carry the service's field. */
const CHECKS: Readonly<Record<string, { code: ProjectRefusalCode; field?: string }>> = {
  Task_dates_check: { code: "INVALID_DATE_RANGE" },
  Project_name_length_check: { code: "INVALID_INPUT", field: "name" },
  Project_description_length_check: { code: "INVALID_INPUT", field: "description" },
  Team_name_length_check: { code: "INVALID_INPUT", field: "name" },
  ProjectLabel_name_length_check: { code: "INVALID_INPUT", field: "name" },
  ProjectMilestone_name_length_check: { code: "INVALID_INPUT", field: "name" },
  ProjectMilestone_description_length_check: { code: "INVALID_INPUT", field: "description" },
  Task_title_length_check: { code: "INVALID_INPUT", field: "title" },
  Task_description_length_check: { code: "INVALID_INPUT", field: "description" },
  TaskComment_body_length_check: { code: "INVALID_INPUT", field: "body" },
};

/** The exact messages of the subtask trigger (RAISE, SQLSTATE P0001), contract section 4. */
const SUBTASK_MESSAGES = new Set([
  "Task subtask depth exceeded",
  "Task with subtasks cannot become a subtask",
]);

const UNIQUE_MESSAGE = /^duplicate key value violates unique constraint "([^"]+)"$/;
const CHECK_MESSAGE = /^new row for relation "[^"]+" violates check constraint "([^"]+)"$/;

interface ServerError {
  sqlState: string;
  message: string;
  constraint: string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** The server error inside a Prisma, driver adapter or pg error, or null. */
function serverError(err: unknown): ServerError | null {
  const queue: unknown[] = [err];
  for (let i = 0; i < queue.length && i < 12; i++) {
    const e = asObject(queue[i]);
    if (!e) continue;
    if (typeof e.originalCode === "string" && typeof e.originalMessage === "string") {
      return { sqlState: e.originalCode, message: e.originalMessage, constraint: null };
    }
    if (
      typeof e.code === "string" &&
      /^[0-9A-Z]{5}$/.test(e.code) &&
      typeof e.severity === "string" &&
      typeof e.message === "string"
    ) {
      return {
        sqlState: e.code,
        message: e.message,
        constraint: typeof e.constraint === "string" ? e.constraint : null,
      };
    }
    queue.push(e.cause, asObject(e.meta)?.driverAdapterError);
  }
  return null;
}

function constraintName(server: ServerError, pattern: RegExp): string | null {
  return server.constraint ?? pattern.exec(server.message)?.[1] ?? null;
}

/** The refusal a database error stands for (contract section 14), or null to rethrow it. */
export function mapDatabaseError(err: unknown): ProjectRefusalResult | null {
  const server = serverError(err);
  if (!server) return null;
  switch (server.sqlState) {
    case "P0001":
      return SUBTASK_MESSAGES.has(server.message) ? refusalResult("SUBTASK_DEPTH") : null;
    case "23505": {
      const name = constraintName(server, UNIQUE_MESSAGE);
      const code = name ? UNIQUE_INDEXES[name] : undefined;
      return code ? refusalResult(code) : null;
    }
    case "23514": {
      const name = constraintName(server, CHECK_MESSAGE);
      const mapped = name ? CHECKS[name] : undefined;
      return mapped ? refusalResult(mapped.code, mapped.field) : null;
    }
    case "40P01":
      // Last resort (review a-WR-01, a-WR-02): the lock order of contract section 3 should make
      // a deadlock unreachable; if PostgreSQL still aborts one side, the caller may retry.
      return refusalResult("CONFLICT");
    default:
      return null;
  }
}
