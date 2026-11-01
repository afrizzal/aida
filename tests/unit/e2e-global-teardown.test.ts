// The E2E global teardown stops the dev server through the shared process-tree helper: it waits
// for the tree to exit, escalates SIGTERM to SIGKILL after a bounded wait, and only then stops the
// database container (review d-WR-d5). Real child processes stand in for `next dev`; the container
// is a recording fake.
import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlobalTeardown } from "../e2e/support/global-teardown";
import { killTree } from "../e2e/support/process-tree";

const IGNORE_SIGTERM = [
  'process.on("SIGTERM", () => {});',
  'process.stdout.write(String(process.pid) + "\\n");',
  "setInterval(() => {}, 1000);",
].join("\n");

const OBEY_SIGTERM = [
  'process.stdout.write(String(process.pid) + "\\n");',
  "setInterval(() => {}, 1000);",
].join("\n");

// The leader exits on SIGTERM; its child ignores SIGTERM and prints its own pid once its handler
// is installed (through the leader's stdout).
const LEADER_WITH_STUBBORN_CHILD = [
  'const { spawn } = require("node:child_process");',
  `spawn(process.execPath, ["-e", ${JSON.stringify(IGNORE_SIGTERM)}], { stdio: ["ignore", "inherit", "inherit"] });`,
  "setInterval(() => {}, 1000);",
].join("\n");

const started: ChildProcess[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Spawns a detached tree and resolves with the first pid it prints (once its handlers are set). */
async function startServer(script: string): Promise<{ server: ChildProcess; printedPid: number }> {
  const server = spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  started.push(server);
  const printedPid = await new Promise<number>((resolve, reject) => {
    let out = "";
    server.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const line = out.split("\n")[0];
      if (out.includes("\n") && line) resolve(Number(line));
    });
    server.once("exit", (code) => reject(new Error(`server exited early (code ${code})`)));
  });
  return { server, printedPid };
}

function recorder(server: ChildProcess) {
  const events: string[] = [];
  let serverAtContainerStop: { exitCode: number | null; signalCode: string | null } | null = null;
  return {
    events,
    get serverAtContainerStop() {
      return serverAtContainerStop;
    },
    stopContainer: async () => {
      serverAtContainerStop = { exitCode: server.exitCode, signalCode: server.signalCode };
      events.push("container");
    },
    removeUploads: () => {
      events.push("uploads");
    },
  };
}

afterEach(() => {
  // Safety net: killTree skips any tree whose leader exit is recorded (review d-WR-d7).
  for (const child of started.splice(0)) killTree(child, "SIGKILL");
});

describe.skipIf(process.platform === "win32")("E2E global teardown (review d-WR-d5)", () => {
  it("waits for a dev server that ignores SIGTERM, escalates to SIGKILL, then stops the container", async () => {
    const { server } = await startServer(IGNORE_SIGTERM);
    const rec = recorder(server);
    const teardown = createGlobalTeardown({
      server,
      stopContainer: rec.stopContainer,
      removeUploads: rec.removeUploads,
      serverStopTimeoutMs: 500,
    });

    const begin = Date.now();
    await teardown();

    expect(Date.now() - begin).toBeGreaterThanOrEqual(500);
    expect(rec.serverAtContainerStop).toEqual({ exitCode: null, signalCode: "SIGKILL" });
    expect(rec.events).toEqual(["container", "uploads"]);
  }, 20_000);

  it("stops a dev server that obeys SIGTERM without SIGKILL, before the container", async () => {
    const { server } = await startServer(OBEY_SIGTERM);
    const rec = recorder(server);
    const teardown = createGlobalTeardown({
      server,
      stopContainer: rec.stopContainer,
      removeUploads: rec.removeUploads,
      serverStopTimeoutMs: 5_000,
    });

    await teardown();

    expect(rec.serverAtContainerStop).toEqual({ exitCode: null, signalCode: "SIGTERM" });
    expect(rec.events).toEqual(["container", "uploads"]);
  }, 20_000);

  it("still stops the container and removes uploads, then fails, when part of the server tree survives", async () => {
    const { server, printedPid: stubborn } = await startServer(LEADER_WITH_STUBBORN_CHILD);
    const rec = recorder(server);
    const teardown = createGlobalTeardown({
      server,
      stopContainer: rec.stopContainer,
      removeUploads: rec.removeUploads,
      serverStopTimeoutMs: 500,
    });

    try {
      await expect(teardown()).rejects.toThrow("e2e dev server process tree is still alive");
      expect(rec.events).toEqual(["container", "uploads"]);
    } finally {
      // The stubborn child is this case's own process and ignores SIGTERM, so it is alive here.
      if (isAlive(stubborn)) process.kill(stubborn, "SIGKILL");
    }
    await vi.waitFor(() => expect(isAlive(stubborn)).toBe(false), {
      timeout: 5_000,
      interval: 100,
    });
  }, 20_000);
});
