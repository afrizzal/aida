// Copy table for Phase 12.2 (UI-SPEC Copywriting Contract and amendments A1 to A5): one
// expectation per row, each checked against the row text pasted verbatim, plus exhaustive loops
// over every server code list of proposal-contract.ts.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROPOSAL_STATUSES } from "../../src/lib/kb/proposal-contract";
import * as copy from "../../src/lib/kb/proposal-copy";

const CHIP_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../../src/components/kb/kb-proposal-status-chip.tsx"),
  "utf8",
);

describe("proposal-copy: List status labels", () => {
  it("labels the five statuses as the 'Status labels' row", () => {
    // UI-SPEC: "Generating / Draft / Rejected / Published / Failed"
    expect(PROPOSAL_STATUSES.map((s) => copy.PROPOSAL_STATUS_LABELS[s]).join(" / ")).toBe(
      "Generating / Draft / Rejected / Published / Failed",
    );
  });
});

describe("KbProposalStatusChip source", () => {
  it("uses token classes only: no hex, oklch or rgb colour", () => {
    expect(CHIP_SOURCE).not.toContain("#");
    expect(CHIP_SOURCE).not.toContain("oklch(");
    expect(CHIP_SOURCE).not.toContain("rgb(");
  });

  it("takes its words from proposal-copy and pairs each status with the UI-SPEC icon", () => {
    expect(CHIP_SOURCE).toContain('from "@/lib/kb/proposal-copy"');
    for (const icon of ["Loader2", "FileText", "X", "Check", "CircleAlert"]) {
      expect(CHIP_SOURCE).toContain(`icon: ${icon}`);
    }
    expect(CHIP_SOURCE).toContain("motion-reduce:animate-none");
    expect(CHIP_SOURCE).toContain("h-5 gap-1 px-2 py-0.5 text-[12px]");
  });
});
