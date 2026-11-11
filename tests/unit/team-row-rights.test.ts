// K162 (b-WR-2, V-26): what the Team page offers on a row. A target with any `owner` row is shown
// as Owner and protected, so an admin gets neither the role Select nor "Deactivate member" there,
// which is what the server enforces (checkActorAndTarget, member-admin.ts). The actor's own rights
// stay conservative: owner only when every row of the actor is `owner`.
import { describe, expect, it } from "vitest";
import { rowRights, type TeamMember } from "../../src/app/(app)/settings/team/team-rights";

const ACTOR = "actor-user";

function member(overrides: Partial<TeamMember>): TeamMember {
  return {
    userId: "target-user",
    name: "Target",
    email: "target@example.test",
    role: "member",
    hasOwnerRow: false,
    openTickets: 0,
    ...overrides,
  };
}

const PROTECTED = { roleOptions: [], ownerTooltip: true, canDeactivate: false };
const NONE = { roleOptions: [], ownerTooltip: false, canDeactivate: false };

describe("rowRights (V-26)", () => {
  it("an admin actor on a target with owner and admin rows: shown as Owner, protected", () => {
    const target = member({ role: "owner", hasOwnerRow: true });
    expect(rowRights(ACTOR, "admin", target)).toEqual(PROTECTED);
  });

  it("an admin actor on a target with owner and member rows: protected, whatever role reached the row", () => {
    // Defence in depth: even if a caller handed over the conservative role, any owner row protects.
    for (const role of ["owner", "admin", "member"] as const) {
      expect(rowRights(ACTOR, "admin", member({ role, hasOwnerRow: true })), role).toEqual(
        PROTECTED,
      );
    }
  });

  it("an owner actor (every row owner) keeps the Select and Deactivate on a mixed-row target", () => {
    expect(rowRights(ACTOR, "owner", member({ role: "owner", hasOwnerRow: true }))).toEqual({
      roleOptions: ["member", "admin", "owner"],
      ownerTooltip: false,
      canDeactivate: true,
    });
  });

  it("an admin actor on a plain admin or member target gets Member and Admin and Deactivate", () => {
    for (const role of ["admin", "member"] as const) {
      expect(rowRights(ACTOR, "admin", member({ role })), role).toEqual({
        roleOptions: ["member", "admin"],
        ownerTooltip: false,
        canDeactivate: true,
      });
    }
  });

  it("a member actor and the actor's own row get no control", () => {
    expect(rowRights(ACTOR, "member", member({ role: "admin" }))).toEqual(NONE);
    expect(rowRights(ACTOR, "owner", member({ userId: ACTOR, role: "owner" }))).toEqual(NONE);
  });
});
