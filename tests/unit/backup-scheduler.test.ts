// Phase 9 plan 09-08 (AIDA-33, D-01): the daily timing of scripts/backup/scheduler.sh.
//
// `--next-delay HH:MM <nowEpoch>` prints only the delay to the next run; it is pure shell
// arithmetic, so these cases run the real script with the host's `sh`. The loop itself is checked
// only for what needs no clock: an invalid schedule stops it with exit 2, and BACKUP_ENABLED=false
// keeps it up without running a backup until TERM. No container is started.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/backup/scheduler.sh");
const DAY = 86_400;

/** A fixed UTC day (2026-11-12T00:00:00Z) plus seconds. */
const DAY_START = Date.UTC(2026, 10, 12) / 1000;
const at = (hh: number, mm: number, ss = 0) => DAY_START + hh * 3600 + mm * 60 + ss;

function nextDelay(...args: string[]) {
  const run = spawnSync("sh", [SCRIPT, "--next-delay", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
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
  const baseEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

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
