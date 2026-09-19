import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { searchTicketsForPicker } from "@/lib/tickets/ticket-picker";

// GET /api/tickets/picker?q=&ticketId=&purpose=link|merge — the ticket search behind the link and
// merge dialogs (AIDA-52, D-01, UI-SPEC 2c).
//
// Session-protected: src/proxy.ts already answers unauthenticated /api/* requests with 401 (this
// route is not a public prefix), and this handler checks again from the request headers.
// Membership is checked by searchTicketsForPicker. The response holds at most 10 of the
// organization's tickets as { id, number, subject, status, alreadyLinked, sameContact,
// mergedSource } and nothing else.

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

  const params = new URL(request.url).searchParams;
  const purpose = params.get("purpose") === "merge" ? "merge" : "link";
  const result = await searchTicketsForPicker(
    prisma,
    { userId: session.user.id, orgId },
    { q: params.get("q") ?? "", ticketId: params.get("ticketId") ?? "", purpose },
  );
  if (!result.ok) {
    if (result.error === "TICKET_NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ error: "membership_ended" }, { status: 403, headers: NO_STORE });
  }
  return NextResponse.json({ results: result.results }, { status: 200, headers: NO_STORE });
}
