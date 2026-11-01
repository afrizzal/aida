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
 * A child's pid is signalled only while its exit is not recorded (review d-WR-d7). Until Node has
 * reaped the child, its pid (alive or a zombie), and so the group `-pid` it leads, cannot belong
 * to anyone else. Once the exit is recorded the number can be reused by an unrelated process, so
 * from then on nothing is sent to it: a group member that outlived its leader is reported by
 * `stopProcessTree`, never signalled.
 *
 * Only `node:child_process` is imported, so the vitest unit test can load this module without
 * Playwright.
 */
import { type ChildProcess, execSync } from "node:child_process";

const POLL_MS = 200;
const KILL_WAIT_MS = 5_000;

/**
 * True once the child's own exit is recorded. Node writes `exitCode` or `signalCode` in the
 * handler that emits the child's `exit` event, immediately before emitting it, and only after the
 * pid has been reaped, so this reads that event's record synchronously, including for an exit
 * that happened before the caller looked.
 */
function exitRecorded(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Sends `signal` to the process tree rooted at `child`: on Windows a forced tree kill, elsewhere
 * the process group `-pid`. Does nothing once the child's exit is recorded, on both platforms, so
 * a reused pid is never signalled (review d-WR-d7). Returns whether a signal or the tree kill was
 * sent. Never throws.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): boolean {
  const pid = child.pid;
  if (!pid || exitRecorded(child)) return false;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${pid} /t /f`);
      return true;
    } catch {
      // process already gone
      return false;
    }
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // process group already gone
    return false;
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

/** How a `stopProcessTree` call ended (review d-WR-d6). */
export interface StopResult {
  /** The tree was gone without SIGKILL: it exited on SIGTERM, or had already exited. */
  graceful: boolean;
  /**
   * No member of the tree was observed at the end. POSIX: the group probe answered ESRCH.
   * Windows: the child's exit was seen. If the child had already exited before the call, nothing
   * is probed or signalled (its pid may belong to someone else by then) and this is true.
   */
  gone: boolean;
  /** SIGKILL was sent because the tree outlived SIGTERM by `timeoutMs`. */
  escalated: boolean;
}

/**
 * Stops the tree rooted at `child` and reports how it ended. SIGTERM first (the worker stops
 * pg-boss and exits, which can take several seconds); if the group is still there after
 * `timeoutMs`, SIGKILL and wait up to `killWaitMs` (5 s) more. On Windows it waits for the child's
 * `exit` event up to `timeoutMs`. Never throws: the caller decides what the result means, for
 * example with `assertTreeStopped`.
 */
export async function stopProcessTree(
  child: ChildProcess,
  timeoutMs = 15_000,
  opts: { killWaitMs?: number } = {},
): Promise<StopResult> {
  const pid = child.pid;
  if (!pid) return { graceful: true, gone: true, escalated: false };

  // Already exited before the call: never touch the number again (review d-WR-d7).
  if (exitRecorded(child)) return { graceful: true, gone: true, escalated: false };

  if (process.platform === "win32") {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    killTree(child);
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([exited, bound]);
    clearTimeout(timer);
    const gone = exitRecorded(child);
    return { graceful: gone, gone, escalated: false };
  }

  // The group, not the leader, decides when the tree is gone: a grandchild can outlive its
  // parent. The group is only probed (signal 0, nothing is delivered) after the leader exits.
  killTree(child, "SIGTERM");
  if (await waitForGroupExit(pid, timeoutMs))
    return { graceful: true, gone: true, escalated: false };
  if (!killTree(child, "SIGKILL")) {
    // The leader exited during the wait but the group still has members: report it, never
    // signal a number whose owner is no longer known (review d-WR-d7).
    return { graceful: false, gone: !groupAlive(pid), escalated: false };
  }
  const gone = await waitForGroupExit(pid, opts.killWaitMs ?? KILL_WAIT_MS);
  return { graceful: false, gone, escalated: true };
}

/**
 * Throws if `result` shows that the tree named `label` is still alive, or, with
 * `requireGraceful`, that it needed SIGKILL. A spec calls this after its cleanup, so a hung
 * SIGTERM path or a surviving tree fails the run instead of passing silently (review d-WR-d6).
 */
export function assertTreeStopped(
  result: StopResult,
  label: string,
  opts: { timeoutMs: number; requireGraceful: boolean },
): void {
  if (!result.gone) {
    throw new Error(
      `${label} process tree is still alive after stopProcessTree (escalated to SIGKILL: ${String(result.escalated)})`,
    );
  }
  if (opts.requireGraceful && !result.graceful) {
    throw new Error(
      `${label} did not exit within ${opts.timeoutMs} ms of SIGTERM and was stopped with SIGKILL`,
    );
  }
}
