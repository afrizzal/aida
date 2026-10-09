// Review b-WR-05 (UI-SPEC 3i "Start success → the review page <h1> after navigation"): the Start
// dialog marks the new proposal before it navigates, and the review page takes the mark once on
// mount to focus its h1. A normal visit has no mark, so the page does not autofocus (3i "Review
// page load"). The repository has no component-test setup; this covers the rule both sides use.
import { beforeEach, describe, expect, it } from "vitest";
import { markStartedProposal, takeStartedProposal } from "../../src/lib/kb/proposal-arrival";

describe("started-proposal arrival mark (review b-WR-05)", () => {
  beforeEach(() => {
    takeStartedProposal("reset"); // clears any mark left by another case
  });

  it("is taken once, by the proposal that was started", () => {
    markStartedProposal("p1");
    expect(takeStartedProposal("p1")).toBe(true);
    expect(takeStartedProposal("p1")).toBe(false);
  });

  it("another proposal's page does not take it, and clears it", () => {
    markStartedProposal("p1");
    expect(takeStartedProposal("p2")).toBe(false);
    expect(takeStartedProposal("p1")).toBe(false);
  });

  it("without a mark, nothing is taken", () => {
    expect(takeStartedProposal("p1")).toBe(false);
  });

  it("a newer mark replaces an older one", () => {
    markStartedProposal("p1");
    markStartedProposal("p2");
    expect(takeStartedProposal("p2")).toBe(true);
    expect(takeStartedProposal("p1")).toBe(false);
  });
});
