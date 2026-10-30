import { NextResponse } from "next/server";
import { checkHealthThrottle, readHealthSnapshot } from "@/lib/health/health-check";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { rateLimitedResponse } from "@/lib/rate-limit/public-limits";

export const dynamic = "force-dynamic";

// Public and unauthenticated: throttled in memory per client identity before any DB work (D-20).
export async function GET(request: Request) {
  const throttle = checkHealthThrottle(getRateLimitIdentity(request));
  if (!throttle.allowed) return rateLimitedResponse(throttle.retryAfterSeconds);

  const snapshot = await readHealthSnapshot();
  return NextResponse.json(snapshot.body, { status: snapshot.status });
}
