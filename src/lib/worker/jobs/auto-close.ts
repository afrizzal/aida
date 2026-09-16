// Daily auto-close of resolved tickets (Phase 11, AIDA-51, D-15 to D-19).
//
// For every organization with an auto-close days setting row:
//   1. read the settings (unlocked); skip and log invalid ones; nothing to do at 0
//   2. count RESOLVED tickets without resolvedAt (skipped, counted in the log line, D-16)
//   3. select at most 100 candidates (D-18): RESOLVED, resolvedAt set, quiet start
//      GREATEST(resolvedAt, autoCloseEnabledAt) at or before now minus the days, ordered by quiet
//      start then id
//   4. close each candidate in its own transaction through closeResolvedTicketIfQuiet, which
//      re-reads the settings under FOR SHARE on the days row (Codex review C8) and runs one
//      conditional UPDATE that re-checks everything in SQL (D-17); the AUTO_CLOSED audit row is
//      written only when a row changed
//
// The quiet period reads no messages (D-16 as amended after Codex review C3): a customer reply
// reopens the ticket under the ticket row lock (src/lib/tickets/reopen-on-reply.ts), so it is no
// longer RESOLVED; replies from the team, internal notes and automatic mail do not restart it.
//
// Nothing is sent to anyone (D-19, owner item O-2): no outbound queue, no mail, no AI call. The
// log line carries the organization id and counts only, never ticket text.
//
// Relative imports only: the worker bundles this module.
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db";
import {
  AUTO_CLOSE_DAYS_KEY,
  type LockAutoCloseSettingsHooks,
  lockAutoCloseSettings,
  readAutoCloseSettings,
} from "../../tickets/auto-close-settings";
import { recordTicketAudit } from "../../tickets/ticket-audit";

/** The most tickets one run closes per organization (D-18). */
export const MAX_AUTO_CLOSE_PER_ORG = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export interface CloseTicketInput {
  orgId: string;
  ticketId: string;
  now: Date;
}

export interface CloseTicketResult {
  closed: boolean;
  /** True when the settings read under the lock say auto-close is off (or invalid). */
  off: boolean;
}

/**
 * Closes one RESOLVED ticket when its quiet period has passed under the settings read under
 * FOR SHARE on the days row. Must run inside a transaction. The cutoff and enabledAt are bound
 * parameters taken only from lockAutoCloseSettings' result; the UPDATE reads no Setting row and
 * no message (Codex reviews R2-3 and C3). resolvedAt is left unchanged (D-16).
 */
export async function closeResolvedTicketIfQuiet(
  tx: Prisma.TransactionClient,
  { orgId, ticketId, now }: CloseTicketInput,
  hooks?: LockAutoCloseSettingsHooks,
): Promise<CloseTicketResult> {
  const settings = await lockAutoCloseSettings(tx, orgId, hooks);
  if (settings.invalid || settings.days === 0 || !settings.enabledAt) {
    return { closed: false, off: true };
  }
  const cutoff = new Date(now.getTime() - settings.days * DAY_MS);
  const enabledAt = settings.enabledAt;

  const changed = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Ticket"
    SET "status" = 'CLOSED', "updatedAt" = ${now}
    WHERE "id" = ${ticketId}
      AND "organizationId" = ${orgId}
      AND "status" = 'RESOLVED'
      AND "resolvedAt" IS NOT NULL
      AND GREATEST("resolvedAt", ${enabledAt}) <= ${cutoff}
    RETURNING "id"
  `;
  if (changed.length === 0) return { closed: false, off: false };

  await recordTicketAudit(tx, orgId, {
    ticketId,
    actorType: "SYSTEM",
    actorUserId: null,
    action: "AUTO_CLOSED",
    before: { status: "RESOLVED" },
    after: { status: "CLOSED" },
  });
  return { closed: true, off: false };
}

export interface AutoCloseHandlerOptions {
  now?: Date;
  log?: (line: string) => void;
  /** Test seam: awaited as the first step of each close transaction. */
  onCloseTransaction?(tx: Prisma.TransactionClient, ticketId: string): Promise<void> | void;
}

export interface AutoCloseOrgResult {
  orgId: string;
  closed: number;
  skippedWithoutResolvedAt: number;
  /** True when a close found auto-close off under the lock and the run stopped for this org. */
  stoppedOff: boolean;
}

export interface AutoCloseRunResult {
  organizations: AutoCloseOrgResult[];
  invalidOrganizations: string[];
}

/** The daily job (D-18). Returns what it did; the log line per organization says the same. */
export async function autoCloseHandler(
  _data?: unknown,
  opts: AutoCloseHandlerOptions = {},
): Promise<AutoCloseRunResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? ((line: string) => console.log(line));
  const result: AutoCloseRunResult = { organizations: [], invalidOrganizations: [] };

  const orgRows = await prisma.setting.findMany({
    where: { key: AUTO_CLOSE_DAYS_KEY },
    select: { organizationId: true },
    orderBy: { organizationId: "asc" },
  });

  for (const { organizationId: orgId } of orgRows) {
    const settings = await readAutoCloseSettings(prisma, orgId);
    if (settings.invalid) {
      result.invalidOrganizations.push(orgId);
      log(`[auto-close] org=${orgId} setting invalid, treated as off`);
      continue;
    }
    if (settings.days === 0 || !settings.enabledAt) continue;

    const cutoff = new Date(now.getTime() - settings.days * DAY_MS);
    const enabledAt = settings.enabledAt;

    const skippedWithoutResolvedAt = await prisma.ticket.count({
      where: { organizationId: orgId, status: "RESOLVED", resolvedAt: null },
    });

    const candidates = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Ticket"
      WHERE "organizationId" = ${orgId}
        AND "status" = 'RESOLVED'
        AND "resolvedAt" IS NOT NULL
        AND GREATEST("resolvedAt", ${enabledAt}) <= ${cutoff}
      ORDER BY GREATEST("resolvedAt", ${enabledAt}) ASC, "id" ASC
      LIMIT ${MAX_AUTO_CLOSE_PER_ORG}
    `;

    let closed = 0;
    let stoppedOff = false;
    for (const { id: ticketId } of candidates) {
      const outcome = await prisma.$transaction(async (tx) => {
        if (opts.onCloseTransaction) await opts.onCloseTransaction(tx, ticketId);
        return closeResolvedTicketIfQuiet(tx, { orgId, ticketId, now });
      }, TRANSACTION_OPTIONS);
      if (outcome.off) {
        stoppedOff = true;
        break;
      }
      if (outcome.closed) closed += 1;
    }

    result.organizations.push({ orgId, closed, skippedWithoutResolvedAt, stoppedOff });
    log(
      `[auto-close] org=${orgId} closed=${closed} skippedWithoutResolvedAt=${skippedWithoutResolvedAt}` +
        (stoppedOff ? " stopped=setting-off" : ""),
    );
  }

  return result;
}
