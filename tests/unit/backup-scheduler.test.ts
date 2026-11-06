// Phase 9 plan 09-08 (AIDA-33, D-01): the daily timing of scripts/backup/scheduler.sh.
//
// `--next-delay HH:MM <nowEpoch>` prints only the delay to the next run; it is pure shell
// arithmetic, so these cases run the real script with the host's `sh`. The loop itself is checked
// only for what needs no clock: an invalid schedule stops it with exit 2, and BACKUP_ENABLED=false
// keeps it up without running a backup until TERM. No container is started.
//
// K143 (F3, b-WR-5): `--run-once <limit> <killGrace>` runs a fake aida-backup.sh, copied next to
// the real scheduler.sh and lib.sh, under the scheduler's bound on one run.
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/backup/scheduler.sh");
const DAY = 86_400;
/** A minimal environment: no BACKUP_* of the test process reaches the script. */
const BASE_ENV: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH ?? "/usr/bin:/bin" };

/** A fixed UTC day (2026-11-12T00:00:00Z) plus seconds. */
const DAY_START = Date.UTC(2026, 10, 12) / 1000;
const at = (hh: number, mm: number, ss = 0) => DAY_START + hh * 3600 + mm * 60 + ss;

function nextDelay(...args: string[]) {
  const run = spawnSync("sh", [SCRIPT, "--next-delay", ...args], {
    encoding: "utf8",
    env: BASE_ENV,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("scheduler.sh --next-delay (D-01 schedule, UTC)", () => {
  const cases: Array<[string, string, number, number]> = [
    ["one second before the scheduled minute", "02:00", at(1, 59, 59), 1],
    ["exactly at the scheduled minute: the next day, never a double run", "02:00", at(2, 0), DAY],
    ["one second after the scheduled minute", "02:00", at(2, 0, 1), DAY - 1],
    ["across midnight: 23:59:59 to 00:00", "00:00", at(23, 59, 59), 1],
    ["00:00 seen from 00:00:00", "00:00", at(0, 0), DAY],
    ["00:00 seen from noon", "00:00", at(12, 0), 12 * 3600],
    ["23:59 seen from 00:00", "23:59", at(0, 0), 23 * 3600 + 59 * 60],
    ["23:59 seen from 23:59:30", "23:59", at(23, 59, 30), DAY - 30],
    ["a leading zero is not read as octal", "08:09", at(0, 0), 8 * 3600 + 9 * 60],
    ["the default schedule from the morning before", "02:00", at(0, 30), 90 * 60],
  ];

  for (const [name, schedule, now, expected] of cases) {
    it(name, () => {
      const run = nextDelay(schedule, String(now));
      expect(run.status).toBe(0);
      expect(run.stdout).toBe(`${expected}\n`);
      expect(run.stderr).toBe("");
    });
  }

  it("every delay over a whole day lies in 1..86400 and lands on the scheduled minute", () => {
    for (let s = 0; s < DAY; s += 997) {
      const now = DAY_START + s;
      const run = nextDelay("02:00", String(now));
      const delay = Number(run.stdout.trim());
      expect(run.status).toBe(0);
      expect(delay).toBeGreaterThanOrEqual(1);
      expect(delay).toBeLessThanOrEqual(DAY);
      expect((now + delay) % DAY).toBe(2 * 3600);
    }
  });

  const invalid: Array<[string, string[]]> = [
    ["hour 24", ["24:00", String(at(0, 0))]],
    ["hour 29", ["29:00", String(at(0, 0))]],
    ["minute 60", ["02:60", String(at(0, 0))]],
    ["one-digit hour", ["2:00", String(at(0, 0))]],
    ["seconds given", ["02:00:00", String(at(0, 0))]],
    ["empty schedule", ["", String(at(0, 0))]],
    ["letters", ["ab:cd", String(at(0, 0))]],
    ["epoch not a number", ["02:00", "now"]],
    ["negative epoch", ["02:00", "-5"]],
    ["epoch with a leading zero", ["02:00", "0100"]],
    ["missing epoch", ["02:00"]],
    ["extra argument", ["02:00", String(at(0, 0)), "x"]],
  ];

  for (const [name, args] of invalid) {
    it(`invalid input exits 2 and prints nothing: ${name}`, () => {
      const run = nextDelay(...args);
      expect(run.status).toBe(2);
      expect(run.stdout).toBe("");
    });
  }
});

describe("scheduler.sh loop mode", () => {
  const baseEnv = BASE_ENV;

  it("an invalid BACKUP_SCHEDULE logs one line and exits 2 before any run", () => {
    const run = spawnSync("sh", [SCRIPT], {
      encoding: "utf8",
      env: { ...baseEnv, BACKUP_ENABLED: "true", BACKUP_SCHEDULE: "25:00" },
      timeout: 10_000,
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe(
      "[backup] invalid BACKUP_SCHEDULE: use HH:MM, 24-hour UTC, for example 02:00\n",
    );
  });

  it("an unexpected argument exits 2", () => {
    const run = spawnSync("sh", [SCRIPT, "now"], { encoding: "utf8", env: baseEnv });
    expect(run.status).toBe(2);
  });

  it("BACKUP_ENABLED=false logs the disabled line, stays up, and stops cleanly on TERM", async () => {
    const child = spawn("sh", [SCRIPT], {
      env: { ...baseEnv, BACKUP_ENABLED: "false", BACKUP_SCHEDULE: "02:00" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );

    const deadline = Date.now() + 5_000;
    while (!stdout.includes("\n") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(stdout).toBe("[backup] backups disabled (BACKUP_ENABLED=false)\n");
    // Still running a moment later: the container stays up and nothing runs.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(child.exitCode).toBeNull();

    child.kill("SIGTERM");
    expect(await exited).toBe(0);
    expect(stdout).toBe(
      "[backup] backups disabled (BACKUP_ENABLED=false)\n[backup] scheduler stopped\n",
    );
  });
});

describe("scheduler.sh bounds its wait on a run (K143, b-WR-5)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  /** A copy of scheduler.sh and lib.sh with a fake aida-backup.sh next to them. */
  async function withFakeBackup(body: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "aida-scheduler-"));
    dirs.push(dir);
    const src = path.resolve(__dirname, "../../scripts/backup");
    await copyFile(path.join(src, "scheduler.sh"), path.join(dir, "scheduler.sh"));
    await copyFile(path.join(src, "lib.sh"), path.join(dir, "lib.sh"));
    await writeFile(path.join(dir, "aida-backup.sh"), body);
    return path.join(dir, "scheduler.sh");
  }

  function runOnce(script: string, limit: string, grace: string) {
    const started = Date.now();
    const run = spawnSync("sh", [script, "--run-once", limit, grace], {
      encoding: "utf8",
      env: BASE_ENV,
      timeout: 60_000,
    });
    return { ...run, seconds: (Date.now() - started) / 1000 };
  }

  const UNRECORDED = /^AIDA_BACKUP_STATUS_UNRECORDED (\{.*\})$/;

  it("a run that ignores TERM is killed after the limit plus the grace, and the scheduler prints the unrecorded line for it", async () => {
    const script = await withFakeBackup(
      "trap '' TERM\necho '[backup] fake: started'\nsleep 30 >/dev/null 2>&1\n",
    );
    const run = runOnce(script, "1", "1");
    expect(run.seconds).toBeLessThan(15);
    expect(run.status).toBe(137);
    expect(run.stdout).toBe(
      [
        "[backup] fake: started",
        "[backup] scheduled backup still running after 1s; stopping it",
        "[backup] scheduled backup did not stop; killing it",
        "[backup] scheduled backup ended by signal 9",
        "[backup] backup status not recorded",
        "[backup] backup status record file not written",
        "",
      ].join("\n"),
    );
    // Only the unrecorded line (a shell may also report the killed job on stderr).
    const lines = run.stderr.split("\n").filter((l) => l.startsWith("AIDA_BACKUP_STATUS_"));
    expect(lines).toHaveLength(1);
    const match = UNRECORDED.exec(lines[0] as string);
    expect(match).not.toBeNull();
    expect(JSON.parse((match as RegExpExecArray)[1] as string)).toEqual({
      finishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      result: "failed",
      setId: null,
      category: "unknown",
    });
  });

  it("a run that handles TERM ends on it with its own exit code and records its own outcome", async () => {
    const script = await withFakeBackup(
      "trap 'echo \"[backup] fake: recorded\"; exit 2' TERM\nsleep 30 >/dev/null 2>&1 &\nwait $!\n",
    );
    const run = runOnce(script, "1", "20");
    expect(run.seconds).toBeLessThan(15);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe(
      "[backup] scheduled backup still running after 1s; stopping it\n[backup] fake: recorded\n",
    );
    expect(run.stderr).toBe("");
  });

  it("a run that ends within the limit is not touched", async () => {
    const script = await withFakeBackup("echo '[backup] fake: done'\nexit 3\n");
    const run = runOnce(script, "30", "30");
    expect(run.seconds).toBeLessThan(10);
    expect(run.status).toBe(3);
    expect(run.stdout).toBe("[backup] fake: done\n");
    expect(run.stderr).toBe("");
  });

  it("an invalid BACKUP_MAX_RUN_SECONDS stops the loop with exit 2 before any run", () => {
    const run = spawnSync("sh", [SCRIPT], {
      encoding: "utf8",
      env: { ...BASE_ENV, BACKUP_ENABLED: "true", BACKUP_MAX_RUN_SECONDS: "0" },
      timeout: 10_000,
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe(
      "[backup] invalid BACKUP_MAX_RUN_SECONDS: use whole seconds, 1 to 999999\n",
    );
  });
});
