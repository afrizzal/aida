// Secret redaction (D-13/D-14) — a small, explicit regex set for "obvious secrets" per
// docs/SECURITY.md (API keys, passwords/tokens, card-like numbers), NOT a general PII library.
//
// Redaction is baked into `complete()` (see ./complete.ts) so it is structurally impossible for
// any future AI feature to skip it — this module has no opt-out flag by design.
//
// node/regex only — no internal project imports — bundleable by both webpack and esbuild.
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI-style API keys
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, // Anthropic-style API keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ID
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi, // generic bearer tokens
  /\b(?:\d[ -]?){13,19}\b/g, // card-like number sequences
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "[redacted]"), text);
}
