import { describe, expect, it } from "vitest";
import { extractEmailBody } from "@/lib/channels/email/parse-body";

describe("extractEmailBody", () => {
  it("uses provided text/plain verbatim when both html and text exist", () => {
    const result = extractEmailBody({ html: "<p>Hi <b>there</b></p>", text: "Hi there" });
    expect(result).toEqual({ rawHtml: "<p>Hi <b>there</b></p>", text: "Hi there" });
  });

  it("derives text via html-to-text when only html exists", () => {
    const result = extractEmailBody({ html: "<p>Only HTML here</p>", text: undefined });
    expect(result.rawHtml).toBe("<p>Only HTML here</p>");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).not.toMatch(/</);
    expect(result.text).toContain("Only HTML here");
  });

  it("returns null rawHtml when there is no html part", () => {
    const result = extractEmailBody({ html: false, text: "plain body" });
    expect(result).toEqual({ rawHtml: null, text: "plain body" });
  });
});
