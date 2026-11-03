// Phase 9 plan 09-04: the pure parts of the backup fence contract (U-12). The lock and the lease
// themselves are proven on real Postgres in tests/integration/file-fence.test.ts.
import { describe, expect, it } from "vitest";
import {
  BACKUP_FENCE_APPLICATION_NAME,
  BACKUP_LEASE_ACTIVE_SQL,
  BACKUP_LEASE_KEY,
  DELETE_FENCE_APPLICATION_NAME,
  FILE_FENCE_KEY_SQL,
  FILE_FENCE_KEY_TEXT,
  parseLease,
} from "@/lib/storage/file-fence";
import { UPLOADS_MARKER_NAME, UPLOADS_VOLUME_ID_KEY } from "@/lib/storage/uploads-volume";

describe("parseLease", () => {
  it("accepts a JSON object with a holder and an ISO UTC expiresAt", () => {
    expect(
      parseLease('{"holder":"set-20261112T0700Z","expiresAt":"2026-11-12T07:15:00.000Z"}'),
    ).toEqual({
      holder: "set-20261112T0700Z",
      expiresAt: new Date("2026-11-12T07:15:00.000Z"),
    });
  });

  it("accepts an ISO timestamp without a fraction and with a numeric offset", () => {
    expect(parseLease('{"holder":"h","expiresAt":"2026-11-12T14:15:00+07:00"}')).toEqual({
      holder: "h",
      expiresAt: new Date("2026-11-12T07:15:00.000Z"),
    });
  });

  it("accepts an already parsed object", () => {
    expect(parseLease({ holder: "h", expiresAt: "2026-11-12T07:15:00Z" })?.holder).toBe("h");
  });

  it("rejects malformed values", () => {
    for (const value of [
      "",
      "not json",
      "{",
      "null",
      "[]",
      '["2026-11-12T07:15:00Z"]',
      '"2026-11-12T07:15:00Z"',
      "42",
      null,
      undefined,
      42,
    ]) {
      expect(parseLease(value)).toBeNull();
    }
  });

  it("rejects a lease without expiresAt, or with a non-string expiresAt", () => {
    expect(parseLease('{"holder":"h"}')).toBeNull();
    expect(parseLease('{"holder":"h","expiresAt":null}')).toBeNull();
    expect(parseLease('{"holder":"h","expiresAt":1794000000000}')).toBeNull();
  });

  it("rejects a lease without a holder", () => {
    expect(parseLease('{"expiresAt":"2026-11-12T07:15:00Z"}')).toBeNull();
    expect(parseLease('{"holder":"","expiresAt":"2026-11-12T07:15:00Z"}')).toBeNull();
    expect(parseLease('{"holder":7,"expiresAt":"2026-11-12T07:15:00Z"}')).toBeNull();
  });

  it("rejects an expiresAt that is not an ISO timestamp", () => {
    for (const expiresAt of [
      "tomorrow",
      "2026-11-12",
      "2026-11-12 07:15:00Z",
      "2026-11-12T07:15Z",
      "2026-11-12T07:15:00",
      "12/11/2026 07:15:00",
      "2026-13-01T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-11-12T24:00:00Z",
      "Thu, 12 Nov 2026 07:15:00 GMT",
    ]) {
      expect(parseLease(JSON.stringify({ holder: "h", expiresAt }))).toBeNull();
    }
  });
});

describe("fence constants", () => {
  it("the lock key expression carries the shared key text (plan 09-06 uses the same)", () => {
    expect(FILE_FENCE_KEY_TEXT).toBe("aida:file-fence");
    expect(FILE_FENCE_KEY_SQL).toBe("hashtextextended('aida:file-fence', 0)");
    expect(FILE_FENCE_KEY_SQL).toContain(FILE_FENCE_KEY_TEXT);
  });

  it("the lease check reads the backup lease key by the database clock", () => {
    expect(BACKUP_LEASE_KEY).toBe("backup:lease");
    expect(BACKUP_LEASE_ACTIVE_SQL).toContain(`'${BACKUP_LEASE_KEY}'`);
    expect(BACKUP_LEASE_ACTIVE_SQL).toContain("IS JSON OBJECT");
    expect(BACKUP_LEASE_ACTIVE_SQL).toContain("now()");
    expect(BACKUP_LEASE_ACTIVE_SQL).toMatch(/^SELECT /);
  });

  it("session names and volume identity names", () => {
    expect(DELETE_FENCE_APPLICATION_NAME).toBe("aida-delete-fence");
    expect(BACKUP_FENCE_APPLICATION_NAME).toBe("aida-backup-fence");
    expect(UPLOADS_VOLUME_ID_KEY).toBe("uploads:volume-id");
    expect(UPLOADS_MARKER_NAME).toBe(".aida-uploads-volume");
  });
});
