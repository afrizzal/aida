// Phase 14, contract section 6 (D-08, C5, C6): task numbers, keys and the key namespace.
// Relative imports only (worker-reachable).
//
// The number comes from the project's ProjectTaskCounter row with one UPDATE ... RETURNING inside
// the creating transaction, after the project lock (lock class 4 of section 3). The namespace
// (TaskKey) keeps every key a task ever had: ACTIVE for the current key, ALIAS for a key a move
// replaced, TOMBSTONE for the keys of a deleted task (class 5). TaskKey has no foreign key to Task
// or Project (C5), so the resolver re-reads the task with the read predicate before it answers.
import { readableProjectSql, refuseUnreadable } from "./access";
import {
  formatTaskKey,
  normalizeTaskKey,
  type ProjectActor,
  type ProjectResult,
  TASK_NUMBER_MAX,
} from "./contract";
import { afterReadCheck, isPlausibleId, type ProjectDb, refuse, runProjectRead } from "./service";

/**
 * The next task number of the project: `UPDATE ... SET "lastNumber" = "lastNumber" + 1 ... AND
 * "lastNumber" < TASK_NUMBER_MAX RETURNING "lastNumber"` with the organization term. No row (the
 * counter is at TASK_NUMBER_MAX): KEY_SPACE_EXHAUSTED. Run it after the project lock.
 */
export async function nextTaskNumberInTx(
  tx: ProjectDb,
  orgId: string,
  projectId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    UPDATE "ProjectTaskCounter" SET "lastNumber" = "lastNumber" + 1
    WHERE "projectId" = ${projectId} AND "organizationId" = ${orgId}
      AND "lastNumber" < ${TASK_NUMBER_MAX}
    RETURNING "lastNumber"`;
  const value = rows[0]?.lastNumber;
  if (value === undefined || value === null) refuse("KEY_SPACE_EXHAUSTED");
  const taskNumber = Number(value);
  if (!Number.isSafeInteger(taskNumber) || taskNumber < 1) refuse("KEY_SPACE_EXHAUSTED");
  return taskNumber;
}

/** Inserts the ACTIVE TaskKey row of a task and returns its key (prefix, "-", number). */
export async function issueTaskKeyInTx(
  tx: ProjectDb,
  entry: { orgId: string; projectId: string; taskId: string; prefix: string; number: number },
): Promise<string> {
  const key = formatTaskKey(entry.prefix, entry.number);
  await tx.taskKey.create({
    data: {
      organizationId: entry.orgId,
      normalizedKey: key,
      taskId: entry.taskId,
      projectId: entry.projectId,
      kind: "ACTIVE",
    },
    select: { id: true },
  });
  return key;
}

/** Turns the ACTIVE row of a key into an ALIAS (a move). Returns the number of rows changed. */
export async function aliasTaskKeyInTx(tx: ProjectDb, orgId: string, key: string): Promise<number> {
  const normalized = normalizeTaskKey(key);
  if (normalized === null) return 0;
  const updated = await tx.taskKey.updateMany({
    where: { organizationId: orgId, normalizedKey: normalized, kind: "ACTIVE" },
    data: { kind: "ALIAS" },
  });
  return updated.count;
}

/** Turns every key row of the given tasks into a TOMBSTONE (a delete). Returns the count. */
export async function tombstoneTaskKeysInTx(
  tx: ProjectDb,
  orgId: string,
  taskIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(taskIds)].filter((id) => isPlausibleId(id));
  if (ids.length === 0) return 0;
  const updated = await tx.taskKey.updateMany({
    where: { organizationId: orgId, taskId: { in: ids }, kind: { not: "TOMBSTONE" } },
    data: { kind: "TOMBSTONE" },
  });
  return updated.count;
}

export interface ResolvedTaskKey {
  taskId: string;
  key: string;
  projectId: string;
  isAlias: boolean;
}

/**
 * Resolves a task key (READ, isolation KEY): parse after trim and uppercase; a malformed key, a
 * missing key or a TOMBSTONE is NOT_FOUND; an ALIAS whose origin project the reader cannot read now,
 * or whose origin project was deleted, is NOT_FOUND too (K72); otherwise the task is read through
 * the read predicate with the organization term, and no access is NOT_FOUND, identical to a key
 * that exists nowhere. One statement decides all of it (K73). Returns the task's current key and whether the given key is an alias.
 */
export async function resolveTaskKey(
  actor: ProjectActor,
  key: string,
): Promise<ProjectResult<ResolvedTaskKey>> {
  return runProjectRead(actor, "resolveTaskKey", async (db) => {
    const normalized = typeof key === "string" ? normalizeTaskKey(key) : null;
    if (normalized === null) refuse("NOT_FOUND");
    await afterReadCheck(db, "resolveTaskKey");
    // K73 (Codex diff round 2, R2D-3): one statement decides the key's kind, the alias origin's
    // read access (K72: an ALIAS needs read access to the project the key was issued in, and a
    // deleted origin no longer resolves) and the read access to the task's current project, so
    // no move, privacy change or membership removal can fall between those decisions.
    const found = await db.$queryRaw<
      { id: string; key: string; projectId: string; kind: string }[]
    >`
      SELECT t.id, t.key, t."projectId", k.kind::text AS kind
      FROM "TaskKey" k
      JOIN "Task" t ON t.id = k."taskId" AND t."organizationId" = k."organizationId"
      JOIN "Project" p ON p.id = t."projectId" AND p."organizationId" = t."organizationId"
      WHERE k."organizationId" = ${actor.orgId}
        AND k."normalizedKey" = ${normalized}
        AND k.kind::text IN ('ACTIVE', 'ALIAS')
        AND ${readableProjectSql("p", actor)}
        AND (k.kind::text = 'ACTIVE' OR EXISTS (
          SELECT 1 FROM "Project" o
          WHERE o.id = k."projectId" AND o."organizationId" = k."organizationId"
            AND ${readableProjectSql("o", actor)}))
    `;
    const task = found[0];
    if (!task) return refuseUnreadable(db, actor);
    return {
      taskId: task.id,
      key: task.key,
      projectId: task.projectId,
      isAlias: task.kind === "ALIAS",
    };
  });
}
