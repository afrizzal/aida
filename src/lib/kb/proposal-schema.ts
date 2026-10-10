// KB proposal output schema and validation (Phase 12.2, D-11). Model output is untrusted until
// validateProposalOutput accepts it; every length is counted in Unicode code points, the unit of
// Postgres char_length used by KbProposal_title_length_check.
//
// Run decision K51 (reviews C7, R2-2, R3-3 and P8) is the one reference rule of the phase: a source
// marker [T<n>] and a link to a ticket page are refused in the title and the body, fail-closed,
// nothing stripped. Run decision K57 widens "ticket page" to the public status bearer links, and
// run decision K58 to such a path carried in a link's query string or fragment. Generation
// (validateProposalOutput), save, publish and the editor (validateDraftFields) all use the checks
// of this module.
//
// Run decision K54 (review a2-CR-01): an image anywhere in the rendered title or body is refused,
// fail-closed, whatever its URL. A model-chosen image URL would be fetched by the reviewer's
// browser as soon as the draft is previewed, which can carry ticket text to another host.
// Generation refuses it as INVALID_OUTPUT; save, publish and the editor refuse it in the body as
// IMAGE_NOT_ALLOWED. The title is shown as plain text everywhere, so only generation checks it.
//
// Relative imports only (no path alias): bundled into the worker by esbuild and used by the
// client editor, which reads only the rendered URL attribute values and never inserts the HTML.
import type { Element, Root } from "hast";
import rehypeParse from "rehype-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { z } from "zod/v4";
import { renderMarkdown } from "../markdown/render";

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const BODY_MAX = 20000;
export const CITATIONS_MAX = 20;
export const SECTION_MIN = 1;
export const SECTION_MAX = 80;

/** Length in Unicode code points (an astral character counts once, a combining mark once). */
export function codePointLength(s: string): number {
  return Array.from(s).length;
}

export const proposalOutputSchema = z.object({
  title: z
    .string()
    .describe(
      "The article title, 3 to 120 characters, with no source markers such as [T1] and no links",
    ),
  bodyMarkdown: z
    .string()
    .describe(
      "The article body in Markdown with ## section headings, with no source markers such as [T1] and no links to tickets",
    ),
  citations: z
    .array(
      z.object({
        source: z
          .string()
          .describe("The label of one ticket_content block that supports the section, e.g. T1"),
        section: z
          .string()
          .describe("The heading of the article section this source supports, up to 80 characters"),
      }),
    )
    .describe(
      "The supporting sources, at least 1 and at most 20; never put them in the title or the body",
    ),
});

export type ProposalOutput = z.infer<typeof proposalOutputSchema>;

export type ProposalOutputRefusal =
  | "TITLE_LENGTH"
  | "MARKER_IN_TITLE"
  | "IMAGE_IN_TITLE"
  | "BODY_EMPTY"
  | "BODY_TOO_LONG"
  | "MARKER_IN_BODY"
  | "FENCE_ECHO"
  | "TICKET_LINK"
  | "IMAGE_IN_BODY"
  | "NO_CITATIONS"
  | "TOO_MANY_CITATIONS"
  | "SECTION_LENGTH"
  | "CITATION_UNKNOWN_SOURCE";

export type ValidProposal = {
  title: string;
  bodyMarkdown: string;
  citations: { position: number; section: string }[];
};

export type ProposalOutputResult =
  | { ok: true; value: ValidProposal }
  | { ok: false; reason: ProposalOutputRefusal };

/** A source marker: T followed by digits inside square brackets, any case, optional spaces. */
export const SOURCE_MARKER_PATTERN = /\[\s*T\s*\d+\s*\]/i;

export function containsSourceMarker(text: string): boolean {
  return SOURCE_MARKER_PATTERN.test(text);
}

const FENCE_TAG_PATTERN = /<\s*\/?\s*ticket_content\b/i;
const CITATION_SOURCE_PATTERN = /^T([1-9]\d*)$/;

function citationPosition(source: string, sourceCount: number): number | null {
  const match = CITATION_SOURCE_PATTERN.exec(source.trim());
  if (!match) return null;
  const position = Number.parseInt(match[1], 10);
  return position >= 1 && position <= sourceCount ? position : null;
}

// ---------------------------------------------------------------------------------------------
// Ticket page links (run decision K51)
// ---------------------------------------------------------------------------------------------

/** Fixed base a candidate is resolved against: an article page, as a browser would see it. */
const TICKET_LINK_BASE = "https://aida.invalid/kb/article";
/**
 * The paths that expose a ticket: the auth-gated ticket page (K51) and the public status bearer
 * links, which give anyone holding them read and follow-up access to a customer's ticket (run
 * decision K57: the status page and its public API).
 */
const TICKET_PATH_PREFIXES = ["/tickets/", "/status/", "/api/public/status/"] as const;

/** At most this many percent-decodes of one URL part (run decision K58, Codex round 2 R2D-1). */
const MAX_PERCENT_DECODES = 5;

/**
 * Percent-decodes `value` repeatedly until a decode no longer changes it, so a path encoded two or
 * more times (`%252Fstatus%252F…`) is read as the path (Codex diff round 2, R2D-1). Returns null,
 * which the caller treats as a ticket link (fail-closed), when a decode meets a malformed escape or
 * when MAX_PERCENT_DECODES decodes have all still changed the value.
 */
function decodeUntilStable(value: string): string | null {
  let current = value;
  for (let i = 0; i < MAX_PERCENT_DECODES; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return null;
}

/**
 * True when the candidate, resolved with the WHATWG URL parser against TICKET_LINK_BASE (dot
 * segments, protocol-relative URLs and backslashes normalised as a browser does; a leading `www.`
 * gets an https:// prefix), has a pathname that, percent-decoded, starts with /tickets/,
 * /status/ or /api/public/status/ (run decision K57) in any case. Run decision K58 (Codex diff
 * critique D2): the query string and the fragment, each percent-decoded, are read too, and
 * one that contains any of those paths anywhere (in any case) counts as a ticket link, so a bearer
 * path carried as a parameter of an external link (`https://other.example/?next=/status/…`) is
 * refused like the path itself. Each part is decoded repeatedly until a decode no longer changes
 * it, at most MAX_PERCENT_DECODES times (Codex diff round 2, R2D-1), so a path encoded two or more
 * times is read too. A malformed percent escape at any decode, or a part still changing after the
 * last allowed decode, counts as a ticket link (fail-closed). A candidate the parser rejects is
 * not a URL and is ignored. The host is not checked: a link to another site whose path starts with
 * one of these prefixes is refused too (documented false positive).
 */
export function isTicketPageUrl(candidate: string): boolean {
  let raw = candidate.trim();
  if (raw === "") return false;
  if (/^www\./i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw, TICKET_LINK_BASE);
  } catch {
    return false;
  }
  const path = decodeUntilStable(url.pathname);
  const search = decodeUntilStable(url.search);
  const hash = decodeUntilStable(url.hash);
  if (path === null || search === null || hash === null) return true;
  const carried = [search, hash];
  const lower = path.toLowerCase();
  if (TICKET_PATH_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  return carried.some((part) => {
    const text = part.toLowerCase();
    return TICKET_PATH_PREFIXES.some((prefix) => text.includes(prefix));
  });
}

/**
 * Characters stripped, as a run, from the start of a whitespace-delimited token (review R3-3),
 * plus the Markdown emphasis characters * _ ~ (run decision K53), the opening typographic quotes
 * and guillemet “ ‘ « and the table pipe | (review a2-IN-05).
 */
export const TOKEN_WRAP_LEADING = "([{<\"'`*_~\u201C\u2018\u00AB|";
/**
 * Characters stripped, as a run, from the end of a whitespace-delimited token (review R3-3), plus
 * * _ ~ (run decision K53), the closing typographic quotes and guillemet ” ’ » and | (a2-IN-05).
 */
export const TOKEN_WRAP_TRAILING = ")]}>.,;:!?\"'`*_~\u201D\u2019\u00BB|";

function charClass(chars: string): string {
  return `[${chars.replace(/[\\\]^-]/g, "\\$&")}]`;
}

const LEADING_WRAP = new RegExp(`^${charClass(TOKEN_WRAP_LEADING)}+`);
const TRAILING_WRAP = new RegExp(`${charClass(TOKEN_WRAP_TRAILING)}+$`);
const PATH_TOKEN_START = /^(?:\/|\.\/|\.\.\/)/;

/** Markdown inline link and image destinations: `](dest` or `](<dest>`. */
const INLINE_DESTINATION = /\]\(\s*(?:<([^>\n]*)>|([^\s)]+))/g;
/** Reference-style link definitions: `[label]: dest` at the start of a line. */
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]*)>|(\S+))/gm;
/** Autolinks: `<scheme:...>`. */
const AUTOLINK = /<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/gi;
/** href and src attribute values written in the text. */
const URL_ATTRIBUTE = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
/** Bare absolute URLs, wherever they appear: `scheme://...` and `www....`. */
const BARE_SCHEME_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi;
const BARE_WWW_URL = /www\.[^\s<>"'`]+/gi;

function matchedValues(text: string, pattern: RegExp): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const groups = match.slice(1).filter((g): g is string => typeof g === "string");
    values.push(groups.length > 0 ? groups[0] : match[0]);
  }
  return values;
}

/** Bare path tokens: wrapping punctuation stripped, then a leading /, ./ or ../ (review R3-3). */
function pathTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const token of text.split(/\s+/)) {
    const stripped = token.replace(LEADING_WRAP, "").replace(TRAILING_WRAP, "");
    if (PATH_TOKEN_START.test(stripped)) tokens.push(stripped);
  }
  return tokens;
}

/**
 * The raw-text check, for the title and the body: true when any Markdown link or image
 * destination, reference definition, autolink, href or src attribute value, bare absolute URL or
 * bare path token (after stripping wrapping punctuation) is a ticket page (isTicketPageUrl).
 * A path joined to a word by a character outside the wrapping sets (such as `see:/tickets/abc`)
 * is not found; free-form references to a ticket are not claimed.
 */
export function containsTicketLink(text: string): boolean {
  const candidates = [
    ...matchedValues(text, INLINE_DESTINATION),
    ...matchedValues(text, REFERENCE_DEFINITION),
    ...matchedValues(text, AUTOLINK),
    ...matchedValues(text, URL_ATTRIBUTE),
    ...matchedValues(text, BARE_SCHEME_URL),
    ...matchedValues(text, BARE_WWW_URL),
    ...pathTokens(text),
  ];
  return candidates.some(isTicketPageUrl);
}

/**
 * The hast URL properties that survive renderMarkdown's sanitizer (hast-util-sanitize
 * defaultSchema, extended in render.ts with target and rel only): a href; img src and longDesc;
 * blockquote, del, ins and q cite; source srcSet. Markdown produces URLs only on a and img; the
 * rest keep the check total over what the sanitizer lets through (review P8).
 */
export const RENDERED_URL_PROPERTIES = ["href", "src", "cite", "longDesc", "srcSet"] as const;

const renderedHtmlParser = unified().use(rehypeParse, { fragment: true });

function propertyUrls(name: (typeof RENDERED_URL_PROPERTIES)[number], value: unknown): string[] {
  if (name === "srcSet") {
    // Each comma-separated entry is "url descriptor"; the URL is its first whitespace part.
    const entries = Array.isArray(value)
      ? value.map(String)
      : typeof value === "string"
        ? value.split(",")
        : [];
    return entries.map((entry) => entry.trim().split(/\s+/)[0] ?? "").filter((u) => u !== "");
  }
  return typeof value === "string" ? [value] : [];
}

/**
 * The rendered check, for the body only: renders the body with renderMarkdown (the function that
 * produces a published article's bodyHtml), parses that HTML with rehype-parse and tests every
 * RENDERED_URL_PROPERTIES value of every element with isTicketPageUrl. Catches destinations
 * written with Markdown backslash escapes or HTML entities, which the raw text hides.
 */
export function renderedBodyLinksToTicket(bodyMarkdown: string): boolean {
  const tree = renderedHtmlParser.parse(renderMarkdown(bodyMarkdown)) as Root;
  let found = false;
  visit(tree, "element", (node: Element) => {
    if (found) return;
    for (const name of RENDERED_URL_PROPERTIES) {
      const urls = propertyUrls(name, node.properties?.[name]);
      if (urls.some(isTicketPageUrl)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

function bodyLinksToTicket(bodyMarkdown: string): boolean {
  return containsTicketLink(bodyMarkdown) || renderedBodyLinksToTicket(bodyMarkdown);
}

/**
 * The elements that make a browser fetch an image. Markdown produces only img (renderMarkdown
 * drops raw HTML); picture and source are listed because the sanitizer would keep them.
 */
const IMAGE_TAG_NAMES: ReadonlySet<string> = new Set(["img", "picture", "source"]);

/**
 * Run decision K54: true when the Markdown, rendered with renderMarkdown (the renderer of the
 * preview and of a published article's bodyHtml), contains any image element, whatever its URL.
 */
export function renderedMarkdownHasImage(markdown: string): boolean {
  const tree = renderedHtmlParser.parse(renderMarkdown(markdown)) as Root;
  let found = false;
  visit(tree, "element", (node: Element) => {
    if (IMAGE_TAG_NAMES.has(node.tagName)) found = true;
  });
  return found;
}

/**
 * Validates one model answer for a proposal built from `sourceCount` selected tickets.
 * Fail-closed: the first broken rule is returned as a typed reason and nothing is stripped.
 * Title and body are trimmed before checking and returned trimmed.
 */
export function validateProposalOutput(
  output: ProposalOutput,
  sourceCount: number,
): ProposalOutputResult {
  const title = typeof output.title === "string" ? output.title.trim() : "";
  const bodyMarkdown = typeof output.bodyMarkdown === "string" ? output.bodyMarkdown.trim() : "";
  const rawCitations = Array.isArray(output.citations) ? output.citations : [];

  const titleLength = codePointLength(title);
  if (titleLength < TITLE_MIN || titleLength > TITLE_MAX)
    return { ok: false, reason: "TITLE_LENGTH" };
  if (containsSourceMarker(title)) return { ok: false, reason: "MARKER_IN_TITLE" };
  // Review a2-IN-01: the fence-echo check covers the title too.
  if (FENCE_TAG_PATTERN.test(title)) return { ok: false, reason: "FENCE_ECHO" };
  if (containsTicketLink(title)) return { ok: false, reason: "TICKET_LINK" };
  if (renderedMarkdownHasImage(title)) return { ok: false, reason: "IMAGE_IN_TITLE" };

  if (bodyMarkdown === "") return { ok: false, reason: "BODY_EMPTY" };
  if (codePointLength(bodyMarkdown) > BODY_MAX) return { ok: false, reason: "BODY_TOO_LONG" };
  if (containsSourceMarker(bodyMarkdown)) return { ok: false, reason: "MARKER_IN_BODY" };
  if (FENCE_TAG_PATTERN.test(bodyMarkdown)) return { ok: false, reason: "FENCE_ECHO" };
  if (bodyLinksToTicket(bodyMarkdown)) return { ok: false, reason: "TICKET_LINK" };
  if (renderedMarkdownHasImage(bodyMarkdown)) return { ok: false, reason: "IMAGE_IN_BODY" };

  // Review a2-IN-04: a draft must name at least one supporting source (provenance); headings stay
  // free-form.
  if (rawCitations.length === 0) return { ok: false, reason: "NO_CITATIONS" };
  if (rawCitations.length > CITATIONS_MAX) return { ok: false, reason: "TOO_MANY_CITATIONS" };
  const citations: { position: number; section: string }[] = [];
  for (const citation of rawCitations) {
    const section = typeof citation?.section === "string" ? citation.section.trim() : "";
    const sectionLength = codePointLength(section);
    if (sectionLength < SECTION_MIN || sectionLength > SECTION_MAX) {
      return { ok: false, reason: "SECTION_LENGTH" };
    }
    const source = typeof citation?.source === "string" ? citation.source : "";
    const position = citationPosition(source, sourceCount);
    if (position === null) return { ok: false, reason: "CITATION_UNKNOWN_SOURCE" };
    citations.push({ position, section });
  }

  return { ok: true, value: { title, bodyMarkdown, citations } };
}

// ---------------------------------------------------------------------------------------------
// The one field validator for save, publish and the editor
// ---------------------------------------------------------------------------------------------

/** The same string literals as REVIEW_REFUSAL_CODES of proposal-contract.ts (not imported). */
export type DraftFieldCode =
  | "TITLE_TOO_SHORT"
  | "TITLE_TOO_LONG"
  | "CITATION_MARKER"
  | "TICKET_LINK"
  | "BODY_REQUIRED"
  | "IMAGE_NOT_ALLOWED"
  | "BODY_TOO_LONG";

export type DraftField = "title" | "bodyMarkdown";

export type DraftFieldsResult =
  | { ok: true; title: string; bodyMarkdown: string }
  | { ok: false; field: DraftField; code: DraftFieldCode };

/**
 * Checks a title and body in this order and returns the first failure with its field: title
 * under 3 code points, over 120, with a source marker, with a ticket link; body empty or
 * whitespace-only, over BODY_MAX code points (review a-IN-02: the bound generation applies, so a
 * saved draft can never be longer than a generated one), with a source marker, with a ticket link
 * (raw text or rendered URL attribute), with an image (run decision K54). Fail-closed, nothing
 * stripped; on success the trimmed values are returned.
 */
export function validateDraftFields(input: {
  title: string;
  bodyMarkdown: string;
}): DraftFieldsResult {
  const title = input.title.trim();
  const bodyMarkdown = input.bodyMarkdown.trim();

  const titleLength = codePointLength(title);
  if (titleLength < TITLE_MIN) return { ok: false, field: "title", code: "TITLE_TOO_SHORT" };
  if (titleLength > TITLE_MAX) return { ok: false, field: "title", code: "TITLE_TOO_LONG" };
  if (containsSourceMarker(title)) return { ok: false, field: "title", code: "CITATION_MARKER" };
  if (containsTicketLink(title)) return { ok: false, field: "title", code: "TICKET_LINK" };

  if (bodyMarkdown === "") return { ok: false, field: "bodyMarkdown", code: "BODY_REQUIRED" };
  if (codePointLength(bodyMarkdown) > BODY_MAX) {
    return { ok: false, field: "bodyMarkdown", code: "BODY_TOO_LONG" };
  }
  if (containsSourceMarker(bodyMarkdown)) {
    return { ok: false, field: "bodyMarkdown", code: "CITATION_MARKER" };
  }
  if (bodyLinksToTicket(bodyMarkdown)) {
    return { ok: false, field: "bodyMarkdown", code: "TICKET_LINK" };
  }
  if (renderedMarkdownHasImage(bodyMarkdown)) {
    return { ok: false, field: "bodyMarkdown", code: "IMAGE_NOT_ALLOWED" };
  }

  return { ok: true, title, bodyMarkdown };
}
