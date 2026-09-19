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
  return { dir };
});

import { GET as getAttachment } from "@/app/api/public/status/[token]/attachments/[id]/route";
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
