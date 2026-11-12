// The one syntax of an `@` mention (Phase 10, AIDA-45, D-20; review d-IN-1, run decisions K172 and
// K173). Pure and without imports, so the client composer (composer-tokens.ts), the renderer
// (src/lib/markdown/render.ts) and the server (mentions.ts) share it.
//
// The boundary rule. "@" + name is a mention in a text only when
//   - the character before the "@" is whitespace, or the "@" starts the text; and
//   - the character after the name is not a name character (a letter, a combining mark, a digit
//     or "_"), or the name ends the text.
// So in "orders@sales-desk.example", "x@Zeta", "(@Zeta)", "@Zetax" and "@Zeta_x" nothing is a
// mention of "sales" or "Zeta"; in "@Zeta,", "@Zeta." and a final "@Zeta" it is.
//
// Who uses it:
//   - findMentionQuery, the composer's trigger: an "@" opens the list only at a start boundary;
//   - outgoingMentionIds: the composer sends the id of an inserted span only when the span sits on
//     both boundaries;
//   - stripMentionTokens, the switch to public (K173): a copy of an inserted name goes only on both
//     boundaries, so an email address or a word keeps its text;
//   - the renderer: it wraps a name only on both boundaries, read on the Markdown source around
//     each text node (so "**@Zeta**" is no mention either), and the names it wrapped are the only
//     mentions the server records (K172).

const WHITESPACE = /\s/u;
const NAME_CHAR = /[\p{L}\p{M}\p{N}_]/u;

/** Whether an "@" at index `at` of `text` may start a mention: the text's start or whitespace. */
export function isMentionStartBoundary(text: string, at: number): boolean {
  if (at <= 0) return at === 0;
  return WHITESPACE.test(text[at - 1] ?? "");
}

/** Whether a mention may end right before index `end` of `text`: the end, or no name character. */
export function isMentionEndBoundary(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const codePoint = text.codePointAt(end);
  return codePoint === undefined || !NAME_CHAR.test(String.fromCodePoint(codePoint));
}

/**
 * Whether text.slice(at) starts with the token "@" + body on both boundaries. `body` is the text
 * after the "@" as it stands in `text` (the escaped name in Markdown source, the plain name in a
 * parsed text node).
 */
export function isMentionAt(text: string, at: number, body: string): boolean {
  return (
    body !== "" &&
    text[at] === "@" &&
    text.startsWith(body, at + 1) &&
    isMentionStartBoundary(text, at) &&
    isMentionEndBoundary(text, at + 1 + body.length)
  );
}
