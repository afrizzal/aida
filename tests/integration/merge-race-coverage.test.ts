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
import type { RelationLabel } from "@/lib/tickets/relation-pairs";
import { removeRelation } from "@/lib/tickets/relations";
import { setReopenObserverForTests } from "@/lib/tickets/reopen-on-reply";
import { loadStatusPageData } from "@/lib/tickets/status-page-data";
import { uniqueClientHeaders } from "../support/client-ip";
import { seedContactTicket, seedOrgWithMembers, seedRelation } from "../support/lifecycle-fixtures";
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
      headers: uniqueClientHeaders(),
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
function heldMerge(
  actor: MergeActor,
  s: Side,
  t: Side,
  reviewedLinkLabel: RelationLabel | null,
  sentinel?: Error,
): HeldMerge {
  const pid = deferred<number>();
  const atCommit = deferred<void>();
  const release = deferred<void>();
  const done = mergeTickets(
    prisma,
    actor,
    { sourceTicketId: s.id, targetTicketId: t.id, reviewedLinkLabel },
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
function recordedMerge(
  actor: MergeActor,
  s: Side,
  t: Side,
  reviewedLinkLabel: RelationLabel | null,
) {
  const pid = deferred<number>();
  const done = mergeTickets(
    prisma,
    actor,
    { sourceTicketId: s.id, targetTicketId: t.id, reviewedLinkLabel },
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

// Sets a stored message's createdAt one millisecond before mergedAt and proves the stored value,
// so a case can state "createdAt earlier than mergedAt" without depending on two clocks agreeing.
async function pinCreatedAtBefore(messageId: string, mergedAt: Date): Promise<void> {
  const before = new Date(mergedAt.getTime() - 1);
  await prisma.message.update({ where: { id: messageId }, data: { createdAt: before } });
  const stored = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    select: { createdAt: true },
  });
  expect(stored.createdAt.getTime()).toBe(before.getTime());
  expect(stored.createdAt.getTime()).toBeLessThan(mergedAt.getTime());
}

async function ticketRow(id: string) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: {
      stateId: true,
      state: { select: { group: true } },
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
  const response = await getAttachment(
    new Request("http://localhost/attachment", { headers: uniqueClientHeaders() }),
    {
      params: Promise.resolve({ token, id: attachmentId }),
    },
  );
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

    const merge = heldMerge(actor, s, t, null);
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
    // Prisma 7 fills @default(now()) from the application clock when it builds the insert, while
    // mergedAt is the database's clock_timestamp(). Comparing the two raw values depends on clock
    // skew, so the case pins the C1 condition itself: R's createdAt is set before mergedAt, and
    // the pages and attachments below must still follow seq.
    await pinCreatedAtBefore(r.id, must(source.mergedAt, "mergedAt"));

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

    const merge = heldMerge(actor, s, t, null);
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
    // Same clock reasoning as 1a: pin F's createdAt before mergedAt, then require seq to decide.
    await pinCreatedAtBefore(f.id, must(source.mergedAt, "mergedAt"));

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
      await mergeTickets(prisma, actor, {
        sourceTicketId: s.id,
        targetTicketId: t.id,
        reviewedLinkLabel: null,
      }),
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

/** Every TicketAuditEvent row of the tickets, counted per ticket, action and actor. */
async function auditTally(ticketIds: readonly string[]): Promise<Record<string, number>> {
  const rows = await prisma.ticketAuditEvent.findMany({
    where: { ticketId: { in: [...ticketIds] } },
    select: { ticketId: true, action: true, actorUserId: true },
  });
  const tally: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.ticketId} ${row.action} ${row.actorUserId ?? "system"}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

/** The tally with exactly the listed rows added (ticket, action, actor). */
function plus(
  before: Record<string, number>,
  rows: readonly (readonly [string, string, string])[],
): Record<string, number> {
  const tally = { ...before };
  for (const [ticketId, action, actor] of rows) {
    const key = `${ticketId} ${action} ${actor}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

/** The audit rows one completed merge of an OPEN, unsnoozed, unlinked source writes. */
function mergeRows(actor: MergeActor, s: Side, t: Side) {
  return [
    [s.id, "MERGED_INTO", actor.userId],
    [s.id, "STATUS_CHANGED", actor.userId],
    [t.id, "MERGED_FROM", actor.userId],
  ] as const;
}

/** Every file stored anywhere under the test's UPLOADS_DIR. */
async function filesUnderUploads(): Promise<number> {
  const entries = await readdir(uploadsDir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).length;
}

async function messageIdsOn(ticketId: string): Promise<string[]> {
  const rows = await prisma.message.findMany({ where: { ticketId }, select: { id: true } });
  return rows.map((row) => row.id);
}

/** Every listed message is on the target and carries the source as its provenance. */
async function expectMovedFrom(ids: readonly string[], s: Side, t: Side) {
  const rows = await prisma.message.findMany({
    where: { id: { in: [...ids] } },
    select: { ticketId: true, mergedFromTicketId: true },
  });
  expect(rows).toHaveLength(ids.length);
  for (const row of rows) expect(row).toEqual({ ticketId: t.id, mergedFromTicketId: s.id });
}

async function expectMergedInto(s: Side, t: Side) {
  const row = await ticketRow(s.id);
  expect({ group: row.state.group, mergedIntoTicketId: row.mergedIntoTicketId }).toEqual({
    group: "CLOSED",
    mergedIntoTicketId: t.id,
  });
  expect(await prisma.message.count({ where: { ticketId: s.id } })).toBe(0);
}

/** Page listing and attachment status of one message for one token. */
async function seenBy(token: string, messageId: string, attachmentId: string) {
  return {
    listed: (await pageIds(token)).includes(messageId),
    served: await attachmentStatus(token, attachmentId),
  };
}

describe("review C10: two merges into one target racing a reply, and the second mismatch", () => {
  it("2a: a follow-up holding the target row, then two merges queued one at a time; F stays visible only to the target token", async () => {
    const { orgId, actor } = await seedActor();
    const [s1, s2, t] = await sameContact(orgId, 3);
    await addMessage(s1.id);
    await addMessage(s2.id);
    await addMessage(t.id);
    const s1Ids = await messageIdsOn(s1.id);
    const s2Ids = await messageIdsOn(s2.id);
    const audits = await auditTally([s1.id, s2.id, t.id]);

    const recordedF = deferred<number>();
    const heldF = deferred<void>();
    const releaseF = deferred<void>();
    setReopenObserverForTests({
      onResolveStart: async (tx, ref) => {
        if (ref.ticketId === t.id) recordedF.resolve(await backendPid(tx));
      },
      afterResolve: async (_tx, effectiveTicketId) => {
        if (effectiveTicketId !== t.id) return;
        heldF.resolve();
        await releaseF.promise;
      },
    });
    const marker = `c10-2a-${randomUUID()}`;
    const reply = followUp(t.token, marker, [pdf(marker)]);
    reply.catch(() => {});
    const fPid = await recordedF.promise;
    await heldF.promise;

    // The first merge is the first waiter on T's row, blocked by F.
    const first = recordedMerge(actor, s1, t, null);
    const m1Pid = await first.pid;
    await waitForBlockedBy(prisma, fPid, [m1Pid]);
    // The second merge queues on T's row behind the first waiter (review R2-1).
    const second = recordedMerge(actor, s2, t, null);
    const m2Pid = await second.pid;
    await waitForBlockedBy(prisma, m1Pid, [m2Pid]);
    releaseF.resolve();

    expect((await fulfilled(reply)).status).toBe(200);
    expect(await fulfilled(first.done)).toMatchObject({ ok: true });
    expect(await fulfilled(second.done)).toMatchObject({ ok: true });

    const rows = await messagesWithBody(orgId, marker);
    expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[t.id, null]]);
    const f = must(rows[0], "follow-up");
    const aF = must(f.attachments[0], "follow-up attachment").id;
    const r1 = await ticketRow(s1.id);
    const r2 = await ticketRow(s2.id);
    expect(f.seq < must(r1.mergeMessageSeq, "S1 marker")).toBe(true);
    expect(f.seq < must(r2.mergeMessageSeq, "S2 marker")).toBe(true);

    expect(await seenBy(t.token, f.id, aF)).toEqual({ listed: true, served: 200 });
    expect(await seenBy(s1.token, f.id, aF)).toEqual({ listed: false, served: 404 });
    expect(await seenBy(s2.token, f.id, aF)).toEqual({ listed: false, served: 404 });

    await expectMovedFrom(s1Ids, s1, t);
    await expectMovedFrom(s2Ids, s2, t);
    await expectMergedInto(s1, t);
    await expectMergedInto(s2, t);
    expect(await auditTally([s1.id, s2.id, t.id])).toEqual(
      plus(audits, [...mergeRows(actor, s1, t), ...mergeRows(actor, s2, t)]),
    );
  });

  /** 2b and 2c: the first merge holds S1 and T; with rollsBack it then throws a sentinel. */
  async function twoMergeRace(rollsBack: boolean) {
    {
      const { orgId, actor } = await seedActor();
      const [s1, s2, t] = await sameContact(orgId, 3);
      await addMessage(s1.id);
      await addMessage(s2.id);
      await addMessage(t.id);
      const s1Ids = await messageIdsOn(s1.id);
      const s2Ids = await messageIdsOn(s2.id);
      const audits = await auditTally([s1.id, s2.id, t.id]);
      const s1Before = await ticketRow(s1.id);
      const sentinel = rollsBack ? new Error(`c10-2c-sentinel-${randomUUID()}`) : undefined;

      const first = heldMerge(actor, s1, t, null, sentinel);
      await first.atCommit;
      const m1Pid = await first.pid;
      // The second merge is the only waiter on T's row.
      const second = recordedMerge(actor, s2, t, null);
      const m2Pid = await second.pid;
      await waitForBlockedBy(prisma, m1Pid, [m2Pid]);

      // F is the only waiter on S1's row, which the first merge holds (review R2-1).
      const recordedF = deferred<number>();
      setReopenObserverForTests({
        onResolveStart: async (tx, ref) => {
          if (ref.ticketId === s1.id) recordedF.resolve(await backendPid(tx));
        },
      });
      const marker = `c10-${rollsBack ? "2c" : "2b"}-${randomUUID()}`;
      const reply = followUp(s1.token, marker, [pdf(marker)]);
      reply.catch(() => {});
      const fPid = await recordedF.promise;
      await waitForBlockedBy(prisma, m1Pid, [fPid]);
      first.release();

      if (sentinel) {
        const outcome = await first.done.then(
          () => null,
          (err: unknown) => err,
        );
        expect(outcome).toBe(sentinel);
        expect(isDeadlock(outcome)).toBe(false);
      } else {
        expect(await fulfilled(first.done)).toMatchObject({ ok: true });
      }
      expect(await fulfilled(second.done)).toMatchObject({ ok: true });
      expect((await fulfilled(reply)).status).toBe(200);

      const rows = await messagesWithBody(orgId, marker);
      const f = must(rows[0], "follow-up");
      const aF = must(f.attachments[0], "follow-up attachment").id;
      await expectMovedFrom(s2Ids, s2, t);
      await expectMergedInto(s2, t);

      if (sentinel) {
        expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[s1.id, null]]);
        // S1 is exactly as before the race: its fixture state, unmerged, no marker.
        expect(await ticketRow(s1.id)).toEqual(s1Before);
        expect(s1Before).toMatchObject({
          mergedIntoTicketId: null,
          mergedAt: null,
          mergeMessageSeq: null,
        });
        const onS1 = await prisma.message.findMany({
          where: { id: { in: s1Ids } },
          select: { ticketId: true, mergedFromTicketId: true },
        });
        expect(onS1).toEqual(s1Ids.map(() => ({ ticketId: s1.id, mergedFromTicketId: null })));
        expect(await seenBy(s1.token, f.id, aF)).toEqual({ listed: true, served: 200 });
        expect(await seenBy(t.token, f.id, aF)).toEqual({ listed: false, served: 404 });
        expect(await seenBy(s2.token, f.id, aF)).toEqual({ listed: false, served: 404 });
        // The rolled-back merge left no MERGED_INTO, MERGED_FROM, STATUS_CHANGED or relation row.
        expect(await auditTally([s1.id, s2.id, t.id])).toEqual(
          plus(audits, mergeRows(actor, s2, t)),
        );
        const links = await prisma.ticketRelation.findMany({
          where: { organizationId: orgId },
          select: { type: true, fromTicketId: true, toTicketId: true },
        });
        expect(links).toEqual([{ type: "DUPLICATE_OF", fromTicketId: s2.id, toTicketId: t.id }]);
        return;
      }

      expect(rows.map((row) => [row.ticketId, row.mergedFromTicketId])).toEqual([[t.id, null]]);
      await expectMovedFrom(s1Ids, s1, t);
      await expectMergedInto(s1, t);
      expect(await seenBy(s1.token, f.id, aF)).toEqual({ listed: true, served: 200 });
      expect(await seenBy(t.token, f.id, aF)).toEqual({ listed: true, served: 200 });
      // Whichever of F and the second merge took T's row first decides S2's view, through seq.
      const s2Marker = must((await ticketRow(s2.id)).mergeMessageSeq, "S2 marker");
      const s2Sees = f.seq > s2Marker;
      expect(await seenBy(s2.token, f.id, aF)).toEqual({
        listed: s2Sees,
        served: s2Sees ? 200 : 404,
      });
      expect(await auditTally([s1.id, s2.id, t.id])).toEqual(
        plus(audits, [...mergeRows(actor, s1, t), ...mergeRows(actor, s2, t)]),
      );
    }
  }

  it("2b: the first merge holds both contended rows; the second merge and a follow-up through S1 queue on different rows and all complete", () =>
    twoMergeRace(false));

  it("2c: the first merge holds both contended rows and then rolls back; the second merge completes and F lands on the unmerged S1", () =>
    twoMergeRace(true));

  it("2d: a forced second mismatch after the relock answers 409 TICKET_CHANGED and writes nothing", async () => {
    const { orgId, actor } = await seedActor();
    const [s, t, u] = await sameContact(orgId, 3);
    await addMessage(s.id);
    await addMessage(t.id);
    const audits = await auditTally([s.id, t.id, u.id]);
    const messagesBefore = await prisma.message.count({ where: { organizationId: orgId } });
    const attachmentsBefore = await prisma.attachment.count({ where: { organizationId: orgId } });
    const filesBefore = await filesUnderUploads();

    const merge = heldMerge(actor, s, t, null);
    await merge.atCommit;
    const mergePid = await merge.pid;

    const recordedF = deferred<number>();
    let relocked = 0;
    setReopenObserverForTests({
      onResolveStart: async (tx, ref) => {
        if (ref.ticketId === s.id) recordedF.resolve(await backendPid(tx));
      },
      // Inside F's transaction: simulate a broken write-once rule on S.
      afterRelock: async (tx, ref) => {
        if (ref.ticketId !== s.id) return;
        relocked += 1;
        await tx.$executeRaw`UPDATE "Ticket" SET "mergedIntoTicketId" = ${u.id} WHERE id = ${s.id}`;
      },
    });
    const marker = `c10-2d-${randomUUID()}`;
    const reply = followUp(s.token, marker, [pdf(`${marker}-a`), pdf(`${marker}-b`)]);
    reply.catch(() => {});
    const fPid = await recordedF.promise;
    await waitForBlockedBy(prisma, mergePid, [fPid]);
    merge.release();

    expect(await fulfilled(merge.done)).toMatchObject({ ok: true });
    const response = await fulfilled(reply);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "TICKET_CHANGED" });
    expect(relocked).toBe(1);

    expect((await ticketRow(s.id)).mergedIntoTicketId).toBe(t.id);
    expect(await prisma.message.count({ where: { bodyMarkdown: { contains: marker } } })).toBe(0);
    // Only the merge's own rows were added: F wrote no message, attachment or audit row.
    expect(await prisma.message.count({ where: { organizationId: orgId } })).toBe(messagesBefore);
    expect(await prisma.attachment.count({ where: { organizationId: orgId } })).toBe(
      attachmentsBefore,
    );
    expect(await auditTally([s.id, t.id, u.id])).toEqual(plus(audits, mergeRows(actor, s, t)));
    expect(await filesUnderUploads()).toBe(filesBefore);
  });
});

type RemoveOrder = "merge holds" | "remove commits" | "remove rolls back";

/**
 * S and T of one contact linked RELATED_TO by R; a merge (actor) and a removal of R through T
 * (other member) race in the given order. Exact audit tallies per actor tell whose rows exist.
 */
async function removeAgainstMerge(order: RemoveOrder) {
  const { orgId, actor, other } = await seedActor();
  const [s, t] = await sameContact(orgId, 2);
  const r = await seedRelation(prisma, orgId, {
    type: "RELATED_TO",
    fromTicketId: s.id,
    toTicketId: t.id,
    createdById: actor.userId,
  });
  const audits = await auditTally([s.id, t.id]);
  const sentinel =
    order === "remove rolls back" ? new Error(`c10-3c-sentinel-${randomUUID()}`) : undefined;
  // R2-1: the merge states the link it reviewed. Here it is the link the merge finds once it
  // holds the row locks, so each order still reaches the path it pins (R replaced, or already
  // gone). A reviewed link that no longer holds is refused with LINK_CHANGED, covered in
  // ticket-merge.test.ts ("the reviewed link is a precondition").
  const reviewedOnLock: RelationLabel | null = order === "remove commits" ? null : "Related to";

  let mergeDone: Promise<MergeResult>;
  let removal: Promise<unknown>;
  if (order === "merge holds") {
    const merge = heldMerge(actor, s, t, "Related to");
    await merge.atCommit;
    const mergePid = await merge.pid;
    const recordedRemove = deferred<number>();
    removal = removeRelation(
      prisma,
      other,
      { ticketId: t.id, relationId: r.id },
      { onTransactionStart: async (tx) => recordedRemove.resolve(await backendPid(tx)) },
    );
    removal.catch(() => {});
    const removePid = await recordedRemove.promise;
    await waitForBlockedBy(prisma, mergePid, [removePid]);
    merge.release();
    mergeDone = merge.done;
  } else {
    const recordedRemove = deferred<number>();
    const heldRemove = deferred<void>();
    const releaseRemove = deferred<void>();
    removal = removeRelation(
      prisma,
      other,
      { ticketId: t.id, relationId: r.id },
      {
        onTransactionStart: async (tx) => recordedRemove.resolve(await backendPid(tx)),
        beforeCommit: async () => {
          heldRemove.resolve();
          await releaseRemove.promise;
          if (sentinel) throw sentinel;
        },
      },
    );
    removal.catch(() => {});
    await heldRemove.promise;
    const removePid = await recordedRemove.promise;
    const merge = recordedMerge(actor, s, t, reviewedOnLock);
    const mergePid = await merge.pid;
    await waitForBlockedBy(prisma, removePid, [mergePid]);
    releaseRemove.resolve();
    mergeDone = merge.done;
  }

  if (sentinel) {
    const outcome = await removal.then(
      () => null,
      (err: unknown) => err,
    );
    expect(outcome).toBe(sentinel);
  } else if (order === "merge holds") {
    expect(await fulfilled(removal)).toEqual({ ok: false, error: "ALREADY_REMOVED" });
  } else {
    expect(await fulfilled(removal)).toEqual({ ok: true, ticketIds: [s.id, t.id] });
  }
  expect(await fulfilled(mergeDone)).toEqual({
    ok: true,
    sourceTicketId: s.id,
    targetTicketId: t.id,
  });

  const links = await prisma.ticketRelation.findMany({
    where: { organizationId: orgId },
    select: { id: true, type: true, fromTicketId: true, toTicketId: true },
  });
  expect(links.map(({ id: _id, ...link }) => link)).toEqual([
    { type: "DUPLICATE_OF", fromTicketId: s.id, toTicketId: t.id },
  ]);
  const duplicate = must(links[0], "DUPLICATE_OF");

  // The merge replaces R unless a committed removal deleted it first; the replacer writes the
  // two RELATION_REMOVED rows (and only a merge writes RELATION_ADDED).
  const remover = order === "remove commits" ? other.userId : actor.userId;
  const expected = plus(audits, [
    ...mergeRows(actor, s, t),
    [s.id, "RELATION_REMOVED", remover],
    [t.id, "RELATION_REMOVED", remover],
    ...(order === "remove commits"
      ? []
      : ([
          [s.id, "RELATION_ADDED", actor.userId],
          [t.id, "RELATION_ADDED", actor.userId],
        ] as const)),
  ]);
  expect(await auditTally([s.id, t.id])).toEqual(expected);
  const removed = await prisma.ticketAuditEvent.findMany({
    where: { ticketId: { in: [s.id, t.id] }, action: "RELATION_REMOVED" },
    select: { before: true },
  });
  expect(removed).toHaveLength(2);
  for (const row of removed) {
    expect(row.before).toMatchObject({ relationId: r.id, type: "RELATED_TO" });
  }

  // D-06: the merge link cannot be removed afterwards, and the refusal changes nothing.
  expect(await removeRelation(prisma, other, { ticketId: t.id, relationId: duplicate.id })).toEqual(
    { ok: false, error: "MERGE_LINK" },
  );
  expect(await prisma.ticketRelation.findMany({ where: { organizationId: orgId } })).toHaveLength(
    1,
  );
  expect(await auditTally([s.id, t.id])).toEqual(expected);
}

describe("review C10: a relation removal racing a merge's link replacement", () => {
  it("3a: the merge holds after replacing R; the removal re-reads under the locks and returns ALREADY_REMOVED", () =>
    removeAgainstMerge("merge holds"));

  it("3b: the removal holds and commits first; the merge finds no link to replace", () =>
    removeAgainstMerge("remove commits"));

  it("3c: the removal holds and rolls back; the merge then replaces R and no row of the removal remains", () =>
    removeAgainstMerge("remove rolls back"));
});
