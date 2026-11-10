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
import { prisma } from "@/lib/db";
import { DIGEST_EMAIL_SUBJECT, type RunDigestsDeps, runDigests } from "@/lib/notifications/digest";
import { insertNotifications } from "@/lib/notifications/store";
import { type NotificationTypeName, TICKET_ENTITY } from "@/lib/notifications/types";
import { scopedDb } from "@/lib/scoped-db";
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
