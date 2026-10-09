import type { Element, Root } from "hast";
import type { Schema } from "hast-util-sanitize";
import rehypeParse from "rehype-parse";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

// Single shared sanitization schema: github-style defaultSchema plus safe
// rel/target attributes on links. Ticket text (agent + requester) is
// untrusted input — this is the ONLY Markdown->HTML pipeline in the app;
// never bypass it with a second ad hoc dangerouslySetInnerHTML call site.
const schema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ["target", "_blank"],
      ["rel", "nofollow noopener noreferrer"],
    ],
  },
};

// defaultSchema's allowlist only permits target/rel to SURVIVE sanitization
// if present — it does not add them. This plugin actually stamps every link
// with safe target/rel before the sanitize pass runs.
function rehypeSafeLinks() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "a") {
        node.properties = {
          ...node.properties,
          target: "_blank",
          rel: "nofollow noopener noreferrer",
        };
      }
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSafeLinks)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

export function renderMarkdown(markdown: string): string {
  return String(processor.processSync(markdown));
}

// Phase 12.2, run decision K54 (review a2-CR-01): the KB proposal review page previews a body the
// model wrote from untrusted ticket text. A remote image in it would be fetched by the reviewer's
// browser on page load, before any approval, and could carry ticket text to another host. The
// validators refuse every image in a proposal; this preview renderer is the second layer for a
// stored body that still holds one: an img or source whose URL is not same-origin relative
// (http(s), protocol-relative `//host`, backslash forms such as `/\host`, any scheme) loses its
// src and srcSet before the sanitize pass, exactly like rehypeStripRemoteImages does for email.

/** A fixed app page that a relative image URL is resolved against, as a browser would. */
const PREVIEW_BASE = new URL("https://aida.invalid/kb/proposals/preview");

/** True only for a URL that stays on the page's own origin when the browser resolves it. */
function isSameOriginImageUrl(candidate: string): boolean {
  try {
    return new URL(candidate.trim(), PREVIEW_BASE).origin === PREVIEW_BASE.origin;
  } catch {
    return false; // fail-closed: an unparsable URL is stripped
  }
}

function srcSetUrls(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(",")
      : [];
  return entries.map((entry) => entry.trim().split(/\s+/)[0] ?? "").filter((url) => url !== "");
}

function rehypeStripCrossOriginImageSources() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img" && node.tagName !== "source") return;
      const properties = node.properties ?? {};
      if (properties.src !== undefined && properties.src !== null) {
        if (typeof properties.src !== "string" || !isSameOriginImageUrl(properties.src)) {
          properties.src = undefined;
        }
      }
      if (properties.srcSet !== undefined && properties.srcSet !== null) {
        if (!srcSetUrls(properties.srcSet).every(isSameOriginImageUrl)) {
          properties.srcSet = undefined;
        }
      }
      node.properties = properties;
    });
  };
}

const previewProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSafeLinks)
  .use(rehypeStripCrossOriginImageSources)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

/**
 * renderMarkdown with every image source that is not same-origin relative removed (run decision
 * K54). For the KB proposal review preview only; published articles keep renderMarkdown.
 */
export function renderMarkdownPreview(markdown: string): string {
  return String(previewProcessor.processSync(markdown));
}

// Phase 12.2, UI-SPEC amendment A7 (review b-WR-07): the KB proposal publish dialog lists where
// the article's links really go, because an AI-written "[Reset your password](…)" shows only its
// text in the preview. Read from HTML this module rendered (renderMarkdown or
// renderMarkdownPreview), so a target the sanitizer removed is never listed.
const linkTargetParser = unified().use(rehypeParse, { fragment: true });

/** Every distinct non-empty `a` href of rendered HTML, in document order. */
export function htmlLinkTargets(html: string): string[] {
  const tree = linkTargetParser.parse(html) as Root;
  const targets: string[] = [];
  visit(tree, "element", (node: Element) => {
    if (node.tagName !== "a") return;
    const href = node.properties?.href;
    if (typeof href === "string" && href !== "" && !targets.includes(href)) targets.push(href);
  });
  return targets;
}

// Privacy-first (D-18): inbound email HTML must never be trusted to not
// contain remote tracking pixels. Strip the src of any http(s) <img> BEFORE
// the sanitize pass so the src-less node gets dropped entirely. Relative /
// same-origin src (e.g. cid images pre-rewritten to /api/attachments/{id} by
// the ingest step, D-19) is left untouched.
function rehypeStripRemoteImages() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "img" && typeof node.properties?.src === "string") {
        if (/^https?:\/\//i.test(node.properties.src)) {
          node.properties.src = undefined;
        }
      }
    });
  };
}

const emailHtmlProcessor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeStripRemoteImages)
  .use(rehypeSafeLinks)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

// Inbound email HTML is untrusted, already-rendered HTML (not Markdown) —
// this reuses the SAME sanitize `schema` and `rehypeSafeLinks` as
// renderMarkdown() above (one sanitization authority, STATE.md 02-02) but
// parses raw HTML via rehype-parse instead of remark, and additionally
// strips remote images (D-16/D-18).
export function sanitizeEmailHtml(html: string): string {
  return String(emailHtmlProcessor.processSync(html));
}
