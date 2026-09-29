// Phase 11, plan 11-03: the palette's ticket search (AIDA-49, D-12), on a real Postgres through
// Testcontainers. Nothing is mocked: the recorder passed as the search dependency calls the real
// searchTickets and only records its arguments and result.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  PALETTE_MAX_QUERY_LENGTH,
  PALETTE_RESULT_LIMIT,
  searchTicketsForPalette,
} from "@/lib/tickets/palette-search";
import { searchTickets, type TicketSearchRow } from "@/lib/tickets/search";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

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
  const calls: { orgId: string; q: string; limit: number | undefined; rows: TicketSearchRow[] }[] =
    [];
  const search = async (orgId: string, q: string, limit?: number) => {
    const rows = await searchTickets(orgId, q, limit);
    calls.push({ orgId, q, limit, rows });
    return rows;
  };
  return { calls, search };
}

describe("searchTicketsForPalette (D-12)", () => {
  it("returns the organization's matching ticket with only id, number, subject, stateName and colorToken", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const word = uniqueWord();
    const t = await ticketWithSubject(orgId, `Printer ${word} jammed`);

    const result = await searchTicketsForPalette(prisma, { userId: users[0].id, orgId }, word);
    expect(result).toEqual({
      ok: true,
      results: [
        {
          id: t.id,
          number: t.number,
          subject: `Printer ${word} jammed`,
          stateName: "New",
          colorToken: "indigo-filled",
        },
      ],
    });
    if (result.ok)
      expect(Object.keys(result.results[0]).sort()).toEqual([
        "colorToken",
        "id",
        "number",
        "stateName",
        "subject",
      ]);
  });

  it("returns the state of the ticket's own organization, and another organization never sees the ticket or its state name (Phase 12.1, D-11 palette row)", async () => {
    const x = await seedOrgWithMembers(prisma, ["member"]);
    const y = await seedOrgWithMembers(prisma, ["member"]);
    const word = uniqueWord();
    const stateName = `Waiting ${word.slice(0, 14)}`;
    const vendor = await prisma.ticketState.create({
      data: {
        organizationId: x.orgId,
        name: stateName,
        colorToken: "orange",
        group: "PENDING",
        sortOrder: 5,
      },
    });
    const own = await seedTicket(x.orgId, { stateId: vendor.id });
    await prisma.ticket.update({ where: { id: own.id }, data: { subject: `Courier ${word}` } });
    const other = await ticketWithSubject(y.orgId, `Courier ${word}`);

    const forX = await searchTicketsForPalette(
      prisma,
      { userId: x.users[0].id, orgId: x.orgId },
      word,
    );
    expect(forX).toEqual({
      ok: true,
      results: [
        {
          id: own.id,
          number: own.number,
          subject: `Courier ${word}`,
          stateName,
          colorToken: "orange",
        },
      ],
    });

    const forY = await searchTicketsForPalette(
      prisma,
      { userId: y.users[0].id, orgId: y.orgId },
      word,
    );
    expect(forY.ok && forY.results.map((r) => [r.id, r.stateName])).toEqual([[other.id, "New"]]);

    const notInY = await searchTicketsForPalette(
      prisma,
      { userId: y.users[0].id, orgId: y.orgId },
      stateName,
    );
    expect(
      notInY.ok && notInY.results.some((r) => r.id === own.id || r.stateName === stateName),
    ).toBe(false);
  });

  it("never returns another organization's ticket with the same word", async () => {
    const x = await seedOrgWithMembers(prisma, ["member"]);
    const y = await seedOrgWithMembers(prisma, ["member"]);
    const word = uniqueWord();
    const own = await ticketWithSubject(x.orgId, `Refund ${word}`);
    await ticketWithSubject(y.orgId, `Refund ${word}`);

    const result = await searchTicketsForPalette(
      prisma,
      { userId: x.users[0].id, orgId: x.orgId },
      word,
    );
    expect(result.ok && result.results.map((r) => r.id)).toEqual([own.id]);
  });

  it("fifteen matching tickets give at most 10 results, in searchTickets order", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const word = uniqueWord();
    for (let i = 0; i < 15; i++) await ticketWithSubject(orgId, `Outage ${word} report ${i}`);
    const { calls, search } = recorder();

    const result = await searchTicketsForPalette(prisma, { userId: users[0].id, orgId }, word, {
      search,
    });
    expect(PALETTE_RESULT_LIMIT).toBe(10);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ orgId, q: word, limit: 10 });
    expect(calls[0].rows).toHaveLength(10);
    expect(result.ok && result.results.map((r) => r.id)).toEqual(calls[0].rows.map((r) => r.id));
  });

  it("returns no rows without querying under 2 characters, and cuts a 250-character query to 200", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const actor = { userId: users[0].id, orgId };
    const { calls, search } = recorder();

    for (const q of ["", " ", "a", "  b  "]) {
      expect(await searchTicketsForPalette(prisma, actor, q, { search })).toEqual({
        ok: true,
        results: [],
      });
    }
    expect(calls).toHaveLength(0);

    const long = `  ${"x".repeat(250)}  `;
    expect(await searchTicketsForPalette(prisma, actor, long, { search })).toEqual({
      ok: true,
      results: [],
    });
    expect(calls).toHaveLength(1);
    expect(PALETTE_MAX_QUERY_LENGTH).toBe(200);
    expect(calls[0].q).toBe("x".repeat(200));
  });

  it("refuses an actor whose member row was deleted with MEMBERSHIP_ENDED, without searching", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const word = uniqueWord();
    await ticketWithSubject(orgId, `Invoice ${word}`);
    await prisma.member.delete({ where: { id: users[0].memberId } });
    const { calls, search } = recorder();

    expect(
      await searchTicketsForPalette(prisma, { userId: users[0].id, orgId }, word, { search }),
    ).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(calls).toHaveLength(0);
  });
});
