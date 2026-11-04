// Phase 9 plan 09-06: the backup script and the deleter speak the same fence contract (plan 09-04,
// U-12). scripts/backup/lib.sh must use the same advisory lock key, lease key, lease fields,
// lease predicate and uploads identity key as src/lib/storage/file-fence.ts and
// src/lib/storage/uploads-volume.ts, judge expiry by the database clock and reach the database
// through libpq variables only. The behaviour itself is proven against real Postgres in
// tests/integration/backup-consistency.test.ts. This file runs lib.sh functions that touch no
// database, with the host's sh.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKUP_FENCE_APPLICATION_NAME,
  BACKUP_LEASE_KEY,
  FILE_FENCE_KEY_SQL,
  leaseValueActiveSql,
} from "@/lib/storage/file-fence";
import { UPLOADS_MARKER_NAME, UPLOADS_VOLUME_ID_KEY } from "@/lib/storage/uploads-volume";

const ROOT = path.resolve(__dirname, "../..");
const LIB = path.join(ROOT, "scripts", "backup", "lib.sh");
const MAIN = path.join(ROOT, "scripts", "backup", "aida-backup.sh");
const lib = readFileSync(LIB, "utf8");
const main = readFileSync(MAIN, "utf8");

/** Runs one lib.sh function in a fresh sh and returns its stdout. */
function libCall(fn: string, ...args: string[]): string {
  return execFileSync("sh", ["-c", `. "$0"; ${fn} "$@"`, LIB, ...args], { encoding: "utf8" });
}

function libStatus(fn: string, ...args: string[]): number {
  try {
    execFileSync("sh", ["-c", `. "$0"; ${fn} "$@"`, LIB, ...args], { stdio: "ignore" });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? 1;
  }
}

describe("backup fence contract (lib.sh against file-fence.ts)", () => {
  it("uses the exact advisory lock key text of the deleter", () => {
    expect(lib).toContain(`FILE_FENCE_KEY_SQL="${FILE_FENCE_KEY_SQL}"`);
    expect(
      execFileSync("sh", ["-c", '. "$0"; printf %s "$FILE_FENCE_KEY_SQL"', LIB], {
        encoding: "utf8",
      }),
    ).toBe(FILE_FENCE_KEY_SQL);
  });

  it("uses the lease key, the lease fields holder and expiresAt, and the fence application name", () => {
    expect(lib).toContain(`BACKUP_LEASE_KEY='${BACKUP_LEASE_KEY}'`);
    expect(lib).toContain("'holder'");
    expect(lib).toContain("'expiresAt'");
    expect(lib).toContain(`BACKUP_FENCE_APPLICATION_NAME='${BACKUP_FENCE_APPLICATION_NAME}'`);
  });

  it("emits the deleter's lease predicate byte for byte", () => {
    for (const column of ["s.value", '"SystemSetting".value', "value"]) {
      expect(libCall("lease_active_sql", column)).toBe(`${leaseValueActiveSql(column)}\n`);
    }
  });

  it("computes the lease expiry from the database clock, never from the container clock", () => {
    expect(libCall("lease_value_sql")).toContain(
      "to_char((now() + make_interval(secs => :'ttl'::double precision)) AT TIME ZONE 'UTC'",
    );
    expect(lib).not.toMatch(/expiresAt[^\n]*\$\(date/);
  });

  it("uses the uploads identity key and marker name of uploads-volume.ts", () => {
    expect(lib).toContain(`UPLOADS_VOLUME_ID_KEY='${UPLOADS_VOLUME_ID_KEY}'`);
    expect(lib).toContain(`UPLOADS_MARKER_NAME='${UPLOADS_MARKER_NAME}'`);
  });

  it("contains no database connection URL and passes none to psql or pg_dump", () => {
    for (const text of [lib, main]) {
      expect(text).not.toMatch(/postgres(ql)?:\/\//);
      expect(text).not.toMatch(/(psql|pg_dump|pg_restore)[^\n]*(-d|--dbname)[ =]/);
      expect(text).not.toContain("DATABASE_URL");
    }
  });

  it("is executable and runs under set -eu", () => {
    expect(statSync(MAIN).mode & 0o111).not.toBe(0);
    expect(main).toMatch(/^set -eu$/m);
  });
});

describe("set ids (lib.sh)", () => {
  it("new_set_id gives the UTC second plus 6 random hex characters, unique within one second", () => {
    const pattern = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$/;
    const ids = Array.from({ length: 5 }, () => libCall("new_set_id").trim());
    for (const id of ids) {
      expect(id).toMatch(pattern);
      expect(libStatus("valid_set_id", id)).toBe(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("valid_set_id refuses anything else, including path tricks and embedded newlines", () => {
    for (const bad of [
      "",
      "20261112T081602Z",
      "20261112T081602Z-ABCDEF",
      "20261112T081602Z-abcdeg",
      "../20261112T081602Z-abc",
      "20261112T081602Z-abcdef\n20261112T081602Z-abcdef",
      "20261112T081602Z-abcdef/",
    ]) {
      expect(libStatus("valid_set_id", bad)).not.toBe(0);
    }
  });
});

describe("status record (lib.sh)", () => {
  it("record_status refuses a result, category or set id outside the fixed sets before any SQL", () => {
    // psql is never reached: each call fails its own validation first.
    expect(libStatus("record_status", "maybe", "-", "unknown")).toBe(1);
    expect(libStatus("record_status", "failed", "-", "disk-full")).toBe(1);
    expect(libStatus("record_status", "failed", "../x", "unknown")).toBe(1);
  });

  it("writes exactly the four keys finishedAt, result, setId and category", () => {
    const body = lib.slice(lib.indexOf("record_status() {"));
    const insert = body.slice(0, body.indexOf("ON CONFLICT"));
    const keys = [...insert.matchAll(/^\s+'([A-Za-z]+)', /gm)].map((m) => m[1]);
    expect(keys).toEqual(["finishedAt", "result", "setId", "category"]);
  });
});
