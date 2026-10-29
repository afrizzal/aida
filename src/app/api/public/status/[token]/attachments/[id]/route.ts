import { NextResponse } from "next/server";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit/public-limits";
import { loadStatusAttachment } from "@/lib/tickets/status-page-data";

// Reads from the local filesystem — must run on the Node.js runtime, never Edge.
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;

  // Limit before any token work, so the route cannot be used to probe tokens at full speed (D-21).
  const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.statusAttachment;
  const limit = await consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs });
  if (!limit.allowed) {
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

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
