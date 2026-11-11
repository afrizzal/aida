import { NextResponse } from "next/server";
import { classifyGateFailure, gateFailureStatus } from "@/lib/http/gate-failure";
import { AccessDeniedError } from "@/lib/membership";
import { mentionDisplayName } from "@/lib/mentions/mentions";
import type { BellListItem } from "@/lib/notifications/format";
import { countUnread, listRecent } from "@/lib/notifications/store";
import { TICKET_ENTITY } from "@/lib/notifications/types";
import { getScopedDb } from "@/lib/session";
import { listMembers } from "@/lib/workspace-members/member-admin";

// GET /api/notifications?view=count|list: the top-bar bell's reads (Phase 10, AIDA-44, D-19,
// UI-SPEC Surface 3, T-10-43).
//
// Behind the membership gate: the session is read once and the caller's member rows in the active
// organization are re-read on every request, so a removed member gets 403 `membership_ended`
// whatever the cookie holds (D-08), and an unauthenticated caller gets 401 (src/proxy.ts already
// answers 401 for /api/*). Every notification read goes through src/lib/notifications/store.ts
// with the session user as the recipient and the active organization (D-15): nobody can read
// another member's notifications here, and no id or recipient comes from the request.
//
// view=count → { count }: unread and not archived, exact integer (the pill caps it, not the route).
// view=list  → { items, hasMore }: the 20 most recent not-archived rows, newest first; hasMore is
//              true when a 21st exists ("Showing the 20 most recent.").
// Each item carries display fields only: the ticket number and subject resolved at read time, and
// for a mention the actor's display name (a current member of this organization, else null so the
// bell says "Someone"). No email, no message text, no other organization's data.
// Writes are server actions (src/app/(app)/notification-actions.ts), which keep Next's origin
// check. Responses are never cached.

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The bell list size (UI-SPEC Surface 3). */
const LIST_SIZE = 20;

export async function GET(request: Request) {
  // The gate redirects when unauthenticated; that throw becomes a 401 here, as in the messages and
  // mentionable routes, so the bell's fetch never follows a redirect.
  let scoped: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    scoped = await getScopedDb();
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return NextResponse.json({ error: "membership_ended" }, { status: 403, headers: NO_STORE });
    }
    // a-IN-7: only the redirect to /login is a 401; a database failure in the gate is a 500.
    const failure = classifyGateFailure("api/notifications", err);
    return NextResponse.json(
      { error: failure },
      { status: gateFailureStatus(failure), headers: NO_STORE },
    );
  }
  const { orgId, session } = scoped;
  const userId = session.user.id;

  const view = new URL(request.url).searchParams.get("view");

  if (view === "count") {
    const count = await countUnread(orgId, userId);
    return NextResponse.json({ count }, { status: 200, headers: NO_STORE });
  }

  if (view === "list") {
    const rows = await listRecent(orgId, userId, LIST_SIZE + 1);
    const visible = rows.slice(0, LIST_SIZE);

    // Actor names only when a visible mention needs one, from this organization's current members.
    const actorIds = new Set(
      visible.filter((r) => r.type === "MENTION" && r.actorUserId).map((r) => r.actorUserId),
    );
    const names = new Map<string, string>();
    if (actorIds.size > 0) {
      for (const member of await listMembers(orgId)) {
        if (!actorIds.has(member.userId)) continue;
        const name = mentionDisplayName(member.name, member.email);
        if (name !== "") names.set(member.userId, name);
      }
    }

    const items: BellListItem[] = visible.map((row) => {
      const ticketExists = row.entityType === TICKET_ENTITY && row.ticketNumber !== null;
      return {
        id: row.id,
        type: row.type,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
        ticketId: ticketExists ? row.entityId : null,
        ticketNumber: row.ticketNumber,
        ticketSubject: row.ticketSubject,
        actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
      };
    });
    return NextResponse.json(
      { items, hasMore: rows.length > LIST_SIZE },
      { status: 200, headers: NO_STORE },
    );
  }

  return NextResponse.json({ error: "invalid_view" }, { status: 400, headers: NO_STORE });
}
