// generateProposal(proposalId, { epoch, attempt, now }) — the KB proposal generation job's service
// (Phase 12.2, AIDA-18, plan 12.2-07): claim the GENERATING proposal by conditional update, recheck
// the requester, the sources, the provider configuration and the AI switch, call the existing
// complete() port with a fixed system prompt and the fenced, redacted ticket prompt, record one
// KB_PROPOSAL_GENERATED audit event per returned call, validate the answer and store it as DRAFT
// by a second conditional update. Mirrors src/lib/rag/generate-draft.ts's complete() plus
// recordAuditEvent shape.
//
// Order (must-have truths 1 and 2): load, claim, requester recheck (D-01), eligibility recheck
// (D-08, before any ticket text is read), loadSourceInputs (subject and PUBLIC messages only,
// D-10), buildProposalPrompt, configuration check, aiEnabled check (D-09, right before the call),
// complete(), recordAuditEvent (D-12), validateProposalOutput (D-11, run decision K51), store.
//
// Concurrency (D-13, reviews C5 and R2-3). The load selects id and organizationId together
// (12 WR-01) and returns at once, with no provider call and no write, unless the row is
// GENERATING, its generationEpoch equals the payload's epoch and its lease is free (no
// generationClaimedAt) or stuck. The claim is one conditional update on (id, organizationId,
// GENERATING, the version read, generationEpoch = epoch, lease free or stuck) that increments
// version and sets generationClaimedAt; a count of 0 returns without a provider call. Every later
// write of the job (the lease release, every FAILED write and the store) is a conditional update
// on claimedWhere: the claimed version AND generationEpoch = epoch. A job superseded by a newer
// claim or by Restart generation (which increments the epoch) therefore finds a count of 0 and
// discards its result: it can never store, fail or release the current generation. The claim and
// each later write run in short transactions; no transaction is open during complete().
//
// Failures (D-03, D-14, run decision K49). Only errors thrown by complete() are classified, with
// classifyLlmError: CONFIGURATION and INVALID_OUTPUT are terminal FAILED codes without a throw;
// TRANSIENT releases the lease (generationClaimedAt cleared, generationQueuedAt = now, because
// pg-boss queues the retry with the same payload and so the same epoch) and throws a fixed-text
// KbProposalRetryError while retryCount is below retryLimit, and is FAILED PROVIDER on the last
// attempt. A call that throws writes no AuditEvent. Any other exception after the claim is FAILED
// UNKNOWN by the same conditional update, rethrown only when that FAILED write itself fails. No
// raw provider error, prompt or model answer is written to the proposal row or to any log: the log
// lines below carry the proposal id and a code only.
//
// Relative imports only (no path alias): the worker bundles this module.
import { recordAuditEvent } from "../audit/record-audit-event";
import { prisma } from "../db";
import { complete } from "../llm/complete";
import { classifyLlmError } from "../llm/errors";
import { getLlmSettings, isProviderConfigured } from "../llm/settings";
import type { CompleteResult } from "../llm/types";
import { findActiveMembership, isAdminRole } from "../membership";
import { scopedDb } from "../scoped-db";
import {
  isStuck,
  KB_PROPOSAL_AUDIT_ACTION,
  type ProposalFailureCode,
  STUCK_AFTER_MS,
} from "./proposal-contract";
import { buildProposalPrompt, PROPOSAL_SYSTEM_PROMPT } from "./proposal-prompt";
import {
  type ProposalOutput,
  proposalOutputSchema,
  type ValidProposal,
  validateProposalOutput,
} from "./proposal-schema";
import { loadSourceInputs, recheckSourceEligibility } from "./proposal-sources";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** The structured-output schema name passed to complete() (OpenAI response_format name). */
const PROPOSAL_SCHEMA_NAME = "KbProposalOutput";

/** Output-token cap of one generation: room for a body of up to BODY_MAX code points plus JSON. */
const PROPOSAL_MAX_OUTPUT_TOKENS = 8192;

/** Any transaction client that runs tagged raw SQL (the hooks record its backend PID). */
export interface GenerateProposalTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/** Test seam of the generation job (race proofs). Production code never sets it. */
export interface GenerateProposalObserver {
  /** Awaited first inside the claim transaction, before the conditional claim update. */
  beforeClaim?(tx: GenerateProposalTx): Promise<void> | void;
  /**
   * Awaited inside the still-uncommitted claim transaction, right after a claim update that
   * matched (count 1), so a test holding it keeps the claimed row locked and the claim invisible.
   */
  afterClaim?(tx: GenerateProposalTx): Promise<void> | void;
  /** Awaited after the claim transaction committed, with no transaction open, before complete(). */
  beforeProviderCall?(): Promise<void> | void;
  /** Awaited inside the store transaction, before its conditional update. */
  beforeStore?(tx: GenerateProposalTx): Promise<void> | void;
}

let generateObserver: GenerateProposalObserver | null = null;

/**
 * Test seam only (shape of setProposalReviewObserverForTests): lets a test record a job's backend
 * PID and hold it at a defined point. null clears it. Production never sets it.
 */
export function setGenerateProposalObserverForTests(
  observer: GenerateProposalObserver | null,
): void {
  generateObserver = observer;
}

/** The pg-boss retry metadata of the running attempt (retryCount 0 is the first attempt). */
export interface GenerateProposalAttempt {
  retryCount: number;
  retryLimit: number;
}

export interface GenerateProposalOptions {
  /** The payload's generation epoch (review R2-3). */
  epoch: number;
  attempt: GenerateProposalAttempt;
  /** The job's clock (tests inject it); defaults to the current time. */
  now?: Date;
}

export type GenerateProposalSkipReason =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_GENERATING"
  | "STALE_EPOCH"
  | "LEASE_HELD"
  | "CLAIM_LOST";

export type GenerateProposalResult =
  /** Returned before any provider call and without any write. */
  | { outcome: "SKIPPED"; reason: GenerateProposalSkipReason }
  | { outcome: "DRAFT" }
  | { outcome: "FAILED"; code: ProposalFailureCode }
  /** The job's claim was superseded: its store, FAILED write or release matched no row. */
  | { outcome: "DISCARDED" };

/**
 * Thrown after a transient provider failure released the lease, so pg-boss retries the job with
 * the same payload. The message is fixed text: the provider's own error never reaches the
 * pg-boss job row or a log.
 */
export class KbProposalRetryError extends Error {
  constructor(proposalId: string) {
    super(`kb-proposal-generate: ${proposalId} transient failure, retry queued`);
    this.name = "KbProposalRetryError";
  }
}

type ScopedDb = ReturnType<typeof scopedDb>;

/** What the job owns after its claim: the row at the claimed version and the payload's epoch. */
interface ClaimedProposal {
  proposalId: string;
  orgId: string;
  epoch: number;
  /** The version the claim wrote (the version read plus one). */
  version: number;
  requestedByUserId: string;
  now: Date;
}

/** The where of every write after the claim: claimed version and payload epoch (review R2-3). */
function claimedWhere(claimed: ClaimedProposal) {
  return {
    id: claimed.proposalId,
    organizationId: claimed.orgId,
    status: "GENERATING" as const,
    version: claimed.version,
    generationEpoch: claimed.epoch,
  };
}

/** True while pg-boss will run another attempt after this one. */
function hasRetryLeft(attempt: GenerateProposalAttempt): boolean {
  return (
    Number.isSafeInteger(attempt.retryCount) &&
    Number.isSafeInteger(attempt.retryLimit) &&
    attempt.retryCount < attempt.retryLimit
  );
}

/**
 * Ends the claimed generation FAILED with a code by a conditional update on the claimed version
 * and the payload epoch. A count of 0 means a newer generation owns the row: nothing is written.
 */
async function failClaimed(
  db: ScopedDb,
  claimed: ClaimedProposal,
  code: ProposalFailureCode,
): Promise<GenerateProposalResult> {
  const count = await db.$transaction(async (tx) => {
    const update = await tx.kbProposal.updateMany({
      where: claimedWhere(claimed),
      data: {
        status: "FAILED",
        failureCode: code,
        failedAt: claimed.now,
        version: { increment: 1 },
      },
    });
    return update.count;
  }, TRANSACTION_OPTIONS);
  if (count === 0) {
    console.info(`kb-proposal-generate: ${claimed.proposalId} superseded, ${code} not written`);
    return { outcome: "DISCARDED" };
  }
  console.warn(`kb-proposal-generate: ${claimed.proposalId} failed ${code}`);
  return { outcome: "FAILED", code };
}

/**
 * Releases the lease after a transient failure (review C5): generationClaimedAt cleared,
 * generationQueuedAt set to now because pg-boss queues the retry, version + 1. Returns false when
 * the claim was superseded (nothing written).
 */
async function releaseClaimed(db: ScopedDb, claimed: ClaimedProposal): Promise<boolean> {
  const count = await db.$transaction(async (tx) => {
    const update = await tx.kbProposal.updateMany({
      where: claimedWhere(claimed),
      data: {
        generationClaimedAt: null,
        generationQueuedAt: claimed.now,
        version: { increment: 1 },
      },
    });
    return update.count;
  }, TRANSACTION_OPTIONS);
  return count === 1;
}

/** Maps an error thrown by complete() to its outcome (D-14). */
async function handleProviderError(
  db: ScopedDb,
  claimed: ClaimedProposal,
  attempt: GenerateProposalAttempt,
  err: unknown,
): Promise<GenerateProposalResult> {
  const kind = classifyLlmError(err);
  if (kind === "CONFIGURATION") return failClaimed(db, claimed, "CONFIGURATION");
  if (kind === "INVALID_OUTPUT") return failClaimed(db, claimed, "INVALID_OUTPUT");
  if (!hasRetryLeft(attempt)) return failClaimed(db, claimed, "PROVIDER");

  if (!(await releaseClaimed(db, claimed))) {
    // Superseded while the call ran: a retry would carry a stale epoch, so none is asked for.
    console.info(`kb-proposal-generate: ${claimed.proposalId} superseded, no retry`);
    return { outcome: "DISCARDED" };
  }
  console.warn(`kb-proposal-generate: ${claimed.proposalId} transient failure, retry queued`);
  throw new KbProposalRetryError(claimed.proposalId);
}

/**
 * Stores a valid answer as DRAFT by a conditional update on the claimed version and the payload
 * epoch, with each source's snapshot (the bigint largest PUBLIC seq of loadSourceInputs, never a
 * JavaScript number, review P1) and the section labels the model cited it for. A count of 0
 * discards the answer, so two workers can never both store one (D-13).
 */
async function storeDraft(
  db: ScopedDb,
  claimed: ClaimedProposal,
  value: ValidProposal,
  inputTruncated: boolean,
  snapshots: Record<string, bigint | null>,
  sources: readonly { ticketId: string; position: number }[],
): Promise<GenerateProposalResult> {
  const cited = new Map<number, string[]>();
  for (const citation of value.citations) {
    const labels = cited.get(citation.position) ?? [];
    if (!labels.includes(citation.section)) labels.push(citation.section);
    cited.set(citation.position, labels);
  }

  const stored = await db.$transaction(async (tx) => {
    if (generateObserver?.beforeStore) await generateObserver.beforeStore(tx);
    const update = await tx.kbProposal.updateMany({
      where: claimedWhere(claimed),
      data: {
        status: "DRAFT",
        title: value.title,
        bodyMarkdown: value.bodyMarkdown,
        inputTruncated,
        generatedAt: claimed.now,
        version: { increment: 1 },
      },
    });
    if (update.count === 0) return false;
    for (const source of sources) {
      await tx.kbProposalSource.updateMany({
        where: {
          organizationId: claimed.orgId,
          proposalId: claimed.proposalId,
          ticketId: source.ticketId,
        },
        data: {
          snapshotSeq: snapshots[source.ticketId] ?? null,
          citedSections: cited.get(source.position) ?? [],
        },
      });
    }
    return true;
  }, TRANSACTION_OPTIONS);

  if (!stored) {
    console.info(`kb-proposal-generate: ${claimed.proposalId} superseded, draft discarded`);
    return { outcome: "DISCARDED" };
  }
  console.info(`kb-proposal-generate: ${claimed.proposalId} stored DRAFT`);
  return { outcome: "DRAFT" };
}

/** Everything after the claim, in the order of the module comment. */
async function runClaimed(
  db: ScopedDb,
  claimed: ClaimedProposal,
  attempt: GenerateProposalAttempt,
): Promise<GenerateProposalResult> {
  // D-01: the requester must still be an active owner or admin.
  const membership = await findActiveMembership(db, claimed.requestedByUserId, claimed.orgId);
  if (!membership || !isAdminRole(membership.role)) {
    return failClaimed(db, claimed, "REQUESTER_NOT_ALLOWED");
  }

  // D-08: before any ticket text is read.
  const recheck = await recheckSourceEligibility(db, claimed.orgId, claimed.proposalId);
  if (!recheck.ok) return failClaimed(db, claimed, "SOURCE_CHANGED");

  // D-10: subject and PUBLIC messages only; the snapshot is each ticket's largest PUBLIC seq.
  const sources = await db.kbProposalSource.findMany({
    where: { organizationId: claimed.orgId, proposalId: claimed.proposalId },
    select: { ticketId: true, position: true },
    orderBy: { position: "asc" },
  });
  const loaded = await loadSourceInputs(db, claimed.orgId, sources);
  if (loaded.inputs.length !== sources.length) return failClaimed(db, claimed, "SOURCE_CHANGED");
  const { prompt, truncated } = buildProposalPrompt(loaded.inputs);

  const settings = await getLlmSettings(db);
  if (!isProviderConfigured(settings)) return failClaimed(db, claimed, "CONFIGURATION");

  // D-09: the AI switch, read right before the provider call.
  const aiSetting = await db.setting.findFirst({
    where: { organizationId: claimed.orgId, key: "aiEnabled" },
    select: { value: true },
  });
  if (aiSetting?.value !== "true") return failClaimed(db, claimed, "AI_OFF");

  if (generateObserver?.beforeProviderCall) await generateObserver.beforeProviderCall();

  // D-10: ticket text only in the prompt (redacted by complete()); the system field is fixed.
  let result: CompleteResult<ProposalOutput>;
  try {
    result = await complete<ProposalOutput>(db, {
      system: PROPOSAL_SYSTEM_PROMPT,
      prompt,
      schema: proposalOutputSchema,
      schemaName: PROPOSAL_SCHEMA_NAME,
      maxOutputTokens: PROPOSAL_MAX_OUTPUT_TOKENS,
    });
  } catch (err) {
    return handleProviderError(db, claimed, attempt, err);
  }

  // D-12: one real row per call that returned, before the result is stored (also when the
  // answer is then refused or the store is superseded).
  await recordAuditEvent(db, {
    actionType: KB_PROPOSAL_AUDIT_ACTION,
    ticketId: null,
    kbProposalId: claimed.proposalId,
    provider: result.provider,
    model: result.model,
    input: result.redactedPrompt,
    output: JSON.stringify(result.output),
  });

  // D-11, run decision K51: fail-closed, no retry.
  const verdict = validateProposalOutput(result.output, sources.length);
  if (!verdict.ok) return failClaimed(db, claimed, "INVALID_OUTPUT");

  return storeDraft(db, claimed, verdict.value, truncated, loaded.snapshots, sources);
}

/**
 * Runs one generation attempt for the proposal named by a kb-proposal-generate payload. Returns
 * the outcome; throws KbProposalRetryError only after a transient provider failure that released
 * the lease while pg-boss still has a retry left.
 */
export async function generateProposal(
  proposalId: string,
  opts: GenerateProposalOptions,
): Promise<GenerateProposalResult> {
  const now = opts.now ?? new Date();
  const { epoch } = opts;
  if (typeof proposalId !== "string" || proposalId === "") {
    return { outcome: "SKIPPED", reason: "INVALID_INPUT" };
  }
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    return { outcome: "SKIPPED", reason: "INVALID_INPUT" };
  }

  // 12 WR-01: a cross-organization job reads id and organizationId together.
  const row = await prisma.kbProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      version: true,
      generationEpoch: true,
      generationClaimedAt: true,
      generationQueuedAt: true,
      requestedByUserId: true,
    },
  });
  if (!row) return { outcome: "SKIPPED", reason: "NOT_FOUND" };
  if (row.status !== "GENERATING") return { outcome: "SKIPPED", reason: "NOT_GENERATING" };
  // Review R2-3: a job of a superseded generation does nothing.
  if (row.generationEpoch !== epoch) return { outcome: "SKIPPED", reason: "STALE_EPOCH" };
  if (row.generationClaimedAt !== null && !isStuck(row, now)) {
    return { outcome: "SKIPPED", reason: "LEASE_HELD" };
  }

  const orgId = row.organizationId;
  const db = scopedDb(orgId);
  const staleBefore = new Date(now.getTime() - STUCK_AFTER_MS);

  const won = await db.$transaction(async (tx) => {
    if (generateObserver?.beforeClaim) await generateObserver.beforeClaim(tx);
    const claim = await tx.kbProposal.updateMany({
      where: {
        id: row.id,
        organizationId: orgId,
        status: "GENERATING",
        version: row.version,
        generationEpoch: epoch,
        OR: [{ generationClaimedAt: null }, { generationClaimedAt: { lte: staleBefore } }],
      },
      data: { version: { increment: 1 }, generationClaimedAt: now },
    });
    if (claim.count === 0) return false;
    if (generateObserver?.afterClaim) await generateObserver.afterClaim(tx);
    return true;
  }, TRANSACTION_OPTIONS);
  if (!won) return { outcome: "SKIPPED", reason: "CLAIM_LOST" };

  const claimed: ClaimedProposal = {
    proposalId: row.id,
    orgId,
    epoch,
    version: row.version + 1,
    requestedByUserId: row.requestedByUserId,
    now,
  };

  try {
    return await runClaimed(db, claimed, opts.attempt);
  } catch (err) {
    if (err instanceof KbProposalRetryError) throw err;
    // Any exception outside complete() after the claim: FAILED UNKNOWN on the claimed version.
    let result: GenerateProposalResult;
    try {
      result = await failClaimed(db, claimed, "UNKNOWN");
    } catch {
      throw err;
    }
    return result;
  }
}
