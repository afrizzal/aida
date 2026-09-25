import { NextResponse } from "next/server";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { loadStatusAttachment } from "@/lib/tickets/status-page-data";

// Reads from the local filesystem — must run on the Node.js runtime, never Edge.
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;

  // Unauthenticated bearer-token flow — the token IS the authorization; bare prisma inside the
  // loader, never scopedDb (no session/org context exists on this route). The loader serves the
  // attachment only when its message passes the status page's provenance predicate (D-09);
  // every refusal answers the same 404 as an unknown id.
  const attachment = await loadStatusAttachment(token, id);
  if (!attachment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const buffer = await localFileStorage.read({
    orgId: attachment.organizationId,
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
