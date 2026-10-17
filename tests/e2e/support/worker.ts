import { type ChildProcess, execSync } from "node:child_process";

/** Upper bound on a worker's graceful exit (pg-boss stop) after SIGTERM; never a sleep. */
export const WORKER_STOP_TIMEOUT_MS = 60_000;

/**
 * Stops a worker a spec file spawned and resolves once the process has closed, on every
 * platform: `taskkill` on Windows, SIGTERM elsewhere (tsx relays it to the worker, which stops
 * pg-boss and exits). Rejects if it has not closed within WORKER_STOP_TIMEOUT_MS.
 *
 * A worker left running keeps its scheduled jobs: on macOS `taskkill` does not exist, so the
 * workers of honesty-invariants, phase4-ai and phase5-rag ran on into snooze.spec.ts and their
 * every-minute snooze-wake woke that file's due ticket before its own handler call (Phase 14
 * final gate on 41b1597). Same logic as kb-proposals.spec.ts's stopWorker (review c-IN-06).
 */
export async function stopWorker(child: ChildProcess | null): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /t /f`);
    } catch {
      // already gone
    }
  } else {
    child.kill("SIGTERM");
  }
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`worker did not exit within ${WORKER_STOP_TIMEOUT_MS} ms`)),
      WORKER_STOP_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([closed, bound]);
  } finally {
    clearTimeout(timer);
  }
}
