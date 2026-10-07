// KB proposal review (Phase 12.2, AIDA-18, plan 12.2-05): save (edit), reject, approve and
// publish, restart of a stuck generation and retry of indexing. The only code path in the phase
// that creates a KbArticle from a proposal is publishProposal, after an explicit owner or admin
// action (D-06, D-15); nothing here calls the LLM.
//
// Authorization (D-01, review C1): every action checks the active membership and then the exact
// owner or admin role (isAdminRole) inside its transaction, before any read of the proposal. A
// deleted member row is MEMBERSHIP_ENDED, a plain member NOT_ALLOWED. Publish takes the actor's
// member rows FOR SHARE as its first statement (shareLockActiveMembership: every row of the user in
// the organization, in id order, admin only when every row is owner or admin, review a-WR-03), so
// a demotion or a member delete cannot commit between publish's role check and its commit. Save, reject, restart and retry keep
// the plain findActiveMembership read: they publish nothing. The CHECKs and the status trigger of
// plan 12.2-01 are integrity fences, not authorization; writes by a privileged database user are
// out of scope.
//
// Lock order of publish: the member row (FOR SHARE), the proposal row (the conditional claim
// update), then the article insert. Every transaction runs at the database default isolation
// (READ COMMITTED).
//
// Version rule (D-16): every write is a conditional update on (id, organizationId, status,
// version) that increments version. A count of 0 re-reads the row: missing (or another
// organization's) is NOT_FOUND, still in the expected status is CONFLICT, else NOT_DRAFT (restart:
// NOT_STUCK). Publish increments the version once, in its claim; its final update to PUBLISHED is
// conditional on the claimed version.
//
// Field rules (run decision K51, reviews C7, R2-2, R3-3, P8): save and publish return the first
// refusal of validateDraftFields with its field, fail-closed, nothing stripped. Publish validates
// the STORED title and body after its claim (never client-supplied text) and inserts exactly those
// through createKbArticleInTx, whose bodyHtml comes from renderMarkdown, the same renderer the
// validator checks. Citations are never copied into the article.
//
// Error contract (merge.ts pattern): a ProposalReviewError thrown inside a transaction rolls it
// back and is RETURNED as { ok: false, code, field? }; any other error rolls back and is RETHROWN.
// A slug unique violation from a concurrent publish rolls the whole publish back and it is retried
// with a fresh slug, at most PUBLISH_MAX_ATTEMPTS attempts (D-06, pattern finding C3); when they
// run out, publish returns SLUG_UNAVAILABLE (review a-IN-03), since nothing changed. An untrusted
// id or text holding a NUL character, which Postgres refuses, is treated as absent: NOT_FOUND, or
// the field's empty-value refusal (review a-IN-03).
//
// Enqueue (D-06, D-13, run decision K50): only after commit, inside a try. A failing send never
// undoes the commit: publish returns indexingQueued false (the article's embeddingStatus PENDING
// is the durable marker), restart and retry return queued false. No transactional outbox.
//
// Restart (D-13, reviews C5 and R2-3): only a GENERATING proposal that isStuck at the injected
// clock; one conditional update clears generationClaimedAt, sets generationQueuedAt to now,
// increments version and generationEpoch, and the post-commit send carries the new epoch.
//
// Retry indexing (reviews C2 and R3-2): the claim is ONE conditional update of the article
// (embeddingStatus PENDING or FAILED, explicit id and organizationId terms) that sets PENDING; a
// count of 0 (COMPLETED, also when a job completed it after the proposal was read) is
// NOT_RETRYABLE and sends nothing. It never reads the status first and never calls the
// unconditional re-embed helper of create-article.ts, which stays as it is for re-embed-all. A
// second job for one article is safe through plan 12.2-03's locked swap.
//
// Relative imports only and no Next.js import: revalidation belongs to the server action.
import { findActiveMembership, isAdminRole, shareLockActiveMembership } from "../membership";
import { getBoss } from "../queue/boss-client";
import { scopedDb } from "../scoped-db";
import { createKbArticleInTx, isSlugUniqueViolation } from "./create-article";
import {
  isStuck,
  KB_PROPOSAL_GENERATE_QUEUE,
  type MaintenanceRefusalCode,
  type ProposalJobPayload,
  type ReviewRefusalCode,
} from "./proposal-contract";
import { type DraftField, validateDraftFields } from "./proposal-schema";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** The embedding job's queue (src/lib/worker/jobs/kb-embed-article.ts). */
const KB_EMBED_ARTICLE_QUEUE = "kb-embed-article";

/** Attempts of one publish when a concurrent publish took the same slug (D-06). */
export const PUBLISH_MAX_ATTEMPTS = 3;

export interface ProposalReviewActor {
  userId: string;
  orgId: string;
}

export interface ProposalReviewOptions {
  /** The action's clock (tests inject it); defaults to the current time. */
  now?: Date;
}

/** Any transaction client that runs tagged raw SQL (the hooks record its backend PID). */
export interface ProposalReviewTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/** Test seam of the review actions (race proofs). Production code never sets it. */
export interface ProposalReviewObserver {
  /** Awaited as the first statement of every action's transaction, before the membership read. */
  onTransactionStart?(tx: ProposalReviewTx): Promise<void> | void;
  /** Publish only: awaited right after the member-row share lock. */
  afterMembershipLock?(tx: ProposalReviewTx): Promise<void> | void;
  /** Awaited right after the conditional proposal update (save, reject, restart, publish). */
  afterProposalUpdate?(tx: ProposalReviewTx): Promise<void> | void;
  /** Publish only: awaited right after the article insert. */
  afterArticleInsert?(tx: ProposalReviewTx): Promise<void> | void;
}

let reviewObserver: ProposalReviewObserver | null = null;

/**
 * Test seam only (shape of setCreateTicketObserverForTests): lets a race test record an action's
 * backend PID and hold it with its locks taken. null clears it. Production never sets it.
 */
export function setProposalReviewObserverForTests(observer: ProposalReviewObserver | null): void {
  reviewObserver = observer;
}

type RefusalCode = ReviewRefusalCode | MaintenanceRefusalCode;

/** A refusal of a review action. Rolled back and returned, never rethrown. */
export class ProposalReviewError extends Error {
  readonly code: RefusalCode;
  readonly field?: DraftField;

  constructor(code: RefusalCode, field?: DraftField) {
    super(`KB proposal review refused: ${code}`);
    this.name = "ProposalReviewError";
    this.code = code;
    if (field) this.field = field;
  }
}

export type ReviewRefusal = { ok: false; code: ReviewRefusalCode; field?: DraftField };
export type MaintenanceRefusal = { ok: false; code: MaintenanceRefusalCode };

export interface ProposalVersionInput {
  proposalId: string;
  expectedVersion: number;
}

export interface SaveProposalInput extends ProposalVersionInput {
  title: string;
  bodyMarkdown: string;
}

export type SaveProposalResult = { ok: true; version: number } | ReviewRefusal;
export type RejectProposalResult = { ok: true } | ReviewRefusal;
/** Review a-IN-03: every publish attempt met a slug unique violation; nothing changed. */
export type SlugUnavailableRefusal = { ok: false; code: "SLUG_UNAVAILABLE" };
export type PublishProposalResult =
  | { ok: true; articleId: string; indexingQueued: boolean }
  | ReviewRefusal
  | SlugUnavailableRefusal;
export type RestartProposalResult = { ok: true; queued: boolean } | MaintenanceRefusal;
export type RetryIndexingResult = { ok: true; queued: boolean } | MaintenanceRefusal;

function toReviewRefusal(err: ProposalReviewError): ReviewRefusal {
  const code = err.code as ReviewRefusalCode;
  return err.field ? { ok: false, code, field: err.field } : { ok: false, code };
}

function toMaintenanceRefusal(err: ProposalReviewError): MaintenanceRefusal {
  return { ok: false, code: err.code as MaintenanceRefusalCode };
}

/**
 * Review a-IN-03: Postgres refuses a NUL character in text (22021). An untrusted string holding
 * one is treated as absent, so it ends in a typed refusal instead of a raw database error.
 */
function hasNul(value: string): boolean {
  return value.includes("\u0000");
}

/** An untrusted id: anything but a string without NUL never matches a row (NOT_FOUND). */
function asId(value: unknown): string {
  return typeof value === "string" && !hasNul(value) ? value : "";
}

/**
 * An untrusted text field: anything but a string without NUL is treated as empty and refused by
 * validateDraftFields as a field error (TITLE_TOO_SHORT or BODY_REQUIRED on that field).
 */
function asText(value: unknown): string {
  return typeof value === "string" && !hasNul(value) ? value : "";
}

/** An untrusted version: anything but a non-negative safe integer never matches (version >= 0). */
function asVersion(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

/** The client the miss re-read needs (any scoped or plain transaction client fits). */
interface ProposalStatusReader {
  kbProposal: {
    findFirst(args: {
      where: { id: string; organizationId: string };
      select: { status: true };
    }): PromiseLike<{ status: string } | null>;
  };
}

/**
 * The refusal for a conditional update that matched no row: NOT_FOUND when the row is missing or
 * another organization's, CONFLICT when it is still in the expected status (a stale version), else
 * the action's wrong-status code.
 */
async function missRefusal(
  tx: ProposalStatusReader,
  orgId: string,
  proposalId: string,
  expectedStatus: string,
  wrongStatusCode: RefusalCode,
): Promise<ProposalReviewError> {
  const row = proposalId
    ? await tx.kbProposal.findFirst({
        where: { id: proposalId, organizationId: orgId },
        select: { status: true },
      })
    : null;
  if (!row) return new ProposalReviewError("NOT_FOUND");
  if (row.status === expectedStatus) return new ProposalReviewError("CONFLICT");
  return new ProposalReviewError(wrongStatusCode);
}

/** Sends one job after commit; false when the send throws (logged with a fixed text and the id). */
async function sendAfterCommit(queue: string, payload: object, id: string): Promise<boolean> {
  try {
    const boss = await getBoss();
    await boss.send(queue, payload);
    return true;
  } catch {
    console.error(`kb-proposal-review: enqueue on ${queue} failed for ${id}`);
    return false;
  }
}

/** The client the plain membership check needs (see findActiveMembership). */
type MembershipReader = Parameters<typeof findActiveMembership>[0];

/** D-01: active membership, then the exact owner or admin role; before any read of the proposal. */
async function requireAdmin(tx: MembershipReader, userId: string, orgId: string): Promise<void> {
  const membership = await findActiveMembership(tx, userId, orgId);
  if (!membership) throw new ProposalReviewError("MEMBERSHIP_ENDED");
  if (!isAdminRole(membership.role)) throw new ProposalReviewError("NOT_ALLOWED");
}

// --- Save -----------------------------------------------------------------------------------------

/**
 * Saves an edit of a DRAFT (D-11, D-15): validateDraftFields first (its first refusal with the
 * field, nothing stripped), then title and body by the conditional update, which increments
 * version and records the editor. Never publishes and never creates a KbArticle.
 */
export async function saveProposalDraft(
  actor: ProposalReviewActor,
  input: SaveProposalInput,
  opts: ProposalReviewOptions = {},
): Promise<SaveProposalResult> {
  const { userId, orgId } = actor;
  if (!userId || !orgId) return { ok: false, code: "MEMBERSHIP_ENDED" };
  const proposalId = asId(input.proposalId);
  const expectedVersion = asVersion(input.expectedVersion);
  const now = opts.now ?? new Date();

  try {
    const version = await scopedDb(orgId).$transaction(async (tx) => {
      if (reviewObserver?.onTransactionStart) await reviewObserver.onTransactionStart(tx);
      await requireAdmin(tx, userId, orgId);

      const checked = validateDraftFields({
        title: asText(input.title),
        bodyMarkdown: asText(input.bodyMarkdown),
      });
      if (!checked.ok) throw new ProposalReviewError(checked.code, checked.field);

      const updated = await tx.kbProposal.updateMany({
        where: { id: proposalId, organizationId: orgId, status: "DRAFT", version: expectedVersion },
        data: {
          title: checked.title,
          bodyMarkdown: checked.bodyMarkdown,
          version: { increment: 1 },
          lastEditedByUserId: userId,
          lastEditedAt: now,
        },
      });
      if (updated.count === 0) {
        throw await missRefusal(tx, orgId, proposalId, "DRAFT", "NOT_DRAFT");
      }
      if (reviewObserver?.afterProposalUpdate) await reviewObserver.afterProposalUpdate(tx);
      return expectedVersion + 1;
    }, TRANSACTION_OPTIONS);
    return { ok: true, version };
  } catch (err) {
    if (err instanceof ProposalReviewError) return toReviewRefusal(err);
    throw err;
  }
}

// --- Reject ---------------------------------------------------------------------------------------

/** Rejects a DRAFT (D-16): terminal, the row is kept, and it can never be published. */
export async function rejectProposal(
  actor: ProposalReviewActor,
  input: ProposalVersionInput,
  opts: ProposalReviewOptions = {},
): Promise<RejectProposalResult> {
  const { userId, orgId } = actor;
  if (!userId || !orgId) return { ok: false, code: "MEMBERSHIP_ENDED" };
  const proposalId = asId(input.proposalId);
  const expectedVersion = asVersion(input.expectedVersion);
  const now = opts.now ?? new Date();

  try {
    await scopedDb(orgId).$transaction(async (tx) => {
      if (reviewObserver?.onTransactionStart) await reviewObserver.onTransactionStart(tx);
      await requireAdmin(tx, userId, orgId);

      const updated = await tx.kbProposal.updateMany({
        where: { id: proposalId, organizationId: orgId, status: "DRAFT", version: expectedVersion },
        data: {
          status: "REJECTED",
          rejectedByUserId: userId,
          rejectedAt: now,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw await missRefusal(tx, orgId, proposalId, "DRAFT", "NOT_DRAFT");
      }
      if (reviewObserver?.afterProposalUpdate) await reviewObserver.afterProposalUpdate(tx);
    }, TRANSACTION_OPTIONS);
    return { ok: true };
  } catch (err) {
    if (err instanceof ProposalReviewError) return toReviewRefusal(err);
    throw err;
  }
}

// --- Publish -------------------------------------------------------------------------------------

/** One attempt of the publish transaction; returns the new article's id. */
async function publishAttempt(
  actor: ProposalReviewActor,
  proposalId: string,
  expectedVersion: number,
  now: Date,
): Promise<string> {
  const { userId, orgId } = actor;
  return scopedDb(orgId).$transaction(async (tx) => {
    if (reviewObserver?.onTransactionStart) await reviewObserver.onTransactionStart(tx);

    // Review C1: the first statement. The member rows stay share-locked until this commits.
    const membership = await shareLockActiveMembership(tx, userId, orgId);
    if (reviewObserver?.afterMembershipLock) await reviewObserver.afterMembershipLock(tx);
    if (!membership) throw new ProposalReviewError("MEMBERSHIP_ENDED");
    if (!isAdminRole(membership.role)) throw new ProposalReviewError("NOT_ALLOWED");

    // The claim (D-06, D-16): still DRAFT at the expected version; increments version.
    const claim = await tx.kbProposal.updateMany({
      where: { id: proposalId, organizationId: orgId, status: "DRAFT", version: expectedVersion },
      data: { version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw await missRefusal(tx, orgId, proposalId, "DRAFT", "NOT_DRAFT");
    }
    if (reviewObserver?.afterProposalUpdate) await reviewObserver.afterProposalUpdate(tx);

    // Only the stored, saved version is published (T-12.2-22).
    const stored = await tx.kbProposal.findFirst({
      where: { id: proposalId, organizationId: orgId },
      select: { title: true, bodyMarkdown: true },
    });
    if (!stored || stored.title === null || stored.bodyMarkdown === null) {
      throw new Error("kb-proposal-review: claimed proposal has no stored title or body");
    }
    const checked = validateDraftFields({ title: stored.title, bodyMarkdown: stored.bodyMarkdown });
    if (!checked.ok) throw new ProposalReviewError(checked.code, checked.field);

    const article = await createKbArticleInTx(tx, orgId, {
      title: stored.title,
      bodyMarkdown: stored.bodyMarkdown,
    });
    if (reviewObserver?.afterArticleInsert) await reviewObserver.afterArticleInsert(tx);

    const done = await tx.kbProposal.updateMany({
      where: {
        id: proposalId,
        organizationId: orgId,
        status: "DRAFT",
        version: expectedVersion + 1,
      },
      data: {
        status: "PUBLISHED",
        publishedArticleId: article.id,
        publishedAt: now,
        publishedByUserId: userId,
      },
    });
    if (done.count !== 1) throw new Error("kb-proposal-review: publish lost its claimed row");
    return article.id;
  }, TRANSACTION_OPTIONS);
}

/**
 * Approve and publish (D-06): creates exactly one KbArticle from the stored draft at the expected
 * version, links it back and enqueues its embedding after commit. A refusal changes nothing.
 */
export async function publishProposal(
  actor: ProposalReviewActor,
  input: ProposalVersionInput,
  opts: ProposalReviewOptions = {},
): Promise<PublishProposalResult> {
  if (!actor.userId || !actor.orgId) return { ok: false, code: "MEMBERSHIP_ENDED" };
  const proposalId = asId(input.proposalId);
  const expectedVersion = asVersion(input.expectedVersion);
  const now = opts.now ?? new Date();

  let articleId: string | null = null;
  for (let attempt = 1; articleId === null; attempt += 1) {
    try {
      articleId = await publishAttempt(actor, proposalId, expectedVersion, now);
    } catch (err) {
      if (err instanceof ProposalReviewError) return toReviewRefusal(err);
      if (!isSlugUniqueViolation(err)) throw err;
      // A concurrent publish took the slug: the whole transaction rolled back; try again. Once
      // the attempts run out the outcome is still known (review a-IN-03): nothing changed.
      if (attempt < PUBLISH_MAX_ATTEMPTS) continue;
      return { ok: false, code: "SLUG_UNAVAILABLE" };
    }
  }

  const indexingQueued = await sendAfterCommit(KB_EMBED_ARTICLE_QUEUE, { articleId }, articleId);
  return { ok: true, articleId, indexingQueued };
}

// --- Restart a stuck generation (D-13, reviews C5 and R2-3) ------------------------------------

/**
 * Restarts a GENERATING proposal that isStuck at the injected clock: one conditional update clears
 * the lease, sets generationQueuedAt to now and increments version and generationEpoch; after
 * commit kb-proposal-generate is sent with { proposalId, epoch } carrying the new epoch, so every
 * job sent before the restart is stale. The same proposal id is reused.
 */
export async function restartProposalGeneration(
  actor: ProposalReviewActor,
  input: ProposalVersionInput,
  opts: ProposalReviewOptions = {},
): Promise<RestartProposalResult> {
  const { userId, orgId } = actor;
  if (!userId || !orgId) return { ok: false, code: "MEMBERSHIP_ENDED" };
  const proposalId = asId(input.proposalId);
  const expectedVersion = asVersion(input.expectedVersion);
  const now = opts.now ?? new Date();

  let epoch: number;
  try {
    epoch = await scopedDb(orgId).$transaction(async (tx) => {
      if (reviewObserver?.onTransactionStart) await reviewObserver.onTransactionStart(tx);
      await requireAdmin(tx, userId, orgId);

      const row = proposalId
        ? await tx.kbProposal.findFirst({
            where: { id: proposalId, organizationId: orgId },
            select: { status: true, generationClaimedAt: true, generationQueuedAt: true },
          })
        : null;
      if (!row) throw new ProposalReviewError("NOT_FOUND");
      if (!isStuck(row, now)) throw new ProposalReviewError("NOT_STUCK");

      const updated = await tx.kbProposal.updateManyAndReturn({
        where: {
          id: proposalId,
          organizationId: orgId,
          status: "GENERATING",
          version: expectedVersion,
        },
        data: {
          generationClaimedAt: null,
          generationQueuedAt: now,
          version: { increment: 1 },
          generationEpoch: { increment: 1 },
        },
        select: { generationEpoch: true },
      });
      const claimed = updated[0];
      if (!claimed) {
        throw await missRefusal(tx, orgId, proposalId, "GENERATING", "NOT_STUCK");
      }
      if (reviewObserver?.afterProposalUpdate) await reviewObserver.afterProposalUpdate(tx);
      return claimed.generationEpoch;
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof ProposalReviewError) return toMaintenanceRefusal(err);
    throw err;
  }

  const payload: ProposalJobPayload = { proposalId, epoch };
  const queued = await sendAfterCommit(KB_PROPOSAL_GENERATE_QUEUE, payload, proposalId);
  return { ok: true, queued };
}

// --- Retry indexing (reviews C2 and R3-2) -------------------------------------------------------

/**
 * Re-queues the embedding of a published proposal's article when it is PENDING or FAILED. The
 * claim is one conditional update of the article (no status read before it), so a job that
 * completed the article in between is never turned back to PENDING; a count of 0 is
 * NOT_RETRYABLE and nothing is sent. The send runs after commit; when it throws the claimed
 * PENDING stays and the result is queued false, so the retry can be repeated.
 */
export async function retryProposalIndexing(
  actor: ProposalReviewActor,
  input: { proposalId: string },
): Promise<RetryIndexingResult> {
  const { userId, orgId } = actor;
  if (!userId || !orgId) return { ok: false, code: "MEMBERSHIP_ENDED" };
  const proposalId = asId(input.proposalId);

  let articleId: string;
  try {
    articleId = await scopedDb(orgId).$transaction(async (tx) => {
      if (reviewObserver?.onTransactionStart) await reviewObserver.onTransactionStart(tx);
      await requireAdmin(tx, userId, orgId);

      const row = proposalId
        ? await tx.kbProposal.findFirst({
            where: { id: proposalId, organizationId: orgId },
            select: { status: true, publishedArticleId: true },
          })
        : null;
      if (!row) throw new ProposalReviewError("NOT_FOUND");
      if (row.status !== "PUBLISHED" || !row.publishedArticleId) {
        throw new ProposalReviewError("NOT_RETRYABLE");
      }

      // Review R3-2: the claim itself is the check. At READ COMMITTED an update that waited behind
      // the embed job's row lock re-evaluates this where on the committed row.
      const claim = await tx.kbArticle.updateMany({
        where: {
          id: row.publishedArticleId,
          organizationId: orgId,
          embeddingStatus: { in: ["PENDING", "FAILED"] },
        },
        data: { embeddingStatus: "PENDING" },
      });
      if (claim.count === 0) throw new ProposalReviewError("NOT_RETRYABLE");
      return row.publishedArticleId;
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof ProposalReviewError) return toMaintenanceRefusal(err);
    throw err;
  }

  const queued = await sendAfterCommit(KB_EMBED_ARTICLE_QUEUE, { articleId }, articleId);
  return { ok: true, queued };
}
