"use server";

import { revalidatePath } from "next/cache";
import { getSessionActor } from "@/lib/session";
import { changeMemberRole } from "@/lib/workspace-members/member-admin";
import type { RoleErrorKey, TeamRole } from "./team-copy";

// The server actions of /settings/team (Phase 10, AIDA-43, AIDA-42 UI; D-08, V-27, K141). Each
// action reads the session ONCE through the session actor helper (the actor never comes from
// input) and passes the untrusted input to a 10-03 or 10-05 service under
// src/lib/workspace-members/, which re-reads the actor's rights inside its locked transaction: the
// server decides every permission, whatever the browser showed (T-10-39, T-10-41). A refusal is
// returned as one Copywriting key and never thrown; raw error text and codes do not reach the
// browser. The page is revalidated only after a change, so a refusal does not re-render the route
// and the client keeps its state.

const TEAM_PATH = "/settings/team";

export type ChangeRoleResult = { ok: true; role: TeamRole } | { ok: false; error: RoleErrorKey };

/** Changes the role of targetUserId in the actor's organization (changeMemberRole, 10-03). */
export async function changeRoleAction(
  targetUserId: unknown,
  newRole: unknown,
): Promise<ChangeRoleResult> {
  if (typeof targetUserId !== "string" || typeof newRole !== "string") {
    return { ok: false, error: "unknown" };
  }
  const actor = await getSessionActor();
  const result = await changeMemberRole({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    targetUserId,
    newRole,
  });
  if (!result.ok) {
    switch (result.error) {
      case "LAST_OWNER":
        return { ok: false, error: "last_owner" };
      case "NOT_ALLOWED":
      case "SELF_CHANGE":
        return { ok: false, error: "not_allowed" };
      default:
        return { ok: false, error: "unknown" };
    }
  }
  revalidatePath(TEAM_PATH);
  // changeMemberRole accepted newRole, so it is one of the three roles.
  return { ok: true, role: newRole as TeamRole };
}
