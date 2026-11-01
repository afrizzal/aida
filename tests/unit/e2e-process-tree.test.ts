import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTreeStopped, killTree, stopProcessTree } from "../e2e/support/process-tree";

// The E2E worker is a two-process tree (tsx CLI parent, worker child). These cases build the same
// shape: a detached parent that spawns a long-running grandchild and reports its pid on stdout.
const GRANDCHILD = "setInterval(() => {}, 1000)";

function parentScript(ignoreSigterm: boolean): string {
  return [
    'const { spawn } = require("node:child_process");',
    ignoreSigterm ? 'process.on("SIGTERM", () => {});' : "",
    `const c = spawn(process.execPath, ["-e", ${JSON.stringify(GRANDCHILD)}], { stdio: "ignore" });`,
    'process.stdout.write(String(c.pid) + "\\n");',
    "setInterval(() => {}, 1000);",
  ].join("\n");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

const started: number[] = [];

async function startTree(
  ignoreSigterm: boolean,
): Promise<{ parent: ChildProcess; grandchild: number }> {
  const parent = spawn(process.execPath, ["-e", parentScript(ignoreSigterm)], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (parent.pid) started.push(parent.pid);
  const grandchild = await new Promise<number>((resolve, reject) => {
    let out = "";
    parent.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const line = out.split("\n")[0];
      if (out.includes("\n") && line) resolve(Number(line));
    });
    parent.once("exit", (code) => reject(new Error(`parent exited early (code ${code})`)));
  });
  return { parent, grandchild };
}

afterEach(() => {
  // Safety net only: never leave a test tree behind if an assertion failed mid-case.
  for (const pid of started.splice(0)) killTree(pid, "SIGKILL");
});

describe("stopProcessTree", () => {
  it.skipIf(process.platform === "win32")(
    "stops a detached parent and its grandchild",
    async () => {
      const { parent, grandchild } = await startTree(false);
      expect(parent.pid && isAlive(parent.pid)).toBe(true);
      expect(isAlive(grandchild)).toBe(true);

      await stopProcessTree(parent);

      await vi.waitFor(
        () => {
          expect(isAlive(parent.pid as number)).toBe(false);
          expect(isAlive(grandchild)).toBe(false);
        },
        { timeout: 5_000, interval: 100 },
      );
    },
    20_000,
  );

  it.skipIf(process.platform === "win32")(
    "escalates to SIGKILL when the tree ignores SIGTERM",
    async () => {
      const { parent, grandchild } = await startTree(true);
      const begin = Date.now();

      await stopProcessTree(parent, 1_000);

      expect(Date.now() - begin).toBeGreaterThanOrEqual(1_000);
      await vi.waitFor(
        () => {
          expect(isAlive(parent.pid as number)).toBe(false);
          expect(isAlive(grandchild)).toBe(false);
        },
        { timeout: 5_000, interval: 100 },
      );
    },
    20_000,
  );

  it("resolves for a child that already exited, and killTree ignores a missing pid", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const pid = child.pid as number;

    await expect(stopProcessTree(child)).resolves.toEqual({
      graceful: true,
      gone: true,
      escalated: false,
    });
    expect(() => killTree(pid)).not.toThrow();
  });
});

// Review d-WR-d6: the caller sees how the tree stopped, so a worker whose SIGTERM path is broken,
// or a tree that survives SIGKILL, fails its spec instead of being cleaned up silently.
describe("stopProcessTree reports how the tree stopped (review d-WR-d6)", () => {
  it.skipIf(process.platform === "win32")(
    "a tree that exits on SIGTERM is graceful and gone",
    async () => {
      const { parent } = await startTree(false);
      await expect(stopProcessTree(parent)).resolves.toEqual({
        graceful: true,
        gone: true,
        escalated: false,
      });
    },
    20_000,
  );

  it.skipIf(process.platform === "win32")(
    "a child that ignores SIGTERM is reported as escalated and not graceful",
    async () => {
      const { parent, grandchild } = await startTree(true);
      await expect(stopProcessTree(parent, 1_000)).resolves.toEqual({
        graceful: false,
        gone: true,
        escalated: true,
      });
      expect(isAlive(grandchild)).toBe(false);
    },
    20_000,
  );

  it.skipIf(process.platform === "win32")(
    "a tree that survives SIGKILL is reported as not gone",
    async () => {
      // No real process can be made to survive SIGKILL, so process.kill is replaced: every
      // signal "succeeds" and the group always answers the existence probe. Nothing is sent to
      // the fake pid.
      const fake = Object.assign(new EventEmitter(), {
        pid: 4_000_000,
        exitCode: null,
        signalCode: null,
      }) as unknown as ChildProcess;
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        await expect(stopProcessTree(fake, 100, { killWaitMs: 300 })).resolves.toEqual({
          graceful: false,
          gone: false,
          escalated: true,
        });
        const sent = kill.mock.calls.filter(([, signal]) => signal !== 0);
        expect(sent).toEqual([
          [-4_000_000, "SIGTERM"],
          [-4_000_000, "SIGKILL"],
        ]);
      } finally {
        kill.mockRestore();
      }
    },
    20_000,
  );
});

describe("assertTreeStopped (review d-WR-d6)", () => {
  it("throws 'did not exit within' when a graceful stop is required and SIGKILL was needed", () => {
    expect(() =>
      assertTreeStopped({ graceful: false, gone: true, escalated: true }, "worker", {
        timeoutMs: 60_000,
        requireGraceful: true,
      }),
    ).toThrow("worker did not exit within 60000 ms of SIGTERM");
  });

  it("throws when the tree survived SIGKILL, whether or not a graceful stop is required", () => {
    for (const requireGraceful of [true, false]) {
      expect(() =>
        assertTreeStopped({ graceful: false, gone: false, escalated: true }, "dev server", {
          timeoutMs: 15_000,
          requireGraceful,
        }),
      ).toThrow("dev server process tree is still alive");
    }
  });

  it("accepts a graceful stop, and an escalated stop when grace is not required", () => {
    expect(() =>
      assertTreeStopped({ graceful: true, gone: true, escalated: false }, "worker", {
        timeoutMs: 60_000,
        requireGraceful: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertTreeStopped({ graceful: false, gone: true, escalated: true }, "dev server", {
        timeoutMs: 15_000,
        requireGraceful: false,
      }),
    ).not.toThrow();
  });
});
