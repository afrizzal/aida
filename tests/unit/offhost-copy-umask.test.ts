// Phase 9 review d-WR-3 (fix batch F2): the documented off-host copy of a backup set writes the
// tar through a shell redirect on the host. It must run under `umask 077`, so the file (a full
// database dump and every attachment) is readable by its owner only, whatever the operator's
// umask. The test runs the exact documented command line, with `<setId>` filled in, under umask
// 022 against a fake `docker` that writes a few bytes; no Docker daemon is reached.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SET_ID = "20261112T020001Z-a1b2c3";
const DOCS = ["docs/OPERATIONS.md", "website/src/content/docs/operations/backup-and-restore.md"];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The one documented command line that writes aida-backup-<setId>.tar on the host. */
function copyCommand(file: string): string {
  const lines = readFileSync(path.join(ROOT, file), "utf8")
    .split("\n")
    .filter((l) => l.includes("-cf - <setId>") && l.includes("> aida-backup-<setId>.tar"));
  expect(lines, file).toHaveLength(1);
  return (lines[0] as string).trim();
}

describe("off-host copy of a set (d-WR-3)", () => {
  for (const file of DOCS) {
    it(`${file}: the documented copy creates a 0600 file under umask 022`, () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "aida-offhost-copy-"));
      dirs.push(dir);
      const bin = path.join(dir, "bin");
      const work = path.join(dir, "work");
      for (const d of [bin, work]) spawnSync("mkdir", [d]);
      writeFileSync(path.join(bin, "docker"), "#!/bin/sh\nprintf 'tar-bytes'\nexit 0\n");
      chmodSync(path.join(bin, "docker"), 0o755);
      const command = copyCommand(file).replaceAll("<setId>", SET_ID);
      const run = spawnSync("/bin/bash", ["-c", `umask 022; ${command}`], {
        cwd: work,
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: os.tmpdir(), LC_ALL: "C" },
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(run.status, run.stderr).toBe(0);
      const out = path.join(work, `aida-backup-${SET_ID}.tar`);
      expect(readFileSync(out, "utf8")).toBe("tar-bytes");
      expect((statSync(out).mode & 0o777).toString(8)).toBe("600");
    });
  }
});
