// Phase 10, plan 10-12 Task 1 (AIDA-45, D-20, D-21; review rows C7, R2-1, R3-2, V-12): the pure
// mention model of the composer. Every case drives the same functions the composer calls; the
// text edits carry the caret the textarea reports after the change, as the composer's change
// handler does.
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown/render";
import {
  applyTextEdit,
  composerNote,
  filterMentionCandidates,
  findMentionQuery,
  initialMentionDraft,
  insertMention,
  isIntactSpan,
  MENTION_HOLD_NOTE,
  MENTION_SWITCH_NOTE,
  type MentionDraftAction,
  type MentionDraftState,
  type MentionMember,
  type MentionQuery,
  mentionCapReached,
  mentionDraftReducer,
  mentionOptionLabel,
  outgoingMentionIds,
  reconcileMentionIds,
  shouldOfferMentions,
  stripMentionTokens,
} from "@/lib/mentions/composer-tokens";
import { mentionDisplayName } from "@/lib/mentions/mentions";

const OMEGA: MentionMember = { userId: "u-omega", name: "Omega Probe" };
const ZETA: MentionMember = { userId: "u-zeta", name: "Zeta" };
const ZETA_PRIME: MentionMember = { userId: "u-zeta-prime", name: "Zeta Prime" };

function run(state: MentionDraftState, ...actions: MentionDraftAction[]): MentionDraftState {
  return actions.reduce(mentionDraftReducer, state);
}

const internal: MentionDraftState = { ...initialMentionDraft, mode: "internal" };

/** Types `chars` at the caret (default: the end), as a keystroke or a paste does. */
function type(state: MentionDraftState, chars: string, at = state.caret ?? state.text.length) {
  const text = state.text.slice(0, at) + chars + state.text.slice(at);
  return mentionDraftReducer(state, { type: "edit", text, caret: at + chars.length });
}

/** One Backspace with the caret at `at` (default: the caret). */
function backspace(state: MentionDraftState, at = state.caret ?? state.text.length) {
  const text = state.text.slice(0, at - 1) + state.text.slice(at);
  return mentionDraftReducer(state, { type: "edit", text, caret: at - 1 });
}

/** Replaces the selection [from, to) with `chars`. */
function replace(state: MentionDraftState, from: number, to: number, chars: string) {
  const text = state.text.slice(0, from) + chars + state.text.slice(to);
  return mentionDraftReducer(state, { type: "edit", text, caret: from + chars.length });
}

/** Types "@" plus the first letters of the name, then picks the member, as the autocomplete does. */
function mention(state: MentionDraftState, member: MentionMember, typed = member.name.slice(0, 2)) {
  const typedState = type(state, `@${typed}`);
  const query = queryAt(typedState.text, typedState.caret ?? 0, typedState.spans);
  return mentionDraftReducer(typedState, { type: "insert", query, member });
}

/** The open trigger at the caret; fails the test when there is none. */
function queryAt(
  text: string,
  caret: number,
  spans: MentionDraftState["spans"] = [],
): MentionQuery {
  const query = findMentionQuery(text, caret, spans);
  if (query === null) throw new Error(`no mention query at ${caret} in ${JSON.stringify(text)}`);
  return query;
}

function ids(state: MentionDraftState): string[] {
  return reconcileMentionIds(state.text, state.spans);
}

describe("findMentionQuery", () => {
  it("returns the query after an @ at the start or after whitespace", () => {
    expect(findMentionQuery("@Om", 3)).toEqual({ start: 0, end: 3, query: "Om" });
    expect(findMentionQuery("Hi @Om", 6)).toEqual({ start: 3, end: 6, query: "Om" });
    expect(findMentionQuery("Hi\n@", 4)).toEqual({ start: 3, end: 4, query: "" });
    expect(findMentionQuery("Hi @Omega P", 11)).toEqual({ start: 3, end: 11, query: "Omega P" });
  });

  it("returns null for an @ inside a word, an @ of an inserted span, a line break or a leading space", () => {
    expect(findMentionQuery("a@b", 3)).toBeNull();
    expect(findMentionQuery("Hi @Om\nx", 8)).toBeNull();
    expect(findMentionQuery("Hi @ x", 6)).toBeNull();
    expect(findMentionQuery("plain text", 10)).toBeNull();
    const span = { userId: "u", name: "Omega Probe", start: 0, end: 12 };
    expect(findMentionQuery("@Omega Probe", 12, [span])).toBeNull();
    expect(findMentionQuery("@Omega Probe", 5, [span])).toBeNull();
  });
});

describe("insertMention", () => {
  it("replaces @query with '@{Name} ', records a span over '@{Name}' only, shifts later spans and returns the caret after the space", () => {
    const later = { userId: "u-zeta", name: "Zeta", start: 7, end: 12 };
    const result = insertMention(
      { text: "Hi @Om @Zeta", spans: [later] },
      { start: 3, end: 6, query: "Om" },
      OMEGA,
    );
    expect(result.text).toBe("Hi @Omega Probe  @Zeta");
    expect(result.spans).toEqual([
      { userId: "u-omega", name: "Omega Probe", start: 3, end: 15 },
      { userId: "u-zeta", name: "Zeta", start: 17, end: 22 },
    ]);
    expect(result.caret).toBe(16);
    for (const span of result.spans) expect(isIntactSpan(result.text, span)).toBe(true);
  });

  it("adds the name to insertedNames once and changes nothing in public mode (D-21)", () => {
    const once = mention(type(internal, "Hi "), OMEGA);
    expect(once.insertedNames).toEqual(["Omega Probe"]);
    const twice = mention(once, OMEGA);
    expect(twice.insertedNames).toEqual(["Omega Probe"]);
    expect(ids(twice)).toEqual(["u-omega"]);

    const publicTyped = type(initialMentionDraft, "@Om");
    const query = queryAt(publicTyped.text, 3);
    expect(mentionDraftReducer(publicTyped, { type: "insert", query, member: OMEGA })).toBe(
      publicTyped,
    );
  });
});

describe("the two-step Backspace (R3-2, V-12)", () => {
  it("the first Backspace after an insertion removes only the trailing space and keeps the id", () => {
    const inserted = mention(type(internal, "Hi "), OMEGA);
    expect(inserted.text).toBe("Hi @Omega Probe ");
    const first = backspace(inserted);
    expect(first.text).toBe("Hi @Omega Probe");
    expect(first.spans).toEqual([{ userId: "u-omega", name: "Omega Probe", start: 3, end: 15 }]);
    expect(ids(first)).toEqual(["u-omega"]);
    expect(first.caret).toBe(15);
  });

  it("the second Backspace removes the whole inserted name and drops its id, leaving no fragment", () => {
    const first = backspace(mention(type(internal, "Hi "), OMEGA));
    const second = backspace(first);
    expect(second.text).toBe("Hi ");
    expect(second.spans).toEqual([]);
    expect(ids(second)).toEqual([]);
    expect(second.caret).toBe(3);
    expect(second.text).not.toContain("Omega");
    expect(second.text).not.toContain("@");
  });
});

describe("punctuation and letters right after an inserted name (R2-1)", () => {
  it("',' '.' and 's' typed after the name keep the span intact; the strip removes the name and keeps the character", () => {
    for (const ch of [",", ".", "s"]) {
      const withChar = type(backspace(mention(type(internal, "Hi "), OMEGA)), ch);
      expect(withChar.text).toBe(`Hi @Omega Probe${ch}`);
      expect(withChar.spans).toHaveLength(1);
      expect(isIntactSpan(withChar.text, withChar.spans[0])).toBe(true);
      expect(ids(withChar)).toEqual(["u-omega"]);
      expect(stripMentionTokens(withChar.text, withChar.spans, withChar.insertedNames)).toBe(
        `Hi ${ch}`,
      );
    }
  });
});

// K172: an intact span is sent only on the mention boundary the renderer and the server use.
describe("outgoingMentionIds follows the boundary rule (K172)", () => {
  it("',' and '.' after the name still send the id; a letter after it or before the '@' does not", () => {
    for (const ch of [",", "."]) {
      const state = type(backspace(mention(type(internal, "Hi "), OMEGA)), ch);
      expect(outgoingMentionIds(state), ch).toEqual(["u-omega"]);
    }
    const letterAfter = type(backspace(mention(type(internal, "Hi "), OMEGA)), "s");
    expect(letterAfter.text).toBe("Hi @Omega Probes");
    expect(ids(letterAfter)).toEqual(["u-omega"]);
    expect(outgoingMentionIds(letterAfter)).toEqual([]);
    const letterBefore = type(mention(type(internal, "Hi "), ZETA, "Ze"), "x", 3);
    expect(letterBefore.text).toBe("Hi x@Zeta ");
    expect(outgoingMentionIds(letterBefore)).toEqual([]);
    // The strip still removes both inserted names (C7).
    for (const state of [letterAfter, letterBefore]) {
      const switched = mentionDraftReducer(state, { type: "setMode", mode: "public" });
      expect(switched.text).not.toContain("Omega");
      expect(switched.text).not.toContain("Zeta");
    }
  });
});

describe("partial deletion inside an inserted name (R2-1)", () => {
  it("a character typed inside the name removes the whole name, keeps the typed character and drops the id", () => {
    const inserted = mention(type(internal, "Hi "), OMEGA);
    const typedInside = type(inserted, "x", 6); // "Hi @Om|ega Probe "
    expect(typedInside.text).toBe("Hi x ");
    expect(typedInside.spans).toEqual([]);
    expect(ids(typedInside)).toEqual([]);
    expect(typedInside.caret).toBe(4);
  });

  it("replacing a selection that covers part of the name removes the whole name and keeps the typed text", () => {
    const inserted = type(mention(type(internal, "Hi "), OMEGA), "ok");
    expect(inserted.text).toBe("Hi @Omega Probe ok");
    // Select "Probe ok" (from inside the name to past it) and type "Z".
    const replaced = replace(inserted, 10, 18, "Z");
    expect(replaced.text).toBe("Hi Z");
    expect(replaced.spans).toEqual([]);
    expect(ids(replaced)).toEqual([]);
  });

  it("deleting a selection that ends exactly at the name's end removes the whole name", () => {
    const inserted = mention(type(internal, "Hi "), OMEGA);
    const deleted = replace(inserted, 10, 15, ""); // "Probe"
    expect(deleted.text).toBe("Hi  ");
    expect(ids(deleted)).toEqual([]);
  });
});

describe("names that share a prefix (R2-1)", () => {
  function both(): MentionDraftState {
    const prime = mention(type(internal, "Hi "), ZETA_PRIME);
    return mention(type(prime, "and "), ZETA, "Ze");
  }

  it("a partial deletion inside 'Zeta Prime' drops only that id", () => {
    const state = both();
    expect(state.text).toBe("Hi @Zeta Prime and @Zeta ");
    expect(ids(state)).toEqual(["u-zeta-prime", "u-zeta"]);
    const cut = backspace(state, 14); // the "e" of "Prime"
    expect(cut.text).toBe("Hi  and @Zeta ");
    expect(ids(cut)).toEqual(["u-zeta"]);
    expect(cut.spans).toEqual([{ userId: "u-zeta", name: "Zeta", start: 8, end: 13 }]);
  });

  it("stripMentionTokens removes both names", () => {
    const state = both();
    expect(stripMentionTokens(state.text, state.spans, state.insertedNames)).toBe("Hi  and  ");
  });

  it("with only 'Zeta' inserted, a typed '@Zetaline' stays", () => {
    const state = type(mention(type(internal, "Hi "), ZETA, "Ze"), "see @Zetaline");
    expect(state.text).toBe("Hi @Zeta see @Zetaline");
    expect(stripMentionTokens(state.text, state.spans, state.insertedNames)).toBe(
      "Hi  see @Zetaline",
    );
  });
});

describe("edits outside a span", () => {
  it("edits before a span shift it; edits after it leave it unchanged", () => {
    const inserted = type(mention(type(internal, "Hi "), OMEGA), "now");
    expect(inserted.spans[0]).toMatchObject({ start: 3, end: 15 });
    const before = type(inserted, "there ", 3);
    expect(before.text).toBe("Hi there @Omega Probe now");
    expect(before.spans).toEqual([{ userId: "u-omega", name: "Omega Probe", start: 9, end: 21 }]);
    const after = backspace(before, before.text.length);
    expect(after.text).toBe("Hi there @Omega Probe no");
    expect(after.spans).toEqual(before.spans);
    const removedBefore = backspace(after, 2); // the "i" of "Hi"
    expect(removedBefore.spans).toEqual([
      { userId: "u-omega", name: "Omega Probe", start: 8, end: 20 },
    ]);
  });

  it("an insertion exactly at a span's start or end does not touch it, even of an equal character", () => {
    const span = { userId: "u-zeta", name: "Zeta", start: 2, end: 7 };
    const atStart = applyTextEdit({ text: "x @Zeta", spans: [span] }, "x @@Zeta", 3);
    expect(atStart.text).toBe("x @@Zeta");
    expect(atStart.spans).toEqual([{ ...span, start: 3, end: 8 }]);
    const atEnd = applyTextEdit({ text: "x @Zeta", spans: [span] }, "x @Zetaa", 8);
    expect(atEnd.text).toBe("x @Zetaa");
    expect(atEnd.spans).toEqual([span]);
  });
});

describe("the strip safety net (R2-1)", () => {
  it("a pasted copy of an inserted name followed by ',' (no span) is removed; a plain @someone stays", () => {
    const inserted = mention(type(internal, "Hi "), OMEGA);
    const gone = backspace(backspace(inserted));
    expect(gone.text).toBe("Hi ");
    const pasted = type(gone, "@Omega Probe, and @someone");
    expect(pasted.spans).toEqual([]);
    expect(ids(pasted)).toEqual([]);
    expect(stripMentionTokens(pasted.text, pasted.spans, pasted.insertedNames)).toBe(
      "Hi , and @someone",
    );
  });

  it("a copy followed by a letter or digit stays, a copy at the end goes", () => {
    expect(stripMentionTokens("@Omega Probes @Omega Probe2", [], ["Omega Probe"])).toBe(
      "@Omega Probes @Omega Probe2",
    );
    expect(stripMentionTokens("ask @Omega Probe", [], ["Omega Probe"])).toBe("ask ");
  });
});

// K173 (review d-WR-3): a copy of an inserted name is removed only on the mention boundary of
// mention-syntax.ts, so an email address, a URL path and a word keep their text.
describe("the strip keeps text that is not a mention (K173)", () => {
  const SALES: MentionMember = { userId: "u-sales", name: "sales" };

  it("keeps an email address, a URL path and in-word copies of an inserted name", () => {
    for (const kept of [
      "Please write to orders@sales-desk.example",
      "orders@sales",
      "see https://host.example/@sales/ now",
      "x@sales.",
      "(@sales)",
      "@sales_team",
      "@salesforce",
      "@sales\u0301",
    ]) {
      expect(stripMentionTokens(kept, [], ["sales"]), kept).toBe(kept);
    }
  });

  it("still removes a copy on the boundary, whatever punctuation follows", () => {
    expect(stripMentionTokens("ask @sales.", [], ["sales"])).toBe("ask .");
    expect(stripMentionTokens("@sales, hi", [], ["sales"])).toBe(", hi");
    expect(stripMentionTokens("hi\n@sales-desk", [], ["sales"])).toBe("hi\n-desk");
    expect(stripMentionTokens("ask @sales", [], ["sales"])).toBe("ask ");
  });

  it("through the reducer: the switch removes the inserted name and keeps orders@sales-desk.example", () => {
    let state = mention(type(internal, "Hi "), SALES, "sa");
    expect(state.text).toBe("Hi @sales ");
    state = type(state, "please write to orders@sales-desk.example");
    const switched = mentionDraftReducer(state, { type: "setMode", mode: "public" });
    expect(switched.mode).toBe("public");
    expect(switched.switchNote).toBe(true);
    expect(switched.text).toBe("Hi  please write to orders@sales-desk.example");
    expect(outgoingMentionIds(switched)).toEqual([]);
  });
});

// K174 (review d-WR-4): a member name is inserted escaped for Markdown, so the parsed text holds
// the name verbatim and the renderer wraps it; nothing in the name becomes markup.
describe("inserted names are escaped for Markdown (K174)", () => {
  const SPAN_OPEN = '<span class="font-semibold text-primary-emphasis">';
  const htmlText = (name: string) => name.replaceAll("&", "&#x26;").replaceAll("<", "&#x3C;");
  const NAMES = [
    "*Star*",
    "**Bold** Bea",
    "_Under_",
    "snake_case_sam",
    "Zeta [x](https://example.invalid)",
    "Zeta [docs](https://example.invalid) more",
    "`Code` Cy",
    "~Tilde~ Ty",
    "<b>Bo</b>",
    "Amp &amp; Al",
    "Back\\slash",
    "www.example.com",
    "Pipe | Pia",
  ];

  it("insertMention writes the escaped token, the span stays intact and its id is sent", () => {
    for (const name of NAMES) {
      const member: MentionMember = { userId: `u-${name}`, name };
      const state = mention(type(internal, "Hi "), member, "");
      expect(state.text, name).not.toBe(`Hi @${name} `);
      expect(state.text.startsWith("Hi @"), name).toBe(true);
      expect(state.text.endsWith(" "), name).toBe(true);
      expect(state.spans, name).toHaveLength(1);
      expect(isIntactSpan(state.text, state.spans[0]), name).toBe(true);
      expect(outgoingMentionIds(state), name).toEqual([member.userId]);
    }
  });

  it("the renderer wraps the inserted name as one span, with no link, emphasis, code or tag from the name", () => {
    for (const name of NAMES) {
      const member: MentionMember = { userId: `u-${name}`, name };
      const state = type(mention(type(internal, "Hi "), member, ""), "please check");
      const html = renderMarkdown(state.text, { mentionNames: [name] });
      expect(html.match(/<span\b/g), name).toHaveLength(1);
      expect(html, name).toContain(`${SPAN_OPEN}@${htmlText(name)}</span> please check`);
      for (const tag of ["<a", "<em", "<strong", "<code", "<del", "<b>", "<table"]) {
        expect(html, `${name} ${tag}`).not.toContain(tag);
      }
    }
  });

  it("an unescaped copy of such a name is not a mention, and the strip removes escaped and unescaped copies", () => {
    expect(renderMarkdown("Hi @*Star* ok", { mentionNames: ["*Star*"] })).not.toContain("<span");
    const member: MentionMember = { userId: "u-star", name: "*Star*" };
    const state = mention(type(internal, "Hi "), member, "");
    const typed = type(state, "and @*Star*, and @\\*Star\\*.");
    expect(typed.text).toBe("Hi @\\*Star\\* and @*Star*, and @\\*Star\\*.");
    const switched = mentionDraftReducer(typed, { type: "setMode", mode: "public" });
    expect(switched.text).not.toContain("Star");
  });
});

// Review d-IN-3: the composer never sends more ids than the server accepts (MAX_MENTIONS, V-12).
describe("the mention cap in the composer (d-IN-3)", () => {
  function fiftyMentions(): MentionDraftState {
    let state = internal;
    for (let i = 0; i < 50; i++) {
      const member: MentionMember = {
        userId: `u-${i}`,
        name: `Member ${String(i).padStart(2, "0")}`,
      };
      state = mention(type(state, i === 0 ? "Heads up " : ", "), member, "Me");
    }
    return state;
  }

  it("a 51st distinct member is not inserted; the text and the 50 ids stay", () => {
    const full = fiftyMentions();
    expect(outgoingMentionIds(full)).toHaveLength(50);
    const typed = type(full, " and @Om");
    const query = queryAt(typed.text, typed.caret ?? 0, typed.spans);
    const refused = mentionDraftReducer(typed, { type: "insert", query, member: OMEGA });
    expect(refused).toBe(typed);
    expect(refused.text.endsWith(" and @Om")).toBe(true);
    expect(outgoingMentionIds(refused)).toHaveLength(50);
    expect(outgoingMentionIds(refused)).not.toContain("u-omega");
  });

  it("an already mentioned member can still be inserted at the cap, and mentionCapReached says when to stop offering", () => {
    const full = fiftyMentions();
    expect(mentionCapReached(full)).toBe(true);
    const again = mention(type(full, " "), { userId: "u-7", name: "Member 07" }, "Me");
    expect(again.text.endsWith("@Member 07 ")).toBe(true);
    expect(outgoingMentionIds(again)).toHaveLength(50);
    expect(mentionCapReached(mention(type(internal, "Hi "), OMEGA))).toBe(false);
    // Public mode sends no id, so it is never at the cap.
    expect(mentionCapReached({ ...full, mode: "public" })).toBe(false);
  });
});

// Review d-IN-7 with run decision K180 (C7 at the public send). The guarantee, precisely: an
// inserted mention span never reaches a public send (the switch strips every span and the public
// send carries no mention id). On top of that the guard holds the FIRST public Send whenever the
// body contains "@" followed by the name of any member mentioned in this draft, wherever it stands
// (no boundary rule: "(@Name)", "**@Name**" and "x@Name" count), and shows the switch note. It never
// edits the text, so an address or a word the agent wrote is never corrupted. The second Send goes
// through as written: the agent decides (human in the loop).
describe("the public send guard (d-IN-7, K180, C7)", () => {
  const switchedAfterZeta = () =>
    mentionDraftReducer(mention(type(internal, "Hi "), ZETA, "Ze"), {
      type: "setMode",
      mode: "public",
    });

  /** The composer's Send: held when the guard changes the state, else sent as the text stands. */
  function send(state: MentionDraftState): { held: boolean; state: MentionDraftState } {
    const next = mentionDraftReducer(state, { type: "guardPublicSend" });
    return { held: next !== state, state: next };
  }

  it.each([
    ["(@Zeta)", "call (@Zeta) tomorrow"],
    ["**@Zeta**", "call **@Zeta** tomorrow"],
    ["@Zeta,", "ask @Zeta, or @someone"],
    ["x@Zeta", "write to orders@Zeta.example"],
    ["/@Zeta/", "see /@Zeta/ there"],
    ["@zeta (case)", "ask @zeta later"],
  ])("%s: the first Send is held with the hold note and the text unchanged; the second goes as written", (_label, pasted) => {
    const switched = switchedAfterZeta();
    expect(switched.text).toBe("Hi  ");
    const draft = { ...type(switched, pasted), switchNote: false };
    const first = send(draft);
    expect(first.held).toBe(true);
    expect(first.state.text).toBe(draft.text);
    // K183: the hold shows its own copy, never "The mentioned names were removed".
    expect(first.state.publicSendHeld).toBe(true);
    expect(first.state.switchNote).toBe(false);
    expect(composerNote(first.state)).toBe(MENTION_HOLD_NOTE);
    expect(first.state.mode).toBe("public");
    expect(first.state.spans).toEqual([]);
    const second = send(first.state);
    expect(second.held).toBe(false);
    expect(second.state.text).toBe(`Hi  ${pasted}`);
  });

  it("a name escaped for Markdown (K174) or pasted unescaped is held alike", () => {
    const ana: MentionMember = { userId: "u-ana", name: "Ana_Lee" };
    const switched = run(mention(type(internal, "Hi "), ana, "An"), {
      type: "setMode",
      mode: "public",
    });
    expect(switched.text).not.toContain("Ana");
    for (const pasted of ["(@Ana\\_Lee)", "**@Ana_Lee**"]) {
      const draft = type(switched, pasted);
      expect(send(draft).held, pasted).toBe(true);
      expect(send(draft).state.text).toBe(draft.text);
    }
  });

  it("a body without '@' plus a mentioned name is sent at once; the name alone or another @name does not hold", () => {
    const switched = switchedAfterZeta();
    for (const text of ["Zeta will call you", "ask @someone", "@Zet only", "mail zeta@ later"]) {
      const draft = type(switched, text);
      expect(send(draft).held, text).toBe(false);
    }
  });

  it("does nothing in internal mode, without inserted names, or after the draft was sent; a switch re-arms it", () => {
    const note = type(mention(type(internal, "Hi "), ZETA, "Ze"), "and (@Zeta)");
    expect(send(note).held).toBe(false);
    const plain = type({ ...initialMentionDraft }, "(@Zeta) typed by hand");
    expect(send(plain).held).toBe(false);

    const held = send(type(switchedAfterZeta(), "(@Zeta)")).state;
    const sent = mentionDraftReducer(held, { type: "sent" });
    expect(send(type(sent, "(@Zeta) again")).held).toBe(false);

    // Back to internal and to public again: a new switch is a new review.
    const again = run(
      held,
      { type: "setMode", mode: "internal" },
      { type: "setMode", mode: "public" },
    );
    // The switch strip keeps "(@Zeta)" (off the boundary, K173); the guard holds it again.
    expect(again.text).toBe(held.text);
    const reheld = send(type(again, " (@Zeta)"));
    expect(reheld.held).toBe(true);
  });
});

// Run decision K183 (Codex diff round 2): the hold has its own copy, which asks the agent to
// review the reply because it still names a mentioned member, and says why an address can match.
// "The mentioned names were removed from this reply." shows only after a switch really removed
// something. Any edit of the body after a hold re-arms the guard, so a name added after the hold
// is held again before it can go out.
describe("the hold copy and the re-armed guard (K183)", () => {
  const switchedAfterZeta = () =>
    mentionDraftReducer(mention(type(internal, "Hi "), ZETA, "Ze"), {
      type: "setMode",
      mode: "public",
    });
  const guard = (state: MentionDraftState) =>
    mentionDraftReducer(state, { type: "guardPublicSend" });

  it("the strip sentence shows only after a real strip; a switch that removed nothing shows no note", () => {
    const switched = switchedAfterZeta();
    expect(composerNote(switched)).toBe(MENTION_SWITCH_NOTE);
    const nothing = run(type(internal, "plain note"), { type: "setMode", mode: "public" });
    expect(nothing.switchNote).toBe(false);
    expect(composerNote(nothing)).toBeNull();
    expect(composerNote(initialMentionDraft)).toBeNull();
  });

  it("a hold replaces the strip sentence with the review copy, even right after a real strip", () => {
    const held = guard(type(switchedAfterZeta(), "(@Zeta)"));
    expect(held.publicSendHeld).toBe(true);
    const note = composerNote(held);
    expect(note).toBe(MENTION_HOLD_NOTE);
    expect(note).not.toContain("removed");
    expect(MENTION_HOLD_NOTE).toContain("still contains");
    expect(MENTION_HOLD_NOTE).toContain("email address");
    expect(MENTION_SWITCH_NOTE).toBe(
      "Mentions only work in internal notes. The mentioned names were removed from this reply.",
    );
  });

  it("an edit after a hold re-arms the guard: a name added after the hold is held again", () => {
    const held = guard(type(switchedAfterZeta(), "(@Zeta)"));
    const edited = type(held, " and orders@zeta.example");
    expect(edited.publicSendHeld).toBe(false);
    expect(composerNote(edited)).toBeNull();
    const again = guard(edited);
    expect(again).not.toBe(edited);
    expect(again.publicSendHeld).toBe(true);
    expect(again.text).toBe(edited.text);
    // Held once more, the next Send goes as written.
    expect(guard(again)).toBe(again);
  });

  it("an edit that removes every mentioned name re-arms and then sends at once", () => {
    const held = guard(type(switchedAfterZeta(), "(@Zeta)"));
    const cleaned = mentionDraftReducer(held, { type: "edit", text: "Hi  (soon)", caret: 10 });
    expect(cleaned.publicSendHeld).toBe(false);
    expect(guard(cleaned)).toBe(cleaned);
  });

  it("an edit that leaves the text as it is keeps the hold, so the next Send goes as written", () => {
    const held = guard(type(switchedAfterZeta(), "(@Zeta)"));
    const same = mentionDraftReducer(held, { type: "edit", text: held.text, caret: 0 });
    expect(same).toBe(held);
    expect(guard(same)).toBe(same);
  });
});

describe("mentionDraftReducer", () => {
  it("setMode internal to public returns the stripped text, empty spans and the switch note on", () => {
    const state = type(backspace(mention(type(internal, "Hi "), ZETA_PRIME)), ", check");
    const switched = mentionDraftReducer(state, { type: "setMode", mode: "public" });
    expect(switched.mode).toBe("public");
    expect(switched.text).toBe("Hi , check");
    expect(switched.spans).toEqual([]);
    expect(switched.switchNote).toBe(true);
    expect(reconcileMentionIds(switched.text, switched.spans)).toEqual([]);
  });

  it("setMode without a mention shows no note; public to internal clears the note; the same mode is a no-op", () => {
    const plain = run(type(internal, "plain @someone"), { type: "setMode", mode: "public" });
    expect(plain.text).toBe("plain @someone");
    expect(plain.switchNote).toBe(false);

    const switched = run(mention(type(internal, "Hi "), OMEGA), {
      type: "setMode",
      mode: "public",
    });
    expect(switched.switchNote).toBe(true);
    expect(mentionDraftReducer(switched, { type: "setMode", mode: "public" })).toBe(switched);
    const back = mentionDraftReducer(switched, { type: "setMode", mode: "internal" });
    expect(back.mode).toBe("internal");
    expect(back.switchNote).toBe(false);
    expect(back.text).toBe(switched.text);
  });

  it("loadDraft sets the draft text, mode public, empty spans and empty insertedNames", () => {
    const state = mention(type(internal, "Hi "), OMEGA);
    const loaded = mentionDraftReducer(state, { type: "loadDraft", text: "Draft body" });
    expect(loaded).toMatchObject({
      text: "Draft body",
      mode: "public",
      spans: [],
      insertedNames: [],
      fromDraft: true,
      switchNote: false,
    });
  });

  it("sent clears text, spans, insertedNames and the note and keeps the mode", () => {
    const switched = run(mention(type(internal, "Hi "), OMEGA), {
      type: "setMode",
      mode: "public",
    });
    const sent = mentionDraftReducer(switched, { type: "sent" });
    expect(sent).toMatchObject({
      text: "",
      spans: [],
      insertedNames: [],
      switchNote: false,
      fromDraft: false,
      mode: "public",
    });
  });

  it("outgoingMentionIds sends the ids only in internal mode, never from a public draft (D-21)", () => {
    const state = mention(type(internal, "Hi "), OMEGA);
    expect(outgoingMentionIds(state)).toEqual(["u-omega"]);
    // Even a public state that still held a span would send nothing.
    expect(outgoingMentionIds({ ...state, mode: "public" })).toEqual([]);
    const switched = mentionDraftReducer(state, { type: "setMode", mode: "public" });
    expect(outgoingMentionIds(switched)).toEqual([]);
  });

  it("reconcileMentionIds sends each intact id once, in text order", () => {
    const state = mention(type(mention(type(internal, "a "), ZETA, "Ze"), "b "), OMEGA);
    const again = mention(type(state, "c "), ZETA, "Ze");
    expect(again.text).toBe("a @Zeta b @Omega Probe c @Zeta ");
    expect(ids(again)).toEqual(["u-zeta", "u-omega"]);
  });
});

describe("options", () => {
  it("an empty display name becomes the email local part, and the option shows the email as its name line", () => {
    expect(mentionDisplayName("", "ana.lee@example.test")).toBe("ana.lee");
    expect(mentionDisplayName("  ", "ana.lee@example.test")).toBe("ana.lee");
    expect(mentionDisplayName("Ana Lee", "ana.lee@example.test")).toBe("Ana Lee");
    expect(mentionOptionLabel({ id: "u", name: "ana.lee", email: "ana.lee@example.test" })).toBe(
      "ana.lee@example.test",
    );
    expect(mentionOptionLabel({ id: "u", name: "Ana Lee", email: "ana.lee@example.test" })).toBe(
      "Ana Lee",
    );
  });

  it("filters by name or email, names starting with the query first, and offers a spaced query only while it matches", () => {
    const members = [
      { id: "1", name: "Bram Omega", email: "bram@example.test" },
      { id: "2", name: "Omega Probe", email: "probe@example.test" },
      { id: "3", name: "Zed", email: "zed.omega@example.test" },
      { id: "4", name: "Kai", email: "kai@example.test" },
    ];
    expect(filterMentionCandidates(members, "omega").map((m) => m.id)).toEqual(["2", "1", "3"]);
    expect(filterMentionCandidates(members, "").map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
    expect(filterMentionCandidates(members, "nobody")).toEqual([]);

    expect(shouldOfferMentions(null, 3)).toBe(false);
    expect(shouldOfferMentions({ start: 0, end: 7, query: "nobody" }, 0)).toBe(true);
    expect(shouldOfferMentions({ start: 0, end: 10, query: "someone p" }, 0)).toBe(false);
    expect(shouldOfferMentions({ start: 0, end: 8, query: "Omega P" }, 1)).toBe(true);
  });
});
