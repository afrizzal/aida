// The deleter side of the backup fence (Phase 9 plan 09-04, decision U-12; the backup side is
// plan 09-06, which issues the same lock key, lease key and lease JSON fields).
//
// Two signals fence a backup, so that a delete never runs while a backup is archiving:
// - a session-level advisory lock on FILE_FENCE_KEY_SQL. The backup holds the exclusive side on a
//   dedicated session (application_name aida-backup-fence) for its whole run; the sweep holds the
//   shared side on its own connection (application_name aida-delete-fence) from before it selects
//   any due row until every storage.delete of its run has settled, including a delete that the
//   sweep's I/O budget already reported as ETIMEDOUT;
// - a committed SystemSetting row `backup:lease` = {"holder": "<setId>", "expiresAt": "<ISO UTC>"},
//   written by the backup after its lock is held and renewed while it runs. It covers a backup
//   whose fence session dropped: an unexpired lease refuses the sweep even when the lock is free.
//   Expiry is judged by the database clock. A value that is not a JSON object with an ISO
//   expiresAt counts as no lease.
// An expired lease alone never lets a delete through while the backup's session still holds the
// exclusive lock (a paused backup), and a backup whose session is gone and whose lease expired no
// longer blocks deletion (crash safety, D-02(5)). Limit L1 of the plan: a backup that is paused,
// has lost its session and whose lease expired, all at once, no longer fences deletions; that run
// then fails its lease check and its dump-to-archive verification (plan 09-06).
//
// Order of the deleter (contract of plan 09-04): verify the uploads volume; take the shared lock
// with pg_try_advisory_lock_shared (false: refused "backup-archiving"; a backup waiting for the
// exclusive side also makes it false, so a sweep never starves a backup); read the lease on the
// same connection (active: unlock, refused "backup-lease"); any connection error before the
// select: refused "fence-unavailable". The lock is released in the background after the run's
// transaction ended and every tracked delete settled. A connection drop after the select logs one
// line; deletes in flight continue, which is harmless because every key the run selected was
// dereferenced and enqueued before any backup the run did not see took the fence (G6).
//
// Logs carry a reason and an error code only, never a key value, a lease value or a URL.
// Relative imports only: the worker bundles this module.
import pg from "pg";
import {
  ensureUploadsVolumeIdentity,
  isMountPoint,
  isUploadsVolumeVerified,
  type RawSqlClient,
} from "./uploads-volume";

/** The advisory lock key text shared with the backup (plan 09-06). */
export const FILE_FENCE_KEY_TEXT = "aida:file-fence";
/** The advisory lock key as an SQL expression (session-level lock, 64-bit key). */
export const FILE_FENCE_KEY_SQL = "hashtextextended('aida:file-fence', 0)";
/** The SystemSetting key of the backup lease. */
export const BACKUP_LEASE_KEY = "backup:lease";
export const DELETE_FENCE_APPLICATION_NAME = "aida-delete-fence";
export const BACKUP_FENCE_APPLICATION_NAME = "aida-backup-fence";

// ISO 8601 date and time with seconds, optional fraction, and Z or a numeric offset.
const ISO_TIMESTAMP_SOURCE =
  "^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(\\.[0-9]{1,6})?(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$";
const ISO_TIMESTAMP = new RegExp(ISO_TIMESTAMP_SOURCE);
// The same pattern in the SQL check: Postgres advanced regular expressions accept (?:...) and \.
// (standard_conforming_strings is on, so the backslash reaches the regex as written).
const ISO_TIMESTAMP_SQL = ISO_TIMESTAMP_SOURCE.replaceAll("'", "''");

/**
 * An SQL boolean expression that is true only when the text column holds a JSON object whose
 * expiresAt is an ISO timestamp later than the database's now(). CASE keeps the casts behind
 * their guards, so a malformed value is false and never an error.
 */
export function leaseValueActiveSql(column: string): string {
  return `CASE WHEN ${column} IS JSON OBJECT THEN
    CASE WHEN jsonb_typeof((${column})::jsonb -> 'expiresAt') = 'string'
           AND ((${column})::jsonb ->> 'expiresAt') ~ '${ISO_TIMESTAMP_SQL}'
           AND pg_input_is_valid((${column})::jsonb ->> 'expiresAt', 'timestamptz')
      THEN ((${column})::jsonb ->> 'expiresAt')::timestamptz > now()
      ELSE false END
  ELSE false END`;
}

/** One SELECT returning `active` (boolean): an unexpired backup lease exists. */
export const BACKUP_LEASE_ACTIVE_SQL = `SELECT COALESCE((
  SELECT ${leaseValueActiveSql("s.value")}
  FROM "SystemSetting" s
  WHERE s.key = '${BACKUP_LEASE_KEY}'
), false) AS active`;

export interface BackupLease {
  holder: string;
  expiresAt: Date;
}

function strictIsoDate(text: string): Date | null {
  const m = ISO_TIMESTAMP.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.parse rolls 2026-02-30 over into March; the calendar date must exist as written.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return null;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Parses a lease value; null for anything but a JSON object with a holder and an ISO expiresAt. */
export function parseLease(value: unknown): BackupLease | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { holder, expiresAt } = parsed as { holder?: unknown; expiresAt?: unknown };
  if (typeof holder !== "string" || holder.length === 0) return null;
  if (typeof expiresAt !== "string") return null;
  const date = strictIsoDate(expiresAt);
  return date ? { holder, expiresAt: date } : null;
}

export type FenceRefusalReason =
  | "uploads-unverified"
  | "backup-archiving"
  | "backup-lease"
  | "fence-unavailable";

export type FenceRefusal = { refused: FenceRefusalReason };

/** A held shared side of the fence, for one sweep run. */
export interface DeleteFence {
  /** Registers a storage delete; the lock is kept until it settles. Call before close(). */
  track(work: Promise<unknown>): void;
  /** Releases the lock in the background once every tracked delete settled. Never throws. */
  close(): void;
  /** Resolves when the lock is released and the connection ended. Never rejects. */
  readonly closed: Promise<void>;
}

export interface DeleteFenceProvider {
  open(): Promise<DeleteFence | FenceRefusal>;
}

export interface DeleteFenceProviderOptions {
  connectionString: string | undefined;
  uploadsDir: string;
  /** Reads and writes the uploads volume identity (SystemSetting). */
  client: RawSqlClient;
  /** Test seam only: production never passes it (a temporary directory is no mount point). */
  isMountPoint?: (dir: string) => Promise<boolean>;
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "UNKNOWN";
}

function log(message: string): void {
  try {
    console.error(`[file-fence] ${message}`);
  } catch {
    // Logging never changes the outcome.
  }
}

async function safeEnd(conn: pg.Client): Promise<void> {
  try {
    await conn.end();
  } catch {
    // The connection is gone either way.
  }
}

async function safeUnlock(conn: pg.Client): Promise<void> {
  try {
    await conn.query(`SELECT pg_advisory_unlock_shared(${FILE_FENCE_KEY_SQL})`);
  } catch {
    // Ending the session releases a session-level lock anyway.
  }
}

function noop(): void {}

interface FenceConnectionState {
  /** Set once the handle exists: a connection error after that is logged once. */
  held: boolean;
  lost: boolean;
}

function createHandle(conn: pg.Client, state: FenceConnectionState): DeleteFence {
  const pending: Promise<unknown>[] = [];
  let closing = false;
  let resolveClosed: () => void = noop;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  state.held = true;
  return {
    track(work) {
      pending.push(Promise.resolve(work).then(noop, noop));
    },
    close() {
      if (closing) return;
      closing = true;
      void (async () => {
        try {
          while (pending.length > 0) await Promise.allSettled(pending.splice(0));
          if (!state.lost) await safeUnlock(conn);
          await safeEnd(conn);
        } catch {
          // Never reached: every step above catches its own errors.
        } finally {
          resolveClosed();
        }
      })();
    },
    closed,
  };
}

async function openDeleteFence(
  opts: DeleteFenceProviderOptions,
): Promise<DeleteFence | FenceRefusal> {
  // Step 1: the uploads volume. A directory that is not a mount point gets no identity written.
  const mountCheck = opts.isMountPoint ?? isMountPoint;
  try {
    if (!(await mountCheck(opts.uploadsDir))) return { refused: "uploads-unverified" };
    await ensureUploadsVolumeIdentity(opts.client, opts.uploadsDir);
    const verified = await isUploadsVolumeVerified(opts.client, opts.uploadsDir, {
      isMountPoint: mountCheck,
    });
    if (!verified) return { refused: "uploads-unverified" };
  } catch (err) {
    log(`uploads volume check failed: code=${errorCode(err)}`);
    return { refused: "uploads-unverified" };
  }

  // Step 2: the shared side of the fence lock, on a connection of its own.
  if (!opts.connectionString) {
    log("fence unavailable: no database connection string");
    return { refused: "fence-unavailable" };
  }
  const state: FenceConnectionState = { held: false, lost: false };
  const conn = new pg.Client({
    connectionString: opts.connectionString,
    application_name: DELETE_FENCE_APPLICATION_NAME,
  });
  conn.on("error", (err) => {
    if (state.lost) return;
    state.lost = true;
    // Before the handle exists the failing call below reports it; after, this is the one line.
    if (state.held) log(`fence connection lost during a run: code=${errorCode(err)}`);
  });
  try {
    await conn.connect();
    const locked = await conn.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock_shared(${FILE_FENCE_KEY_SQL}) AS locked`,
    );
    if (locked.rows[0]?.locked !== true) {
      await safeEnd(conn);
      return { refused: "backup-archiving" };
    }
    // Step 3: the lease, on the same connection, by the database clock.
    const lease = await conn.query<{ active: boolean }>(BACKUP_LEASE_ACTIVE_SQL);
    if (lease.rows[0]?.active !== false) {
      await safeUnlock(conn);
      await safeEnd(conn);
      return { refused: "backup-lease" };
    }
  } catch (err) {
    log(`fence unavailable: code=${errorCode(err)}`);
    await safeEnd(conn);
    return { refused: "fence-unavailable" };
  }
  return createHandle(conn, state);
}

/** The sweep's fence: open() before the select, track() every delete, close() after the run. */
export function createDeleteFenceProvider(opts: DeleteFenceProviderOptions): DeleteFenceProvider {
  return { open: () => openDeleteFence(opts) };
}
