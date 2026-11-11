// K162 (b-WR-2): a permanent refusal of "Deactivate member" (NOT_ALLOWED, SELF_CHANGE) is never
// phrased as "Wait a moment and try again"; it maps to the not-allowed copy, as the role change
// already does. The server action runs for real; only the session, the services and Next's cache
// are replaced.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getSessionActor: vi.fn(async () => ({ userId: "actor-user", orgId: "org-1" })),
}));
vi.mock("@/lib/workspace-members/invitations", () => ({
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock("@/lib/workspace-members/member-admin", () => ({
  changeMemberRole: vi.fn(),
  countOpenAssignedTickets: vi.fn(async () => 7),
  deactivateMember: vi.fn(),
  reassignOpenTickets: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { deactivateMemberAction } from "../../src/app/(app)/settings/team/actions";
import { deactivateError } from "../../src/app/(app)/settings/team/team-copy";
import { deactivateMember } from "../../src/lib/workspace-members/member-admin";

afterEach(() => {
  vi.clearAllMocks();
});

describe("deactivateMemberAction refusals (K162)", () => {
  it("NOT_ALLOWED and SELF_CHANGE answer not_allowed, revalidate nothing and never read a count", async () => {
    for (const code of ["NOT_ALLOWED", "SELF_CHANGE"] as const) {
      vi.mocked(deactivateMember).mockResolvedValueOnce({ ok: false, error: code });
      expect(await deactivateMemberAction("target-user", null), code).toEqual({
        ok: false,
        error: "not_allowed",
      });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("LAST_OWNER keeps its own copy, and any other refusal stays unknown", async () => {
    vi.mocked(deactivateMember).mockResolvedValueOnce({ ok: false, error: "LAST_OWNER" });
    expect(await deactivateMemberAction("target-user", null)).toEqual({
      ok: false,
      error: "last_owner",
    });
    vi.mocked(deactivateMember).mockResolvedValueOnce({ ok: false, error: "NOT_A_MEMBER" });
    expect(await deactivateMemberAction("target-user", null)).toEqual({
      ok: false,
      error: "unknown",
    });
  });

  it("the not_allowed copy does not tell the admin to wait and try again", () => {
    const text = deactivateError("not_allowed", "Pat");
    expect(text).toBe("You can't make this change with your role.");
    expect(text).not.toContain("try again");
  });
});
