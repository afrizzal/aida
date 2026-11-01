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

// Review d-WR-d7: a parent that dies on SIGTERM while its grandchild ignores SIGTERM. The
// grandchild prints its own pid (through the parent's stdout) once its handler is installed.
const STUBBORN_GRANDCHILD = [
  'process.on("SIGTERM", () => {});',
  'process.stdout.write(String(process.pid) + "\\n");',
  "setInterval(() => {}, 1000);",
].join("\n");

function parentWithStubbornGrandchild(): string {
  return [
    'const { spawn } = require("node:child_process");',
    `spawn(process.execPath, ["-e", ${JSON.stringify(STUBBORN_GRANDCHILD)}], { stdio: ["ignore", "inherit", "inherit"] });`,
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

const started: ChildProcess[] = [];

async function startTree(
  ignoreSigterm: boolean,
  script = parentScript(ignoreSigterm),
): Promise<{ parent: ChildProcess; grandchild: number }> {
  const parent = spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  started.push(parent);
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
  // Safety net only: never leave a test tree behind if an assertion failed mid-case. killTree
  // skips every tree whose leader has exited, so a tree a case already saw gone is never
  // signalled again, and neither is a pid that may have been reused since (review d-WR-d7).
  for (const child of started.splice(0)) killTree(child, "SIGKILL");
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

  it("resolves for a child that already exited, and killTree does not signal it", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));

    await expect(stopProcessTree(child)).resolves.toEqual({
      graceful: true,
      gone: true,
      escalated: false,
    });
    // On Windows this is the taskkill guard: false means no command was run.
    expect(killTree(child)).toBe(false);
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

// Review d-WR-d7: once the leader's exit is recorded its pid may be reused, so neither the pid nor
// the group -pid is signalled after that.
describe("process-group teardown never signals an exited child (review d-WR-d7)", () => {
  it.skipIf(process.platform === "win32")(
    "a child that already exited is never passed to process.kill",
    async () => {
      const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
        detached: true,
        stdio: "ignore",
      });
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const kill = vi.spyOn(process, "kill");
      try {
        await stopProcessTree(child, 200);
        expect(killTree(child, "SIGTERM")).toBe(false);
        expect(killTree(child, "SIGKILL")).toBe(false);
        expect(kill).not.toHaveBeenCalled();
      } finally {
        kill.mockRestore();
      }
    },
    20_000,
  );

  it.skipIf(process.platform === "win32")(
    "a running child is signalled while its exit is not recorded",
    async () => {
      const { parent } = await startTree(false);
      const kill = vi.spyOn(process, "kill");
      try {
        expect(killTree(parent, "SIGTERM")).toBe(true);
        expect(kill).toHaveBeenCalledWith(-(parent.pid as number), "SIGTERM");
      } finally {
        kill.mockRestore();
      }
      await expect(stopProcessTree(parent)).resolves.toMatchObject({ gone: true });
    },
    20_000,
  );

  it.skipIf(process.platform === "win32")(
    "after the leader exits on SIGTERM, a surviving grandchild is reported and no SIGKILL is sent",
    async () => {
      const { parent, grandchild } = await startTree(false, parentWithStubbornGrandchild());
      const kill = vi.spyOn(process, "kill");
      try {
        const result = await stopProcessTree(parent, 1_000, { killWaitMs: 300 });
        expect(parent.exitCode !== null || parent.signalCode !== null).toBe(true);
        expect(result).toEqual({ graceful: false, gone: false, escalated: false });
        const sent = kill.mock.calls.filter(([, signal]) => signal !== 0);
        expect(sent).toEqual([[-(parent.pid as number), "SIGTERM"]]);
        expect(isAlive(grandchild)).toBe(true);
      } finally {
        kill.mockRestore();
        // The grandchild is this case's own process and ignores SIGTERM, so it is still alive
        // here; stop it by its own pid.
        if (isAlive(grandchild)) process.kill(grandchild, "SIGKILL");
      }
      await vi.waitFor(() => expect(isAlive(grandchild)).toBe(false), {
        timeout: 5_000,
        interval: 100,
      });
    },
    20_000,
  );
});
