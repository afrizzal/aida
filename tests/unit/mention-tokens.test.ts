// Phase 10, plan 10-12 Task 1 (AIDA-45, D-20, D-21; review rows C7, R2-1, R3-2, V-12): the pure
// mention model of the composer. Every case drives the same functions the composer calls; the
// text edits carry the caret the textarea reports after the change, as the composer's change
// handler does.
import { describe, expect, it } from "vitest";
import {
  applyTextEdit,
  filterMentionCandidates,
  findMentionQuery,
  initialMentionDraft,
  insertMention,
  isIntactSpan,
  type MentionDraftAction,
  type MentionDraftState,
  type MentionMember,
  type MentionQuery,
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
