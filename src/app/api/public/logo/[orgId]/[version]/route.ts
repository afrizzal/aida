import { NextResponse } from "next/server";
import { readCurrentLogo } from "@/lib/branding/logo-store";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit/public-limits";

// Public logo (Phase 9 plan 09-05, AIDA-34, D-09, U-02). Reads from the local filesystem, so it
// runs on the Node.js runtime, never Edge. It lives under the existing /api/public prefix of
// src/proxy.ts (no proxy entry of its own), and the CSP's img-src 'self' already allows it.
export const runtime = "nodejs";

// The organization id as Better Auth and the fixtures write it, and the 12-hex logo version.
const ORG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION = /^[0-9a-f]{12}$/;

// One answer for every miss: unknown organization, no logo, another version, malformed
// parameters or a referenced file that is gone. It reveals nothing about which one it was.
function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; version: string }> },
) {
  // Limit before any parameter or database work (the public-route order, D-21).
  const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.logo;
  const limit = await consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs });
  if (!limit.allowed) {
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  const { orgId, version } = await params;
  if (!ORG_ID.test(orgId) || !VERSION.test(version)) return notFound();

  // Selects by organization id and the exact current version only; the storage key comes from
  // the stored reference, never from the request.
  const logo = await readCurrentLogo({ orgId, version });
  if (!logo) return notFound();

  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      // The type sniffed at upload; nosniff keeps a browser from reading the bytes as anything else.
      "Content-Type": logo.mimeType,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      // The version is in the URL, so a replaced logo gets a new URL; a copy already cached by a
      // browser or a proxy is not revoked (docs/SECURITY.md).
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
