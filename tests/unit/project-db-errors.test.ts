// mapDatabaseError (contract section 14, review a-IN-07): database errors map by SQLSTATE and by the
// constraint or index name PostgreSQL reports, never by searching free text, so user text in a
// row's detail can never change the mapping. The fakes below copy the shapes the pg driver
// adapter of Prisma 7.8 produces (recorded from real errors against PostgreSQL 16): a
// PrismaClientKnownRequestError with meta.driverAdapterError.cause, or a bare DriverAdapterError
// with cause.
import { describe, expect, it } from "vitest";
import { mapDatabaseError } from "../../src/lib/projects/db-errors";

function adapterCause(code: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    originalCode: code,
    originalMessage: message,
    kind: "postgres",
    code,
    message,
    ...extra,
  };
}

/** A Prisma known request error (P2002 or P2010) wrapping the adapter error. */
function wrapped(prismaCode: string, cause: Record<string, unknown>) {
  const adapterError = Object.assign(new Error(String(cause.originalMessage)), {
    name: "DriverAdapterError",
    cause,
  });
  return Object.assign(new Error(`Invalid invocation: ${String(cause.originalMessage)}`), {
    name: "PrismaClientKnownRequestError",
    code: prismaCode,
    meta: { driverAdapterError: adapterError },
    clientVersion: "7.8.0",
  });
}

/** A bare DriverAdapterError (an updateMany through the adapter). */
function bare(cause: Record<string, unknown>) {
  return Object.assign(new Error(String(cause.originalMessage)), {
    name: "DriverAdapterError",
    cause,
    clientVersion: "7.8.0",
  });
}

const unique = (index: string, detail?: string) =>
  wrapped("P2002", {
    originalCode: "23505",
    originalMessage: `duplicate key value violates unique constraint "${index}"`,
    kind: "UniqueConstraintViolation",
    constraint: { fields: ["organizationId", "prefix"] },
    ...(detail ? { detail } : {}),
  });

const check = (table: string, constraint: string, detail: string) =>
  bare(
    adapterCause(
      "23514",
      `new row for relation "${table}" violates check constraint "${constraint}"`,
      { severity: "ERROR", detail },
    ),
  );

describe("mapDatabaseError by SQLSTATE and constraint name", () => {
  it("maps the prefix and name unique indexes", () => {
    expect(mapDatabaseError(unique("ProjectKeyPrefix_organizationId_prefix_key"))).toEqual({
      ok: false,
      code: "PREFIX_TAKEN",
    });
    expect(mapDatabaseError(unique("Project_organizationId_keyPrefix_key"))).toEqual({
      ok: false,
      code: "PREFIX_TAKEN",
    });
    expect(mapDatabaseError(unique("Team_organizationId_lower_name_key"))).toEqual({
      ok: false,
      code: "NAME_TAKEN",
    });
    expect(mapDatabaseError(unique("ProjectLabel_project_lower_name_key"))).toEqual({
      ok: false,
      code: "NAME_TAKEN",
    });
    expect(mapDatabaseError(unique("ProjectMilestone_project_lower_name_key"))).toEqual({
      ok: false,
      code: "NAME_TAKEN",
    });
  });

  it("maps the two subtask trigger messages (P0001) and Task_dates_check (23514)", () => {
    for (const message of [
      "Task subtask depth exceeded",
      "Task with subtasks cannot become a subtask",
    ]) {
      expect(mapDatabaseError(wrapped("P2010", adapterCause("P0001", message)))).toEqual({
        ok: false,
        code: "SUBTASK_DEPTH",
      });
    }
    expect(mapDatabaseError(check("Task", "Task_dates_check", "Failing row contains (x)"))).toEqual(
      { ok: false, code: "INVALID_DATE_RANGE" },
    );
  });

  it("maps every text length CHECK to INVALID_INPUT with the service's field", () => {
    const cases: [string, string, string][] = [
      ["Project", "Project_name_length_check", "name"],
      ["Project", "Project_description_length_check", "description"],
      ["Team", "Team_name_length_check", "name"],
      ["ProjectLabel", "ProjectLabel_name_length_check", "name"],
      ["ProjectMilestone", "ProjectMilestone_name_length_check", "name"],
      ["ProjectMilestone", "ProjectMilestone_description_length_check", "description"],
      ["Task", "Task_title_length_check", "title"],
      ["Task", "Task_description_length_check", "description"],
      ["TaskComment", "TaskComment_body_length_check", "body"],
    ];
    for (const [table, constraint, field] of cases) {
      expect(mapDatabaseError(check(table, constraint, "Failing row contains (x)"))).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        field,
      });
    }
  });

  it("maps a deadlock (40P01) to CONFLICT as a last resort", () => {
    const deadlock = wrapped(
      "P2010",
      adapterCause("40P01", "deadlock detected", { detail: "Process 1 waits for ShareLock" }),
    );
    expect(mapDatabaseError(deadlock)).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("user text in a row's detail never changes the mapping", () => {
    // A task titled like a trigger message and a constraint fails a different CHECK.
    const titled = check(
      "Task",
      "Task_title_length_check",
      'Failing row contains (Task subtask depth exceeded Task_dates_check "Project_organizationId_keyPrefix_key")',
    );
    expect(mapDatabaseError(titled)).toEqual({ ok: false, code: "INVALID_INPUT", field: "title" });
    // A team name that spells a prefix index, duplicated: still NAME_TAKEN.
    const team = unique(
      "Team_organizationId_lower_name_key",
      "Key (lower(name))=(projectkeyprefix_organizationid_prefix_key) already exists.",
    );
    expect(mapDatabaseError(team)).toEqual({ ok: false, code: "NAME_TAKEN" });
  });

  it("returns null (rethrow) for other errors, also when their free text names a mapped constraint", () => {
    expect(mapDatabaseError(new Error("Task_dates_check Task subtask depth exceeded"))).toBeNull();
    expect(
      mapDatabaseError(
        bare(
          adapterCause("23503", 'insert or update violates foreign key constraint "x"', {
            detail: "Task_dates_check ProjectKeyPrefix_organizationId_prefix_key",
          }),
        ),
      ),
    ).toBeNull();
    expect(
      mapDatabaseError(check("Task", "Task_rank_check", "Failing row contains (Task_dates_check)")),
    ).toBeNull();
    expect(
      mapDatabaseError(unique("TaskKey_organizationId_normalizedKey_key", "Task_dates_check")),
    ).toBeNull();
    expect(mapDatabaseError(null)).toBeNull();
    expect(mapDatabaseError("23505")).toBeNull();
  });
});
