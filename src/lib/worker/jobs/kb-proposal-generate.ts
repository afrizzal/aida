// Worker job: generates a KB proposal (Phase 12.2, AIDA-18, D-13), enqueued by requestProposal
// after its transaction commits and by Restart generation. Registered by src/lib/worker/index.ts
// with includeMetadata, so the handler receives pg-boss's retryCount and retryLimit (mirrors
// ai-triage.ts's split between handler file and registration).
//
// The payload is checked with isProposalJobPayload (review R2-3): only { proposalId, epoch }
// passes. Anything else (a payload without an epoch, an epoch of 0, extra keys) logs one fixed
// line with no payload content and returns without a provider call or a write. Everything else
// is reloaded by generateProposal with an organization term.
//
// Worker-bundleable (esbuild) — every import below is relative to src/lib/worker/jobs/.
import { generateProposal } from "../../kb/generate-proposal";
import { isProposalJobPayload } from "../../kb/proposal-contract";

/** The part of a pg-boss JobWithMetadata the handler reads. */
export interface KbProposalGenerateJob {
  data: unknown;
  retryCount: number;
  retryLimit: number;
}

export interface KbProposalGenerateHandlerOptions {
  /** The job's clock (tests inject it); defaults to the current time. */
  now?: Date;
}

export async function kbProposalGenerateHandler(
  job: KbProposalGenerateJob,
  opts: KbProposalGenerateHandlerOptions = {},
): Promise<void> {
  if (!isProposalJobPayload(job.data)) {
    console.warn("kb-proposal-generate: invalid payload");
    return;
  }
  const { proposalId, epoch } = job.data;
  // Throws KbProposalRetryError only after a transient failure released the lease while a retry
  // is left, so pg-boss retries this job with the same payload (and so the same epoch).
  await generateProposal(proposalId, {
    epoch,
    attempt: { retryCount: job.retryCount, retryLimit: job.retryLimit },
    ...(opts.now ? { now: opts.now } : {}),
  });
}
