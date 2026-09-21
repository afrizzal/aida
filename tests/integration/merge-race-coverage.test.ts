// Phase 12, plan 12-10: forced-order race coverage that Codex review cycle 1 found missing (C1
// and C10), on a real Postgres through Testcontainers. Only the session lookup and the queue
// client of the agent messages route are test doubles (as in 12-03); every lock, row and stored
// file is real.
//
// Race rules (Phase 11 pattern, review R2-1): every run records its own backend PID through its
// hook or observer, holds on a deferred, and is released only after waitForBlockedBy saw the
// named waiter blocked by the holder pg_blocking_pids reports for it. Waiters that queue on one
// row start one at a time, and a later waiter on that row is waited for against the earlier
// waiter's PID. No sleeps; a settled-promise list is never the evidence.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  type MergeActor,
  type MergeResult,
  mergeTickets,
  setAgentMessageObserverForTests,
} from "@/lib/tickets/merge";
import { setReopenObserverForTests } from "@/lib/tickets/reopen-on-reply";
import { loadStatusPageData } from "@/lib/tickets/status-page-data";
import { seedContactTicket, seedOrgWithMembers } from "../support/lifecycle-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

// The agent messages route reads its session through getScopedDb and enqueues through getBoss;
// both are replaced by doubles bound to the case's actor (12-03 pattern). No email setting is
// stored, so the route enqueues nothing.
const routeEnv = vi.hoisted(() => ({
  actor: null as null | { orgId: string; userId: string },
  sends: [] as unknown[][],
}));

vi.mock("@/lib/session", async () => {
  const { scopedDb } = await import("@/lib/scoped-db");
  return {
    getScopedDb: async () => {
      if (!routeEnv.actor) throw new Error("no session");
      return {
        db: scopedDb(routeEnv.actor.orgId),
        orgId: routeEnv.actor.orgId,
        session: { user: { id: routeEnv.actor.userId } },
      };
    },
  };
});

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (...args: unknown[]) => {
      routeEnv.sends.push(args);
      return "job";
    },
  }),
}));

type FollowUpRoute = typeof import("@/app/api/public/status/[token]/follow-up/route");
type MessagesRoute = typeof import("@/app/api/tickets/[id]/messages/route");
type AttachmentRoute = typeof import("@/app/api/public/status/[token]/attachments/[id]/route");
type StorageModule = typeof import("@/lib/attachments/local-file-storage");

let uploadsDir = "";
let previousUploads: string | undefined;
let followUpPost: FollowUpRoute["POST"];
let messagesPost: MessagesRoute["POST"];
let getAttachment: AttachmentRoute["GET"];
let storage: StorageModule["localFileStorage"];

// The local file storage reads UPLOADS_DIR when its module loads, so the fresh directory is set
// before the route modules are first imported.
beforeAll(async () => {
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), "aida-merge-race-coverage-"));
  previousUploads = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = uploadsDir;
  // A test-only value; the public routes hash rate-limit identifiers with it.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "merge-race-coverage-test";
  ({ POST: followUpPost } = await import("@/app/api/public/status/[token]/follow-up/route"));
  ({ POST: messagesPost } = await import("@/app/api/tickets/[id]/messages/route"));
  ({ GET: getAttachment } = await import("@/app/api/public/status/[token]/attachments/[id]/route"));
  ({ localFileStorage: storage } = await import("@/lib/attachments/local-file-storage"));
});

afterAll(async () => {
  if (previousUploads === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploads;
  await rm(uploadsDir, { recursive: true, force: true });
});

afterEach(() => {
  setReopenObserverForTests(null);
  setAgentMessageObserverForTests(null);
  routeEnv.actor = null;
  routeEnv.sends = [];
});

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

/** True when an error (or its Prisma metadata) carries SQLSTATE 40P01. */
function isDeadlock(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown } };
  const code = String(e?.meta?.code ?? e?.code ?? "");
  return code === "40P01" || String(err).includes("40P01");
}

/** Awaits a race call; a rejection fails the case and names a deadlock (SQLSTATE 40P01). */
async function fulfilled<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    throw new Error(
      `race call rejected${isDeadlock(err) ? " with deadlock 40P01" : ""}: ${String(err)}`,
    );
  }
}

interface Side {
  id: string;
  number: number;
  token: string;
}

async function seedActor() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "admin"]);
  const actor: MergeActor = { userId: users[0].id, orgId };
  const other: MergeActor = { userId: users[1].id, orgId };
  return { orgId, actor, other };
}

/** n tickets of one contact, created in order. */
async function sameContact(orgId: string, n: number): Promise<Side[]> {
  const contactEmail = `coverage-${randomUUID()}@example.test`;
  const sides: Side[] = [];
  for (let i = 0; i < n; i += 1) {
    const ticket = await seedContactTicket(orgId, { contactEmail });
    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { statusToken: true },
    });
    sides.push({ id: ticket.id, number: ticket.number, token: row.statusToken });
  }
  return sides;
}

/** One PUBLIC message inserted on the ticket, optionally with one really stored attachment. */
async function addMessage(
  ticketId: string,
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
      visibility: "PUBLIC",
      bodyMarkdown: `Coverage ${randomUUID()}`,
      bodyHtml: "<p>Coverage</p>",
    },
    select: { id: true },
  });
  if (!options.attachment) return { id: message.id, attachmentId: null };
  const key = `${randomUUID().replaceAll("-", "")}.txt`;
  await storage.save({
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
  return { id: message.id, attachmentId: attachment.id };
}

function pdf(marker: string): File {
  return new File(
    [Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\n%%EOF\n`)],
    "proof.pdf",
    { type: "application/pdf" },
  );
}

/** A follow-up through the public status page of the token's ticket. */
function followUp(token: string, body: string, files: File[] = []): Promise<Response> {
  const form = new FormData();
  form.set("message", body);
  for (const file of files) form.append("file", file);
  return followUpPost(
    new Request(`http://localhost/api/public/status/${token}/follow-up`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": `coverage-${randomUUID()}` },
    }),
    { params: Promise.resolve({ token }) },
  );
}

/** A public agent reply through the messages route, as routeEnv.actor. */
function agentReply(ticketId: string, body: string, files: File[] = []): Promise<Response> {
  const form = new FormData();
  form.set("mode", "public");
  form.set("body", body);
  for (const file of files) form.append("file", file);
  return messagesPost(
    new Request(`http://localhost/api/tickets/${ticketId}/messages`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ id: ticketId }) },
  );
}

interface HeldMerge {
  pid: Promise<number>;
  atCommit: Promise<void>;
  release: () => void;
  done: Promise<MergeResult>;
}

/**
 * A merge that records its PID at transaction start and holds in beforeCommit, when every
 * write is done and both row locks are held. With a sentinel it throws that sentinel after
 * the release, so the whole merge rolls back.
 */
function heldMerge(actor: MergeActor, s: Side, t: Side, sentinel?: Error): HeldMerge {
  const pid = deferred<number>();
  const atCommit = deferred<void>();
  const release = deferred<void>();
  const done = mergeTickets(
    prisma,
    actor,
    { sourceTicketId: s.id, targetTicketId: t.id },
    {
      onTransactionStart: async (tx) => pid.resolve(await backendPid(tx)),
      beforeCommit: async () => {
        atCommit.resolve();
        await release.promise;
        if (sentinel) throw sentinel;
      },
    },
  );
  done.catch(() => {});
  return { pid: pid.promise, atCommit: atCommit.promise, release: () => release.resolve(), done };
}

/** A merge that only records its PID at transaction start. */
function recordedMerge(actor: MergeActor, s: Side, t: Side) {
  const pid = deferred<number>();
  const done = mergeTickets(
    prisma,
    actor,
    { sourceTicketId: s.id, targetTicketId: t.id },
    { onTransactionStart: async (tx) => pid.resolve(await backendPid(tx)) },
  );
  done.catch(() => {});
  return { pid: pid.promise, done };
}

async function messagesWithBody(orgId: string, marker: string) {
  return prisma.message.findMany({
    where: { organizationId: orgId, bodyMarkdown: marker },
    select: {
      id: true,
      ticketId: true,
      mergedFromTicketId: true,
      seq: true,
      createdAt: true,
      attachments: { select: { id: true } },
    },
  });
}

async function ticketRow(id: string) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      mergedIntoTicketId: true,
      mergedAt: true,
      mergeMessageSeq: true,
    },
  });
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

describe("review C1: provenance is decided by seq under the lock, never by timestamps (tracer)", () => {
  it("1a: an agent reply whose transaction began before the merge but inserted after it is shown and served for both tokens", async () => {
    const { orgId, actor } = await seedActor();
    const [s, t] = await sameContact(orgId, 2);
    const m1 = await addMessage(s.id, { attachment: true });
    const m2 = await addMessage(t.id, { attachment: true });
    routeEnv.actor = actor;

    const recordedReplyPid = deferred<number>();
    const releaseReply = deferred<void>();
    setAgentMessageObserverForTests({
      onTransactionStart: async (tx) => {
        recordedReplyPid.resolve(await backendPid(tx));
        await releaseReply.promise;
      },
    });
    const marker = `c1-agent-${randomUUID()}`;
    const reply = agentReply(t.id, marker, [pdf(marker)]);
    reply.catch(() => {});
    const rPid = await recordedReplyPid.promise;

    const merge = heldMerge(actor, s, t);
    await merge.atCommit;
    const mergePid = await merge.pid;
    releaseReply.resolve();
    await waitForBlockedBy(prisma, mergePid, [rPid]);
    merge.release();

    expect(await fulfilled(merge.done)).toEqual({
      ok: true,
      sourceTicketId: s.id,
      targetTicketId: t.id,
    });
    expect((await fulfilled(reply)).status).toBe(200);

    const rows = await messagesWithBody(orgId, marker);
    expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[t.id, null]]);
    const r = must(rows[0], "agent reply");
    const aR = must(r.attachments[0], "agent reply attachment").id;
    const source = await ticketRow(s.id);
    const marker1 = must(source.mergeMessageSeq, "mergeMessageSeq");
    expect(r.seq > marker1).toBe(true);
    // The reply's createdAt is its transaction's start time, before the merge's mergedAt.
    expect(r.createdAt.getTime()).toBeLessThan(must(source.mergedAt, "mergedAt").getTime());

    const sPage = await pageIds(s.token);
    const tPage = await pageIds(t.token);
    expect(sPage).toEqual(expect.arrayContaining([m1.id, r.id]));
    expect(sPage).not.toContain(m2.id);
    expect(tPage).toEqual(expect.arrayContaining([m2.id, r.id]));
    expect(tPage).not.toContain(m1.id);

    const a1 = must(m1.attachmentId, "a1");
    const a2 = must(m2.attachmentId, "a2");
    expect([await attachmentStatus(s.token, aR), await attachmentStatus(t.token, aR)]).toEqual([
      200, 200,
    ]);
    expect([await attachmentStatus(s.token, a1), await attachmentStatus(t.token, a1)]).toEqual([
      200, 404,
    ]);
    expect([await attachmentStatus(t.token, a2), await attachmentStatus(s.token, a2)]).toEqual([
      200, 404,
    ]);
  });

  it("1b: a follow-up through the source token held before its first read lands once on the target after the merge and is served for both tokens", async () => {
    const { orgId, actor } = await seedActor();
    const [s, t] = await sameContact(orgId, 2);
    const m1 = await addMessage(s.id, { attachment: true });
    const m2 = await addMessage(t.id, { attachment: true });

    const recordedFollowPid = deferred<number>();
    const releaseFollow = deferred<void>();
    setReopenObserverForTests({
      onResolveStart: async (tx, ref) => {
        if (ref.ticketId !== s.id) return;
        recordedFollowPid.resolve(await backendPid(tx));
        await releaseFollow.promise;
      },
    });
    const marker = `c1-follow-${randomUUID()}`;
    const reply = followUp(s.token, marker, [pdf(marker)]);
    reply.catch(() => {});
    const fPid = await recordedFollowPid.promise;

    const merge = heldMerge(actor, s, t);
    await merge.atCommit;
    const mergePid = await merge.pid;
    releaseFollow.resolve();
    await waitForBlockedBy(prisma, mergePid, [fPid]);
    merge.release();

    expect(await fulfilled(merge.done)).toMatchObject({ ok: true });
    expect((await fulfilled(reply)).status).toBe(200);

    const rows = await messagesWithBody(orgId, marker);
    expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[t.id, null]]);
    const f = must(rows[0], "follow-up");
    const aF = must(f.attachments[0], "follow-up attachment").id;
    const source = await ticketRow(s.id);
    expect(source.mergedIntoTicketId).toBe(t.id);
    expect(f.seq > must(source.mergeMessageSeq, "mergeMessageSeq")).toBe(true);
    expect(f.createdAt.getTime()).toBeLessThan(must(source.mergedAt, "mergedAt").getTime());

    const sPage = await pageIds(s.token);
    const tPage = await pageIds(t.token);
    expect(sPage).toEqual(expect.arrayContaining([m1.id, f.id]));
    expect(sPage).not.toContain(m2.id);
    expect(tPage).toEqual(expect.arrayContaining([m2.id, f.id]));
    expect(tPage).not.toContain(m1.id);
    expect([await attachmentStatus(s.token, aF), await attachmentStatus(t.token, aF)]).toEqual([
      200, 200,
    ]);
  });

  it("1c: equal and later timestamps never let a pre-merge target message through, and an earlier one never hides a post-merge message", async () => {
    const { orgId, actor } = await seedActor();
    const [s, t] = await sameContact(orgId, 2);
    const m1 = await addMessage(s.id, { attachment: true });
    const equal = await addMessage(t.id, { attachment: true });
    const later = await addMessage(t.id, { attachment: true });
    expect(
      await mergeTickets(prisma, actor, { sourceTicketId: s.id, targetTicketId: t.id }),
    ).toMatchObject({ ok: true });
    const post = await addMessage(t.id, { attachment: true });

    const source = await ticketRow(s.id);
    const mergedAt = must(source.mergedAt, "mergedAt");
    await prisma.message.update({ where: { id: equal.id }, data: { createdAt: mergedAt } });
    await prisma.message.update({
      where: { id: later.id },
      data: { createdAt: new Date(mergedAt.getTime() + 1_000) },
    });
    await prisma.message.update({
      where: { id: post.id },
      data: { createdAt: new Date(mergedAt.getTime() - 60_000) },
    });
    const stored = await prisma.message.findMany({
      where: { id: { in: [equal.id, later.id, post.id] } },
      select: { id: true, seq: true, createdAt: true },
    });
    const byId = new Map(stored.map((row) => [row.id, row]));
    const marker = must(source.mergeMessageSeq, "mergeMessageSeq");
    expect(must(byId.get(equal.id), "equal").createdAt.getTime()).toBe(mergedAt.getTime());
    expect(must(byId.get(equal.id), "equal").seq < marker).toBe(true);
    expect(must(byId.get(later.id), "later").seq < marker).toBe(true);
    expect(must(byId.get(post.id), "post").seq > marker).toBe(true);

    const sPage = await pageIds(s.token);
    const tPage = await pageIds(t.token);
    expect(sPage).toEqual(expect.arrayContaining([m1.id, post.id]));
    expect(sPage).not.toContain(equal.id);
    expect(sPage).not.toContain(later.id);
    expect(tPage).toEqual(expect.arrayContaining([equal.id, later.id, post.id]));
    expect(tPage).not.toContain(m1.id);

    for (const pre of [equal, later]) {
      const id = must(pre.attachmentId, "pre-merge attachment");
      expect([await attachmentStatus(s.token, id), await attachmentStatus(t.token, id)]).toEqual([
        404, 200,
      ]);
    }
    const postAttachment = must(post.attachmentId, "post-merge attachment");
    expect([
      await attachmentStatus(s.token, postAttachment),
      await attachmentStatus(t.token, postAttachment),
    ]).toEqual([200, 200]);
  });
});
