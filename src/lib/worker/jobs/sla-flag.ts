// The sla-flag job (D-17): sets isBreached and isAtRisk on tickets whose SLA due times have
// passed or are close. Relative imports only: the worker bundles this module.
//
// One-directional (sets only). Flags are CLEARED by the first-response and resolve paths, never
// here, so a run that skips a row loses nothing: the next scheduled run flags it.
//
// Eligibility, in both passes: only tickets whose state is in the OPEN group and that have no
// open pause (slaPausedAt IS NULL). A paused ticket is skipped because its due times have not
// moved yet: they move by the paused time only when the pause closes (D-16), so flagging it
// against the unmoved deadline would record a breach that never happened. The state join pairs
// each ticket with a state of its own organization (12 WR-01), across organizations.
//
// Lock protocol (review C6): each transaction first locks its candidates with one SELECT ordered
// by id, FOR UPDATE OF the ticket alias SKIP LOCKED, then updates only the rows it locked,
// re-checking the full eligibility on the row it writes. A row held by another transaction (a bulk
// mutation, a merge, a transition) is skipped, never waited for, so the worker never waits on a
// ticket lock and cannot form a deadlock cycle with a bulk mutation that locks in ascending id; a
// skipped ticket is flagged on a later run. No state row is ever locked (FOR UPDATE OF t).
//
// Bounds (run decision K167, review c-WR-02): a pass first reads, with no lock, the organizations
// that have candidates, then runs one transaction per organization, in organization id order. Each
// locks at most SLA_PASS_ROW_CAP of that organization's candidates (the lowest ids, LIMIT before
// FOR UPDATE … SKIP LOCKED); the rest wait for the next run, which loses nothing because the
// flags are one-directional. So one tenant's backlog cannot hold every tenant's flags in one
// transaction past its timeout, and a failure in one organization's transaction rolls back that
// organization only: the other organizations still commit, the failed organization gets no
// at-risk pass in the same run (the breach pass comes first), and the handler rethrows the first
// failure after both passes, so the job is recorded as failed.
//
// Boundary: breach when a live deadline is strictly before now; at-risk when it is strictly
// after now and within 20 percent of its target; a deadline equal to now gets neither.
//
// Notifications (Phase 10, AIDA-44, D-18, V-09, V-30): each UPDATE hands back the rows it flipped
// (id, organizationId, assigneeId), and the pass notifies for exactly those rows inside the same
// transaction, after the update and before afterPassUpdate: SLA_BREACHED for the breach pass,
// SLA_AT_RISK for the at-risk pass, to the assignee or, for an unassigned ticket, to every current
// owner and admin who has not opted out (emitForTicket, V-28). A direct breach sets both flags in
// the breach pass, so the at-risk pass skips it and it gets one breach notification only. Event
// keys are sla-breached:{ticketId}:{now ISO} and sla-at-risk:{ticketId}:{now ISO}, with `now` read
// once per run and shared by both passes. The flag is the transition's identity: a pass that
// rolls back leaves neither flag nor notification, a re-run after commit finds nothing to flip,
// and a reset followed by a new flip is a new transition with a new now. The emitter's reads are
// plain reads after the ticket locks and take no lock of their own (V-25, V-28).
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db";
import { emitForTicket } from "../../notifications/emit";

export type SlaFlagPass = "breach" | "atRisk";

/**
 * The most candidates one organization's transaction locks and flips in one pass (K167). The rest
 * are flipped by the next run.
 */
export const SLA_PASS_ROW_CAP = 500;

/**
 * Test seams; production callers pass nothing. Each hook runs once per organization transaction
 * of a pass and receives that organization's id last.
 */
export interface SlaFlagOptions {
  /** The effective time of the run. Defaults to new Date(). */
  now?: Date;
  /** The row cap of one organization's transaction. Defaults to SLA_PASS_ROW_CAP. */
  rowCap?: number;
  /** Awaited as the first step of each organization's transaction. */
  onPassTransaction?(
    tx: Prisma.TransactionClient,
    pass: SlaFlagPass,
    organizationId: string,
  ): Promise<void> | void;
  /** Awaited after the lock step with the locked ids, in id order. */
  afterPassLock?(
    tx: Prisma.TransactionClient,
    pass: SlaFlagPass,
    lockedIds: string[],
    organizationId: string,
  ): Promise<void> | void;
  /**
   * Awaited after the UPDATE and its notifications, before the commit (not called when nothing
   * was locked).
   */
  afterPassUpdate?(
    tx: Prisma.TransactionClient,
    pass: SlaFlagPass,
    organizationId: string,
  ): Promise<void> | void;
}

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

interface LockedRow {
  id: string;
  organizationId: string;
}

/** A row an UPDATE flipped: the only data the passes hand back, used only to notify. */
interface FlippedRow {
  id: string;
  organizationId: string;
  assigneeId: string | null;
}

// Why the raw statements below (the organization read, two lock SELECTs, two UPDATEs) take no
// tenant input (D-28, F-13). This is a system cron job over all organizations by design: no
// request, no session and no tenant input reaches it, and every bound value is the job's own
// clock, its row cap, an organization id it read itself or the ids it just locked. The
// organization read returns only organization ids, and each lock SELECT is limited to one of
// them. Every predicate uses only the row's own columns (status through its own state,
// isBreached, isAtRisk, slaPausedAt, the due and responded timestamps, the target minutes); the
// state join and the UPDATEs pair each ticket with its own "organizationId". The lock SELECTs
// return only id and "organizationId" to this function, the UPDATEs hand back only the flipped
// rows' id, "organizationId" and "assigneeId", which go nowhere but emitForTicket under that row's
// own organization (Phase 10, V-09), and the handler returns nothing, so no tenant can read
// another tenant's data through this job.
// scopedDb does NOT intercept $queryRaw or $executeRaw: any copy of this pattern that returns
// data to a caller or takes tenant input must add an explicit "organizationId" filter
// (src/lib/rag/retrieve.ts and src/lib/tickets/search.ts show that discipline).

/** Breach candidates (alias t): overdue OPEN-group tickets without an open pause. */
function breachCandidate(now: Date): Prisma.Sql {
  return Prisma.sql`t."isBreached" = false
      AND t."slaPausedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "TicketState" s
        WHERE s.id = t."stateId" AND s."organizationId" = t."organizationId" AND s."group" = 'OPEN'
      )
      AND (
        (t."firstRespondedAt" IS NULL AND t."firstResponseDueAt" < ${now})
        OR (t."resolvedAt" IS NULL AND t."resolutionDueAt" < ${now})
      )`;
}

/** At-risk candidates (alias t): due within 20 percent of the original target duration. */
function atRiskCandidate(now: Date): Prisma.Sql {
  return Prisma.sql`t."isAtRisk" = false
      AND t."slaPausedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "TicketState" s
        WHERE s.id = t."stateId" AND s."organizationId" = t."organizationId" AND s."group" = 'OPEN'
      )
      AND (
        (t."firstRespondedAt" IS NULL AND t."firstResponseDueAt" > ${now}
          AND t."firstResponseDueAt" - ${now} <= (t."firstResponseTargetMinutes" * 0.2) * interval '1 minute')
        OR (t."resolvedAt" IS NULL AND t."resolutionDueAt" > ${now}
          AND t."resolutionDueAt" - ${now} <= (t."resolutionTargetMinutes" * 0.2) * interval '1 minute')
      )`;
}

function candidate(pass: SlaFlagPass, now: Date): Prisma.Sql {
  return pass === "breach" ? breachCandidate(now) : atRiskCandidate(now);
}

/**
 * The organizations with at least one candidate of the pass, in id order: a plain read outside
 * any transaction, with no row lock. A row that stops being a candidate before its organization's
 * transaction is simply not locked there.
 */
async function candidateOrganizations(pass: SlaFlagPass, now: Date): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ organizationId: string }[]>`
    SELECT DISTINCT t."organizationId"
    FROM "Ticket" t
    WHERE ${candidate(pass, now)}
    ORDER BY t."organizationId"
  `;
  return rows.map((row) => row.organizationId);
}

/** Lock step: at most `cap` candidates of one organization, lowest ids first, SKIP LOCKED. */
function lockCandidates(
  tx: Prisma.TransactionClient,
  pass: SlaFlagPass,
  now: Date,
  orgId: string,
  cap: number,
) {
  return tx.$queryRaw<LockedRow[]>`
    SELECT t.id, t."organizationId"
    FROM "Ticket" t
    WHERE t."organizationId" = ${orgId}
      AND ${candidate(pass, now)}
    ORDER BY t.id
    LIMIT ${cap}
    FOR UPDATE OF t SKIP LOCKED
  `;
}

/** Breach (implies at-risk): only the locked rows, eligibility re-checked on the written row. */
function updateBreach(tx: Prisma.TransactionClient, now: Date, ids: string[], orgIds: string[]) {
  return tx.$queryRaw<FlippedRow[]>`
    UPDATE "Ticket"
    SET "isBreached" = true, "isAtRisk" = true
    FROM unnest(${ids}::text[], ${orgIds}::text[]) AS l(id, "organizationId")
    WHERE "Ticket".id = l.id
      AND "Ticket"."organizationId" = l."organizationId"
      AND "Ticket"."isBreached" = false
      AND "Ticket"."slaPausedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "TicketState" s
        WHERE s.id = "Ticket"."stateId" AND s."organizationId" = "Ticket"."organizationId"
          AND s."group" = 'OPEN'
      )
      AND (
        ("Ticket"."firstRespondedAt" IS NULL AND "Ticket"."firstResponseDueAt" < ${now})
        OR ("Ticket"."resolvedAt" IS NULL AND "Ticket"."resolutionDueAt" < ${now})
      )
    RETURNING "Ticket".id, "Ticket"."organizationId", "Ticket"."assigneeId"
  `;
}

/** At-risk: only the locked rows, eligibility re-checked on the written row. */
function updateAtRisk(tx: Prisma.TransactionClient, now: Date, ids: string[], orgIds: string[]) {
  return tx.$queryRaw<FlippedRow[]>`
    UPDATE "Ticket"
    SET "isAtRisk" = true
    FROM unnest(${ids}::text[], ${orgIds}::text[]) AS l(id, "organizationId")
    WHERE "Ticket".id = l.id
      AND "Ticket"."organizationId" = l."organizationId"
      AND "Ticket"."isAtRisk" = false
      AND "Ticket"."slaPausedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "TicketState" s
        WHERE s.id = "Ticket"."stateId" AND s."organizationId" = "Ticket"."organizationId"
          AND s."group" = 'OPEN'
      )
      AND (
        ("Ticket"."firstRespondedAt" IS NULL AND "Ticket"."firstResponseDueAt" > ${now}
          AND "Ticket"."firstResponseDueAt" - ${now}
            <= ("Ticket"."firstResponseTargetMinutes" * 0.2) * interval '1 minute')
        OR ("Ticket"."resolvedAt" IS NULL AND "Ticket"."resolutionDueAt" > ${now}
          AND "Ticket"."resolutionDueAt" - ${now}
            <= ("Ticket"."resolutionTargetMinutes" * 0.2) * interval '1 minute')
      )
    RETURNING "Ticket".id, "Ticket"."organizationId", "Ticket"."assigneeId"
  `;
}

/** One organization's transaction of a pass: lock (capped), update, notify, commit. */
async function runOrganizationPass(
  pass: SlaFlagPass,
  now: Date,
  orgId: string,
  cap: number,
  opts: SlaFlagOptions,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (opts.onPassTransaction) await opts.onPassTransaction(tx, pass, orgId);
    const locked = await lockCandidates(tx, pass, now, orgId, cap);
    const ids = locked.map((row) => row.id);
    if (opts.afterPassLock) await opts.afterPassLock(tx, pass, ids, orgId);
    if (locked.length === 0) return;
    const orgIds = locked.map((row) => row.organizationId);
    const flipped =
      pass === "breach"
        ? await updateBreach(tx, now, ids, orgIds)
        : await updateAtRisk(tx, now, ids, orgIds);
    // Exactly the flipped rows, in id order, each under its own organization (V-09, V-30).
    const type = pass === "breach" ? "SLA_BREACHED" : "SLA_AT_RISK";
    const keyPrefix = pass === "breach" ? "sla-breached" : "sla-at-risk";
    for (const row of [...flipped].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      await emitForTicket(tx, row.organizationId, {
        assigneeId: row.assigneeId,
        type,
        eventKey: `${keyPrefix}:${row.id}:${now.toISOString()}`,
        entityId: row.id,
      });
    }
    if (opts.afterPassUpdate) await opts.afterPassUpdate(tx, pass, orgId);
  }, TRANSACTION_OPTIONS);
}

/**
 * One pass over every organization with candidates, one transaction each (K167). Organizations
 * already in `failed` are left out; an organization whose transaction fails is added to `failed`
 * with its error, and the pass goes on with the next one.
 */
async function runPass(
  pass: SlaFlagPass,
  now: Date,
  cap: number,
  opts: SlaFlagOptions,
  failed: Map<string, unknown>,
): Promise<void> {
  for (const orgId of await candidateOrganizations(pass, now)) {
    if (failed.has(orgId)) continue;
    try {
      await runOrganizationPass(pass, now, orgId, cap, opts);
    } catch (err) {
      failed.set(orgId, err);
    }
  }
}

/**
 * The scheduled job. Pass 1 breach (implies at-risk), pass 2 at-risk; each pass runs one
 * transaction per organization with candidates, at most `rowCap` rows each (K167). `now` is read
 * once here and shared by both passes and their event keys (V-30). Rethrows the first failure of
 * an organization's transaction after both passes.
 */
export async function slaFlagHandler(_data?: unknown, opts: SlaFlagOptions = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const cap = opts.rowCap ?? SLA_PASS_ROW_CAP;
  if (!Number.isInteger(cap) || cap < 1)
    throw new Error("sla-flag: rowCap must be a positive integer");
  const failed = new Map<string, unknown>();
  await runPass("breach", now, cap, opts, failed);
  await runPass("atRisk", now, cap, opts, failed);
  const [first] = failed.values();
  if (failed.size > 0) throw first;
}
