// The two entry points of UI-SPEC Surface 1a (D-07, D-09): the reason "Propose KB article…" is
// disabled in the ticket menu and in the inbox bulk bar, in the order the UI-SPEC lists them.
import { describe, expect, it } from "vitest";
import {
  ENTRY_UNAVAILABLE_AI_OFF,
  ENTRY_UNAVAILABLE_MERGED,
  ENTRY_UNAVAILABLE_NOT_RESOLVED,
  ENTRY_UNAVAILABLE_TOO_MANY,
} from "../../src/lib/kb/proposal-copy";
import {
  proposalBulkUnavailableReason,
  proposalMenuUnavailableReason,
} from "../../src/lib/kb/proposal-entry";

describe("proposalMenuUnavailableReason", () => {
  it("returns the AI-off row first, even for a merged, unresolved ticket", () => {
    expect(proposalMenuUnavailableReason({ aiEnabled: false, group: "OPEN", merged: true })).toBe(
      ENTRY_UNAVAILABLE_AI_OFF,
    );
  });

  it("returns the AI-off row for a resolved ticket when AI is off", () => {
    expect(
      proposalMenuUnavailableReason({ aiEnabled: false, group: "RESOLVED", merged: false }),
    ).toBe(ENTRY_UNAVAILABLE_AI_OFF);
  });

  it("returns the merged row for a merged RESOLVED ticket", () => {
    expect(
      proposalMenuUnavailableReason({ aiEnabled: true, group: "RESOLVED", merged: true }),
    ).toBe(ENTRY_UNAVAILABLE_MERGED);
  });

  it("returns the merged row before the not-resolved row", () => {
    expect(proposalMenuUnavailableReason({ aiEnabled: true, group: "OPEN", merged: true })).toBe(
      ENTRY_UNAVAILABLE_MERGED,
    );
  });

  it("returns the not-resolved row for an OPEN ticket", () => {
    expect(proposalMenuUnavailableReason({ aiEnabled: true, group: "OPEN", merged: false })).toBe(
      ENTRY_UNAVAILABLE_NOT_RESOLVED,
    );
  });

  it("returns the not-resolved row for a PENDING ticket", () => {
    expect(
      proposalMenuUnavailableReason({ aiEnabled: true, group: "PENDING", merged: false }),
    ).toBe(ENTRY_UNAVAILABLE_NOT_RESOLVED);
  });

  it("returns null for a RESOLVED ticket", () => {
    expect(
      proposalMenuUnavailableReason({ aiEnabled: true, group: "RESOLVED", merged: false }),
    ).toBeNull();
  });

  it("returns null for a CLOSED ticket", () => {
    expect(
      proposalMenuUnavailableReason({ aiEnabled: true, group: "CLOSED", merged: false }),
    ).toBeNull();
  });
});

describe("proposalBulkUnavailableReason", () => {
  const LOCK = "Bulk actions stay off until you refresh the page or dismiss this message.";

  it("returns the AI-off row first, even for too many tickets and a locked bar", () => {
    expect(proposalBulkUnavailableReason({ aiEnabled: false, count: 6, locked: LOCK })).toBe(
      ENTRY_UNAVAILABLE_AI_OFF,
    );
  });

  it("returns the AI-off row for a valid selection when AI is off", () => {
    expect(proposalBulkUnavailableReason({ aiEnabled: false, count: 1, locked: null })).toBe(
      ENTRY_UNAVAILABLE_AI_OFF,
    );
  });

  it("returns the too-many row for 6 selected", () => {
    expect(proposalBulkUnavailableReason({ aiEnabled: true, count: 6, locked: null })).toBe(
      ENTRY_UNAVAILABLE_TOO_MANY,
    );
  });

  it("returns the too-many row before the lock reason", () => {
    expect(proposalBulkUnavailableReason({ aiEnabled: true, count: 100, locked: LOCK })).toBe(
      ENTRY_UNAVAILABLE_TOO_MANY,
    );
  });

  it("never offers an empty selection", () => {
    expect(proposalBulkUnavailableReason({ aiEnabled: true, count: 0, locked: null })).toBe(
      ENTRY_UNAVAILABLE_TOO_MANY,
    );
  });

  it("returns the bar's lock reason when locked", () => {
    expect(proposalBulkUnavailableReason({ aiEnabled: true, count: 3, locked: LOCK })).toBe(LOCK);
  });

  it("returns null for 1 selected", () => {
    expect(proposalBulkUnavailableReason({ aiEnabled: true, count: 1, locked: null })).toBeNull();
  });

  it("returns null for 5 selected", () => {
    expect(proposalBulkUnavailableReason({ aiEnabled: true, count: 5, locked: null })).toBeNull();
  });
});
