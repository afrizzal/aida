// Phase 10, plan 10-09 (AIDA-46; D-23, D-24, D-25, C8, C10, R2-5, V-28, V-29): the email digest
// on a real Postgres through Testcontainers and a hand-written node:net fake SMTP server, unmocked.
// Every organization of this file points its email settings at the loopback fake; nothing leaves
// the machine. Lease expiry is proven with an injected clock (runDigests' `now`), never by
// waiting five minutes; the send deadline is real wall-clock time.
//
// Every case asserts presence (a captured or received message, or a digest row state) before it
// asserts absence.
import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveEmailSettings } from "@/lib/channels/email/settings";
import { createSmtpTransport, type SmtpConnectionConfig } from "@/lib/channels/email/smtp-client";
import { prisma } from "@/lib/db";
import { DIGEST_EMAIL_SUBJECT, type RunDigestsDeps, runDigests } from "@/lib/notifications/digest";
import { COMMIT_MARGIN_MS, LEASE_MS } from "@/lib/notifications/digest-config";
import {
  classifySendResult,
  type DigestSendOutcome,
  sendDigestMail,
} from "@/lib/notifications/digest-sender";
import { setPreference, setUnassignedSetting } from "@/lib/notifications/preferences";
import { insertNotifications } from "@/lib/notifications/store";
import { type NotificationTypeName, TICKET_ENTITY } from "@/lib/notifications/types";
import { scopedDb } from "@/lib/scoped-db";
import { createTicket } from "@/lib/tickets/create-ticket";
import { type FakeSmtpServer, startFakeSmtp } from "../support/fake-smtp";
import { type MemberRole, seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

const BASE_URL = "http://digest.example.test:3100";
let savedAuthUrl: string | undefined;
let smtp: FakeSmtpServer;
const createdOrgs: string[] = [];

beforeAll(async () => {
  savedAuthUrl = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = `${BASE_URL}/`;
  smtp = await startFakeSmtp();
});

afterAll(async () => {
  await smtp.stop();
  if (savedAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = savedAuthUrl;
});

beforeEach(() => {
  smtp.reset();
});

// A case's leftovers (a CLAIMED digest, unsent rows) must never send in a later case: every
// organization of the file has its email turned off and its rows archived after each case.
afterEach(async () => {
  for (const orgId of createdOrgs.splice(0)) {
    await saveEmailSettings(scopedDb(orgId), orgId, { enabled: false });
    await prisma.notification.updateMany({
      where: { organizationId: orgId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
  }
});

interface OrgOptions {
  roles?: readonly MemberRole[];
  email?: "on" | "off" | "no-host";
  smtpSecure?: boolean;
}

/** An organization whose members have known emails, with email pointed at the fake SMTP. */
async function seedOrg({ roles = ["owner"], email = "on", smtpSecure = false }: OrgOptions = {}) {
  const { orgId, users } = await seedOrgWithMembers(prisma, roles);
  createdOrgs.push(orgId);
  const members = [];
  for (const user of users) {
    const address = `digest-${randomUUID()}@example.test`;
    await prisma.user.update({ where: { id: user.id }, data: { email: address } });
    members.push({ id: user.id, role: user.role, email: address });
  }
  await saveEmailSettings(scopedDb(orgId), orgId, {
    enabled: email !== "off",
    fromAddress: "support@example.test",
    smtpHost: email === "no-host" ? "" : "127.0.0.1",
    smtpPort: smtp.port,
    smtpSecure,
    smtpUser: "fake-user",
    smtpPassword: "fake-password",
  });
  return { orgId, members };
}

/** Inserts one notification for the recipient on the ticket; returns its id. */
async function notify(
  orgId: string,
  recipientUserId: string,
  type: NotificationTypeName,
  ticketId: string,
  { fallback = false }: { fallback?: boolean } = {},
): Promise<string> {
  const eventKey = `test:${randomUUID()}`;
  await insertNotifications(prisma, orgId, [
    {
      recipientUserId,
      type,
      eventKey,
      entityType: TICKET_ENTITY,
      entityId: ticketId,
      unassignedFallback: fallback,
    },
  ]);
  const row = await prisma.notification.findFirstOrThrow({
    where: { organizationId: orgId, recipientUserId, eventKey },
    select: { id: true },
  });
  return row.id;
}

function digestsOf(orgId: string, recipientUserId: string) {
  return prisma.notificationDigest.findMany({
    where: { organizationId: orgId, recipientUserId },
    orderBy: { createdAt: "asc" },
  });
}

async function digestedAt(ids: readonly string[]) {
  const rows = await prisma.notification.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, digestedAt: true },
  });
  return new Map(rows.map((r) => [r.id, r.digestedAt]));
}

function messagesTo(address: string, list = smtp.messages) {
  return list.filter((m) => m.recipients.includes(address));
}

async function parse(raw: string) {
  const mail = await simpleParser(raw);
  return { subject: mail.subject ?? "", text: mail.text ?? "" };
}

function link(ticketId: string) {
  return `${BASE_URL}/tickets/${ticketId}`;
}

/** Shorter SMTP timeouts so a fault case does not wait the shipped 10 s. */
const FAST: RunDigestsDeps["timing"] = { smtpTimeoutMs: 1_000, sendDeadlineMs: 5_000 };

describe("tracer: one recipient's notifications claimed, emailed on an owned socket, then recorded", () => {
  it("sends exactly one message with the constant subject, both ticket numbers and links; the digest is SENT and both rows are stamped", async () => {
    const { orgId, members } = await seedOrg({ roles: ["owner"] });
    const [owner] = members;
    if (!owner) throw new Error("no owner");
    const t1 = await seedTicket(orgId);
    const t2 = await seedTicket(orgId);
    const n1 = await notify(orgId, owner.id, "ASSIGNED", t1.id);
    const n2 = await notify(orgId, owner.id, "MENTION", t2.id);

    const result = await runDigests({ timing: FAST });

    const mine = result.reports.filter((r) => r.organizationId === orgId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.outcome).toBe("sent");

    const delivered = messagesTo(owner.email);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.from).toBe("support@example.test");
    const { subject, text } = await parse(delivered[0]?.raw ?? "");
    expect(subject).toBe(DIGEST_EMAIL_SUBJECT);
    expect(subject).toBe("Your AIDA updates");
    expect(text).toContain("Here is what happened since your last digest.");
    expect(text).toContain(`Assigned to you: 1 (#${t1.number} ${link(t1.id)})`);
    expect(text).toContain(`Mentions: 1 (#${t2.number} ${link(t2.id)})`);
    expect(text).toContain("Change what you receive in AIDA under Settings → Notifications.");

    const digests = await digestsOf(orgId, owner.id);
    expect(digests).toHaveLength(1);
    expect(digests[0]?.status).toBe("SENT");
    expect(digests[0]?.sentAt).toBeInstanceOf(Date);
    expect([...(digests[0]?.notificationIds ?? [])].sort()).toEqual([n1, n2].sort());

    const stamped = await digestedAt([n1, n2]);
    expect(stamped.get(n1)).toBeInstanceOf(Date);
    expect(stamped.get(n2)).toBeInstanceOf(Date);

    // A second run finds nothing left for this recipient and sends nothing more.
    const again = await runDigests({ timing: FAST });
    expect(again.reports.filter((r) => r.organizationId === orgId)).toEqual([]);
    expect(messagesTo(owner.email)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2: races, rejections, ambiguity, the deadline and the lease check, mid-batch changes,
// privacy, isolation and TLS equivalence.
// ---------------------------------------------------------------------------------------------

/** A controllable clock for runDigests' `now`. */
function clock(start = Date.now()) {
  let t = start;
  return {
    now: () => new Date(t),
    get ms() {
      return t;
    },
    set(ms: number) {
      t = ms;
    },
  };
}

/** An owner with an ASSIGNED and a MENTION row on two tickets. */
async function ownerWithTwoRows(options: OrgOptions = {}) {
  const { orgId, members } = await seedOrg({ roles: ["owner"], ...options });
  const [owner] = members;
  if (!owner) throw new Error("no owner");
  const t1 = await seedTicket(orgId);
  const t2 = await seedTicket(orgId);
  const n1 = await notify(orgId, owner.id, "ASSIGNED", t1.id);
  const n2 = await notify(orgId, owner.id, "MENTION", t2.id);
  return { orgId, owner, t1, t2, ids: [n1, n2] };
}

function reportFor(result: Awaited<ReturnType<typeof runDigests>>, orgId: string) {
  return result.reports.filter((r) => r.organizationId === orgId);
}

async function statuses(orgId: string, userId: string) {
  return (await digestsOf(orgId, userId)).map((d) => d.status);
}

async function noneStamped(ids: readonly string[]) {
  const stamped = await digestedAt(ids);
  expect(stamped.size).toBe(ids.length);
  for (const id of ids) expect(stamped.get(id)).toBeNull();
}

async function allStamped(ids: readonly string[]) {
  const stamped = await digestedAt(ids);
  expect(stamped.size).toBe(ids.length);
  for (const id of ids) expect(stamped.get(id)).toBeInstanceOf(Date);
}

describe("two workers racing (D-23)", () => {
  it("two runDigests at once over two recipients send exactly one email per recipient (5 repetitions on fresh data)", async () => {
    for (let rep = 0; rep < 5; rep += 1) {
      const { orgId, members } = await seedOrg({ roles: ["owner", "member"] });
      const [a, b] = members;
      if (!a || !b) throw new Error("two members expected");
      const ta = await seedTicket(orgId);
      const tb = await seedTicket(orgId);
      const na = await notify(orgId, a.id, "ASSIGNED", ta.id);
      const nb = await notify(orgId, b.id, "ASSIGNED", tb.id);

      const [first, second] = await Promise.all([
        runDigests({ timing: FAST }),
        runDigests({ timing: FAST }),
      ]);

      expect(messagesTo(a.email)).toHaveLength(1);
      expect(messagesTo(b.email)).toHaveLength(1);
      expect(await statuses(orgId, a.id)).toEqual(["SENT"]);
      expect(await statuses(orgId, b.id)).toEqual(["SENT"]);
      await allStamped([na, nb]);
      const outcomes = [...reportFor(first, orgId), ...reportFor(second, orgId)]
        .map((r) => r.outcome)
        .sort();
      expect(outcomes.filter((o) => o === "sent")).toHaveLength(2);
      expect(
        outcomes.filter((o) => o !== "sent").every((o) => o === "held" || o === "nothing"),
      ).toBe(true);
    }
  });
});

describe("definitive rejections release the batch at once (R2-5)", () => {
  it("reject-data (554 after the whole message): RELEASED at once, nothing stamped; the next run sends exactly one email with the same notifications", async () => {
    const { orgId, owner, t1, t2, ids } = await ownerWithTwoRows();
    smtp.setMode("reject-data");
    const first = await runDigests({ timing: FAST });
    expect(reportFor(first, orgId).map((r) => r.outcome)).toEqual(["rejected"]);
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(1);
    expect(messagesTo(owner.email)).toHaveLength(0);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED"]);
    await noneStamped(ids);

    smtp.setMode("none");
    await runDigests({ timing: FAST });
    const delivered = messagesTo(owner.email);
    expect(delivered).toHaveLength(1);
    const { text } = await parse(delivered[0]?.raw ?? "");
    expect(text).toContain(link(t1.id));
    expect(text).toContain(link(t2.id));
    const digests = await digestsOf(orgId, owner.id);
    expect(digests.map((d) => d.status)).toEqual(["RELEASED", "SENT"]);
    expect([...(digests[1]?.notificationIds ?? [])].sort()).toEqual(
      [...(digests[0]?.notificationIds ?? [])].sort(),
    );
    await allStamped(ids);
  });

  it("reject-data-command (RCPT accepted, 554 to DATA): RELEASED at once, nothing received or stamped; the next run sends exactly one", async () => {
    const { orgId, owner, ids } = await ownerWithTwoRows();
    smtp.setMode("reject-data-command");
    const first = await runDigests({ timing: FAST });
    expect(reportFor(first, orgId).map((r) => r.outcome)).toEqual(["rejected"]);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED"]);
    expect(smtp.connections).toBeGreaterThanOrEqual(1);
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(0);
    await noneStamped(ids);

    smtp.setMode("none");
    await runDigests({ timing: FAST });
    expect(messagesTo(owner.email)).toHaveLength(1);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED", "SENT"]);
    await allStamped(ids);
  });

  it("reject-rcpt (550 to RCPT): RELEASED at once, nothing received or stamped; the next run sends exactly one", async () => {
    const { orgId, owner, ids } = await ownerWithTwoRows();
    smtp.setMode("reject-rcpt");
    const first = await runDigests({ timing: FAST });
    expect(reportFor(first, orgId).map((r) => r.outcome)).toEqual(["rejected"]);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED"]);
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(0);
    await noneStamped(ids);

    smtp.setMode("none");
    await runDigests({ timing: FAST });
    expect(messagesTo(owner.email)).toHaveLength(1);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED", "SENT"]);
    await allStamped(ids);
  });
});

describe("ambiguous outcomes keep the claim until the lease expires (C8, R2-5, V-29)", () => {
  it("drop-on-data: CLAIMED, nothing stamped; a run before the lease expires sends nothing; a run past the lease sends exactly one accepted email", async () => {
    const c = clock();
    const { orgId, owner, ids } = await ownerWithTwoRows();
    smtp.setMode("drop-on-data");
    const first = await runDigests({ timing: FAST, now: c.now });
    expect(reportFor(first, orgId).map((r) => r.outcome)).toEqual(["ambiguous"]);
    expect(await statuses(orgId, owner.id)).toEqual(["CLAIMED"]);
    await noneStamped(ids);

    smtp.setMode("none");
    c.set(c.ms + LEASE_MS - 1_000);
    const early = await runDigests({ timing: FAST, now: c.now });
    expect(reportFor(early, orgId).map((r) => r.outcome)).toEqual(["held"]);
    expect(await statuses(orgId, owner.id)).toEqual(["CLAIMED"]);
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(0);

    c.set(c.ms + 2_000);
    const late = await runDigests({ timing: FAST, now: c.now });
    expect(reportFor(late, orgId).map((r) => r.outcome)).toEqual(["sent"]);
    expect(messagesTo(owner.email)).toHaveLength(1);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED", "SENT"]);
    await allStamped(ids);
  });

  it("drop-after-data-end: the fake received the message but replied nothing; CLAIMED; past the lease a second copy is received", async () => {
    const c = clock();
    const { orgId, owner, ids } = await ownerWithTwoRows();
    smtp.setMode("drop-after-data-end");
    await runDigests({ timing: FAST, now: c.now });
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(1);
    expect(messagesTo(owner.email)).toHaveLength(0);
    expect(await statuses(orgId, owner.id)).toEqual(["CLAIMED"]);
    await noneStamped(ids);

    smtp.setMode("none");
    c.set(c.ms + LEASE_MS + 1_000);
    await runDigests({ timing: FAST, now: c.now });
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(2);
    expect(messagesTo(owner.email)).toHaveLength(1);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED", "SENT"]);
    await allStamped(ids);
  });

  it("repeated ambiguous: two lease cycles of drop-after-data-end, then success: three copies received, SENT once, each row stamped once", async () => {
    const c = clock();
    const { orgId, owner, ids } = await ownerWithTwoRows();
    smtp.setMode("drop-after-data-end");
    await runDigests({ timing: FAST, now: c.now });
    c.set(c.ms + LEASE_MS + 1_000);
    await runDigests({ timing: FAST, now: c.now });
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED", "CLAIMED"]);
    await noneStamped(ids);

    smtp.setMode("none");
    c.set(c.ms + LEASE_MS + 1_000);
    await runDigests({ timing: FAST, now: c.now });
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(3);
    expect(messagesTo(owner.email)).toHaveLength(1);
    const digests = await digestsOf(orgId, owner.id);
    expect(digests.map((d) => d.status)).toEqual(["RELEASED", "RELEASED", "SENT"]);
    const sentAt = digests[2]?.sentAt;
    expect(sentAt).toBeInstanceOf(Date);
    const stamped = await digestedAt(ids);
    for (const id of ids) expect(stamped.get(id)?.getTime()).toBe(sentAt?.getTime());
  });

  it("afterSend throwing after acceptance: CLAIMED, nothing stamped; past the lease it is sent again", async () => {
    const c = clock();
    const { orgId, owner, ids } = await ownerWithTwoRows();
    const first = await runDigests({
      timing: FAST,
      now: c.now,
      hooks: {
        afterSend: () => {
          throw new Error("crash after acceptance");
        },
      },
    });
    expect(reportFor(first, orgId).map((r) => r.outcome)).toEqual(["failed"]);
    expect(messagesTo(owner.email)).toHaveLength(1);
    expect(await statuses(orgId, owner.id)).toEqual(["CLAIMED"]);
    await noneStamped(ids);

    c.set(c.ms + LEASE_MS + 1_000);
    await runDigests({ timing: FAST, now: c.now });
    expect(messagesTo(owner.email)).toHaveLength(2);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED", "SENT"]);
    await allStamped(ids);
  });

  it("the fence: a run that records after its claim was released and resent by another run changes nothing; the other run's digest is the one SENT", async () => {
    const c = clock();
    const { orgId, owner, ids } = await ownerWithTwoRows();
    let inner: Awaited<ReturnType<typeof runDigests>> | null = null;
    const outer = await runDigests({
      timing: FAST,
      now: c.now,
      hooks: {
        afterSend: async () => {
          // The original sender stalls past its lease; another run releases, reclaims and sends.
          c.set(c.ms + LEASE_MS + 1_000);
          inner = await runDigests({ timing: FAST, now: c.now });
        },
      },
    });
    expect(inner).not.toBeNull();
    expect(
      reportFor(inner as unknown as Awaited<ReturnType<typeof runDigests>>, orgId).map(
        (r) => r.outcome,
      ),
    ).toEqual(["sent"]);
    expect(reportFor(outer, orgId).map((r) => r.outcome)).toEqual(["fenced"]);
    expect(messagesTo(owner.email)).toHaveLength(2);
    const digests = await digestsOf(orgId, owner.id);
    expect(digests.map((d) => d.status)).toEqual(["RELEASED", "SENT"]);
    const stamped = await digestedAt(ids);
    for (const id of ids) expect(stamped.get(id)?.getTime()).toBe(digests[1]?.sentAt?.getTime());
  });
});

describe("the deadline and the lease check (V-29)", () => {
  const TRICKLE: RunDigestsDeps["timing"] = { smtpTimeoutMs: 1_000, sendDeadlineMs: 2_500 };

  it("trickle: a reply sent one byte every 200 ms (under the 1 000 ms timeout) is cut off by the 2 500 ms deadline within 3 500 ms of connecting; the digest stays CLAIMED", async () => {
    const { orgId, owner, ids } = await ownerWithTwoRows();
    smtp.setMode("trickle", { tricklePauseMs: 200 });
    let connectAt = 0;
    const result = await runDigests({
      timing: TRICKLE,
      hooks: {
        beforeConnect: () => {
          connectAt = Date.now();
        },
      },
    });
    const elapsed = Date.now() - connectAt;
    expect(connectAt).toBeGreaterThan(0);
    expect(reportFor(result, orgId).map((r) => r.outcome)).toEqual(["ambiguous"]);
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(1);
    expect(elapsed).toBeGreaterThanOrEqual(2_400);
    expect(elapsed).toBeLessThan(3_500);
    expect(messagesTo(owner.email)).toHaveLength(0);
    expect(await statuses(orgId, owner.id)).toEqual(["CLAIMED"]);
    await noneStamped(ids);
  });

  it("trickle, directly: sendDigestMail returns ambiguous below the deadline plus one second, while createSmtpTransport with the same 1 000 ms timeout keeps reading until the reply completes", async () => {
    smtp.setMode("trickle", { tricklePauseMs: 200 });
    const settings = plainSettings();
    const to = `trickle-${randomUUID()}@example.test`;
    const mail = { from: "support@example.test", to, subject: DIGEST_EMAIL_SUBJECT, text: "x" };

    const cut = await sendDigestMail(settings, mail, { deadlineMs: 2_500, timeoutMs: 1_000 });
    expect(cut.outcome).toBe("ambiguous");
    expect(cut.deadlineReached).toBe(true);
    expect(cut.elapsedMs).toBeGreaterThanOrEqual(2_400);
    expect(cut.elapsedMs).toBeLessThan(3_500);

    // The inactivity timeout alone bounds nothing: the plain transport outlives the deadline.
    const started = Date.now();
    const plain = await settle(createSmtpTransport(settings, { timeoutMs: 1_000 }), mail);
    const plainElapsed = Date.now() - started;
    expect(classifySendResult(to, plain).outcome).toBe("accepted");
    expect(plainElapsed).toBeGreaterThan(3_500);
    expect(messagesTo(to, smtp.received)).toHaveLength(2);
    expect(messagesTo(to)).toHaveLength(1);
  });

  it("lease check: beforeConnect advances the clock so the remaining lease is below the deadline plus the margin; the digest is RELEASED and the fake saw no connection", async () => {
    const c = clock();
    const { orgId, owner, ids } = await ownerWithTwoRows();
    const connectionsBefore = smtp.connections;
    const result = await runDigests({
      timing: FAST,
      now: c.now,
      hooks: {
        beforeConnect: () => {
          // Remaining lease = deadline + margin - 1 s.
          c.set(c.ms + LEASE_MS - (5_000 + COMMIT_MARGIN_MS) + 1_000);
        },
      },
    });
    expect(reportFor(result, orgId).map((r) => r.outcome)).toEqual(["lease-short"]);
    expect(await statuses(orgId, owner.id)).toEqual(["RELEASED"]);
    expect(smtp.connections).toBe(connectionsBefore);
    expect(messagesTo(owner.email, smtp.received)).toHaveLength(0);
    await noneStamped(ids);

    // A later run with a full lease sends it once.
    await runDigests({ timing: FAST, now: c.now });
    expect(messagesTo(owner.email)).toHaveLength(1);
    await allStamped(ids);
  });
});

describe("changes between the claim and the send (C8, D-25, V-28)", () => {
  it("a preference change mid-batch: beforeSend turns the digest off for MENTION; the email lacks the mention line, the mention row stays undigested, the other is stamped", async () => {
    const { orgId, owner, t1, t2, ids } = await ownerWithTwoRows();
    const [assignedId, mentionId] = ids as [string, string];
    await runDigests({
      timing: FAST,
      hooks: {
        beforeSend: async () => {
          await setPreference(orgId, owner.id, "MENTION", { digest: false });
        },
      },
    });
    const delivered = messagesTo(owner.email);
    expect(delivered).toHaveLength(1);
    const { text } = await parse(delivered[0]?.raw ?? "");
    expect(text).toContain(`Assigned to you: 1 (#${t1.number} ${link(t1.id)})`);
    expect(text).not.toContain("Mentions:");
    expect(text).not.toContain(link(t2.id));
    await allStamped([assignedId]);
    await noneStamped([mentionId]);
    expect(await statuses(orgId, owner.id)).toEqual(["SENT"]);
  });

  it("control: the same batch without the hook includes the mention line", async () => {
    const { orgId, owner, t2, ids } = await ownerWithTwoRows();
    await runDigests({ timing: FAST });
    const delivered = messagesTo(owner.email);
    expect(delivered).toHaveLength(1);
    const { text } = await parse(delivered[0]?.raw ?? "");
    expect(text).toContain(`Mentions: 1 (#${t2.number} ${link(t2.id)})`);
    await allStamped(ids);
    expect(await statuses(orgId, owner.id)).toEqual(["SENT"]);
  });

  it("a deactivation mid-batch: beforeSend deletes the member rows; no email, the digest is CANCELED", async () => {
    const { orgId, members } = await seedOrg({ roles: ["owner", "member"] });
    const [owner, member] = members;
    if (!owner || !member) throw new Error("two members expected");
    const t1 = await seedTicket(orgId);
    const nMember = await notify(orgId, member.id, "ASSIGNED", t1.id);
    const nOwner = await notify(orgId, owner.id, "ASSIGNED", t1.id);
    await runDigests({
      timing: FAST,
      hooks: {
        beforeSend: async (ctx) => {
          if (ctx.recipientUserId === member.id) {
            await prisma.member.deleteMany({ where: { organizationId: orgId, userId: member.id } });
          }
        },
      },
    });
    // Presence: the owner's digest of the same run went out; the member's was claimed, then canceled.
    expect(messagesTo(owner.email)).toHaveLength(1);
    expect(await statuses(orgId, member.id)).toEqual(["CANCELED"]);
    expect(messagesTo(member.email, smtp.received)).toHaveLength(0);
    await allStamped([nOwner]);
    await noneStamped([nMember]);

    // A former member is not claimed again.
    const again = await runDigests({ timing: FAST });
    expect(reportFor(again, orgId).map((r) => r.outcome)).toEqual(["nothing"]);
    expect(await statuses(orgId, member.id)).toEqual(["CANCELED"]);
  });

  it("the unassigned fallback mid-batch: beforeSend turns unassignedTickets off; the 'On unassigned tickets' line is absent and the fallback row stays undigested", async () => {
    // Control first: the line is there without the change.
    const control = await ownerWithFallback();
    await runDigests({ timing: FAST });
    const controlText = (await parse(messagesTo(control.owner.email)[0]?.raw ?? "")).text;
    expect(controlText).toContain(
      `On unassigned tickets: 1 (#${control.tf.number} ${link(control.tf.id)})`,
    );
    await allStamped([control.nAssigned, control.nFallback]);

    const { orgId, owner, ta, tf, nAssigned, nFallback } = await ownerWithFallback();
    await runDigests({
      timing: FAST,
      hooks: {
        beforeSend: async () => {
          await setUnassignedSetting(orgId, owner.id, false);
        },
      },
    });
    const delivered = messagesTo(owner.email);
    expect(delivered).toHaveLength(1);
    const { text } = await parse(delivered[0]?.raw ?? "");
    expect(text).toContain(`Assigned to you: 1 (#${ta.number} ${link(ta.id)})`);
    expect(text).not.toContain("On unassigned tickets");
    expect(text).not.toContain(link(tf.id));
    await allStamped([nAssigned]);
    await noneStamped([nFallback]);
  });

  it("the unassigned fallback mid-batch: beforeSend demotes the recipient to member; the 'On unassigned tickets' line is absent and the fallback row stays undigested", async () => {
    const { orgId, owner, ta, tf, nAssigned, nFallback } = await ownerWithFallback();
    await runDigests({
      timing: FAST,
      hooks: {
        beforeSend: async () => {
          await prisma.member.updateMany({
            where: { organizationId: orgId, userId: owner.id },
            data: { role: "member" },
          });
        },
      },
    });
    const delivered = messagesTo(owner.email);
    expect(delivered).toHaveLength(1);
    const { text } = await parse(delivered[0]?.raw ?? "");
    expect(text).toContain(`Assigned to you: 1 (#${ta.number} ${link(ta.id)})`);
    expect(text).not.toContain("On unassigned tickets");
    expect(text).not.toContain(link(tf.id));
    await allStamped([nAssigned]);
    await noneStamped([nFallback]);
  });
});

/** An owner with one ASSIGNED row and one unassigned-fallback CUSTOMER_REPLY row. */
async function ownerWithFallback() {
  const { orgId, members } = await seedOrg({ roles: ["owner"] });
  const [owner] = members;
  if (!owner) throw new Error("no owner");
  const ta = await seedTicket(orgId);
  const tf = await seedTicket(orgId);
  const nAssigned = await notify(orgId, owner.id, "ASSIGNED", ta.id);
  const nFallback = await notify(orgId, owner.id, "CUSTOMER_REPLY", tf.id, { fallback: true });
  return { orgId, owner, ta, tf, nAssigned, nFallback };
}

describe("email off (D-24)", () => {
  it("an organization whose email is off, or has no SMTP host, gets no NotificationDigest row and no connection", async () => {
    // Presence: an organization with email on in the same run is sent.
    const on = await ownerWithTwoRows();
    const off = await ownerWithTwoRows({ email: "off" });
    const noHost = await ownerWithTwoRows({ email: "no-host" });
    const result = await runDigests({ timing: FAST });
    expect(messagesTo(on.owner.email)).toHaveLength(1);
    expect(smtp.connections).toBe(1);
    expect(reportFor(result, off.orgId).map((r) => r.outcome)).toEqual(["email-off"]);
    expect(reportFor(result, noHost.orgId).map((r) => r.outcome)).toEqual(["email-off"]);
    expect(await digestsOf(off.orgId, off.owner.id)).toEqual([]);
    expect(await digestsOf(noHost.orgId, noHost.owner.id)).toEqual([]);
    await noneStamped([...off.ids, ...noHost.ids]);
  });
});

describe("privacy (D-24, T-10-34)", () => {
  it("the raw email carries no ticket subject, contact name, contact email, message text or AuditEvent.input; the subject is the constant", async () => {
    const { orgId, members } = await seedOrg({ roles: ["owner"] });
    const [owner] = members;
    if (!owner) throw new Error("no owner");
    const tag = randomUUID().slice(0, 8);
    const markers = {
      subject: `SUBJECTMARK${tag}`,
      contactName: `NAMEMARK${tag}`,
      contactEmail: `emailmark${tag}@customer.example.test`,
      body: `BODYMARK${tag}`,
      auditInput: `AUDITMARK${tag}`,
    };
    const ticket = await createTicket(orgId, {
      subject: `Printer on fire ${markers.subject}`,
      priority: "NORMAL",
      body: `Please help ${markers.body}`,
      contact: { email: markers.contactEmail, name: markers.contactName },
      direction: "INBOUND",
    });
    await prisma.auditEvent.create({
      data: {
        organizationId: orgId,
        actionType: "TRIAGE",
        ticketId: ticket.id,
        provider: "fake",
        model: "fake",
        input: `prompt ${markers.auditInput}`,
        output: "{}",
      },
    });
    await notify(orgId, owner.id, "CUSTOMER_REPLY", ticket.id);
    await notify(orgId, owner.id, "SLA_AT_RISK", ticket.id);

    await runDigests({ timing: FAST });
    const delivered = messagesTo(owner.email);
    expect(delivered).toHaveLength(1);
    const raw = delivered[0]?.raw ?? "";
    const { subject, text } = await parse(raw);
    expect(subject).toBe("Your AIDA updates");
    expect(text).toContain(`Customer replies: 1 (#${ticket.number} ${link(ticket.id)})`);
    expect(text).toContain(`SLA at risk: 1 (#${ticket.number} ${link(ticket.id)})`);
    for (const marker of Object.values(markers)) {
      expect(raw.toLowerCase()).not.toContain(marker.toLowerCase());
      expect(text.toLowerCase()).not.toContain(marker.toLowerCase());
    }
    expect(raw).not.toContain("Printer on fire");
  });
});

describe("isolation (AIDA-46 prohibition)", () => {
  it("X's digest never includes Y's rows or another organization's rows; read or archived rows are never included", async () => {
    const { orgId, members } = await seedOrg({ roles: ["owner", "member"] });
    const [x, y] = members;
    if (!x || !y) throw new Error("two members expected");
    const other = await seedOrg({ roles: ["owner"] });
    const [z] = other.members;
    if (!z) throw new Error("no member in the other organization");

    const tx1 = await seedTicket(orgId);
    const tRead = await seedTicket(orgId);
    const tArchived = await seedTicket(orgId);
    const tY = await seedTicket(orgId);
    const tZ = await seedTicket(other.orgId);
    const nX = await notify(orgId, x.id, "ASSIGNED", tx1.id);
    const nRead = await notify(orgId, x.id, "ASSIGNED", tRead.id);
    const nArchived = await notify(orgId, x.id, "MENTION", tArchived.id);
    const nY = await notify(orgId, y.id, "ASSIGNED", tY.id);
    const nZ = await notify(other.orgId, z.id, "ASSIGNED", tZ.id);
    await prisma.notification.update({ where: { id: nRead }, data: { readAt: new Date() } });
    await prisma.notification.update({
      where: { id: nArchived },
      data: { archivedAt: new Date() },
    });

    await runDigests({ timing: FAST });

    const toX = messagesTo(x.email);
    expect(toX).toHaveLength(1);
    const { text } = await parse(toX[0]?.raw ?? "");
    expect(text).toContain(link(tx1.id));
    expect(text).toContain("Assigned to you: 1 ");
    for (const foreign of [tRead.id, tArchived.id, tY.id, tZ.id]) {
      expect(text).not.toContain(link(foreign));
    }
    expect(text).not.toContain("Mentions:");
    const xDigests = await digestsOf(orgId, x.id);
    expect(xDigests.map((d) => [...d.notificationIds])).toEqual([[nX]]);
    expect(messagesTo(y.email)).toHaveLength(1);
    expect(messagesTo(z.email)).toHaveLength(1);
    expect((await digestsOf(orgId, y.id)).map((d) => [...d.notificationIds])).toEqual([[nY]]);
    expect((await digestsOf(other.orgId, z.id)).map((d) => [...d.notificationIds])).toEqual([[nZ]]);
    await allStamped([nX, nY, nZ]);
    await noneStamped([nRead, nArchived]);
  });
});

function plainSettings({ secure = false }: { secure?: boolean } = {}): SmtpConnectionConfig {
  return {
    smtpHost: "127.0.0.1",
    smtpPort: smtp.port,
    smtpSecure: secure,
    smtpUser: "fake-user",
    smtpPassword: "fake-password",
  };
}

async function settle(
  transport: ReturnType<typeof createSmtpTransport>,
  mail: { from: string; to: string; subject: string; text: string },
): Promise<Parameters<typeof classifySendResult>[1]> {
  try {
    const info = await transport.sendMail(mail);
    return { ok: true, info };
  } catch (error) {
    return { ok: false, error };
  } finally {
    transport.close();
  }
}

/** Both send paths against the same server: the outcome class of each. */
async function bothPaths(secure: boolean): Promise<{
  transport: DigestSendOutcome;
  sender: DigestSendOutcome;
}> {
  const to = `tls-${randomUUID()}@example.test`;
  const mail = { from: "support@example.test", to, subject: DIGEST_EMAIL_SUBJECT, text: "x" };
  const settings = plainSettings({ secure });
  const viaTransport = classifySendResult(
    to,
    await settle(createSmtpTransport(settings, { timeoutMs: 1_000 }), mail),
  ).outcome;
  const viaSender = (await sendDigestMail(settings, mail, { deadlineMs: 5_000, timeoutMs: 1_000 }))
    .outcome;
  return { transport: viaTransport, sender: viaSender };
}

describe("TLS behaviour is unchanged on the owned socket (V-29, T-10-38)", () => {
  it("a plain server: createSmtpTransport and sendDigestMail both reach accepted", async () => {
    const outcome = await bothPaths(false);
    expect(outcome).toEqual({ transport: "accepted", sender: "accepted" });
    expect(smtp.messages).toHaveLength(2);
    expect(smtp.startTlsCommands).toBe(0);
  });

  it("a server advertising STARTTLS: both paths send STARTTLS, neither falls back to plain text, both reach ambiguous", async () => {
    smtp.setMode("starttls");
    const outcome = await bothPaths(false);
    expect(smtp.startTlsCommands).toBe(2);
    expect(outcome).toEqual({ transport: "ambiguous", sender: "ambiguous" });
    expect(smtp.received).toHaveLength(0);
  });

  it("secure: true against the plain server: both paths start TLS at once, neither sends in plain text, both reach ambiguous", async () => {
    const outcome = await bothPaths(true);
    expect(smtp.connections).toBe(2);
    expect(outcome).toEqual({ transport: "ambiguous", sender: "ambiguous" });
    expect(smtp.received).toHaveLength(0);
    expect(smtp.startTlsCommands).toBe(0);
  });
});
