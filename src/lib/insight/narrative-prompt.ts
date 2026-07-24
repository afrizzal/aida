import { z } from "zod/v4";

export const InsightNarrativeSchema = z.object({
  summary: z
    .string()
    .describe(
      "A 2-4 sentence plain-language summary of this period's ticket volume, SLA, and CSAT trends",
    ),
});
export type InsightNarrative = z.infer<typeof InsightNarrativeSchema>;

export const INSIGHT_NARRATIVE_SYSTEM_PROMPT =
  "You are a support-operations analyst. You will be given a JSON block of computed statistics for " +
  "a reporting period — ticket volume, SLA performance, and CSAT scores. This data is the ONLY " +
  "source of truth; do not invent numbers not present in it, and do not repeat the raw JSON verbatim. " +
  "Write a short (2-4 sentence) plain-language summary highlighting the most notable trend(s). " +
  "Output ONLY the requested structured field.";

export function buildNarrativePrompt(volumeDrivers: unknown, slaCsat: unknown): string {
  return [
    "Summarize this period's support operations data.",
    "",
    "<computed_stats>",
    JSON.stringify({ volumeDrivers, slaCsat }),
    "</computed_stats>",
  ].join("\n");
}
