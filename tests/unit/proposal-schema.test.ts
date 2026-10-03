import { describe, expect, it } from "vitest";
import { validateProposalOutput } from "@/lib/kb/proposal-schema";

describe("validateProposalOutput tracer", () => {
  it("accepts a valid answer and maps each citation to its source position", () => {
    const result = validateProposalOutput(
      {
        title: "Resetting a password",
        bodyMarkdown: "## Steps\nOpen Settings.",
        citations: [{ source: "T1", section: "Steps" }],
      },
      1,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Resetting a password",
        bodyMarkdown: "## Steps\nOpen Settings.",
        citations: [{ position: 1, section: "Steps" }],
      },
    });
  });
});
