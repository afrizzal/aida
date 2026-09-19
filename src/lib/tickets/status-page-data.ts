// The one loader behind the public status page (Phase 12, D-09). The status token is the only
// credential on this unauthenticated route, so this uses the bare client, never scopedDb. What
// the token may see comes only from statusMessageWhere (12-01), the predicate the attachment
// route shares, so the page and the attachment route cannot drift.
//
// A merged source never exposes its target: the header fields (number, subject, status) are
// always the token's own ticket, and only the merged flag tells the page a merge happened.
// Relative imports only.

import type { MessageVisibility, TicketStatus } from "../../generated/prisma/client";
import { prisma } from "../db";
import { statusMessageWhere } from "./status-visibility";

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
  number: number;
  subject: string;
  status: TicketStatus;
  contact: { name: string | null; email: string };
  merged: boolean;
  mergedAt: Date | null;
  messages: StatusPageMessage[];
  csat: { score: number; comment: string | null } | null;
}

export async function loadStatusPageData(token: string): Promise<StatusPageData | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { statusToken: token },
    select: {
      id: true,
      number: true,
      subject: true,
      status: true,
      mergedIntoTicketId: true,
      mergedAt: true,
      mergeMessageSeq: true,
      contact: { select: { name: true, email: true } },
      csatResponse: { select: { score: true, comment: true } },
    },
  });
  if (!ticket) return null;

  // Server-side filter: INTERNAL notes and messages outside this token's provenance are never
  // fetched for this route (D-21, D-09). seq is not selected (a BigInt; never sent to clients).
  const messages = await prisma.message.findMany({
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
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    contact: ticket.contact,
    merged: ticket.mergedIntoTicketId !== null,
    mergedAt: ticket.mergedAt,
    messages,
    csat: ticket.csatResponse,
  };
}
