"use server";

// KB proposal server actions (Phase 12.2, AIDA-18, plan 12.2-08). D-01 lives in the services and
// loaders: each action takes the actor from getSessionActor() (never the throwing admin guard of
// src/lib/authz.ts, pattern finding C1) and passes it on; the service checks the member row and
// the exact owner or admin role before it reads anything.
//
// Review C6: only the service call (and getSessionActor) sits in the try that maps a thrown error
// to { ok: false, code: ACTION_UNKNOWN_CODE }, without the error's message (T-12.2-37). After
// that, on a successful result, revalidatePath runs in its own try: a revalidation error is
// logged with a fixed line and never changes the result, so a committed request still returns
// ok with its proposal id and the UI never invites a duplicate (T-12.2-55). The service's typed
// result is returned unchanged (publish with indexingQueued, restart and retry with queued,
// field refusals with their field).
//
// Review b-WR-01: getSessionActor() redirects an expired or missing session to /login by throwing
// Next's redirect error, and a service may throw notFound(). Each catch first passes the error to
// unstable_rethrow (next/navigation, Next 16), which rethrows Next's control-flow errors (also
// when one is the cause of another error), so they are never mapped to UNKNOWN.

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ACTION_UNKNOWN_CODE } from "@/lib/kb/proposal-outcome";
import { loadStartSelection, type StartSelectionResult } from "@/lib/kb/proposal-queries";
import { type ProposalRequestResult, requestProposal } from "@/lib/kb/proposal-request";
import {
  type ProposalVersionInput,
  type PublishProposalResult,
  publishProposal,
  type RejectProposalResult,
  type RestartProposalResult,
  type RetryIndexingResult,
  rejectProposal,
  restartProposalGeneration,
  retryProposalIndexing,
  type SaveProposalInput,
  type SaveProposalResult,
  saveProposalDraft,
} from "@/lib/kb/proposal-review";
import { getSessionActor } from "@/lib/session";

/** The result of an action whose session read or service threw (review C6, D-01). */
export type ActionUnknown = { ok: false; code: typeof ACTION_UNKNOWN_CODE };

const PROPOSALS_PATH = "/kb/proposals";

function proposalPath(id: string): string {
  return `${PROPOSALS_PATH}/${id}`;
}

function unknownResult(action: string): ActionUnknown {
  console.error(`kb-proposal-actions: ${action} failed`);
  return { ok: false, code: ACTION_UNKNOWN_CODE };
}

/**
 * Review C6: each path in its own try, so one failure neither skips the others nor changes the
 * action's result; the error itself is not logged or returned.
 */
function revalidateAfterCommit(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      console.error("kb-proposal-actions: revalidation failed after a committed change");
    }
  }
}

/** An untrusted id from the browser; the services treat anything else as no match. */
function idOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Starts a proposal from 1 to 5 tickets (plan 12.2-04). */
export async function requestProposalAction(
  ticketIds: string[],
): Promise<ProposalRequestResult | ActionUnknown> {
  let result: ProposalRequestResult;
  try {
    result = await requestProposal(await getSessionActor(), ticketIds);
  } catch (error) {
    unstable_rethrow(error);
    return unknownResult("request");
  }
  if (result.ok) {
    revalidateAfterCommit([PROPOSALS_PATH, proposalPath(result.proposalId)]);
  }
  return result;
}

/** The tickets the Start dialog lists, D-01 first (UI-SPEC 1b). A read: nothing to revalidate. */
export async function loadStartSelectionAction(
  ticketIds: string[],
): Promise<StartSelectionResult | ActionUnknown> {
  try {
    return await loadStartSelection(await getSessionActor(), ticketIds);
  } catch (error) {
    unstable_rethrow(error);
    return unknownResult("load start selection");
  }
}

/** Saves an edit of a DRAFT; never publishes (D-15). */
export async function saveProposalAction(
  input: SaveProposalInput,
): Promise<SaveProposalResult | ActionUnknown> {
  let result: SaveProposalResult;
  try {
    result = await saveProposalDraft(await getSessionActor(), input);
  } catch (error) {
    unstable_rethrow(error);
    return unknownResult("save");
  }
  if (result.ok) {
    revalidateAfterCommit([PROPOSALS_PATH, proposalPath(idOf(input?.proposalId))]);
  }
  return result;
}

/** Rejects a DRAFT (D-16). Also revalidates /kb, whose Proposals link counts drafts (b-IN-06). */
export async function rejectProposalAction(
  input: ProposalVersionInput,
): Promise<RejectProposalResult | ActionUnknown> {
  let result: RejectProposalResult;
  try {
    result = await rejectProposal(await getSessionActor(), input);
  } catch (error) {
    unstable_rethrow(error);
    return unknownResult("reject");
  }
  if (result.ok) {
    revalidateAfterCommit([PROPOSALS_PATH, proposalPath(idOf(input?.proposalId)), "/kb"]);
  }
  return result;
}

/** Approve and publish (D-06); indexingQueued is passed through unchanged (review C2). */
export async function publishProposalAction(
  input: ProposalVersionInput,
): Promise<PublishProposalResult | ActionUnknown> {
  let result: PublishProposalResult;
  try {
    result = await publishProposal(await getSessionActor(), input);
  } catch (error) {
    unstable_rethrow(error);
    return unknownResult("publish");
  }
  if (result.ok) {
    revalidateAfterCommit([PROPOSALS_PATH, proposalPath(idOf(input?.proposalId)), "/kb"]);
  }
  return result;
}

/** Restarts a stuck generation (D-13); queued is passed through unchanged (review C5). */
export async function restartGenerationAction(
  input: ProposalVersionInput,
): Promise<RestartProposalResult | ActionUnknown> {
  let result: RestartProposalResult;
  try {
    result = await restartProposalGeneration(await getSessionActor(), input);
  } catch (error) {
    unstable_rethrow(error);
    return unknownResult("restart");
  }
  if (result.ok) {
    revalidateAfterCommit([PROPOSALS_PATH, proposalPath(idOf(input?.proposalId))]);
  }
  return result;
}

/** Re-queues a published article's embedding (reviews C2, R3-2); queued is passed through. */
export async function retryIndexingAction(input: {
  proposalId: string;
}): Promise<RetryIndexingResult | ActionUnknown> {
  let result: RetryIndexingResult;
  try {
    result = await retryProposalIndexing(await getSessionActor(), input);
  } catch (error) {
    unstable_rethrow(error);
    return unknownResult("retry indexing");
  }
  if (result.ok) {
    revalidateAfterCommit([PROPOSALS_PATH, proposalPath(idOf(input?.proposalId))]);
  }
  return result;
}
