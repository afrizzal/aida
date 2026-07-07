// The single source of truth for the triage classification output (D-08/D-09). Zod v4 —
// matches the rest of the codebase's zod import convention.
import { z } from "zod/v4";

export const TriageCategoryValues = [
  "BILLING",
  "TECHNICAL",
  "ACCOUNT",
  "FEATURE_REQUEST",
  "OTHER",
] as const;

export const TriageSentimentValues = ["POSITIVE", "NEUTRAL", "NEGATIVE"] as const;

export const TriageResultSchema = z.object({
  category: z.enum(TriageCategoryValues),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]), // matches the existing TicketPriority enum values
  sentiment: z.enum(TriageSentimentValues),
  language: z.string().length(2).describe("ISO 639-1 code, e.g. 'en', 'es', 'fr'"),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;
