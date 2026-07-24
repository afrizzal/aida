// Builds the embedding/labeling input for one ticket: subject + a redacted body excerpt.
// AIDA-20 fix: embed() does NOT redact (unlike complete()) — redact the FULL body BEFORE
// slicing (Pitfall 2), so a secret pattern isn't truncated mid-match and leaked.
import { redactSecrets } from "../llm/redact";

export function buildTicketExcerpt(
  subject: string,
  firstPublicInboundBody: string | null,
  charLimit: number,
): string {
  if (!firstPublicInboundBody) return subject; // Pitfall 7: fall back to subject alone, never throw
  const redacted = redactSecrets(firstPublicInboundBody);
  return `${subject}\n${redacted.slice(0, charLimit)}`;
}
