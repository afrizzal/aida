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
