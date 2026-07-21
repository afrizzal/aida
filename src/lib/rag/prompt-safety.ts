// Generalized prompt-injection fence (DRY-refactor of src/lib/triage/prompt.ts's
// fenceTicketContent) — used for BOTH untrusted surfaces in the draft prompt: the customer's
// ticket message AND every retrieved KB chunk. Escapes any closing-delimiter lookalike inside the
// untrusted text BEFORE wrapping, so untrusted content cannot break out of its own fence and
// inject fake instructions after it. Defense-in-depth only — the primary safety mechanism remains
// zero tool-calling surface in lib/llm plus the human-approval gate before any customer send.
export function fenceContent(tagName: string, rawText: string): string {
  const closeLookalike = new RegExp(`<\\s*/\\s*${tagName}\\s*>`, "gi");
  const escaped = rawText.replace(closeLookalike, "[escaped-tag]");
  return `<${tagName}>\n${escaped}\n</${tagName}>`;
}
