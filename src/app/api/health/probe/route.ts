import { NextResponse } from "next/server";
import { readHealthSnapshot } from "@/lib/health/health-check";

export const dynamic = "force-dynamic";

// Container healthcheck only (review C2). Caddy refuses this path (`@healthprobe` in the
// Caddyfile), so public traffic never reaches it. It is deliberately unthrottled and reads no
// request header; it answers only from the shared 3-second single-flight snapshot, so it adds no
// database load beyond /api/health's cache (D-20). Direct access to app:3000 is the trust boundary.
export async function GET() {
  const snapshot = await readHealthSnapshot();
  return NextResponse.json(
    { status: snapshot.status === 200 ? "ok" : "error" },
    { status: snapshot.status },
  );
}
