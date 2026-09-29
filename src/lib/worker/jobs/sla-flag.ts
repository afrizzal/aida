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
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db";

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
  /** Awaited after the pass's UPDATE, before its commit (not called when nothing was locked). */
  afterPassUpdate?(tx: Prisma.TransactionClient, pass: SlaFlagPass): Promise<void> | void;
}

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

interface LockedRow {
  id: string;
  organizationId: string;
}

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
  return tx.$executeRaw`
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
  return tx.$executeRaw`
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
    if (pass === "breach") await updateBreach(tx, now, ids, orgIds);
    else await updateAtRisk(tx, now, ids, orgIds);
    if (opts.afterPassUpdate) await opts.afterPassUpdate(tx, pass);
  }, TRANSACTION_OPTIONS);
}

/** The scheduled job. Pass 1 breach (implies at-risk), pass 2 at-risk; each in its own transaction. */
export async function slaFlagHandler(_data?: unknown, opts: SlaFlagOptions = {}): Promise<void> {
  const now = opts.now ?? new Date();
  await runPass("breach", now, opts);
  await runPass("atRisk", now, opts);
}
