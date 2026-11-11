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
import {
  deactivateMemberAction,
  reassignTicketsAction,
} from "../../src/app/(app)/settings/team/actions";
import { deactivateError } from "../../src/app/(app)/settings/team/team-copy";
import {
  countOpenAssignedTickets,
  deactivateMember,
  reassignOpenTickets,
} from "../../src/lib/workspace-members/member-admin";

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

// b-IN-2: a refused retry (NOT_ALLOWED for a non-admin, INVALID_REASSIGNEE) answers { ok: false }
// and never reads the open-ticket count of the user it names; an unexpected error reports no
// count either, because nothing proved the actor may see it.
describe("reassignTicketsAction refusals (b-IN-2)", () => {
  it("NOT_ALLOWED and INVALID_REASSIGNEE answer { ok: false } with no count and no revalidation", async () => {
    for (const code of ["NOT_ALLOWED", "INVALID_REASSIGNEE"] as const) {
      vi.mocked(reassignOpenTickets).mockResolvedValueOnce({ ok: false, error: code });
      expect(await reassignTicketsAction("someone-else", "reassignee"), code).toEqual({
        ok: false,
      });
    }
    expect(countOpenAssignedTickets).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("an unexpected error reports failed: null and reads no count", async () => {
    vi.mocked(reassignOpenTickets).mockRejectedValueOnce(new Error("boom"));
    expect(await reassignTicketsAction("someone-else", "reassignee")).toEqual({
      ok: true,
      reassigned: 0,
      skipped: 0,
      failed: null,
    });
    expect(countOpenAssignedTickets).not.toHaveBeenCalled();
  });

  it("a successful retry returns the service's counts", async () => {
    vi.mocked(reassignOpenTickets).mockResolvedValueOnce({
      ok: true,
      reassigned: 3,
      skipped: 1,
      failed: 0,
      batchErrors: [],
    });
    expect(await reassignTicketsAction("former-member", "reassignee")).toEqual({
      ok: true,
      reassigned: 3,
      skipped: 1,
      failed: 0,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/team");
  });

  it("after a committed deactivation, a refused reassignment still counts what is left (the actor was just checked as admin)", async () => {
    vi.mocked(deactivateMember).mockResolvedValueOnce({
      ok: true,
      sessionsMoved: 0,
      invitationsRevoked: 0,
    } as Awaited<ReturnType<typeof deactivateMember>>);
    vi.mocked(reassignOpenTickets).mockResolvedValueOnce({
      ok: false,
      error: "INVALID_REASSIGNEE",
    });
    expect(await deactivateMemberAction("target-user", "target-user")).toEqual({
      ok: true,
      reassigned: 0,
      skipped: 0,
      failed: 7,
    });
  });
});
