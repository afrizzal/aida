// The one loader behind the public status page (Phase 12, D-09). The status token is the only
// credential on this unauthenticated route, so this uses the bare client, never scopedDb. What
// the token may see comes only from statusMessageWhere (12-01), the predicate the attachment
// route shares, so the page and the attachment route cannot drift.
//
// A merged source never exposes its target: the header fields (number, subject, group) are
// always the token's own ticket, and only the merged flag tells the page a merge happened.
//
// Public label by group only (Phase 12.1, D-13): the loader selects only the group of the
// ticket's state and returns it as group. It never selects or returns the state's name, colour
// or id, so an internal name such as "Waiting on engineering" never reaches the public side.
//
// One snapshot (Codex diff critique round 1, D5): the token's merge marker and the message or
// attachment rows are read in ONE interactive transaction at REPEATABLE READ, so both reads see
// the database as it was at the first one. A merge that commits between them is not seen by
// either: the page shows the pre-merge view, never an empty thread, and a valid attachment is
// never a transient 404. The next request sees the merge. Plain reads only; no row is locked.
// Relative imports only.

import type { MessageVisibility } from "../../generated/prisma/client";
import { prisma } from "../db";
import { isMessageVisibleForToken, statusMessageWhere } from "./status-visibility";
import type { StateGroup } from "./ticket-states";

export interface StatusPageAttachment {
  id: string;
  originalFilename: string;
  sizeBytes: number;
}

export interface StatusPageMessage {
  id: string;
  visibility: MessageVisibility;
  authorContactId: string | null;
  bodyHtml: string;
  createdAt: Date;
  triggeredReopen: boolean;
  authorUser: { name: string } | null;
  authorContact: { name: string | null; email: string } | null;
  attachments: StatusPageAttachment[];
}

export interface StatusPageData {
  ticketId: string;
  /** The ticket's organization: the status page shows this organization's brand (D-10). */
  organizationId: string;
  number: number;
  subject: string;
  /** The group of the ticket's state; the only state information the public side gets. */
  group: StateGroup;
  contact: { name: string | null; email: string };
  merged: boolean;
  mergedAt: Date | null;
  messages: StatusPageMessage[];
  csat: { score: number; comment: string | null } | null;
}

/** Test seam of the two status-token reads (the page loader and the attachment route). */
export interface StatusReadObserver {
  /** Awaited after the token's ticket row was read and before its messages are read. */
  afterTicketRead?(): Promise<void> | void;
}

let statusReadObserver: StatusReadObserver | null = null;

/** Both reads in one snapshot (D5). The default timeouts stay: two indexed reads. */
const SNAPSHOT = { isolationLevel: "RepeatableRead" } as const;

/**
 * Test seam only (as setAgentMessageObserverForTests): lets a test commit a merge between the
 * ticket read and the message read. null clears it. Production code never calls this.
 */
export function setStatusReadObserverForTests(observer: StatusReadObserver | null): void {
  statusReadObserver = observer;
}

export async function loadStatusPageData(token: string): Promise<StatusPageData | null> {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { statusToken: token },
      select: {
        id: true,
        organizationId: true,
        number: true,
        subject: true,
        state: { select: { group: true } },
        mergedIntoTicketId: true,
        mergedAt: true,
        mergeMessageSeq: true,
        contact: { select: { name: true, email: true } },
        csatResponse: { select: { score: true, comment: true } },
      },
    });
    if (!ticket) return null;
    if (statusReadObserver?.afterTicketRead) await statusReadObserver.afterTicketRead();

    // Server-side filter: INTERNAL notes and messages outside this token's provenance are never
    // fetched for this route (D-21, D-09). seq is not selected (a BigInt; never sent to clients).
    const messages = await tx.message.findMany({
      where: statusMessageWhere(ticket),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        visibility: true,
        authorContactId: true,
        bodyHtml: true,
        createdAt: true,
        triggeredReopen: true,
        authorUser: { select: { name: true } },
        authorContact: { select: { name: true, email: true } },
        attachments: {
          select: { id: true, originalFilename: true, sizeBytes: true },
          orderBy: { id: "asc" },
        },
      },
    });

    return {
      ticketId: ticket.id,
      organizationId: ticket.organizationId,
      number: ticket.number,
      subject: ticket.subject,
      group: ticket.state.group,
      contact: ticket.contact,
      merged: ticket.mergedIntoTicketId !== null,
      mergedAt: ticket.mergedAt,
      messages,
      csat: ticket.csatResponse,
    };
  }, SNAPSHOT);
}

/** The longest status token the lookup queries; generateStatusToken writes 32 characters. */
const MAX_STATUS_TOKEN_LENGTH = 256;

/** The ticket a status token resolves to, as the two status-token POST routes need it. */
export interface StatusTokenTicket {
  id: string;
  organizationId: string;
  contactId: string;
  state: { group: StateGroup };
}

/**
 * The one token lookup of the two status-token POST routes, csat and follow-up (Phase 10, V-11,
 * D-08). The rule: possession of the token is the authorization, and only that ticket's data is
 * reachable. It returns exactly the ticket whose status token equals the token, or null. Every
 * other read or write those routes make carries the organizationId and the ticket id returned
 * here (R3-4); the membership inventory's Rule E checks that. The page and the attachment route
 * keep their own loaders above (one snapshot each); this is not a second loader for the page.
 *
 * An empty token, or one longer than MAX_STATUS_TOKEN_LENGTH, returns null without a query. The
 * select is the union of what the two routes read before (csat: the state group and the id;
 * follow-up: id, organizationId, contactId). Bare prisma, never scopedDb: no session exists here.
 */
export async function findTicketByStatusToken(token: string): Promise<StatusTokenTicket | null> {
  if (token.length === 0 || token.length > MAX_STATUS_TOKEN_LENGTH) return null;
  return prisma.ticket.findUnique({
    where: { statusToken: token },
    select: {
      id: true,
      organizationId: true,
      contactId: true,
      state: { select: { group: true } },
    },
  });
}

export interface StatusAttachmentFile {
  organizationId: string;
  storageKey: string;
  mimeType: string;
  originalFilename: string;
}

/**
 * The attachment a status token may download, or null (the route answers 404 for null). The
 * attachment is served only when its message passes the same provenance predicate the status
 * page uses (D-09): INTERNAL notes, another ticket's messages, and messages outside this token's
 * provenance after a merge all answer the same null as an unknown id.
 */
export async function loadStatusAttachment(
  token: string,
  attachmentId: string,
): Promise<StatusAttachmentFile | null> {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { statusToken: token },
      select: { id: true, organizationId: true, mergedIntoTicketId: true, mergeMessageSeq: true },
    });
    if (!ticket) return null;
    if (statusReadObserver?.afterTicketRead) await statusReadObserver.afterTicketRead();

    const attachment = await tx.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        storageKey: true,
        mimeType: true,
        originalFilename: true,
        message: {
          select: { ticketId: true, visibility: true, mergedFromTicketId: true, seq: true },
        },
      },
    });
    if (!attachment || !isMessageVisibleForToken(ticket, attachment.message)) return null;
    return {
      organizationId: ticket.organizationId,
      storageKey: attachment.storageKey,
      mimeType: attachment.mimeType,
      originalFilename: attachment.originalFilename,
    };
  }, SNAPSHOT);
}
