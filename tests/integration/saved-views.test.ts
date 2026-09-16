// Phase 11, plan 11-03: the saved-views service (AIDA-47, D-03 to D-05), on a real Postgres
// through Testcontainers. Nothing is mocked.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createSavedView,
  listSavedViewsForViewer,
  type SavedViewActor,
} from "@/lib/saved-views/service";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

function actorOf(orgId: string, userId: string): SavedViewActor {
  return { userId, orgId };
}

describe("saved views: a shared view crosses to every member of its organization (tracer)", () => {
  it("member A's SHARED view is listed for member B with its href", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [a, b] = users;

    const created = await createSavedView(prisma, actorOf(orgId, a.id), {
      name: "Open queue",
      visibility: "SHARED",
      filters: { statuses: ["OPEN"] },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.href).toBe(`/tickets?sv=${created.id}&status=OPEN`);

    const listB = await listSavedViewsForViewer(prisma, actorOf(orgId, b.id));
    expect(listB.private).toEqual([]);
    expect(listB.shared).toEqual([
      {
        id: created.id,
        name: "Open queue",
        visibility: "SHARED",
        href: `/tickets?sv=${created.id}&status=OPEN`,
      },
    ]);

    const row = await prisma.savedView.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.filters).toEqual({ version: 1, view: "all", statuses: ["OPEN"] });
    expect(row.position).toBe(0);
    expect(row.ownerUserId).toBe(a.id);
  });

  it("A's PRIVATE view is in A's private list and absent from B's lists", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [a, b] = users;

    const created = await createSavedView(prisma, actorOf(orgId, a.id), {
      name: "My urgent",
      visibility: "PRIVATE",
      filters: { view: "mine", statuses: ["NEW", "OPEN"], q: "refund" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listA = await listSavedViewsForViewer(prisma, actorOf(orgId, a.id));
    expect(listA.private.map((v) => v.id)).toEqual([created.id]);
    expect(listA.private[0].href).toBe(
      `/tickets?sv=${created.id}&view=mine&status=NEW%2COPEN&q=refund`,
    );
    expect(listA.shared).toEqual([]);

    const listB = await listSavedViewsForViewer(prisma, actorOf(orgId, b.id));
    expect(listB).toEqual({ private: [], shared: [] });
  });

  it("a member of another organization sees neither the shared nor the private view", async () => {
    const x = await seedOrgWithMembers(prisma, ["member"]);
    const y = await seedOrgWithMembers(prisma, ["admin"]);
    const shared = await createSavedView(prisma, actorOf(x.orgId, x.users[0].id), {
      name: "Team",
      visibility: "SHARED",
      filters: {},
    });
    const priv = await createSavedView(prisma, actorOf(x.orgId, x.users[0].id), {
      name: "Mine",
      visibility: "PRIVATE",
      filters: {},
    });
    expect(shared.ok && priv.ok).toBe(true);

    const listY = await listSavedViewsForViewer(prisma, actorOf(y.orgId, y.users[0].id));
    expect(listY).toEqual({ private: [], shared: [] });
    // The Y user naming X's organization is not a member there: refused, nothing listed.
    await expect(
      listSavedViewsForViewer(prisma, actorOf(x.orgId, y.users[0].id)),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_ENDED" });
  });

  it("orders by position, then name, then id, and gives each group its own next position", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [a, b] = users;
    const make = (userId: string, name: string, visibility: "PRIVATE" | "SHARED") =>
      createSavedView(prisma, actorOf(orgId, userId), { name, visibility, filters: {} });

    await make(a.id, "Zeta", "SHARED");
    await make(b.id, "Alpha", "SHARED");
    await make(a.id, "Private one", "PRIVATE");
    await make(b.id, "B private", "PRIVATE");

    const rows = await prisma.savedView.findMany({
      where: { organizationId: orgId },
      select: { name: true, position: true },
      orderBy: { name: "asc" },
    });
    expect(rows).toEqual([
      { name: "Alpha", position: 1 },
      { name: "B private", position: 0 },
      { name: "Private one", position: 0 },
      { name: "Zeta", position: 0 },
    ]);

    // Same position: name decides.
    await prisma.savedView.updateMany({
      where: { organizationId: orgId, name: "Alpha" },
      data: { position: 0 },
    });
    const list = await listSavedViewsForViewer(prisma, actorOf(orgId, a.id));
    expect(list.shared.map((v) => v.name)).toEqual(["Alpha", "Zeta"]);
    expect(list.private.map((v) => v.name)).toEqual(["Private one"]);
  });
});
