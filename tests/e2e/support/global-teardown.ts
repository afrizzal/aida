/**
 * The E2E global teardown (review d-WR-d5), split out of global-setup.ts so the unit test can
 * drive it with real child processes and a fake container. Only `node:child_process` types and
 * process-tree.ts are imported, so vitest loads it without Playwright.
 *
 * The dev server goes through the same helper as the workers: SIGTERM to its process group, wait
 * for the group to exit, SIGKILL after `serverStopTimeoutMs`. Only then does the database
 * container stop, so a slow `next dev` neither keeps the E2E port for the next run nor logs
 * errors against a container that is already gone. If part of the tree is still alive at the
 * end, the teardown still stops the container and removes the uploads directory, then throws, so
 * the run reports the leak.
 */
import type { ChildProcess } from "node:child_process";
import { assertTreeStopped, stopProcessTree } from "./process-tree";

export const SERVER_STOP_TIMEOUT_MS = 15_000;

export interface GlobalTeardownParts {
  /** The `next dev` tree global setup spawned (detached on POSIX). */
  server: ChildProcess;
  stopContainer: () => Promise<unknown>;
  removeUploads: () => void;
  serverStopTimeoutMs?: number;
}

export function createGlobalTeardown(parts: GlobalTeardownParts): () => Promise<void> {
  const timeoutMs = parts.serverStopTimeoutMs ?? SERVER_STOP_TIMEOUT_MS;
  return async () => {
    const stopped = await stopProcessTree(parts.server, timeoutMs);
    await parts.stopContainer();
    parts.removeUploads();
    assertTreeStopped(stopped, "e2e dev server", { timeoutMs, requireGraceful: false });
  };
}
