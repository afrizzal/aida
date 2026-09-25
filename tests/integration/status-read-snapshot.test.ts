// Phase 12, Codex diff critique round 1, D5: the public status page loader and the public
// attachment route read the token's merge marker and the message or attachment rows from ONE
// snapshot (REPEATABLE READ), so a merge that commits between the two reads can neither empty
// the thread nor turn a valid attachment into a 404. Real Postgres through Testcontainers and a
// real (temporary) upload directory; nothing is mocked. The merge is committed through the
// loaders' test seam (setStatusReadObserverForTests), between the ticket read and the second
// read, on another connection, and awaited until it committed: no sleeps.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The local file storage reads UPLOADS_DIR when its module loads, so the directory is set
// before any import that pulls it in.
const uploads = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "aida-status-snapshot-"));
  process.env.UPLOADS_DIR = dir;
  return { dir };
});

import { GET as getAttachment } from "@/app/api/public/status/[token]/attachments/[id]/route";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { prisma } from "@/lib/db";
import { type MergeActor, type MergeResult, mergeTickets } from "@/lib/tickets/merge";
import { loadStatusPageData, setStatusReadObserverForTests } from "@/lib/tickets/status-page-data";
import { seedContactTicket, seedOrgWithMembers } from "../support/lifecycle-fixtures";

afterEach(() => {
  setStatusReadObserverForTests(null);
});

afterAll(async () => {
  await rm(uploads.dir, { recursive: true, force: true });
});

async function seedMergeablePair() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  const actor: MergeActor = { userId: users[0].id, orgId };
  const contactEmail = `snapshot-${randomUUID()}@example.test`;
  const source = await seedContactTicket(orgId, { contactEmail });
  const target = await seedContactTicket(orgId, { contactEmail });
  return { orgId, actor, source, target };
}

async function tokenOf(ticketId: string): Promise<string> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  return row.statusToken;
}

async function publicMessageIds(ticketId: string): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { ticketId, visibility: "PUBLIC" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** One PUBLIC message on the ticket with one real stored attachment. */
async function addMessageWithFile(orgId: string, ticketId: string, content: string) {
  const message = await prisma.message.create({
    data: {
      organizationId: orgId,
      ticketId,
      direction: "OUTBOUND",
      visibility: "PUBLIC",
      bodyMarkdown: "Snapshot reply",
      bodyHtml: "<p>Snapshot reply</p>",
    },
    select: { id: true },
  });
  const key = `${randomUUID().replaceAll("-", "")}.txt`;
  await localFileStorage.save({ orgId, key, data: Buffer.from(content) });
  const attachment = await prisma.attachment.create({
    data: {
      organizationId: orgId,
      messageId: message.id,
      storageKey: key,
      originalFilename: "snapshot.txt",
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(content),
    },
    select: { id: true },
  });
  return { messageId: message.id, attachmentId: attachment.id };
}

/** Commits the merge once, from the seam, between the loader's ticket read and its next read. */
function mergeBetweenReads(actor: MergeActor, sourceId: string, targetId: string) {
  const outcome: { result: MergeResult | null; calls: number } = { result: null, calls: 0 };
  setStatusReadObserverForTests({
    async afterTicketRead() {
      outcome.calls += 1;
      if (outcome.result) return;
      outcome.result = await mergeTickets(prisma, actor, {
        sourceTicketId: sourceId,
        targetTicketId: targetId,
      });
    },
  });
  return outcome;
}

describe("status reads see one snapshot while a merge commits between them (Codex diff round 1, D5)", () => {
  it("the source token's page shows the pre-merge thread, never an empty one", async () => {
    const { orgId, actor, source, target } = await seedMergeablePair();
    const reply = await addMessageWithFile(orgId, source.id, "pre-merge file");
    const expected = await publicMessageIds(source.id);
    expect(expected).toContain(reply.messageId);
    const sourceToken = await tokenOf(source.id);

    const merge = mergeBetweenReads(actor, source.id, target.id);
    const data = await loadStatusPageData(sourceToken);

    expect(merge.calls).toBe(1);
    expect(merge.result).toEqual({
      ok: true,
      sourceTicketId: source.id,
      targetTicketId: target.id,
    });
    // The merge committed before the message read, and the moved rows are on the target now.
    expect(await prisma.message.count({ where: { ticketId: source.id } })).toBe(0);
    // One snapshot: the ticket as it was before the merge, with its thread as it was then.
    expect(data?.merged).toBe(false);
    expect(data?.messages.map((message) => message.id)).toEqual(expected);
    expect(data?.messages.find((message) => message.id === reply.messageId)?.attachments).toEqual([
      { id: reply.attachmentId, originalFilename: "snapshot.txt", sizeBytes: 14 },
    ]);

    // The next load, after the merge, shows the same history through the merged source.
    setStatusReadObserverForTests(null);
    const after = await loadStatusPageData(sourceToken);
    expect(after?.merged).toBe(true);
    expect(after?.messages.map((message) => message.id)).toEqual(expected);
  });

  it("the source token's attachment is still served when the merge commits between the reads", async () => {
    const { orgId, actor, source, target } = await seedMergeablePair();
    const reply = await addMessageWithFile(orgId, source.id, "attachment body");
    const sourceToken = await tokenOf(source.id);

    const merge = mergeBetweenReads(actor, source.id, target.id);
    const response = await getAttachment(new Request("http://localhost/attachment"), {
      params: Promise.resolve({ token: sourceToken, id: reply.attachmentId }),
    });

    expect(merge.calls).toBe(1);
    expect(merge.result).toMatchObject({ ok: true });
    const moved = await prisma.message.findUniqueOrThrow({
      where: { id: reply.messageId },
      select: { ticketId: true, mergedFromTicketId: true },
    });
    expect(moved).toEqual({ ticketId: target.id, mergedFromTicketId: source.id });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("attachment body");
  });

  it("the target token sees nothing of the source in either snapshot", async () => {
    const { orgId, actor, source, target } = await seedMergeablePair();
    const sourceReply = await addMessageWithFile(orgId, source.id, "source file");
    const targetIds = await publicMessageIds(target.id);
    const targetToken = await tokenOf(target.id);

    const merge = mergeBetweenReads(actor, source.id, target.id);
    const data = await loadStatusPageData(targetToken);
    const attachment = await getAttachment(new Request("http://localhost/attachment"), {
      params: Promise.resolve({ token: targetToken, id: sourceReply.attachmentId }),
    });

    expect(merge.result).toMatchObject({ ok: true });
    expect(data?.messages.map((message) => message.id)).toEqual(targetIds);
    expect(attachment.status).toBe(404);
  });
});
