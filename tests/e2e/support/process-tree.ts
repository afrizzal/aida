/**
 * One cross-platform teardown for every child process the E2E harness starts (the `next dev`
 * server in global-setup.ts and the worker each AI spec spawns).
 *
 * Why it exists: each spec used to carry its own Windows-only tree-kill command, so on macOS and
 * Linux the shell printed a "command not found" line into every run and the worker kept running
 * after its spec, where its scheduled jobs reached later files (plan 08-17).
 *
 * POSIX callers MUST spawn the child with `detached: true`. That makes the child the leader of a
 * new process group, so `-pid` addresses the whole group. This matters for the worker: the tsx
 * CLI runs `src/lib/worker/index.ts` in a second node process, so the worker is a two-process
 * tree, and signalling only the tsx parent can leave the real worker behind.
 *
 * Only `node:child_process` is imported, so the vitest unit test can load this module without
 * Playwright.
 */
import { type ChildProcess, execSync } from "node:child_process";

const POLL_MS = 200;
const KILL_WAIT_MS = 5_000;

/**
 * Sends `signal` to the process tree rooted at `pid`: on Windows a forced tree kill, elsewhere
 * the process group `-pid`. Never throws (the tree may already be gone).
 */
export function killTree(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${pid} /t /f`);
    } catch {
      // process already gone
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // process group already gone
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    // EPERM means the group exists but belongs to someone else; treat it as alive.
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (groupAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return true;
}

/**
 * Stops the tree rooted at `child` and resolves once it is gone. SIGTERM first (the worker stops
 * pg-boss and exits, which can take several seconds); if the group is still there after
 * `timeoutMs`, SIGKILL and wait up to 5 s more. On Windows it waits for the child's `exit` event
 * up to `timeoutMs`. Never throws.
 */
export async function stopProcessTree(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    killTree(pid);
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([exited, bound]);
    clearTimeout(timer);
    return;
  }

  // The group, not the leader, decides: a grandchild can outlive an already-exited parent.
  if (!groupAlive(pid)) return;
  killTree(pid, "SIGTERM");
  if (await waitForGroupExit(pid, timeoutMs)) return;
  killTree(pid, "SIGKILL");
  await waitForGroupExit(pid, KILL_WAIT_MS);
}
