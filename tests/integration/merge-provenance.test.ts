// Phase 12, plan 12-04: per-token provenance on the public status side after a merge (AIDA-53,
// D-09, D-10) on a real Postgres through Testcontainers. Nothing is mocked: the loader and the
// public route handlers run against real rows and a real (temporary) upload directory.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";

// The local file storage reads UPLOADS_DIR when its module loads, so the directory is set
// before any import that pulls it in.
const uploads = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "aida-merge-provenance-"));
  process.env.UPLOADS_DIR = dir;
  // A test-only value; the public routes hash rate-limit identifiers with it.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "merge-provenance-test";
  return { dir };
});

import { GET as getAttachment } from "@/app/api/public/status/[token]/attachments/[id]/route";
import { POST as csatPost } from "@/app/api/public/status/[token]/csat/route";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import type { MessageVisibility } from "@/generated/prisma/client";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { prisma } from "@/lib/db";
import { type MergeActor, mergeTickets } from "@/lib/tickets/merge";
import { loadStatusPageData } from "@/lib/tickets/status-page-data";
import { seedContactTicket, seedOrgWithMembers } from "../support/lifecycle-fixtures";

afterAll(async () => {
  await rm(uploads.dir, { recursive: true, force: true });
});

async function seedActor() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  const actor: MergeActor = { userId: users[0].id, orgId };
  return { orgId, actor };
}

const email = () => `provenance-${randomUUID()}@example.test`;

async function tokenOf(ticketId: string): Promise<string> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  return row.statusToken;
}

/** One message (optionally with one real stored attachment) inserted on the ticket. */
async function addMessage(
  ticketId: string,
  visibility: MessageVisibility,
  options: { attachment?: boolean } = {},
): Promise<{ id: string; attachmentId: string | null }> {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { organizationId: true },
  });
  const message = await prisma.message.create({
    data: {
      organizationId: ticket.organizationId,
      ticketId,
      direction: "OUTBOUND",
      visibility,
      bodyMarkdown: `Provenance ${visibility}`,
      bodyHtml: `<p>Provenance ${visibility}</p>`,
    },
    select: { id: true },
  });
  let attachmentId: string | null = null;
  if (options.attachment) {
    const key = `${randomUUID().replaceAll("-", "")}.txt`;
    await localFileStorage.save({
      orgId: ticket.organizationId,
      key,
      data: Buffer.from(`file of ${message.id}`),
    });
    const attachment = await prisma.attachment.create({
      data: {
        organizationId: ticket.organizationId,
        messageId: message.id,
        storageKey: key,
        originalFilename: "evidence.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
      },
      select: { id: true },
    });
    attachmentId = attachment.id;
  }
  return { id: message.id, attachmentId };
}

/** The ids of the messages createTicket wrote on the ticket (its opening message). */
async function existingMessageIds(ticketId: string): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { ticketId, visibility: "PUBLIC" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function pageIds(token: string): Promise<string[]> {
  const data = await loadStatusPageData(token);
  if (!data) throw new Error("status page data missing");
  return data.messages.map((message) => message.id);
}

async function attachmentStatus(token: string, attachmentId: string): Promise<number> {
  const response = await getAttachment(new Request("http://localhost/attachment"), {
    params: Promise.resolve({ token, id: attachmentId }),
  });
  return response.status;
}

describe("status links after a merge (tracer)", () => {
  it("each token shows exactly its own history plus post-merge target messages, for messages and attachments", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    const sOpening = await existingMessageIds(s.id);
    const tOpening = await existingMessageIds(t.id);

    const m1 = await addMessage(s.id, "PUBLIC", { attachment: true });
    const m2 = await addMessage(t.id, "PUBLIC", { attachment: true });
    const n1 = await addMessage(t.id, "INTERNAL");
    const sToken = await tokenOf(s.id);
    const tToken = await tokenOf(t.id);

    const merged = await mergeTickets(prisma, actor, {
      sourceTicketId: s.id,
      targetTicketId: t.id,
      reviewedLinkLabel: null,
    });
    expect(merged).toEqual({ ok: true, sourceTicketId: s.id, targetTicketId: t.id });
    const m3 = await addMessage(t.id, "PUBLIC");

    expect(await pageIds(sToken)).toEqual([...sOpening, m1.id, m3.id]);
    expect(await pageIds(tToken)).toEqual([...tOpening, m2.id, m3.id]);
    expect(await pageIds(sToken)).not.toContain(n1.id);
    expect(await pageIds(tToken)).not.toContain(n1.id);

    const a1 = m1.attachmentId as string;
    const a2 = m2.attachmentId as string;
    expect(await attachmentStatus(sToken, a1)).toBe(200);
    expect(await attachmentStatus(tToken, a1)).toBe(404);
    expect(await attachmentStatus(tToken, a2)).toBe(200);
    expect(await attachmentStatus(sToken, a2)).toBe(404);
    // A refused attachment answers exactly like an unknown id.
    expect(await attachmentStatus(sToken, randomUUID())).toBe(404);
  });
});

async function followUp(token: string, body: string): Promise<number> {
  const form = new FormData();
  form.set("message", body);
  const response = await followUpPost(
    new Request(`http://localhost/api/public/status/${token}/follow-up`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": `provenance-${randomUUID()}` },
    }),
    { params: Promise.resolve({ token }) },
  );
  return response.status;
}

async function csat(token: string, score: number): Promise<number> {
  const form = new FormData();
  form.set("score", String(score));
  const response = await csatPost(
    new Request(`http://localhost/api/public/status/${token}/csat`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": `provenance-${randomUUID()}` },
    }),
    { params: Promise.resolve({ token }) },
  );
  return response.status;
}

async function messageIdWithBody(ticketId: string, body: string): Promise<string> {
  const rows = await prisma.message.findMany({
    where: { ticketId, bodyMarkdown: body },
    select: { id: true },
  });
  expect(rows).toHaveLength(1);
  return (rows[0] as { id: string }).id;
}

describe("two status links of one contact (D-09, D-10)", () => {
  it("page, attachments and follow-up: each token sees exactly what D-09 allows", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    const sOpening = await existingMessageIds(s.id);
    const tOpening = await existingMessageIds(t.id);
    const sm = await addMessage(s.id, "PUBLIC", { attachment: true });
    const tm = await addMessage(t.id, "PUBLIC", { attachment: true });
    const sToken = await tokenOf(s.id);
    const tToken = await tokenOf(t.id);

    expect(
      await mergeTickets(prisma, actor, {
        sourceTicketId: s.id,
        targetTicketId: t.id,
        reviewedLinkLabel: null,
      }),
    ).toMatchObject({ ok: true });
    const post = await addMessage(t.id, "PUBLIC");

    const viaSource = `via-source-${randomUUID()}`;
    const viaTarget = `via-target-${randomUUID()}`;
    expect(await followUp(sToken, viaSource)).toBe(200);
    expect(await followUp(tToken, viaTarget)).toBe(200);
    const fs = await messageIdWithBody(t.id, viaSource);
    const ft = await messageIdWithBody(t.id, viaTarget);

    expect(await pageIds(sToken)).toEqual([...sOpening, sm.id, post.id, fs, ft]);
    expect(await pageIds(tToken)).toEqual([...tOpening, tm.id, post.id, fs, ft]);

    const sa = sm.attachmentId as string;
    const ta = tm.attachmentId as string;
    expect([await attachmentStatus(sToken, sa), await attachmentStatus(tToken, sa)]).toEqual([
      200, 404,
    ]);
    expect([await attachmentStatus(tToken, ta), await attachmentStatus(sToken, ta)]).toEqual([
      200, 404,
    ]);
  });

  it("csat stays one per ticket: each token reads and writes only its own ticket's row", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    const sToken = await tokenOf(s.id);
    const tToken = await tokenOf(t.id);
    await prisma.csatResponse.create({
      data: { organizationId: orgId, ticketId: s.id, score: 2, comment: "before" },
    });
    expect(
      await mergeTickets(prisma, actor, {
        sourceTicketId: s.id,
        targetTicketId: t.id,
        reviewedLinkLabel: null,
      }),
    ).toMatchObject({ ok: true });

    // CSAT stays one per ticket: the CLOSED source's token reads and updates the source's row.
    expect((await loadStatusPageData(sToken))?.csat).toEqual({ score: 2, comment: "before" });
    expect(await csat(sToken, 5)).toBe(200);
    expect((await loadStatusPageData(sToken))?.csat).toEqual({ score: 5, comment: null });
    expect(await prisma.csatResponse.findUnique({ where: { ticketId: t.id } })).toBeNull();
    expect((await loadStatusPageData(tToken))?.csat).toBeNull();

    // The target is resolved, then its own token writes its own row.
    await prisma.ticket.update({
      where: { id: t.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    expect(await csat(tToken, 4)).toBe(200);
    expect((await loadStatusPageData(tToken))?.csat).toEqual({ score: 4, comment: null });
    expect((await loadStatusPageData(sToken))?.csat).toEqual({ score: 5, comment: null });
    const rows = await prisma.csatResponse.findMany({
      where: { ticketId: { in: [s.id, t.id] } },
      select: { ticketId: true, score: true },
      orderBy: { score: "asc" },
    });
    expect(rows).toEqual([
      { ticketId: t.id, score: 4 },
      { ticketId: s.id, score: 5 },
    ]);
  });

  it("a refused two-contact merge (DIFFERENT_CONTACTS) leaves both pages, attachments and csat as before", async () => {
    const { orgId, actor } = await seedActor();
    const s = await seedContactTicket(orgId, { contactEmail: email(), status: "RESOLVED" });
    const t = await seedContactTicket(orgId, { contactEmail: email(), status: "RESOLVED" });
    const sm = await addMessage(s.id, "PUBLIC", { attachment: true });
    const tm = await addMessage(t.id, "PUBLIC", { attachment: true });
    await prisma.csatResponse.create({
      data: { organizationId: orgId, ticketId: s.id, score: 3, comment: null },
    });
    const sToken = await tokenOf(s.id);
    const tToken = await tokenOf(t.id);
    const sa = sm.attachmentId as string;
    const ta = tm.attachmentId as string;
    const snapshot = async () => ({
      sPage: await loadStatusPageData(sToken),
      tPage: await loadStatusPageData(tToken),
      attachments: [
        await attachmentStatus(sToken, sa),
        await attachmentStatus(tToken, sa),
        await attachmentStatus(tToken, ta),
        await attachmentStatus(sToken, ta),
      ],
    });
    const before = await snapshot();
    expect(before.attachments).toEqual([200, 404, 200, 404]);

    expect(
      await mergeTickets(prisma, actor, {
        sourceTicketId: s.id,
        targetTicketId: t.id,
        reviewedLinkLabel: null,
      }),
    ).toEqual({ ok: false, error: "DIFFERENT_CONTACTS" });
    expect(await snapshot()).toEqual(before);
  });

  it("an empty merged source shows nothing until a new target message is created, never the target's header", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    await prisma.message.deleteMany({ where: { ticketId: s.id } });
    await addMessage(t.id, "PUBLIC");
    const sToken = await tokenOf(s.id);
    expect(
      await mergeTickets(prisma, actor, {
        sourceTicketId: s.id,
        targetTicketId: t.id,
        reviewedLinkLabel: null,
      }),
    ).toMatchObject({ ok: true });

    expect(await pageIds(sToken)).toEqual([]);
    const fresh = await addMessage(t.id, "PUBLIC");
    expect(await pageIds(sToken)).toEqual([fresh.id]);
  });

  it("the loader for a merged source carries merged true and only the source's own header fields", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    await mergeTickets(prisma, actor, {
      sourceTicketId: s.id,
      targetTicketId: t.id,
      reviewedLinkLabel: null,
    });
    const source = await prisma.ticket.findUniqueOrThrow({
      where: { id: s.id },
      select: { number: true, subject: true, mergedAt: true },
    });
    const target = await prisma.ticket.findUniqueOrThrow({
      where: { id: t.id },
      select: { number: true, subject: true },
    });

    const data = await loadStatusPageData(await tokenOf(s.id));
    expect(data).not.toBeNull();
    const d = data as NonNullable<typeof data>;
    expect(Object.keys(d).sort()).toEqual(
      [
        "contact",
        "csat",
        "merged",
        "mergedAt",
        "messages",
        "number",
        "status",
        "subject",
        "ticketId",
      ].sort(),
    );
    expect(d).toMatchObject({
      ticketId: s.id,
      number: source.number,
      subject: source.subject,
      status: "CLOSED",
      merged: true,
      mergedAt: source.mergedAt,
    });
    expect(d.number).not.toBe(target.number);
    expect(d.subject).not.toBe(target.subject);
    expect(JSON.stringify(d)).not.toContain(t.id);
  });
});
