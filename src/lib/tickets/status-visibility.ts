// The one status-token provenance predicate (Phase 12, D-09 as amended 2026-11-08 after review
// C1). The public status page, the public attachment route and their tests all use this module,
// so what a token sees cannot drift between them (CONTEXT Specifics). Pure; relative imports only.
//
// What a status token sees:
//   - a merged source S (mergedIntoTicketId = T, mergeMessageSeq = k): the PUBLIC messages on T
//     whose mergedFromTicketId is S, plus the PUBLIC messages on T with mergedFromTicketId null
//     whose seq is strictly greater than k;
//   - any other ticket: its own PUBLIC messages with mergedFromTicketId null;
//   - INTERNAL messages: never.
//
// The only boundary between pre-merge and post-merge target messages is message seq against
// the source's mergeMessageSeq. No timestamp is compared: a transaction's default insert time
// is fixed before it gets the row lock, and timestamps can tie.
//
// Invariant the later plans keep: every Message insert on an existing ticket happens while the
// writer holds that ticket's row lock (12-03 agent messages route, the 12-03 demo seed reply
// inserts in src/lib/demo/seed-demo-data.ts per review R2-2, 12-04 status follow-up and
// email ingest), and the merge draws mergeMessageSeq from the Message seq sequence under both
// ticket row locks (12-03). So a message inserted after the merge has a seq above the marker.
//
// The where object selects nothing. Callers that pass rows to client components never include
// seq (a BigInt).

export interface StatusTokenTicket {
  id: string;
  mergedIntoTicketId: string | null;
  mergeMessageSeq: bigint | null;
}

export interface StatusVisibilityMessage {
  ticketId: string;
  visibility: "PUBLIC" | "INTERNAL";
  mergedFromTicketId: string | null;
  seq: bigint;
}

export type StatusMessageWhere =
  | { ticketId: string; visibility: "PUBLIC"; mergedFromTicketId: null }
  | {
      ticketId: string;
      visibility: "PUBLIC";
      OR: [{ mergedFromTicketId: string }, { mergedFromTicketId: null; seq: { gt: bigint } }];
    };

function mergeMarker(ticket: StatusTokenTicket): { targetId: string; marker: bigint } | null {
  if (ticket.mergedIntoTicketId === null) return null;
  if (ticket.mergeMessageSeq === null) {
    // Ticket_merge_fields_check makes this unreachable; refuse rather than guess.
    throw new Error("merged ticket has no mergeMessageSeq");
  }
  return { targetId: ticket.mergedIntoTicketId, marker: ticket.mergeMessageSeq };
}

/** Prisma `where` for Message: exactly the rows this ticket's status token may see. */
export function statusMessageWhere(ticket: StatusTokenTicket): StatusMessageWhere {
  const merge = mergeMarker(ticket);
  if (!merge) {
    return { ticketId: ticket.id, visibility: "PUBLIC", mergedFromTicketId: null };
  }
  return {
    ticketId: merge.targetId,
    visibility: "PUBLIC",
    OR: [{ mergedFromTicketId: ticket.id }, { mergedFromTicketId: null, seq: { gt: merge.marker } }],
  };
}

/** The same rule as statusMessageWhere, for one loaded message (attachment route, tests). */
export function isMessageVisibleForToken(
  ticket: StatusTokenTicket,
  message: StatusVisibilityMessage,
): boolean {
  if (message.visibility !== "PUBLIC") return false;
  const merge = mergeMarker(ticket);
  if (!merge) {
    return message.ticketId === ticket.id && message.mergedFromTicketId === null;
  }
  if (message.ticketId !== merge.targetId) return false;
  if (message.mergedFromTicketId === ticket.id) return true;
  return message.mergedFromTicketId === null && message.seq > merge.marker;
}
