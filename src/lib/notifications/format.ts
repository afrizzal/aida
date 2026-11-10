// The bell's text (Phase 10, AIDA-44, D-19, UI-SPEC Surface 3 and its Copywriting Contract rows
// "Bell label", "Bell row: ..."). Pure functions, no data and no framework import, so the client
// bell, the route and the unit tests share exactly one wording.
//
// Every runtime value (ticket number, actor name, ticket subject) is returned as plain text; the
// bell renders it as escaped React text, never as HTML.
//
// Relative imports only: this module sits beside the worker-bundled notification modules.
import type { NotificationTypeName } from "./types";

/** The highest count the pill shows as a number; from this plus one it shows "9+". */
const PILL_MAX = 9;

/**
 * The text of the count pill: null for zero (no pill), the digit for 1 to 9, "9+" from 10.
 * A negative or non-integer input is treated as its truncated, non-negative value.
 */
export function formatBellCount(n: number): string | null {
  const count = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  if (count === 0) return null;
  return count > PILL_MAX ? `${PILL_MAX}+` : String(count);
}

/** The trigger's accessible name: it carries the exact count, the pill is aria-hidden. */
export function bellLabel(n: number): string {
  const count = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  return count > 0 ? `Notifications, ${count} unread` : "Notifications";
}

/** What one bell sentence needs. Null fields fall back to neutral words. */
export interface BellSentenceInput {
  type: NotificationTypeName;
  /** Null when the ticket no longer exists or is not readable in this organization. */
  ticketNumber: number | null;
  /** The actor's display name; null or blank when the actor is unknown or no longer a member. */
  actorName?: string | null;
}

/** Used when the ticket is gone (deleted, or not a ticket of this organization). */
const TICKET_FALLBACK = "a ticket";
/** Used for a mention whose actor is unknown or no longer a member. */
const ACTOR_FALLBACK = "Someone";

function ticketRef(ticketNumber: number | null): string {
  return typeof ticketNumber === "number" && Number.isFinite(ticketNumber)
    ? `ticket #${ticketNumber}`
    : TICKET_FALLBACK;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Line 1 of a bell row, per the Copywriting Contract "Bell row: ..." rows. */
export function notificationSentence(row: BellSentenceInput): string {
  const ticket = ticketRef(row.ticketNumber);
  switch (row.type) {
    case "ASSIGNED":
      return `${capitalize(ticket)} was assigned to you`;
    case "CUSTOMER_REPLY":
      return `New customer reply on ${ticket}`;
    case "MENTION": {
      const actor = row.actorName?.trim() ? row.actorName.trim() : ACTOR_FALLBACK;
      return `${actor} mentioned you on ${ticket}`;
    }
    case "SLA_AT_RISK":
      return `${capitalize(ticket)} is at risk of missing its SLA`;
    case "SLA_BREACHED":
      return `${capitalize(ticket)} missed its SLA`;
  }
}

/** The subject part of line 2 when the ticket is gone. */
export const SUBJECT_FALLBACK = "Ticket no longer available";
/** The subject part of line 2 when the ticket has an empty subject. */
export const EMPTY_SUBJECT = "(no subject)";

/** The subject part of line 2: the stored subject, or a fallback for a missing or empty one. */
export function notificationSubject(subject: string | null): string {
  if (subject === null) return SUBJECT_FALLBACK;
  return subject.trim() === "" ? EMPTY_SUBJECT : subject;
}

/** One row of GET /api/notifications?view=list, as the bell receives it (JSON). */
export interface BellListItem {
  id: string;
  type: NotificationTypeName;
  read: boolean;
  /** ISO timestamp. */
  createdAt: string;
  /** The ticket to link to; null when the entity is not a ticket or the ticket is gone. */
  ticketId: string | null;
  ticketNumber: number | null;
  ticketSubject: string | null;
  /** The mention actor's display name; null when unknown or no longer a member. */
  actorName: string | null;
}

/** The body of GET /api/notifications?view=list. */
export interface BellListResponse {
  items: BellListItem[];
  hasMore: boolean;
}
