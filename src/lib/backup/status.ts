/**
 * The `backup:lastRun` SystemSetting record (Phase 9 plans 09-06, 09-13 and 09-08; AIDA-33,
 * D-04, UI-SPEC Surface 4).
 *
 * scripts/backup/lib.sh writes it with exactly four keys: `finishedAt` (UTC, milliseconds),
 * `result` (`succeeded` or `failed`), `setId` (the published set, or null) and `category` (null on
 * success; dump, archive, verification, storage or unknown on failure). The record holds no
 * secret and no tenant data. This module parses it strictly: anything that is not exactly that
 * shape is `unreadable`, and the page then shows only a fixed sentence. A failure category the UI
 * does not know becomes `unknown`, so no stored text ever reaches the page except a set id that
 * matched its format.
 *
 * Pure: no database, no React. Relative imports only (none needed).
 */

export const BACKUP_STATUS_KEY = "backup:lastRun";

/** `<UTC yyyymmddThhmmssZ>-<6 hex>`, the set id format of scripts/backup/lib.sh new_set_id. */
export const BACKUP_SET_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$/;

const FINISHED_AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$/;

export const BACKUP_FAILURE_CATEGORIES = [
  "dump",
  "archive",
  "verification",
  "storage",
  "unknown",
] as const;
export type BackupFailureCategory = (typeof BACKUP_FAILURE_CATEGORIES)[number];

/** One fixed sentence per failure category (UI-SPEC Copywriting); no raw error text. */
export const BACKUP_FAILURE_SENTENCES: Record<BackupFailureCategory, string> = {
  dump: "The database dump failed.",
  archive: "The uploads archive could not be written.",
  verification: "A file referenced by the database was missing from the archive.",
  storage: "The backup volume could not be written or is full.",
  unknown: "The run stopped with an unexpected error.",
};

export type BackupStatus =
  | { kind: "none" }
  | { kind: "succeeded"; finishedAt: string; setId: string }
  | {
      kind: "failed";
      finishedAt: string;
      setId: string | null;
      category: BackupFailureCategory;
    }
  | { kind: "unreadable" };

const RECORD_KEYS = ["category", "finishedAt", "result", "setId"];

function isFailureCategory(value: string): value is BackupFailureCategory {
  return (BACKUP_FAILURE_CATEGORIES as readonly string[]).includes(value);
}

/** A real calendar instant in the expected ISO form (2026-02-30 is refused). */
function validFinishedAt(value: unknown): value is string {
  if (typeof value !== "string" || !FINISHED_AT.test(value)) return false;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  const canonical = new Date(time).toISOString();
  return value.length === canonical.length
    ? canonical === value
    : canonical.replace(/\.[0-9]{3}Z$/, "Z") === value;
}

/**
 * Parses the stored value of `backup:lastRun`. `null` (no row) is `none`; every value that is not
 * exactly the four-key record is `unreadable`.
 */
export function parseBackupStatus(value: string | null): BackupStatus {
  if (value === null) return { kind: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { kind: "unreadable" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "unreadable" };
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== RECORD_KEYS.join(",")) {
    return { kind: "unreadable" };
  }
  const { finishedAt, result, setId, category } = record;
  if (!validFinishedAt(finishedAt)) return { kind: "unreadable" };
  if (setId !== null && (typeof setId !== "string" || !BACKUP_SET_ID.test(setId))) {
    return { kind: "unreadable" };
  }

  if (result === "succeeded") {
    if (typeof setId !== "string" || category !== null) return { kind: "unreadable" };
    return { kind: "succeeded", finishedAt, setId };
  }
  if (result === "failed") {
    if (typeof category !== "string" || category.length === 0) return { kind: "unreadable" };
    return {
      kind: "failed",
      finishedAt,
      setId,
      category: isFailureCategory(category) ? category : "unknown",
    };
  }
  return { kind: "unreadable" };
}

/** The fixed sentence for a failure category; anything unknown gets the generic sentence. */
export function backupFailureSentence(category: string): string {
  return isFailureCategory(category)
    ? BACKUP_FAILURE_SENTENCES[category]
    : BACKUP_FAILURE_SENTENCES.unknown;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The absolute time of a run, in UTC like the schedule: "8 Nov 2026, 02:00 UTC". Built by hand,
 * so it does not depend on the server's locale data or time zone.
 */
export function formatBackupTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())} UTC`;
}
