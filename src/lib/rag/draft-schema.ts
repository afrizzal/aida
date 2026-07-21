// The single source of truth for the draft-generation structured output (mirrors
// src/lib/triage/schema.ts's exact zod/v4 convention).
import { z } from "zod/v4";

export const DraftCitationSchema = z.object({
  marker: z.string().describe("The bracketed number used inline, e.g. '1'"),
  chunkId: z.string(),
});

export const DraftResultSchema = z.object({
  grounded: z
    .boolean()
    .describe("false if none of the provided sources actually answer the question"),
  draftMarkdown: z
    .string()
    .describe("The drafted reply body in Markdown, with inline [1][2] citation markers"),
  citations: z.array(DraftCitationSchema),
});

export type DraftResult = z.infer<typeof DraftResultSchema>;
