// KB proposals (Phase 12.2, AIDA-18): the frozen contract every later plan of the phase imports
// (D-17, freeze first). Pure and client-safe: no runtime Prisma import, relative imports only;
// the copy module (plan 12.2-06), the services and the worker import it. The status and failure
// code lists equal the generated Prisma enums KbProposalStatus and KbProposalFailureCode, which a
// unit test checks.
//
// Status machine (D-03, D-16):
//   * GENERATING to DRAFT or FAILED, by the generation job only.
//   * DRAFT to PUBLISHED or REJECTED, by an active owner or admin only (D-01).
//   * REJECTED, PUBLISHED and FAILED are final. Regeneration (also after FAILED) creates a new
//     proposal; a rejected proposal can never be published.
//   * The database trigger aida_kb_proposal_status_fence (migration 20261111100000_kb_proposals)
//     enforces the same pairs and refuses any change of title, body or published article on a
//     final row; the CHECK KbProposal_status_fields_check holds the columns each status needs.
//
// Version rule (D-16): every write is a conditional update on id, organizationId, status and
// version, and increments version. A count of 0 is CONFLICT when the re-read row is still in the
// expected status, else NOT_DRAFT.
//
// Claim lease of the job (D-13, review C5): the request sets generationQueuedAt. The job claims
// by setting generationClaimedAt and incrementing version; another job may claim only when
// generationClaimedAt is null or older than STUCK_AFTER_MS. A transient failure releases the
// lease, before it rethrows, with a conditional update that also sets generationQueuedAt (pg-boss
// queues the retry). A restart clears generationClaimedAt and sets generationQueuedAt in one
// conditional update. isStuck counts from generationClaimedAt, else generationQueuedAt, never
// from the row's creation timestamp, so a proposal is not stuck again right after a restart. Only
// a conditional update on the claimed version stores a result.
//
// Generation epoch (review R2-3): generationEpoch is 1 at request, and the same restart update
// increments it. Every send of kb-proposal-generate carries ProposalJobPayload
// { proposalId, epoch } with the row's epoch at that moment. The job returns without a provider
// call and without any write when the payload fails isProposalJobPayload or the row's epoch
// differs from the payload's. The claim, the lease release and every storing or failing update of
// the job require generationEpoch to equal the payload's epoch, so a pg-boss retry of a generation
// that a restart superseded can never claim, fail or store the new one. D-13's "the job carries
// only the proposal id" is kept in substance: no ticket data crosses the queue.
//
// Field rules (D-11, run decision K51, reviews C7, R2-2, R3-3 and P8): the forbidden reference
// forms are exactly
//   (a) a source marker [T<n>] in the title or the body, refused as CITATION_MARKER, and
//   (b) a link to a ticket page in the title or the body, refused as TICKET_LINK. A ticket page is
//       a relative or absolute URL whose path, after percent-decoding, starts with /tickets/.
//       It is checked on the raw text, where a bare path counts wherever it stands as a
//       whitespace-delimited token after stripping wrapping punctuation, and on every URL
//       attribute of the body's rendered HTML that renderMarkdown's sanitizer keeps, at least
//       a href and img src. A link to another site whose path starts with /tickets/ is refused
//       too (fail-closed, a documented false positive).
// A ticket number in free prose such as "#123" stays allowed and is the reviewer's responsibility
// under the publish checklist. Fail-closed: nothing is stripped. Generation, save and publish all
// apply these rules (validators in plan 12.2-02).
//
// Publish lock (review C1, plan 12.2-05): the publish transaction's first statement share-locks
// the actor's member row, so a concurrent demotion or member removal waits for the publish to
// commit or roll back.
//
// Source rules (D-07, D-08, D-10; owner item 12.2-o3 default): 1 to 5 tickets of the organization
// whose state group is RESOLVED or CLOSED, never a state name. A merged source is refused with
// its target's number. The whole request is refused with one reason per failing ticket, never a
// silent drop. Eligibility is checked at request time and again in the job before any ticket text
// is read. Only the subject and PUBLIC messages are read.
//
// Audit shape (D-02, D-12, run decision K49): one AuditEvent per provider call that returned
// output, actionType KB_PROPOSAL_GENERATED, ticketId null, kbProposalId set, the real provider and
// model, input the redactedPrompt of complete(), output the model output. Review actions (edit,
// reject, publish) are recorded on the KbProposal columns only, never in AuditEvent.
//
// AI-off semantics (D-09): a request is refused while AI is off (AI_OFF). The job re-checks right
// before the provider call and fails the proposal with AI_OFF. A call already running may finish
// and is stored as DRAFT. Review, edit, reject and publish of existing drafts stay available and
// never call the LLM.

// --- Statuses and failure codes ----------------------------------------------------------------

/** Equal to the generated KbProposalStatus enum, in declaration order. */
export const PROPOSAL_STATUSES = [
  "GENERATING",
  "DRAFT",
  "REJECTED",
  "PUBLISHED",
  "FAILED",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Equal to the generated KbProposalFailureCode enum, in declaration order. */
export const PROPOSAL_FAILURE_CODES = [
  "AI_OFF",
  "SOURCE_CHANGED",
  "PROVIDER",
  "INVALID_OUTPUT",
  "CONFIGURATION",
  "REQUESTER_NOT_ALLOWED",
  "UNKNOWN",
] as const;

export type ProposalFailureCode = (typeof PROPOSAL_FAILURE_CODES)[number];

const FINAL_STATUSES: ReadonlySet<ProposalStatus> = new Set(["REJECTED", "PUBLISHED", "FAILED"]);

const ALLOWED_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  GENERATING: ["DRAFT", "FAILED"],
  DRAFT: ["PUBLISHED", "REJECTED"],
  REJECTED: [],
  PUBLISHED: [],
  FAILED: [],
};

/** True exactly for the four allowed status changes (D-16). */
export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** True for REJECTED, PUBLISHED and FAILED. */
export function isFinalStatus(status: ProposalStatus): boolean {
  return FINAL_STATUSES.has(status);
}

// --- Sources -------------------------------------------------------------------------------------

/** The state groups a source ticket may be in (D-07, owner item 12.2-o3 default). */
export const ELIGIBLE_SOURCE_GROUPS = ["RESOLVED", "CLOSED"] as const;

export type EligibleSourceGroup = (typeof ELIGIBLE_SOURCE_GROUPS)[number];

export const MIN_PROPOSAL_SOURCES = 1;
export const MAX_PROPOSAL_SOURCES = 5;

// --- Timing, queue and audit -------------------------------------------------------------------

/** A GENERATING proposal whose lease or queue time is this old may be restarted (10 minutes). */
export const STUCK_AFTER_MS = 600_000;

/** The review page polls a GENERATING proposal at this interval. */
export const PROPOSAL_POLL_INTERVAL_MS = 5_000;

/** The pg-boss queue of the generation job. */
export const KB_PROPOSAL_GENERATE_QUEUE = "kb-proposal-generate";

/** pg-boss retryLimit of the generation job (transient failures only, D-14). */
export const KB_PROPOSAL_JOB_RETRY_LIMIT = 2;

/** The AuditActionType value of a generation row (D-12). */
export const KB_PROPOSAL_AUDIT_ACTION = "KB_PROPOSAL_GENERATED" as const;

export interface StuckCheckInput {
  status: ProposalStatus;
  generationClaimedAt: Date | null;
  generationQueuedAt: Date;
}

/**
 * True for a GENERATING proposal whose generationClaimedAt, or generationQueuedAt while no job
 * holds the lease, is at least STUCK_AFTER_MS before now (review C5). The clock is injected.
 */
export function isStuck(proposal: StuckCheckInput, now: Date): boolean {
  if (proposal.status !== "GENERATING") return false;
  const since = proposal.generationClaimedAt ?? proposal.generationQueuedAt;
  return now.getTime() - since.getTime() >= STUCK_AFTER_MS;
}

// --- Job payload (review R2-3) -----------------------------------------------------------------

/** The only payload of kb-proposal-generate: the proposal id and the generation epoch. */
export interface ProposalJobPayload {
  proposalId: string;
  epoch: number;
}

/**
 * True only for an object with exactly the keys proposalId (a non-empty string) and epoch (a
 * positive safe integer). A payload without an epoch (sent before this rule) is refused.
 */
export function isProposalJobPayload(value: unknown): value is ProposalJobPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("proposalId") || !keys.includes("epoch")) return false;
  const { proposalId, epoch } = value as Record<string, unknown>;
  return (
    typeof proposalId === "string" &&
    proposalId.length > 0 &&
    typeof epoch === "number" &&
    Number.isSafeInteger(epoch) &&
    epoch > 0
  );
}

// --- Refusal codes -------------------------------------------------------------------------------

/** Refusals of a proposal request as a whole. */
export const REQUEST_REFUSAL_CODES = [
  "AI_OFF",
  "COUNT",
  "NOT_ALLOWED",
  "MEMBERSHIP_ENDED",
  "SELECTION",
] as const;

export type RequestRefusalCode = (typeof REQUEST_REFUSAL_CODES)[number];

/** One reason per failing ticket inside a SELECTION refusal (D-07). */
export const TICKET_REFUSAL_REASONS = ["NOT_RESOLVED", "MERGED", "NOT_FOUND", "DUPLICATE"] as const;

export type TicketRefusalReason = (typeof TICKET_REFUSAL_REASONS)[number];

/** Refusals of list, read, save, reject and publish (TICKET_LINK: review C7, K51). */
export const REVIEW_REFUSAL_CODES = [
  "NOT_ALLOWED",
  "MEMBERSHIP_ENDED",
  "NOT_FOUND",
  "NOT_DRAFT",
  "CONFLICT",
  "CITATION_MARKER",
  "TICKET_LINK",
  "TITLE_TOO_SHORT",
  "TITLE_TOO_LONG",
  "BODY_REQUIRED",
] as const;

export type ReviewRefusalCode = (typeof REVIEW_REFUSAL_CODES)[number];

/** Refusals of restart and retry indexing. */
export const MAINTENANCE_REFUSAL_CODES = [
  "NOT_ALLOWED",
  "MEMBERSHIP_ENDED",
  "NOT_FOUND",
  "NOT_STUCK",
  "NOT_RETRYABLE",
  "CONFLICT",
] as const;

export type MaintenanceRefusalCode = (typeof MAINTENANCE_REFUSAL_CODES)[number];
