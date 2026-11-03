// Uploads volume identity (Phase 9 plan 09-04; review Q7, R3 and P3).
//
// The file cleanup sweep deletes stored files only when it can prove it is looking at the real
// uploads volume and not at an empty directory that happens to have the same path (a container
// started without the volume, a local directory, a copied marker):
// - UPLOADS_DIR is a mount point: its device differs from its parent directory's device;
// - the marker file <UPLOADS_DIR>/.aida-uploads-volume holds the same id as the SystemSetting row
//   `uploads:volume-id`.
//
// The identity is established once, by the first sweep run on a database that has no identity
// yet: the marker is written with exclusive create (a marker already there is adopted, which is
// how a crash between the marker and the row recovers), then the row is inserted with
// ON CONFLICT DO NOTHING and read back. A database identity with a missing or different marker is
// never repaired here: only a restore writes the marker of an existing identity (plan 09-10).
//
// Relative imports only: the worker bundles this module.
import { randomBytes } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const UPLOADS_VOLUME_ID_KEY = "uploads:volume-id";
export const UPLOADS_MARKER_NAME = ".aida-uploads-volume";

const VOLUME_ID_PATTERN = /^[0-9a-f]{32}$/;

/** Any client that can run tagged raw SQL: the Prisma client or an interactive transaction. */
export interface RawSqlClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

export interface VolumeCheckOptions {
  /** Test seam only: a temporary directory is never a mount point. Production never passes it. */
  isMountPoint?: (dir: string) => Promise<boolean>;
}

/** True when dir is on a different device than its parent directory (a mount point). */
export async function isMountPoint(dir: string): Promise<boolean> {
  const resolved = path.resolve(dir);
  const parent = path.dirname(resolved);
  if (parent === resolved) return false;
  try {
    const [own, up] = await Promise.all([stat(resolved), stat(parent)]);
    return own.isDirectory() && own.dev !== up.dev;
  } catch {
    return false;
  }
}

function markerPath(uploadsDir: string): string {
  return path.join(uploadsDir, UPLOADS_MARKER_NAME);
}

async function readIdentity(client: RawSqlClient): Promise<string | null> {
  const rows = await client.$queryRaw<{ value: string }[]>`
    SELECT value FROM "SystemSetting" WHERE key = ${UPLOADS_VOLUME_ID_KEY}
  `;
  const value = rows[0]?.value;
  return typeof value === "string" ? value : null;
}

async function readMarker(uploadsDir: string): Promise<string | null> {
  try {
    return (await readFile(markerPath(uploadsDir), "utf8")).trim();
  } catch {
    return null;
  }
}

/**
 * Establishes the uploads volume identity when the database has none: writes the marker with
 * exclusive create (adopting a marker that already exists), then inserts the row. When the row
 * exists nothing changes. Returns the database identity afterwards, or null when there is none
 * (an adopted marker whose content is not a volume id is never written to the database).
 */
export async function ensureUploadsVolumeIdentity(
  client: RawSqlClient,
  uploadsDir: string,
): Promise<string | null> {
  const existing = await readIdentity(client);
  if (existing !== null) return existing;

  let id = randomBytes(16).toString("hex");
  try {
    await writeFile(markerPath(uploadsDir), `${id}\n`, { flag: "wx" });
  } catch (err) {
    if ((err as { code?: unknown }).code !== "EEXIST") throw err;
    // A marker from an earlier run that crashed before its row: adopt it.
    const adopted = await readMarker(uploadsDir);
    if (adopted === null || !VOLUME_ID_PATTERN.test(adopted)) return null;
    id = adopted;
  }
  await client.$executeRaw`
    INSERT INTO "SystemSetting" (id, key, value, "updatedAt")
    VALUES (gen_random_uuid()::text, ${UPLOADS_VOLUME_ID_KEY}, ${id}, now())
    ON CONFLICT ("key") DO NOTHING
  `;
  return readIdentity(client);
}

/** True only when uploadsDir is a mount point and its marker equals the database identity. */
export async function isUploadsVolumeVerified(
  client: RawSqlClient,
  uploadsDir: string,
  opts?: VolumeCheckOptions,
): Promise<boolean> {
  const mounted = await (opts?.isMountPoint ?? isMountPoint)(uploadsDir);
  if (!mounted) return false;
  const identity = await readIdentity(client);
  if (identity === null) return false;
  const marker = await readMarker(uploadsDir);
  return marker !== null && marker === identity;
}
