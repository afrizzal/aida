// Phase 12, plan 12-02 Task 3: the ticket picker used by the link and merge dialogs (AIDA-52,
// D-01, UI-SPEC 2c). Real Postgres through Testcontainers. The service is called directly and the
// route handler is called with a real Better Auth session cookie from an in-process sign-in.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET as pickerGet } from "@/app/api/tickets/picker/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { searchTickets, type TicketSearchRow } from "@/lib/tickets/search";
import {
  PICKER_RESULT_LIMIT,
  type PickerActor,
  searchTicketsForPicker,
} from "@/lib/tickets/ticket-picker";
import {
  seedContactTicket,
  seedOrgWithMembers,
  seedRelation,
  seedTicket,
} from "../support/lifecycle-fixtures";

const ROW_KEYS = [
  "alreadyLinked",
  "id",
  "mergedSource",
  "number",
  "sameContact",
  "status",
  "subject",
];

/** A letters-only word that no other ticket in the database contains. */
function uniqueWord(): string {
  return `zq${randomUUID()
    .replace(/-/g, "")
    .replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)])}`;
}

async function ticketWithSubject(orgId: string, subject: string) {
  const t = await seedTicket(orgId);
  await prisma.ticket.update({ where: { id: t.id }, data: { subject } });
  return t;
}

function recorder() {
  const calls: { orgId: string; q: string; limit: number | undefined }[] = [];
  const search = async (orgId: string, q: string, limit?: number): Promise<TicketSearchRow[]> => {
    calls.push({ orgId, q, limit });
    return searchTickets(orgId, q, limit);
  };
  return { calls, search };
}

async function memberActor(): Promise<{ orgId: string; actor: PickerActor; memberId: string }> {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
  return { orgId, actor: { userId: users[0].id, orgId }, memberId: users[0].memberId };
}

/** Signs a real user in through Better Auth and returns the Cookie header the browser would send. */
async function signedInMember(): Promise<{ orgId: string; cookie: string; userId: string }> {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, name: "Picker Org", slug: `picker-${orgId}`, createdAt: new Date() },
  });
  const email = `picker-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const signUp = await auth.api.signUpEmail({ body: { name: "Picker Agent", email, password } });
  const userId = signUp.user.id;
  await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      userId,
      role: "member",
      createdAt: new Date(),
    },
  });
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token");
  return { orgId, cookie, userId };
}

function pickerRequest(params: Record<string, string>, cookie?: string): Request {
  const url = new URL("http://localhost/api/tickets/picker");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, { headers: cookie ? { cookie } : {} });
}

describe("searchTicketsForPicker (AIDA-52, D-01)", () => {
  it('"#N" and "N" find the ticket by number, also for one digit, never the current ticket', async () => {
    const { orgId, actor } = await memberActor();
    const current = await seedTicket(orgId);
    const other = await seedTicket(orgId);
    // Fresh organization: tickets are numbered from 1, so the second one has a one-digit number.
    expect(other.number).toBeLessThan(10);

    for (const q of [`#${other.number}`, `${other.number}`]) {
      const result = await searchTicketsForPicker(prisma, actor, {
        q,
        ticketId: current.id,
        purpose: "link",
      });
      expect(result.ok && result.results.map((r) => r.id)).toEqual([other.id]);
    }
    const self = await searchTicketsForPicker(prisma, actor, {
      q: `#${current.number}`,
      ticketId: current.id,
      purpose: "merge",
    });
    expect(self).toEqual({ ok: true, results: [] });
  });

  it("a 1-character non-digit query returns nothing without searching; 2+ characters use searchTickets", async () => {
    const { orgId, actor } = await memberActor();
    const current = await seedTicket(orgId);
    const word = uniqueWord();
    const match = await ticketWithSubject(orgId, `Refund ${word}`);
    const { calls, search } = recorder();

    for (const q of ["", " ", "a", "#", "  b  "]) {
      expect(
        await searchTicketsForPicker(
          prisma,
          actor,
          { q, ticketId: current.id, purpose: "link" },
          {
            search,
          },
        ),
      ).toEqual({ ok: true, results: [] });
    }
    expect(calls).toHaveLength(0);

    const result = await searchTicketsForPicker(
      prisma,
      actor,
      { q: word, ticketId: current.id, purpose: "link" },
      { search },
    );
    expect(calls).toEqual([{ orgId, q: word, limit: 11 }]);
    expect(result.ok && result.results.map((r) => r.id)).toEqual([match.id]);
  });

  it("returns at most 10 rows and excludes the current ticket even when it matches", async () => {
    const { orgId, actor } = await memberActor();
    const word = uniqueWord();
    const current = await ticketWithSubject(orgId, `Outage ${word} current`);
    for (let i = 0; i < 12; i++) await ticketWithSubject(orgId, `Outage ${word} ${i}`);

    const result = await searchTicketsForPicker(prisma, actor, {
      q: word,
      ticketId: current.id,
      purpose: "link",
    });
    expect(PICKER_RESULT_LIMIT).toBe(10);
    expect(result.ok && result.results).toHaveLength(10);
    expect(result.ok && result.results.some((r) => r.id === current.id)).toBe(false);
  });

  it("rows hold exactly the seven fields, with alreadyLinked, sameContact and mergedSource set from the data", async () => {
    const { orgId, actor } = await memberActor();
    const email = `same-${randomUUID()}@example.test`;
    const current = await seedContactTicket(orgId, { contactEmail: email });
    const sameContact = await seedContactTicket(orgId, { contactEmail: email });
    const linked = await seedTicket(orgId);
    const target = await seedTicket(orgId);
    const merged = await seedTicket(orgId);
    // linked -> current (the reverse direction still counts as a link of the pair)
    await seedRelation(prisma, orgId, {
      type: "RELATED_TO",
      fromTicketId: linked.id,
      toTicketId: current.id,
      createdById: actor.userId,
    });
    await prisma.ticket.update({
      where: { id: merged.id },
      data: {
        mergedIntoTicketId: target.id,
        mergedAt: new Date(),
        mergeMessageSeq: BigInt(1),
        status: "CLOSED",
      },
    });

    const byNumber = async (n: number) => {
      const r = await searchTicketsForPicker(prisma, actor, {
        q: `#${n}`,
        ticketId: current.id,
        purpose: "merge",
      });
      if (!r.ok) throw new Error("expected ok");
      expect(r.results).toHaveLength(1);
      expect(Object.keys(r.results[0]).sort()).toEqual(ROW_KEYS);
      return r.results[0];
    };

    expect(await byNumber(sameContact.number)).toMatchObject({
      id: sameContact.id,
      alreadyLinked: false,
      sameContact: true,
      mergedSource: false,
    });
    expect(await byNumber(linked.number)).toMatchObject({
      alreadyLinked: true,
      sameContact: false,
      mergedSource: false,
    });
    expect(await byNumber(merged.number)).toMatchObject({
      alreadyLinked: false,
      sameContact: false,
      mergedSource: true,
      status: "CLOSED",
    });
    expect(await byNumber(target.number)).toMatchObject({
      alreadyLinked: false,
      sameContact: false,
      mergedSource: false,
    });
  });

  it("never returns another organization's ticket by number or by word", async () => {
    const x = await memberActor();
    const y = await memberActor();
    const word = uniqueWord();
    const current = await seedTicket(x.orgId);
    await ticketWithSubject(y.orgId, `Invoice ${word}`);
    const foreign = await seedTicket(y.orgId);
    const own = await ticketWithSubject(x.orgId, `Invoice ${word}`);

    const byWord = await searchTicketsForPicker(prisma, x.actor, {
      q: word,
      ticketId: current.id,
      purpose: "link",
    });
    expect(byWord.ok && byWord.results.map((r) => r.id)).toEqual([own.id]);

    const byNumber = await searchTicketsForPicker(prisma, x.actor, {
      q: `#${foreign.number}`,
      ticketId: current.id,
      purpose: "link",
    });
    expect(byNumber.ok && byNumber.results.every((r) => r.id !== foreign.id)).toBe(true);
  });

  it("refuses MEMBERSHIP_ENDED without searching, and TICKET_NOT_FOUND for an unknown or foreign current ticket", async () => {
    const x = await memberActor();
    const y = await memberActor();
    const own = await seedTicket(x.orgId);
    const foreign = await seedTicket(y.orgId);
    const { calls, search } = recorder();

    for (const ticketId of [randomUUID(), foreign.id]) {
      expect(
        await searchTicketsForPicker(
          prisma,
          x.actor,
          { q: "refund", ticketId, purpose: "link" },
          { search },
        ),
      ).toEqual({ ok: false, error: "TICKET_NOT_FOUND" });
    }

    await prisma.member.delete({ where: { id: x.memberId } });
    expect(
      await searchTicketsForPicker(
        prisma,
        x.actor,
        { q: "refund", ticketId: own.id, purpose: "link" },
        { search },
      ),
    ).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(calls).toHaveLength(0);
  });
});

describe("GET /api/tickets/picker", () => {
  it("answers 401 without a session", async () => {
    const res = await pickerGet(pickerRequest({ q: "12", ticketId: randomUUID() }));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns the picker rows for a signed-in member, 404 for unknown and foreign tickets, 403 after the member row is deleted", async () => {
    const { orgId, cookie, userId } = await signedInMember();
    const current = await seedTicket(orgId);
    const other = await seedTicket(orgId);
    const otherOrg = await memberActor();
    const foreign = await seedTicket(otherOrg.orgId);

    const ok = await pickerGet(
      pickerRequest({ q: `#${other.number}`, ticketId: current.id, purpose: "link" }, cookie),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    const body = (await ok.json()) as { results: Record<string, unknown>[] };
    expect(body.results.map((r) => r.id)).toEqual([other.id]);
    expect(Object.keys(body.results[0]).sort()).toEqual(ROW_KEYS);

    for (const ticketId of [randomUUID(), foreign.id]) {
      const res = await pickerGet(pickerRequest({ q: "12", ticketId }, cookie));
      expect(res.status).toBe(404);
    }

    await prisma.member.deleteMany({ where: { userId, organizationId: orgId } });
    const ended = await pickerGet(pickerRequest({ q: "12", ticketId: current.id }, cookie));
    expect(ended.status).toBe(403);
    expect(await ended.json()).toEqual({ error: "membership_ended" });
  });
});
