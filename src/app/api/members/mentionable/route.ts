import { NextResponse } from "next/server";
import { AccessDeniedError } from "@/lib/membership";
import { mentionDisplayName } from "@/lib/mentions/mentions";
import { getScopedDb } from "@/lib/session";
import { listMembers } from "@/lib/workspace-members/member-admin";

// GET /api/members/mentionable: the members the internal-note composer can mention (Phase 10,
// AIDA-45, D-20, UI-SPEC Surface 4, T-10-45).
//
// Behind the membership gate: getScopedDb re-reads the caller's member rows in the session's active
// organization, so a removed member gets 403 `membership_ended` whatever the cookie holds (D-08).
// The list is the current members of that organization only, one entry per user even with
// duplicate member rows (listMembers, V-26), without the caller (mentioning yourself has no use).
// Each entry is { id, name, email } and nothing else: `name` is the display name the server renders
// for a mention (mentionDisplayName: the name, else the email's local part, never an email), so an
// insertion writes exactly the text the messages route wraps. The server re-validates every
// mentioned id inside the message transaction (src/lib/mentions/mentions.ts); this list is only
// what the composer offers.

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  // getScopedDb redirects when unauthenticated (src/proxy.ts already answers 401 for /api/*); that
  // throw becomes a 401 here, as in the messages route, so the composer's fetch never follows it.
  let scoped: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    scoped = await getScopedDb();
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return NextResponse.json({ error: "membership_ended" }, { status: 403, headers: NO_STORE });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const { orgId, session } = scoped;

  const members = (await listMembers(orgId))
    .filter((member) => member.userId !== session.user.id)
    .map((member) => ({
      id: member.userId,
      name: mentionDisplayName(member.name, member.email),
      email: member.email,
    }))
    .filter((member) => member.name !== "")
    .sort((a, b) => {
      const an = a.name.toLocaleLowerCase();
      const bn = b.name.toLocaleLowerCase();
      if (an !== bn) return an < bn ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  return NextResponse.json({ members }, { status: 200, headers: NO_STORE });
}
