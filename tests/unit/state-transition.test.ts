// Phase 12.1, plan 12.1-04: the group-effect matrix (D-11) and the pause arithmetic (D-16) of
// the shared state transition, as pure tests. Fixed Date values only, never the current clock.
import { describe, expect, it } from "vitest";
import {
  closePause,
  pausedDueTimestamps,
  planStateTransition,
  type TransitionData,
  type TransitionRow,
} from "../../src/lib/tickets/state-transition";
import type { StateGroup } from "../../src/lib/tickets/ticket-states";

const MINUTE = 60_000;
const NOW = new Date("2026-11-09T12:00:00.000Z");
const PAUSE_START = new Date(NOW.getTime() - 10 * MINUTE);
const FIRST_DUE = new Date("2026-11-09T14:00:00.000Z");
const RESOLUTION_DUE = new Date("2026-11-11T09:00:00.000Z");

function row(overrides: Partial<TransitionRow> = {}): TransitionRow {
  return {
    id: "ticket-1",
    stateId: "state-from",
    slaPausedAt: null,
    slaPausedMs: 0n,
    firstResponseDueAt: FIRST_DUE,
    resolutionDueAt: RESOLUTION_DUE,
    ...overrides,
  };
}

const GROUPS: readonly StateGroup[] = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];

// The expected by-group effects, written out per pair (no logic copied from the module).
// resolvedAt: "now" = stamped with now, null = cleared, "-" = absent from the data.
// pause: "start" = slaPausedAt set to now, "close" = the 10-minute pause closed, "-" = untouched.
type Expected = { resolvedAt: "now" | null | "-"; flags: boolean; pause: "start" | "close" | "-" };
const BY_GROUP: Record<StateGroup, Record<StateGroup, Expected>> = {
  OPEN: {
    OPEN: { resolvedAt: "-", flags: false, pause: "-" },
    PENDING: { resolvedAt: null, flags: false, pause: "start" },
    RESOLVED: { resolvedAt: "now", flags: true, pause: "-" },
    CLOSED: { resolvedAt: "now", flags: true, pause: "-" },
  },
  PENDING: {
    OPEN: { resolvedAt: null, flags: false, pause: "close" },
    PENDING: { resolvedAt: "-", flags: false, pause: "-" },
    RESOLVED: { resolvedAt: "now", flags: true, pause: "close" },
    CLOSED: { resolvedAt: "now", flags: true, pause: "close" },
  },
  RESOLVED: {
    OPEN: { resolvedAt: null, flags: false, pause: "-" },
    PENDING: { resolvedAt: null, flags: false, pause: "start" },
    RESOLVED: { resolvedAt: "-", flags: false, pause: "-" },
    CLOSED: { resolvedAt: "now", flags: true, pause: "-" },
  },
  CLOSED: {
    OPEN: { resolvedAt: null, flags: false, pause: "-" },
    PENDING: { resolvedAt: null, flags: false, pause: "start" },
    RESOLVED: { resolvedAt: "now", flags: true, pause: "-" },
    CLOSED: { resolvedAt: "-", flags: false, pause: "-" },
  },
};

function expectedData(e: Expected): TransitionData {
  const data: TransitionData = { stateId: "state-to" };
  if (e.resolvedAt === "now") data.resolvedAt = NOW;
  if (e.resolvedAt === null) data.resolvedAt = null;
  if (e.flags) {
    data.isAtRisk = false;
    data.isBreached = false;
  }
  if (e.pause === "start") data.slaPausedAt = NOW;
  if (e.pause === "close") {
    data.firstResponseDueAt = new Date(FIRST_DUE.getTime() + 10 * MINUTE);
    data.resolutionDueAt = new Date(RESOLUTION_DUE.getTime() + 10 * MINUTE);
    data.slaPausedMs = 600_000n;
    data.slaPausedAt = null;
  }
  return data;
}

describe("planStateTransition: by-group matrix (D-11, D-16)", () => {
  const pairs = GROUPS.flatMap((from) => GROUPS.map((to) => [from, to] as const));

  it("covers all 16 pairs", () => {
    expect(pairs).toHaveLength(16);
  });

  it.each(pairs)("%s to %s plans exactly the expected data", (from, to) => {
    // The pause invariant: a ticket in a PENDING-group state has an open pause.
    const r = row({ slaPausedAt: from === "PENDING" ? PAUSE_START : null });
    const data = planStateTransition({
      row: r,
      fromGroup: from,
      toStateId: "state-to",
      toGroup: to,
      now: NOW,
      policy: "by-group",
    });
    expect(data).toStrictEqual(expectedData(BY_GROUP[from][to]));
  });

  it("a same-group move carries only stateId", () => {
    for (const g of GROUPS) {
      const data = planStateTransition({
        row: row({ slaPausedAt: g === "PENDING" ? PAUSE_START : null }),
        fromGroup: g,
        toStateId: "state-to",
        toGroup: g,
        now: NOW,
        policy: "by-group",
      });
      expect(Object.keys(data)).toEqual(["stateId"]);
    }
  });
});

describe("planStateTransition: merge policy", () => {
  it("OPEN to CLOSED sets resolvedAt and clears both flags", () => {
    const data = planStateTransition({
      row: row(),
      fromGroup: "OPEN",
      toStateId: "closed",
      toGroup: "CLOSED",
      now: NOW,
      policy: "merge",
    });
    expect(data).toStrictEqual({
      stateId: "closed",
      resolvedAt: NOW,
      isAtRisk: false,
      isBreached: false,
    });
  });

  it("PENDING to CLOSED sets resolvedAt, clears the flags and closes the pause", () => {
    const data = planStateTransition({
      row: row({ slaPausedAt: PAUSE_START, slaPausedMs: 1_000n }),
      fromGroup: "PENDING",
      toStateId: "closed",
      toGroup: "CLOSED",
      now: NOW,
      policy: "merge",
    });
    expect(data).toStrictEqual({
      stateId: "closed",
      resolvedAt: NOW,
      isAtRisk: false,
      isBreached: false,
      firstResponseDueAt: new Date(FIRST_DUE.getTime() + 10 * MINUTE),
      resolutionDueAt: new Date(RESOLUTION_DUE.getTime() + 10 * MINUTE),
      slaPausedMs: 601_000n,
      slaPausedAt: null,
    });
  });

  it("RESOLVED to CLOSED leaves resolvedAt and the flags out of the data", () => {
    const data = planStateTransition({
      row: row(),
      fromGroup: "RESOLVED",
      toStateId: "closed",
      toGroup: "CLOSED",
      now: NOW,
      policy: "merge",
    });
    expect(data).toStrictEqual({ stateId: "closed" });
  });
});

describe("pause accounting (D-16, AIDA-57 edges)", () => {
  it("entering PENDING sets slaPausedAt to now", () => {
    const data = planStateTransition({
      row: row(),
      fromGroup: "OPEN",
      toStateId: "pending",
      toGroup: "PENDING",
      now: NOW,
      policy: "by-group",
    });
    expect(data.slaPausedAt).toEqual(NOW);
    expect(data.firstResponseDueAt).toBeUndefined();
    expect(data.slaPausedMs).toBeUndefined();
  });

  it("PENDING to PENDING plans only stateId", () => {
    const data = planStateTransition({
      row: row({ slaPausedAt: PAUSE_START }),
      fromGroup: "PENDING",
      toStateId: "pending-2",
      toGroup: "PENDING",
      now: NOW,
      policy: "by-group",
    });
    expect(data).toStrictEqual({ stateId: "pending-2" });
  });

  it("leaving PENDING after 125000 ms adds exactly 125000 ms to both deadlines and slaPausedMs", () => {
    const t0 = new Date("2026-11-09T10:00:00.000Z");
    const now = new Date(t0.getTime() + 125_000);
    const data = planStateTransition({
      row: row({ slaPausedAt: t0, slaPausedMs: 0n }),
      fromGroup: "PENDING",
      toStateId: "open",
      toGroup: "OPEN",
      now,
      policy: "by-group",
    });
    expect(data.firstResponseDueAt?.getTime()).toBe(FIRST_DUE.getTime() + 125_000);
    expect(data.resolutionDueAt?.getTime()).toBe(RESOLUTION_DUE.getTime() + 125_000);
    expect(data.slaPausedMs).toBe(BigInt(125_000));
    expect(data.slaPausedAt).toBeNull();
  });

  it("a zero-length pause adds 0 (adjacency edge)", () => {
    const closed = closePause(row({ slaPausedAt: NOW, slaPausedMs: 7n }), NOW);
    expect(closed?.deltaMs).toBe(0);
    expect(closed?.firstResponseDueAt).toEqual(FIRST_DUE);
    expect(closed?.resolutionDueAt).toEqual(RESOLUTION_DUE);
    expect(closed?.slaPausedMs).toBe(7n);
    expect(closed?.slaPausedAt).toBeNull();
  });

  it("a clock reading earlier than slaPausedAt counts as 0, never a negative shift (adjacency edge)", () => {
    const earlier = new Date(NOW.getTime() - 5_000);
    const closed = closePause(row({ slaPausedAt: NOW, slaPausedMs: 0n }), earlier);
    expect(closed?.deltaMs).toBe(0);
    expect(closed?.firstResponseDueAt).toEqual(FIRST_DUE);
    expect(closed?.resolutionDueAt).toEqual(RESOLUTION_DUE);
    expect(closed?.slaPausedMs).toBe(0n);
  });

  it("millisecond values give an integer delta and identical shifts on the three columns (encoding edge)", () => {
    const t0 = new Date("2026-11-09T10:00:00.123Z");
    const now = new Date("2026-11-09T10:07:31.456Z");
    const closed = closePause(row({ slaPausedAt: t0, slaPausedMs: 0n }), now);
    expect(closed).not.toBeNull();
    const delta = closed?.deltaMs ?? -1;
    expect(Number.isInteger(delta)).toBe(true);
    expect(delta).toBe(451_333);
    expect((closed?.firstResponseDueAt.getTime() ?? 0) - FIRST_DUE.getTime()).toBe(delta);
    expect((closed?.resolutionDueAt.getTime() ?? 0) - RESOLUTION_DUE.getTime()).toBe(delta);
    expect(closed?.slaPausedMs).toBe(BigInt(delta));
  });

  it("leaving PENDING with slaPausedAt null plans no deadline or slaPausedMs change (empty edge)", () => {
    expect(closePause(row({ slaPausedAt: null }), NOW)).toBeNull();
    const data = planStateTransition({
      row: row({ slaPausedAt: null, slaPausedMs: 0n }),
      fromGroup: "PENDING",
      toStateId: "open",
      toGroup: "OPEN",
      now: NOW,
      policy: "by-group",
    });
    expect(data).toStrictEqual({ stateId: "open", resolvedAt: null });
  });

  it("two pauses of 30 and 45 minutes sum to 75 minutes in either order", () => {
    const base = new Date("2026-11-09T09:00:00.000Z");
    const run = (lengths: readonly number[]) => {
      let r = row({ slaPausedMs: 0n });
      let at = base.getTime();
      for (const minutes of lengths) {
        const start = new Date(at);
        const end = new Date(at + minutes * MINUTE);
        const closed = closePause({ ...r, slaPausedAt: start }, end);
        if (!closed) throw new Error("expected a closed pause");
        r = {
          ...r,
          slaPausedAt: null,
          slaPausedMs: closed.slaPausedMs,
          firstResponseDueAt: closed.firstResponseDueAt,
          resolutionDueAt: closed.resolutionDueAt,
        };
        at = end.getTime() + 5 * MINUTE;
      }
      return r;
    };
    for (const result of [run([30, 45]), run([45, 30])]) {
      expect(result.slaPausedMs).toBe(4_500_000n);
      expect(result.firstResponseDueAt.getTime()).toBe(FIRST_DUE.getTime() + 75 * MINUTE);
      expect(result.resolutionDueAt.getTime()).toBe(RESOLUTION_DUE.getTime() + 75 * MINUTE);
    }
  });
});

describe("pausedDueTimestamps (priority change, D-16)", () => {
  it("adds the closed pauses to createdAt before the new targets", () => {
    const createdAt = new Date("2026-11-09T08:00:00.000Z");
    const due = pausedDueTimestamps(createdAt, 4_500_000n, 60, 480);
    expect(due.firstResponseDueAt.getTime()).toBe(createdAt.getTime() + (75 + 60) * MINUTE);
    expect(due.resolutionDueAt.getTime()).toBe(createdAt.getTime() + (75 + 480) * MINUTE);
  });
});
