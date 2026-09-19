import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINK_CHOICE,
  LINK_CHOICES,
  orderedPair,
  RELATION_LABEL_ORDER,
  RELATION_TYPES,
  relationLabel,
  relationSideFor,
  sortRelationChips,
} from "../../src/lib/tickets/relation-pairs";
import {
  isMessageVisibleForToken,
  statusMessageWhere,
} from "../../src/lib/tickets/status-visibility";

describe("relationLabel", () => {
  it("labels DUPLICATE_OF from each side", () => {
    expect(relationLabel("DUPLICATE_OF", "from")).toBe("Duplicate of");
    expect(relationLabel("DUPLICATE_OF", "to")).toBe("Has duplicate");
  });
  it("labels CHILD_OF from each side", () => {
    expect(relationLabel("CHILD_OF", "from")).toBe("Child of");
    expect(relationLabel("CHILD_OF", "to")).toBe("Parent of");
  });
  it("labels RELATED_TO the same on both sides", () => {
    expect(relationLabel("RELATED_TO", "from")).toBe("Related to");
    expect(relationLabel("RELATED_TO", "to")).toBe("Related to");
  });
  it("lists the three relation types", () => {
    expect([...RELATION_TYPES]).toEqual(["DUPLICATE_OF", "RELATED_TO", "CHILD_OF"]);
  });
  it("relationSideFor picks the viewing ticket's side", () => {
    const rel = { fromTicketId: "a", toTicketId: "b" };
    expect(relationSideFor(rel, "a")).toBe("from");
    expect(relationSideFor(rel, "b")).toBe("to");
  });
});

describe("LINK_CHOICES", () => {
  const byLabel = (label: string) => LINK_CHOICES.find((c) => c.label === label);
  it("offers the five UI-SPEC options with type and direction", () => {
    expect(LINK_CHOICES.map((c) => c.label)).toEqual([
      "is a duplicate of",
      "has a duplicate",
      "is related to",
      "is a child of",
      "is the parent of",
    ]);
    expect(byLabel("is a duplicate of")).toMatchObject({
      type: "DUPLICATE_OF",
      direction: "this-to-other",
    });
    expect(byLabel("has a duplicate")).toMatchObject({
      type: "DUPLICATE_OF",
      direction: "other-to-this",
    });
    expect(byLabel("is related to")).toMatchObject({
      type: "RELATED_TO",
      direction: "this-to-other",
    });
    expect(byLabel("is a child of")).toMatchObject({
      type: "CHILD_OF",
      direction: "this-to-other",
    });
    expect(byLabel("is the parent of")).toMatchObject({
      type: "CHILD_OF",
      direction: "other-to-this",
    });
  });
  it("defaults to is related to", () => {
    expect(DEFAULT_LINK_CHOICE.label).toBe("is related to");
    expect(DEFAULT_LINK_CHOICE.type).toBe("RELATED_TO");
  });
  it("each choice's label from this side matches relationLabel", () => {
    const side = { "this-to-other": "from", "other-to-this": "to" } as const;
    const expected: Record<string, string> = {
      "is a duplicate of": "Duplicate of",
      "has a duplicate": "Has duplicate",
      "is related to": "Related to",
      "is a child of": "Child of",
      "is the parent of": "Parent of",
    };
    for (const c of LINK_CHOICES) {
      expect(relationLabel(c.type, side[c.direction])).toBe(expected[c.label]);
    }
  });
});

describe("sortRelationChips and orderedPair", () => {
  it("orders by label group, then ticket number ascending", () => {
    const chips = [
      { label: "Related to", number: 3 },
      { label: "Has duplicate", number: 9 },
      { label: "Child of", number: 7 },
      { label: "Parent of", number: 12 },
      { label: "Duplicate of", number: 2 },
      { label: "Parent of", number: 4 },
      { label: "Related to", number: 1 },
    ] as const;
    const sorted = sortRelationChips([...chips]);
    expect(sorted.map((c) => `${c.label}#${c.number}`)).toEqual([
      "Parent of#4",
      "Parent of#12",
      "Child of#7",
      "Duplicate of#2",
      "Has duplicate#9",
      "Related to#1",
      "Related to#3",
    ]);
    expect([...RELATION_LABEL_ORDER]).toEqual([
      "Parent of",
      "Child of",
      "Duplicate of",
      "Has duplicate",
      "Related to",
    ]);
  });
  it("does not mutate its input", () => {
    const input = [
      { label: "Related to" as const, number: 2 },
      { label: "Parent of" as const, number: 1 },
    ];
    sortRelationChips(input);
    expect(input[0].label).toBe("Related to");
  });
  it("orderedPair returns the same tuple for (a, b) and (b, a)", () => {
    expect(orderedPair("t1", "t2")).toEqual(["t1", "t2"]);
    expect(orderedPair("t2", "t1")).toEqual(["t1", "t2"]);
    expect(orderedPair("x", "x")).toEqual(["x", "x"]);
  });
});

describe("status-token provenance (D-09 amended, review C1)", () => {
  const K = 100n;
  const S = { id: "S", mergedIntoTicketId: "T", mergeMessageSeq: K };
  const T = { id: "T", mergedIntoTicketId: null, mergeMessageSeq: null };
  const U = { id: "U", mergedIntoTicketId: null, mergeMessageSeq: null };
  const msg = (
    ticketId: string,
    visibility: "PUBLIC" | "INTERNAL",
    mergedFromTicketId: string | null,
    seq: bigint,
  ) => ({ ticketId, visibility, mergedFromTicketId, seq });

  it("source token sees moved PUBLIC messages and post-marker target PUBLIC messages only", () => {
    expect(isMessageVisibleForToken(S, msg("T", "PUBLIC", "S", 10n))).toBe(true);
    expect(isMessageVisibleForToken(S, msg("T", "PUBLIC", null, K + 1n))).toBe(true);
    expect(isMessageVisibleForToken(S, msg("T", "PUBLIC", null, K - 1n))).toBe(false);
    expect(isMessageVisibleForToken(S, msg("T", "PUBLIC", null, K))).toBe(false);
    expect(isMessageVisibleForToken(S, msg("T", "PUBLIC", "C", K + 5n))).toBe(false);
    expect(isMessageVisibleForToken(S, msg("T", "INTERNAL", "S", 10n))).toBe(false);
    expect(isMessageVisibleForToken(S, msg("T", "INTERNAL", null, K + 1n))).toBe(false);
    expect(isMessageVisibleForToken(S, msg("S", "PUBLIC", null, 5n))).toBe(false);
  });

  it("target token sees its own PUBLIC messages on both sides of the marker and nothing moved", () => {
    expect(isMessageVisibleForToken(T, msg("T", "PUBLIC", null, K - 1n))).toBe(true);
    expect(isMessageVisibleForToken(T, msg("T", "PUBLIC", null, K + 1n))).toBe(true);
    expect(isMessageVisibleForToken(T, msg("T", "PUBLIC", "S", 10n))).toBe(false);
    expect(isMessageVisibleForToken(T, msg("T", "INTERNAL", null, K + 1n))).toBe(false);
  });

  it("an unmerged ticket's token sees only its own PUBLIC messages", () => {
    expect(isMessageVisibleForToken(U, msg("U", "PUBLIC", null, 1n))).toBe(true);
    expect(isMessageVisibleForToken(U, msg("U", "INTERNAL", null, 1n))).toBe(false);
    expect(isMessageVisibleForToken(U, msg("T", "PUBLIC", null, 1n))).toBe(false);
    expect(isMessageVisibleForToken(U, msg("X", "PUBLIC", "U", 1n))).toBe(false);
  });

  it("ignores time: the decision takes no timestamp, only seq against the marker", () => {
    // A pre-marker target row whose createdAt equals or passes mergedAt stays hidden; a
    // post-marker reply whose transaction began before the merge is shown. Neither row carries
    // a time the helper could read, so these follow from the seq rule alone.
    const preMarkerLateClock = { ...msg("T", "PUBLIC", null, K - 1n), createdAt: new Date(9e12) };
    const postMarkerEarlyClock = { ...msg("T", "PUBLIC", null, K + 1n), createdAt: new Date(0) };
    expect(isMessageVisibleForToken(S, preMarkerLateClock)).toBe(false);
    expect(isMessageVisibleForToken(S, postMarkerEarlyClock)).toBe(true);
    expect(isMessageVisibleForToken(T, preMarkerLateClock)).toBe(true);
    expect(isMessageVisibleForToken(T, postMarkerEarlyClock)).toBe(true);
  });

  it("statusMessageWhere builds the source predicate on the target with the marker", () => {
    expect(statusMessageWhere(S)).toEqual({
      ticketId: "T",
      visibility: "PUBLIC",
      OR: [{ mergedFromTicketId: "S" }, { mergedFromTicketId: null, seq: { gt: K } }],
    });
  });

  it("statusMessageWhere builds the plain predicate for an unmerged ticket", () => {
    expect(statusMessageWhere(T)).toEqual({
      ticketId: "T",
      visibility: "PUBLIC",
      mergedFromTicketId: null,
    });
  });

  it("refuses a half-merged ticket instead of guessing", () => {
    const broken = { id: "S", mergedIntoTicketId: "T", mergeMessageSeq: null };
    expect(() => statusMessageWhere(broken)).toThrow();
    expect(() => isMessageVisibleForToken(broken, msg("T", "PUBLIC", "S", 1n))).toThrow();
  });
});
