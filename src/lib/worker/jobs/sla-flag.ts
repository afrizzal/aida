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
// Lock protocol (review C6): each pass runs in its own transaction and first locks its
// candidates with one SELECT ordered by id, FOR UPDATE OF the ticket alias SKIP LOCKED, then
// updates only the rows it locked, re-checking the full eligibility on the row it writes. A row
// held by another transaction (a bulk mutation, a merge, a transition) is skipped, never waited
// for, so the worker never waits on a ticket lock and cannot form a deadlock cycle with a bulk
// mutation that locks in ascending id; a skipped ticket is flagged on a later run. No state row
// is ever locked (FOR UPDATE OF t).
//
// Boundary: breach when a live deadline is strictly before now; at-risk when it is strictly
// after now and within 20 percent of its target; a deadline equal to now gets neither.
//
// Notifications (Phase 10, AIDA-44, D-18, V-09, V-30): each UPDATE hands back the rows it flipped
// (id, organizationId, assigneeId), and the pass notifies for exactly those rows inside its own
// transaction, after the update and before afterPassUpdate: SLA_BREACHED for the breach pass,
// SLA_AT_RISK for the at-risk pass, to the assignee or, for an unassigned ticket, to every current
// owner and admin who has not opted out (emitForTicket, V-28). A direct breach sets both flags in
// the breach pass, so the at-risk pass skips it and it gets one breach notification only. Event
// keys are sla-breached:{ticketId}:{now ISO} and sla-at-risk:{ticketId}:{now ISO}, with `now` read
// once per run and shared by both passes. The flag is the transition's identity: a pass that
// rolls back leaves neither flag nor notification, a re-run after commit finds nothing to flip,
// and a reset followed by a new flip is a new transition with a new now. The emitter's reads are
// plain reads after the ticket locks and take no lock of their own (V-25, V-28).
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db";
import { emitForTicket } from "../../notifications/emit";

export type SlaFlagPass = "breach" | "atRisk";

/** Test seams; production callers pass nothing. */
export interface SlaFlagOptions {
  /** The effective time of the run. Defaults to new Date(). */
  now?: Date;
  /** Awaited as the first step of each pass's transaction. */
  onPassTransaction?(tx: Prisma.TransactionClient, pass: SlaFlagPass): Promise<void> | void;
  /** Awaited after the lock step with the locked ids, in id order. */
  afterPassLock?(
    tx: Prisma.TransactionClient,
    pass: SlaFlagPass,
    lockedIds: string[],
  ): Promise<void> | void;
  /**
   * Awaited after the pass's UPDATE and its notifications, before its commit (not called when
   * nothing was locked).
   */
  afterPassUpdate?(tx: Prisma.TransactionClient, pass: SlaFlagPass): Promise<void> | void;
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

// Why the four raw statements below (two lock SELECTs, two UPDATEs) have no tenant filter
// (D-28, F-13). This is a system cron job over all organizations by design: no request, no
// session and no tenant input reaches it, and every bound value is the job's own clock or the ids
// it just locked. Every predicate uses only the row's own columns (status through its own state,
// isBreached, isAtRisk, slaPausedAt, the due and responded timestamps, the target minutes); the
// state join and the UPDATEs pair each ticket with its own "organizationId". The lock SELECTs
// return only id and "organizationId" to this function, the UPDATEs hand back only the flipped
// rows' id, "organizationId" and "assigneeId", which go nowhere but emitForTicket under that row's
// own organization (Phase 10, V-09), and the handler returns nothing, so no tenant can read
// another tenant's data through this job.
// scopedDb does NOT intercept $queryRaw or $executeRaw: any copy of this pattern that returns
// data to a caller or takes tenant input must add an explicit "organizationId" filter
// (src/lib/rag/retrieve.ts and src/lib/tickets/search.ts show that discipline).

/** Breach pass, lock step: overdue OPEN-group tickets without an open pause. */
function lockBreachCandidates(tx: Prisma.TransactionClient, now: Date) {
  return tx.$queryRaw<LockedRow[]>`
    SELECT t.id, t."organizationId"
    FROM "Ticket" t
    WHERE t."isBreached" = false
      AND t."slaPausedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "TicketState" s
        WHERE s.id = t."stateId" AND s."organizationId" = t."organizationId" AND s."group" = 'OPEN'
      )
      AND (
        (t."firstRespondedAt" IS NULL AND t."firstResponseDueAt" < ${now})
        OR (t."resolvedAt" IS NULL AND t."resolutionDueAt" < ${now})
      )
    ORDER BY t.id
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

/** At-risk pass, lock step: due within 20 percent of the original target duration. */
function lockAtRiskCandidates(tx: Prisma.TransactionClient, now: Date) {
  return tx.$queryRaw<LockedRow[]>`
    SELECT t.id, t."organizationId"
    FROM "Ticket" t
    WHERE t."isAtRisk" = false
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
      )
    ORDER BY t.id
    FOR UPDATE OF t SKIP LOCKED
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

async function runPass(pass: SlaFlagPass, now: Date, opts: SlaFlagOptions): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (opts.onPassTransaction) await opts.onPassTransaction(tx, pass);
    const locked =
      pass === "breach" ? await lockBreachCandidates(tx, now) : await lockAtRiskCandidates(tx, now);
    const ids = locked.map((row) => row.id);
    if (opts.afterPassLock) await opts.afterPassLock(tx, pass, ids);
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
    if (opts.afterPassUpdate) await opts.afterPassUpdate(tx, pass);
  }, TRANSACTION_OPTIONS);
}

/**
 * The scheduled job. Pass 1 breach (implies at-risk), pass 2 at-risk; each in its own transaction.
 * `now` is read once here and shared by both passes and their event keys (V-30).
 */
export async function slaFlagHandler(_data?: unknown, opts: SlaFlagOptions = {}): Promise<void> {
  const now = opts.now ?? new Date();
  await runPass("breach", now, opts);
  await runPass("atRisk", now, opts);
}
