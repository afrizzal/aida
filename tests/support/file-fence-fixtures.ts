// Test-only helpers for the backup fence and the uploads volume identity (Phase 9 plan 09-04).
//
// - testUploadsDir(): a fresh temporary uploads directory whose marker holds the database's
//   `uploads:volume-id` (created when absent). Every integration file shares one database and so
//   one identity; each file's directory carries that identity's marker.
// - testFenceProvider(dir): the real fence provider with the mount-point test replaced, because a
//   temporary directory is never a mount point. Everything else (identity, lock, lease) is real.
// - trackFence(provider): wraps open() and keeps every handle, so a test can await `closed` and
//   no shared lock outlives it.
// - backupEmulator(url): the backup side of the fence as SQL, the statements plan 09-06's shell
//   issues: exclusive pg_advisory_lock on FILE_FENCE_KEY_SQL from a session named
//   aida-backup-fence, and the `backup:lease` row (id and updatedAt supplied, only when no
//   unexpired lease exists). Every test that uses it calls release() in finally, which also
//   deletes any lease row it wrote, so no other case or file finds a leftover fence or lease.
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { prisma } from "@/lib/db";
import {
  BACKUP_FENCE_APPLICATION_NAME,
  BACKUP_LEASE_KEY,
  createDeleteFenceProvider,
  type DeleteFence,
  type DeleteFenceProvider,
  type FenceRefusal,
  FILE_FENCE_KEY_SQL,
  leaseValueActiveSql,
} from "@/lib/storage/file-fence";
import { UPLOADS_MARKER_NAME, UPLOADS_VOLUME_ID_KEY } from "@/lib/storage/uploads-volume";

/** The database's uploads volume identity, created when absent. */
export async function testVolumeIdentity(): Promise<string> {
  const candidate = randomBytes(16).toString("hex");
  await prisma.$executeRaw`
    INSERT INTO "SystemSetting" (id, key, value, "updatedAt")
    VALUES (gen_random_uuid()::text, ${UPLOADS_VOLUME_ID_KEY}, ${candidate}, now())
    ON CONFLICT ("key") DO NOTHING
  `;
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM "SystemSetting" WHERE key = ${UPLOADS_VOLUME_ID_KEY}
  `;
  const value = rows[0]?.value;
  if (typeof value !== "string") throw new Error("testVolumeIdentity: no identity row");
  return value;
}

/** A fresh temporary uploads directory carrying the database identity's marker. */
export async function testUploadsDir(prefix = "aida-uploads-"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const id = await testVolumeIdentity();
  await writeFile(path.join(dir, UPLOADS_MARKER_NAME), `${id}\n`, { flag: "wx" });
  return dir;
}

/** The real provider with only the mount-point test replaced (a temp dir is no mount point). */
export function testFenceProvider(uploadsDir: string): DeleteFenceProvider {
  return createDeleteFenceProvider({
    connectionString: process.env.DATABASE_URL,
    uploadsDir,
    client: prisma,
    isMountPoint: async () => true,
  });
}

export interface TrackedFence {
  fence: DeleteFenceProvider;
  /** Every handle open() returned, in order. */
  handles: DeleteFence[];
  /** Every refusal open() returned, in order. */
  refusals: FenceRefusal[];
  /** Resolves when every handle's lock is released. */
  allClosed(): Promise<void>;
}

/** Keeps the handles of a provider so a test can await their release. */
export function trackFence(provider: DeleteFenceProvider): TrackedFence {
  const handles: DeleteFence[] = [];
  const refusals: FenceRefusal[] = [];
  return {
    handles,
    refusals,
    fence: {
      async open() {
        const opened = await provider.open();
        if ("refused" in opened) refusals.push(opened);
        else handles.push(opened);
        return opened;
      },
    },
    async allClosed() {
      await Promise.all(handles.map((h) => h.closed));
    },
  };
}

export interface FenceLockRow {
  pid: number;
  applicationName: string;
  mode: string;
  granted: boolean;
}

/** Every pg_locks entry on the fence key, with the holder's application_name. */
export async function fenceLocks(): Promise<FenceLockRow[]> {
  const rows = await prisma.$queryRawUnsafe<
    { pid: number; application_name: string; mode: string; granted: boolean }[]
  >(`
    WITH k AS (SELECT ${FILE_FENCE_KEY_SQL} AS key)
    SELECT l.pid, a.application_name, l.mode, l.granted
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    CROSS JOIN k
    WHERE l.locktype = 'advisory'
      AND l.objsubid = 1
      AND l.classid = ((k.key >> 32) & 4294967295)::oid
      AND l.objid = (k.key & 4294967295)::oid
    ORDER BY l.pid
  `);
  return rows.map((r) => ({
    pid: Number(r.pid),
    applicationName: r.application_name,
    mode: r.mode,
    granted: r.granted,
  }));
}

/** Backend PIDs of open connections with this application_name. */
export async function backendsNamed(applicationName: string): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity WHERE application_name = ${applicationName} ORDER BY pid
  `;
  return rows.map((r) => Number(r.pid));
}

/** Deletes the backup lease row, if any. */
export async function deleteBackupLease(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key = ${BACKUP_LEASE_KEY}`;
}

export interface BackupEmulator {
  /** The backend PID of the emulator's fence session. */
  readonly pid: number;
  /** Takes the exclusive fence lock; resolves when granted (waits behind shared holders). */
  holdFence(): Promise<void>;
  /** Writes the committed lease row with an expiry relative to the database clock. */
  writeLease(opts: { holder: string; expiresInSeconds: number }): Promise<void>;
  /** Terminates the fence session from another connection, as a dropped session. */
  dropSession(): Promise<void>;
  /** Ends the session (releasing the lock) and deletes any lease row it wrote. Idempotent. */
  release(): Promise<void>;
}

async function waitUntil(check: () => Promise<boolean>, what: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`backupEmulator: ${what} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** The backup side of the fence on a dedicated session (plan 09-06 issues the same SQL). */
export async function backupEmulator(url = process.env.DATABASE_URL): Promise<BackupEmulator> {
  if (!url) throw new Error("backupEmulator: DATABASE_URL is not set");
  const session = new pg.Client({
    connectionString: url,
    application_name: BACKUP_FENCE_APPLICATION_NAME,
  });
  let ended = false;
  // A terminated session emits "error"; the emulator expects it after dropSession().
  session.on("error", () => {
    ended = true;
  });
  session.on("end", () => {
    ended = true;
  });
  await session.connect();
  const pidRows = await session.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = Number(pidRows.rows[0]?.pid);
  let leaseWritten = false;
  let holdPending = false;

  async function terminate(): Promise<void> {
    await prisma.$queryRaw`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE application_name = ${BACKUP_FENCE_APPLICATION_NAME} AND pid = ${pid}::int
    `;
    await waitUntil(
      async () => (await backendsNamed(BACKUP_FENCE_APPLICATION_NAME)).includes(pid) === false,
      "session not gone",
    );
  }

  return {
    pid,
    async holdFence() {
      holdPending = true;
      try {
        await session.query(`SELECT pg_advisory_lock(${FILE_FENCE_KEY_SQL})`);
      } finally {
        holdPending = false;
      }
    },
    async writeLease({ holder, expiresInSeconds }) {
      const written = await session.query(
        `INSERT INTO "SystemSetting" (id, key, value, "updatedAt")
         VALUES (
           gen_random_uuid()::text,
           '${BACKUP_LEASE_KEY}',
           json_build_object(
             'holder', $1::text,
             'expiresAt', to_char(
               (now() + make_interval(secs => $2::double precision)) AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           )::text,
           now()
         )
         ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()
         WHERE NOT (${leaseValueActiveSql('"SystemSetting".value')})`,
        [holder, expiresInSeconds],
      );
      if (written.rowCount !== 1) throw new Error("backupEmulator: an unexpired lease exists");
      leaseWritten = true;
    },
    async dropSession() {
      await terminate();
      await waitUntil(async () => ended, "client did not notice the drop");
    },
    async release() {
      // A lock request still waiting would queue the unlock behind it: end the session instead.
      if (!ended && holdPending) await terminate();
      if (!ended) {
        try {
          await session.query(`SELECT pg_advisory_unlock_all()`);
        } catch {
          // A dropped session holds nothing.
        }
        try {
          await session.end();
        } catch {
          // Already gone.
        }
        ended = true;
      }
      await waitUntil(
        async () => (await backendsNamed(BACKUP_FENCE_APPLICATION_NAME)).includes(pid) === false,
        "session not gone after release",
      );
      if (leaseWritten) {
        await deleteBackupLease();
        leaseWritten = false;
      }
    },
  };
}
