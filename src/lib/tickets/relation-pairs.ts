// Relation pairs and labels (Phase 12, D-03 and D-04). Pure and client-safe: the relations
// panel, the link dialog and the relations service all import it. Relative imports only.
//
// A relation is stored once per unordered pair (TicketRelation_pair_key). CHILD_OF is
// directional: `from` is the child, `to` the parent. DUPLICATE_OF: `from` duplicates `to`.

export const RELATION_TYPES = ["DUPLICATE_OF", "RELATED_TO", "CHILD_OF"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** Which end of a stored relation the viewing ticket is. */
export type RelationSide = "from" | "to";

export type RelationLabel = "Duplicate of" | "Has duplicate" | "Child of" | "Parent of" | "Related to";

/** The label a ticket shows for a relation, from its own side (UI-SPEC "Relation labels"). */
export function relationLabel(type: RelationType, side: RelationSide): RelationLabel {
  switch (type) {
    case "DUPLICATE_OF":
      return side === "from" ? "Duplicate of" : "Has duplicate";
    case "CHILD_OF":
      return side === "from" ? "Child of" : "Parent of";
    case "RELATED_TO":
      return "Related to";
  }
}

/** "from" when the viewing ticket is the relation's fromTicketId, otherwise "to". */
export function relationSideFor(
  relation: { fromTicketId: string; toTicketId: string },
  viewingTicketId: string,
): RelationSide {
  return relation.fromTicketId === viewingTicketId ? "from" : "to";
}

/** this-to-other: the viewing ticket is `from`; other-to-this: the other ticket is `from`. */
export type LinkDirection = "this-to-other" | "other-to-this";

export interface LinkChoice {
  label: string;
  type: RelationType;
  direction: LinkDirection;
}

/** The five link options of the Link a ticket dialog, from this ticket's side (UI-SPEC 2b). */
export const LINK_CHOICES: readonly LinkChoice[] = [
  { label: "is a duplicate of", type: "DUPLICATE_OF", direction: "this-to-other" },
  { label: "has a duplicate", type: "DUPLICATE_OF", direction: "other-to-this" },
  { label: "is related to", type: "RELATED_TO", direction: "this-to-other" },
  { label: "is a child of", type: "CHILD_OF", direction: "this-to-other" },
  { label: "is the parent of", type: "CHILD_OF", direction: "other-to-this" },
];

/** Default "is related to" (UI-SPEC Assumption 2): the only type with no direction. */
export const DEFAULT_LINK_CHOICE: LinkChoice = LINK_CHOICES[2];

/** Chip group order (UI-SPEC Assumption 4); inside a group, by ticket number ascending. */
export const RELATION_LABEL_ORDER: readonly RelationLabel[] = [
  "Parent of",
  "Child of",
  "Duplicate of",
  "Has duplicate",
  "Related to",
];

/** Returns a sorted copy of the chips; the input is not changed. */
export function sortRelationChips<T extends { label: RelationLabel; number: number }>(
  chips: readonly T[],
): T[] {
  return [...chips].sort(
    (a, b) =>
      RELATION_LABEL_ORDER.indexOf(a.label) - RELATION_LABEL_ORDER.indexOf(b.label) ||
      a.number - b.number,
  );
}

/** The canonical (LEAST, GREATEST) tuple of a pair, matching TicketRelation_pair_key. */
export function orderedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}
