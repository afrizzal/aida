import { NextResponse } from "next/server";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { classifyGateFailure, gateFailureStatus } from "@/lib/http/gate-failure";
import { AccessDeniedError } from "@/lib/membership";
import { getScopedDb } from "@/lib/session";

// Reads from the local filesystem — must run on the Node.js runtime, never Edge.
export const runtime = "nodejs";

const NOT_FOUND = { error: "not_found" } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let scoped: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    scoped = await getScopedDb();
  } catch (err) {
    // D-08 (AIDA-43): no active organization or no member row answers exactly like a missing
    // attachment, so a removed member learns nothing about which ids exist.
    if (err instanceof AccessDeniedError) return NextResponse.json(NOT_FOUND, { status: 404 });
    // a-IN-7: only the redirect to /login is a 401; a database failure in the gate is a 500.
    const failure = classifyGateFailure("api/attachments", err);
    return NextResponse.json({ error: failure }, { status: gateFailureStatus(failure) });
  }
  const { db, orgId } = scoped;

  const { id } = await params;

  // Workspace-scoped: db.attachment.findFirst is auto-filtered to the caller's org by
  // scopedDb (Attachment is in DOMAIN_MODELS) — this is the only path attachments are
  // ever served through.
  const attachment = await db.attachment.findFirst({ where: { id } });
  if (!attachment) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
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
