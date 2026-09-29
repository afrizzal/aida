// The ticket page's activity feed (Phase 12, D-18, AIDA-55). Pure: it merges a ticket's messages
// and TicketAuditEvent rows into one list, oldest first, ordered by (createdAt, kind, id) so the
// order is stable when timestamps tie. Messages rank before events on a tie; the id is the last
// tie-break. Agent-only: no (public) route imports this module. Relative imports only.

export type FeedItemKind = "message" | "event";

const KIND_RANK: Record<FeedItemKind, number> = { message: 0, event: 1 };

interface Timed {
  id: string;
  createdAt: Date;
}

export type FeedItem<M extends Timed, E extends Timed> =
  | { kind: "message"; id: string; createdAt: Date; message: M }
  | { kind: "event"; id: string; createdAt: Date; event: E };

function compareFeedItems(a: FeedItem<Timed, Timed>, b: FeedItem<Timed, Timed>): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (byKind !== 0) return byKind;
  // Plain code-unit comparison, not localeCompare, so the order never depends on the locale.
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** One ordered list of messages (internal notes included) and audit events (D-18). */
export function buildActivityFeed<M extends Timed, E extends Timed>(
  messages: readonly M[],
  events: readonly E[],
): FeedItem<M, E>[] {
  const items: FeedItem<M, E>[] = [
    ...messages.map(
      (message): FeedItem<M, E> => ({
        kind: "message",
        id: message.id,
        createdAt: message.createdAt,
        message,
      }),
    ),
    ...events.map(
      (event): FeedItem<M, E> => ({
        kind: "event",
        id: event.id,
        createdAt: event.createdAt,
        event,
      }),
    ),
  ];
  return items.sort(compareFeedItems);
}

/** Ids referenced by an audit row's before/after snapshots that the feed must resolve. */
export function referencedIds(events: readonly { before: unknown; after: unknown }[]): {
  ticketIds: string[];
  tagIds: string[];
  userIds: string[];
  stateIds: string[];
} {
  const tickets = new Set<string>();
  const tags = new Set<string>();
  const users = new Set<string>();
  // Phase 12.1 (K42): STATUS_CHANGED sides hold { stateId, stateGroup }; legacy sides hold none.
  const states = new Set<string>();
  const ticketKeys = ["fromTicketId", "toTicketId", "sourceTicketId", "targetTicketId"];
  for (const event of events) {
    for (const snapshot of [event.before, event.after]) {
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) continue;
      const record = snapshot as Record<string, unknown>;
      for (const key of ticketKeys) {
        if (typeof record[key] === "string") tickets.add(record[key]);
      }
      if (typeof record.tagId === "string") tags.add(record.tagId);
      if (typeof record.assigneeId === "string") users.add(record.assigneeId);
      if (typeof record.stateId === "string") states.add(record.stateId);
    }
  }
  return {
    ticketIds: [...tickets],
    tagIds: [...tags],
    userIds: [...users],
    stateIds: [...states],
  };
}
