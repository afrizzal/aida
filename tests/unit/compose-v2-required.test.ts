// Phase 9 review d-WR-2 (fix batch F2): Docker Compose v2 is required. The compose file nests an
// interpolation in a default value and restore.sh reads `config --format json`; Compose v1
// (`docker-compose` 1.x) supports neither. scripts/backup.sh and scripts/restore.sh always call
// `docker compose` and ignore a legacy COMPOSE_CMD, and the operator docs no longer offer it.
// The scripts run against a small fake `docker` on PATH; no Docker daemon is reached.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake `docker` that logs its arguments and reports `db` as running; no `docker-compose`. */
function fakeDocker(): { dir: string; log: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aida-compose-v2-"));
  dirs.push(dir);
  const log = path.join(dir, "docker.log");
  const script = [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >>"${log}"`,
    'if [ "$1 $2" = "compose ps" ]; then echo db; fi',
    "exit 0",
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "docker"), script);
  chmodSync(path.join(dir, "docker"), 0o755);
  return { dir, log };
}

describe("Compose v2 is required (d-WR-2)", () => {
  it("scripts/backup.sh calls `docker compose` even when COMPOSE_CMD names the legacy binary", () => {
    const fake = fakeDocker();
    const run = spawnSync("/bin/sh", [path.join(ROOT, "scripts", "backup.sh")], {
      cwd: ROOT,
      env: {
        PATH: `${fake.dir}:/usr/bin:/bin`,
        HOME: os.tmpdir(),
        LC_ALL: "C",
        COMPOSE_CMD: "docker-compose",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const calls = readFileSync(fake.log, "utf8").trim().split("\n");
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call.startsWith("compose ")).toBe(true);
    expect(run.stdout).not.toContain("docker-compose");
  });

  it("neither script nor the backup and restore docs offer the legacy binary, and the docs state the requirement", () => {
    const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
    // Naming the legacy binary to say it is unsupported is fine; offering or running it is not.
    const legacy = /COMPOSE_CMD|^\s*docker-compose\s/m;
    for (const file of [
      "scripts/backup.sh",
      "scripts/restore.sh",
      "docs/OPERATIONS.md",
      "website/src/content/docs/operations/backup-and-restore.md",
    ]) {
      expect(read(file), file).not.toMatch(legacy);
    }
    for (const file of [
      "docs/OPERATIONS.md",
      "README.md",
      "website/src/content/docs/getting-started/quick-start.md",
    ]) {
      expect(read(file), file).toContain("Docker Compose v2");
    }
  });
});
