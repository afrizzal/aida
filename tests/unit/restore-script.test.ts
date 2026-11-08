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
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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
    if (call === "migrate-returned") return "migrate-returned";
    if (call.startsWith("volume inspect ")) return `inspect ${call.split(" ")[2]}`;
    if (call === "compose stop backup app worker") return "stop";
    if (call.startsWith("stop -t 30 ")) return "ctr-stop";
    if (call.startsWith("rm -f ")) return "ctr-rm";
    if (call.startsWith("ps -a ")) return "ctr-ps";
    if (call === "compose start backup app worker") return "start";
    if (call.startsWith("compose exec -T app wget")) return "health";
    if (call.startsWith("compose run ")) {
      if (call.includes("/opt/aida-backup/aida-restore-set.sh --check-schema")) return "check";
      if (call.includes("/opt/aida-backup/aida-restore-set.sh --validate-only")) return "validate";
      if (
        call === "compose run --rm --no-deps -T migrate" ||
        /^compose run --rm --no-deps -T --name aida-restore-[0-9a-f]{32}-migrate migrate$/.test(
          call,
        )
      )
        return "migrate";
      if (call.includes("/opt/aida-backup/aida-restore-set.sh")) return "set";
      for (const name of ["lock", "lease", "touched", "release", "break", "renew"]) {
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

/** K150: the checkout's prisma/migrations directory names, as the wrapper passes them. */
const RELEASE = readdirSync(path.join(ROOT, "prisma", "migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .join(" ");

/** The exact set-script call (D-05 key link: uploads volume read-write at /restore/uploads). */
const SET_CALL = `compose run --rm --no-deps -T --name aida-${HOLDER} --entrypoint sh -e RESTORE_HOLDER=${HOLDER} -e RESTORE_RELEASE_MIGRATIONS=${RELEASE} -e UPLOADS_DIR=/restore/uploads -v aida_uploads_data:/restore/uploads backup /opt/aida-backup/aida-restore-set.sh /backups/${SET_ID}`;

/** The read-only migration check (K142, K150), run before anything is stopped. */
const CHECK_CALL = `compose run --rm --no-deps -T --entrypoint sh -e RESTORE_HOLDER=${HOLDER} -e RESTORE_RELEASE_MIGRATIONS=${RELEASE} backup /opt/aida-backup/aida-restore-set.sh --check-schema /backups/${SET_ID}`;

/** The validate-only run (K149): the whole set, no target write, nothing stopped. */
const VALIDATE_CALL = `compose run --rm --no-deps -T --entrypoint sh -e RESTORE_HOLDER=${HOLDER} -e RESTORE_RELEASE_MIGRATIONS=${RELEASE} backup /opt/aida-backup/aida-restore-set.sh --validate-only /backups/${SET_ID}`;

const OLDER_LINE =
  "[restore] set migrations: older than this release; migrate deploy runs before app and worker start";

describe("scripts/restore.sh: outcome rules", () => {
  it("success: stop before the set script, start exactly once after it, lock and lease released, exit 0", () => {
    const run = restore([SET_ID, "--yes"]);
    expect(run.status, run.stderr).toBe(0);
    expect(steps(run.calls)).toEqual([
      "config",
      "inspect aida_uploads_data",
      "inspect aida_backups_data",
      "lock",
      "check",
      "lease",
      "stop",
      "set",
      "release",
      "start",
      "health",
    ]);
    expect(run.calls).toContain(SET_CALL);
    expect(run.calls).toContain(CHECK_CALL);
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
    expect(s.slice(0, 8)).toEqual([
      "config",
      "inspect aida_uploads_data",
      "inspect aida_backups_data",
      "lock",
      "check",
      "lease",
      "stop",
      "set",
    ]);
    expect(s.slice(8)).toEqual(["ctr-stop", "ctr-rm", "ctr-ps", "touched", "release", "start"]);
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
      expect(s.slice(6)).toEqual([
        "stop",
        "set",
        "ctr-stop",
        "ctr-rm",
        "ctr-ps",
        "touched",
        "release",
      ]);
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
    expect(s.slice(s.indexOf("set"))).toEqual([
      "set",
      "ctr-stop",
      "ctr-rm",
      "ctr-ps",
      "touched",
      "release",
    ]);
    expect(count(s, "start")).toBe(0);
    expect(stderr).toContain("database step");
    expect(stderr).toContain("left stopped");
    expect(stderr).toContain("docs/OPERATIONS.md, Restore");
    expectNoDestructiveCall({ status: code, stdout: "", stderr, calls });
  }, 30_000);
});

/** The exact calls on the one-off restore container (d-WR-1). */
const CONTAINER = `aida-${HOLDER}`;
const CONTAINER_CALLS = {
  stop: `stop -t 30 ${CONTAINER}`,
  rm: `rm -f ${CONTAINER}`,
  ps: `ps -a --filter name=^/${CONTAINER}$ --format {{.Names}}`,
};

describe("scripts/restore.sh: the restore container is gone before the lock is released or anything starts (d-WR-1)", () => {
  it("validation failure while the container is still listed by two polls: stopped and removed by its exact name, services started only after the poll that no longer lists it", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_SET_EXIT: "4",
      FAKE_CONTAINER_LISTED: "2",
      RESTORE_CONTAINER_WAIT_SECONDS: "10",
    });
    expect(run.status, run.stderr).toBe(4);
    const s = steps(run.calls);
    expect(s.slice(s.indexOf("set"))).toEqual([
      "set",
      "ctr-stop",
      "ctr-rm",
      "ctr-ps",
      "ctr-ps",
      "ctr-ps",
      "touched",
      "release",
      "start",
    ]);
    const tail = run.calls.slice(s.indexOf("set") + 1, s.indexOf("set") + 6);
    expect(tail).toEqual([
      CONTAINER_CALLS.stop,
      CONTAINER_CALLS.rm,
      CONTAINER_CALLS.ps,
      CONTAINER_CALLS.ps,
      CONTAINER_CALLS.ps,
    ]);
    expect(s.indexOf("release")).toBeGreaterThan(s.lastIndexOf("ctr-ps"));
    expect(s.indexOf("start")).toBeGreaterThan(s.lastIndexOf("ctr-ps"));
    expect(run.stderr).toContain("nothing was changed");
    expectNoDestructiveCall(run);
  });

  it("TERM while the set script hangs and the container outlives its client for two polls: nothing starts before the container is gone", async () => {
    const log = logFile();
    const child = spawn("/bin/bash", [SCRIPT, SET_ID, "--yes"], {
      cwd: ROOT,
      env: env(log, {
        FAKE_SET_MODE: "hang",
        FAKE_CONTAINER_LISTED: "2",
        RESTORE_CONTAINER_WAIT_SECONDS: "10",
      }),
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
    expect(code).toBe(143);
    expect(s.slice(s.indexOf("set"))).toEqual([
      "set",
      "ctr-stop",
      "ctr-rm",
      "ctr-ps",
      "ctr-ps",
      "ctr-ps",
      "touched",
      "release",
      "start",
    ]);
    expect(s.indexOf("start")).toBeGreaterThan(s.lastIndexOf("ctr-ps"));
    expectNoDestructiveCall({ status: code, stdout: "", stderr, calls });
  }, 30_000);

  it("container still listed when the wait ends: the lock is kept, nothing is started, the message names the container", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_SET_EXIT: "4",
      FAKE_CONTAINER_LISTED: "stuck",
      RESTORE_CONTAINER_WAIT_SECONDS: "2",
    });
    expect(run.status).toBe(4);
    const s = steps(run.calls);
    expect(s.slice(s.indexOf("set"), s.indexOf("set") + 3)).toEqual(["set", "ctr-stop", "ctr-rm"]);
    expect(count(s, "ctr-ps")).toBe(3);
    expect(count(s, "touched")).toBe(0);
    expect(count(s, "release")).toBe(0);
    expect(count(s, "start")).toBe(0);
    expect(run.stderr).toContain(`The restore container ${CONTAINER} is still listed`);
    expect(run.stderr).toContain(`the restore lock ${HOLDER} was kept`);
    expectNoDestructiveCall(run);
  });

  it("a wait setting outside 1 to 600: usage error, no docker call", () => {
    const run = restore([SET_ID, "--yes"], { RESTORE_CONTAINER_WAIT_SECONDS: "0" });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
  });
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
    expect(s.slice(3)).toEqual(["lock", "check", "lease", "release"]);
    expect(count(s, "stop")).toBe(0);
    expect(count(s, "start")).toBe(0);
    expect(run.stderr).toContain("a backup is running; retry after it finishes");
    expectNoDestructiveCall(run);
  });

  for (const [code, says] of [
    ["9", "Refused by the migration checks for set"],
    ["6", "The migration check of set"],
  ] as const) {
    it(`migration check exit ${code} (K142, K152): no lease was taken, the lock is released, exit ${code}, no stop, no set run and no start`, () => {
      const run = restore([SET_ID, "--yes"], { FAKE_CHECK_EXIT: code });
      expect(run.status).toBe(Number(code));
      const s = steps(run.calls);
      expect(s.slice(3)).toEqual(["lock", "check", "release"]);
      expect(run.calls[s.indexOf("release")]).not.toContain("lease_release");
      expect(run.calls[s.indexOf("check")]).toBe(CHECK_CALL);
      expect(count(s, "stop")).toBe(0);
      expect(count(s, "set")).toBe(0);
      expect(count(s, "start")).toBe(0);
      expect(run.stderr).toContain(says);
      expect(run.stderr).toContain("Nothing was stopped or changed");
      expectNoDestructiveCall(run);
    });
  }

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

describe("scripts/restore.sh: release migrations and validate-only (K149, K150)", () => {
  it("the release list is this checkout's prisma/migrations and is passed to the check and the set script", () => {
    expect(RELEASE.split(" ").length).toBeGreaterThan(0);
    const run = restore([SET_ID, "--yes"]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.calls).toContain(CHECK_CALL);
    expect(run.calls).toContain(SET_CALL);
    // An equal set: no migrate run.
    expect(count(steps(run.calls), "migrate")).toBe(0);
    expectNoDestructiveCall(run);
  });

  it("an older set: migrate deploy runs after the set script and before the release, backup, app and worker start", () => {
    const run = restore([SET_ID, "--yes"], { FAKE_CHECK_OUTPUT: OLDER_LINE });
    expect(run.status, run.stderr).toBe(0);
    expect(steps(run.calls).slice(5)).toEqual([
      "lease",
      "stop",
      "set",
      "lease",
      "migrate",
      "migrate-returned",
      "release",
      "start",
      "health",
    ]);
    expect(run.stdout).toContain(OLDER_LINE);
    expectNoDestructiveCall(run);
  });

  it("an older set whose migrate deploy fails: exit 1, nothing started, the message says so", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_CHECK_OUTPUT: OLDER_LINE,
      FAKE_MIGRATE_EXIT: "1",
    });
    expect(run.status).toBe(1);
    const s = steps(run.calls);
    expect(s.slice(s.indexOf("set"))).toEqual([
      "set",
      "lease",
      "migrate",
      "migrate-returned",
      "release",
    ]);
    expect(count(s, "start")).toBe(0);
    expect(run.stderr).toContain("migrate deploy failed after the restore");
    expect(run.stderr).toContain("backup, app and worker were NOT started");
    expectNoDestructiveCall(run);
  });

  it("--validate-only: lock, the validate-only run and the release; nothing stopped, started or confirmed", () => {
    const run = restore([SET_ID, "--validate-only"]);
    expect(run.status, run.stderr).toBe(0);
    expect(steps(run.calls)).toEqual([
      "config",
      "inspect aida_uploads_data",
      "inspect aida_backups_data",
      "lock",
      "validate",
      "release",
    ]);
    expect(run.calls).toContain(VALIDATE_CALL);
    expect(run.calls[steps(run.calls).indexOf("release")]).not.toContain("lease_release");
    expect(run.stdout).toContain("is valid and can be restored by this release");
    expectNoDestructiveCall(run);
  });

  for (const [code, says] of [
    ["4", "failed validation (exit 4)"],
    ["9", "has migrations that this release does not contain"],
  ] as const) {
    it(`--validate-only exit ${code}: the same exit, no lease taken, the lock released, nothing stopped`, () => {
      const run = restore([SET_ID, "--validate-only"], { FAKE_VALIDATE_EXIT: code });
      expect(run.status).toBe(Number(code));
      const s = steps(run.calls);
      expect(s.slice(3)).toEqual(["lock", "validate", "release"]);
      expect(run.stderr).toContain(says);
      expectNoDestructiveCall(run);
    });
  }
});

/** K152: the check's line for a truly empty target (aida-restore-set.sh check_target). */
const EMPTY_LINE = "[restore] target database: empty";

describe("scripts/restore.sh: nothing is written to the target before the schema check (K152)", () => {
  it("the read-only check runs before the lease, the first database write, and a refusal writes no lease", () => {
    const ok = restore([SET_ID, "--yes"]);
    expect(ok.status, ok.stderr).toBe(0);
    const s = steps(ok.calls);
    expect(s.indexOf("check")).toBeGreaterThan(s.indexOf("lock"));
    expect(s.indexOf("lease")).toBeGreaterThan(s.indexOf("check"));
    expect(ok.calls[s.indexOf("release")]).toContain("lease_release");

    const refused = restore([SET_ID, "--yes"], { FAKE_CHECK_EXIT: "9" });
    expect(refused.status).toBe(9);
    expect(count(steps(refused.calls), "lease")).toBe(0);
    expectNoDestructiveCall(refused);
  });

  it("a truly empty target: no lease is taken or released (it has no SystemSetting table), the restore runs under the restore lock alone and starts the services", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_CHECK_OUTPUT: `${EMPTY_LINE}\n[restore] set migrations: equal to this release`,
    });
    expect(run.status, run.stderr).toBe(0);
    const s = steps(run.calls);
    expect(s.slice(3)).toEqual(["lock", "check", "stop", "set", "release", "start", "health"]);
    expect(run.calls[s.indexOf("release")]).not.toContain("lease_release");
    expect(run.calls[s.indexOf("release")]).toContain("restore_lock_release");
    expect(run.stdout).toContain(
      "the restore lock alone coordinates this restore (no lease is written)",
    );
    expect(run.calls).toContain(SET_CALL);
    expectNoDestructiveCall(run);
  });

  it("a truly empty target whose set script fails validation: the lock alone is released and the services start again", () => {
    const run = restore([SET_ID, "--yes"], { FAKE_CHECK_OUTPUT: EMPTY_LINE, FAKE_SET_EXIT: "4" });
    expect(run.status).toBe(4);
    const s = steps(run.calls);
    expect(count(s, "lease")).toBe(0);
    expect(run.calls[s.indexOf("release")]).not.toContain("lease_release");
    expect(count(s, "start")).toBe(1);
    expectNoDestructiveCall(run);
  });

  it("--validate-only takes no lease and runs no lease step: it writes nothing to the database", () => {
    const cases: Record<string, string>[] = [
      {},
      { FAKE_VALIDATE_EXIT: "4" },
      { FAKE_VALIDATE_EXIT: "9" },
    ];
    for (const extra of cases) {
      const run = restore([SET_ID, "--validate-only"], extra);
      const s = steps(run.calls);
      expect(count(s, "lease"), JSON.stringify(extra)).toBe(0);
      expect(run.calls[s.indexOf("release")]).not.toContain("lease_release");
      expect(count(s, "stop") + count(s, "start") + count(s, "set") + count(s, "check")).toBe(0);
      expectNoDestructiveCall(run);
    }
  });
});

describe("scripts/restore.sh: the lock and the lease are held until migrate deploy returns (K154)", () => {
  it("an older set: the lease is taken again on the restored database, and nothing is released or started before the migrate call returns", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_CHECK_OUTPUT: OLDER_LINE,
      FAKE_MIGRATE_SLEEP: "1",
    });
    expect(run.status, run.stderr).toBe(0);
    const s = steps(run.calls);
    const returned = s.indexOf("migrate-returned");
    expect(returned).toBeGreaterThan(s.indexOf("migrate"));
    expect(s.indexOf("release")).toBeGreaterThan(returned);
    expect(s.indexOf("start")).toBeGreaterThan(returned);
    expect(s.lastIndexOf("lease")).toBeGreaterThan(s.indexOf("set"));
    expect(s.lastIndexOf("lease")).toBeLessThan(s.indexOf("migrate"));
    expect(run.calls[s.indexOf("release")]).toContain("lease_release");
    expectNoDestructiveCall(run);
  });

  it("an empty target with an older set: the restore holds no lease before, takes it on the restored database for migrate, and releases it after", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_CHECK_OUTPUT: `${EMPTY_LINE}\n${OLDER_LINE}`,
    });
    expect(run.status, run.stderr).toBe(0);
    const s = steps(run.calls);
    expect(s.slice(3)).toEqual([
      "lock",
      "check",
      "stop",
      "set",
      "lease",
      "migrate",
      "migrate-returned",
      "release",
      "start",
      "health",
    ]);
    expect(run.calls[s.indexOf("release")]).toContain("lease_release");
    expectNoDestructiveCall(run);
  });

  it("a failed migrate: exit 1, nothing started, the lock and the lease released by the trap only after the migrate call returned", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_CHECK_OUTPUT: OLDER_LINE,
      FAKE_MIGRATE_EXIT: "1",
      FAKE_MIGRATE_SLEEP: "1",
    });
    expect(run.status).toBe(1);
    const s = steps(run.calls);
    expect(s.slice(s.indexOf("set"))).toEqual([
      "set",
      "lease",
      "migrate",
      "migrate-returned",
      "release",
    ]);
    expect(count(s, "touched")).toBe(0);
    expect(run.calls[s.indexOf("release")]).toContain("lease_release");
    expect(run.stderr).toContain("backup, app and worker were NOT started");
    expect(run.stderr).toContain("left stopped");
    expect(run.stderr).not.toContain("uploads step");
    expectNoDestructiveCall(run);
  });

  it("the lease cannot be taken again: exit 1, no migrate, nothing started, the lock released", () => {
    const run = restore([SET_ID, "--yes"], {
      FAKE_CHECK_OUTPUT: OLDER_LINE,
      FAKE_LEASE_AGAIN_EXIT: "3",
    });
    expect(run.status).toBe(1);
    const s = steps(run.calls);
    expect(s.slice(s.indexOf("set"))).toEqual(["set", "lease", "release"]);
    expect(run.stderr).toContain("migrate deploy was NOT run");
    expectNoDestructiveCall(run);
  });

  it("TERM while migrate runs: the lock and the lease are released only after the migrate call returned, nothing started, exit 143", async () => {
    const log = logFile();
    const child = spawn("/bin/bash", [SCRIPT, SET_ID, "--yes"], {
      cwd: ROOT,
      env: env(log, { FAKE_CHECK_OUTPUT: OLDER_LINE, FAKE_MIGRATE_SLEEP: "2" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c)));
    const deadline = Date.now() + 15_000;
    while (!steps(readCalls(log)).includes("migrate")) {
      if (Date.now() > deadline) throw new Error("the migrate step never started");
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill("SIGTERM");
    const code = await exited;
    const calls = readCalls(log);
    const s = steps(calls);
    expect(code).toBe(143);
    expect(s.slice(s.indexOf("migrate"))).toEqual(["migrate", "migrate-returned", "release"]);
    expect(count(s, "start")).toBe(0);
    expect(stderr).toContain("left stopped");
    expectNoDestructiveCall({ status: code, stdout: "", stderr, calls });
  }, 30_000);
});

describe("scripts/restore.sh: the lease and the lock heartbeat are renewed while migrate deploy runs (K157)", () => {
  const FAST = { RESTORE_LEASE_TTL_SECONDS: "3", RESTORE_RENEW_SECONDS: "1" };

  function between(s: string[], from: string, to: string, item: string): number {
    return count(s.slice(s.indexOf(from), s.indexOf(to)), item);
  }

  function leaseAtMigrateReturn(): string {
    return readFileSync(`${lastLog}.lease-at-migrate-return`, "utf8").trim();
  }

  let lastLog = "";
  function restoreLogged(extra: Record<string, string>): Run {
    const log = logFile();
    lastLog = log;
    const started = Date.now();
    const run = spawnSync("/bin/bash", [SCRIPT, SET_ID, "--yes"], {
      cwd: ROOT,
      env: env(log, { FAKE_CHECK_OUTPUT: OLDER_LINE, ...FAST, ...extra }),
      encoding: "utf8",
      timeout: 30_000,
    });
    elapsedMs = Date.now() - started;
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, calls: readCalls(log) };
  }
  let elapsedMs = 0;

  it("a migrate that outlasts the lease TTL: the heartbeat and the lease are renewed in one step while it runs, the lease is still valid when it returns, then release and start", () => {
    const run = restoreLogged({ FAKE_MIGRATE_SLEEP: "5" });
    expect(run.status, run.stderr).toBe(0);
    const s = steps(run.calls);
    expect(between(s, "migrate", "migrate-returned", "renew")).toBeGreaterThanOrEqual(3);
    for (const call of run.calls.filter((_, i) => s[i] === "renew")) {
      expect(call).toContain('restore_lock_heartbeat "$1" || exit 4');
      expect(call).toContain('lease_renew "$1" 3');
      expect(call.endsWith(` ${HOLDER}`)).toBe(true);
    }
    expect(leaseAtMigrateReturn()).toBe("valid");
    expect(s.indexOf("release")).toBeGreaterThan(s.indexOf("migrate-returned"));
    expect(s.indexOf("start")).toBeGreaterThan(s.indexOf("release"));
    expect(s.slice(s.indexOf("migrate-returned"))).not.toContain("renew");
    expectNoDestructiveCall(run);
  }, 20_000);

  for (const [code, message] of [
    ["3", "Lost the backup lease while migrate deploy ran"],
    ["4", "Lost the restore lock while migrate deploy ran"],
    ["1", "Could not renew the restore lock and the backup lease while migrate deploy ran"],
  ] as const) {
    it(`a renewal that fails with exit ${code}: migrate is stopped at once, exit 1, nothing started, released only after the migrate call returned`, () => {
      const run = restoreLogged({ FAKE_MIGRATE_SLEEP: "20", FAKE_RENEW_EXIT: code });
      expect(run.status, run.stderr).toBe(1);
      expect(elapsedMs).toBeLessThan(12_000);
      const s = steps(run.calls);
      const stopAt = run.calls.findIndex((c) =>
        /^stop -t 30 aida-restore-[0-9a-f]{32}-migrate$/.test(c),
      );
      expect(stopAt).toBeGreaterThan(s.indexOf("renew"));
      expect(stopAt).toBeLessThan(s.indexOf("migrate-returned"));
      expect(s.slice(s.indexOf("migrate-returned"))).toEqual(["migrate-returned", "release"]);
      expect(count(s, "start")).toBe(0);
      expect(run.stderr).toContain(message);
      expect(run.stderr).toContain("backup, app and worker were NOT started");
      expect(run.calls[s.indexOf("release")]).toContain("lease_release");
      expectNoDestructiveCall(run);
    }, 20_000);
  }

  it("refuses a lease TTL that is not more than twice the renewal interval, before anything else", () => {
    const run = restoreLogged({ RESTORE_LEASE_TTL_SECONDS: "4", RESTORE_RENEW_SECONDS: "2" });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
    expect(run.stderr).toContain("must be more than twice RESTORE_RENEW_SECONDS");
  });
});
