// The mention model of the ticket composer (Phase 10, AIDA-45, D-20, D-21; review rows C7, R2-1,
// R3-2, V-12). Pure: no React, no framework, no I/O, so tests/unit drives it directly and the
// composer (src/components/tickets/composer.tsx) holds its whole draft in mentionDraftReducer.
//
// The model. The draft is the text plus one span per inserted mention, { userId, name, start, end },
// where text.slice(start, end) is exactly mentionToken(name): "@" plus the name escaped for Markdown
// (run decision K174, mention-syntax.ts), so a name holding "*", "_" or "[x](url)" is never parsed
// as markup and the renderer finds it. Inserting a member replaces the typed "@query" with the token
// and a space, and records a span over the token only, never the trailing space. Every later text
// change goes through applyTextEdit: spans outside the edited range are kept or shifted, and a span
// the edit touches inside loses its remaining characters and its id, so a fragment of a member name
// never stays behind. That gives the R3-2 two-step Backspace: the first Backspace after an insertion
// removes the trailing space (outside the span), the next one touches the span's last character and
// removes the whole name.
//
// One token rule, isIntactSpan, decides both what is sent and what a switch to public removes:
// reconcileMentionIds sends the id of every intact span, and stripMentionTokens removes every intact
// span whatever follows it, then any copy of a name inserted since the last send (paste, undo) that
// sits on the mention boundary of mention-syntax.ts (K173).
//
// The server re-validates everything (src/lib/mentions/mentions.ts, plan 10-07): this module only
// keeps the composer from offering or sending what the server would refuse.

import {
  escapeMentionName,
  isMentionAt,
  isMentionEndBoundary,
  isMentionStartBoundary,
  MAX_MENTIONS,
  mentionToken,
} from "./mention-syntax";

export type MentionMode = "public" | "internal";

/**
 * One inserted mention: text.slice(start, end) === mentionToken(name) while it is intact. `name` is
 * the member's display name as the server renders it, unescaped.
 */
export interface MentionSpan {
  userId: string;
  name: string;
  start: number;
  end: number;
}

/** A member the composer can insert: the id and the display name the server renders. */
export interface MentionMember {
  userId: string;
  name: string;
}

/** An open trigger: text.slice(start, end) is "@" + query, and end is the caret. */
export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

/** The longest query after "@" that still counts as a trigger. */
export const MAX_MENTION_QUERY_LENGTH = 64;

/** The single token rule: the span's range holds exactly mentionToken(name). */
export function isIntactSpan(text: string, span: MentionSpan): boolean {
  if (span.name === "") return false;
  if (span.start < 0 || span.end > text.length) return false;
  const token = mentionToken(span.name);
  if (span.end - span.start !== token.length) return false;
  return text.slice(span.start, span.end) === token;
}

const WHITESPACE = /\s/u;

/**
 * The query after an "@" before the caret, or null. The "@" must sit on the start boundary of
 * mention-syntax.ts, the start of the text or after whitespace ("a@b" is not a trigger), must not
 * belong to a span, and the query may hold
 * single spaces (names have them) but no line break, no second "@", no leading space and no double
 * space.
 */
export function findMentionQuery(
  text: string,
  caret: number,
  spans: readonly MentionSpan[] = [],
): MentionQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
  if (spans.some((span) => span.start < caret && caret < span.end)) return null;
  const floor = Math.max(0, caret - MAX_MENTION_QUERY_LENGTH - 1);
  for (let i = caret - 1; i >= floor; i--) {
    const ch = text[i];
    if (ch === "\n" || ch === "\r" || ch === "\t") return null;
    if (ch !== "@") continue;
    if (!isMentionStartBoundary(text, i)) return null;
    if (spans.some((span) => span.start <= i && i < span.end)) return null;
    const query = text.slice(i + 1, caret);
    if (query.startsWith(" ") || query.includes("  ")) return null;
    return { start: i, end: caret, query };
  }
  return null;
}

/** A member as the mentionable route returns it. */
export interface MentionCandidate {
  id: string;
  name: string;
  email: string;
}

/** At most this many options are rendered; the list scrolls past eight. */
export const MAX_MENTION_OPTIONS = 50;

/**
 * The candidates whose name or email contains the query (case-insensitive), names starting with it
 * first, otherwise in the order given. An empty query keeps every candidate.
 */
export function filterMentionCandidates<T extends MentionCandidate>(
  candidates: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return candidates.slice(0, MAX_MENTION_OPTIONS);
  const starts: T[] = [];
  const contains: T[] = [];
  for (const candidate of candidates) {
    const name = candidate.name.toLocaleLowerCase();
    if (name.startsWith(needle)) starts.push(candidate);
    else if (name.includes(needle) || candidate.email.toLocaleLowerCase().includes(needle)) {
      contains.push(candidate);
    }
  }
  return [...starts, ...contains].slice(0, MAX_MENTION_OPTIONS);
}

/**
 * Whether the autocomplete shows for a query: a query without whitespace always does (with the
 * no-match row when nothing matches); once the query holds a space it shows only while something
 * still matches, so a plain "@someone said" sentence closes it.
 */
export function shouldOfferMentions(query: MentionQuery | null, matchCount: number): boolean {
  if (query === null) return false;
  return !WHITESPACE.test(query.query) || matchCount > 0;
}

/**
 * The name line of an option: the email when the member has no display name of their own (the
 * route then sends the email's local part as the name, which is what an insertion writes).
 */
export function mentionOptionLabel(candidate: MentionCandidate): string {
  const at = candidate.email.indexOf("@");
  const local = at === -1 ? candidate.email : candidate.email.slice(0, at);
  return candidate.name === local ? candidate.email : candidate.name;
}

export interface MentionTextState {
  text: string;
  spans: readonly MentionSpan[];
}

export interface MentionTextResult {
  text: string;
  spans: MentionSpan[];
  caret: number;
}

function sortSpans(spans: MentionSpan[]): MentionSpan[] {
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Replaces the trigger "@query" with mentionToken(name) and a space (the name escaped for Markdown,
 * K174), records a span over the token (not the space),
 * shifts later spans and returns the caret after the space. A query that no longer matches the
 * text, or an empty name, changes nothing.
 */
export function insertMention(
  state: MentionTextState,
  query: MentionQuery,
  member: MentionMember,
): MentionTextResult {
  const { text } = state;
  const unchanged = { text, spans: [...state.spans], caret: query.end };
  if (member.name === "" || member.userId === "") return unchanged;
  if (query.start < 0 || query.end > text.length || query.start >= query.end) return unchanged;
  if (text.slice(query.start, query.end) !== `@${query.query}`) return unchanged;

  const token = mentionToken(member.name);
  const replacement = `${token} `;
  const delta = replacement.length - (query.end - query.start);
  const spans: MentionSpan[] = [];
  for (const span of state.spans) {
    if (span.end <= query.start) spans.push({ ...span });
    else if (span.start >= query.end) {
      spans.push({ ...span, start: span.start + delta, end: span.end + delta });
    }
    // A span overlapping the trigger cannot exist (findMentionQuery refuses one); drop it.
  }
  spans.push({
    userId: member.userId,
    name: member.name,
    start: query.start,
    end: query.start + token.length,
  });
  return {
    text: text.slice(0, query.start) + replacement + text.slice(query.end),
    spans: sortSpans(spans),
    caret: query.start + replacement.length,
  };
}

/**
 * Applies one text change. The edited range is found as the common prefix and the common suffix of
 * the old and the new text; when the caret after the change is given (the textarea's selection),
 * the suffix is bounded by the text after the caret, so typing a character equal to its neighbour
 * lands where it was typed. Spans before the range are kept, spans after it are shifted, and for a
 * span the range touches inside (a removed or replaced character of the span, or an insertion
 * strictly inside it; an insertion exactly at its start or end does not touch it) the span's
 * remaining characters are deleted and its id is dropped. Characters the edit typed stay.
 */
export function applyTextEdit(
  state: MentionTextState,
  nextText: string,
  caretHint?: number,
): MentionTextResult {
  const old = state.text;
  const hint =
    caretHint !== undefined && Number.isInteger(caretHint) && caretHint >= 0
      ? Math.min(caretHint, nextText.length)
      : undefined;
  if (old === nextText) {
    return { text: old, spans: [...state.spans], caret: hint ?? nextText.length };
  }

  const oldLen = old.length;
  const newLen = nextText.length;
  const minLen = Math.min(oldLen, newLen);
  let prefix = 0;
  let suffix = 0;
  if (hint !== undefined) {
    const suffixMax = Math.min(minLen, newLen - hint);
    while (suffix < suffixMax && old[oldLen - 1 - suffix] === nextText[newLen - 1 - suffix]) {
      suffix++;
    }
    while (prefix < minLen - suffix && old[prefix] === nextText[prefix]) prefix++;
  } else {
    while (prefix < minLen && old[prefix] === nextText[prefix]) prefix++;
    while (suffix < minLen - prefix && old[oldLen - 1 - suffix] === nextText[newLen - 1 - suffix]) {
      suffix++;
    }
  }

  const editStart = prefix;
  const editEnd = oldLen - suffix; // exclusive, in the old text
  const delta = newLen - oldLen;
  const kept: MentionSpan[] = [];
  const removals: [number, number][] = []; // ranges of the new text
  for (const span of state.spans) {
    const touches =
      editStart < editEnd
        ? editStart < span.end && editEnd > span.start
        : span.start < editStart && editStart < span.end;
    if (!touches) {
      if (span.end <= editStart) kept.push({ ...span });
      else kept.push({ ...span, start: span.start + delta, end: span.end + delta });
      continue;
    }
    if (span.start < editStart) removals.push([span.start, editStart]);
    if (span.end > editEnd) removals.push([editEnd + delta, span.end + delta]);
  }

  let text = nextText;
  let caret = hint ?? editEnd + delta;
  removals.sort((a, b) => b[0] - a[0]);
  for (const [from, to] of removals) {
    const length = to - from;
    text = text.slice(0, from) + text.slice(to);
    for (const span of kept) {
      if (span.start >= to) {
        span.start -= length;
        span.end -= length;
      }
    }
    if (caret >= to) caret -= length;
    else if (caret > from) caret = from;
  }

  return {
    text,
    spans: sortSpans(kept.filter((span) => isIntactSpan(text, span))),
    caret,
  };
}

/** The id of every intact span, each once, in text order. */
export function reconcileMentionIds(text: string, spans: readonly MentionSpan[]): string[] {
  const ids: string[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (isIntactSpan(text, span) && !ids.includes(span.userId)) ids.push(span.userId);
  }
  return ids;
}

/**
 * The text with every inserted member name removed, for a switch to public (C7, R2-1): every intact
 * span goes whatever follows it (space, punctuation, a letter or the end), then every copy of a name
 * inserted since the last send that sits on the mention boundary of mention-syntax.ts (a paste or an
 * undo brought it back without a span): whitespace or the start before the "@", and no letter,
 * mark, digit or "_" after the name (run decision K173, review d-WR-3). So an email address such as
 * "orders@sales-desk.example", a URL path or a word keeps its text. The longest name is tried
 * first, so names sharing a prefix never affect each other. Plain "@text" the agent typed stays.
 */
export function stripMentionTokens(
  text: string,
  spans: readonly MentionSpan[],
  insertedNames: readonly string[],
): string {
  let out = text;
  const intact = spans.filter((span) => isIntactSpan(text, span)).sort((a, b) => b.start - a.start);
  for (const span of intact) out = out.slice(0, span.start) + out.slice(span.end);

  // Each name as the composer writes it (escaped, K174) and as it would be pasted unescaped.
  const names = [...new Set([...insertedNames, ...spans.map((span) => span.name)])]
    .filter((name) => name !== "")
    .flatMap((name) => [escapeMentionName(name), name]);
  const bodies = [...new Set(names)].sort((a, b) => b.length - a.length);
  if (bodies.length === 0) return out;

  let result = "";
  let i = 0;
  while (i < out.length) {
    if (out[i] === "@" && isMentionStartBoundary(out, i)) {
      const hit = bodies.find((body) => isMentionAt(out, i, body));
      if (hit !== undefined) {
        i += hit.length + 1;
        continue;
      }
    }
    result += out[i];
    i++;
  }
  return result;
}

/**
 * The ids a send carries: in internal mode the ids of the intact spans that sit on the mention
 * boundary of mention-syntax.ts (so "@Zetax" or "x@Zeta", which the renderer does not wrap and the
 * server does not record, K172, send nothing), each once in text order; in public mode none at all
 * (D-21), whatever the text or the spans hold. The composer builds its `mentions` field from this.
 */
export function outgoingMentionIds(state: {
  mode: MentionMode;
  text: string;
  spans: readonly MentionSpan[];
}): string[] {
  if (state.mode !== "internal") return [];
  const onBoundary = state.spans.filter(
    (span) =>
      isMentionStartBoundary(state.text, span.start) && isMentionEndBoundary(state.text, span.end),
  );
  return reconcileMentionIds(state.text, onBoundary);
}

/**
 * Whether a send already carries MAX_MENTIONS ids (review d-IN-3): the composer then stops offering
 * the list, and an insert of a member not yet among them changes nothing, so a note is never
 * refused by the server for its mention count.
 */
export function mentionCapReached(state: {
  mode: MentionMode;
  text: string;
  spans: readonly MentionSpan[];
}): boolean {
  return outgoingMentionIds(state).length >= MAX_MENTIONS;
}

/** The composer's whole draft. `caret` is where the textarea's caret goes after the next render. */
export interface MentionDraftState {
  text: string;
  spans: MentionSpan[];
  /** Names inserted since the last send: the safety net of stripMentionTokens. */
  insertedNames: string[];
  mode: MentionMode;
  /** The switch note under the textarea ("The mentioned names were removed from this reply."). */
  switchNote: boolean;
  /** The body came from an inserted AI draft (AIDA-16): the send carries `fromDraft`. */
  fromDraft: boolean;
  caret: number | null;
}

export const initialMentionDraft: MentionDraftState = {
  text: "",
  spans: [],
  insertedNames: [],
  mode: "public",
  switchNote: false,
  fromDraft: false,
  caret: null,
};

export type MentionDraftAction =
  | { type: "edit"; text: string; caret?: number }
  | { type: "insert"; query: MentionQuery; member: MentionMember }
  | { type: "setMode"; mode: MentionMode }
  | { type: "loadDraft"; text: string }
  | { type: "guardPublicSend" }
  | { type: "sent" };

/**
 * The composer's only state path. edit: applyTextEdit. insert: insertMention, internal mode only
 * (D-21). setMode: internal to public replaces the text with stripMentionTokens, clears the spans
 * and turns the switch note on when something was removed; public to internal turns it off.
 * loadDraft: an AI draft replaces the body and forces public with no span and no inserted name.
 * guardPublicSend (review d-IN-7, C7 at the send): in public mode, with names inserted since the
 * last send, removes any copy of them that came back after the switch (a paste, an undo), on the
 * same boundary rule as the switch, and turns the switch note on; with nothing to remove it
 * returns the same state, which the composer then sends.
 * sent: clears text, spans, inserted names, the note and the draft flag.
 * An insert of a member not yet mentioned changes nothing once mentionCapReached (d-IN-3).
 */
export function mentionDraftReducer(
  state: MentionDraftState,
  action: MentionDraftAction,
): MentionDraftState {
  switch (action.type) {
    case "edit": {
      if (action.text === state.text) return state;
      const next = applyTextEdit(state, action.text, action.caret);
      return { ...state, text: next.text, spans: next.spans, caret: next.caret };
    }
    case "insert": {
      if (state.mode !== "internal") return state;
      if (mentionCapReached(state) && !outgoingMentionIds(state).includes(action.member.userId)) {
        return state;
      }
      const next = insertMention(state, action.query, action.member);
      if (next.text === state.text) return state;
      const insertedNames = state.insertedNames.includes(action.member.name)
        ? state.insertedNames
        : [...state.insertedNames, action.member.name];
      return { ...state, text: next.text, spans: next.spans, insertedNames, caret: next.caret };
    }
    case "setMode": {
      if (action.mode === state.mode) return state;
      if (action.mode === "internal") {
        return { ...state, mode: "internal", switchNote: false };
      }
      const text = stripMentionTokens(state.text, state.spans, state.insertedNames);
      return {
        ...state,
        mode: "public",
        text,
        spans: [],
        switchNote: state.spans.length > 0 || text !== state.text,
        caret: text.length,
      };
    }
    case "loadDraft":
      return {
        ...state,
        text: action.text,
        spans: [],
        insertedNames: [],
        mode: "public",
        switchNote: false,
        fromDraft: true,
        caret: action.text.length,
      };
    case "guardPublicSend": {
      if (state.mode !== "public" || state.insertedNames.length === 0) return state;
      const text = stripMentionTokens(state.text, [], state.insertedNames);
      if (text === state.text) return state;
      return { ...state, text, spans: [], switchNote: true, caret: text.length };
    }
    case "sent":
      return {
        ...state,
        text: "",
        spans: [],
        insertedNames: [],
        switchNote: false,
        fromDraft: false,
        caret: null,
      };
    default:
      return state;
  }
}
