// Phase 9 plan 09-10 (AIDA-33, D-05; reviews P5, Q3; checker iteration 1): the operator wrapper
// scripts/restore.sh with a fake `docker` first on PATH (tests/unit/fixtures/restore/docker). The
// fake records every call and answers lock, lease, target-touched and set-script steps from
// environment variables; any other call exits 97. Nothing here reaches a Docker daemon.
//
// Outcome rules under test: success starts backup, app and worker exactly once; a failure before
// `target-touched` exists (validation) starts them again and says nothing was changed; a failure
// or a signal once `target-touched` exists leaves them stopped and names the step and the docs;
// every path that took the restore lock releases it and the lease; a held lock or a running
// backup refuses before anything is stopped; a missing volume refuses before anything is stopped.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts", "restore.sh");
const FAKE_DIR = path.join(ROOT, "tests", "unit", "fixtures", "restore");
const SET_ID = "20261112T020001Z-a1b2c3";
const HOLDER = "restore-0123456789abcdef0123456789abcdef";
const OTHER = "restore-ffffffffffffffffffffffffffffffff";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function logFile(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aida-restore-script-"));
  dirs.push(dir);
  return path.join(dir, "docker.log");
}

/** Only the fake's directory and the system tools: no real docker can be found. */
function env(log: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: `${FAKE_DIR}:/usr/bin:/bin`,
    HOME: os.tmpdir(),
    LC_ALL: "C",
    FAKE_DOCKER_LOG: log,
    ...extra,
  };
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
}

function readCalls(log: string): string[] {
  try {
    return readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  } catch {
    return [];
  }
}

function restore(args: string[], extra: Record<string, string> = {}, input = ""): Run {
  const log = logFile();
  const run = spawnSync("/bin/bash", [SCRIPT, ...args], {
    cwd: ROOT,
    env: env(log, extra),
    input,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, calls: readCalls(log) };
}

/** Each call reduced to the step it is, in order. */
function steps(calls: string[]): string[] {
  return calls.map((call) => {
    if (call === "compose config --format json") return "config";
    if (call.startsWith("volume inspect ")) return `inspect ${call.split(" ")[2]}`;
    if (call === "compose stop backup app worker") return "stop";
    if (call === "compose start backup app worker") return "start";
    if (call.startsWith("compose exec -T app wget")) return "health";
    if (call.startsWith("compose run ")) {
      if (call.includes("/opt/aida-backup/aida-restore-set.sh")) return "set";
      for (const name of ["lock", "lease", "touched", "release", "break"]) {
        if (call.includes(` aida-restore-${name} `) || call.endsWith(` aida-restore-${name}`))
          return name;
      }
    }
    return `other: ${call}`;
  });
}

function count(list: string[], item: string): number {
  return list.filter((x) => x === item).length;
}

/** No logged call removes a volume, runs `down`, builds, or reaches the fake's catch-all. */
function expectNoDestructiveCall(run: Run): void {
  for (const call of run.calls) {
    expect(call).not.toMatch(/\bcompose (down|rm|build)\b/);
    expect(call).not.toMatch(/\bvolume (rm|remove|prune)\b/);
    expect(call).not.toMatch(/\bprune\b/);
  }
  expect(steps(run.calls).filter((s) => s.startsWith("other"))).toEqual([]);
  expect(run.stderr).not.toContain("fake docker: unexpected call");
}

/** The exact set-script call (D-05 key link: uploads volume read-write at /restore/uploads). */
const SET_CALL = `compose run --rm --no-deps -T --entrypoint sh -e RESTORE_HOLDER=${HOLDER} -e UPLOADS_DIR=/restore/uploads -v aida_uploads_data:/restore/uploads backup /opt/aida-backup/aida-restore-set.sh /backups/${SET_ID}`;

describe("scripts/restore.sh: outcome rules", () => {
  it("success: stop before the set script, start exactly once after it, lock and lease released, exit 0", () => {
    const run = restore([SET_ID, "--yes"]);
    expect(run.status, run.stderr).toBe(0);
    expect(steps(run.calls)).toEqual([
      "config",
      "inspect aida_uploads_data",
      "inspect aida_backups_data",
      "lock",
      "lease",
      "stop",
      "set",
      "release",
      "start",
      "health",
    ]);
    expect(run.calls).toContain(SET_CALL);
    const release = run.calls[steps(run.calls).indexOf("release")] as string;
    expect(release).toContain(HOLDER);
    expect(run.calls[steps(run.calls).indexOf("lease")]).toContain(HOLDER);
    expect(run.calls[steps(run.calls).indexOf("lock")]).toContain(SET_ID);
    expectNoDestructiveCall(run);
  });

  it("validation failure (exit 4, no target-touched): lock and lease released, services started again once, says nothing was changed", () => {
    const run = restore([SET_ID, "--yes"], { FAKE_SET_EXIT: "4" });
    expect(run.status).toBe(4);
    const s = steps(run.calls);
    expect(s.slice(0, 7)).toEqual([
      "config",
      "inspect aida_uploads_data",
      "inspect aida_backups_data",
      "lock",
      "lease",
      "stop",
      "set",
    ]);
    expect(s.slice(7)).toEqual(["touched", "release", "start"]);
    expect(count(s, "start")).toBe(1);
    expect(run.stderr).toContain("nothing was changed");
    expectNoDestructiveCall(run);
  });

  for (const [code, touched, step] of [
    ["7", "database", "database"],
    ["8", "uploads", "uploads"],
  ] as const) {
    it(`${step}-step failure (exit ${code}, target-touched = ${touched}): lock and lease released, nothing started, the message names the step and the docs`, () => {
      const run = restore([SET_ID, "--yes"], { FAKE_SET_EXIT: code, FAKE_TOUCHED: touched });
      expect(run.status).toBe(Number(code));
      const s = steps(run.calls);
      expect(s.slice(5)).toEqual(["stop", "set", "touched", "release"]);
      expect(count(s, "start")).toBe(0);
      expect(run.stderr).toContain(`${step} step`);
      expect(run.stderr).toContain("left stopped");
      expect(run.stderr).toContain("docs/OPERATIONS.md, Restore");
      expectNoDestructiveCall(run);
    });
  }

  it("TERM while the set script hangs after target-touched: lock and lease released, nothing started, non-zero exit", async () => {
    const log = logFile();
    const child = spawn("/bin/bash", [SCRIPT, SET_ID, "--yes"], {
      cwd: ROOT,
      env: env(log, { FAKE_SET_MODE: "hang", FAKE_TOUCHED: "database" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c)));
    const deadline = Date.now() + 15_000;
    while (!steps(readCalls(log)).includes("set")) {
      if (Date.now() > deadline) throw new Error("the set script step never started");
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 300));
    child.kill("SIGTERM");
    const code = await exited;
    const calls = readCalls(log);
    const s = steps(calls);
    expect(code).not.toBe(0);
    expect(code).not.toBeNull();
    expect(s.slice(s.indexOf("set"))).toEqual(["set", "touched", "release"]);
    expect(count(s, "start")).toBe(0);
    expect(stderr).toContain("database step");
    expect(stderr).toContain("left stopped");
    expect(stderr).toContain("docs/OPERATIONS.md, Restore");
    expectNoDestructiveCall({ status: code, stdout: "", stderr, calls });
  }, 30_000);
});

describe("scripts/restore.sh: refusals before anything is stopped", () => {
  it("restore lock held by another holder: exit 3 with the holder and the heartbeat age, no stop and no start", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_LOCK_EXIT: "3",
      FAKE_LOCK_OUTPUT: `held-by=${OTHER} age=42`,
    });
    expect(run.status).toBe(3);
    expect(steps(run.calls)).toEqual([
      "config",
      "inspect aida_uploads_data",
      "inspect aida_backups_data",
      "lock",
    ]);
    expect(run.stderr).toContain(OTHER);
    expect(run.stderr).toContain("42");
    expectNoDestructiveCall(run);
  });

  it("lease held by a running backup: the lock is released, exit 3, no stop and no start", () => {
    const run = restore([SET_ID, "--yes"], { FAKE_LEASE_EXIT: "3" });
    expect(run.status).toBe(3);
    const s = steps(run.calls);
    expect(s.slice(3)).toEqual(["lock", "lease", "release"]);
    expect(count(s, "stop")).toBe(0);
    expect(count(s, "start")).toBe(0);
    expect(run.stderr).toContain("a backup is running; retry after it finishes");
    expectNoDestructiveCall(run);
  });

  for (const volume of ["aida_uploads_data", "aida_backups_data"]) {
    it(`missing volume ${volume}: exit 6, nothing locked or stopped`, () => {
      const run = restore([SET_ID, "--yes"], { FAKE_MISSING_VOLUMES: volume });
      expect(run.status).toBe(6);
      const s = steps(run.calls);
      expect(s.filter((x) => !x.startsWith("inspect") && x !== "config")).toEqual([]);
      expect(run.stderr).toContain(volume);
      expectNoDestructiveCall(run);
    });
  }

  it("no --yes and stdin other than restore: aborted, nothing called after the confirmation", () => {
    const run = restore([SET_ID], {}, "no\n");
    expect(run.status).toBe(1);
    expect(run.calls).toEqual([]);
    expect(run.stdout).toContain("Aborted");
  });

  it("no --yes and stdin restore: the restore proceeds", () => {
    const run = restore([SET_ID], {}, "restore\n");
    expect(run.status, run.stderr).toBe(0);
    expect(count(steps(run.calls), "start")).toBe(1);
  });

  it("an argument that is not a set id: usage error, no docker call", () => {
    for (const bad of ["../etc", "20261112T020001Z-a1b2c", "latest", ""]) {
      const run = restore([bad, "--yes"]);
      expect(run.status, bad).toBe(2);
      expect(run.calls).toEqual([]);
    }
  });
});

describe("scripts/restore.sh --break-stale-lock (Q3: explicit, never automatic)", () => {
  it("matching holder with a heartbeat older than 900 s: removed, exit 0, nothing stopped", () => {
    const run = restore(["--break-stale-lock", HOLDER]);
    expect(run.status, run.stderr).toBe(0);
    expect(steps(run.calls)).toEqual(["break"]);
    expect(run.calls[0]).toContain(HOLDER);
    expect(run.calls[0]).toContain("900");
    expectNoDestructiveCall(run);
  });

  for (const [code, output, reason] of [
    ["1", "holder none heartbeat unknown", "no restore lock"],
    ["2", `holder ${OTHER} heartbeat 2000s ago`, "held by another holder"],
    ["3", `holder ${HOLDER} heartbeat 12s ago`, "not older than 900"],
  ] as const) {
    it(`refused (${reason}): exit 3 with the reason`, () => {
      const run = restore(["--break-stale-lock", HOLDER], {
        FAKE_BREAK_EXIT: code,
        FAKE_BREAK_OUTPUT: output,
      });
      expect(run.status).toBe(3);
      expect(run.stderr).toContain(reason);
      expect(steps(run.calls)).toEqual(["break"]);
      expectNoDestructiveCall(run);
    });
  }

  it("a value that is not a restore holder: usage error, no docker call", () => {
    const run = restore(["--break-stale-lock", "restore-xyz"]);
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
  });
});

describe("the fake docker fixture", () => {
  it("is executable and refuses an unexpected call with exit 97", () => {
    expect(statSync(path.join(FAKE_DIR, "docker")).mode & 0o111).not.toBe(0);
    const log = logFile();
    const run = spawnSync(path.join(FAKE_DIR, "docker"), ["compose", "down", "-v"], {
      env: env(log),
      encoding: "utf8",
    });
    expect(run.status).toBe(97);
    expect(readCalls(log)).toEqual(["compose down -v"]);
  });
});
