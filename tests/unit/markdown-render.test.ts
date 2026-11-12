import rehypeParse from "rehype-parse";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  htmlLinkTargets,
  MENTION_CLASS_NAMES,
  rehypeMentionSpanGuard,
  rehypeMentionSpanGuardAfterSanitize,
  renderMarkdown,
  renderMarkdownPlugins,
  renderMarkdownPreview,
  renderSanitizeSchema,
  renderTaskMarkdown,
  sanitizeEmailHtml,
} from "@/lib/markdown/render";
import { isMentionAt } from "@/lib/mentions/mention-syntax";

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

describe("renderTaskMarkdown (run decision K65, contract C9)", () => {
  // Task descriptions and comments: no image of any origin, each replaced by its alt text, and
  // live links with the safe attributes (no inert-link pass).
  it.each([
    ["remote", "![logo](https://evil.example/a.png)", "logo"],
    ["same-origin relative", "![shot](/api/attachments/1)", "shot"],
    ["protocol-relative", "![x](//host/a.png)", "x"],
    ["data URL", "![d](data:image/png;base64,AAAA)", "d"],
    ["reference-style", "![ref alt][pic]\n\n[pic]: https://evil.example/r.png", "ref alt"],
  ])("removes a %s image and keeps its alt text", (_kind, markdown, alt) => {
    const html = renderTaskMarkdown(markdown);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
    expect(html).toContain(alt);
  });

  it("removes the same-origin relative image the preview keeps", () => {
    expect(renderMarkdownPreview("![](/api/attachments/1)")).toContain("<img");
    const html = renderTaskMarkdown("![](/api/attachments/1)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/api/attachments/1");
  });

  it("keeps a linked image's link live, with the alt text as its text", () => {
    const html = renderTaskMarkdown(
      "[![alt text](https://img.example/a.png)](https://ok.example/page)",
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("img.example");
    expect(html).toContain('<a href="https://ok.example/page"');
    expect(html).toMatch(/<a [^>]*>alt text<\/a>/);
  });

  it("drops raw HTML: no img, no script, no onerror", () => {
    for (const markdown of ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>"]) {
      const html = renderTaskMarkdown(markdown);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<script");
      expect(html).not.toContain("onerror");
    }
  });

  it("renders a live link with the safe target and rel", () => {
    const html = renderTaskMarkdown("[a](https://ok.example)");
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
  });

  it("removes a javascript: href", () => {
    const html = renderTaskMarkdown("[b](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("b");
  });

  it("turns a bare https URL into a live link (GFM autolink)", () => {
    const html = renderTaskMarkdown("See https://ok.example/docs for more.");
    expect(html).toContain('<a href="https://ok.example/docs"');
    expect(html).toContain('target="_blank"');
  });

  it("renders the AIDA-101 rich text set", () => {
    const html = renderTaskMarkdown(
      ["## Heading", "**bold** *italic*", "- one\n- two", "[link](https://ok.example)"].join(
        "\n\n",
      ),
    );
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<a ");
  });
});

// Phase 10, plan 10-07 (AIDA-45, D-20, T-10-28): the mention span is the only addition to
// sanitized output, and only when the server supplies validated names.
describe("renderMarkdown mentions (D-20)", () => {
  const SPAN = '<span class="font-semibold text-primary-emphasis">';

  function spanCount(html: string): number {
    return html.match(/<span\b/g)?.length ?? 0;
  }

  /** Every opening tag name in the html, with its count. */
  function tagCounts(html: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b/g)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * The stages renderMarkdown runs after its tree is built: guard, schema, guard. The two guards
   * are two distinct plugins (K171): unified keeps one entry per plugin function, so the same
   * function attached twice would run once.
   */
  function sanitizeLikeRenderMarkdown(html: string): string {
    return String(
      unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeMentionSpanGuard)
        .use(rehypeSanitize, renderSanitizeSchema)
        .use(rehypeMentionSpanGuardAfterSanitize)
        .use(rehypeStringify)
        .processSync(html),
    );
  }

  // K171 (review d-WR-1): the guard after the sanitize pass really runs.
  it("K171: renderMarkdown attaches the span guard before and after the sanitize pass, as two distinct plugins", () => {
    const plugins = renderMarkdownPlugins();
    const sanitize = plugins.indexOf(rehypeSanitize);
    expect(sanitize).toBeGreaterThan(-1);
    expect(plugins.filter((plugin) => plugin === rehypeSanitize)).toHaveLength(1);
    // Right before the pass: the guard; right after it: the second guard; then stringify.
    expect(plugins[sanitize - 1]).toBe(rehypeMentionSpanGuard);
    expect(plugins[sanitize + 1]).toBe(rehypeMentionSpanGuardAfterSanitize);
    expect(plugins[sanitize + 2]).toBe(rehypeStringify);
    expect(rehypeMentionSpanGuardAfterSanitize).not.toBe(rehypeMentionSpanGuard);
    // Each guard is held once, so neither was merged into the other.
    expect(plugins.filter((plugin) => plugin === rehypeMentionSpanGuard)).toHaveLength(1);
    expect(plugins.filter((plugin) => plugin === rehypeMentionSpanGuardAfterSanitize)).toHaveLength(
      1,
    );
  });

  it("K171: the after-sanitize guard removes what the sanitizer lets through on a mention-shaped span", () => {
    const input =
      '<span class="font-semibold text-primary-emphasis" id="m" title="t" lang="en">@Ana</span>';
    // Control: the sanitize pass alone keeps the schema's global attributes on the span.
    const sanitizedOnly = String(
      unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeSanitize, renderSanitizeSchema)
        .use(rehypeStringify)
        .processSync(input),
    );
    expect(sanitizedOnly).toContain('id="user-content-m"');
    expect(sanitizedOnly).toContain('title="t"');
    // The pass followed by the after-sanitize guard keeps the two classes and nothing else.
    const guarded = String(
      unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeSanitize, renderSanitizeSchema)
        .use(rehypeMentionSpanGuardAfterSanitize)
        .use(rehypeStringify)
        .processSync(input),
    );
    expect(guarded).toBe(`${SPAN}@Ana</span>`);
  });

  it("renders no span without mentionNames", () => {
    const html = renderMarkdown("hi @Ana");
    expect(spanCount(html)).toBe(0);
    expect(html).toBe("<p>hi @Ana</p>");
  });

  it("wraps an exact @name in the mention span", () => {
    expect(renderMarkdown("hi @Ana, see this", { mentionNames: ["Ana"] })).toBe(
      `<p>hi ${SPAN}@Ana</span>, see this</p>`,
    );
  });

  it("does not wrap a longer word or an @ inside a word", () => {
    expect(spanCount(renderMarkdown("hi @Anabel", { mentionNames: ["Ana"] }))).toBe(0);
    expect(spanCount(renderMarkdown("hi @Ana_b", { mentionNames: ["Ana"] }))).toBe(0);
    expect(spanCount(renderMarkdown("mail x@Ana now", { mentionNames: ["Ana"] }))).toBe(0);
  });

  it("leaves @name inside inline code, a fenced block and a link as plain text", () => {
    const names = { mentionNames: ["Ana"] };
    expect(renderMarkdown("run `@Ana` now", names)).toBe("<p>run <code>@Ana</code> now</p>");
    const fenced = renderMarkdown("```\n@Ana\n```", names);
    expect(fenced).toContain("<pre><code>@Ana\n</code></pre>");
    expect(spanCount(fenced)).toBe(0);
    const linked = renderMarkdown("[@Ana](https://example.test/a)", names);
    expect(spanCount(linked)).toBe(0);
    expect(linked).toContain(">@Ana</a>");
  });

  it("prefers the longer name: @Zeta Prime is one span", () => {
    const html = renderMarkdown("ping @Zeta Prime and @Zeta", {
      mentionNames: ["Zeta", "Zeta Prime"],
    });
    expect(html).toBe(`<p>ping ${SPAN}@Zeta Prime</span> and ${SPAN}@Zeta</span></p>`);
    expect(spanCount(html)).toBe(2);
  });

  it("drops a literal span tag in the Markdown, mention classes included", () => {
    const markdown = 'Hi <span class="font-semibold text-primary-emphasis">@Ana</span> there';
    expect(spanCount(renderMarkdown(markdown))).toBe(0);
    expect(renderMarkdown(markdown)).not.toContain("text-primary-emphasis");
    // With names, only a text node can become a span. Here "@Ana" follows ">" in the source, so
    // it is no mention under the boundary rule (d-IN-1); after a space it is exactly one span.
    expect(spanCount(renderMarkdown(markdown, { mentionNames: ["Ana"] }))).toBe(0);
    const spaced = 'Hi <span class="font-semibold text-primary-emphasis"> @Ana</span> there';
    expect(spanCount(renderMarkdown(spaced, { mentionNames: ["Ana"] }))).toBe(1);
  });

  it("never lets another class or attribute on a span survive sanitization", () => {
    const html = sanitizeLikeRenderMarkdown(
      [
        '<span class="font-semibold text-primary-emphasis" style="color:red" data-x="1" id="m" title="t">@Ana</span>',
        '<span class="font-semibold text-primary-emphasis evil">@Bo</span>',
        '<span class="font-semibold">@Cy</span>',
        '<span class="text-primary-emphasis" id="d">@Di</span>',
        '<span style="position:fixed">@Ed</span>',
        '<span class="font-semibold text-primary-emphasis"><b>@Fa</b></span>',
      ].join(" "),
    );
    expect(html).toBe(`${SPAN}@Ana</span> @Bo @Cy @Di @Ed <b>@Fa</b>`);
    for (const forbidden of ["style", "data-x", "id=", "title", "evil", "position"]) {
      expect(html).not.toContain(forbidden);
    }
    expect(MENTION_CLASS_NAMES).toEqual(["font-semibold", "text-primary-emphasis"]);
  });

  it("50 distinct mentions render 50 spans and no other new element", () => {
    const names = Array.from({ length: 50 }, (_, i) => `Member ${String(i).padStart(2, "0")}`);
    const markdown = `Heads up ${names.map((name) => `@${name}`).join(", ")}.`;
    const plain = renderMarkdown(markdown);
    const mentioned = renderMarkdown(markdown, { mentionNames: names });
    expect(spanCount(plain)).toBe(0);
    expect(spanCount(mentioned)).toBe(50);
    const before = tagCounts(plain);
    const after = tagCounts(mentioned);
    after.delete("span");
    expect(after).toEqual(before);
    for (const name of names) expect(mentioned).toContain(`${SPAN}@${name}</span>`);
  });

  it("escapes a hostile name as text and never wraps a name that contains @", () => {
    const hostile = 'Ana" onclick="x()';
    const html = renderMarkdown(`hi @${hostile}`, { mentionNames: [hostile] });
    expect(html).not.toMatch(/<span[^>]*onclick/);
    expect(spanCount(html)).toBe(1);
    const withEmail = renderMarkdown("hi @bo@example.test", { mentionNames: ["bo@example.test"] });
    expect(spanCount(withEmail)).toBe(0);
  });

  // Review d-IN-1: the renderer follows the one boundary rule of mention-syntax.ts, read on the
  // Markdown source: whitespace or the start before the "@", no letter, mark, digit or "_" after.
  it("d-IN-1: wraps only on the boundary rule, read on the Markdown source around each text node", () => {
    const names = { mentionNames: ["Ana"] };
    for (const refused of [
      "ask (@Ana) now",
      "**@Ana**",
      "x **@Ana** y",
      "see /@Ana/ path",
      "hi @Ana\u0301 there",
      "hi @Ana_b",
      "mail x@Ana now",
    ]) {
      expect(spanCount(renderMarkdown(refused, names)), refused).toBe(0);
    }
    for (const wrapped of [
      "**bold** @Ana",
      "- @Ana",
      "> @Ana",
      "hi\n@Ana",
      "line  \n@Ana",
      "@Ana**!**",
      "@Ana, @Ana.",
      "| a |\n| --- |\n| @Ana |",
    ]) {
      expect(spanCount(renderMarkdown(wrapped, names)), wrapped).toBeGreaterThan(0);
    }
  });

  it("d-IN-1: on plain text the renderer wraps exactly where isMentionAt finds the token", () => {
    const samples = [
      "@Ana",
      "hi @Ana",
      "hi @Ana, ok",
      "hi @Anabel",
      "hi @Ana1",
      "hi @Ana_",
      "hi @Ana\u0301",
      "hi x@Ana",
      "hi (@Ana)",
      "hi /@Ana/",
      "hi @Ana @Ana.",
      "hi\t@Ana",
      "orders@Ana-desk.example",
    ];
    for (const text of samples) {
      let expected = 0;
      for (let at = 0; at < text.length; at++) if (isMentionAt(text, at, "Ana")) expected++;
      expect(spanCount(renderMarkdown(text, { mentionNames: ["Ana"] })), text).toBe(expected);
    }
  });

  it("keeps the mention classes out of inbound email HTML (shared schema unchanged)", () => {
    const html = sanitizeEmailHtml(
      '<p><span class="font-semibold text-primary-emphasis">@Ana</span></p>',
    );
    expect(html).not.toContain("text-primary-emphasis");
    expect(renderMarkdownPreview("@Ana")).toBe("<p>@Ana</p>");
    expect(renderTaskMarkdown("@Ana")).toBe("<p>@Ana</p>");
  });
});
