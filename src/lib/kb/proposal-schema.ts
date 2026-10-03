// KB proposal output schema and validation (Phase 12.2, D-11). Model output is untrusted until
// validateProposalOutput accepts it; every length is counted in Unicode code points, the unit of
// Postgres char_length used by KbProposal_title_length_check.
//
// Relative imports only (no path alias): bundled into the worker by esbuild and used by the client editor.
import { z } from "zod/v4";

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
    .describe("The supporting sources, at most 20; never put them in the title or the body"),
});

export type ProposalOutput = z.infer<typeof proposalOutputSchema>;

export type ProposalOutputRefusal =
  | "TITLE_LENGTH"
  | "MARKER_IN_TITLE"
  | "BODY_EMPTY"
  | "BODY_TOO_LONG"
  | "MARKER_IN_BODY"
  | "FENCE_ECHO"
  | "TICKET_LINK"
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

  if (bodyMarkdown === "") return { ok: false, reason: "BODY_EMPTY" };
  if (codePointLength(bodyMarkdown) > BODY_MAX) return { ok: false, reason: "BODY_TOO_LONG" };
  if (containsSourceMarker(bodyMarkdown)) return { ok: false, reason: "MARKER_IN_BODY" };
  if (FENCE_TAG_PATTERN.test(bodyMarkdown)) return { ok: false, reason: "FENCE_ECHO" };

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
