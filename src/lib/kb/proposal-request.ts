// KB proposal request (Phase 12.2, AIDA-18, plan 12.2-04): an active owner or admin selects 1 to
// 5 resolved tickets and AIDA starts drafting one KB article from them (D-01, D-07, D-09, D-13).
//
// One transaction, checks in this order (merge.ts pattern):
//   1. findActiveMembership is the first statement: no member row is MEMBERSHIP_ENDED (D-01).
//   2. The exact owner or admin role through isAdminRole, else NOT_ALLOWED.
//   3. The count, 1 to 5, else COUNT (an empty selection included).
//   4. aiEnabled read through scopedDb with the organization term; anything but 'true' is AI_OFF
//      (D-09: complete() does not check it, the caller does).
//   5. checkSourceEligibility (proposal-sources.ts); any failing ticket refuses the whole request
//      with SELECTION and one typed reason per failing ticket, never a silent drop (D-07).
// On success it creates one KbProposal in GENERATING (version 0 and generationEpoch 1 by column
// default, requestedByUserId, generationQueuedAt = the request's now, review C5) and one
// KbProposalSource per ticket with positions 1 to n in selection order, every row with an
// explicit organizationId.
//
// Error contract: a ProposalRequestError thrown inside the transaction rolls it back and is
// RETURNED as a typed refusal; any other error rolls back and is RETHROWN unchanged. A refused
// request leaves no proposal, no source and sends no job.
//
// Enqueue (D-13, review R2-3): only after commit, kb-proposal-generate with ProposalJobPayload
// { proposalId, epoch } and nothing else, epoch read back from the created row. No ticket data
// crosses the queue. A send that fails after commit is caught and logged with the proposal id and
// a fixed text only; the request still returns ok, and the GENERATING row with its
// generationQueuedAt is the durable marker that Restart generation recovers (plan 12.2-05).
//
// Relative imports only and no Next.js import: revalidation belongs to the server action.
import { findActiveMembership, isAdminRole } from "../membership";
import { getBoss } from "../queue/boss-client";
import { scopedDb } from "../scoped-db";
import {
  KB_PROPOSAL_GENERATE_QUEUE,
  MAX_PROPOSAL_SOURCES,
  MIN_PROPOSAL_SOURCES,
  type ProposalJobPayload,
  type RequestRefusalCode,
} from "./proposal-contract";
import { checkSourceEligibility, type SourceRefusal } from "./proposal-sources";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export interface ProposalRequestActor {
  userId: string;
  orgId: string;
}

export interface ProposalRequestOptions {
  /** The request's clock (tests inject it); generationQueuedAt is set from it. */
  now?: () => Date;
}

export type ProposalRequestResult =
  | { ok: true; proposalId: string }
  | { ok: false; code: RequestRefusalCode; refusals?: SourceRefusal[] };

/** A refusal of the request. Rolled back and returned, never rethrown. */
export class ProposalRequestError extends Error {
  readonly code: RequestRefusalCode;
  readonly refusals?: SourceRefusal[];

  constructor(code: RequestRefusalCode, refusals?: SourceRefusal[]) {
    super(`KB proposal request refused: ${code}`);
    this.name = "ProposalRequestError";
    this.code = code;
    if (refusals) this.refusals = refusals;
  }
}

/** Starts a proposal from the selected tickets, or returns a typed refusal. */
export async function requestProposal(
  actor: ProposalRequestActor,
  ticketIds: readonly string[],
  opts: ProposalRequestOptions = {},
): Promise<ProposalRequestResult> {
  const { userId, orgId } = actor;
  // findActiveMembership answers null for an empty id; scopedDb would throw first.
  if (!userId || !orgId) return { ok: false, code: "MEMBERSHIP_ENDED" };
  const now = (opts.now ?? (() => new Date()))();

  let created: { id: string; generationEpoch: number };
  try {
    created = await scopedDb(orgId).$transaction(async (tx) => {
      // D-01: the first statement; nothing about the tickets is read before it.
      const membership = await findActiveMembership(tx, userId, orgId);
      if (!membership) throw new ProposalRequestError("MEMBERSHIP_ENDED");
      if (!isAdminRole(membership.role)) throw new ProposalRequestError("NOT_ALLOWED");

      const ids: readonly unknown[] = Array.isArray(ticketIds) ? ticketIds : [];
      if (ids.length < MIN_PROPOSAL_SOURCES || ids.length > MAX_PROPOSAL_SOURCES) {
        throw new ProposalRequestError("COUNT");
      }

      const aiSetting = await tx.setting.findFirst({
        where: { organizationId: orgId, key: "aiEnabled" },
        select: { value: true },
      });
      if (aiSetting?.value !== "true") throw new ProposalRequestError("AI_OFF");

      const eligibility = await checkSourceEligibility(tx, orgId, ids);
      if (!eligibility.ok) throw new ProposalRequestError("SELECTION", eligibility.refusals);

      const proposal = await tx.kbProposal.create({
        data: {
          organizationId: orgId,
          status: "GENERATING",
          requestedByUserId: userId,
          generationQueuedAt: now,
        },
        select: { id: true, generationEpoch: true },
      });
      await tx.kbProposalSource.createMany({
        data: eligibility.tickets.map((ticket) => ({
          organizationId: orgId,
          proposalId: proposal.id,
          ticketId: ticket.id,
          position: ticket.position,
        })),
      });
      return proposal;
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof ProposalRequestError) {
      return err.refusals
        ? { ok: false, code: err.code, refusals: err.refusals }
        : { ok: false, code: err.code };
    }
    throw err;
  }

  // After commit only (D-13). The payload is the proposal id and its generation epoch, nothing else.
  const payload: ProposalJobPayload = { proposalId: created.id, epoch: created.generationEpoch };
  try {
    const boss = await getBoss();
    await boss.send(KB_PROPOSAL_GENERATE_QUEUE, payload);
  } catch {
    console.error(`kb-proposal-request: enqueue failed for ${created.id}`);
  }

  return { ok: true, proposalId: created.id };
}
