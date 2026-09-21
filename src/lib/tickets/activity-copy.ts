// Copy for the ticket activity feed's event rows (Phase 12, D-18, UI-SPEC Surface 6 and the
// Copywriting "Feed events" rows). Pure and agent-only: no (public) route imports it. Every
// TicketAuditAction value has its own row in ACTIVITY_COPY (checked by a unit test over the
// generated enum); an action without a row, for example one added later, uses the "other" row.
// Audit rows hold ids and enum values only (D-21), so no event text quotes ticket content.
// Relative imports only.
import type { TicketAuditAction } from "../../generated/prisma/enums";
import {
  RELATION_TYPES,
  type RelationType,
  relationLabel,
  relationSideFor,
} from "./relation-pairs";

export const ACTOR_SYSTEM = "The system";
export const ACTOR_FORMER_MEMBER = "A former member";
export const BULK_SUFFIX = "(bulk change)";
export const MISSING_TICKET = "a ticket that is no longer available";
export const MISSING_TAG = "a deleted tag";
export const FEED_EMPTY = "No messages or activity yet.";

export type ActivityIconName =
  | "CircleDot"
  | "UserRound"
  | "Flag"
  | "Tag"
  | "Link2"
  | "Unlink2"
  | "Merge"
  | "AlarmClock"
  | "Sunrise"
  | "History";

/** Text, a ticket reference (rendered as a link) or a time (rendered by LocalDateTime). */
export type ActivityPart =
  | { type: "text"; text: string }
  | { type: "ticket"; id: string; number: number }
  | { type: "time"; iso: string };

export interface ActivityEventInput {
  action: string;
  actorType: "USER" | "SYSTEM";
  actorUserId: string | null;
  batchId: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/** Names resolved inside the ticket's organization; a missing id renders as its marker. */
export interface ActivityContext {
  /** The ticket whose page shows the feed; relation labels are from its side (D-04). */
  ticketId: string;
  tickets: Record<string, { id: string; number: number }>;
  tags: Record<string, string>;
  members: Record<string, string>;
}

export interface DescribedEvent {
  icon: ActivityIconName;
  parts: ActivityPart[];
}

type Describe = (
  event: ActivityEventInput,
  context: ActivityContext,
  actor: string,
) => ActivityPart[];

interface CopyRow {
  icon: ActivityIconName;
  describe: Describe;
}

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  OPEN: "Open",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

function text(value: string): ActivityPart {
  return { type: "text", text: value };
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function label(map: Record<string, string>, value: unknown): string {
  const key = str(value);
  return key === null ? "none" : (map[key] ?? key);
}

function ticketRef(context: ActivityContext, id: unknown): ActivityPart {
  const key = str(id);
  const ticket = key === null ? undefined : context.tickets[key];
  return ticket ? { type: "ticket", id: ticket.id, number: ticket.number } : text(MISSING_TICKET);
}

function tagName(context: ActivityContext, id: unknown): string {
  const key = str(id);
  return (key !== null && context.tags[key]) || MISSING_TAG;
}

/** A user named only when a current member of the organization (D-18). */
function memberName(context: ActivityContext, id: string | null): string | null {
  return id !== null && Object.hasOwn(context.members, id) ? context.members[id] : null;
}

function relationParts(
  verb: "added" | "removed",
  snapshot: Record<string, unknown>,
  context: ActivityContext,
  actor: string,
): ActivityPart[] {
  const type = str(snapshot.type);
  const from = str(snapshot.fromTicketId);
  const to = str(snapshot.toTicketId);
  if (type === null || !(RELATION_TYPES as readonly string[]).includes(type) || !from || !to) {
    return OTHER.describe({} as ActivityEventInput, context, actor);
  }
  const side = relationSideFor({ fromTicketId: from, toTicketId: to }, context.ticketId);
  const other = side === "from" ? to : from;
  return [
    text(`${actor} ${verb} a link: ${relationLabel(type as RelationType, side)} `),
    ticketRef(context, other),
    text("."),
  ];
}

const OTHER: CopyRow = {
  icon: "History",
  describe: (_event, _context, actor) => [text(`${actor} changed this ticket.`)],
};

/** One copy row per TicketAuditAction (UI-SPEC Copywriting "Feed events"). */
export const ACTIVITY_COPY: Record<TicketAuditAction, CopyRow> = {
  STATUS_CHANGED: {
    icon: "CircleDot",
    describe: (event, _context, actor) => [
      text(
        `${actor} changed the status from ${label(STATUS_LABELS, event.before.status)} to ${label(STATUS_LABELS, event.after.status)}.`,
      ),
    ],
  },
  ASSIGNEE_CHANGED: {
    icon: "UserRound",
    describe: (event, context, actor) => {
      const assignee = str(event.after.assigneeId);
      if (assignee === null) return [text(`${actor} removed the assignee.`)];
      // Mid-sentence, the former-member marker starts lower case.
      const name = memberName(context, assignee) ?? "a former member";
      return [text(`${actor} assigned this ticket to ${name}.`)];
    },
  },
  PRIORITY_CHANGED: {
    icon: "Flag",
    describe: (event, _context, actor) => [
      text(
        `${actor} changed the priority from ${label(PRIORITY_LABELS, event.before.priority)} to ${label(PRIORITY_LABELS, event.after.priority)}.`,
      ),
    ],
  },
  TAG_ADDED: {
    icon: "Tag",
    describe: (event, context, actor) => [
      text(`${actor} added the tag ${tagName(context, event.after.tagId ?? event.before.tagId)}.`),
    ],
  },
  TAG_REMOVED: {
    icon: "Tag",
    describe: (event, context, actor) => [
      text(
        `${actor} removed the tag ${tagName(context, event.before.tagId ?? event.after.tagId)}.`,
      ),
    ],
  },
  AUTO_CLOSED: {
    icon: "CircleDot",
    describe: () => [text("Closed automatically by the auto-close setting.")],
  },
  RELATION_ADDED: {
    icon: "Link2",
    describe: (event, context, actor) => relationParts("added", event.after, context, actor),
  },
  RELATION_REMOVED: {
    icon: "Unlink2",
    describe: (event, context, actor) => relationParts("removed", event.before, context, actor),
  },
  MERGED_INTO: {
    icon: "Merge",
    describe: (event, context, actor) => [
      text(`${actor} merged this ticket into `),
      ticketRef(context, event.after.targetTicketId),
      text("."),
    ],
  },
  MERGED_FROM: {
    icon: "Merge",
    describe: (event, context, actor) => [
      text(`${actor} merged `),
      ticketRef(context, event.after.sourceTicketId),
      text(" into this ticket."),
    ],
  },
  SNOOZED: {
    icon: "AlarmClock",
    describe: (event, context, actor) => {
      const until = str(event.after.snoozedUntil);
      if (until === null || Number.isNaN(Date.parse(until))) {
        return OTHER.describe(event, context, actor);
      }
      return [text(`${actor} snoozed this ticket until `), { type: "time", iso: until }, text(".")];
    },
  },
  WOKEN: {
    icon: "Sunrise",
    describe: (event, _context, actor) =>
      event.actorType === "SYSTEM"
        ? [text("The snooze ended.")]
        : [text(`${actor} woke this ticket.`)],
  },
};

/** The actor text: a current member's name, the former-member marker, or the system. */
export function actorText(event: ActivityEventInput, context: ActivityContext): string {
  if (event.actorType === "SYSTEM") return ACTOR_SYSTEM;
  return memberName(context, event.actorUserId) ?? ACTOR_FORMER_MEMBER;
}

/** Icon and sentence parts of one audit row; "(bulk change)" only when it carries a batchId. */
export function describeEvent(event: ActivityEventInput, context: ActivityContext): DescribedEvent {
  const row: CopyRow = Object.hasOwn(ACTIVITY_COPY, event.action)
    ? ACTIVITY_COPY[event.action as TicketAuditAction]
    : OTHER;
  const parts = row.describe(event, context, actorText(event, context));
  if (event.batchId) parts.push(text(` ${BULK_SUFFIX}`));
  return { icon: row === OTHER ? OTHER.icon : row.icon, parts };
}

/** Plain text of the parts: tickets as "#N", times as their ISO value. For tests and titles. */
export function partsToText(parts: readonly ActivityPart[]): string {
  return parts
    .map((part) =>
      part.type === "text" ? part.text : part.type === "ticket" ? `#${part.number}` : part.iso,
    )
    .join("");
}
