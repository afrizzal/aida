import { NextResponse } from "next/server";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { prisma } from "@/lib/db";
import { isMessageVisibleForToken } from "@/lib/tickets/status-visibility";

// Reads from the local filesystem — must run on the Node.js runtime, never Edge.
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;

  // Unauthenticated bearer-token flow — the token IS the authorization; bare prisma,
  // never scopedDb (no session/org context exists on this route).
  const ticket = await prisma.ticket.findUnique({
    where: { statusToken: token },
    select: { id: true, organizationId: true, mergedIntoTicketId: true, mergeMessageSeq: true },
  });
  if (!ticket) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // The attachment is served only when its message passes the same provenance predicate the
  // status page uses (D-09): INTERNAL notes, another ticket's messages, and messages outside
  // this token's provenance after a merge all answer the same 404 as an unknown id.
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      storageKey: true,
      mimeType: true,
      originalFilename: true,
      message: {
        select: { ticketId: true, visibility: true, mergedFromTicketId: true, seq: true },
      },
    },
  });
  if (!attachment || !isMessageVisibleForToken(ticket, attachment.message)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const buffer = await localFileStorage.read({
    orgId: ticket.organizationId,
    key: attachment.storageKey,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.originalFilename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
