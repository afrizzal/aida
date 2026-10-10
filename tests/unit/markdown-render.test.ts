import { describe, expect, it } from "vitest";
import { htmlLinkTargets, renderMarkdown, renderMarkdownPreview } from "@/lib/markdown/render";

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
    // Run decision K58 changed links (inert in the preview, see below), so the comparison body
    // holds none; the link case is the inert-link describe.
    const body = "## Steps\n\n**Restart** the `spooler` service.\n\n- one\n- ~~two~~";
    expect(renderMarkdownPreview(body)).toBe(renderMarkdown(body));
  });

  it("renderMarkdown itself is unchanged: it still keeps a remote image (manual KB articles)", () => {
    expect(renderMarkdown("![](https://example.com/p.png)")).toContain(
      'src="https://example.com/p.png"',
    );
  });
});

describe("renderMarkdownPreview: inert links (run decision K58, Codex D2)", () => {
  const BODY = [
    "## Steps",
    "",
    "Read the [VPN guide](https://docs.example.com/vpn-guide?x=1) first.",
    "",
    "Check <https://status.example.com/> and www.example.org, or [relative](/kb/abc).",
  ].join("\n");

  it("renders no anchor and no href for any link of the body", () => {
    const html = renderMarkdownPreview(BODY);
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toMatch(/\shref=/);
    expect(htmlLinkTargets(html)).toEqual([]);
  });

  it("shows each link's text followed by its target as plain text", () => {
    const html = renderMarkdownPreview(BODY);
    expect(html).toContain("VPN guide (https://docs.example.com/vpn-guide?x=1)");
    expect(html).toContain("relative (/kb/abc)");
    expect(html).toContain("www.example.org (http://www.example.org)");
    // An autolink whose text is its target is shown once.
    expect(html).toContain("https://status.example.com/");
    expect(html).not.toContain("https://status.example.com/ (https://status.example.com/)");
  });

  it("the link text cannot stand in for the target: the real target is shown after it", () => {
    const html = renderMarkdownPreview("[https://bank.example](https://attacker.example/p?d=x)");
    expect(html).toContain("https://bank.example (https://attacker.example/p?d=x)");
    expect(html).not.toMatch(/\shref=/);
  });

  it("escapes a target as text, and a sanitizer-emptied link keeps only its text", () => {
    const html = renderMarkdownPreview('[x](https://a.example/?q="<b>")');
    expect(html).not.toContain("<b>");
    expect(html).not.toMatch(/\shref=/);
    const js = renderMarkdownPreview("[click](javascript:alert(1))");
    expect(js).not.toContain("javascript:");
    expect(js).toContain("click");
  });

  it("renderMarkdown, the publish renderer, keeps live links", () => {
    expect(renderMarkdown("[g](https://docs.example.com/g)")).toContain(
      'href="https://docs.example.com/g"',
    );
  });
});

describe("htmlLinkTargets (UI-SPEC amendment A7, review b-WR-07)", () => {
  // The publish dialog lists every distinct link target of the server-rendered body as plain
  // text, so a reviewer sees where "[Reset your password](…)" really goes.
  it("lists each distinct href of the rendered body once, in document order", () => {
    // Read from renderMarkdown, the publish renderer: the preview has no anchors since K58.
    const html = renderMarkdown(
      [
        "[Reset your password](https://attacker.example/reset?x=1)",
        "See <https://docs.example.com/a> and www.example.org.",
        "[again](https://attacker.example/reset?x=1) [mail](mailto:help@example.com)",
        "[relative](/kb/abc)",
      ].join("\n\n"),
    );
    expect(htmlLinkTargets(html)).toEqual([
      "https://attacker.example/reset?x=1",
      "https://docs.example.com/a",
      "http://www.example.org",
      "mailto:help@example.com",
      "/kb/abc",
    ]);
  });

  it("reads the target, never the link text", () => {
    const html = renderMarkdown("[https://bank.example](https://attacker.example/p)");
    expect(htmlLinkTargets(html)).toEqual(["https://attacker.example/p"]);
  });

  it("gives an empty list for a body without links, and ignores image sources", () => {
    expect(htmlLinkTargets(renderMarkdown("## Steps\n\n1. Open Settings."))).toEqual([]);
    expect(htmlLinkTargets(renderMarkdown("![x](/images/a.png)"))).toEqual([]);
    expect(htmlLinkTargets("")).toEqual([]);
  });

  it("a link the sanitizer emptied (javascript:) is not listed", () => {
    expect(htmlLinkTargets(renderMarkdown("[x](javascript:alert(1))"))).toEqual([]);
  });
});
