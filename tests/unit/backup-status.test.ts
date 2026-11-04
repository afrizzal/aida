// Phase 9 plan 09-08 (AIDA-33, D-04, UI-SPEC Surface 4): the strict parse of `backup:lastRun`
// and the fixed failure sentences the Backups tab shows.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKUP_FAILURE_CATEGORIES,
  BACKUP_FAILURE_SENTENCES,
  backupFailureSentence,
  formatBackupTime,
  parseBackupStatus,
} from "../../src/lib/backup/status";

const SET_ID = "20261112T020001Z-a1b2c3";
const FINISHED = "2026-11-12T02:00:41.123Z";

const record = (fields: Record<string, unknown>) =>
  JSON.stringify({
    finishedAt: FINISHED,
    result: "succeeded",
    setId: SET_ID,
    category: null,
    ...fields,
  });

describe("parseBackupStatus: the four-key record (D-04)", () => {
  it("no row is none", () => {
    expect(parseBackupStatus(null)).toEqual({ kind: "none" });
  });

  it("a succeeded run with its set id", () => {
    expect(parseBackupStatus(record({}))).toEqual({
      kind: "succeeded",
      finishedAt: FINISHED,
      setId: SET_ID,
    });
  });

  it("the exact line lib.sh status_json prints parses as succeeded", () => {
    const line = `{"finishedAt":"${FINISHED}","result":"succeeded","setId":"${SET_ID}","category":null}`;
    expect(parseBackupStatus(line).kind).toBe("succeeded");
  });

  for (const category of ["dump", "archive", "verification", "storage", "unknown"] as const) {
    it(`a failed run without a set, category ${category}`, () => {
      expect(parseBackupStatus(record({ result: "failed", setId: null, category }))).toEqual({
        kind: "failed",
        finishedAt: FINISHED,
        setId: null,
        category,
      });
    });
  }

  it("a failed run that names a set keeps the set id", () => {
    const status = parseBackupStatus(record({ result: "failed", category: "storage" }));
    expect(status).toEqual({
      kind: "failed",
      finishedAt: FINISHED,
      setId: SET_ID,
      category: "storage",
    });
  });

  it("an unknown failure category becomes unknown; its text is not kept", () => {
    const status = parseBackupStatus(
      record({ result: "failed", setId: null, category: "disk exploded at /backups/x" }),
    );
    expect(status).toEqual({
      kind: "failed",
      finishedAt: FINISHED,
      setId: null,
      category: "unknown",
    });
    expect(JSON.stringify(status)).not.toContain("exploded");
  });

  it("a finishedAt without milliseconds is accepted", () => {
    expect(parseBackupStatus(record({ finishedAt: "2026-11-12T02:00:41Z" })).kind).toBe(
      "succeeded",
    );
  });

  const unreadable: Array<[string, string]> = [
    ["not JSON", "not json"],
    ["empty string", ""],
    ["JSON null", "null"],
    ["an array", JSON.stringify([FINISHED, "succeeded"])],
    ["a string", JSON.stringify("succeeded")],
    ["a missing key", JSON.stringify({ finishedAt: FINISHED, result: "succeeded", setId: SET_ID })],
    ["an extra key", record({ error: "pg_dump: connection refused" })],
    ["an unknown result", record({ result: "partial" })],
    ["result in another case", record({ result: "Succeeded" })],
    ["a succeeded run without a set", record({ setId: null })],
    ["a succeeded run with a category", record({ category: "dump" })],
    ["a failed run without a category", record({ result: "failed", setId: null, category: null })],
    [
      "a failed run with an empty category",
      record({ result: "failed", setId: null, category: "" }),
    ],
    [
      "a failed run with a numeric category",
      record({ result: "failed", setId: null, category: 3 }),
    ],
    ["a malformed set id", record({ setId: "../../etc/passwd" })],
    ["a set id in upper case", record({ setId: "20261112T020001Z-A1B2C3" })],
    ["a set id as a number", record({ setId: 20261112 })],
    ["a finishedAt that is not ISO", record({ finishedAt: "12 Nov 2026" })],
    ["a finishedAt with an offset", record({ finishedAt: "2026-11-12T02:00:41+07:00" })],
    ["a finishedAt that is not a real date", record({ finishedAt: "2026-02-30T02:00:41.000Z" })],
    ["a finishedAt as a number", record({ finishedAt: 1_762_912_841_000 })],
  ];

  for (const [name, value] of unreadable) {
    it(`unreadable: ${name}`, () => {
      expect(parseBackupStatus(value)).toEqual({ kind: "unreadable" });
    });
  }
});

describe("BACKUP_FAILURE_SENTENCES (UI-SPEC Copywriting)", () => {
  it("maps each category to its fixed sentence", () => {
    expect(BACKUP_FAILURE_SENTENCES).toEqual({
      dump: "The database dump failed.",
      archive: "The uploads archive could not be written.",
      verification: "A file referenced by the database was missing from the archive.",
      storage: "The backup volume could not be written or is full.",
      unknown: "The run stopped with an unexpected error.",
    });
    expect(Object.keys(BACKUP_FAILURE_SENTENCES).sort()).toEqual(
      [...BACKUP_FAILURE_CATEGORIES].sort(),
    );
  });

  it("the categories are exactly the ones lib.sh status_args_ok accepts", () => {
    const lib = readFileSync(path.resolve(__dirname, "../../scripts/backup/lib.sh"), "utf8");
    const match = /status_args_ok\(\) \{[\s\S]*?case \$3 in\n\s+([^)]+)\)/.exec(lib);
    expect(match).not.toBeNull();
    const accepted = (match?.[1] ?? "")
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part !== "-");
    expect(accepted.sort()).toEqual([...BACKUP_FAILURE_CATEGORIES].sort());
  });

  it("anything else gets the generic sentence", () => {
    for (const value of ["", "DUMP", "network", "toString", "__proto__", "constructor"]) {
      expect(backupFailureSentence(value)).toBe("The run stopped with an unexpected error.");
    }
    expect(backupFailureSentence("dump")).toBe("The database dump failed.");
  });
});

describe("formatBackupTime", () => {
  it("prints the UTC time with day, short month, year and 24-hour time", () => {
    expect(formatBackupTime("2026-11-08T02:00:41.123Z")).toBe("8 Nov 2026, 02:00 UTC");
    expect(formatBackupTime("2026-01-31T23:59:59.999Z")).toBe("31 Jan 2026, 23:59 UTC");
  });
});
