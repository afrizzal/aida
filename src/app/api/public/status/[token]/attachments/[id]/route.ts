import { NextResponse } from "next/server";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { prisma } from "@/lib/db";

// Reads from the local filesystem — must run on the Node.js runtime, never Edge.
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;

  // Unauthenticated bearer-token flow — the token IS the authorization; bare prisma,
  // never scopedDb (no session/org context exists on this route).
  const ticket = await prisma.ticket.findUnique({ where: { statusToken: token } });
  if (!ticket) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // This join is the internal-note-blind guarantee: an attachment can only be served
  // here if it belongs to THIS ticket AND to a PUBLIC message — an attachment on an
  // internal note (or on a different ticket entirely) can never be reached through
  // this route, no matter what `id` is requested.
  const attachment = await prisma.attachment.findFirst({
    where: { id, message: { ticketId: ticket.id, visibility: "PUBLIC" } },
  });
  if (!attachment) {
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
