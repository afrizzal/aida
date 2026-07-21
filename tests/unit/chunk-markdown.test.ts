import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../../src/lib/rag/chunk-markdown";

describe("chunkMarkdown", () => {
  it("splits an article with two H2 sections into >=2 chunks with headingPath set", () => {
    const markdown = ["## Refunds", "We refund within 30 days.", "", "## Shipping", "Ships in 2 days."].join(
      "\n",
    );

    const chunks = chunkMarkdown(markdown);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].headingPath).toBe("Refunds");
    expect(chunks[1].headingPath).toBe("Shipping");
  });

  it("sub-splits a single section longer than CHUNK_CHAR_BUDGET into multiple chunks sharing the same headingPath", () => {
    // One paragraph per line so each is a distinct blank-line-separated "paragraph" the
    // sub-splitter can pack into budget-sized buffers.
    const paragraphs = Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i} filler text to pad this section well past the 1800 char budget.`,
    );
    const markdown = `## Long Section\n${paragraphs.join("\n\n")}`;

    const chunks = chunkMarkdown(markdown);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.headingPath).toBe("Long Section");
      expect(c.content.length).toBeLessThanOrEqual(1800 + 200); // budget + slack for a single overlong paragraph
    }
  });

  it("content before the first heading becomes a chunk with headingPath === null", () => {
    const markdown = ["Intro paragraph with no heading yet.", "", "## First Heading", "Body text."].join(
      "\n",
    );

    const chunks = chunkMarkdown(markdown);

    expect(chunks[0].headingPath).toBeNull();
    expect(chunks[0].content).toContain("Intro paragraph with no heading yet.");
    expect(chunks[1].headingPath).toBe("First Heading");
  });

  it("each chunk's content is an exact substring of the original markdown", () => {
    const markdown = [
      "Preamble text.",
      "",
      "## Section A",
      "Content of section A.",
      "",
      "## Section B",
      "Content of section B.",
    ].join("\n");

    const chunks = chunkMarkdown(markdown);

    for (const c of chunks) {
      expect(markdown).toContain(c.content);
    }
  });
});
