// Phase 12.1, plan 12.1-05 (D-13, D-11 Public status page row): the public status loader exposes
// only the group of the ticket's state, never the state's name, id or colour key. Plan 12.1-09
// extends this file with the page and CSAT cases. Real Postgres through Testcontainers; nothing
// is mocked.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// A test-only value; the public routes hash rate-limit identifiers with it (set before the route
// module loads, as merge-provenance.test.ts does).
vi.hoisted(() => {
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "public-state-label-test";
});

import { POST as csatPost } from "@/app/api/public/status/[token]/csat/route";
import { prisma } from "@/lib/db";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { setCsatWriteObserverForTests } from "@/lib/tickets/record-csat";
import { loadStatusPageData } from "@/lib/tickets/status-page-data";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

async function tokenOf(ticketId: string): Promise<string> {
  const { statusToken } = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  return statusToken;
}

/** Posts a CSAT rating through the real public route handler; returns status and error code. */
async function postCsat(token: string, score = 5): Promise<{ status: number; error?: string }> {
  const form = new FormData();
  form.set("score", String(score));
  const response = await csatPost(
    new Request(`http://localhost/api/public/status/${token}/csat`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": `public-state-label-${randomUUID()}` },
    }),
    { params: Promise.resolve({ token }) },
  );
  const body = (await response.json()) as { error?: string };
  return { status: response.status, error: body.error };
}

async function csatRows(ticketId: string): Promise<number> {
  return prisma.csatResponse.count({ where: { ticketId } });
}

describe("loadStatusPageData returns the group only (D-13)", () => {
  it("a ticket in an admin OPEN state 'Waiting on engineering' reaches the public side as group OPEN, without name, id or colour", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const waiting = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: "Waiting on engineering",
        colorToken: "orange",
        group: "OPEN",
        sortOrder: 5,
      },
    });
    const t = await seedTicket(orgId, { stateId: waiting.id });

    const data = await loadStatusPageData(await tokenOf(t.id));
    expect(data).not.toBeNull();
    expect(data?.group).toBe("OPEN");
    expect(data?.merged).toBe(false);
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("state");
    expect(data).not.toHaveProperty("stateId");

    const json = JSON.stringify(data);
    expect(json).not.toContain("Waiting on engineering");
    expect(json).not.toContain(waiting.id);
    expect(json).not.toContain("orange");
    expect(json).not.toContain("colorToken");
  });

  it("a ticket in New reaches the public side as group OPEN, without the state name", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const t = await seedTicket(orgId, { status: "NEW" });

    const data = await loadStatusPageData(await tokenOf(t.id));
    expect(data?.group).toBe("OPEN");
    const json = JSON.stringify(data);
    expect(json).not.toContain(await stateIdFor(orgId, "NEW"));
    expect(json).not.toContain('"New"');
  });

  it.each([
    ["PENDING", "PENDING"],
    ["RESOLVED", "RESOLVED"],
    ["CLOSED", "CLOSED"],
  ] as const)("a ticket in the %s state returns group %s", async (key, group) => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const t = await seedTicket(orgId, {
      status: key,
      resolvedAt: key === "PENDING" ? null : new Date(),
    });

    const data = await loadStatusPageData(await tokenOf(t.id));
    expect(data?.group).toBe(group);
    expect(JSON.stringify(data)).not.toContain(await stateIdFor(orgId, key));
  });

  it("a merged source (seeded directly) returns merged true and group CLOSED", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const source = await seedTicket(orgId, { status: "OPEN" });
    const target = await seedTicket(orgId, { status: "OPEN" });
    const closedId = await stateIdFor(orgId, "CLOSED");
    // One direct update, never the merge service (plan 12.1-07 migrates it): the three merge
    // fields together (Ticket_merge_fields_check) and the organization's Closed state.
    await prisma.ticket.update({
      where: { id: source.id },
      data: {
        mergedIntoTicketId: target.id,
        mergedAt: new Date(),
        mergeMessageSeq: 1n,
        stateId: closedId,
        resolvedAt: new Date(),
      },
    });

    const data = await loadStatusPageData(await tokenOf(source.id));
    expect(data?.merged).toBe(true);
    expect(data?.group).toBe("CLOSED");
    expect(data?.ticketId).toBe(source.id);
    const json = JSON.stringify(data);
    expect(json).not.toContain(closedId);
    expect(json).not.toContain(target.id);
  });
});

describe("the CSAT route decides eligibility by the group of the state (D-11 CSAT row, D-02)", () => {
  it("a ticket in an admin RESOLVED-group state 'Solved by phone' accepts a rating: 200 and one CsatResponse row", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const solved = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: "Solved by phone",
        colorToken: "green",
        group: "RESOLVED",
        sortOrder: 6,
      },
    });
    const t = await seedTicket(orgId, { stateId: solved.id, resolvedAt: new Date() });

    expect(await postCsat(await tokenOf(t.id), 4)).toEqual({ status: 200, error: undefined });
    const rows = await prisma.csatResponse.findMany({ where: { ticketId: t.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe(4);
  });

  it("a ticket in an admin OPEN-group state is refused with 409 not_eligible and no row", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const waiting = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: "Waiting on engineering",
        colorToken: "orange",
        group: "OPEN",
        sortOrder: 5,
      },
    });
    const t = await seedTicket(orgId, { stateId: waiting.id });

    expect(await postCsat(await tokenOf(t.id))).toEqual({ status: 409, error: "not_eligible" });
    expect(await csatRows(t.id)).toBe(0);
  });
});

describe("CSAT eligibility for every group, merged sources and the data boundary (plan 12.1-09)", () => {
  async function adminState(
    orgId: string,
    group: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED",
    name: string,
    colorToken: string,
  ) {
    return prisma.ticketState.create({
      data: { organizationId: orgId, name, colorToken, group, sortOrder: 7 },
    });
  }

  it.each([
    ["New", "NEW"],
    ["Open", "OPEN"],
    ["Pending", "PENDING"],
    ["an admin PENDING-group state", "admin"],
  ] as const)("a ticket in %s is refused with 409 not_eligible and no row", async (_label, key) => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const t =
      key === "admin"
        ? await seedTicket(orgId, {
            stateId: (await adminState(orgId, "PENDING", "Waiting on customer docs", "amber")).id,
          })
        : await seedTicket(orgId, { status: key });

    expect(await postCsat(await tokenOf(t.id))).toEqual({ status: 409, error: "not_eligible" });
    expect(await csatRows(t.id)).toBe(0);
  });

  it.each([
    ["Resolved", "RESOLVED"],
    ["Closed", "CLOSED"],
    ["an admin CLOSED-group state", "admin"],
  ] as const)("a ticket in %s accepts a rating: 200 and one row", async (_label, key) => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const t =
      key === "admin"
        ? await seedTicket(orgId, {
            stateId: (await adminState(orgId, "CLOSED", "Closed as duplicate", "gray")).id,
            resolvedAt: new Date(),
          })
        : await seedTicket(orgId, { status: key, resolvedAt: new Date() });

    expect(await postCsat(await tokenOf(t.id), 3)).toEqual({ status: 200, error: undefined });
    expect(await csatRows(t.id)).toBe(1);
  });

  it("a merged source (seeded directly) is group CLOSED and merged, and its CSAT stays its own", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const source = await seedTicket(orgId, { status: "OPEN" });
    const target = await seedTicket(orgId, { status: "OPEN" });
    const { contactId } = await prisma.ticket.findUniqueOrThrow({
      where: { id: source.id },
      select: { contactId: true },
    });
    await prisma.ticket.update({ where: { id: target.id }, data: { contactId } });
    // One direct update, never the merge service (plan 12.1-07 migrates it): the three merge
    // fields together (Ticket_merge_fields_check) and the organization's Closed state.
    await prisma.ticket.update({
      where: { id: source.id },
      data: {
        mergedIntoTicketId: target.id,
        mergedAt: new Date(),
        mergeMessageSeq: 1n,
        stateId: await stateIdFor(orgId, "CLOSED"),
        resolvedAt: new Date(),
      },
    });

    const sToken = await tokenOf(source.id);
    const data = await loadStatusPageData(sToken);
    expect(data?.merged).toBe(true);
    expect(data?.group).toBe("CLOSED");

    expect(await postCsat(sToken, 5)).toEqual({ status: 200, error: undefined });
    const row = await prisma.csatResponse.findUnique({ where: { ticketId: source.id } });
    expect(row?.score).toBe(5);
    expect(await csatRows(target.id)).toBe(0);
    expect((await loadStatusPageData(sToken))?.csat).toEqual({ score: 5, comment: null });
  });

  it.each([
    ["OPEN", "teal"],
    ["PENDING", "pink"],
    ["RESOLVED", "purple"],
    ["CLOSED", "amber"],
  ] as const)("the loader result of a ticket in an admin %s state carries no marker name, state id or colour key", async (group, colour) => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const marker = `Internal-marker-${randomUUID().slice(0, 13)}`; // 29 chars (name check: 1 to 40)
    const state = await adminState(orgId, group, marker, colour);
    const t = await seedTicket(orgId, {
      stateId: state.id,
      resolvedAt: group === "RESOLVED" || group === "CLOSED" ? new Date() : null,
    });

    const data = await loadStatusPageData(await tokenOf(t.id));
    expect(data?.group).toBe(group);
    const json = JSON.stringify(data);
    expect(json).not.toContain(marker);
    expect(json).not.toContain("Internal-marker");
    expect(json).not.toContain(state.id);
    expect(json).not.toContain(colour);
    expect(json).not.toContain("colorToken");
    expect(json).not.toContain("stateId");
  });
});

// Codex diff critique D3: the CSAT write locks the ticket row and checks the group again in the
// transaction of the upsert. Both orders against a reopen, every wait bound to recorded backend
// PIDs (tests/support/lock-wait.ts), never to a timer.
describe("CSAT against a reopen, in both lock orders (D-11 CSAT row)", () => {
  afterEach(() => {
    setCsatWriteObserverForTests(null);
  });

  async function resolvedTicket() {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
    const t = await seedTicket(orgId, { status: "RESOLVED" });
    return {
      actor: { orgId, userId: users[0].id },
      ticketId: t.id,
      token: await tokenOf(t.id),
      openId: await stateIdFor(orgId, "OPEN"),
    };
  }

  const groupOf = async (id: string) =>
    (
      await prisma.ticket.findUniqueOrThrow({
        where: { id },
        select: { state: { select: { group: true } } },
      })
    ).state.group;

  it("reopen holds the ticket first: the rating waits, sees group OPEN and is refused with 409 and no row", async () => {
    const { actor, ticketId, token, openId } = await resolvedTicket();
    const reopenPid = deferred<number>();
    const reopenChanged = deferred();
    const releaseReopen = deferred();
    const csatPid = deferred<number>();

    const reopen = runTicketMutation(
      { actor, ticketIds: [ticketId], op: { kind: "state", stateId: openId }, mode: "single" },
      {
        onTransactionStart: async (tx) => reopenPid.resolve(await backendPid(tx)),
        afterItem: async () => {
          reopenChanged.resolve();
          await releaseReopen.promise;
        },
      },
    );
    await reopenChanged.promise;

    setCsatWriteObserverForTests({
      onTransactionStart: async (tx) => csatPid.resolve(await backendPid(tx)),
    });
    const rating = postCsat(token, 4);
    await waitForBlockedBy(prisma, await reopenPid.promise, [await csatPid.promise]);
    releaseReopen.resolve();

    expect(await reopen).toMatchObject({ ok: true, count: 1 });
    expect(await rating).toEqual({ status: 409, error: "not_eligible" });
    expect(await csatRows(ticketId)).toBe(0);
    expect(await groupOf(ticketId)).toBe("OPEN");
  });

  it("the rating holds the ticket first: the reopen waits, and the rating is stored with 200", async () => {
    const { actor, ticketId, token, openId } = await resolvedTicket();
    const csatPid = deferred<number>();
    const releaseCsat = deferred();
    const reopenPid = deferred<number>();

    setCsatWriteObserverForTests({
      afterTicketLock: async (tx) => {
        csatPid.resolve(await backendPid(tx));
        await releaseCsat.promise;
      },
    });
    const rating = postCsat(token, 4);
    const holder = await csatPid.promise;

    const reopen = runTicketMutation(
      { actor, ticketIds: [ticketId], op: { kind: "state", stateId: openId }, mode: "single" },
      { onTransactionStart: async (tx) => reopenPid.resolve(await backendPid(tx)) },
    );
    await waitForBlockedBy(prisma, holder, [await reopenPid.promise]);
    releaseCsat.resolve();

    expect(await rating).toEqual({ status: 200, error: undefined });
    expect(await reopen).toMatchObject({ ok: true, count: 1 });
    const row = await prisma.csatResponse.findUniqueOrThrow({ where: { ticketId } });
    expect(row.score).toBe(4);
    expect(await groupOf(ticketId)).toBe("OPEN");
  });
});
