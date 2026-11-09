// Phase 10, plan 10-16 Task 1 (AIDA-43, AIDA-45, D-08, D-21, V-11): the one token lookup of the
// two status-token POST routes, and the PUBLIC-only page data. The rule under test: possession of
// the status token is the authorization, and only that ticket's data is reachable. Real Postgres
// through Testcontainers; nothing is mocked. The routes are called in-process with constructed
// Requests, each from a fresh client identity unless a case proves the limit on purpose.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";

// The local file storage reads UPLOADS_DIR when its module loads, so the directory is set before
// any import that pulls it in (the follow-up route imports the upload helpers).
const uploads = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "aida-status-token-"));
  process.env.UPLOADS_DIR = dir;
  // A test-only value; the public routes hash rate-limit identifiers with it.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "status-token-test";
  return { dir };
});

import { POST as csatPost } from "@/app/api/public/status/[token]/csat/route";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import { prisma } from "@/lib/db";
import { findTicketByStatusToken, loadStatusPageData } from "@/lib/tickets/status-page-data";
import { uniqueClientHeaders, uniqueClientIp } from "../support/client-ip";
import {
  type LegacyStatusKey,
  seedContactTicket,
  seedMessage,
  seedOrgWithMembers,
} from "../support/lifecycle-fixtures";

afterAll(async () => {
  await rm(uploads.dir, { recursive: true, force: true });
});

async function tokenOf(ticketId: string): Promise<string> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  return row.statusToken;
}

/** One organization with one ticket of its own contact, in the given state. */
async function seedOrgTicket(status?: LegacyStatusKey) {
  const { orgId } = await seedOrgWithMembers(prisma, ["admin"]);
  const contactEmail = `status-token-${randomUUID()}@example.test`;
  const ticket = await seedContactTicket(orgId, { contactEmail, status });
  return { orgId, ticket, token: await tokenOf(ticket.id) };
}

function csatRequest(token: string, score: string, headers = uniqueClientHeaders()): Request {
  const form = new FormData();
  form.set("score", score);
  return new Request(`http://localhost/api/public/status/${token}/csat`, {
    method: "POST",
    headers,
    body: form,
  });
}

function followUpRequest(token: string, message: string, headers = uniqueClientHeaders()): Request {
  const form = new FormData();
  form.set("message", message);
  return new Request(`http://localhost/api/public/status/${token}/follow-up`, {
    method: "POST",
    headers,
    body: form,
  });
}

const params = (token: string) => ({ params: Promise.resolve({ token }) });

describe("findTicketByStatusToken (V-11, D-08)", () => {
  it("returns the token's ticket with its organizationId, contact and state group", async () => {
    const { orgId, ticket, token } = await seedOrgTicket("RESOLVED");
    expect(await findTicketByStatusToken(token)).toEqual({
      id: ticket.id,
      organizationId: orgId,
      contactId: ticket.contactId,
      state: { group: "RESOLVED" },
    });
  });

  it("returns null for an unknown token", async () => {
    expect(await findTicketByStatusToken(`unknown-${randomUUID()}`)).toBeNull();
  });

  it("returns null for an empty token and for a 257-character token, even when a row holds it", async () => {
    expect(await findTicketByStatusToken("")).toBeNull();

    // A row whose token is exactly 257 characters: the guard answers null without a lookup, so
    // the existing row is never returned. The same row with a 256-character token is found.
    const { ticket } = await seedOrgTicket();
    const long = `${randomUUID().replaceAll("-", "")}${"a".repeat(225)}`;
    expect(long.length).toBe(257);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { statusToken: long } });
    expect(await findTicketByStatusToken(long)).toBeNull();

    const atLimit = long.slice(0, 256);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { statusToken: atLimit } });
    expect((await findTicketByStatusToken(atLimit))?.id).toBe(ticket.id);
  });

  it("two organizations: each token returns only its own ticket", async () => {
    const a = await seedOrgTicket();
    const b = await seedOrgTicket();
    expect(a.orgId).not.toBe(b.orgId);

    const fromA = await findTicketByStatusToken(a.token);
    const fromB = await findTicketByStatusToken(b.token);
    expect(fromA).toMatchObject({ id: a.ticket.id, organizationId: a.orgId });
    expect(fromB).toMatchObject({ id: b.ticket.id, organizationId: b.orgId });
  });
});

describe("loadStatusPageData is PUBLIC-only (D-21, AIDA-45)", () => {
  it("returns the PUBLIC message and not an INTERNAL note carrying a mention span", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
    const ticket = await seedContactTicket(orgId, {
      contactEmail: `status-token-${randomUUID()}@example.test`,
    });
    const publicReply = await seedMessage(prisma, ticket.id, {
      visibility: "PUBLIC",
      direction: "OUTBOUND",
    });
    const noteId = randomUUID();
    await prisma.message.create({
      data: {
        id: noteId,
        organizationId: orgId,
        ticketId: ticket.id,
        direction: "OUTBOUND",
        visibility: "INTERNAL",
        authorUserId: users[0].id,
        bodyMarkdown: "@Fixture member please check the refund",
        bodyHtml:
          '<p><span class="font-semibold text-primary-emphasis">@Fixture member</span> please check the refund</p>',
      },
    });

    const data = await loadStatusPageData(await tokenOf(ticket.id));
    const ids = data?.messages.map((m) => m.id) ?? [];

    // Presence first: the page data is there and carries the PUBLIC reply.
    expect(data?.ticketId).toBe(ticket.id);
    expect(ids).toContain(publicReply.id);
    // Then absence: the INTERNAL note, and its mention span, are not loaded.
    expect(ids).not.toContain(noteId);
    expect(data?.messages.every((m) => m.visibility === "PUBLIC")).toBe(true);
    for (const m of data?.messages ?? []) {
      expect(m.bodyHtml).not.toContain("text-primary-emphasis");
      expect(m.bodyHtml).not.toContain("@Fixture member");
    }
  });
});

describe("the csat route through the helper", () => {
  it("records the score for a valid token of a resolved ticket", async () => {
    const { ticket, token } = await seedOrgTicket("RESOLVED");
    const response = await csatPost(csatRequest(token, "4"), params(token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const row = await prisma.csatResponse.findUnique({
      where: { ticketId: ticket.id },
      select: { score: true },
    });
    expect(row).toEqual({ score: 4 });
  });

  it("answers the same 404 body for an unknown token", async () => {
    const token = `unknown-${randomUUID()}`;
    const response = await csatPost(csatRequest(token, "4"), params(token));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("answers 409 not_eligible for an open ticket, as before", async () => {
    const { ticket, token } = await seedOrgTicket("OPEN");
    const response = await csatPost(csatRequest(token, "4"), params(token));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "not_eligible" });
    expect(await prisma.csatResponse.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("answers 429 to an over-quota identity before any lookup, even for a valid token", async () => {
    const { ticket, token } = await seedOrgTicket("RESOLVED");
    const ip = uniqueClientIp();
    const unknown = `unknown-${randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      const r = await csatPost(
        csatRequest(unknown, "4", { "x-forwarded-for": ip }),
        params(unknown),
      );
      expect(r.status).toBe(404);
    }
    const limited = await csatPost(
      csatRequest(token, "4", { "x-forwarded-for": ip }),
      params(token),
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(await prisma.csatResponse.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});

describe("the follow-up route through the helper", () => {
  it("writes the reply on the token's own ticket, organization and contact only", async () => {
    const a = await seedOrgTicket();
    const b = await seedOrgTicket();
    const beforeB = await prisma.message.count({ where: { organizationId: b.orgId } });
    const body = `Follow-up ${randomUUID()}`;

    const response = await followUpPost(followUpRequest(a.token, body), params(a.token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const written = await prisma.message.findMany({
      where: { bodyMarkdown: body },
      select: {
        organizationId: true,
        ticketId: true,
        authorContactId: true,
        direction: true,
        visibility: true,
      },
    });
    expect(written).toEqual([
      {
        organizationId: a.orgId,
        ticketId: a.ticket.id,
        authorContactId: a.ticket.contactId,
        direction: "INBOUND",
        visibility: "PUBLIC",
      },
    ]);
    expect(await prisma.message.count({ where: { organizationId: b.orgId } })).toBe(beforeB);
  });

  it("answers the same 404 body for an unknown token and writes nothing", async () => {
    const token = `unknown-${randomUUID()}`;
    const body = `Follow-up ${randomUUID()}`;
    const response = await followUpPost(followUpRequest(token, body), params(token));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(await prisma.message.count({ where: { bodyMarkdown: body } })).toBe(0);
  });

  it("answers 429 to an over-quota identity before any lookup, even for a valid token", async () => {
    const { token } = await seedOrgTicket();
    const ip = uniqueClientIp();
    const unknown = `unknown-${randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      const r = await followUpPost(
        followUpRequest(unknown, "probe", { "x-forwarded-for": ip }),
        params(unknown),
      );
      expect(r.status).toBe(404);
    }
    const body = `Follow-up ${randomUUID()}`;
    const limited = await followUpPost(
      followUpRequest(token, body, { "x-forwarded-for": ip }),
      params(token),
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(await prisma.message.count({ where: { bodyMarkdown: body } })).toBe(0);
  });
});
