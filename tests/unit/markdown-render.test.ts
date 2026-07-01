import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown/render";

describe("renderMarkdown", () => {
  it("renders bold markdown to <strong>", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
  });

  it("strips <script> tags from untrusted input", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  });

  it("strips javascript: URLs from links", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
  });

  it("strips onerror event-handler attributes", () => {
    expect(renderMarkdown("<img src=x onerror=alert(1)>")).not.toContain("onerror");
  });

  it("adds safe rel/target on external links", () => {
    const html = renderMarkdown("[link](https://a.com)");
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("supports GFM strikethrough", () => {
    expect(renderMarkdown("~~gone~~")).toContain("<del>");
  });
});
