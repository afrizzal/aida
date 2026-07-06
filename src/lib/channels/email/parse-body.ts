import type { ParsedMail } from "mailparser";
import { convert } from "html-to-text";

// Reduces a parsed inbound email's html/text parts to the two shapes the
// ingest orchestrator (plan 04) needs. Does NOT sanitize and does NOT save
// attachments here — the ingest step does cid rewriting + sanitizeEmailHtml()
// on rawHtml (it needs saved attachment ids first) and calls renderMarkdown()
// on `text` for the plain-text-only path (D-17).
export function extractEmailBody(
  parsed: Pick<ParsedMail, "html" | "text">,
): { rawHtml: string | null; text: string } {
  const rawHtml = typeof parsed.html === "string" ? parsed.html : null;
  const text = parsed.text?.trim() ? parsed.text : rawHtml ? convert(rawHtml, { wordwrap: false }) : "";
  return { rawHtml, text };
}
