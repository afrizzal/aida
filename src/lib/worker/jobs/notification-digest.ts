// The scheduled email digest (Phase 10, AIDA-46, D-23, D-24, V-15, K169).
//
// Runs one pass of runDigests: every due (organization, recipient) pair is claimed under a lease,
// re-checked, sent through the organization's configured SMTP and recorded only on the server's
// final acceptance. The schedule comes from AIDA_DIGEST_INTERVAL_HOURS (digest-config.ts), read
// once when the worker starts. Links use BETTER_AUTH_URL, which the worker therefore needs in its
// environment.
//
// Overlap (run decision K169, review c-WR-04). The queue's singleton policy keeps a second job from
// becoming active only while the first is active. pg-boss fails a job that runs past its expiry
// and aborts its signal, but the handler's promise keeps running; the defaults (15 minutes, two
// retries) would therefore start a second run beside a slow one. So the queue is created with
// retryLimit 0 (a failed run is never retried; the next scheduled run takes over) and an expiry of
// the interval (at most 23 hours), and the handler passes the job's signal to runDigests, which
// stops before its next claim once the signal is aborted (expiry or worker shutdown). The only
// overlap left is the one pair in flight, which the per-pair advisory lock and the lease keep
// apart from the next run (that pair reports `held` there).
//
// Logs (K170): one summary line per run with the counts by outcome, and the error class of a run
// that throws (which then fails the job); runDigests logs each failed send or pair. Never an
// address, an id or a ticket. Relative imports only: the worker bundles this module.
import type { Job } from "pg-boss";
import { type RunDigestsDeps, type RunDigestsResult, runDigests } from "../../notifications/digest";
import {
  digestCron,
  digestExpireSeconds,
  NOTIFICATION_DIGEST_QUEUE,
} from "../../notifications/digest-config";
import { digestErrorLabel, digestLog, digestRunSummary } from "../../notifications/digest-log";

type Env = Record<string, string | undefined>;

/** The queue options of the digest (K169); `policy` is fixed when a queue is created. */
export function digestQueueOptions(env: Env = process.env) {
  return {
    policy: "singleton" as const,
    retryLimit: 0,
    expireInSeconds: digestExpireSeconds(env),
  };
}

/** The part of a PgBoss instance registerNotificationDigest calls. */
export interface DigestQueueBoss {
  createQueue(
    name: string,
    options: { policy: "singleton"; retryLimit: number; expireInSeconds: number },
  ): Promise<void>;
  updateQueue(
    name: string,
    options: { retryLimit: number; expireInSeconds: number },
  ): Promise<void>;
  work(name: string, handler: (jobs: Job[]) => Promise<void>): Promise<string>;
  schedule(name: string, cron: string, data: object): Promise<void>;
}

/**
 * Creates the queue, then sets its options again (createQueue does nothing for a queue that
 * already exists, so this corrects an install whose queue was created with the old options),
 * registers the worker and the schedule. The worker (index.ts) and the K169 test both call it.
 */
export async function registerNotificationDigest(
  boss: DigestQueueBoss,
  env: Env = process.env,
): Promise<void> {
  const { policy, ...options } = digestQueueOptions(env);
  await boss.createQueue(NOTIFICATION_DIGEST_QUEUE, { policy, ...options });
  await boss.updateQueue(NOTIFICATION_DIGEST_QUEUE, options);
  // The handler's result holds ids; it is not returned to pg-boss, so it is never stored as the
  // job's output.
  await boss.work(NOTIFICATION_DIGEST_QUEUE, async (jobs: Job[]) => {
    await notificationDigestHandler(jobs);
  });
  await boss.schedule(NOTIFICATION_DIGEST_QUEUE, digestCron(env), {});
}

/**
 * The pg-boss handler; the scheduled payload is empty and is not read, the job's signal is.
 * `deps` are test seams (timing, hooks); the worker passes none.
 */
export async function notificationDigestHandler(
  jobs?: readonly { signal?: AbortSignal }[],
  deps: Omit<RunDigestsDeps, "signal"> = {},
): Promise<RunDigestsResult> {
  let result: RunDigestsResult;
  try {
    result = await runDigests({ ...deps, signal: jobs?.[0]?.signal });
  } catch (err) {
    digestLog(`run failed: ${digestErrorLabel(err)}`);
    throw err;
  }
  digestLog(`run: ${digestRunSummary(result)}`);
  return result;
}
