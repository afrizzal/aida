// Heading-based Markdown chunker (Pattern 3, 05-RESEARCH.md): parses the article's Markdown with
// the already-installed remark-parse, walks the top-level root.children, and slices the ORIGINAL
// markdown string at each heading boundary using position.start.offset/end.offset. This needs
// NEITHER mdast-util-to-string NOR remark-stringify (Pitfall 6) — a chunk's stored `content` is
// an exact substring of the source Markdown (fidelity for citation preview), never a
// re-serialized approximation.
//
// Relative imports only (no `@/`) — this file is bundled into the worker (kb-embed-article job).
import type { Heading, Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

const CHUNK_CHAR_BUDGET = 1800; // ~450 tokens at a 4-char/token heuristic

export interface MarkdownChunk {
  headingPath: string | null;
  content: string;
}

interface Section {
  start: number;
  end: number;
  heading: string | null;
}

export function chunkMarkdown(markdown: string): MarkdownChunk[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const sections: Section[] = [];
  let currentStart = 0;
  let currentHeading: string | null = null;

  for (const node of tree.children) {
    if (node.type !== "heading" || !node.position) continue;
    const heading = node as Heading;
    if (heading.depth > 2) continue;

    const headingStart = node.position.start.offset;
    const headingEnd = node.position.end.offset;
    if (headingStart === undefined || headingEnd === undefined) continue;

    if (headingStart > currentStart) {
      sections.push({ start: currentStart, end: headingStart, heading: currentHeading });
    }
    currentStart = headingStart;
    currentHeading = markdown.slice(headingStart, headingEnd).replace(/^#+\s*/, "");
  }
  sections.push({ start: currentStart, end: markdown.length, heading: currentHeading });

  // Sub-split any section exceeding the char budget on paragraph boundaries (blank-line splits),
  // preserving the same headingPath for every sub-chunk.
  return sections.flatMap(({ start, end, heading }) => {
    const text = markdown.slice(start, end).trim();
    if (text.length === 0) return [];
    if (text.length <= CHUNK_CHAR_BUDGET) return [{ headingPath: heading, content: text }];

    const paragraphs = text.split(/\n{2,}/);
    const out: MarkdownChunk[] = [];
    let buf = "";
    for (const p of paragraphs) {
      if (buf.length + p.length > CHUNK_CHAR_BUDGET && buf) {
        out.push({ headingPath: heading, content: buf.trim() });
        buf = "";
      }
      buf += `${p}\n\n`;
    }
    if (buf.trim()) out.push({ headingPath: heading, content: buf.trim() });
    return out;
  });
}
