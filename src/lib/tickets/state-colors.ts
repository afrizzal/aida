// The state colour palette (Phase 12.1, D-14; UI-SPEC Color and Surface 2). The one place a
// colour key becomes Tailwind classes: every chip and dot takes its classes from here. Each class
// string is written out in full so Tailwind sees the literal (never built from a template).
// Pure and client-safe: server and client components import it. Relative imports only.

/** The eleven colour keys in UI-SPEC order; `TicketState.colorToken` stores one of them. */
export const STATE_COLOR_KEYS = [
  "indigo-filled",
  "indigo",
  "blue",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
  "gray",
] as const;

export type StateColorKey = (typeof STATE_COLOR_KEYS)[number];

export type StateColorClasses = {
  /** UI-SPEC Copywriting "Color legend / option names". */
  displayName: string;
  /** Badge classes: tint, text and border. */
  chip: string;
  /** StateDot fill. */
  dot: string;
};

export const STATE_COLORS: Record<StateColorKey, StateColorClasses> = {
  "indigo-filled": {
    displayName: "Indigo, filled",
    chip: "bg-primary text-primary-foreground border border-transparent",
    dot: "bg-primary",
  },
  indigo: {
    displayName: "Indigo",
    chip: "bg-state-indigo/10 text-state-indigo border border-state-indigo/20",
    dot: "bg-state-indigo",
  },
  blue: {
    displayName: "Blue",
    chip: "bg-state-blue/10 text-state-blue border border-state-blue/20",
    dot: "bg-state-blue",
  },
  teal: {
    displayName: "Teal",
    chip: "bg-state-teal/10 text-state-teal border border-state-teal/20",
    dot: "bg-state-teal",
  },
  green: {
    displayName: "Green",
    chip: "bg-state-green/10 text-state-green border border-state-green/20",
    dot: "bg-state-green",
  },
  amber: {
    displayName: "Amber",
    chip: "bg-state-amber/10 text-state-amber border border-state-amber/20",
    dot: "bg-state-amber",
  },
  orange: {
    displayName: "Orange",
    chip: "bg-state-orange/10 text-state-orange border border-state-orange/20",
    dot: "bg-state-orange",
  },
  red: {
    displayName: "Red",
    chip: "bg-state-red/10 text-state-red border border-state-red/20",
    dot: "bg-state-red",
  },
  pink: {
    displayName: "Pink",
    chip: "bg-state-pink/10 text-state-pink border border-state-pink/20",
    dot: "bg-state-pink",
  },
  purple: {
    displayName: "Purple",
    chip: "bg-state-purple/10 text-state-purple border border-state-purple/20",
    dot: "bg-state-purple",
  },
  gray: {
    displayName: "Gray",
    chip: "bg-state-gray/10 text-state-gray border border-state-gray/20",
    dot: "bg-state-gray",
  },
};

/** True when the value is one of the eleven keys (server actions validate colorToken with it). */
export function isStateColorKey(value: unknown): value is StateColorKey {
  return typeof value === "string" && (STATE_COLOR_KEYS as readonly string[]).includes(value);
}

/** The classes of a colour key; a key the client does not know renders gray (UI-SPEC Surface 2). */
export function stateColorClasses(key: string): StateColorClasses {
  return isStateColorKey(key) ? STATE_COLORS[key] : STATE_COLORS.gray;
}

/**
 * The colour of each group: the Add status dialog default and the public group chip colours
 * (UI-SPEC Color "Default colour in the Add status dialog", Assumption 13).
 */
export const DEFAULT_GROUP_COLOR = {
  OPEN: "indigo",
  PENDING: "amber",
  RESOLVED: "green",
  CLOSED: "gray",
} as const satisfies Record<"OPEN" | "PENDING" | "RESOLVED" | "CLOSED", StateColorKey>;

/** The public status page group chip colours (D-13); the same map as the Add dialog default. */
export const PUBLIC_GROUP_COLOR = DEFAULT_GROUP_COLOR;
