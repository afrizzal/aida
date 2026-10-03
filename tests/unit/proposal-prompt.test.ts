import { describe, expect, it } from "vitest";
import { buildProposalPrompt, PROPOSAL_SYSTEM_PROMPT } from "@/lib/kb/proposal-prompt";

const SUBJECT = "Login fails";
const MESSAGE = "I cannot log in";

describe("buildProposalPrompt tracer", () => {
  it("fences one ticket as one ticket_content block labelled T1, not truncated", () => {
    const { prompt, truncated } = buildProposalPrompt([
      { position: 1, subject: SUBJECT, messages: [{ seq: 1n, body: MESSAGE }] },
    ]);
    expect(truncated).toBe(false);
    expect(prompt.match(/<ticket_content id="T1">/g)).toHaveLength(1);
    expect(prompt.match(/<ticket_content\b/g)).toHaveLength(1);
    const block = prompt.slice(
      prompt.indexOf('<ticket_content id="T1">'),
      prompt.indexOf("</ticket_content>"),
    );
    expect(block).toContain(SUBJECT);
    expect(block).toContain(MESSAGE);
  });

  it("keeps ticket text out of the fixed system prompt, which states the untrusted-data rule", () => {
    expect(PROPOSAL_SYSTEM_PROMPT).not.toContain(SUBJECT);
    expect(PROPOSAL_SYSTEM_PROMPT).not.toContain(MESSAGE);
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(/ticket_content/);
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(/untrusted/i);
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(/never instructions/i);
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(/no source markers such as \[T1\]/);
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(/no links to tickets/);
  });
});
