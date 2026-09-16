import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { searchTicketsForPalette } from "@/lib/tickets/palette-search";

// GET /api/palette/tickets?q= — the command palette's ticket search (AIDA-49, D-12).
//
// Session-protected: src/proxy.ts already answers unauthenticated /api/* requests with 401, and
// this handler checks again from the request headers. Membership is checked by
// searchTicketsForPalette (D-01). The response holds at most 10 of the organization's tickets
// as { id, number, subject, status } and nothing else: no other ticket data, no saved view.

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const orgId = session.session.activeOrganizationId;
  if (!orgId) {
    return NextResponse.json({ error: "no_workspace" }, { status: 403, headers: NO_STORE });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const result = await searchTicketsForPalette(prisma, { userId: session.user.id, orgId }, q);
  if (!result.ok) {
    return NextResponse.json({ error: "membership_ended" }, { status: 403, headers: NO_STORE });
  }
  return NextResponse.json({ results: result.results }, { status: 200, headers: NO_STORE });
}
