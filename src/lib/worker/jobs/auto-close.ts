// Daily auto-close of resolved tickets (Phase 11, AIDA-51, D-15 to D-19; on ticket states since
// Phase 12.1, D-11 Auto-close row).
//
// The job reasons about the group, never a state name: a candidate is a ticket whose state is in
// group RESOLVED (the migrated Resolved state or any admin-created RESOLVED-group state), and it
// closes into the organization's auto-close role (TicketStateConfig.autoCloseStateId, group
// CLOSED). A ticket in an OPEN, PENDING or CLOSED-group state is never a candidate.
//
// For every organization with an auto-close days setting row:
//   1. read the settings (unlocked); skip and log invalid ones; nothing to do at 0
//   2. count RESOLVED-group tickets without resolvedAt (skipped, counted in the log line, D-16)
//   3. select at most 100 candidates (D-18): RESOLVED group, resolvedAt set, quiet start
//      GREATEST(resolvedAt, autoCloseEnabledAt) at or before now minus the days, ordered by quiet
//      start then id
//   (both the candidate query and the final UPDATE skip snoozed tickets, "snoozedUntil" IS NULL,
//   Phase 12 D-15, so a snooze that commits between the two is respected)
//   4. close each candidate in its own transaction through closeResolvedTicketIfQuiet. Lock
//      order (D-15 amended): the Setting days row FOR SHARE (Codex review C8), then the
//      TicketStateConfig row FOR SHARE and the auto-close state FOR SHARE, then the ticket row
//      (lockTicketsInIdOrder); then one conditional UPDATE that re-checks group RESOLVED,
//      resolvedAt, snoozedUntil and the cutoff in SQL (D-17); the AUTO_CLOSED audit row
//      ({ stateId, stateGroup } before and after) is written only when a row changed
//
// resolvedAt stays unchanged on auto-close (Phase 11 D-16): the quiet period and Insight read it
// as the moment the ticket was resolved. This differs on purpose from the generic group-change
// rule of src/lib/tickets/state-transition.ts (RESOLVED to CLOSED sets resolvedAt = now), so this
// job does not call that module.
//
// The quiet period reads no messages (D-16 as amended after Codex review C3): a customer reply
// reopens the ticket under the ticket row lock (src/lib/tickets/reopen-on-reply.ts), so it is no
// longer RESOLVED; replies from the team, internal notes and automatic mail do not restart it.
//
// Nothing is sent to anyone (D-19, owner item O-2): no outbound queue, no mail, no AI call. The
// log line carries the organization id, counts and, on a failure, the error code only, never
// ticket text.
//
// Each organization is isolated (review WR-02): an error in one is logged and the run continues
// with the next, so one tenant's fault never starves the others. A run with a failed
// organization ends by throwing AutoCloseRunError, so pg-boss records it as failed and retries.
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
import { lockTicketsInIdOrder } from "../../tickets/merge";
import { recordTicketAudit } from "../../tickets/ticket-audit";
import {
  readStateConfigForShare,
  readStateGroups,
  shareLockActiveState,
  stateAuditSnapshot,
} from "../../tickets/ticket-states";

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
 * The organization's auto-close role points at a missing or soft-deleted state. Cannot happen
 * while the config row is share-locked (D-15 amended), so it means corrupt data and is thrown.
 */
export class AutoCloseStateUnavailableError extends Error {
  readonly code = "AUTO_CLOSE_STATE_UNAVAILABLE";
  constructor(orgId: string, stateId: string) {
    super(
      `auto-close state ${stateId} of organization ${orgId} is missing, deleted or not in CLOSED`,
    );
    this.name = "AutoCloseStateUnavailableError";
  }
}

/**
 * Closes one ticket in a RESOLVED-group state into the auto-close role when its quiet period has
 * passed under the settings read under FOR SHARE on the days row. Must run inside a transaction.
 * The cutoff and enabledAt are bound parameters taken only from lockAutoCloseSettings' result;
 * the UPDATE reads no Setting row and no message (Codex reviews R2-3 and C3). resolvedAt is left
 * unchanged (D-16).
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

  // Lock order: Setting (above), config, auto-close state, then the ticket row (D-15 amended).
  const { autoCloseStateId } = await readStateConfigForShare(tx, orgId);
  const target = await shareLockActiveState(tx, orgId, autoCloseStateId);
  // The service keeps the role inside CLOSED, but no database rule does: a target in another
  // group would skip the effects of planStateTransition, so it is refused (review IN-a2-2).
  if (target?.group !== "CLOSED") {
    throw new AutoCloseStateUnavailableError(orgId, autoCloseStateId);
  }

  const [locked] = await lockTicketsInIdOrder(tx, orgId, [ticketId]);
  if (!locked) return { closed: false, off: false };
  const previousStateId = locked.stateId;
  const groups = await readStateGroups(tx, orgId, [previousStateId]);
  if (groups.get(previousStateId) !== "RESOLVED") return { closed: false, off: false };

  const changed = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Ticket"
    SET "stateId" = ${autoCloseStateId}, "updatedAt" = ${now}
    WHERE "id" = ${ticketId}
      AND "organizationId" = ${orgId}
      AND EXISTS (
        SELECT 1 FROM "TicketState" s
        WHERE s.id = "Ticket"."stateId"
          AND s."organizationId" = ${orgId}
          AND s."group" = 'RESOLVED'
      )
      AND "resolvedAt" IS NOT NULL
      AND "snoozedUntil" IS NULL
      AND GREATEST("resolvedAt", ${enabledAt}) <= ${cutoff}
    RETURNING "id"
  `;
  if (changed.length === 0) return { closed: false, off: false };

  await recordTicketAudit(tx, orgId, {
    ticketId,
    actorType: "SYSTEM",
    actorUserId: null,
    action: "AUTO_CLOSED",
    before: stateAuditSnapshot(previousStateId, "RESOLVED"),
    after: stateAuditSnapshot(autoCloseStateId, target.group),
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

export interface AutoCloseFailedOrg {
  orgId: string;
  /** The error's code (a Prisma or Postgres code) or its class name; never its message. */
  code: string;
  /** Tickets this run had already closed (and committed) in the organization before the error. */
  closed: number;
}

export interface AutoCloseRunResult {
  organizations: AutoCloseOrgResult[];
  invalidOrganizations: string[];
  /** Organizations whose run stopped on an error; the other organizations still ran. */
  failedOrganizations: AutoCloseFailedOrg[];
}

/**
 * Thrown at the end of a run in which at least one organization failed, after every other
 * organization was processed (review WR-02), so pg-boss records the job as failed and retries
 * it. The run is idempotent: a retry closes only what is still due. result says what was done.
 */
export class AutoCloseRunError extends Error {
  readonly result: AutoCloseRunResult;

  constructor(result: AutoCloseRunResult) {
    super(`auto-close failed for ${result.failedOrganizations.length} organization(s)`);
    this.name = "AutoCloseRunError";
    this.result = result;
  }
}

const SAFE_CODE = /^[A-Za-z0-9_]{1,64}$/;

/**
 * A loggable identifier for an error: its code (Prisma "P2034", Postgres "40P01") or its class
 * name. The message is never used, because a database error can quote ticket text.
 */
function errorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const { code, name } = err as { code?: unknown; name?: unknown };
    if (typeof code === "string" && SAFE_CODE.test(code)) return code;
    if (typeof name === "string" && SAFE_CODE.test(name)) return name;
  }
  return "unknown";
}

/**
 * The daily job (D-18). Returns what it did; the log line per organization says the same. Each
 * organization runs on its own: an error in one is logged by code and the run goes on with the
 * next (review WR-02); if any organization failed, the run then throws AutoCloseRunError.
 */
export async function autoCloseHandler(
  _data?: unknown,
  opts: AutoCloseHandlerOptions = {},
): Promise<AutoCloseRunResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? ((line: string) => console.log(line));
  const result: AutoCloseRunResult = {
    organizations: [],
    invalidOrganizations: [],
    failedOrganizations: [],
  };

  const orgRows = await prisma.setting.findMany({
    where: { key: AUTO_CLOSE_DAYS_KEY },
    select: { organizationId: true },
    orderBy: { organizationId: "asc" },
  });

  for (const { organizationId: orgId } of orgRows) {
    const progress = { closed: 0 };
    try {
      await autoCloseOrganization(orgId, now, opts, log, result, progress);
    } catch (err) {
      const code = errorCode(err);
      result.failedOrganizations.push({ orgId, code, closed: progress.closed });
      log(`[auto-close] org=${orgId} failed code=${code} closed=${progress.closed}`);
    }
  }

  if (result.failedOrganizations.length > 0) throw new AutoCloseRunError(result);
  return result;
}

/** One organization's run; pushes its result and log line. Throws on any error. */
async function autoCloseOrganization(
  orgId: string,
  now: Date,
  opts: AutoCloseHandlerOptions,
  log: (line: string) => void,
  result: AutoCloseRunResult,
  progress: { closed: number },
): Promise<void> {
  const settings = await readAutoCloseSettings(prisma, orgId);
  if (settings.invalid) {
    result.invalidOrganizations.push(orgId);
    log(`[auto-close] org=${orgId} setting invalid, treated as off`);
    return;
  }
  if (settings.days === 0 || !settings.enabledAt) return;

  const cutoff = new Date(now.getTime() - settings.days * DAY_MS);
  const enabledAt = settings.enabledAt;

  const skippedWithoutResolvedAt = await prisma.ticket.count({
    where: { organizationId: orgId, resolvedAt: null, state: { group: "RESOLVED" } },
  });

  const candidates = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t."id" FROM "Ticket" t
    JOIN "TicketState" s ON s.id = t."stateId" AND s."organizationId" = t."organizationId"
    WHERE t."organizationId" = ${orgId}
      AND s."group" = 'RESOLVED'
      AND t."resolvedAt" IS NOT NULL
      AND t."snoozedUntil" IS NULL
      AND GREATEST(t."resolvedAt", ${enabledAt}) <= ${cutoff}
    ORDER BY GREATEST(t."resolvedAt", ${enabledAt}) ASC, t."id" ASC
    LIMIT ${MAX_AUTO_CLOSE_PER_ORG}
  `;

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
    if (outcome.closed) progress.closed += 1;
  }

  const closed = progress.closed;
  result.organizations.push({ orgId, closed, skippedWithoutResolvedAt, stoppedOff });
  log(
    `[auto-close] org=${orgId} closed=${closed} skippedWithoutResolvedAt=${skippedWithoutResolvedAt}` +
      (stoppedOff ? " stopped=setting-off" : ""),
  );
}
