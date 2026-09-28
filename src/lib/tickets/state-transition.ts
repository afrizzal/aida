// The ONE state transition every state writer uses (Phase 12.1, AIDA-56, AIDA-57; D-11, D-16,
// D-17, D-19). It decides every lifecycle effect of a state change from the two groups alone and
// keeps the SLA pause accounting in the same write as the state change.
//
// D-11, effects by group change (exactly the per-status effects before Phase 12.1, mapped to
// groups):
//   - a change into group RESOLVED or CLOSED from another group sets resolvedAt to now and clears
//     isAtRisk and isBreached (RESOLVED to CLOSED is a group change and still sets resolvedAt);
//   - a change into group OPEN or PENDING from another group sets resolvedAt to null;
//   - a move inside one group changes only stateId.
//
// D-16, SLA pause:
//   - entering group PENDING from another group sets slaPausedAt to now;
//   - a move between two PENDING states changes nothing;
//   - leaving group PENDING adds delta = now - slaPausedAt (whole milliseconds, never negative)
//     exactly once to firstResponseDueAt, resolutionDueAt and slaPausedMs and clears slaPausedAt.
//     Both deadlines move even after a first response. Leaving with slaPausedAt null (data from
//     before the invariant) moves nothing;
//   - a priority change computes createdAt + slaPausedMs + the new targets
//     (pausedDueTimestamps); an open pause is counted only when it closes.
//
// Precondition: every caller holds the ticket's row lock and passes the values it read under
// that lock, and reads `now` after taking the lock (D-16). The update is one statement with the
// organization term; nothing here takes a lock.
//
// Two writers are deliberate exceptions to the by-group resolvedAt rule; neither is a bug:
//   - the auto-close job (plan 12.1-05) moves a RESOLVED-group ticket into the autoClose state
//     without touching resolvedAt and does not call this module (Phase 11 D-16);
//   - merge (plan 12.1-07) uses policy "merge": a RESOLVED-group source keeps its resolvedAt and
//     flags, as merge did before Phase 12.1; an OPEN or PENDING source is stamped as by-group.
//
// Relative imports only: the worker bundles callers of this module.
import type { Prisma } from "../../generated/prisma/client";
import { computeDueTimestamps } from "./sla";
import type { StateGroup } from "./ticket-states";

/** The ticket values a transition needs, read under the ticket's row lock. */
export interface TransitionRow {
  id: string;
  stateId: string;
  slaPausedAt: Date | null;
  slaPausedMs: bigint;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
}

/** How a group change into a terminal group treats resolvedAt and the flags. */
export type ResolvedAtPolicy = "by-group" | "merge";

/** The columns a closed pause writes, plus the measured delta. */
export interface ClosedPause {
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  slaPausedMs: bigint;
  slaPausedAt: null;
  deltaMs: number;
}

/**
 * Closes an open pause at `now`. Returns null when the ticket is not paused (slaPausedAt null).
 * The delta is now - slaPausedAt in whole milliseconds, never negative: a clock reading earlier
 * than the pause start counts as 0.
 */
export function closePause(
  row: Pick<TransitionRow, "slaPausedAt" | "slaPausedMs" | "firstResponseDueAt" | "resolutionDueAt">,
  now: Date,
): ClosedPause | null {
  if (row.slaPausedAt === null) return null;
  const deltaMs = Math.max(0, now.getTime() - row.slaPausedAt.getTime());
  return {
    firstResponseDueAt: new Date(row.firstResponseDueAt.getTime() + deltaMs),
    resolutionDueAt: new Date(row.resolutionDueAt.getTime() + deltaMs),
    slaPausedMs: row.slaPausedMs + BigInt(deltaMs),
    slaPausedAt: null,
    deltaMs,
  };
}

/** The update data of one transition. stateId is always present. */
export interface TransitionData {
  stateId: string;
  resolvedAt?: Date | null;
  isAtRisk?: false;
  isBreached?: false;
  slaPausedAt?: Date | null;
  slaPausedMs?: bigint;
  firstResponseDueAt?: Date;
  resolutionDueAt?: Date;
}

export interface PlanStateTransitionInput {
  row: TransitionRow;
  fromGroup: StateGroup;
  toStateId: string;
  toGroup: StateGroup;
  now: Date;
  policy: ResolvedAtPolicy;
}

const isTerminal = (group: StateGroup): boolean => group === "RESOLVED" || group === "CLOSED";

/** Plans the update of one transition (pure). See the module header for the rules. */
export function planStateTransition({
  row,
  fromGroup,
  toStateId,
  toGroup,
  now,
  policy,
}: PlanStateTransitionInput): TransitionData {
  const data: TransitionData = { stateId: toStateId };
  if (fromGroup === toGroup) return data;

  if (policy === "by-group") {
    if (isTerminal(toGroup)) {
      data.resolvedAt = now;
      data.isAtRisk = false;
      data.isBreached = false;
    } else {
      data.resolvedAt = null;
    }
  } else if (!isTerminal(fromGroup)) {
    // policy merge (target group CLOSED): an OPEN or PENDING source is stamped; a RESOLVED source
    // keeps its resolvedAt and flags, as merge did before Phase 12.1.
    data.resolvedAt = now;
    data.isAtRisk = false;
    data.isBreached = false;
  }

  if (toGroup === "PENDING") {
    data.slaPausedAt = now;
  } else if (fromGroup === "PENDING") {
    const closed = closePause(row, now);
    if (closed) {
      data.firstResponseDueAt = closed.firstResponseDueAt;
      data.resolutionDueAt = closed.resolutionDueAt;
      data.slaPausedMs = closed.slaPausedMs;
      data.slaPausedAt = null;
    }
  }
  return data;
}

/**
 * Applies one planned transition with the organization term. Returns the number of rows
 * updated (1 when the locked ticket is still there).
 */
export async function applyStateTransition(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: PlanStateTransitionInput,
): Promise<number> {
  const data = planStateTransition(input);
  const { count } = await tx.ticket.updateMany({
    where: { id: input.row.id, organizationId: orgId },
    data,
  });
  return count;
}

/**
 * The SLA due timestamps of a priority change: createdAt plus the closed pauses (slaPausedMs)
 * plus the new targets (D-16). An open pause is not counted here; it is added when it closes.
 */
export function pausedDueTimestamps(
  createdAt: Date,
  slaPausedMs: bigint,
  firstResponseMinutes: number,
  resolutionMinutes: number,
): { firstResponseDueAt: Date; resolutionDueAt: Date } {
  return computeDueTimestamps(
    new Date(createdAt.getTime() + Number(slaPausedMs)),
    firstResponseMinutes,
    resolutionMinutes,
  );
}
