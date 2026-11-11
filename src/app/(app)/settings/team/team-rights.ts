// What the Team page offers on one member row (UI-SPEC Surface 1 "Who may do what"; V-26, K162).
// Pure and framework-free, so the rule is unit-tested on its own. The controls are a convenience:
// every change is re-checked by the service under the organization lock, which refuses an admin
// acting on any target with an `owner` row (checkActorAndTarget, member-admin.ts).
import { grantableRoles, type TeamRole } from "./team-copy";

/** One member as the page hands it over: no image (no remote avatar), no other organization. */
export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  /** The role shown: Owner whenever the user holds any owner row (listMembers displayRole). */
  role: TeamRole;
  /** The user holds at least one owner row, so only an owner may act on them (V-26 (3)). */
  hasOwnerRow: boolean;
  /** Open tickets assigned to the member (countOpenAssignedTickets); 0 for actors without rights. */
  openTickets: number;
}

/** What the actor may do on a row (UI-SPEC "Who may do what"; the server is authoritative). */
export interface RowRights {
  /** Roles offered in the Select; empty means a Badge only. */
  roleOptions: TeamRole[];
  /** An admin actor looking at an owner-protected row: Badge with the owner tooltip. */
  ownerTooltip: boolean;
  /** "Deactivate member" is shown. */
  canDeactivate: boolean;
}

/**
 * actorRole is the actor's conservative role (owner only when every row is `owner`, admin only
 * when every row is `owner` or `admin`); a target with any owner row is protected from an admin.
 */
export function rowRights(actorUserId: string, actorRole: TeamRole, member: TeamMember): RowRights {
  const own = member.userId === actorUserId;
  if (own || actorRole === "member") {
    return { roleOptions: [], ownerTooltip: false, canDeactivate: false };
  }
  if (actorRole === "admin" && (member.hasOwnerRow || member.role === "owner")) {
    return { roleOptions: [], ownerTooltip: true, canDeactivate: false };
  }
  return { roleOptions: grantableRoles(actorRole), ownerTooltip: false, canDeactivate: true };
}
