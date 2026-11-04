// Per-route limits for the public routes and their shared 429 response (D-21, D-22, AIDA-30).
// Route files may export only Next.js route fields, so these live here.
import { NextResponse } from "next/server";

const HOUR_MS = 60 * 60 * 1000;

export const PUBLIC_RATE_LIMITS = {
  intake: { scope: "public-intake", max: 5, windowMs: HOUR_MS },
  csat: { scope: "status-csat", max: 5, windowMs: HOUR_MS },
  followUp: { scope: "status-follow-up", max: 5, windowMs: HOUR_MS },
  // 120 per minute per identity is a hypothesis to tune from real traffic (D-21): a status page
  // with many attachments stays well under it, while token probing through this route is slowed.
  statusAttachment: { scope: "status-attachment", max: 120, windowMs: 60 * 1000 },
  // The sidebar and the public pages load a logo once per version per browser (immutable cache),
  // so 300 per minute per identity leaves room for many users behind one address (09-05, D-09).
  logo: { scope: "public-logo", max: 300, windowMs: 60 * 1000 },
} as const;

export function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "rate_limited" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    },
  );
}
