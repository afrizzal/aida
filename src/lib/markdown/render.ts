import type { Element, ElementContent, Root } from "hast";
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

// Phase 10, AIDA-45 (D-20, V-12, T-10-28): mentions in internal notes. The server passes the
// display names of the members it validated inside the message transaction
// (src/lib/mentions/mentions.ts); only then does an exact `@` plus one of those names in a text
// node become a mention span. The span is the only addition to sanitized output:
//   - it is made from text that already sits in the tree, never from raw HTML (remark-rehype runs
//     without allowDangerousHtml, so a literal span in the Markdown never reaches the tree);
//   - the sanitize schema of renderMarkdown allows span with exactly MENTION_CLASS_NAMES;
//   - the span guard runs right before and right after the sanitize pass, as two distinct plugins
//     (rehypeMentionSpanGuard, rehypeMentionSpanGuardAfterSanitize; run decision K171: unified
//     keeps one entry per plugin function, so the same function attached twice runs once). It
//     keeps a span only when its class list is exactly those two classes and its children are
//     text, drops every other property (the schema's global `id` and friends), and unwraps any
//     other span to its children. Running it before the pass too means a span carrying an extra
//     class is unwrapped, not trimmed by the sanitizer into the mention shape.
// The shared `schema` above stays unchanged, so inbound email HTML (sanitizeEmailHtml), the KB
// preview and task content cannot carry the mention classes. A name that contains `@` is never
// wrapped, so the markup never carries an email address.

/** The classes of a mention span, and the only classes a span may keep (UI-SPEC, D-20). */
export const MENTION_CLASS_NAMES = ["font-semibold", "text-primary-emphasis"] as const;

/** The sanitize schema of renderMarkdown: the shared schema plus the one mention span shape. */
export const renderSanitizeSchema: Schema = {
  ...schema,
  attributes: {
    ...schema.attributes,
    span: [["className", ...MENTION_CLASS_NAMES]],
  },
};

const MENTION_SKIP_TAGS = new Set(["a", "code", "pre"]);
const NAME_CHAR_BEFORE = /[\p{L}\p{N}_]$/u;
const NAME_CHAR_AFTER = /^[\p{L}\p{N}_]/u;

function mentionSpan(name: string): Element {
  return {
    type: "element",
    tagName: "span",
    properties: { className: [...MENTION_CLASS_NAMES] },
    children: [{ type: "text", value: `@${name}` }],
  };
}

/**
 * Splits one text value at every `@name` occurrence (names sorted longest first). An occurrence
 * counts only at a word boundary: no letter, digit or `_` right before the `@` or right after the
 * name, so "@Anabel" is not "@Ana". Returns null when nothing matched.
 */
function splitMentions(value: string, names: readonly string[]): ElementContent[] | null {
  const out: ElementContent[] = [];
  let last = 0;
  let at = value.indexOf("@");
  while (at !== -1) {
    let matched: string | undefined;
    if (!NAME_CHAR_BEFORE.test(value.slice(Math.max(0, at - 2), at))) {
      for (const name of names) {
        const end = at + 1 + name.length;
        if (value.startsWith(name, at + 1) && !NAME_CHAR_AFTER.test(value.slice(end, end + 2))) {
          matched = name;
          break;
        }
      }
    }
    if (matched === undefined) {
      at = value.indexOf("@", at + 1);
      continue;
    }
    if (at > last) out.push({ type: "text", value: value.slice(last, at) });
    out.push(mentionSpan(matched));
    last = at + 1 + matched.length;
    at = value.indexOf("@", last);
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function wrapMentions(parent: Root | Element, names: readonly string[]): void {
  const next: (typeof parent.children)[number][] = [];
  let changed = false;
  for (const child of parent.children) {
    if (child.type === "element") {
      if (!MENTION_SKIP_TAGS.has(child.tagName)) wrapMentions(child, names);
      next.push(child);
    } else if (child.type === "text") {
      const parts = splitMentions(child.value, names);
      if (parts) {
        next.push(...parts);
        changed = true;
      } else {
        next.push(child);
      }
    } else {
      next.push(child);
    }
  }
  if (changed) parent.children = next as typeof parent.children;
}

interface MentionFileData {
  mentionNames?: readonly string[];
}

/** Before the sanitize pass: wraps the validated names (passed in the file's data) in spans. */
function rehypeMentions() {
  return (tree: Root, file: { data: unknown }) => {
    const raw = (file.data as MentionFileData).mentionNames ?? [];
    const names = [...new Set(raw)]
      .filter((name) => typeof name === "string" && name.trim() !== "" && !name.includes("@"))
      .sort((a, b) => b.length - a.length);
    if (names.length > 0) wrapMentions(tree, names);
  };
}

function isMentionSpan(node: Element): boolean {
  const className = node.properties?.className;
  return (
    Array.isArray(className) &&
    className.length === MENTION_CLASS_NAMES.length &&
    MENTION_CLASS_NAMES.every((name) => className.includes(name)) &&
    node.children.every((child) => child.type === "text")
  );
}

/**
 * Before and after the sanitize pass: a span survives only in the exact mention shape, with no
 * property but its two classes; any other span is replaced by its children.
 */
export function rehypeMentionSpanGuard() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "span") return;
      if (isMentionSpan(node)) {
        node.properties = { className: [...MENTION_CLASS_NAMES] };
        return;
      }
      if (!parent || index === undefined) return;
      parent.children.splice(index, 1, ...node.children);
      // Visit the span's former children next (they take its place).
      return index;
    });
  };
}

/**
 * The same guard after the sanitize pass, as a plugin of its own (run decision K171, review
 * d-WR-1): unified merges a second .use() of one function into its first entry, so attaching
 * rehypeMentionSpanGuard twice would run it only before the pass.
 */
export function rehypeMentionSpanGuardAfterSanitize() {
  return rehypeMentionSpanGuard();
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSafeLinks)
  .use(rehypeMentions)
  .use(rehypeMentionSpanGuard)
  .use(rehypeSanitize, renderSanitizeSchema)
  .use(rehypeMentionSpanGuardAfterSanitize)
  .use(rehypeStringify);

/**
 * The plugins renderMarkdown's processor actually holds, in order (one entry per attacher, as
 * unified keeps them). For the K171 unit test: it proves the guard is attached after the sanitize
 * pass too, which a rendered string cannot show.
 */
export function renderMarkdownPlugins(): readonly unknown[] {
  return processor.attachers.map(([plugin]) => plugin);
}

export interface RenderMarkdownOptions {
  /**
   * Display names of mentioned members, validated by the server inside the message transaction
   * (src/lib/mentions/mentions.ts). Never pass names taken from the request.
   */
  mentionNames?: readonly string[];
}

export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  const mentionData: MentionFileData = { mentionNames: options.mentionNames ?? [] };
  const data: Record<string, unknown> = { ...mentionData };
  return String(processor.processSync({ value: markdown, data }));
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

// Run decision K58 (Codex diff critique D2): a link the model wrote could carry ticket text or a
// bearer path to another host when the reviewer clicks it in the preview, before any approval.
// The preview therefore renders every link inert: after the sanitize pass, each `a` is replaced by
// its own children, followed by its target as plain text in parentheses (" (https://…)"), so the reviewer sees where the link would go and the browser receives no
// anchor and no href. The target is omitted when it equals the link's text (an autolink), and a
// link the sanitizer emptied (such as javascript:) keeps only its text. Published articles keep
// renderMarkdown and its live links; the publish dialog lists their targets (amendment A7).

function textOf(nodes: readonly ElementContent[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text") text += node.value;
    else if (node.type === "element") text += textOf(node.children);
  }
  return text;
}

function rehypeInertLinks() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "a" || !parent || index === undefined) return;
      const href = typeof node.properties?.href === "string" ? node.properties.href : "";
      const replacement: ElementContent[] = [...node.children];
      if (href !== "" && textOf(node.children) !== href) {
        replacement.push({ type: "text", value: ` (${href})` });
      }
      parent.children.splice(index, 1, ...replacement);
      // Visit the link's former children next (they take its place).
      return index;
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
  .use(rehypeInertLinks)
  .use(rehypeStringify);

/**
 * renderMarkdown with every image source that is not same-origin relative removed (run decision
 * K54) and every link rendered inert, its target shown as plain text after its text (run decision
 * K58). For the KB proposal review preview only; published articles keep renderMarkdown.
 */
export function renderMarkdownPreview(markdown: string): string {
  return String(previewProcessor.processSync(markdown));
}

// Phase 14, run decision K65 (contract C9): task descriptions and task comments are untrusted
// input that every reader of the project sees. An image of any origin would make each reader's
// browser send a request on page load, before anyone acts on it: a remote one reports the reader
// to another host, and a same-origin relative one (such as /api/attachments/{id}) carries the
// reader's cookie to an app route. K65 therefore removes every image from task content, of every
// origin, and keeps only its alt text as plain text (nothing when the alt is empty); picture and
// source elements go too. Links stay live with the safe target and rel attributes from
// rehypeSafeLinks, because a link needs a click; unsafe schemes are removed by the sanitize pass,
// and raw HTML never reaches the tree (remark-rehype runs without allowDangerousHtml). Unlike the
// KB preview there is no inert-link pass.

function rehypeReplaceImagesWithAlt() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (!parent || index === undefined) return;
      if (node.tagName === "picture" || node.tagName === "source") {
        parent.children.splice(index, 1);
        // Visit whatever moved into this position next.
        return index;
      }
      if (node.tagName !== "img") return;
      const alt = node.properties?.alt;
      const text = typeof alt === "string" ? alt : Array.isArray(alt) ? alt.join(" ") : "";
      if (text === "") {
        parent.children.splice(index, 1);
        return index;
      }
      parent.children.splice(index, 1, { type: "text", value: text });
      return index + 1;
    });
  };
}

const taskProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSafeLinks)
  .use(rehypeReplaceImagesWithAlt)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

/**
 * The renderer for task descriptions and task comments (run decision K65): no image of any
 * origin, each replaced by its alt text, and live links with the safe attributes.
 */
export function renderTaskMarkdown(markdown: string): string {
  return String(taskProcessor.processSync(markdown));
}

// Phase 12.2, UI-SPEC amendment A7 (review b-WR-07): the KB proposal publish dialog lists where
// the article's links really go. Read from HTML renderMarkdown rendered (the publish renderer; the
// preview has no anchors since run decision K58), so a target the sanitizer removed is never
// listed.
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
