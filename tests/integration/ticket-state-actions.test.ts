// Phase 12.1, plan 12.1-12: the server actions of /settings/statuses (AIDA-97, D-01). The session
// and next/cache are test doubles; the service of plan 12.1-08 and Postgres are real. Each action
// passes the session actor to the service, returns its result unchanged and revalidates only on
// success (threat T-12.1-44: a member's call is refused on the server with no revalidation).
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";

const env = vi.hoisted(() => ({
  actor: null as null | { userId: string; orgId: string },
}));

vi.mock("@/lib/session", () => ({
  getSessionActor: async () => {
    if (!env.actor) throw new Error("no session");
    return env.actor;
  },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const { createStatusAction, deleteStatusAction } = await import(
  "@/app/(app)/settings/statuses/actions"
);

async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member", "admin"]);
  await prisma.member.delete({ where: { id: users[2].memberId } });
  return {
    orgId,
    admin: { userId: users[0].id, orgId },
    member: { userId: users[1].id, orgId },
    removed: { userId: users[2].id, orgId },
  };
}

beforeEach(() => {
  revalidatePath.mockClear();
  env.actor = null;
});

describe("ticket state server actions (plan 12.1-12)", () => {
  it("an admin's createStatusAction adds the state and revalidates both paths", async () => {
    const { orgId, admin } = await seedOrg();
    env.actor = admin;
    const name = `Waiting ${randomUUID().slice(0, 8)}`;

    const result = await createStatusAction({ group: "PENDING", name, colorToken: "amber" });

    expect(result).toMatchObject({ ok: true, state: { name, group: "PENDING" } });
    const stored = await prisma.ticketState.findFirst({
      where: { organizationId: orgId, name, deletedAt: null },
    });
    expect(stored?.group).toBe("PENDING");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/statuses");
    expect(revalidatePath).toHaveBeenCalledWith("/tickets", "layout");
  });

  it("a member's call returns NOT_ALLOWED and revalidates nothing", async () => {
    const { orgId, member } = await seedOrg();
    env.actor = member;
    const name = `Member ${randomUUID().slice(0, 8)}`;

    const result = await createStatusAction({ group: "PENDING", name, colorToken: "amber" });

    expect(result).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(revalidatePath).not.toHaveBeenCalled();
    const stored = await prisma.ticketState.findFirst({ where: { organizationId: orgId, name } });
    expect(stored).toBeNull();
  });

  it("a removed member's call returns MEMBERSHIP_ENDED and revalidates nothing", async () => {
    const { removed } = await seedOrg();
    env.actor = removed;

    const result = await createStatusAction({
      group: "PENDING",
      name: "Gone",
      colorToken: "amber",
    });

    expect(result).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deleteStatusAction returns the service's movedCount and revalidates", async () => {
    const { orgId, admin } = await seedOrg();
    env.actor = admin;
    const pendingId = await stateIdFor(orgId, "PENDING");
    const replacement = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: `Other pending ${randomUUID().slice(0, 8)}`,
        colorToken: "orange",
        group: "PENDING",
        sortOrder: 50,
      },
      select: { id: true, name: true },
    });
    await seedTicket(orgId, { status: "PENDING" });
    await seedTicket(orgId, { status: "PENDING" });

    const result = await deleteStatusAction({
      stateId: pendingId,
      replacementStateId: replacement.id,
    });

    expect(result).toMatchObject({
      ok: true,
      movedCount: 2,
      replacementName: replacement.name,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/statuses");
    expect(revalidatePath).toHaveBeenCalledWith("/tickets", "layout");
  });
});
