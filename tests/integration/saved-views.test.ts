// Phase 11, plan 11-03: the saved-views service (AIDA-47, D-03 to D-05), on a real Postgres
// through Testcontainers. Nothing is mocked.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createSavedView,
  deleteSavedView,
  getSavedViewForPanel,
  listSavedViewsForViewer,
  type SavedViewActor,
  type SavedViewHooks,
  updateSavedView,
} from "@/lib/saved-views/service";
import { LEGACY_UNMAPPED_STATE_ID } from "@/lib/tickets/list-filters";
import type { LegacyStatusKey } from "@/lib/tickets/ticket-states";
import { seedOrgWithMembers, stateIdFor } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

function actorOf(orgId: string, userId: string): SavedViewActor {
  return { userId, orgId };
}

/** The ids of the organization's migrated states for the given keys, in the given order. */
function ids(orgId: string, ...keys: LegacyStatusKey[]): Promise<string[]> {
  return Promise.all(keys.map((key) => stateIdFor(orgId, key)));
}

/** The same ids sorted, the way a version 2 view stores them (12.1-10 frozen contract). */
async function sortedIds(orgId: string, ...keys: LegacyStatusKey[]): Promise<string[]> {
  return (await ids(orgId, ...keys)).sort();
}

function evidence(line: string) {
  console.log(`[11-03 evidence] ${line}`);
}

async function timed(promise: Promise<void>): Promise<number> {
  const started = Date.now();
  await promise;
  return Date.now() - started;
}

/** Creates a view through the service and returns its id (fails the test on a refusal). */
async function makeView(
  orgId: string,
  userId: string,
  name: string,
  visibility: "PRIVATE" | "SHARED",
  filters: Parameters<typeof createSavedView>[2]["filters"] = {},
): Promise<string> {
  const result = await createSavedView(prisma, actorOf(orgId, userId), {
    name,
    visibility,
    filters,
  });
  if (!result.ok) throw new Error(`makeView refused: ${result.error}`);
  return result.id;
}

function viewRow(id: string) {
  return prisma.savedView.findUnique({
    where: { id },
    select: {
      name: true,
      visibility: true,
      filters: true,
      position: true,
      ownerUserId: true,
    },
  });
}

/**
 * Forced order (Codex reviews C6, C7 and R2-2): the first call records pid1 in its own
 * onTransactionStart and holds in beforeCommit after it has written; only then the second call
 * starts and records pid2 in its own onTransactionStart. pid2 must be OBSERVED blocked by pid1
 * (pg_blocking_pids) before the first call is released, to commit or to throw the sentinel.
 */
async function forcedOrder<R1, R2>(
  label: string,
  outcome: "commit" | "rollback",
  runFirst: (hooks: SavedViewHooks) => Promise<R1>,
  runSecond: (hooks: SavedViewHooks) => Promise<R2>,
) {
  const SENTINEL = new Error(`${label}: first call rollback sentinel`);
  const pid1 = deferred<number>();
  const written = deferred<void>();
  const release = deferred<void>();
  const first = runFirst({
    async onTransactionStart(tx) {
      pid1.resolve(await backendPid(tx));
    },
    async beforeCommit() {
      written.resolve();
      await release.promise;
      if (outcome === "rollback") throw SENTINEL;
    },
  });
  first.catch(() => {});
  const p1 = await pid1.promise;
  // Fail fast if the first call settles without reaching beforeCommit.
  await Promise.race([
    written.promise,
    first.then((r) => {
      throw new Error(`${label}: first call settled before beforeCommit: ${JSON.stringify(r)}`);
    }),
  ]);

  const pid2 = deferred<number>();
  const second = runSecond({
    async onTransactionStart(tx) {
      pid2.resolve(await backendPid(tx));
    },
  });
  second.catch(() => {});
  const p2 = await pid2.promise;
  let observedBlocked = false;
  const waitMs = await timed(waitForBlockedBy(prisma, p1, [p2]));
  observedBlocked = true;
  evidence(
    `${label} (${outcome}): second (pid ${p2}) observed blocked by first (pid ${p1}) after ${waitMs} ms`,
  );
  release.resolve();

  return { first, second, SENTINEL, observedBlocked };
}

describe("saved views: a shared view crosses to every member of its organization (tracer)", () => {
  it("member A's SHARED view is listed for member B with its href", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [a, b] = users;

    const created = await createSavedView(prisma, actorOf(orgId, a.id), {
      name: "Open queue",
      visibility: "SHARED",
      filters: { stateIds: await ids(orgId, "OPEN") },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.href).toBe(`/tickets?sv=${created.id}&state=${await stateIdFor(orgId, "OPEN")}`);

    const listB = await listSavedViewsForViewer(prisma, actorOf(orgId, b.id));
    expect(listB.private).toEqual([]);
    expect(listB.shared).toEqual([
      {
        id: created.id,
        name: "Open queue",
        visibility: "SHARED",
        href: `/tickets?sv=${created.id}&state=${await stateIdFor(orgId, "OPEN")}`,
      },
    ]);

    const row = await prisma.savedView.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.filters).toEqual({
      version: 2,
      view: "all",
      stateIds: await sortedIds(orgId, "OPEN"),
    });
    expect(row.position).toBe(0);
    expect(row.ownerUserId).toBe(a.id);
  });

  it("A's PRIVATE view is in A's private list and absent from B's lists", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [a, b] = users;

    const created = await createSavedView(prisma, actorOf(orgId, a.id), {
      name: "My urgent",
      visibility: "PRIVATE",
      filters: { view: "mine", stateIds: await ids(orgId, "NEW", "OPEN"), q: "refund" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listA = await listSavedViewsForViewer(prisma, actorOf(orgId, a.id));
    expect(listA.private.map((v) => v.id)).toEqual([created.id]);
    expect(listA.private[0].href).toBe(
      `/tickets?sv=${created.id}&view=mine&state=${(await sortedIds(orgId, "NEW", "OPEN")).join("%2C")}&q=refund`,
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

describe("saved views: edit, delete and permissions (D-04)", () => {
  it("the owner edits name, filters and visibility of a private view", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const [o] = users;
    const id = await makeView(orgId, o.id, "Mine", "PRIVATE", {
      stateIds: await ids(orgId, "OPEN"),
    });

    const result = await updateSavedView(prisma, actorOf(orgId, o.id), id, {
      name: "  Mine renamed ",
      visibility: "PRIVATE",
      filters: { view: "unassigned", stateIds: await ids(orgId, "PENDING") },
    });
    expect(result).toEqual({
      ok: true,
      id,
      href: `/tickets?sv=${id}&view=unassigned&state=${await stateIdFor(orgId, "PENDING")}`,
    });
    expect(await viewRow(id)).toMatchObject({
      name: "Mine renamed",
      visibility: "PRIVATE",
      filters: { version: 2, view: "unassigned", stateIds: await sortedIds(orgId, "PENDING") },
    });

    const deleted = await deleteSavedView(prisma, actorOf(orgId, o.id), id);
    expect(deleted).toEqual({ ok: true, id });
    expect(await viewRow(id)).toBeNull();
  });

  it("another member's private view is NOT_FOUND for edit and delete, exactly like an unknown id", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "admin"]);
    const [o, admin] = users;
    const id = await makeView(orgId, o.id, "Secret", "PRIVATE", { q: "salary" });
    const input = { name: "Taken over", visibility: "PRIVATE" as const, filters: {} };

    const hidden = await updateSavedView(prisma, actorOf(orgId, admin.id), id, input);
    const unknown = await updateSavedView(prisma, actorOf(orgId, admin.id), "no-such-view", input);
    expect(hidden).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(unknown).toEqual(hidden);
    expect(await deleteSavedView(prisma, actorOf(orgId, admin.id), id)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await deleteSavedView(prisma, actorOf(orgId, admin.id), "no-such-view")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await viewRow(id)).toMatchObject({ name: "Secret", visibility: "PRIVATE" });
  });

  it("a member who is neither owner nor admin gets NOT_ALLOWED editing or deleting a shared view", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [o, other] = users;
    const id = await makeView(orgId, o.id, "Team", "SHARED", {
      stateIds: await ids(orgId, "OPEN"),
    });

    const edit = await updateSavedView(prisma, actorOf(orgId, other.id), id, {
      name: "Hijacked",
      visibility: "SHARED",
      filters: {},
    });
    expect(edit).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await deleteSavedView(prisma, actorOf(orgId, other.id), id)).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect(await viewRow(id)).toMatchObject({ name: "Team", visibility: "SHARED" });
  });

  it("an admin and an owner edit and delete another member's shared view but never change its visibility", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "admin", "owner"]);
    const [m, admin, owner] = users;
    const id = await makeView(orgId, m.id, "Team", "SHARED", {
      stateIds: await ids(orgId, "OPEN"),
    });

    const edit = await updateSavedView(prisma, actorOf(orgId, admin.id), id, {
      name: "Team (admin)",
      visibility: "SHARED",
      filters: { stateIds: await ids(orgId, "NEW") },
    });
    expect(edit.ok).toBe(true);
    expect(await viewRow(id)).toMatchObject({ name: "Team (admin)", ownerUserId: m.id });

    for (const actor of [admin, owner]) {
      const hide = await updateSavedView(prisma, actorOf(orgId, actor.id), id, {
        name: "Team (admin)",
        visibility: "PRIVATE",
        filters: { stateIds: await ids(orgId, "NEW") },
      });
      expect(hide).toEqual({ ok: false, error: "NOT_ALLOWED" });
    }
    expect(await viewRow(id)).toMatchObject({ visibility: "SHARED" });

    expect(await deleteSavedView(prisma, actorOf(orgId, owner.id), id)).toEqual({ ok: true, id });
    expect(await viewRow(id)).toBeNull();
  });

  it("PRIVATE to SHARED takes the next shared position; a rename into a used shared name is refused", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [o, other] = users;
    await makeView(orgId, other.id, "Shared one", "SHARED");
    await makeView(orgId, other.id, "Shared two", "SHARED");
    const id = await makeView(orgId, o.id, "Mine", "PRIVATE");
    expect((await viewRow(id))?.position).toBe(0);

    const share = await updateSavedView(prisma, actorOf(orgId, o.id), id, {
      name: "Mine",
      visibility: "SHARED",
      filters: {},
    });
    expect(share.ok).toBe(true);
    expect(await viewRow(id)).toMatchObject({ visibility: "SHARED", position: 2 });

    const clash = await updateSavedView(prisma, actorOf(orgId, o.id), id, {
      name: "SHARED ONE",
      visibility: "SHARED",
      filters: {},
    });
    expect(clash).toEqual({ ok: false, error: "DUPLICATE_SHARED_NAME" });
    expect(await viewRow(id)).toMatchObject({ name: "Mine", visibility: "SHARED", position: 2 });
  });

  it("refuses an invalid name and invalid filters", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(orgId, users[0].id);
    const open = await stateIdFor(orgId, "OPEN");
    for (const name of ["", "   ", "x".repeat(81)]) {
      expect(
        await createSavedView(prisma, actor, { name, visibility: "PRIVATE", filters: {} }),
      ).toEqual({
        ok: false,
        error: "INVALID_NAME",
      });
    }
    expect(
      await createSavedView(prisma, actor, {
        name: "x".repeat(80),
        visibility: "PRIVATE",
        filters: {},
      }),
    ).toMatchObject({ ok: true });
    for (const filters of [
      // Intended negative case: the pre-12.1 version 1 key, written literally, is refused and
      // never mapped (12.1 D-09: only version 2 is accepted; review IN-b2).
      { statuses: ["OPEN"] },
      { stateIds: [open, open] },
      { q: "x".repeat(201) },
      { unknownKey: 1 },
    ]) {
      expect(
        await createSavedView(prisma, actor, {
          name: "Bad filters",
          visibility: "PRIVATE",
          filters: filters as never,
        }),
      ).toEqual({ ok: false, error: "INVALID_FILTERS" });
    }
    // limit is page size, never stored.
    const id = await makeView(orgId, users[0].id, "With limit", "PRIVATE", { limit: 100 } as never);
    expect((await viewRow(id))?.filters).toEqual({ version: 2, view: "all", stateIds: [] });
  });

  it("refuses an unknown visibility with its own code, on create and on update (review IN-06)", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(orgId, users[0].id);
    for (const visibility of ["PUBLIC", "", null, "shared"]) {
      expect(
        await createSavedView(prisma, actor, {
          name: "Bad visibility",
          visibility: visibility as never,
          filters: {},
        }),
      ).toEqual({ ok: false, error: "INVALID_VISIBILITY" });
    }
    const id = await makeView(orgId, users[0].id, "Mine", "PRIVATE", {});
    expect(
      await updateSavedView(prisma, actor, id, {
        name: "Mine",
        visibility: "PUBLIC" as never,
        filters: {},
      }),
    ).toEqual({ ok: false, error: "INVALID_VISIBILITY" });
    expect(await viewRow(id)).toMatchObject({ name: "Mine", visibility: "PRIVATE" });
    expect(await prisma.savedView.count({ where: { organizationId: orgId } })).toBe(1);
  });
});

describe("saved views: references (D-05)", () => {
  it("refuses a tag of another organization and a deleted custom field with MISSING_REFERENCE", async () => {
    const x = await seedOrgWithMembers(prisma, ["member"]);
    const y = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(x.orgId, x.users[0].id);
    const foreignTag = await prisma.tag.create({ data: { organizationId: y.orgId, name: "vip" } });
    const def = await prisma.customFieldDefinition.create({
      data: { organizationId: x.orgId, label: "Plan", type: "TEXT" },
    });
    const id = await makeView(x.orgId, x.users[0].id, "By plan", "PRIVATE", {
      cf: { definitionId: def.id, value: "gold" },
    });
    await prisma.customFieldDefinition.delete({ where: { id: def.id } });

    expect(
      await createSavedView(prisma, actor, {
        name: "Foreign tag",
        visibility: "SHARED",
        filters: { tagId: foreignTag.id },
      }),
    ).toEqual({ ok: false, error: "MISSING_REFERENCE" });
    expect(
      await createSavedView(prisma, actor, {
        name: "Deleted field",
        visibility: "PRIVATE",
        filters: { cf: { definitionId: def.id, value: "gold" } },
      }),
    ).toEqual({ ok: false, error: "MISSING_REFERENCE" });
    expect(
      await updateSavedView(prisma, actor, id, {
        name: "By plan",
        visibility: "PRIVATE",
        filters: { cf: { definitionId: def.id, value: "gold" } },
      }),
    ).toEqual({ ok: false, error: "MISSING_REFERENCE" });
    expect(await prisma.savedView.count({ where: { organizationId: x.orgId } })).toBe(1);
  });
});

/** An admin-created state, inserted directly (never through plan 12.1-08's admin service). */
async function insertState(orgId: string, name: string) {
  const state = await prisma.ticketState.create({
    data: { organizationId: orgId, name, colorToken: "teal", group: "OPEN", sortOrder: 50 },
    select: { id: true },
  });
  return state.id;
}

/** A soft delete as a direct update of deletedAt (never through plan 12.1-08's service). */
async function softDeleteState(id: string) {
  await prisma.ticketState.update({ where: { id }, data: { deletedAt: new Date() } });
}

describe("saved views: state references (Phase 12.1, D-09, T-12.1-50, T-12.1-51)", () => {
  it("a view on two active states is created and stored as version 2 with the ids sorted", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const [open, pending] = await ids(orgId, "OPEN", "PENDING");
    const id = await makeView(orgId, users[0].id, "Two states", "PRIVATE", {
      stateIds: [pending, open].sort().reverse(),
    });
    expect((await viewRow(id))?.filters).toEqual({
      version: 2,
      view: "all",
      stateIds: [open, pending].sort(),
    });
  });

  it("refuses a soft-deleted, foreign, unknown or sentinel state id on create and update and stores nothing", async () => {
    const x = await seedOrgWithMembers(prisma, ["member"]);
    const y = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(x.orgId, x.users[0].id);
    const open = await stateIdFor(x.orgId, "OPEN");
    const deleted = await insertState(x.orgId, "Waiting on vendor");
    await softDeleteState(deleted);
    const foreign = await stateIdFor(y.orgId, "OPEN");
    const id = await makeView(x.orgId, x.users[0].id, "Open only", "PRIVATE", {
      stateIds: [open],
    });
    const before = await viewRow(id);

    const unknownIds = ["unknownstateid000000000", "not a state id!", LEGACY_UNMAPPED_STATE_ID];
    for (const missing of [deleted, foreign, ...unknownIds]) {
      expect(
        await createSavedView(prisma, actor, {
          name: `Missing ${missing}`,
          visibility: "SHARED",
          filters: { stateIds: [open, missing] },
        }),
      ).toEqual({ ok: false, error: "MISSING_REFERENCE" });
      expect(
        await updateSavedView(prisma, actor, id, {
          name: "Open only",
          visibility: "PRIVATE",
          filters: { stateIds: [missing] },
        }),
      ).toEqual({ ok: false, error: "MISSING_REFERENCE" });
    }
    expect(await prisma.savedView.count({ where: { organizationId: x.orgId } })).toBe(1);
    expect(await viewRow(id)).toEqual(before);
  });

  it("a view whose state is soft-deleted later keeps the id and reports missing.state, never widened", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(orgId, users[0].id);
    const open = await stateIdFor(orgId, "OPEN");
    const vendor = await insertState(orgId, "Waiting on vendor");
    const id = await makeView(orgId, users[0].id, "Vendor", "PRIVATE", {
      stateIds: [open, vendor],
    });
    const stored = [open, vendor].sort();
    const urlFilters = { stateIds: stored };
    expect(await getSavedViewForPanel(prisma, actor, id, urlFilters)).toMatchObject({
      status: "ok",
      state: "applied",
      missing: { state: false, tag: false, customField: false },
    });

    await softDeleteState(vendor);
    expect(await getSavedViewForPanel(prisma, actor, id, urlFilters)).toMatchObject({
      status: "ok",
      state: "applied",
      missing: { state: true, tag: false, customField: false },
      view: { filters: { version: 2, view: "all", stateIds: stored } },
    });
    // The stored row keeps the deleted id (D-09: never dropped, never widened).
    expect((await viewRow(id))?.filters).toEqual({ version: 2, view: "all", stateIds: stored });
  });
});

describe("saved views: opening a view in the panel (UI-SPEC Surface 2b)", () => {
  it("unknown id, deleted view and another member's private view are all not_available", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "owner"]);
    const [m, owner] = users;
    const priv = await makeView(orgId, m.id, "Secret", "PRIVATE", { q: "salary" });
    const gone = await makeView(orgId, m.id, "Gone", "SHARED");
    expect(await deleteSavedView(prisma, actorOf(orgId, m.id), gone)).toEqual({
      ok: true,
      id: gone,
    });

    const viewer = actorOf(orgId, owner.id);
    const results = [
      await getSavedViewForPanel(prisma, viewer, "no-such-view", {}),
      await getSavedViewForPanel(prisma, viewer, gone, {}),
      await getSavedViewForPanel(prisma, viewer, priv, {}),
    ];
    for (const r of results) expect(r).toEqual({ status: "not_available" });

    // A shared view of another organization is not_available too.
    const other = await seedOrgWithMembers(prisma, ["member"]);
    const foreign = await makeView(other.orgId, other.users[0].id, "Foreign", "SHARED");
    expect(await getSavedViewForPanel(prisma, viewer, foreign, {})).toEqual({
      status: "not_available",
    });
  });

  it("a visible view reports canEdit, isOwner, its filters, href and applied or changed", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member", "admin"]);
    const [o, m, admin] = users;
    const [open, neu] = await ids(orgId, "OPEN", "NEW");
    const id = await makeView(orgId, o.id, "Team", "SHARED", { stateIds: [open, neu] });
    const sorted = [open, neu].sort();
    const href = `/tickets?sv=${id}&state=${sorted.join("%2C")}`;
    // Version 2 stores the ids sorted; the href and filtersEqual use the same order.
    const filters = { version: 2, view: "all", stateIds: sorted };

    expect(
      await getSavedViewForPanel(prisma, actorOf(orgId, o.id), id, {
        stateIds: [open, neu],
        limit: 100,
      }),
    ).toEqual({
      status: "ok",
      view: { id, name: "Team", visibility: "SHARED", canEdit: true, isOwner: true, filters, href },
      state: "applied",
      missing: { state: false, tag: false, customField: false },
    });
    expect(
      await getSavedViewForPanel(prisma, actorOf(orgId, m.id), id, { stateIds: [open] }),
    ).toMatchObject({ status: "ok", view: { canEdit: false, isOwner: false }, state: "changed" });
    expect(
      await getSavedViewForPanel(prisma, actorOf(orgId, admin.id), id, {
        stateIds: [neu, open],
      }),
    ).toMatchObject({ status: "ok", view: { canEdit: true, isOwner: false }, state: "applied" });
  });

  it("reports a deleted tag and custom field as missing and keeps the filter", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(orgId, users[0].id);
    const tag = await prisma.tag.create({ data: { organizationId: orgId, name: "billing" } });
    const def = await prisma.customFieldDefinition.create({
      data: { organizationId: orgId, label: "Plan", type: "TEXT" },
    });
    const id = await makeView(orgId, users[0].id, "Billing gold", "PRIVATE", {
      tagId: tag.id,
      cf: { definitionId: def.id, value: "gold" },
    });
    const urlFilters = { tagId: tag.id, cf: { definitionId: def.id, value: "gold" } };
    expect(await getSavedViewForPanel(prisma, actor, id, urlFilters)).toMatchObject({
      status: "ok",
      state: "applied",
      missing: { state: false, tag: false, customField: false },
    });

    await prisma.tag.delete({ where: { id: tag.id } });
    await prisma.customFieldDefinition.delete({ where: { id: def.id } });
    const panel = await getSavedViewForPanel(prisma, actor, id, urlFilters);
    expect(panel).toMatchObject({
      status: "ok",
      state: "applied",
      missing: { state: false, tag: true, customField: true },
      view: { filters: { tagId: tag.id, cf: { definitionId: def.id, value: "gold" } } },
    });
    // Still listed, filters intact (D-05: never silently dropped).
    const list = await listSavedViewsForViewer(prisma, actor);
    expect(list.private.map((v) => v.id)).toEqual([id]);
    expect(list.private[0].href).toContain(`tag=${tag.id}`);
  });
});

describe("saved views: idempotency (AIDA-47)", () => {
  it("the same create twice leaves one view and returns DUPLICATE_*_NAME the second time", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(orgId, users[0].id);
    for (const [visibility, code] of [
      ["SHARED", "DUPLICATE_SHARED_NAME"],
      ["PRIVATE", "DUPLICATE_PRIVATE_NAME"],
    ] as const) {
      const input = {
        name: "Escalations",
        visibility,
        filters: { stateIds: await ids(orgId, "OPEN") },
      };
      const first = await createSavedView(prisma, actor, input);
      expect(first.ok).toBe(true);
      const before = await prisma.savedView.findMany({ where: { organizationId: orgId } });
      expect(await createSavedView(prisma, actor, input)).toEqual({ ok: false, error: code });
      expect(await prisma.savedView.findMany({ where: { organizationId: orgId } })).toEqual(before);
    }
    expect(
      await prisma.savedView.count({ where: { organizationId: orgId, name: "Escalations" } }),
    ).toBe(2);
  });

  it('" Urgent " then "urgent" in one owner\'s private views gives DUPLICATE_PRIVATE_NAME', async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(orgId, users[0].id);
    const first = await createSavedView(prisma, actor, {
      name: " Urgent ",
      visibility: "PRIVATE",
      filters: {},
    });
    expect(first.ok).toBe(true);
    expect(
      await createSavedView(prisma, actor, { name: "urgent", visibility: "PRIVATE", filters: {} }),
    ).toEqual({ ok: false, error: "DUPLICATE_PRIVATE_NAME" });
    const rows = await prisma.savedView.findMany({ where: { organizationId: orgId } });
    expect(rows.map((r) => r.name)).toEqual(["Urgent"]);
  });

  it("an edit with unchanged values returns ok and leaves name, visibility and filters equal", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const actor = actorOf(orgId, users[0].id);
    const input = {
      name: "Unchanged",
      visibility: "SHARED" as const,
      filters: { view: "mine" as const, stateIds: await ids(orgId, "OPEN"), q: "refund" },
    };
    const id = await makeView(orgId, users[0].id, input.name, input.visibility, input.filters);
    const before = await viewRow(id);
    const result = await updateSavedView(prisma, actor, id, input);
    expect(result).toEqual({
      ok: true,
      id,
      href: `/tickets?sv=${id}&view=mine&state=${await stateIdFor(orgId, "OPEN")}&q=refund`,
    });
    expect(await viewRow(id)).toEqual(before);
  });
});

describe("saved views: membership (D-01)", () => {
  it("every function refuses an actor whose member row was deleted, and changes nothing", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [gone, stays] = users;
    const own = await makeView(orgId, gone.id, "Own", "PRIVATE");
    const shared = await makeView(orgId, stays.id, "Team", "SHARED");
    await prisma.member.delete({ where: { id: gone.memberId } });
    const actor = actorOf(orgId, gone.id);
    const before = await prisma.savedView.findMany({
      where: { organizationId: orgId },
      orderBy: { id: "asc" },
    });

    expect(
      await createSavedView(prisma, actor, { name: "New", visibility: "SHARED", filters: {} }),
    ).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(
      await updateSavedView(prisma, actor, own, {
        name: "Own 2",
        visibility: "PRIVATE",
        filters: {},
      }),
    ).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await deleteSavedView(prisma, actor, own)).toEqual({
      ok: false,
      error: "MEMBERSHIP_ENDED",
    });
    expect(await deleteSavedView(prisma, actor, shared)).toEqual({
      ok: false,
      error: "MEMBERSHIP_ENDED",
    });
    await expect(listSavedViewsForViewer(prisma, actor)).rejects.toMatchObject({
      code: "MEMBERSHIP_ENDED",
    });
    await expect(getSavedViewForPanel(prisma, actor, shared, {})).rejects.toMatchObject({
      code: "MEMBERSHIP_ENDED",
    });

    expect(
      await prisma.savedView.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" } }),
    ).toEqual(before);
  });
});

describe("saved views: shared-name create race (AIDA-47, Codex review R2-2)", () => {
  async function createRace(outcome: "commit" | "rollback") {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [m1, m2] = users;
    const race = await forcedOrder(
      "shared-name create race",
      outcome,
      (hooks) =>
        createSavedView(
          prisma,
          actorOf(orgId, m1.id),
          { name: "Escalations", visibility: "SHARED", filters: {} },
          hooks,
        ),
      (hooks) =>
        createSavedView(
          prisma,
          actorOf(orgId, m2.id),
          { name: " escalations ", visibility: "SHARED", filters: {} },
          hooks,
        ),
    );
    return { orgId, m1, m2, ...race };
  }

  async function sharedNamed(orgId: string) {
    return prisma.savedView.findMany({
      where: {
        organizationId: orgId,
        visibility: "SHARED",
        name: { equals: "escalations", mode: "insensitive" },
      },
    });
  }

  it("first commits: the second create, observed blocked, returns DUPLICATE_SHARED_NAME", async () => {
    const { orgId, m1, first, second, observedBlocked } = await createRace("commit");
    expect(observedBlocked).toBe(true);
    const r1 = await first;
    expect(r1.ok).toBe(true);
    expect(await second).toEqual({ ok: false, error: "DUPLICATE_SHARED_NAME" });
    const rows = await sharedNamed(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Escalations", ownerUserId: m1.id });
  });

  it("first rolls back: the first rejects with its sentinel and the second's view is the one", async () => {
    const { orgId, m2, first, second, SENTINEL, observedBlocked } = await createRace("rollback");
    expect(observedBlocked).toBe(true);
    await expect(first).rejects.toBe(SENTINEL);
    expect((await second).ok).toBe(true);
    const rows = await sharedNamed(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "escalations", ownerUserId: m2.id });
  });
});

describe("saved views: concurrent edit race (AIDA-47, Codex review R2-2)", () => {
  async function editRace(outcome: "commit" | "rollback") {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "admin"]);
    const [o, admin] = users;
    const [neu, open, pending] = await ids(orgId, "NEW", "OPEN", "PENDING");
    const id = await makeView(orgId, o.id, "Escalations", "SHARED", { stateIds: [neu] });
    const race = await forcedOrder(
      "concurrent edit race",
      outcome,
      (hooks) =>
        updateSavedView(
          prisma,
          actorOf(orgId, o.id),
          id,
          { name: "Escalations A", visibility: "SHARED", filters: { stateIds: [open] } },
          hooks,
        ),
      (hooks) =>
        updateSavedView(
          prisma,
          actorOf(orgId, admin.id),
          id,
          { name: "Escalations B", visibility: "SHARED", filters: { stateIds: [pending] } },
          hooks,
        ),
    );
    return { id, pending, ...race };
  }

  it("first commits: both return ok and the row holds the second's complete payload", async () => {
    const { id, pending, first, second, observedBlocked } = await editRace("commit");
    expect(observedBlocked).toBe(true);
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(await viewRow(id)).toMatchObject({
      name: "Escalations B",
      visibility: "SHARED",
      filters: { version: 2, view: "all", stateIds: [pending] },
    });
  });

  it("first rolls back: the first rejects with its sentinel and the row holds the second's payload", async () => {
    const { id, pending, first, second, SENTINEL, observedBlocked } = await editRace("rollback");
    expect(observedBlocked).toBe(true);
    await expect(first).rejects.toBe(SENTINEL);
    expect((await second).ok).toBe(true);
    expect(await viewRow(id)).toMatchObject({
      name: "Escalations B",
      visibility: "SHARED",
      filters: { version: 2, view: "all", stateIds: [pending] },
    });
  });
});

describe("saved views: permission under a concurrent visibility change (Codex review C7)", () => {
  async function setup() {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "admin"]);
    const [o, admin] = users;
    // O already has one private view, so O's next private position is 1.
    await makeView(orgId, o.id, "Older private", "PRIVATE");
    const id = await makeView(orgId, o.id, "Escalations", "SHARED", {
      stateIds: await ids(orgId, "OPEN"),
    });
    const ownerPayload = {
      name: "Escalations",
      visibility: "PRIVATE" as const,
      filters: { stateIds: await ids(orgId, "OPEN") },
    };
    const adminPayload = {
      name: "Escalations (admin)",
      visibility: "SHARED" as const,
      filters: { stateIds: await ids(orgId, "PENDING") },
    };
    return { orgId, o, admin, id, ownerPayload, adminPayload };
  }

  it("owner first: the admin's edit waits for the owner's commit and is refused with NOT_FOUND", async () => {
    const { orgId, o, admin, id, ownerPayload, adminPayload } = await setup();
    const { first, second, observedBlocked } = await forcedOrder(
      "C7 owner first",
      "commit",
      (hooks) => updateSavedView(prisma, actorOf(orgId, o.id), id, ownerPayload, hooks),
      (hooks) => updateSavedView(prisma, actorOf(orgId, admin.id), id, adminPayload, hooks),
    );
    expect(observedBlocked).toBe(true);
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await viewRow(id)).toMatchObject({
      name: "Escalations",
      visibility: "PRIVATE",
      filters: { version: 2, view: "all", stateIds: await sortedIds(orgId, "OPEN") },
      position: 1,
    });
  });

  it("admin first: the owner's change waits for the admin's commit and its full payload wins", async () => {
    const { orgId, o, admin, id, ownerPayload, adminPayload } = await setup();
    const { first, second, observedBlocked } = await forcedOrder(
      "C7 admin first",
      "commit",
      (hooks) => updateSavedView(prisma, actorOf(orgId, admin.id), id, adminPayload, hooks),
      (hooks) => updateSavedView(prisma, actorOf(orgId, o.id), id, ownerPayload, hooks),
    );
    expect(observedBlocked).toBe(true);
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(await viewRow(id)).toMatchObject({
      name: "Escalations",
      visibility: "PRIVATE",
      filters: { version: 2, view: "all", stateIds: await sortedIds(orgId, "OPEN") },
      position: 1,
    });
  });
});
