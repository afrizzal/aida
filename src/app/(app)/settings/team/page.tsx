import { requirePageAccess } from "@/lib/page-access";
import { countOpenAssignedTickets, listMembers } from "@/lib/workspace-members/member-admin";
import { TEAM_SUBTITLE, TEAM_TITLE, type TeamRole } from "./team-copy";
import { type TeamMember, TeamMembersCard } from "./team-member-row";

// Settings -> Team (Phase 10, AIDA-43, AIDA-42 UI; UI-SPEC Surface 1 with amendments A2 and A7).
// Every member sees the member list; owners and admins also get the controls the "Who may do what"
// table allows. The controls are a convenience: every change goes through a server action that
// reads the session once and calls a src/lib/workspace-members service, which re-checks the actor's
// rights under the organization lock (D-08, V-27, K141).
export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  // The membership gate first, outside any try (Phase 10, V-27, C6): a non-member goes to /no-access.
  const { orgId, session } = await requirePageAccess();
  const entries = await listMembers(orgId);

  // The actor's rights from the same conservative read as every row (V-26): owner only when every
  // row of the actor is `owner`, admin only when every row is `owner` or `admin`.
  const actorUserId = session.user.id;
  const actorRole: TeamRole = entries.find((m) => m.userId === actorUserId)?.role ?? "member";

  const canManage = actorRole === "owner" || actorRole === "admin";

  // The Deactivate dialog's "{Name} has {N} open tickets assigned." (D-07), counted with the same
  // open definition reassignOpenTickets uses; only for owners and admins, never for the actor.
  const members: TeamMember[] = await Promise.all(
    entries.map(async (m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      openTickets:
        canManage && m.userId !== actorUserId ? await countOpenAssignedTickets(orgId, m.userId) : 0,
    })),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[18px] font-semibold">{TEAM_TITLE}</h1>
          <p className="text-[13px] text-muted-foreground">{TEAM_SUBTITLE}</p>
        </div>
      </div>
      <TeamMembersCard members={members} actorUserId={actorUserId} actorRole={actorRole} />
    </div>
  );
}
