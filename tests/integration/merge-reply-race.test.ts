// Phase 12, plan 12-04: customer replies to a merged source (follow-up and inbound email) land on
// the target under the shared lock order (D-09, D-10), on a real Postgres through
// Testcontainers. Nothing is mocked. Every race is PID-bound: the holder and the waiter record
// their backend PIDs, and the holder is released only after waitForBlockedBy saw the waiter
// blocked by that holder. No sleeps; no settled-promise lists as evidence.
import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Review C7: the follow-up route stores files under UPLOADS_DIR, which the storage module reads
// when it loads, so a fresh temporary directory is set before any import pulls it in.
const uploads = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const dir = await mkdtemp(nodePath.join(os.tmpdir(), "aida-merge-reply-race-"));
  process.env.UPLOADS_DIR = dir;
  // A test-only value; the follow-up route hashes rate-limit identifiers with it.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "merge-reply-race-test";
  return { dir };
});

import { GET as getAttachment } from "@/app/api/public/status/[token]/attachments/[id]/route";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import type { Prisma } from "@/generated/prisma/client";
import { deriveEmailMessageId, ingestMessage } from "@/lib/channels/email/ingest-message";
import { prisma } from "@/lib/db";
import { lockTicketsInIdOrder, type MergeActor, mergeTickets } from "@/lib/tickets/merge";
import {
  ReplyTicketUnavailableError,
  setReopenObserverForTests,
} from "@/lib/tickets/reopen-on-reply";
import { loadStatusPageData } from "@/lib/tickets/status-page-data";
import { seedContactTicket, seedOrgWithMembers, stateIdFor } from "../support/lifecycle-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

const SELF_ADDRESS = "support@aida.test";
const TX_OPTS = { maxWait: 10_000, timeout: 60_000 } as const;

afterEach(() => {
  setReopenObserverForTests(null);
});

afterAll(async () => {
  await rm(uploads.dir, { recursive: true, force: true });
});

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

/** Awaits a race call; a rejection fails the case and names a deadlock (SQLSTATE 40P01). */
async function fulfilled<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    const e = err as { code?: unknown; meta?: { code?: unknown } };
    const code = String(e?.meta?.code ?? e?.code ?? "");
    const deadlock = code === "40P01" || String(err).includes("40P01");
    throw new Error(`race call rejected${deadlock ? " with deadlock 40P01" : ""}: ${String(err)}`);
  }
}

interface Side {
  id: string;
  number: number;
  token: string;
}

async function tokenOf(ticketId: string): Promise<string> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  return row.statusToken;
}

/**
 * Two tickets of one contact; source and target are assigned from SELECT id … ORDER BY id, so
 * PostgreSQL's ordering decides which sorts first.
 */
async function pair(targetSortsFirst: boolean) {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  const actor: MergeActor = { userId: users[0].id, orgId };
  const contactEmail = `race-${randomUUID()}@example.test`;
  const a = await seedContactTicket(orgId, { contactEmail });
  const b = await seedContactTicket(orgId, { contactEmail });
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Ticket" WHERE id IN (${a.id}, ${b.id}) ORDER BY id
  `;
  const low = must(rows[0], "low id").id;
  const high = must(rows[1], "high id").id;
  const byId = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  const source = must(byId.get(targetSortsFirst ? high : low), "source");
  const target = must(byId.get(targetSortsFirst ? low : high), "target");
  const s: Side = { id: source.id, number: source.number, token: await tokenOf(source.id) };
  const t: Side = { id: target.id, number: target.number, token: await tokenOf(target.id) };
  return { orgId, actor, s, t };
}

function pdf(marker: string): File {
  return new File(
    [Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\n%%EOF\n`)],
    "proof.pdf",
    {
      type: "application/pdf",
    },
  );
}

async function followUp(token: string, body: string, files: File[] = []): Promise<Response> {
  const form = new FormData();
  form.set("message", body);
  for (const file of files) form.append("file", file);
  return followUpPost(
    new Request(`http://localhost/api/public/status/${token}/follow-up`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": `race-${randomUUID()}` },
    }),
    { params: Promise.resolve({ token }) },
  );
}

async function emailReply(orgId: string, subject: string, headers?: Record<string, string>) {
  const buf = await new MailComposer({
    from: `customer-${randomUUID()}@example.com`,
    to: SELF_ADDRESS,
    subject,
    text: `Merged reply ${randomUUID()}`,
    messageId: `<merge-race-${randomUUID()}@test.local>`,
    headers,
  })
    .compile()
    .build();
  const parsed = await simpleParser(buf);
  const emailMessageId = deriveEmailMessageId(buf, parsed.messageId);
  return { emailMessageId, run: () => ingestMessage(orgId, buf, SELF_ADDRESS, emailMessageId) };
}

/** Records the PID of the reply transaction that resolves the given token ticket. */
function observeResolve(tokenTicketId: string) {
  const pid = deferred<number>();
  setReopenObserverForTests({
    onResolveStart: async (tx, ref) => {
      if (ref.ticketId === tokenTicketId) pid.resolve(await backendPid(tx));
    },
  });
  return pid.promise;
}

/** A merge held in beforeCommit, with its PID recorded at transaction start. */
function heldMerge(actor: MergeActor, s: Side, t: Side) {
  const pid = deferred<number>();
  const atCommit = deferred<void>();
  const release = deferred<void>();
  const done = mergeTickets(
    prisma,
    actor,
    { sourceTicketId: s.id, targetTicketId: t.id, reviewedLinkLabel: null },
    {
      onTransactionStart: async (tx) => pid.resolve(await backendPid(tx)),
      beforeCommit: async () => {
        atCommit.resolve();
        await release.promise;
      },
    },
  );
  done.catch(() => {});
  return { pid: pid.promise, atCommit: atCommit.promise, release: () => release.resolve(), done };
}

function holdTx<T>(body: (tx: Prisma.TransactionClient) => Promise<T>) {
  const pid = deferred<number>();
  const ready = deferred<T>();
  const release = deferred<void>();
  const done = prisma.$transaction(async (tx) => {
    pid.resolve(await backendPid(tx));
    ready.resolve(await body(tx));
    await release.promise;
  }, TX_OPTS);
  done.catch(() => {});
  return { pid: pid.promise, ready: ready.promise, release: () => release.resolve(), done };
}

async function messagesWithBody(orgId: string, marker: string) {
  return prisma.message.findMany({
    where: { organizationId: orgId, bodyMarkdown: { contains: marker } },
    select: {
      id: true,
      ticketId: true,
      mergedFromTicketId: true,
      attachments: { select: { id: true } },
    },
  });
}

/** The merge is all-or-nothing: S closed into T and no message left on S. */
async function expectMergedWhole(s: Side, t: Side) {
  const source = await prisma.ticket.findUniqueOrThrow({
    where: { id: s.id },
    select: { state: { select: { group: true } }, mergedIntoTicketId: true },
  });
  expect(source).toEqual({ state: { group: "CLOSED" }, mergedIntoTicketId: t.id });
  expect(await prisma.message.count({ where: { ticketId: s.id } })).toBe(0);
}

async function pageIds(token: string): Promise<string[]> {
  const data = must(await loadStatusPageData(token), "status page data");
  return data.messages.map((message) => message.id);
}

async function attachmentStatus(token: string, attachmentId: string): Promise<number> {
  const response = await getAttachment(new Request("http://localhost/attachment"), {
    params: Promise.resolve({ token, id: attachmentId }),
  });
  return response.status;
}

async function filesUnder(orgId: string): Promise<number> {
  try {
    return (await readdir(path.join(uploads.dir, orgId))).length;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return 0;
    throw err;
  }
}

/**
 * Moves a ticket into another organization with one committed statement. The composite foreign
 * key (organizationId, stateId) of Phase 12.1 requires the state to move with it: the ticket
 * takes the other organization's state with the same legacy key.
 */
async function moveToOrganization(ticketId: string, otherOrgId: string) {
  await prisma.$executeRaw`
    UPDATE "Ticket" SET "organizationId" = ${otherOrgId}, "stateId" = (
      SELECT o.id FROM "TicketState" o
      JOIN "TicketState" c ON c."legacyStatus" = o."legacyStatus"
      WHERE o."organizationId" = ${otherOrgId} AND o."deletedAt" IS NULL AND c.id = "Ticket"."stateId"
    )
    WHERE id = ${ticketId}
  `;
}

async function orgCounts(orgId: string) {
  return {
    messages: await prisma.message.count({ where: { organizationId: orgId } }),
    attachments: await prisma.attachment.count({ where: { organizationId: orgId } }),
    audits: await prisma.ticketAuditEvent.count({ where: { organizationId: orgId } }),
  };
}

describe("replies to a merged source land on the target", () => {
  it("a follow-up through the source token posts to the target and reopens a RESOLVED target", async () => {
    const { actor, s, t, orgId } = await pair(true);
    expect(
      await mergeTickets(prisma, actor, {
        sourceTicketId: s.id,
        targetTicketId: t.id,
        reviewedLinkLabel: null,
      }),
    ).toMatchObject({ ok: true });
    await prisma.ticket.update({
      where: { id: t.id },
      data: { stateId: await stateIdFor(orgId, "RESOLVED"), resolvedAt: new Date() },
    });

    const marker = `after-merge-${randomUUID()}`;
    expect((await followUp(s.token, marker)).status).toBe(200);

    const rows = await prisma.message.findMany({
      where: { organizationId: orgId, bodyMarkdown: marker },
      select: {
        ticketId: true,
        mergedFromTicketId: true,
        triggeredReopen: true,
        authorContactId: true,
      },
    });
    const contact = await prisma.ticket.findUniqueOrThrow({
      where: { id: t.id },
      select: { contactId: true, stateId: true },
    });
    expect(rows).toEqual([
      {
        ticketId: t.id,
        mergedFromTicketId: null,
        triggeredReopen: true,
        authorContactId: contact.contactId,
      },
    ]);
    expect(contact.stateId).toBe(await stateIdFor(orgId, "OPEN"));
    await expectMergedWhole(s, t);
  });

  it("a follow-up through the target token behaves as before", async () => {
    const { actor, s, t, orgId } = await pair(false);
    await mergeTickets(prisma, actor, {
      sourceTicketId: s.id,
      targetTicketId: t.id,
      reviewedLinkLabel: null,
    });
    const marker = `target-token-${randomUUID()}`;
    expect((await followUp(t.token, marker)).status).toBe(200);
    const rows = await messagesWithBody(orgId, marker);
    expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[t.id, null]]);
  });

  it("inbound email: the subject number of a source, an In-Reply-To of a moved message and automatic mail all land on the target", async () => {
    const { actor, s, t, orgId } = await pair(true);
    const movedEmailId = `<moved-${randomUUID()}@test.local>`;
    await prisma.message.create({
      data: {
        organizationId: orgId,
        ticketId: s.id,
        direction: "INBOUND",
        visibility: "PUBLIC",
        bodyMarkdown: "moved",
        bodyHtml: "<p>moved</p>",
        emailMessageId: movedEmailId,
      },
    });
    await mergeTickets(prisma, actor, {
      sourceTicketId: s.id,
      targetTicketId: t.id,
      reviewedLinkLabel: null,
    });

    const bySubject = await emailReply(orgId, `Re: question [#${s.number}]`);
    expect(await bySubject.run()).toBe("appended");
    const byHeader = await emailReply(orgId, "Re: no number here", { "In-Reply-To": movedEmailId });
    expect(await byHeader.run()).toBe("appended");

    const snoozedUntil = new Date(Date.now() + 86_400_000);
    await prisma.ticket.update({
      where: { id: t.id },
      data: { stateId: await stateIdFor(orgId, "RESOLVED"), resolvedAt: new Date(), snoozedUntil },
    });
    const automatic = await emailReply(orgId, `Re: question [#${s.number}]`, {
      "Auto-Submitted": "auto-replied",
    });
    expect(await automatic.run()).toBe("appended");

    for (const reply of [bySubject, byHeader, automatic]) {
      const rows = await prisma.message.findMany({
        where: { organizationId: orgId, emailMessageId: reply.emailMessageId },
        select: { ticketId: true, mergedFromTicketId: true, triggeredReopen: true },
      });
      expect(rows).toEqual([{ ticketId: t.id, mergedFromTicketId: null, triggeredReopen: false }]);
    }
    const after = await prisma.ticket.findUniqueOrThrow({
      where: { id: t.id },
      select: { stateId: true, snoozedUntil: true },
    });
    expect(after).toEqual({ stateId: await stateIdFor(orgId, "RESOLVED"), snoozedUntil });
    await expectMergedWhole(s, t);
  });
});

describe("merge and reply races (D-10): one lock order, no 40P01, no partial merge", () => {
  for (const targetSortsFirst of [true, false]) {
    const order = targetSortsFirst ? "target id sorts first" : "source id sorts first";

    it(`Race 1 (${order}): merge held, follow-up through the source token lands once on the target`, async () => {
      const { actor, s, t, orgId } = await pair(targetSortsFirst);
      const merge = heldMerge(actor, s, t);
      await merge.atCommit;
      const replyPid = observeResolve(s.id);
      const marker = `race1-${randomUUID()}`;
      const reply = followUp(s.token, marker);

      await waitForBlockedBy(prisma, await merge.pid, [await replyPid]);
      merge.release();

      expect(await fulfilled(merge.done)).toMatchObject({ ok: true });
      expect((await fulfilled(reply)).status).toBe(200);
      const rows = await messagesWithBody(orgId, marker);
      expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[t.id, null]]);
      const id = must(rows[0], "race 1 message").id;
      expect(await pageIds(s.token)).toContain(id);
      expect(await pageIds(t.token)).toContain(id);
      await expectMergedWhole(s, t);
    });

    it(`Race 2 (${order}): follow-up holds the source row, merge moves it; only the source token sees it`, async () => {
      const { actor, s, t, orgId } = await pair(targetSortsFirst);
      const replyPid = deferred<number>();
      const held = deferred<void>();
      const releaseReply = deferred<void>();
      setReopenObserverForTests({
        onResolveStart: async (tx, ref) => {
          if (ref.ticketId === s.id) replyPid.resolve(await backendPid(tx));
        },
        afterResolve: async (_tx, effectiveTicketId) => {
          if (effectiveTicketId !== s.id) return;
          held.resolve();
          await releaseReply.promise;
        },
      });
      const marker = `race2-${randomUUID()}`;
      const reply = followUp(s.token, marker, [pdf(marker)]);
      await held.promise;

      const mergePid = deferred<number>();
      const merge = mergeTickets(
        prisma,
        actor,
        { sourceTicketId: s.id, targetTicketId: t.id, reviewedLinkLabel: null },
        { onTransactionStart: async (tx) => mergePid.resolve(await backendPid(tx)) },
      );
      await waitForBlockedBy(prisma, await replyPid.promise, [await mergePid.promise]);
      releaseReply.resolve();

      expect((await fulfilled(reply)).status).toBe(200);
      expect(await fulfilled(merge)).toMatchObject({ ok: true });
      const rows = await messagesWithBody(orgId, marker);
      expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[t.id, s.id]]);
      const row = must(rows[0], "race 2 message");
      const attachmentId = must(row.attachments[0], "race 2 attachment").id;
      expect(await pageIds(s.token)).toContain(row.id);
      expect(await pageIds(t.token)).not.toContain(row.id);
      expect(await attachmentStatus(s.token, attachmentId)).toBe(200);
      expect(await attachmentStatus(t.token, attachmentId)).toBe(404);
      await expectMergedWhole(s, t);
    });
  }

  it("Race 3: merge held, an inbound email with the source's number lands once on the target", async () => {
    const { actor, s, t, orgId } = await pair(true);
    const merge = heldMerge(actor, s, t);
    await merge.atCommit;
    const replyPid = observeResolve(s.id);
    const mail = await emailReply(orgId, `Re: question [#${s.number}]`);
    const ingest = mail.run();

    await waitForBlockedBy(prisma, await merge.pid, [await replyPid]);
    merge.release();

    expect(await fulfilled(merge.done)).toMatchObject({ ok: true });
    expect(await fulfilled(ingest)).toBe("appended");
    const rows = await prisma.message.findMany({
      where: { organizationId: orgId, emailMessageId: mail.emailMessageId },
      select: { ticketId: true, mergedFromTicketId: true },
    });
    expect(rows).toEqual([{ ticketId: t.id, mergedFromTicketId: null }]);
    await expectMergedWhole(s, t);
  });

  it("Race 4: a reply to an already merged source waits behind an id-ordered holder of both rows, then lands once on the target", async () => {
    const { actor, s, t, orgId } = await pair(false);
    expect(
      await mergeTickets(prisma, actor, {
        sourceTicketId: s.id,
        targetTicketId: t.id,
        reviewedLinkLabel: null,
      }),
    ).toMatchObject({ ok: true });
    const holder = holdTx((tx) => lockTicketsInIdOrder(tx, orgId, [s.id, t.id]));
    const holderPid = await holder.pid;
    expect((await holder.ready).map((row) => row.id).sort()).toEqual([s.id, t.id].sort());

    const replyPid = observeResolve(s.id);
    const marker = `race4-${randomUUID()}`;
    const reply = followUp(s.token, marker);
    await waitForBlockedBy(prisma, holderPid, [await replyPid]);
    holder.release();
    await fulfilled(holder.done);

    expect((await fulfilled(reply)).status).toBe(200);
    const rows = await messagesWithBody(orgId, marker);
    expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[t.id, null]]);
    await expectMergedWhole(s, t);
  });
});

describe("review C7: a follow-up that commits no message leaves no stored file", () => {
  it("a rolled-back transaction rejects with its sentinel and leaves no file, message or audit row", async () => {
    const { s, orgId } = await pair(true);
    const before = await orgCounts(orgId);
    const sentinel = new Error(`sentinel-${randomUUID()}`);
    setReopenObserverForTests({
      afterResolve: async (_tx, effectiveTicketId) => {
        if (effectiveTicketId === s.id) throw sentinel;
      },
    });
    const marker = `sentinel-${randomUUID()}`;
    await expect(followUp(s.token, marker, [pdf(`${marker}-a`), pdf(`${marker}-b`)])).rejects.toBe(
      sentinel,
    );
    expect(await filesUnder(orgId)).toBe(0);
    expect(await orgCounts(orgId)).toEqual(before);
  });

  it("TICKET_UNAVAILABLE from resolveReplyTicket answers 404 not_found and leaves no file, message or audit row", async () => {
    const { s, orgId } = await pair(true);
    const other = await seedOrgWithMembers(prisma, ["admin"]);
    const before = await orgCounts(orgId);
    setReopenObserverForTests({
      onResolveStart: async (_tx, ref) => {
        if (ref.ticketId !== s.id) return;
        // The test's own client, committed before the callback returns.
        await moveToOrganization(s.id, other.orgId);
      },
    });
    const marker = `unavailable-${randomUUID()}`;
    const response = await followUp(s.token, marker, [pdf(`${marker}-a`), pdf(`${marker}-b`)]);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(await filesUnder(orgId)).toBe(0);
    expect(await orgCounts(orgId)).toEqual(before);
  });
});

describe("review IN-04: inbound email on a matched ticket that can no longer take the reply", () => {
  it("rejects with the typed ReplyTicketUnavailableError and writes nothing", async () => {
    const { s, orgId } = await pair(true);
    const other = await seedOrgWithMembers(prisma, ["admin"]);
    const before = await orgCounts(orgId);
    setReopenObserverForTests({
      onResolveStart: async (_tx, ref) => {
        if (ref.ticketId !== s.id) return;
        // The test's own client, committed before the callback returns.
        await moveToOrganization(s.id, other.orgId);
      },
    });
    const mail = await emailReply(orgId, `Re: question [#${s.number}]`);
    const rejection = mail.run();
    await expect(rejection).rejects.toMatchObject({
      name: "ReplyTicketUnavailableError",
      code: "TICKET_UNAVAILABLE",
    });
    await expect(rejection).rejects.toBeInstanceOf(ReplyTicketUnavailableError);
    expect(await orgCounts(orgId)).toEqual(before);
    expect(await prisma.message.count({ where: { emailMessageId: mail.emailMessageId } })).toBe(0);
  });
});
