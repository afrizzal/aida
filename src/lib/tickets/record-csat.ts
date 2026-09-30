// The CSAT write of the public status page (Phase 12.1, Codex diff critique D3). The status
// token is the only credential, so this uses the bare client, never scopedDb.
//
// Relative imports only.
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../db";

/** Test-only hooks into the CSAT transaction (race proofs). */
export interface CsatWriteObserver {
  /** Awaited as the very first statement of the transaction, before any lock. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited right after the ticket row lock, before the group is read again. */
  afterTicketLock?(tx: Prisma.TransactionClient): Promise<void> | void;
}

let csatWriteObserver: CsatWriteObserver | null = null;

/**
 * Test seam only (as setCreateTicketObserverForTests): lets a race test record the backend PID
 * and hold the ticket lock of a CSAT write. Production never sets it.
 */
export function setCsatWriteObserverForTests(observer: CsatWriteObserver | null): void {
  csatWriteObserver = observer;
}

export type RecordCsatResult = "ok" | "not_found" | "not_eligible";

/**
 * Stores the rating of one ticket: one CsatResponse per ticket, latest wins. The ticket row is
 * locked and its group checked again in the transaction of the upsert (Codex diff critique D3),
 * so a reopen that commits after the route's first check refuses the rating.
 */
export async function recordCsat(
  ticketId: string,
  { score, comment }: { score: number; comment: string | null },
): Promise<RecordCsatResult> {
  return prisma.$transaction(async (tx) => {
    if (csatWriteObserver?.onTransactionStart) await csatWriteObserver.onTransactionStart(tx);
    // The ticket row lock first: a state change holds it until its commit, so after this wait
    // the group read below is the committed one, and no reopen commits between it and the upsert.
    await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;
    if (csatWriteObserver?.afterTicketLock) await csatWriteObserver.afterTicketLock(tx);
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { organizationId: true, state: { select: { group: true } } },
    });
    if (!ticket) return "not_found";
    // CSAT is only accepted once the state is in group RESOLVED or CLOSED (D-11 CSAT row, D-02).
    const group = ticket.state.group;
    if (group !== "RESOLVED" && group !== "CLOSED") return "not_eligible";

    await tx.csatResponse.upsert({
      where: { ticketId },
      create: { organizationId: ticket.organizationId, ticketId, score, comment },
      update: { score, comment },
    });
    return "ok";
  });
}
