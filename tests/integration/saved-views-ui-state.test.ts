// Phase 11, plan 11-05: what the sidebar and the inbox strip receive from the saved-view reads
// (AIDA-47, UI-SPEC Surfaces 1 and 2b), on a real Postgres through Testcontainers. Nothing is
// mocked. Covers two behaviours of the 11-03 service that the UI must respect:
//   1. listSavedViewsForViewer and getSavedViewForPanel THROW MEMBERSHIP_ENDED; the wrappers the
//      (app) layout and TicketListPanel use turn that into a defined state.
//   2. Stored filters hold the state ids sorted (version 2, Phase 12.1 D-09); applied versus
//      changed compares state ids as a set, so a different order alone is never "Filters changed".
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createSavedView,
  getSavedViewForPanel,
  listSavedViewsForViewer,
} from "@/lib/saved-views/service";
import { panelOrMembershipEnded, sidebarViewsOrEmpty } from "@/lib/saved-views/ui-state";
import { seedOrgWithMembers, stateIdFor } from "../support/inbox-fixtures";

async function makeSharedView(orgId: string, userId: string, stateIds: string[]) {
  const result = await createSavedView(
    prisma,
    { userId, orgId },
    {
      name: `UI state ${Math.random().toString(36).slice(2)}`,
      visibility: "SHARED",
      filters: { view: "all", stateIds },
    },
  );
  if (!result.ok) throw new Error(`makeSharedView refused: ${result.error}`);
  return result.id;
}

describe("saved views in the UI: a removed member gets defined states, never a throw", () => {
  it("the sidebar gets empty lists and the strip gets membership_ended", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [owner, gone] = users;
    const open = await stateIdFor(orgId, "OPEN");
    const viewId = await makeSharedView(orgId, owner.id, [open]);
    const goneActor = { userId: gone.id, orgId };

    // Before removal the same wrappers pass the service result through.
    const before = await sidebarViewsOrEmpty(() => listSavedViewsForViewer(prisma, goneActor));
    expect(before.shared.map((v) => v.id)).toEqual([viewId]);

    await prisma.member.delete({ where: { id: gone.memberId } });

    // The raw reads throw (11-03 contract) ...
    await expect(listSavedViewsForViewer(prisma, goneActor)).rejects.toMatchObject({
      code: "MEMBERSHIP_ENDED",
    });
    await expect(
      getSavedViewForPanel(prisma, goneActor, viewId, { stateIds: [open] }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_ENDED" });

    // ... and the wrappers the layout and the panel use resolve to a defined state.
    await expect(
      sidebarViewsOrEmpty(() => listSavedViewsForViewer(prisma, goneActor)),
    ).resolves.toEqual({ private: [], shared: [] });
    await expect(
      panelOrMembershipEnded(() =>
        getSavedViewForPanel(prisma, goneActor, viewId, { stateIds: [open] }),
      ),
    ).resolves.toEqual({ status: "membership_ended" });
  });

  it("the strip wrapper rethrows any other error, so only a removed member is turned into a state", async () => {
    const boom = new Error("database unavailable");
    await expect(panelOrMembershipEnded(() => Promise.reject(boom))).rejects.toBe(boom);
    await expect(sidebarViewsOrEmpty(() => Promise.reject(boom))).resolves.toEqual({
      private: [],
      shared: [],
    });
  });
});

describe("saved views in the UI: state id order alone never shows Filters changed", () => {
  it("a view stored with ids [a, b] is applied for [b, a] and [a, b] and changed for [a] only", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const [owner] = users;
    const actor = { userId: owner.id, orgId };
    const [a, b] = [await stateIdFor(orgId, "OPEN"), await stateIdFor(orgId, "PENDING")].sort();
    const viewId = await makeSharedView(orgId, owner.id, [b, a]);

    // Version 2 stores the ids sorted, whatever order the caller gave (12.1-10 frozen contract).
    const row = await prisma.savedView.findUniqueOrThrow({ where: { id: viewId } });
    expect(row.filters).toEqual({ version: 2, view: "all", stateIds: [a, b] });

    const otherOrder = await panelOrMembershipEnded(() =>
      getSavedViewForPanel(prisma, actor, viewId, { view: "all", stateIds: [b, a] }),
    );
    expect(otherOrder).toMatchObject({ status: "ok", state: "applied" });

    const storedOrder = await panelOrMembershipEnded(() =>
      getSavedViewForPanel(prisma, actor, viewId, { view: "all", stateIds: [a, b] }),
    );
    expect(storedOrder).toMatchObject({ status: "ok", state: "applied" });

    const subset = await panelOrMembershipEnded(() =>
      getSavedViewForPanel(prisma, actor, viewId, { view: "all", stateIds: [a] }),
    );
    expect(subset).toMatchObject({ status: "ok", state: "changed" });
  });
});
