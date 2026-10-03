// Phase 12.2 frozen proposal contract (D-17): parity with the generated enums, the status
// machine, the bounds, the stuck rule (injected clock, review C5) and the job payload guard
// (review R2-3).
import { describe, expect, it } from "vitest";
import {
  AuditActionType,
  KbProposalFailureCode,
  KbProposalStatus,
} from "../../src/generated/prisma/enums";
import {
  canTransition,
  ELIGIBLE_SOURCE_GROUPS,
  isFinalStatus,
  isProposalJobPayload,
  isStuck,
  KB_PROPOSAL_AUDIT_ACTION,
  KB_PROPOSAL_GENERATE_QUEUE,
  KB_PROPOSAL_JOB_RETRY_LIMIT,
  MAINTENANCE_REFUSAL_CODES,
  MAX_PROPOSAL_SOURCES,
  MIN_PROPOSAL_SOURCES,
  PROPOSAL_FAILURE_CODES,
  PROPOSAL_POLL_INTERVAL_MS,
  PROPOSAL_STATUSES,
  type ProposalStatus,
  REQUEST_REFUSAL_CODES,
  REVIEW_REFUSAL_CODES,
  STUCK_AFTER_MS,
  TICKET_REFUSAL_REASONS,
} from "../../src/lib/kb/proposal-contract";

describe("proposal contract: parity with the generated Prisma enums", () => {
  it("PROPOSAL_STATUSES equals KbProposalStatus in declaration order", () => {
    expect([...PROPOSAL_STATUSES]).toEqual(Object.values(KbProposalStatus));
  });

  it("PROPOSAL_FAILURE_CODES equals KbProposalFailureCode in declaration order", () => {
    expect([...PROPOSAL_FAILURE_CODES]).toEqual(Object.values(KbProposalFailureCode));
  });

  it("KB_PROPOSAL_AUDIT_ACTION is KB_PROPOSAL_GENERATED and a value of AuditActionType", () => {
    expect(KB_PROPOSAL_AUDIT_ACTION).toBe("KB_PROPOSAL_GENERATED");
    expect(Object.values(AuditActionType)).toContain(KB_PROPOSAL_AUDIT_ACTION);
  });
});

describe("proposal contract: status machine (D-16)", () => {
  const allowed: ReadonlyArray<[ProposalStatus, ProposalStatus]> = [
    ["GENERATING", "DRAFT"],
    ["GENERATING", "FAILED"],
    ["DRAFT", "PUBLISHED"],
    ["DRAFT", "REJECTED"],
  ];

  it("allows exactly the four transitions", () => {
    for (const from of PROPOSAL_STATUSES) {
      for (const to of PROPOSAL_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("refuses the named forbidden transitions", () => {
    expect(canTransition("REJECTED", "PUBLISHED")).toBe(false);
    expect(canTransition("FAILED", "DRAFT")).toBe(false);
    expect(canTransition("PUBLISHED", "DRAFT")).toBe(false);
    expect(canTransition("DRAFT", "GENERATING")).toBe(false);
  });

  it("refuses every transition out of a final status", () => {
    for (const from of ["REJECTED", "PUBLISHED", "FAILED"] as const) {
      for (const to of PROPOSAL_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("isFinalStatus is true exactly for REJECTED, PUBLISHED and FAILED", () => {
    expect(PROPOSAL_STATUSES.filter((s) => isFinalStatus(s))).toEqual([
      "REJECTED",
      "PUBLISHED",
      "FAILED",
    ]);
  });
});

describe("proposal contract: constants and codes", () => {
  it("freezes the source bounds, timings, queue, retry limit", () => {
    expect([...ELIGIBLE_SOURCE_GROUPS]).toEqual(["RESOLVED", "CLOSED"]);
    expect(MIN_PROPOSAL_SOURCES).toBe(1);
    expect(MAX_PROPOSAL_SOURCES).toBe(5);
    expect(STUCK_AFTER_MS).toBe(600_000);
    expect(PROPOSAL_POLL_INTERVAL_MS).toBe(5_000);
    expect(KB_PROPOSAL_GENERATE_QUEUE).toBe("kb-proposal-generate");
    expect(KB_PROPOSAL_JOB_RETRY_LIMIT).toBe(2);
  });

  it("freezes the refusal code lists", () => {
    expect([...REQUEST_REFUSAL_CODES]).toEqual([
      "AI_OFF",
      "COUNT",
      "NOT_ALLOWED",
      "MEMBERSHIP_ENDED",
      "SELECTION",
    ]);
    expect([...TICKET_REFUSAL_REASONS]).toEqual([
      "NOT_RESOLVED",
      "MERGED",
      "NOT_FOUND",
      "DUPLICATE",
    ]);
    expect([...REVIEW_REFUSAL_CODES]).toEqual([
      "NOT_ALLOWED",
      "MEMBERSHIP_ENDED",
      "NOT_FOUND",
      "NOT_DRAFT",
      "CONFLICT",
      "CITATION_MARKER",
      "TICKET_LINK",
      "TITLE_TOO_SHORT",
      "TITLE_TOO_LONG",
      "BODY_REQUIRED",
    ]);
    expect([...MAINTENANCE_REFUSAL_CODES]).toEqual([
      "NOT_ALLOWED",
      "MEMBERSHIP_ENDED",
      "NOT_FOUND",
      "NOT_STUCK",
      "NOT_RETRYABLE",
      "CONFLICT",
    ]);
  });
});

describe("proposal contract: isStuck (review C5, injected clock)", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const longAgo = ago(30 * 24 * 60 * 60 * 1000);

  it("is true for a GENERATING proposal claimed exactly STUCK_AFTER_MS ago", () => {
    expect(
      isStuck(
        {
          status: "GENERATING",
          generationClaimedAt: ago(STUCK_AFTER_MS),
          generationQueuedAt: longAgo,
        },
        now,
      ),
    ).toBe(true);
  });

  it("is false one millisecond before the threshold", () => {
    expect(
      isStuck(
        {
          status: "GENERATING",
          generationClaimedAt: ago(STUCK_AFTER_MS - 1),
          generationQueuedAt: longAgo,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isStuck(
        {
          status: "GENERATING",
          generationClaimedAt: null,
          generationQueuedAt: ago(STUCK_AFTER_MS - 1),
        },
        now,
      ),
    ).toBe(false);
  });

  it("counts from generationQueuedAt while generationClaimedAt is null", () => {
    expect(
      isStuck(
        {
          status: "GENERATING",
          generationClaimedAt: null,
          generationQueuedAt: ago(STUCK_AFTER_MS),
        },
        now,
      ),
    ).toBe(true);
  });

  it("is false right after a restart of an old proposal (queued recently, never createdAt)", () => {
    // The proposal was created a month ago; the restart set generationQueuedAt one minute ago.
    // The input type has no creation timestamp at all, so it can never be read.
    expect(
      isStuck(
        { status: "GENERATING", generationClaimedAt: null, generationQueuedAt: ago(60_000) },
        now,
      ),
    ).toBe(false);
  });

  it("is false when the claim is recent although generationQueuedAt is old", () => {
    expect(
      isStuck(
        { status: "GENERATING", generationClaimedAt: ago(1_000), generationQueuedAt: longAgo },
        now,
      ),
    ).toBe(false);
  });

  it("is false for every status other than GENERATING", () => {
    for (const status of PROPOSAL_STATUSES.filter((s) => s !== "GENERATING")) {
      expect(
        isStuck({ status, generationClaimedAt: longAgo, generationQueuedAt: longAgo }, now),
        status,
      ).toBe(false);
    }
  });
});

describe("proposal contract: isProposalJobPayload (review R2-3)", () => {
  it("accepts exactly { proposalId, epoch } with a positive safe integer epoch", () => {
    expect(isProposalJobPayload({ proposalId: "p1", epoch: 1 })).toBe(true);
    expect(isProposalJobPayload({ proposalId: "p1", epoch: 7 })).toBe(true);
    expect(isProposalJobPayload({ proposalId: "p1", epoch: Number.MAX_SAFE_INTEGER })).toBe(true);
  });

  it("refuses a payload without an epoch (the shape sent before this rule)", () => {
    expect(isProposalJobPayload({ proposalId: "p1" })).toBe(false);
  });

  it("refuses an epoch that is not a positive safe integer", () => {
    for (const epoch of [0, -1, 1.5, "1", Number.NaN, Number.MAX_SAFE_INTEGER + 1, null]) {
      expect(isProposalJobPayload({ proposalId: "p1", epoch }), String(epoch)).toBe(false);
    }
  });

  it("refuses an empty or missing proposalId", () => {
    expect(isProposalJobPayload({ proposalId: "", epoch: 1 })).toBe(false);
    expect(isProposalJobPayload({ epoch: 1 })).toBe(false);
    expect(isProposalJobPayload({ proposalId: 5, epoch: 1 })).toBe(false);
  });

  it("refuses null, a string, an array and an object with a third key", () => {
    expect(isProposalJobPayload(null)).toBe(false);
    expect(isProposalJobPayload(undefined)).toBe(false);
    expect(isProposalJobPayload("p1")).toBe(false);
    expect(isProposalJobPayload(["p1", 1])).toBe(false);
    expect(isProposalJobPayload({ proposalId: "p1", epoch: 1, ticketId: "t1" })).toBe(false);
  });
});
