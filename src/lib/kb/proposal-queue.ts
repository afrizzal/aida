// The kb-proposal-generate queue options (Phase 12.2, D-13, D-14; run decision K55, review
// a2-WR-03), shared by the app's pg-boss client (src/lib/queue/boss-client.ts) and the worker
// (src/lib/worker/index.ts), so the two can never disagree.
//
// pg-boss 12 defaults retryDelay to 0 and computes its backoff as a multiple of retryDelay, so a
// queue with retryBackoff but no retryDelay retries at once (about 2 s later, on the next poll):
// a 429 or 503 is retried while the provider is still refusing. retryDelay 30 makes the backoff
// real (about 30 s, then about 60 s, capped at retryDelayMax). createQueue does nothing for a
// queue that already exists, so ensureKbProposalQueue also updates it, which corrects an install
// whose queue was created before this decision. The other on-demand queues keep their options
// (recorded as deferred under K55).
//
// Pure: no pg-boss import, relative imports only (the worker bundles this module).
import { KB_PROPOSAL_GENERATE_QUEUE, KB_PROPOSAL_JOB_RETRY_LIMIT } from "./proposal-contract";

/** retryDelay in seconds: the first retry after about 30 s, with backoff, capped at 300 s. */
export const KB_PROPOSAL_QUEUE_OPTIONS = {
  retryLimit: KB_PROPOSAL_JOB_RETRY_LIMIT,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 300,
} as const;

/** The part of a PgBoss instance the helper calls. */
export interface ProposalQueueAdmin {
  createQueue(name: string, options: typeof KB_PROPOSAL_QUEUE_OPTIONS): Promise<void>;
  updateQueue(name: string, options: typeof KB_PROPOSAL_QUEUE_OPTIONS): Promise<void>;
}

/** Creates the queue with KB_PROPOSAL_QUEUE_OPTIONS, then sets the same options on it. */
export async function ensureKbProposalQueue(boss: ProposalQueueAdmin): Promise<void> {
  await boss.createQueue(KB_PROPOSAL_GENERATE_QUEUE, { ...KB_PROPOSAL_QUEUE_OPTIONS });
  await boss.updateQueue(KB_PROPOSAL_GENERATE_QUEUE, { ...KB_PROPOSAL_QUEUE_OPTIONS });
}
