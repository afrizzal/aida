import { NextResponse } from "next/server";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { getScopedDb } from "@/lib/session";

// Reads from the local filesystem — must run on the Node.js runtime, never Edge.
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let scoped: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    scoped = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { db, orgId } = scoped;

  const { id } = await params;

  // Workspace-scoped: db.attachment.findFirst is auto-filtered to the caller's org by
  // scopedDb (Attachment is in DOMAIN_MODELS) — this is the only path attachments are
  // ever served through.
  const attachment = await db.attachment.findFirst({ where: { id } });
  if (!attachment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const buffer = await localFileStorage.read({ orgId, key: attachment.storageKey });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.originalFilename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
