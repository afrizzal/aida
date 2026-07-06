import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "@/lib/markdown/render";

describe("sanitizeEmailHtml", () => {
  it("strips a remote http image (tracking pixel)", () => {
    const out = sanitizeEmailHtml('<img src="http://tracker.example/pixel.gif">');
    expect(out).not.toContain("http://");
    expect(out).not.toMatch(/<img[^>]*src="http:\/\//);
  });

  it("strips a remote https image", () => {
    const out = sanitizeEmailHtml('<img src="https://x/y.png">');
    expect(out).not.toContain("https://");
  });

  it("preserves a relative same-origin image src (cid-rewritten)", () => {
    const out = sanitizeEmailHtml('<img src="/api/attachments/abc123">');
    expect(out).toContain('src="/api/attachments/abc123"');
  });

  it("strips <script> tags and inline event handlers", () => {
    const out = sanitizeEmailHtml('<script>alert(1)</script><b onclick="x">hi</b>');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("onclick");
  });

  it("stamps safe rel/target on links", () => {
    const out = sanitizeEmailHtml('<a href="https://ok">t</a>');
    expect(out).toContain('rel="nofollow noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});
